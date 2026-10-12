/*!
 * 象棋规则引擎（浏览器 / Node 共用）
 * 棋盘坐标：x = 0..8（左→右），y = 0..9（上→下）
 * 黑方在上（y 小），红方在下（y 大）
 * 棋盘用长度 90 的字符串表示，'.' 为空；大写=红，小写=黑
 *   K=帅/将  A=仕/士  B=相/象  N=马  R=车  C=炮  P=兵/卒
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Xiangqi = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var W = 9, H = 10, SIZE = 90;
  var START = [
    'rnbakabnr',
    '.........',
    '.c.....c.',
    'p.p.p.p.p',
    '.........',
    '.........',
    'P.P.P.P.P',
    '.C.....C.',
    '.........',
    'RNBAKABNR'
  ].join('');

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var NAME = {
    K: { r: '帅', b: '将' },
    A: { r: '仕', b: '士' },
    B: { r: '相', b: '象' },
    N: { r: '马', b: '马' },
    R: { r: '车', b: '车' },
    C: { r: '炮', b: '炮' },
    P: { r: '兵', b: '卒' }
  };

  function idx(x, y) { return y * 9 + x; }
  function xOf(i) { return i % 9; }
  function yOf(i) { return (i - (i % 9)) / 9; }
  function inBoard(x, y) { return x >= 0 && x < 9 && y >= 0 && y < 10; }
  function sideOf(ch) { return ch >= 'A' && ch <= 'Z' ? 'r' : 'b'; }
  function typeOf(ch) { return ch.toUpperCase(); }
  function other(side) { return side === 'r' ? 'b' : 'r'; }
  function inPalace(x, y, side) {
    if (x < 3 || x > 5) return false;
    return side === 'r' ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }
  function toBoard(str) { return String(str).split(''); }
  // 棋盘可能是数组（内部）或字符串（网络传输），统一取一份可写的副本
  function cloneBoard(b) { return Array.isArray(b) ? b.slice() : String(b).split(''); }

  var ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  /* ---------- 攻击判定 ---------- */

  // (tx,ty) 是否被 bySide 方攻击
  function isAttacked(board, tx, ty, bySide) {
    var i, d, x, y, c, first, second, s, t, nx, ny, leg;

    // 车 / 炮 / 将帅照面
    for (i = 0; i < 4; i++) {
      d = ORTHO[i];
      x = tx + d[0]; y = ty + d[1]; first = null;
      while (inBoard(x, y)) {
        c = board[idx(x, y)];
        if (c !== '.') { first = { x: x, y: y, c: c }; break; }
        x += d[0]; y += d[1];
      }
      if (!first) continue;
      s = sideOf(first.c); t = typeOf(first.c);
      if (s === bySide && t === 'R') return true;
      // 将帅照面（纵向第一个子就是对方将/帅）
      if (t === 'K' && d[0] === 0) return true;
      // 炮：隔一个子
      x = first.x + d[0]; y = first.y + d[1]; second = null;
      while (inBoard(x, y)) {
        c = board[idx(x, y)];
        if (c !== '.') { second = c; break; }
        x += d[0]; y += d[1];
      }
      if (second && typeOf(second) === 'C' && sideOf(second) === bySide) return true;
    }

    // 马（蹩腿）
    for (i = 0; i < 8; i++) {
      nx = tx + KNIGHT[i][0]; ny = ty + KNIGHT[i][1];
      if (!inBoard(nx, ny)) continue;
      c = board[idx(nx, ny)];
      if (c === '.' || sideOf(c) !== bySide || typeOf(c) !== 'N') continue;
      if (Math.abs(KNIGHT[i][0]) === 2) leg = [nx - KNIGHT[i][0] / 2, ny];
      else leg = [nx, ny - KNIGHT[i][1] / 2];
      if (board[idx(leg[0], leg[1])] === '.') return true;
    }

    // 兵 / 卒
    var ps = bySide === 'r' ? 'P' : 'p';
    if (bySide === 'r') {
      if (inBoard(tx, ty + 1) && board[idx(tx, ty + 1)] === ps) return true;          // 直前
      if (ty <= 4) {                                                                   // 过河后可横吃
        if (inBoard(tx - 1, ty) && board[idx(tx - 1, ty)] === ps) return true;
        if (inBoard(tx + 1, ty) && board[idx(tx + 1, ty)] === ps) return true;
      }
    } else {
      if (inBoard(tx, ty - 1) && board[idx(tx, ty - 1)] === ps) return true;
      if (ty >= 5) {
        if (inBoard(tx - 1, ty) && board[idx(tx - 1, ty)] === ps) return true;
        if (inBoard(tx + 1, ty) && board[idx(tx + 1, ty)] === ps) return true;
      }
    }

    // 对方将/帅贴身
    var ks = bySide === 'r' ? 'K' : 'k';
    for (i = 0; i < 4; i++) {
      x = tx + ORTHO[i][0]; y = ty + ORTHO[i][1];
      if (inBoard(x, y) && board[idx(x, y)] === ks) return true;
    }
    return false;
  }

  function findKing(board, side) {
    var target = side === 'r' ? 'K' : 'k';
    for (var i = 0; i < SIZE; i++) if (board[i] === target) return i;
    return -1;
  }

  function isKingAttacked(board, side) {
    var k = findKing(board, side);
    if (k < 0) return true;
    return isAttacked(board, xOf(k), yOf(k), other(side));
  }

  /* ---------- 着法生成 ---------- */

  function pseudoMoves(board, from) {
    var ch = board[from], out = [];
    if (!ch || ch === '.') return out;
    var side = sideOf(ch), t = typeOf(ch);
    var x = xOf(from), y = yOf(from), i, d, nx, ny, c, k, leg;

    function own(xx, yy) {
      c = board[idx(xx, yy)];
      return c !== '.' && sideOf(c) === side;
    }
    function push(xx, yy) {
      if (inBoard(xx, yy) && !own(xx, yy)) out.push(idx(xx, yy));
    }

    if (t === 'R' || t === 'C') {
      var slide = t === 'R';
      for (i = 0; i < 4; i++) {
        d = ORTHO[i]; nx = x + d[0]; ny = y + d[1];
        if (slide) {
          while (inBoard(nx, ny)) {
            c = board[idx(nx, ny)];
            if (c === '.') { out.push(idx(nx, ny)); }
            else { if (sideOf(c) !== side) out.push(idx(nx, ny)); break; }
            nx += d[0]; ny += d[1];
          }
        } else {
          while (inBoard(nx, ny) && board[idx(nx, ny)] === '.') { out.push(idx(nx, ny)); nx += d[0]; ny += d[1]; }
          // 炮架
          if (inBoard(nx, ny)) {
            nx += d[0]; ny += d[1];
            while (inBoard(nx, ny)) {
              c = board[idx(nx, ny)];
              if (c !== '.') { if (sideOf(c) !== side) out.push(idx(nx, ny)); break; }
              nx += d[0]; ny += d[1];
            }
          }
        }
      }
      return out;
    }

    if (t === 'N') {
      for (i = 0; i < 8; i++) {
        d = KNIGHT[i]; nx = x + d[0]; ny = y + d[1];
        if (Math.abs(d[0]) === 2) leg = [x + d[0] / 2, y];
        else leg = [x, y + d[1] / 2];
        if (board[idx(leg[0], leg[1])] !== '.') continue;   // 蹩马腿
        push(nx, ny);
      }
      return out;
    }

    if (t === 'B') {
      for (i = 0; i < 4; i++) {
        d = DIAG[i]; nx = x + d[0] * 2; ny = y + d[1] * 2;
        if (!inBoard(nx, ny)) continue;
        if (board[idx(x + d[0], y + d[1])] !== '.') continue;   // 塞象眼
        if (side === 'r' ? ny < 5 : ny > 4) continue;           // 象不过河
        push(nx, ny);
      }
      return out;
    }

    if (t === 'A') {
      for (i = 0; i < 4; i++) {
        d = DIAG[i]; nx = x + d[0]; ny = y + d[1];
        if (!inPalace(nx, ny, side)) continue;
        push(nx, ny);
      }
      return out;
    }

    if (t === 'K') {
      for (i = 0; i < 4; i++) {
        d = ORTHO[i]; nx = x + d[0]; ny = y + d[1];
        if (!inPalace(nx, ny, side)) continue;
        push(nx, ny);
      }
      return out;
    }

    if (t === 'P') {
      var fy = side === 'r' ? y - 1 : y + 1;
      push(x, fy);
      var crossed = side === 'r' ? y <= 4 : y >= 5;
      if (crossed) { push(x - 1, y); push(x + 1, y); }
      return out;
    }

    return out;
  }

  // 全部合法着法 [{from,to}, ...]
  function legalMoves(board, side) {
    var res = [], i, j, moves, nb, ch;
    for (i = 0; i < SIZE; i++) {
      ch = board[i];
      if (ch === '.' || sideOf(ch) !== side) continue;
      moves = pseudoMoves(board, i);
      for (j = 0; j < moves.length; j++) {
        nb = cloneBoard(board);
        nb[moves[j]] = ch;
        nb[i] = '.';
        if (!isKingAttacked(nb, side)) res.push({ from: i, to: moves[j] });
      }
    }
    return res;
  }

  /*
   * ---------- 长将 / 长捉 ----------
   *
   * 中国象棋的重复局面规则：循环里如果某一方"长将""长捉""一将一捉"，都算禁止着法，
   * 判这一方负；双方都不违规（比如互相长兑、长跟、长拦）才是和棋。
   *
   * 这里用一个够用的近似来判"捉"：走完这一步之后，下一手能吃掉的、确实有便宜的子
   * （对方无根，或者换子划算）。将被将军算"将"不算"捉"，兵/卒不当被捉对象（跟着规则走）。
   */
  var CHASE_VAL = { K: 100, R: 9, C: 4.5, N: 4, A: 2, B: 2, P: 1 };

  /*
   * 该方有没有子能真走到这个格子上（用来判断被捉的子是不是"无根"）。
   * 两个地方要注意：
   *   1) 不能用 isAttacked：它把将帅照面也算成"攻击"，但将帅走不出宫、根本回不来吃子，
   *      那样会把一堆无根子误判成有根；
   *   2) 判断前先把格子上的自己人挪开（换成对方一个兵），否则躲在被捉子后面的车/炮
   *      会因为"路被自己人挡住"而算不出保护，长捉就永远判不出来（踩过这个坑）。
   */
  function canRecapture(board, sq, side) {
    var nb = cloneBoard(board);
    nb[sq] = side === 'r' ? 'p' : 'P';
    for (var i = 0; i < SIZE; i++) {
      var ch = nb[i];
      if (ch === '.' || sideOf(ch) !== side) continue;
      var ps = pseudoMoves(nb, i);
      for (var j = 0; j < ps.length; j++) if (ps[j] === sq) return true;
    }
    return false;
  }

  function chaseTargets(board, side) {
    var ms = legalMoves(board, side), out = [], i, j;
    var foeMoves = null;
    for (i = 0; i < ms.length; i++) {
      var to = ms[i].to, from = ms[i].from;
      var target = board[to];
      if (target === '.') continue;
      var tt = typeOf(target);
      if (tt === 'K' || tt === 'P') continue;
      // 有根（能用别的子吃回来）、而且换子还不划算 → 不算捉
      var defended = canRecapture(board, to, sideOf(target));
      if (defended && !(CHASE_VAL[tt] > CHASE_VAL[typeOf(board[from])])) continue;
      // 被捉的子自己能吃掉这个攻击子（吃子解围）→ 也不算捉
      if (foeMoves === null) foeMoves = legalMoves(board, sideOf(target));
      var canEscape = false;
      for (j = 0; j < foeMoves.length; j++) {
        if (foeMoves[j].from === to && foeMoves[j].to === from) { canEscape = true; break; }
      }
      if (canEscape) continue;
      out.push(to);
    }
    return out;
  }

  // 回到重复局面时，翻出循环里双方的着法，判断谁违规
  function repetitionJudge(game) {
    var states = [], i;
    for (i = 0; i < game.snapshots.length; i++) {
      states.push(game.snapshots[i].board + game.snapshots[i].turn);
    }
    states.push(game.board.join('') + game.turn);

    var key = states[states.length - 1], hits = [];
    for (i = 0; i < states.length; i++) if (states[i] === key) hits.push(i);
    if (hits.length < 3) return { winner: 'draw', reason: 'repetition' };

    // 最后一轮循环 = 第 from 步到第 to-1 步（from/to 是同一局面两端的下标）
    var from = hits[hits.length - 2], to = hits[hits.length - 1];
    var agg = { r: { check: 0, chase: 0, idle: 0 }, b: { check: 0, chase: 0, idle: 0 } };
    for (i = from; i < to && i < game.moves.length; i++) {
      var mv = game.moves[i];
      var after = (i + 1 < states.length) ? toBoard(states[i + 1].slice(0, 90)) : game.board;
      var mover = sideOf(mv.piece);
      var gaveCheck = isKingAttacked(after, other(mover));
      var gaveChase = !gaveCheck && chaseTargets(after, mover).length > 0;
      agg[mover][gaveCheck ? 'check' : (gaveChase ? 'chase' : 'idle')]++;
    }

    function offence(side) {
      var a = agg[side];
      if (a.check + a.chase === 0 || a.idle > 0) return '';
      if (a.check > 0 && a.chase === 0) return 'perpetual-check';   // 长将
      if (a.chase > 0 && a.check === 0) return 'perpetual-chase';   // 长捉
      return 'perpetual';                                          // 一将一捉
    }
    var rBad = offence('r'), bBad = offence('b');
    if (rBad && !bBad) return { winner: 'b', reason: rBad };
    if (bBad && !rBad) return { winner: 'r', reason: bBad };
    return { winner: 'draw', reason: 'repetition' };   // 双方都违规 / 都不违规 → 和
  }

  function movesFrom(board, side, from) {
    return legalMoves(board, side).filter(function (m) { return m.from === from; });
  }

  /* ---------- 中文记谱 ---------- */

  // 官方约定：红方用汉字数字，黑方用阿拉伯数字，各自从本方右侧数 1..9
  function fileNum(x, side) { return side === 'r' ? 9 - x : x + 1; }
  function numWord(n, side) { return side === 'r' ? CN_NUM[n - 1] : String(n); }
  function fileWord(x, side) { return numWord(fileNum(x, side), side); }
  function stepWord(n, side) { return numWord(n, side); }

  function notation(board, from, to) {
    var ch = board[from], side = sideOf(ch), t = typeOf(ch);
    var fx = xOf(from), fy = yOf(from), tx = xOf(to), ty = yOf(to);
    var forward = side === 'r' ? ty < fy : ty > fy;
    var name;

    // 同一纵线上有同种棋子 → 前 / 中 / 后
    var same = [];
    for (var i = 0; i < SIZE; i++) {
      if (board[i] === ch && xOf(i) === fx) same.push(i);
    }
    if (same.length > 1) {
      same.sort(function (a, b) { return side === 'r' ? yOf(a) - yOf(b) : yOf(b) - yOf(a); }); // 前 → 后
      var pos = same.indexOf(from);
      var tag = same.length === 2 ? (pos === 0 ? '前' : '后')
        : (pos === 0 ? '前' : (pos === same.length - 1 ? '后' : (same.length === 3 ? '中' : CN_NUM[pos])));
      name = tag + NAME[t][side];
    } else {
      name = NAME[t][side] + fileWord(fx, side);
    }

    var action;
    if (ty === fy) {
      action = '平' + fileWord(tx, side);
    } else if (t === 'N' || t === 'B' || t === 'A') {
      action = (forward ? '进' : '退') + fileWord(tx, side);
    } else {
      action = (forward ? '进' : '退') + stepWord(Math.abs(ty - fy), side);
    }
    return name + action;
  }

  /* ---------- 对局 ---------- */

  function Game(fen) {
    this.board = toBoard(fen || START);
    this.turn = 'r';
    this.status = 'playing';     // playing | over
    this.result = null;          // {winner:'r'|'b'|'draw', reason:'...'}
    this.notations = [];         // 中文记谱
    this.moves = [];             // [{from,to,piece,capture}]
    this.snapshots = [];
    this.counts = {};
    this.quietPlies = 0;
    this.check = false;
    this._count();
  }

  Game.prototype.key = function () { return this.board.join('') + this.turn; };

  Game.prototype._count = function () {
    var k = this.key();
    this.counts[k] = (this.counts[k] || 0) + 1;
    return this.counts[k];
  };

  Game.prototype.legalMoves = function () { return legalMoves(this.board, this.turn); };
  Game.prototype.movesFrom = function (from) {
    return this.legalMoves().filter(function (m) { return m.from === from; });
  };
  Game.prototype.inCheck = function (side) { return isKingAttacked(this.board, side || this.turn); };

  Game.prototype.isLegal = function (from, to) {
    return this.legalMoves().some(function (m) { return m.from === from && m.to === to; });
  };

  // 走子（服务端 / 本地共用）。返回 {ok:true, ...} 或 {ok:false, error}
  Game.prototype.move = function (from, to) {
    if (this.status !== 'playing') return { ok: false, error: '对局已结束' };
    var ch = this.board[from];
    if (!ch || ch === '.') return { ok: false, error: '起点没有棋子' };
    if (sideOf(ch) !== this.turn) return { ok: false, error: '还没轮到你走棋' };
    if (!this.isLegal(from, to)) return { ok: false, error: '这一步不合规则' };

    var text = notation(this.board, from, to);
    var captured = this.board[to];

    this.snapshots.push({
      board: this.board.join(''), turn: this.turn, status: this.status,
      notations: this.notations.length, moves: this.moves.length,
      quietPlies: this.quietPlies, check: this.check
    });

    this.board[to] = ch;
    this.board[from] = '.';
    this.notations.push(text);
    this.moves.push({ from: from, to: to, piece: ch, capture: captured });
    this.quietPlies = captured === '.' ? this.quietPlies + 1 : 0;
    this.turn = other(this.turn);
    this.check = this.inCheck(this.turn);

    var repeats = this._count();
    var canMove = this.legalMoves().length > 0;

    if (!canMove) {
      this.status = 'over';
      this.result = {
        winner: other(this.turn),
        reason: this.check ? 'checkmate' : 'stalemate'
      };
    } else if (repeats >= 3) {
      this.status = 'over';
      this.result = repetitionJudge(this);
    } else if (this.quietPlies >= 120) {
      this.status = 'over';
      this.result = { winner: 'draw', reason: 'quiet' };
    }

    return {
      ok: true, notation: text, capture: captured, check: this.check,
      status: this.status, result: this.result
    };
  };

  // 悔棋：撤销 n 步（1 或 2）
  Game.prototype.undo = function (n) {
    n = n || 1;
    var s = null;
    while (n-- > 0 && this.snapshots.length) {
      s = this.snapshots.pop();
      var cur = this.key();
      if (this.counts[cur]) {
        this.counts[cur]--;
        if (this.counts[cur] <= 0) delete this.counts[cur];
      }
      this.board = toBoard(s.board);
      this.turn = s.turn;
      this.status = s.status;
      this.notations.length = s.notations;
      this.moves.length = s.moves;
      this.quietPlies = s.quietPlies;
      this.check = s.check;
    }
    this.status = 'playing';
    this.result = null;
    this.check = this.inCheck(this.turn);
    return !!s;
  };

  return {
    START: START,
    NAME: NAME,
    Game: Game,
    isAttacked: isAttacked,
    isKingAttacked: isKingAttacked,
    legalMoves: legalMoves,
    pseudoMoves: pseudoMoves,
    movesFrom: movesFrom,
    notation: notation,
    sideOf: sideOf,
    typeOf: typeOf,
    idx: idx, xOf: xOf, yOf: yOf,
    inPalace: inPalace,
    other: other
  };
});
