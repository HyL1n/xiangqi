// 用标准 perft 数据校验象棋着法生成器
const X = require('../public/rules.js');

function perft(board, side, depth) {
  if (depth === 0) return 1;
  const moves = X.legalMoves(board, side);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const nb = board.slice();
    nb[m.to] = nb[m.from];
    nb[m.from] = '.';
    n += perft(nb, X.other(side), depth - 1);
  }
  return n;
}

const board = X.START.split('');
const expected = { 1: 44, 2: 1920, 3: 79666, 4: 3290240 };
let pass = true;
for (const d of [1, 2, 3, 4]) {
  const t = Date.now();
  const got = perft(board, 'r', d);
  const ok = got === expected[d];
  if (!ok) pass = false;
  console.log(`perft(${d}) = ${got}  期望 ${expected[d]}  ${ok ? '✓' : '✗'}  (${Date.now() - t}ms)`);
}

// 记谱抽查
const g = new X.Game();
const seq = [
  [X.idx(7, 7), X.idx(4, 7)],  // 炮二平五
  [X.idx(1, 2), X.idx(4, 2)],  // 炮2平5
  [X.idx(7, 9), X.idx(6, 7)],  // 马二进三
  [X.idx(1, 0), X.idx(2, 2)],  // 马2进3
  [X.idx(8, 9), X.idx(8, 8)],  // 车一进一
  [X.idx(0, 0), X.idx(0, 1)],  // 车1进1
  [X.idx(1, 9), X.idx(2, 7)],  // 马八进七
  [X.idx(4, 0), X.idx(4, 1)],  // 将5进1
  [X.idx(0, 6), X.idx(0, 5)],  // 兵九进一
  [X.idx(6, 3), X.idx(6, 4)],  // 卒7进1
  [X.idx(0, 5), X.idx(0, 4)],  // 兵九进一
  [X.idx(6, 4), X.idx(6, 5)],  // 卒7进1
  [X.idx(0, 4), X.idx(1, 4)],  // 兵九平八（过河后横走）
  [X.idx(6, 5), X.idx(5, 5)],  // 卒7平6（过河后横走）
];
const want = ['炮二平五', '炮2平5', '马二进三', '马2进3', '车一进一', '车1进1', '马八进七',
  '将5进1', '兵九进一', '卒7进1', '兵九进一', '卒7进1', '兵九平八', '卒7平6'];
seq.forEach((mv, i) => {
  const r = g.move(mv[0], mv[1]);
  const ok = r.ok && r.notation === want[i];
  if (!ok) pass = false;
  console.log(`${i + 1}. ${r.ok ? r.notation : '失败: ' + r.error}  期望 ${want[i]}  ${ok ? '✓' : '✗'}`);
});

// 回合与将军
console.log('轮到(应为黑 b):', g.turn);

// 将帅照面：黑将在 x=4，红帅在 x=4 同一纵线 → 红方任何走法都不能留下照面局面
const b2 = '....k....' + '.........'.repeat(8) + '....K....';
const gm = new X.Game();
gm.board = b2.split('');
gm.turn = 'r';
const moves = X.legalMoves(gm.board, 'r');
console.log('照面局面红方着法数:', moves.length, moves.length > 0 ? '(不应包含帅五进一等照面走法，下一步将校验)' : '');
const all = moves.map(m => X.notation(gm.board, m.from, m.to)).join(' ');
console.log('着法:', all);

// 简单绝杀局面校验
const mate = new X.Game();
const rows = [
  '....k....',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.R.......',
  'R...K....'
];
mate.board = rows.join('').split('');
mate.turn = 'b';
console.log('黑将被攻击(应为 true):', X.isKingAttacked(mate.board, 'b'));
console.log('黑方着法:', X.legalMoves(mate.board, 'b').map(m => X.notation(mate.board, m.from, m.to)).join(' ') || '(无)');

// 回归测试：以字符串形式传入棋盘（前端通过网络收到的就是字符串）
console.log('\n字符串棋盘回归测试');
const sMoves = X.legalMoves(X.START, 'r');
console.log('字符串开局着法数:', sMoves.length, sMoves.length === 44 ? '✓' : '✗');
if (sMoves.length !== 44) pass = false;
const sFrom = X.movesFrom(X.START, 'r', X.idx(7, 7));
// 二路炮：4 进 + 1 退 + 6 平 + 1 翻山吃马（炮二进七）= 12
console.log('字符串取单子着法(二路炮应为 12):', sFrom.length, sFrom.length === 12 ? '✓' : '✗');
if (sFrom.length !== 12) pass = false;
const jumpMove = sFrom.some((m) => X.notation(X.START, m.from, m.to) === '炮二进七');
console.log('含翻山吃马 炮二进七:', jumpMove ? '✓' : '✗');
if (!jumpMove) pass = false;

/* ---------- 长将 / 长捉 / 普通重复局面 ----------
 * 规则：循环着法里如果某一方"全是将军"或"全是捉吃无根子"，属于禁止着法，判该方负；
 * 双方都没违规（比如都在闲着、或者互相长兑）才是和棋。
 */
function boardOf(list) {                  // 'rR4,3' = 红车放在 (4,3)
  const b = new Array(90).fill('.');
  for (const s of list) {
    const side = s[0], type = s[1];
    const [x, y] = s.slice(2).split(',').map(Number);
    b[X.idx(x, y)] = side === 'r' ? type.toUpperCase() : type.toLowerCase();
  }
  return b.join('');
}
function playAll(game, seq) {
  for (const [fx, fy, tx, ty] of seq) {
    const r = game.move(X.idx(fx, fy), X.idx(tx, ty));
    if (!r.ok) throw new Error('测试着法非法：' + X.idx(fx, fy) + '→' + X.idx(tx, ty) + ' ' + r.error);
  }
  return game;
}
function expectEq(name, got, want) {
  const ok = got === want;
  if (!ok) pass = false;
  console.log(`  ${ok ? '✓' : '✗'} ${name}（得到 ${got}，期望 ${want}）`);
}

console.log('\n[长将 / 长捉 / 重复局面]');
{
  // 红车在 4 路和 3 路之间来回将军，黑将只能跟着走 → 判红方负
  const g = new X.Game(boardOf(['rR4,3', 'rK5,9', 'bK3,0']));
  for (let i = 0; i < 2; i++) playAll(g, [[4, 3, 3, 3], [3, 0, 4, 0], [3, 3, 4, 3], [4, 0, 3, 0]]);
  console.log('  ' + g.status + ' ' + JSON.stringify(g.result));
  expectEq('长将 → 判红方负', g.result && g.result.winner, 'b');
  expectEq('长将原因', g.result && g.result.reason, 'perpetual-check');
}
{
  // 红车追着黑方一个无根马跑，反复捉吃 → 判红方负
  const g = new X.Game(boardOf(['rR0,7', 'rK5,9', 'bN4,5', 'bK4,0']));
  for (let i = 0; i < 2; i++) playAll(g, [[0, 7, 0, 5], [4, 5, 3, 7], [0, 5, 0, 7], [3, 7, 4, 5]]);
  console.log('  ' + g.status + ' ' + JSON.stringify(g.result));
  expectEq('长捉 → 判红方负', g.result && g.result.winner, 'b');
  expectEq('长捉原因', g.result && g.result.reason, 'perpetual-chase');
}
{
  // 双方都在闲着（没将军也没捉子）→ 还是和棋
  const g = new X.Game(boardOf(['rR0,5', 'rK3,9', 'bK4,0']));
  for (let i = 0; i < 2; i++) playAll(g, [[0, 5, 1, 5], [4, 0, 5, 0], [1, 5, 0, 5], [5, 0, 4, 0]]);
  console.log('  ' + g.status + ' ' + JSON.stringify(g.result));
  expectEq('普通重复局面 → 和棋', g.result && g.result.winner, 'draw');
  expectEq('和棋原因', g.result && g.result.reason, 'repetition');
}
{
  // 红车来回"追"黑炮，但那个炮有根（黑车守着）→ 不算长捉，仍判和
  const g = new X.Game(boardOf(['rR0,5', 'rK5,8', 'bC4,7', 'bR4,9', 'bK4,0']));
  for (let i = 0; i < 2; i++) playAll(g, [[0, 5, 0, 7], [4, 7, 4, 5], [0, 7, 0, 5], [4, 5, 4, 7]]);
  console.log('  ' + g.status + ' ' + JSON.stringify(g.result));
  expectEq('追有根子不算长捉 → 和棋', g.result && g.result.winner, 'draw');
  expectEq('和棋原因', g.result && g.result.reason, 'repetition');
}
{
  // 两车对着互相吃（被捉的一方随时能吃回来，算吃子解围）→ 也不算长捉
  const g = new X.Game(boardOf(['rR0,6', 'rK3,8', 'bR4,5', 'bK4,0']));
  for (let i = 0; i < 2; i++) playAll(g, [[0, 6, 0, 5], [4, 5, 4, 6], [0, 5, 0, 6], [4, 6, 4, 5]]);
  console.log('  ' + g.status + ' ' + JSON.stringify(g.result));
  expectEq('能反吃回来不算长捉 → 和棋', g.result && g.result.winner, 'draw');
  expectEq('和棋原因', g.result && g.result.reason, 'repetition');
}

console.log(pass ? '\n全部通过 ✅' : '\n存在失败 ❌');
process.exit(pass ? 0 : 1);
