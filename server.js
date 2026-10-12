#!/usr/bin/env node
/*
 * 象棋对弈服务器 —— 零依赖（只用 Node 内置模块）
 * 用法： node server.js [--port 8080] [--host 0.0.0.0]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const X = require('./public/rules.js');

/* ---------------- 参数 ---------------- */

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return def;
}
const PORT = parseInt(process.env.PORT || argVal('port', '8080'), 10);
const HOST = argVal('host', '0.0.0.0');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- 静态文件 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: conns.size }));
    return;
  }
  serveStatic(req, res);
});

/* ---------------- 极简 WebSocket ---------------- */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const conns = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  addConnection(socket);
});

function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | op;
  return Buffer.concat([head, payload]);
}

function addConnection(socket) {
  const conn = {
    socket,
    buf: Buffer.alloc(0),
    frag: null,
    fragOp: 1,
    room: null,
    seat: null,
    name: '棋友',
    closed: false
  };
  conns.add(conn);

  function sendRaw(buf) {
    if (conn.closed) return;
    try { socket.write(buf); } catch (e) { /* ignore */ }
  }
  conn.send = (obj) => sendRaw(frame(1, Buffer.from(JSON.stringify(obj), 'utf8')));
  conn.ping = () => sendRaw(frame(9, Buffer.alloc(0)));
  conn.close = (code) => {
    if (conn.closed) return;
    conn.closed = true;
    try { sendRaw(frame(8, Buffer.from([(code >> 8) & 255, code & 255]))); } catch (e) { }
    socket.end();
  };

  socket.on('data', (chunk) => {
    conn.buf = Buffer.concat([conn.buf, chunk]);
    try { drain(conn); } catch (e) { conn.close(1011); }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    conn.closed = true;
    conns.delete(conn);
    onDisconnect(conn);
  });
}

function drain(conn) {
  const MAX = 256 * 1024;
  for (;;) {
    const b = conn.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      len = Number(b.readBigUInt64BE(2)); off = 10;
    }
    if (len > MAX) { conn.close(1009); return; }
    const mask = masked ? b.subarray(off, off + 4) : null;
    if (masked) off += 4;
    if (b.length < off + len) return;
    let payload = b.subarray(off, off + len);
    if (masked) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    conn.buf = b.subarray(off + len);

    if (op === 0x8) { conn.close(1000); return; }
    if (op === 0x9) { conn.socket.write(frame(10, payload)); continue; }
    if (op === 0xa) continue;
    if (op === 0x0) {
      if (!conn.frag) continue;
      conn.frag = Buffer.concat([conn.frag, payload]);
      if (fin) { const full = conn.frag; conn.frag = null; onMessage(conn, full); }
      continue;
    }
    if (!fin) { conn.fragOp = op; conn.frag = Buffer.from(payload); continue; }
    onMessage(conn, payload);
  }
}

/* ---------------- 房间与对局 ---------------- */

const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randCode() {
  let s = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
function randToken() { return crypto.randomBytes(12).toString('hex'); }

function createRoom(timeBase, wanted) {
  let code;
  if (wanted && /^[A-Z0-9]{4,8}$/.test(wanted) && !rooms.has(wanted)) code = wanted;
  else do { code = randCode(); } while (rooms.has(code));
  const room = {
    code,
    timeBase: timeBase > 0 ? timeBase : 0,
    seats: { r: null, b: null },
    spectators: new Set(),
    game: new X.Game(),
    chat: [],
    chatSeq: 0,
    clocks: { r: 0, b: 0 },
    turnStart: null,
    lastMove: null,
    pending: null,
    rematch: new Set(),
    result: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  if (room.timeBase) { room.clocks.r = room.clocks.b = room.timeBase; }
  rooms.set(code, room);
  return room;
}

function findSeatByToken(room, token) {
  if (!token) return null;
  if (room.seats.r && room.seats.r.token === token) return 'r';
  if (room.seats.b && room.seats.b.token === token) return 'b';
  return null;
}

function clockNow(room, side) {
  if (!room.timeBase) return 0;
  let t = room.clocks[side];
  if (room.game.status === 'playing' && room.turnStart && room.game.turn === side) {
    t -= Date.now() - room.turnStart;
  }
  return Math.max(0, t);
}

function publicState(room, conn) {
  const g = room.game;
  return {
    t: 'state',
    code: room.code,
    board: g.board.join(''),
    turn: g.turn,
    status: g.status,
    check: g.check,
    result: g.result,
    history: g.notations,
    moveCount: g.moves.length,
    lastMove: room.lastMove,
    seats: {
      r: room.seats.r ? { name: room.seats.r.name, online: !!room.seats.r.conn } : null,
      b: room.seats.b ? { name: room.seats.b.name, online: !!room.seats.b.conn } : null
    },
    you: conn.seat || null,
    spectating: !conn.seat,
    spectators: room.spectators.size,
    timeBase: room.timeBase,
    clocks: { r: clockNow(room, 'r'), b: clockNow(room, 'b') },
    pending: room.pending,
    rematchVotes: Array.from(room.rematch),
    chat: room.chat.slice(-40),
    started: !!(room.seats.r && room.seats.b)
  };
}

function broadcastState(room) {
  const members = [];
  for (const side of ['r', 'b']) if (room.seats[side] && room.seats[side].conn) members.push(room.seats[side].conn);
  room.spectators.forEach((c) => members.push(c));
  members.forEach((c) => c.send(publicState(room, c)));
}

function broadcastClocks(room) {
  if (!room.timeBase) return;
  const payload = { t: 'clocks', r: clockNow(room, 'r'), b: clockNow(room, 'b') };
  const members = [];
  for (const side of ['r', 'b']) if (room.seats[side] && room.seats[side].conn) members.push(room.seats[side].conn);
  room.spectators.forEach((c) => members.push(c));
  members.forEach((c) => c.send(payload));
}

function sysChat(room, text, kind) {
  room.chatSeq = (room.chatSeq || 0) + 1;
  const msg = { t: 'chat', id: room.chatSeq, name: '系统', text, ts: Date.now(), system: true, kind: kind || 'info' };
  room.chat.push(msg);
  if (room.chat.length > 200) room.chat.shift();
  const members = [];
  for (const side of ['r', 'b']) if (room.seats[side] && room.seats[side].conn) members.push(room.seats[side].conn);
  room.spectators.forEach((c) => members.push(c));
  members.forEach((c) => c.send(msg));
}

function sendChatHistory(conn, room) {
  room.chat.slice(-50).forEach((m) => conn.send(m));
}

function note(conn, text, kind) { conn.send({ t: 'note', text, kind: kind || 'error' }); }

function touch(room) { room.lastActivity = Date.now(); }

function finishGame(room, result) {
  if (room.timeBase && room.turnStart && room.game.status === 'playing') {
    const side = room.game.turn;
    room.clocks[side] = Math.max(0, room.clocks[side] - (Date.now() - room.turnStart));
  }
  room.game.status = 'over';
  room.game.result = result;
  room.result = result;
  room.pending = null;
  room.turnStart = null;
}

const REASON_TEXT = {
  checkmate: '绝杀',
  stalemate: '困毙',
  resign: '认输',
  timeout: '超时',
  agreement: '和棋（双方同意）',
  repetition: '三次重复局面',
  quiet: '60 回合无吃子'
};

function resultText(result) {
  if (!result) return '';
  const why = REASON_TEXT[result.reason] || result.reason;
  if (result.winner === 'draw') return '和棋 —— ' + why;
  return (result.winner === 'r' ? '红方胜' : '黑方胜') + ' —— ' + why;
}

function seatedConns(room) {
  return ['r', 'b'].map((s) => room.seats[s]).filter((s) => s && s.conn).map((s) => s.conn);
}

function applyMove(room, conn, from, to) {
  if (conn.seat !== room.game.turn) { note(conn, '还没轮到你走棋'); return; }
  const res = room.game.move(from, to);
  if (!res.ok) { note(conn, res.error); return; }

  if (room.timeBase) {
    // room.game.move() 已经把 turn 切给对方，所以刚走完的一方是 other(turn)
    if (room.turnStart) {
      const mover = X.other(room.game.turn);
      room.clocks[mover] = Math.max(0, room.clocks[mover] - (Date.now() - room.turnStart));
    }
    room.turnStart = res.status === 'playing' ? Date.now() : null;
  }
  room.lastMove = { from, to };
  room.pending = null;
  room.rematch.clear();
  touch(room);

  if (res.status === 'over') {
    room.turnStart = null;
    room.result = res.result;
    sysChat(room, resultText(res.result), 'result');
  } else if (res.check) {
    sysChat(room, (room.game.turn === 'r' ? '红方' : '黑方') + '被将军', 'check');
  }
  broadcastState(room);
}

function onMessage(conn, buf) {
  let msg;
  try { msg = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
  if (!msg || typeof msg.t !== 'string') return;
  const t = msg.t;

  if (t === 'hello') {
    if (typeof msg.name === 'string' && msg.name.trim()) conn.name = msg.name.trim().slice(0, 12);
    conn.send({ t: 'ready', name: conn.name });
    return;
  }

  if (t === 'create') {
    if (typeof msg.name === 'string' && msg.name.trim()) conn.name = msg.name.trim().slice(0, 12);
    // msg.timeBase 单位为分钟（0 = 不限时）
    const mins = Math.max(0, Math.min(180, Number(msg.timeBase) || 0));
    const tb = Math.round(mins * 60000);
    // 前端会先自己生成房间号（Cloudflare 版必须在连接前就知道房间号），这里沿用它
    const wanted = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = createRoom(tb, wanted);
    leaveRoom(conn);
    const token = randToken();
    room.seats.r = { token, name: conn.name, conn };
    conn.room = room; conn.seat = 'r';
    conn.send({ t: 'joined', code: room.code, seat: 'r', token, timeBase: room.timeBase });
    broadcastState(room);
    sysChat(room, conn.name + ' 开了一局' + (tb ? '（' + tb / 60000 + ' 分钟包干）' : '（不限时）'), 'info');
    return;
  }

  if (t === 'join') {
    if (typeof msg.name === 'string' && msg.name.trim()) conn.name = msg.name.trim().slice(0, 12);
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) { note(conn, '没找到房间 ' + code + '，检查一下房间号'); return; }
    leaveRoom(conn);
    conn.room = room;
    let seat = findSeatByToken(room, msg.token);
    if (!seat) {
      if (!room.seats.r) seat = 'r';
      else if (!room.seats.b) seat = 'b';
      // 座位主人断线后，允许新来的人坐下（否则房间会一直卡住）
      else if (!room.seats.r.conn) seat = 'r';
      else if (!room.seats.b.conn) seat = 'b';
    }
    if (seat) {
      const before = room.seats[seat];
      room.seats[seat] = { token: before ? before.token : randToken(), name: conn.name, conn };
      conn.seat = seat;
      conn.send({ t: 'joined', code: room.code, seat, token: room.seats[seat].token, timeBase: room.timeBase });
      // 同一个连接重复入座时不要关掉自己
      if (before && before.conn && before.conn !== conn) { try { before.conn.close(4001); } catch (e) { } }
      sysChat(room, conn.name + ' 已入座 ' + (seat === 'r' ? '红方' : '黑方'), 'info');
      if (room.seats.r && room.seats.b && room.game.moves.length === 0) {
        sysChat(room, '双方就位，红先行', 'info');
      }
    } else {
      room.spectators.add(conn);
      conn.seat = null;
      conn.send({ t: 'joined', code: room.code, seat: null, spectating: true, timeBase: room.timeBase });
      sysChat(room, conn.name + ' 进入观战', 'info');
    }
    touch(room);
    conn.send(publicState(room, conn));
    sendChatHistory(conn, room);
    broadcastState(room);
    return;
  }

  const room = conn.room;
  if (!room) { note(conn, '请先创建或加入房间'); return; }

  switch (t) {
    case 'sync':
      conn.send(publicState(room, conn));
      sendChatHistory(conn, room);
      return;

    case 'sit': {
      if (conn.seat) { note(conn, '你已经在座位上了'); return; }
      const want = msg.seat === 'r' || msg.seat === 'b' ? msg.seat : null;
      const target = want && !room.seats[want] ? want : (!room.seats.r ? 'r' : (!room.seats.b ? 'b' : null));
      if (!target) { note(conn, '座位已满，先观战吧'); return; }
      room.spectators.delete(conn);
      room.seats[target] = { token: randToken(), name: conn.name, conn };
      conn.seat = target;
      conn.send({ t: 'joined', code: room.code, seat: target, token: room.seats[target].token, timeBase: room.timeBase });
      sysChat(room, conn.name + ' 入座 ' + (target === 'r' ? '红方' : '黑方'), 'info');
      broadcastState(room);
      return;
    }

    case 'move':
      if (!conn.seat) { note(conn, '观战不能走棋'); return; }
      if (!room.seats.r || !room.seats.b) { note(conn, '等对手入座后再走棋'); return; }
      applyMove(room, conn, msg.from | 0, msg.to | 0);
      return;

    case 'resign': {
      if (!conn.seat || room.game.status !== 'playing') return;
      finishGame(room, { winner: X.other(conn.seat), reason: 'resign' });
      sysChat(room, conn.name + ' 认输 —— ' + resultText(room.game.result), 'result');
      broadcastState(room);
      return;
    }

    case 'draw':
    case 'undo': {
      if (!conn.seat || room.game.status !== 'playing') { note(conn, '对局未在进行中'); return; }
      if (!room.seats.r || !room.seats.b) { note(conn, '等对手入座'); return; }
      if (room.pending && room.pending.by !== conn.seat) { note(conn, '等对方先答复上一个请求'); return; }
      if (t === 'undo' && room.game.moves.length === 0) { note(conn, '还没走棋'); return; }
      room.pending = { kind: t, by: conn.seat };
      sysChat(room, conn.name + (t === 'draw' ? ' 提议和棋' : ' 请求悔棋'), 'ask');
      broadcastState(room);
      return;
    }

    case 'reply': {
      const p = room.pending;
      if (!p) return;
      if (conn.seat === p.by) { note(conn, '要等对方答复'); return; }
      if (!conn.seat) { note(conn, '观战不能裁决'); return; }
      room.pending = null;
      if (!msg.accept) {
        sysChat(room, conn.name + ' 拒绝了' + (p.kind === 'draw' ? '和棋' : '悔棋'), 'info');
        broadcastState(room);
        return;
      }
      if (p.kind === 'draw') {
        finishGame(room, { winner: 'draw', reason: 'agreement' });
        sysChat(room, '双方同意和棋', 'result');
      } else {
        const n = room.game.turn === p.by ? 2 : 1;
        room.game.undo(n);
        room.lastMove = room.game.moves.length ? { from: room.game.moves[room.game.moves.length - 1].from, to: room.game.moves[room.game.moves.length - 1].to } : null;
        room.turnStart = room.timeBase ? Date.now() : null;
        room.result = null;
        sysChat(room, '悔棋已确认，回到 ' + (room.game.turn === 'r' ? '红方' : '黑方') + ' 走棋', 'info');
      }
      broadcastState(room);
      return;
    }

    case 'rematch': {
      if (!conn.seat) { note(conn, '观战不能开始新局'); return; }
      if (room.game.status === 'playing' && room.game.moves.length > 0) { note(conn, '当前对局还没结束'); return; }
      room.rematch.add(conn.seat);
      if (room.rematch.size >= 2) {
        startRematch(room);
      } else {
        sysChat(room, conn.name + ' 想再来一局，等对方确认', 'ask');
        broadcastState(room);
      }
      return;
    }

    case 'chat': {
      const text = String(msg.text || '').slice(0, 300).trim();
      if (!text) return;
      room.chatSeq = (room.chatSeq || 0) + 1;
      const m = { t: 'chat', id: room.chatSeq, name: conn.name, seat: conn.seat, text, ts: Date.now() };
      room.chat.push(m);
      if (room.chat.length > 200) room.chat.shift();
      const members = seatedConns(room).concat(Array.from(room.spectators));
      members.forEach((c) => c.send(m));
      touch(room);
      return;
    }

    case 'rename': {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        conn.name = msg.name.trim().slice(0, 12);
        if (conn.seat && room.seats[conn.seat]) room.seats[conn.seat].name = conn.name;
        broadcastState(room);
      }
      return;
    }
  }
}

function startRematch(room) {
  const rSeat = room.seats.r, bSeat = room.seats.b;
  room.seats.r = bSeat ? Object.assign({}, bSeat) : null;
  room.seats.b = rSeat ? Object.assign({}, rSeat) : null;
  if (room.seats.r) room.seats.r.conn.seat = 'r';
  if (room.seats.b) room.seats.b.conn.seat = 'b';
  room.game = new X.Game();
  room.clocks.r = room.clocks.b = room.timeBase;
  room.turnStart = null;
  room.lastMove = null;
  room.pending = null;
  room.rematch.clear();
  room.result = null;
  sysChat(room, '新的一局开始，双方交换先手，红先行', 'result');
  broadcastState(room);
}

function leaveRoom(conn) {
  const room = conn.room;
  if (!room) return;
  if (conn.seat && room.seats[conn.seat] && room.seats[conn.seat].conn === conn) {
    room.seats[conn.seat].conn = null;
    sysChat(room, conn.name + ' 暂时离开', 'info');
  } else if (room.spectators.has(conn)) {
    room.spectators.delete(conn);
  }
  conn.room = null;
  conn.seat = null;
  broadcastState(room);
}

function onDisconnect(conn) {
  leaveRoom(conn);
}

/* ---------------- 计时 ---------------- */

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.game.status === 'playing' && room.timeBase && room.turnStart) {
      const side = room.game.turn;
      const remain = clockNow(room, side);
      if (remain <= 0) {
        const loser = side;
        room.clocks[loser] = 0;
        finishGame(room, { winner: X.other(loser), reason: 'timeout' });
        sysChat(room, (loser === 'r' ? '红方' : '黑方') + '超时 —— ' + resultText(room.game.result), 'result');
        broadcastState(room);
      } else {
        broadcastClocks(room);
      }
    }
    // 清理：无人连接且闲置 3 小时以上
    const someone = !!(room.seats.r && room.seats.r.conn) || !!(room.seats.b && room.seats.b.conn) || room.spectators.size > 0;
    if (!someone && now - room.lastActivity > 3 * 3600 * 1000) rooms.delete(code);
  }
}, 700);

// 心跳
setInterval(() => {
  conns.forEach((c) => {
    if (c.closed) return;
    try { c.ping(); } catch (e) { }
  });
}, 25000);

/* ---------------- 启动 ---------------- */

server.listen(PORT, HOST, () => {
  const lines = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) lines.push('  http://' + ni.address + ':' + PORT);
    }
  }
  console.log('\n  象棋对弈服务器已启动');
  console.log('  本机打开：   http://localhost:' + PORT);
  if (lines.length) console.log('  同一Wi-Fi的电脑/手机打开：\n' + lines.join('\n'));
  console.log('\n  创建房间后把房间号或邀请链接发给朋友即可。Ctrl+C 停止。\n');
});

process.on('SIGINT', () => { console.log('\n已停止。'); process.exit(0); });
