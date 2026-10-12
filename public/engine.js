/*!
 * 象棋 AI：纯 JS 引擎（浏览器 / Node 共用）
 *
 * 为什么不用皮卡鱼：皮卡鱼是 C++ 子进程（UCI），Cloudflare Workers 不能跑原生程序，
 * 而 WASM 版带 NNUE 权重几十 MB、手机吃不消。这里手写一个轻量引擎：
 *   - 完全在浏览器里算，算完当成一次普通走子发给服务器（服务端仍然权威校验）
 *   - 带时间预算的迭代加深，保证不会卡住界面
 *   - 强度大致"业余棋友"，可以调难度陪练
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.XiangqiEngine = factory(root.Xiangqi);
})(typeof self !== 'undefined' ? self : globalThis, function (X) {
  'use strict';

  var MATE = 50000;
  var VAL = { K: 0, R: 900, N: 400, C: 450, A: 200, B: 200, P: 100 };

  function makePST(fn) {
    var a = new Array(90);
    for (var y = 0; y < 10; y++) for (var x = 0; x < 9; x++) a[y * 9 + x] = fn(x, y);
    return a;
  }
  // 位置价值（红方视角：y 越小越接近对方底线）
  var PST = {
    P: makePST(function (x, y) { var adv = 9 - y; return adv * 4 + (adv > 4 ? 12 : 0) + (x > 0 && x < 8 ? 4 : 0); }),
    // 马：鼓励出马、占中路
    N: makePST(function (x, y) { return (9 - y) * 3 + (x >= 3 && x <= 5 ? 16 : (x >= 2 && x <= 6 ? 8 : 0)) + (y < 9 ? 6 : 0); }),
    // 炮：强烈偏好中路（中炮），其次二/八路
    C: makePST(function (x, y) { var c = (x >= 3 && x <= 5) ? 20 : (x >= 2 && x <= 6 ? 8 : 0); return c + (y <= 3 ? 10 : 0); }),
    R: makePST(function (x, y) { return (y <= 6 ? 10 : 0) + (x > 1 && x < 7 ? 6 : 0); }),
    A: makePST(function () { return 0; }),
    B: makePST(function () { return 0; }),
    K: makePST(function (x, y) { return y >= 8 ? 0 : -10; })
  };

  var b = null;          // 当前搜索用的可变棋盘
  var nodes = 0;
  var deadline = 0;
  var timedOut = false;

  /* ---- Zobrist 哈希 + 置换表 + 杀手着法/历史启发（这三样比单纯加时间有效得多） ---- */
  var ZOB = [];
  (function () {
    var seed = 0x2f6e2b1;
    function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
    for (var i = 0; i < 90; i++) {
      ZOB[i] = {};
      var chars = 'KABNRCPkabnrcp';
      for (var j = 0; j < chars.length; j++) ZOB[i][chars[j]] = rnd();
    }
  })();
  var hash = 0;
  var tt = new Map();
  var killers = [];
  var history = null;

  function hashBoard() {
    hash = 0;
    for (var i = 0; i < 90; i++) { var c = b[i]; if (c !== '.') hash ^= ZOB[i][c]; }
  }

  function idx(x, y) { return y * 9 + x; }
  function sideOf(ch) { return ch >= 'A' && ch <= 'Z' ? 'r' : 'b'; }
  function typeOf(ch) { return ch.toUpperCase(); }
  function other(s) { return s === 'r' ? 'b' : 'r'; }

  function findKing(side) {
    var t = side === 'r' ? 'K' : 'k';
    for (var i = 0; i < 90; i++) if (b[i] === t) return i;
    return -1;
  }

  // 走一步（返回被吃子），同时维护 Zobrist 哈希
  function make(m) {
    var cap = b[m[1]], pc = b[m[0]];
    hash ^= ZOB[m[0]][pc];
    if (cap !== '.') hash ^= ZOB[m[1]][cap];
    hash ^= ZOB[m[1]][pc];
    b[m[1]] = pc; b[m[0]] = '.';
    return cap;
  }
  function unmake(m, cap) {
    var pc = b[m[1]];
    hash ^= ZOB[m[1]][pc];
    b[m[0]] = pc; b[m[1]] = cap;
    hash ^= ZOB[m[0]][pc];
    if (cap !== '.') hash ^= ZOB[m[1]][cap];
  }

  // 自己将帅是否安全（含飞将）
  function kingSafe(side) {
    var k = findKing(side);
    if (k < 0) return false;
    return !X.isAttacked(b, k % 9, (k - k % 9) / 9, other(side));
  }

  /*
   * 生成合法着法：就地 make/unmake，不复制整盘（快很多）。
   * 注意每个着法必须是新数组 —— 早期版本为了省分配复用了数组对象，
   * 结果 slice 出来的列表共享同一批数组，被后续搜索改写，返回过非法着法。
   */
  function genLegal(side) {
    var out = [];
    for (var i = 0; i < 90; i++) {
      var ch = b[i];
      if (ch === '.' || sideOf(ch) !== side) continue;
      var tos = X.pseudoMoves(b, i);
      for (var j = 0; j < tos.length; j++) {
        var m = [i, tos[j]];
        var cap = make(m);
        if (kingSafe(side)) out.push(m);
        unmake(m, cap);
      }
    }
    return out;
  }

  function evaluate(side) {
    var s = 0;
    for (var i = 0; i < 90; i++) {
      var ch = b[i];
      if (ch === '.') continue;
      var t = typeOf(ch);
      if (t === 'K') continue;
      var v = VAL[t] + PST[t][sideOf(ch) === 'r' ? i : (9 - ((i - i % 9) / 9)) * 9 + (i % 9)];
      s += sideOf(ch) === 'r' ? v : -v;
    }
    return side === 'r' ? s : -s;
  }

  function scoreMove(m) {
    var cap = b[m[1]];
    if (cap === '.') return 0;
    return VAL[typeOf(cap)] * 10 - VAL[typeOf(b[m[0]])];
  }

  var SIDE_KEY = 0x9e3779b9;
  var qDepth = 3;

  // 静态搜索：只往吃子方向延伸，避免"看着不亏其实被吃"
  function quiesce(side, alpha, beta, depth) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) { timedOut = true; return alpha; }
    var stand = evaluate(side);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha;

    var moves = genLegal(side).filter(function (m) { return b[m[1]] !== '.'; });
    moves.sort(function (p, q) { return scoreMove(q) - scoreMove(p); });
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var cap = make(m);
      var v = -quiesce(other(side), -beta, -alpha, depth - 1);
      unmake(m, cap);
      if (timedOut) return alpha;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function negamax(side, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) { timedOut = true; return alpha; }

    var alphaOrig = alpha;
    var key = hash ^ (side === 'b' ? SIDE_KEY : 0);
    var e = tt.get(key);
    var ttMove = null;
    if (e) {
      ttMove = e.move;
      if (e.depth >= depth) {
        var sc = e.score;
        if (sc > MATE - 1000) sc -= ply;
        else if (sc < -MATE + 1000) sc += ply;
        if (e.flag === 0) return sc;
        if (e.flag === 1 && sc >= beta) return sc;
        if (e.flag === 2 && sc <= alpha) return sc;
      }
    }

    if (depth <= 0) return quiesce(side, alpha, beta, qDepth);

    var moves = genLegal(side);
    if (!moves.length) return -MATE + ply;          // 将死或困毙都算输

    var kp = killers[ply];
    var k1 = kp ? kp[0] : null, k2 = kp ? kp[1] : null;
    function ord(m) {
      if (ttMove && m[0] === ttMove[0] && m[1] === ttMove[1]) return 1e9;
      var cap = b[m[1]];
      if (cap !== '.') return 1e6 + VAL[typeOf(cap)] * 10 - VAL[typeOf(b[m[0]])];
      if (k1 && m[0] === k1[0] && m[1] === k1[1]) return 9e5;
      if (k2 && m[0] === k2[0] && m[1] === k2[1]) return 8e5;
      return history[m[0] * 90 + m[1]];
    }
    moves.sort(function (p, q) { return ord(q) - ord(p); });

    var best = moves[0], bestScore = -Infinity, quietCut = false;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], cap = make(m);
      var v = -negamax(other(side), depth - 1, -beta, -alpha, ply + 1);
      unmake(m, cap);
      if (timedOut) return alpha;
      if (v > bestScore) { bestScore = v; best = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (cap === '.') {                     // 只把"安静着法"当杀手
          killers[ply] = killers[ply] || [];
          if (!killers[ply][0] || killers[ply][0][0] !== m[0] || killers[ply][0][1] !== m[1]) {
            killers[ply][1] = killers[ply][0];
            killers[ply][0] = m;
          }
          history[m[0] * 90 + m[1]] += depth * depth;
        }
        break;
      }
    }

    var flag = bestScore <= alphaOrig ? 2 : (bestScore >= beta ? 1 : 0);
    var store = bestScore;
    if (store > MATE - 1000) store += ply;
    else if (store < -MATE + 1000) store -= ply;
    if (tt.size > 400000) tt.clear();
    tt.set(key, { depth: depth, score: store, flag: flag, move: best });
    return bestScore;
  }

  function rootSearch(side, depth, firstMove) {
    var moves = genLegal(side);
    if (!moves.length) return { move: null, score: -MATE, moves: moves };
    moves.sort(function (p, q) { return scoreMove(q) - scoreMove(p); });
    if (firstMove) {
      var k = -1;
      for (var i = 0; i < moves.length; i++) if (moves[i][0] === firstMove[0] && moves[i][1] === firstMove[1]) k = i;
      if (k > 0) { var t = moves[0]; moves[0] = moves[k]; moves[k] = t; }
    }
    var best = moves[0], bestScore = -Infinity;
    var scored = [];
    for (var j = 0; j < moves.length; j++) {
      var m = moves[j], cap = make(m);
      var v = -negamax(other(side), depth - 1, -Infinity, Infinity, 1);
      unmake(m, cap);
      if (timedOut) break;
      scored.push({ m: m, v: v });
      if (v > bestScore) { bestScore = v; best = m; }
    }
    return { move: best, score: bestScore, moves: scored };
  }

  /*
   * 找一步棋。
   * board: 90 字符串；side: 'r'|'b'
   * opts: { timeMs, depth, random }  —— random 是"简单档"用的随机性（在接近最优的着法里挑）
   */
  function findMove(board, side, opts) {
    opts = opts || {};
    b = String(board).split('');
    nodes = 0; timedOut = false;
    deadline = Date.now() + (opts.timeMs || 400);
    var maxDepth = opts.depth || 4;
    qDepth = opts.quiesce || 3;
    killers = [];
    history = new Int32Array(90 * 90);
    if (qDepth !== findMove._q) { tt.clear(); findMove._q = qDepth; }   // 静态搜索深度变了，旧表不能用
    hashBoard();
    var best = null, bestScore = 0, lastScored = null;

    for (var d = 1; d <= maxDepth; d++) {
      var r = rootSearch(side, d, best);
      if (timedOut) break;
      best = r.move; bestScore = r.score;
      if (opts.random && r.moves && r.moves.length > 1) lastScored = r.moves;
      if (Math.abs(bestScore) > MATE - 100) break;      // 已经能杀
    }

    // 简单档：在与最优差距不大的着法里随机挑一个，别总走同一步
    if (opts.random && lastScored && lastScored.length > 1) {
      var pool = lastScored.filter(function (e) { return e.v >= bestScore - opts.random; });
      if (pool.length) {
        var pick = pool[Math.floor(Math.random() * pool.length)];
        best = pick.m; bestScore = pick.v;
      }
    }
    // 时间太紧，第一层都没算完：随便走一步合法的，别卡住
    if (!best) {
      var any = genLegal(side);
      if (any.length) best = any[Math.floor(Math.random() * any.length)];
    }
    return { move: best, score: bestScore, nodes: nodes, tt: tt.size, board: b.join('') };
  }

  var LEVELS = {
    easy: { timeMs: 120, depth: 2, quiesce: 2, random: 90 },
    normal: { timeMs: 600, depth: 4, quiesce: 3 },
    hard: { timeMs: 3000, depth: 8, quiesce: 5 }        // 最强档：时间/深度都给足
  };

  return {
    findMove: findMove,
    levels: LEVELS,
    evaluate: function (board, side) { b = String(board).split(''); return evaluate(side); },
    _debug: function (board, side, opts) { return findMove(board, side, opts); }
  };
});
