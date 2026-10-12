/*
 * Durable Object 级别的测试：直接实例化 cloudflare/worker.js 里的 RoomDO，
 * 用伪造的 state / WebSocket 跑一遍，验证"消息确实发给了房间里每个人"。
 *
 * 这个用例是有来历的：线上曾经出现"聊天谁都看不到"的 bug —— 因为 DO 只广播棋局状态，
 * 而聊天只写进了房间状态，没人转发。以前只测 room.js，所以漏掉了这条路径。
 */
import { RoomDO } from '../cloudflare/worker.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

class FakeWS {
  constructor() { this.sent = []; this.att = null; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
  of(type, filter) {
    return this.sent.filter((m) => m.t === type && (!filter || filter(m)));
  }
}
class FakeStorage {
  constructor() { this.map = new Map(); this.alarm = 0; }
  async get(k) { return this.map.get(k); }
  async put(k, v) { this.map.set(k, JSON.parse(JSON.stringify(v))); }
  async getAlarm() { return this.alarm || null; }
  async setAlarm(t) { this.alarm = t; }
  async deleteAlarm() { this.alarm = 0; }
}
class FakeState {
  constructor(code) { this.storage = new FakeStorage(); this.sockets = []; this.id = { name: code }; }
  acceptWebSocket(ws) { this.sockets.push(ws); }
  getWebSockets() { return this.sockets.slice(); }
}

const send = (doo, ws, obj) => doo.webSocketMessage(ws, JSON.stringify(obj));

(async () => {
  const state = new FakeState('TEST01');
  const doo = new RoomDO(state, {});
  const a = new FakeWS(), b = new FakeWS();
  state.acceptWebSocket(a);
  state.acceptWebSocket(b);

  console.log('\n[1] 入座');
  await send(doo, a, { t: 'join', code: 'TEST01', name: '小明' });
  await send(doo, b, { t: 'join', code: 'TEST01', name: '小红' });
  check('两人都拿到座位', a.of('joined').length === 1 && b.of('joined').length === 1);
  check('a 是红方 b 是黑方', a.of('joined')[0].seat === 'r' && b.of('joined')[0].seat === 'b');
  check('入座消息双方都能看到', a.of('chat', (m) => /小明 已入座/.test(m.text)).length >= 1
    && b.of('chat', (m) => /小明 已入座/.test(m.text)).length >= 1);

  console.log('\n[2] 聊天（这次线上就是这里丢消息）');
  a.sent.length = 0; b.sent.length = 0;
  await send(doo, a, { t: 'chat', text: '你好，看得到吗' });
  const gotA = a.of('chat', (m) => m.text === '你好，看得到吗');
  const gotB = b.of('chat', (m) => m.text === '你好，看得到吗');
  check('说话的人自己能看到', gotA.length === 1, gotA.length);
  check('对手也能看到', gotB.length === 1, gotB.length);
  check('消息带 id（客户端靠它去重）', gotA[0] && gotA[0].id > 0, gotA[0] && gotA[0].id);
  const st = a.of('state')[a.of('state').length - 1];
  check('状态里也带聊天记录（进房能补历史）', !!(st && st.chat && st.chat.some((m) => m.text === '你好，看得到吗')));

  console.log('\n[3] 走子 / 系统播报也要双方都能看到');
  a.sent.length = 0; b.sent.length = 0;
  await send(doo, a, { t: 'move', from: 70, to: 67 });          // 炮二平五
  check('a 端棋盘同步', a.of('state').length >= 1);
  check('b 端棋盘同步', b.of('state').length >= 1);
  const lastB = b.of('state')[b.of('state').length - 1];
  check('b 看到红方走了炮二平五', lastB.history[0] === '炮二平五', lastB.history);

  console.log('\n[4] 请求与结果是双方可见的（弹窗要靠它）');
  a.sent.length = 0; b.sent.length = 0;
  await send(doo, b, { t: 'draw' });
  const pendB = b.of('state')[b.of('state').length - 1];
  check('b 看到自己发起的请求', pendB.pending && pendB.pending.by === 'b');
  check('a 也看到这个请求（会弹窗）', a.of('state').some((m) => m.pending && m.pending.by === 'b'));
  await send(doo, a, { t: 'reply', accept: true });
  check('和棋结果双方都收到', a.of('state').some((m) => m.status === 'over' && m.result.winner === 'draw')
    && b.of('state').some((m) => m.status === 'over' && m.result.winner === 'draw'));

  console.log('\n[5] 断线重连（座位按 token 认人）');
  const tokenB = b.att && b.att.token;
  check('b 的连接上有 token', !!tokenB);
  const b2 = new FakeWS();
  state.acceptWebSocket(b2);
  await send(doo, b2, { t: 'join', code: 'TEST01', name: '小红', token: tokenB });
  check('凭 token 回到黑方座位', b2.of('joined')[0].seat === 'b', b2.of('joined')[0]);

  console.log('\n[6] 状态持久化（休眠唤醒后不丢房间）');
  const saved = await state.storage.get('room');
  check('房间里存了快照', !!saved && !!saved.board);
  const doo2 = new RoomDO(state, {});
  const fresh = await doo2.room();
  check('新实例能从存储里恢复', fresh.board === saved.board && fresh.seats.b && fresh.seats.b.name === '小红');

  console.log('\n' + (fail ? '❌ 通过 ' + pass + ' 项，失败 ' + fail + ' 项' : '✅ 全部通过（' + pass + ' 项）'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常: ' + e.message + '\n' + e.stack); process.exit(1); });
