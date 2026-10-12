/*
 * Cloudflare Workers 版后端的回归测试。
 *
 * 我的开发环境装不了 wrangler（沙箱没有 TLS 出网），所以这里直接驱动
 * cloudflare/room.js（Durable Object 用的那份纯逻辑），把线上会走的流程全跑一遍：
 * 入座 / 走子 / 规则拦截 / 悔棋 / 和棋 / 换先 / 观战 / 认输 / 超时 / 计时。
 */
import { newRoom, handleMessage, publicState, checkTimeout, nextDeadline, clockNow, reconcileSeats } from '../cloudflare/room.js';
import X from '../cloudflare/rules-bridge.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const idx = X.idx;

class Sim {
  constructor(timeBase) {
    this.clock = 1_000_000;
    this.room = newRoom('TEST01', timeBase || 0, this.clock);
    this.conns = [];
  }
  env() {
    return { now: () => this.clock, send: (c, o) => c.send(o), broadcast: () => { } };
  }
  add(name) {
    const c = {
      name: name || '棋友', seat: null, token: null, inbox: [], state: null,
      send(o) { this.inbox.push(o); }
    };
    this.conns.push(c);
    return c;
  }
  join(name, token) {
    const c = this.add(name);
    this.send(c, { t: 'join', code: 'TEST01', name, token: token || null });
    return c;
  }
  send(c, msg) {
    const changed = handleMessage(this.room, c, msg, this.env());
    if (changed) this.sync();
    return changed;
  }
  sync() {
    reconcileSeats(this.room, this.conns);   // 和 Durable Object 的广播前对齐保持一致
    for (const c of this.conns) c.state = publicState(this.room, c, this.clock);
  }
  tick(ms) { this.clock += ms; }
  note(c) { return c.inbox.filter((m) => m.t === 'note').map((m) => m.text).join(' | '); }
  chats() { return this.room.chat.map((m) => m.text); }
}

console.log('\n[1] 桥接与规则引擎');
check('rules-bridge 在 Node 下拿到引擎', !!(X && X.Game && X.START), typeof X);
check('开局着法数 44', X.legalMoves(X.START, 'r').length === 44, X.legalMoves(X.START, 'r').length);

console.log('\n[2] 入座与观战');
{
  const s = new Sim(0);
  const a = s.join('小明');
  check('第一个进房间的坐红方', a.seat === 'r', a.seat);
  check('收到 joined 与 token', a.inbox.some((m) => m.t === 'joined' && m.seat === 'r' && m.token), a.inbox.map((m) => m.t));
  const b = s.join('小红');
  check('第二个坐黑方', b.seat === 'b', b.seat);
  check('双方就位后 started 为真', b.state.started === true);
  const c = s.join('旁观者');
  check('第三人是观战身份', c.seat === null && c.state.spectating === true);
  check('观战人数 = 1', c.state.spectators === 1, c.state.spectators);
  check('观战走子被拒绝', s.send(c, { t: 'move', from: idx(0, 9), to: idx(0, 8) }) === false && /观战/.test(s.note(c)));
}

console.log('\n[3] 走子与规则');
{
  const s = new Sim(0);
  const a = s.join('小明');
  const b = s.join('小红');
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  check('红方炮二平五后棋盘同步', b.state.board[idx(4, 7)] === 'C' && b.state.board[idx(7, 7)] === '.');
  check('记谱为 炮二平五', b.state.history[0] === '炮二平五', b.state.history);
  check('轮到黑方', b.state.turn === 'b');
  check('lastMove 用于高亮', b.state.lastMove && b.state.lastMove.from === idx(7, 7));

  b.inbox.length = 0;
  s.send(b, { t: 'move', from: idx(4, 7), to: idx(4, 8) });
  check('黑方不能动红子', /还没轮到/.test(s.note(b)), s.note(b));
  s.send(b, { t: 'move', from: idx(1, 2), to: idx(5, 5) });
  check('非法着法被拦下', /不合规则/.test(s.note(b)), s.note(b));
  s.send(b, { t: 'move', from: idx(1, 2), to: idx(4, 2) });
  check('黑方炮2平5成功', a.state.history[1] === '炮2平5', a.state.history);
}

console.log('\n[4] 悔棋');
{
  const s = new Sim(0);
  const a = s.join('小明');
  const b = s.join('小红');
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  s.send(b, { t: 'move', from: idx(1, 2), to: idx(4, 2) });
  s.send(a, { t: 'undo' });
  check('悔棋请求挂起', a.state.pending && a.state.pending.kind === 'undo' && a.state.pending.by === 'r');
  s.send(b, { t: 'reply', accept: true });
  check('同意后回到开局', a.state.board === X.START, a.state.board.slice(0, 20));
  check('回到红方走棋', a.state.turn === 'r' && a.state.moveCount === 0);
}

console.log('\n[5] 和棋');
{
  const s = new Sim(0);
  const a = s.join('小明');
  const b = s.join('小红');
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  s.send(b, { t: 'draw' });
  s.send(a, { t: 'reply', accept: false });
  check('拒绝和棋后继续', a.state.status === 'playing' && a.state.pending === null);
  s.send(b, { t: 'draw' });
  s.send(a, { t: 'reply', accept: true });
  check('同意后判和', a.state.status === 'over' && a.state.result.winner === 'draw' && a.state.result.reason === 'agreement', a.state.result);
}

console.log('\n[6] 认输与再来一局（交换先手）');
{
  const s = new Sim(0);
  const a = s.join('小明');
  const b = s.join('小红');
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  s.send(b, { t: 'resign' });
  check('认输判对方胜', a.state.result.winner === 'r' && a.state.result.reason === 'resign', a.state.result);
  s.send(a, { t: 'rematch' });
  check('一人确认不开新局', a.state.status === 'over' && a.state.rematchVotes.length === 1);
  s.send(b, { t: 'rematch' });
  check('两人确认后开新局', a.state.status === 'playing' && a.state.moveCount === 0, a.state.status);
  check('红黑互换', a.state.you === 'b' && b.state.you === 'r' && a.state.seats.r.name === '小红', { aYou: a.state.you, r: a.state.seats.r });
  a.inbox.length = 0;
  s.send(a, { t: 'move', from: idx(1, 2), to: idx(4, 2) });
  check('换先后原红方不能再抢走', /还没轮到/.test(s.note(a)), s.note(a));
  s.send(b, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  check('新红方正常走子', a.state.history[0] === '炮二平五', a.state.history);
}

console.log('\n[7] 计时与超时');
{
  const s = new Sim(60_000);
  const a = s.join('小明');
  const b = s.join('小红');
  check('初始各剩 60 秒', a.state.clocks.r === 60_000 && a.state.clocks.b === 60_000, a.state.clocks);
  s.tick(5_000);
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  check('红方用掉 5 秒', Math.abs(a.state.clocks.r - 55_000) < 5, a.state.clocks.r);
  check('黑方未计时', a.state.clocks.b === 60_000, a.state.clocks.b);
  s.tick(10_000);
  check('clockNow 反映当前回合', Math.abs(clockNow(s.room, 'b', s.clock) - 50_000) < 5, clockNow(s.room, 'b', s.clock));
  const dl = nextDeadline(s.room, s.clock);
  check('给了超时唤醒时刻（含 150ms 余量）', dl > s.clock && dl - s.clock <= 50_250, dl - s.clock);
  s.tick(50_100);
  const fired = checkTimeout(s.room, s.clock);
  check('到点判黑方超时', fired === true && s.room.result.winner === 'r' && s.room.result.reason === 'timeout', s.room.result);
  s.sync();
  check('超时后状态广播为结束', a.state.status === 'over' && a.state.turn === 'b');
}

console.log('\n[7b] 建房时带来的用时（Cloudflare 版曾经漏掉）');
{
  const s = new Sim(0);                       // DO 新建时 timeBase=0
  const a = s.add('小明');
  s.send(a, { t: 'create', code: 'TEST01', name: '小明', timeBase: 10 });   // 客户端带 10 分钟
  check('房间采用了客户端选的用时', s.room.timeBase === 600000, s.room.timeBase);
  check('双方时钟初始化', a.state.clocks.r === 600000 && a.state.clocks.b === 600000, a.state.clocks);
  const b = s.join('小红');
  check('对手入座后仍是我选的用时', b.state.timeBase === 600000, b.state.timeBase);
  s.tick(3000);
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });
  check('走一步后红方被扣 3 秒', Math.abs(b.state.clocks.r - 597000) < 5, b.state.clocks.r);
  check('黑方仍未计时', b.state.clocks.b === 600000, b.state.clocks.b);
  check('给出了超时唤醒时刻', nextDeadline(s.room, s.clock) > s.clock);
}

console.log('\n[8] 断线重连与座位接管');
{
  const s = new Sim(0);
  const a = s.join('小明');
  const b = s.join('小红');
  const tokenB = b.token;
  // 模拟连接关闭
  s.room.seats.b.online = false;
  const b2 = s.join('小红', tokenB);
  check('凭 token 回到原座位', b2.seat === 'b' && b2.state.you === 'b', b2.seat);
  check('重连后棋盘一致', b2.state.board === a.state.board);
  // 座位主人不在时，新人可以坐下
  s.room.seats.r.online = false;
  const d = s.join('新来的');
  check('空出来的座位能被接管', d.seat === 'r', d.seat);
}

console.log('\n[9] 将帅照面与绝杀（端到端）');
{
  const s = new Sim(0);
  const a = s.join('小明');
  const b = s.join('小红');
  s.send(a, { t: 'move', from: idx(7, 7), to: idx(4, 7) });   // 炮二平五
  s.send(b, { t: 'move', from: idx(5, 0), to: idx(4, 1) });   // 士5进4
  s.send(a, { t: 'move', from: idx(4, 7), to: idx(4, 3) });   // 炮五进四，吃卒将军
  check('将军被标记', a.state.check === true, a.state.check);
  check('聊天里播报将军', s.chats().some((t) => /被将军/.test(t)), s.chats().slice(-3));
  check('黑方有解着', X.legalMoves(a.state.board, 'b').length > 0);
}

console.log('\n' + (fail ? '❌ 通过 ' + pass + ' 项，失败 ' + fail + ' 项' : '✅ 全部通过（' + pass + ' 项）'));
process.exit(fail ? 1 : 0);
