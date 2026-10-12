// 端到端测试：建房 / 入座 / 走子 / 非法拦截 / 悔棋 / 和棋 / 再来一局 / 观战 / 重连
// 说明：用 Node 内置的 WebSocket 客户端，需要 Node 22+（服务端本身 Node 18+ 就能跑）
if (typeof WebSocket === 'undefined') {
  console.log('当前 Node 没有内置 WebSocket 客户端（需 22+），跳过端到端测试。');
  process.exit(0);
}
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8099;
const URL = 'ws://127.0.0.1:' + PORT + '/ws';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Client {
  constructor(tag) {
    this.tag = tag;
    this.msgs = [];
    this.state = null;
    this.seat = null;
    this.code = null;
    this.token = null;
    this.notes = [];
    this.chats = [];
  }
  async open() {
    this.ws = new WebSocket(URL);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      this.msgs.push(m);
      if (m.t === 'state') this.state = m;
      if (m.t === 'joined') { this.seat = m.seat; this.code = m.code; if (m.token) this.token = m.token; }
      if (m.t === 'note') this.notes.push(m.text);
      if (m.t === 'chat') this.chats.push(m);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch (e) { } }
  async wait(pred, label, timeout = 2500) {
    const t0 = Date.now();
    for (;;) {
      for (const m of this.msgs) if (pred(m)) return m;
      if (Date.now() - t0 > timeout) throw new Error(this.tag + ' 超时等待: ' + label);
      await sleep(20);
    }
  }
  clear() { this.msgs = []; this.notes = []; }
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'pipe' });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', (d) => console.log('[server] ' + d.toString().trim()));
  await sleep(700);

  const A = new Client('A'), B = new Client('B');
  await A.open(); await B.open();
  A.send({ t: 'hello', name: '小明' });

  console.log('\n[1] 建房 & 入座');
  A.send({ t: 'create', name: '小明', timeBase: 10 });
  await A.wait(m => m.t === 'joined', 'A joined');
  check('A 拿到房间号与红方座位', /^[A-Z0-9]{4}$/.test(A.code) && A.seat === 'r', A.code);

  B.send({ t: 'join', code: A.code, name: '小红' });
  await B.wait(m => m.t === 'joined', 'B joined');
  check('B 自动入座黑方', B.seat === 'b', B.seat);
  await A.wait(m => m.t === 'state' && m.seats.b, 'A 看到对手');
  check('A 看到双方姓名', A.state.seats.r.name === '小明' && A.state.seats.b.name === '小红');
  check('限时设置生效（10 分钟）', A.state.timeBase === 10 * 60000, A.state.timeBase);

  console.log('\n[2] 走子与规则');
  const X = require('../public/rules.js');
  A.clear(); B.clear();
  A.send({ t: 'move', from: X.idx(7, 7), to: X.idx(4, 7) });      // 炮二平五
  await B.wait(m => m.t === 'state' && m.moveCount === 1, 'B 收到第一步');
  check('B 端棋盘同步', B.state.board[X.idx(4, 7)] === 'C' && B.state.board[X.idx(7, 7)] === '.');
  check('轮到黑方', B.state.turn === 'b');
  check('记录记谱为 炮二平五', B.state.history[0] === '炮二平五', B.state.history);
  check('上次着法用于高亮', B.state.lastMove && B.state.lastMove.from === X.idx(7, 7));

  B.send({ t: 'move', from: X.idx(7, 7), to: X.idx(4, 7) });      // 黑方没这步
  await B.wait(m => m.t === 'note', 'B 收到错误提示');
  check('非法/越权走子被拦下', B.state.moveCount === 1, B.notes);

  B.clear();
  B.send({ t: 'move', from: X.idx(4, 7), to: X.idx(4, 8) });      // 红子，黑方不能动
  await B.wait(m => m.t === 'note', '轮次校验');
  check('轮次校验生效', B.state.moveCount === 1);

  B.clear();
  B.send({ t: 'move', from: X.idx(1, 2), to: X.idx(4, 2) });      // 炮2平5
  await A.wait(m => m.t === 'state' && m.moveCount === 2, '黑方走子');
  check('黑方记谱 炮2平5', A.state.history[1] === '炮2平5', A.state.history);

  console.log('\n[3] 悔棋');
  A.clear(); B.clear();
  A.send({ t: 'undo' });
  await B.wait(m => m.t === 'state' && m.pending && m.pending.kind === 'undo', 'B 收到悔棋请求');
  check('悔棋请求带发起方', B.state.pending.by === 'r');
  B.send({ t: 'reply', accept: true });
  await A.wait(m => m.t === 'state' && !m.pending && m.moveCount === 0, '悔棋完成');
  check('棋盘回到开局', A.state.board === X.START);
  check('回到红方走棋', A.state.turn === 'r');

  console.log('\n[4] 和棋与再来一局');
  A.clear(); B.clear();
  B.send({ t: 'draw' });
  await A.wait(m => m.t === 'state' && m.pending && m.pending.kind === 'draw', 'A 收到和棋请求');
  A.send({ t: 'reply', accept: false });
  await B.wait(m => m.t === 'state' && !m.pending, '拒绝和棋');
  check('拒绝后对局继续', B.state.status === 'playing');

  A.clear(); B.clear();
  B.send({ t: 'draw' });
  await A.wait(m => m.t === 'state' && m.pending, '再次求和');
  A.send({ t: 'reply', accept: true });
  await A.wait(m => m.t === 'state' && m.status === 'over', '和棋结束');
  check('结果为和棋', A.state.result.winner === 'draw' && A.state.result.reason === 'agreement', A.state.result);

  A.clear(); B.clear();
  A.send({ t: 'rematch' });
  await sleep(150);
  check('单人请求不立即开局', A.state.status === 'over');
  B.send({ t: 'rematch' });
  await A.wait(m => m.t === 'state' && m.status === 'playing' && m.moveCount === 0, '新局开始');
  check('再来一局并交换先手', A.state.you === 'b' && A.state.seats.r.name === '小红', { you: A.state.you, r: A.state.seats.r });
  A.clear();
  A.send({ t: 'move', from: X.idx(1, 2), to: X.idx(4, 2) });
  await A.wait(m => m.t === 'note', '黑方抢走被拦下');
  check('换先后不能抢走（红方是小红）', A.state.moveCount === 0 && A.state.turn === 'r', A.state.moveCount);
  B.clear(); A.clear();
  B.send({ t: 'move', from: X.idx(7, 7), to: X.idx(4, 7) });   // 新红方小红 炮二平五
  await A.wait(m => m.t === 'state' && m.moveCount === 1, '新红方走子');
  check('新红方正常走子', A.state.turn === 'b' && A.state.history[0] === '炮二平五', A.state.history);

  console.log('\n[5] 观战与重连');
  const C = new Client('C');
  await C.open();
  C.send({ t: 'join', code: A.code, name: '旁观者' });
  await C.wait(m => m.t === 'joined', 'C joined');
  check('第三人是观战身份', C.seat === null && C.state.spectating === true);
  C.clear();
  C.send({ t: 'move', from: X.idx(0, 9), to: X.idx(0, 8) });
  await C.wait(m => m.t === 'note', '观战不能走棋');
  check('观战走子被拒绝', C.notes.length === 1);

  const tokenB = B.token, codeA = A.code;
  B.close();
  await sleep(200);
  const B2 = new Client('B2');
  await B2.open();
  B2.send({ t: 'join', code: codeA, name: '小红', token: tokenB });
  await B2.wait(m => m.t === 'joined', 'B2 joined');
  // 换先后小红执红，token 跟着人走
  check('断线后用 token 回到自己的座位', B2.seat === 'r' && B2.state.you === 'r', B2.seat);
  check('重连后棋盘一致', B2.state.board === A.state.board);

  console.log('\n[6] 认输与绝杀提示');
  B2.clear(); A.clear();
  B2.send({ t: 'resign' });
  await A.wait(m => m.t === 'state' && m.status === 'over', '认输结束');
  check('红方认输判黑胜', A.state.result.winner === 'b' && A.state.result.reason === 'resign', A.state.result);

  A.close(); B2.close(); C.close();
  await sleep(200);
  srv.kill();
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项 ' + (fail ? '❌' : '✅'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常: ' + e.message); process.exit(1); });
