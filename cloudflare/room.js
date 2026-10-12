/*
 * 房间与对局逻辑（纯逻辑，不碰网络）。
 *
 * 同一份逻辑被两处使用：
 *   - cloudflare/worker.js 里的 Durable Object（线上部署）
 *   - tests/test-cloudflare-room.js（Node 里跑，代替 wrangler 做回归测试）
 *
 * 消息协议与 server.js 完全一致，所以前端不需要区分后端是谁。
 */
import X from './rules-bridge.js';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REASON_TEXT = {
  checkmate: '绝杀', stalemate: '困毙', resign: '认输', timeout: '超时',
  agreement: '和棋（双方同意）', repetition: '三次重复局面', quiet: '60 回合无吃子'
};

export function randCode(len) {
  const n = len || 6;
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}

export function newToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function newRoom(code, timeBase, now) {
  const base = timeBase > 0 ? timeBase : 0;
  return {
    code,
    timeBase: base,
    seats: { r: null, b: null },      // { token, name, online }
    spectators: 0,
    board: X.START,
    turn: 'r',
    status: 'playing',                // playing | over
    result: null,
    history: [],
    moves: [],
    snapshots: [],
    counts: {},
    quietPlies: 0,
    check: false,
    chat: [],
    chatSeq: 0,          // 聊天消息自增 id：客户端靠它去重、补历史
    clocks: { r: base, b: base },
    turnStart: now || 0,
    lastMove: null,
    pending: null,
    rematchVotes: [],
    revision: 1,
    createdAt: now || 0
  };
}

/* ---------- 内部：把持久化的精简状态跑成一份完整对局 ---------- */

function toGame(room) {
  const g = new X.Game();
  g.board = room.board.split('');
  g.turn = room.turn;
  g.status = room.status;
  g.result = room.result;
  g.notations = room.history.slice();
  g.moves = room.moves.slice();
  g.snapshots = room.snapshots.slice();
  g.counts = Object.assign({}, room.counts);
  g.quietPlies = room.quietPlies;
  g.check = room.check;
  return g;
}

function fromGame(room, g) {
  room.board = g.board.join('');
  room.turn = g.turn;
  room.status = g.status;
  room.result = g.result;
  room.history = g.notations.slice();
  room.moves = g.moves.slice();
  room.snapshots = g.snapshots.slice();
  room.counts = g.counts;
  room.quietPlies = g.quietPlies;
  room.check = g.check;
}

/* ---------- 对外：给某个连接看到的视图 ---------- */

export function clockNow(room, side, now) {
  if (!room.timeBase) return 0;
  let t = room.clocks[side];
  if (room.status === 'playing' && room.turnStart && room.turn === side) {
    t -= (now - room.turnStart);
  }
  return Math.max(0, t);
}

export function publicState(room, conn, now) {
  const t = now || Date.now();
  return {
    t: 'state',
    code: room.code,
    board: room.board,
    turn: room.turn,
    status: room.status,
    check: room.check,
    result: room.result,
    history: room.history,
    moveCount: room.moves.length,
    lastMove: room.lastMove,
    seats: {
      r: room.seats.r ? { name: room.seats.r.name, online: !!room.seats.r.online } : null,
      b: room.seats.b ? { name: room.seats.b.name, online: !!room.seats.b.online } : null
    },
    you: conn && conn.seat ? conn.seat : null,
    spectating: !(conn && conn.seat),
    spectators: room.spectators,
    timeBase: room.timeBase,
    clocks: { r: clockNow(room, 'r', t), b: clockNow(room, 'b', t) },
    pending: room.pending,
    rematchVotes: room.rematchVotes.slice(),
    // 聊天记录跟着状态一起下发（最多 40 条）：Durable Object 不会像常驻进程那样
    // 逐条转发消息，客户端靠 id 去重、并能补上进入房间前的历史
    chat: room.chat.slice(-40),
    started: !!(room.seats.r && room.seats.b),
    serverTime: t
  };
}

export function resultText(result) {
  if (!result) return '';
  const why = REASON_TEXT[result.reason] || result.reason;
  if (result.winner === 'draw') return '和棋 —— ' + why;
  return (result.winner === 'r' ? '红方胜' : '黑方胜') + ' —— ' + why;
}

/*
 * 座位归属以 token 为准：换先（再来一局）和断线重连都会让某个连接的座位变化，
 * 每次广播前用它把连接的 seat 重新对齐到房间状态。
 */
export function reconcileSeats(room, conns) {
  for (const c of conns) {
    if (!c) continue;
    if (!c.token) { if (!c.seat) c.seat = null; continue; }
    if (room.seats.r && room.seats.r.token === c.token) c.seat = 'r';
    else if (room.seats.b && room.seats.b.token === c.token) c.seat = 'b';
    else c.seat = null;
  }
}

/* ---------- 内部：时钟与结束 ---------- */

function syncClock(room, now) {
  if (!room.timeBase) return;
  if (room.status === 'playing' && room.turnStart) {
    const side = room.turn;
    room.clocks[side] = Math.max(0, room.clocks[side] - (now - room.turnStart));
  }
  room.turnStart = room.status === 'playing' ? now : 0;
}

function finish(room, result, now) {
  if (room.timeBase && room.turnStart && room.status === 'playing') {
    const side = room.turn;
    room.clocks[side] = Math.max(0, room.clocks[side] - (now - room.turnStart));
  }
  room.status = 'over';
  room.result = result;
  room.pending = null;
  room.turnStart = 0;
}

// 该在什么时刻醒来判超时（给 Durable Object 的 alarm 用）
export function nextDeadline(room, now) {
  if (!room.timeBase || room.status !== 'playing' || !room.turnStart) return 0;
  const left = clockNow(room, room.turn, now || Date.now());
  return (now || Date.now()) + left + 150;   // 一点点余量，避免边界抖动
}

export function checkTimeout(room, now) {
  if (!room.timeBase || room.status !== 'playing' || !room.turnStart) return false;
  const side = room.turn;
  if (clockNow(room, side, now) > 0) return false;
  const loser = side;
  finish(room, { winner: X.other(loser), reason: 'timeout' }, now);
  sysChat(room, (loser === 'r' ? '红方' : '黑方') + '超时 —— ' + resultText(room.result), 'result');
  return true;
}

function sysChat(room, text, kind) {
  room.chatSeq = (room.chatSeq || 0) + 1;
  const msg = { t: 'chat', id: room.chatSeq, name: '系统', text, ts: Date.now(), system: true, kind: kind || 'info' };
  room.chat.push(msg);
  if (room.chat.length > 200) room.chat.shift();
  return msg;
}

/* ---------- 消息处理 ---------- */

/*
 * conn: { id, seat, name, token, spectator, send(obj) }
 * env:  { send(conn, obj), broadcast(room, now), close(conn) }
 * 返回 true 表示状态有变化，需要广播
 */
export function handleMessage(room, conn, msg, env) {
  const now = env.now ? env.now() : Date.now();
  if (!msg || typeof msg.t !== 'string') return false;

  switch (msg.t) {
    case 'create':
    case 'join': {
      if (typeof msg.name === 'string' && msg.name.trim()) conn.name = msg.name.trim().slice(0, 12);
      const wanted = String(msg.code || room.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (wanted && wanted !== room.code) { env.send(conn, { t: 'note', text: '房间号对不上' }); return false; }

      // 房主选的用时（分钟）在这里生效；Cloudflare 版建房间时 timeBase 是 0，必须由客户端带过来
      if (msg.t === 'create' && room.moves.length === 0) {
        const mins = Math.max(0, Math.min(180, Number(msg.timeBase) || 0));
        const base = Math.round(mins * 60000);
        if (base !== room.timeBase) {
          room.timeBase = base;
          room.clocks = { r: base, b: base };
          room.turnStart = 0;
        }
      }

      let seat = null;
      if (msg.token) {
        if (room.seats.r && room.seats.r.token === msg.token) seat = 'r';
        else if (room.seats.b && room.seats.b.token === msg.token) seat = 'b';
      }
      if (!seat) {
        if (!room.seats.r) seat = 'r';
        else if (!room.seats.b) seat = 'b';
        else if (!room.seats.r.online) seat = 'r';
        else if (!room.seats.b.online) seat = 'b';
      }

      if (seat) {
        const before = room.seats[seat];
        const token = before ? before.token : newToken();
        room.seats[seat] = { token, name: conn.name, online: true };
        conn.seat = seat;
        conn.token = token;
        env.send(conn, { t: 'joined', code: room.code, seat, token, timeBase: room.timeBase });
        env.send(conn, sysChat(room, conn.name + ' 已入座 ' + (seat === 'r' ? '红方' : '黑方'), 'info'));
        if (room.seats.r && room.seats.b && room.moves.length === 0 && !room.announced) {
          room.announced = true;
          env.send(conn, sysChat(room, '双方就位，红先行', 'info'));
        }
        if (!room.turnStart && room.status === 'playing') room.turnStart = now;
      } else {
        conn.seat = null;
        room.spectators = Math.max(1, room.spectators + 1);
        env.send(conn, { t: 'joined', code: room.code, seat: null, spectating: true, timeBase: room.timeBase });
        env.send(conn, sysChat(room, conn.name + ' 进入观战', 'info'));
      }
      return true;
    }

    case 'sit': {
      if (conn.seat) { env.send(conn, { t: 'note', text: '你已经在座位上了' }); return false; }
      const want = msg.seat === 'r' || msg.seat === 'b' ? msg.seat : null;
      const target = want && !room.seats[want] ? want : (!room.seats.r ? 'r' : (!room.seats.b ? 'b' : null));
      if (!target) { env.send(conn, { t: 'note', text: '座位已满，先观战吧' }); return false; }
      room.spectators = Math.max(0, room.spectators - 1);
      const token = newToken();
      room.seats[target] = { token, name: conn.name, online: true };
      conn.seat = target;
      conn.token = token;
      env.send(conn, { t: 'joined', code: room.code, seat: target, token, timeBase: room.timeBase });
      env.send(conn, sysChat(room, conn.name + ' 入座 ' + (target === 'r' ? '红方' : '黑方'), 'info'));
      return true;
    }

    case 'move': {
      if (!conn.seat) { env.send(conn, { t: 'note', text: '观战不能走棋' }); return false; }
      if (room.status !== 'playing') { env.send(conn, { t: 'note', text: '对局已结束' }); return false; }
      if (!room.seats.r || !room.seats.b) { env.send(conn, { t: 'note', text: '等对手入座后再走棋' }); return false; }
      if (conn.seat !== room.turn) { env.send(conn, { t: 'note', text: '还没轮到你走棋' }); return false; }

      const g = toGame(room);
      const res = g.move(msg.from | 0, msg.to | 0);
      if (!res.ok) { env.send(conn, { t: 'note', text: res.error }); return false; }
      syncClock(room, now);
      fromGame(room, g);
      room.lastMove = { from: msg.from | 0, to: msg.to | 0 };
      room.pending = null;
      room.rematchVotes = [];
      room.turnStart = room.status === 'playing' ? now : 0;
      if (room.status === 'over') {
        env.send(conn, sysChat(room, resultText(room.result), 'result'));
      } else if (room.check) {
        env.send(conn, sysChat(room, (room.turn === 'r' ? '红方' : '黑方') + '被将军', 'check'));
      }
      return true;
    }

    case 'resign': {
      if (!conn.seat || room.status !== 'playing') return false;
      finish(room, { winner: X.other(conn.seat), reason: 'resign' }, now);
      env.send(conn, sysChat(room, conn.name + ' 认输 —— ' + resultText(room.result), 'result'));
      return true;
    }

    case 'draw':
    case 'undo': {
      if (!conn.seat) { env.send(conn, { t: 'note', text: '观战不能发起请求' }); return false; }
      if (room.status !== 'playing') { env.send(conn, { t: 'note', text: '对局未在进行中' }); return false; }
      if (room.pending && room.pending.by !== conn.seat) { env.send(conn, { t: 'note', text: '等对方先答复上一个请求' }); return false; }
      if (msg.t === 'undo' && room.moves.length === 0) { env.send(conn, { t: 'note', text: '还没走棋' }); return false; }
      room.pending = { kind: msg.t, by: conn.seat };
      env.send(conn, sysChat(room, conn.name + (msg.t === 'draw' ? ' 提议和棋' : ' 请求悔棋'), 'ask'));
      return true;
    }

    case 'reply': {
      const p = room.pending;
      if (!p) return false;
      if (!conn.seat || conn.seat === p.by) { env.send(conn, { t: 'note', text: '要等对方答复' }); return false; }
      room.pending = null;
      if (!msg.accept) {
        env.send(conn, sysChat(room, conn.name + ' 拒绝了' + (p.kind === 'draw' ? '和棋' : '悔棋'), 'info'));
        return true;
      }
      if (p.kind === 'draw') {
        finish(room, { winner: 'draw', reason: 'agreement' }, now);
        env.send(conn, sysChat(room, '双方同意和棋', 'result'));
      } else {
        const g = toGame(room);
        const n = room.turn === p.by ? 2 : 1;
        g.undo(n);
        fromGame(room, g);
        room.status = 'playing';
        room.result = null;
        const last = room.moves.length ? room.moves[room.moves.length - 1] : null;
        room.lastMove = last ? { from: last.from, to: last.to } : null;
        room.turnStart = room.timeBase ? now : 0;
        env.send(conn, sysChat(room, '悔棋已确认，回到 ' + (room.turn === 'r' ? '红方' : '黑方') + ' 走棋', 'info'));
      }
      return true;
    }

    case 'rematch': {
      if (!conn.seat) { env.send(conn, { t: 'note', text: '观战不能开始新局' }); return false; }
      if (room.status === 'playing' && room.moves.length > 0) { env.send(conn, { t: 'note', text: '当前对局还没结束' }); return false; }
      if (room.rematchVotes.indexOf(conn.seat) < 0) room.rematchVotes.push(conn.seat);
      if (room.rematchVotes.length >= 2) {
        const rSeat = room.seats.r, bSeat = room.seats.b;
        room.seats.r = bSeat; room.seats.b = rSeat;
        const fresh = newRoom(room.code, room.timeBase, now);
        Object.assign(room, fresh, {
          seats: room.seats,
          chat: room.chat,
          spectators: room.spectators,
          createdAt: room.createdAt
        });
        env.send(conn, sysChat(room, '新的一局开始，双方交换先手，红先行', 'result'));
      } else {
        env.send(conn, sysChat(room, conn.name + ' 想再来一局，等对方确认', 'ask'));
      }
      return true;
    }

    case 'chat': {
      const text = String(msg.text || '').slice(0, 300).trim();
      if (!text) return false;
      room.chatSeq = (room.chatSeq || 0) + 1;
      room.chat.push({ t: 'chat', id: room.chatSeq, name: conn.name, seat: conn.seat, text, ts: Date.now() });
      if (room.chat.length > 200) room.chat.shift();
      return true;
    }

    case 'rename': {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        conn.name = msg.name.trim().slice(0, 12);
        if (conn.seat && room.seats[conn.seat]) room.seats[conn.seat].name = conn.name;
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

export { X };

