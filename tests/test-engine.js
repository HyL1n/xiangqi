/*
 * AI 引擎测试：验证它算得对、走得合法、不会超时卡住。
 * 引擎在浏览器里跑，但它是纯 JS（依赖 rules.js），所以能直接在 Node 里测。
 */
const X = require('../public/rules.js');
const E = require('../public/engine.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const idx = X.idx;

function boardOf(rows) { return rows.join(''); }
function isLegal(board, side, mv) {
  return X.legalMoves(board, side).some((m) => m.from === mv[0] && m.to === mv[1]);
}
function notationOf(board, mv) {
  if (!mv || !isLegal(board, X.sideOf(board[mv[0]]), mv)) return '(非法)';
  return X.notation(board, mv[0], mv[1]);
}

console.log('\n[1] 一步吃子：该吃掉白送的“车”');
{
  // 黑方无保护的车放在红车正前方，红方下一步应该吃它
  const board = boardOf([
    '....k....',
    '.........',
    '....r....',      // 黑车（无保护）
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '....R....',      // 红车
    '....K....'
  ]);
  const r = E.findMove(board, 'r', { timeMs: 800, depth: 3 });
  check('返回值是合法着法', !!r.move && isLegal(board, 'r', r.move), r.move);
  check('选择吃掉黑车', r.move && r.move[1] === idx(4, 2), r.move && notationOf(board, r.move));
}

console.log('\n[2] 不吃亏：不应该把车送到对方兵口上');
{
  const board = boardOf([
    '....k....',
    '.........',
    '.........',
    '....p....',      // 黑卒守着 (4,4)
    '.........',
    '.........',
    '.........',
    '.........',
    'R........',      // 红车在底线
    '....K....'
  ]);
  const r = E.findMove(board, 'r', { timeMs: 900, depth: 3 });
  check('返回合法着法', !!r.move && isLegal(board, 'r', r.move), r.move);
  check('没有把车平到卒口（车四进四那种送子）', !(r.move && r.move[1] === idx(4, 3)), r.move && notationOf(board, r.move));
}

console.log('\n[3] 一步绝杀：双车错（黑将 (4,0)，红车在 (5,1) 已封住 (5,0) 与 (4,1)）');
{
  const board = boardOf([
    '....k....',      // 黑将 (4,0)
    '.....R...',      // 红车 B (5,1)：封住 (5,0) 和 (4,1)
    '.........',
    '.........',
    '.........',
    '..R......',      // 红车 A (2,5)：下一步沉底到 (2,0) 将军并封住 (3,0)
    '.........',
    '.........',
    '.........',
    'K........'       // 红帅 (0,9)：放远一点，避免飞将规则干扰这个局面
  ]);
  // 先确认这局面本身合法：黑方还有 (3,0) 可走，不是已经被将死
  check('前提：黑方当前还有着法（局面合法）', X.legalMoves(board, 'b').length > 0, X.legalMoves(board, 'b').length);
  const r = E.findMove(board, 'r', { timeMs: 2000, depth: 4 });
  check('返回合法着法', !!r.move && isLegal(board, 'r', r.move), r.move && notationOf(board, r.move));
  // 把引擎这一步放上去，看黑方是不是真的没棋了 —— 这才是"真绝杀"
  let mated = false;
  if (r.move) {
    const nb = board.split('');
    nb[r.move[1]] = nb[r.move[0]];
    nb[r.move[0]] = '.';
    mated = X.legalMoves(nb.join(''), 'b').length === 0;
  }
  check('走出的是绝杀（黑方无棋可走）', mated, r.move && notationOf(board, r.move));
}

console.log('\n[4] 时间预算：不能超时太多');
{
  const board = X.START;
  const t0 = Date.now();
  const r = E.findMove(board, 'r', { timeMs: 200, depth: 4 });
  const used = Date.now() - t0;
  check('200ms 预算下用时 < 900ms', used < 900, used + 'ms');
  check('开局也给出合法着法', !!r.move && isLegal(board, 'r', r.move), r.move && notationOf(board, r.move));
  console.log('    （用时 ' + used + 'ms，搜索 ' + r.nodes + ' 个节点）');
}

console.log('\n[5] 三档难度都能走、且难度越高节点越多');
{
  const board = X.START;
  const res = {};
  ['easy', 'normal', 'hard'].forEach((lv) => {
    const cfg = E.levels[lv];
    const t0 = Date.now();
    const r = E.findMove(board, 'r', cfg);
    res[lv] = { nodes: r.nodes, ms: Date.now() - t0, ok: !!r.move && isLegal(board, 'r', r.move) };
  });
  check('简单档能走', res.easy.ok, res.easy);
  check('普通档能走', res.normal.ok, res.normal);
  check('困难档能走', res.hard.ok, res.hard);
  check('困难档搜索量 >= 简单档', res.hard.nodes >= res.easy.nodes, res);
  console.log('    ' + JSON.stringify(res));
}

console.log('\n[6] 黑方也要能走（视角反转没写错）');
{
  const board = boardOf([
    '....k....',
    '.........',
    '....c....',      // 黑炮
    '.........',
    '.........',
    '.........',
    '.........',
    '....C....',      // 红炮
    '.........',
    '....K....'
  ]);
  const r = E.findMove(board, 'b', { timeMs: 500, depth: 3 });
  check('黑方返回合法着法', !!r.move && isLegal(board, 'b', r.move), r.move && notationOf(board, r.move));
}

console.log('\n' + (fail ? '❌ 通过 ' + pass + ' 项，失败 ' + fail + ' 项' : '✅ 全部通过（' + pass + ' 项）'));
process.exit(fail ? 1 : 0);
