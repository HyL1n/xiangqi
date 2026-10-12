/* 前端：棋盘绘制、交互、联机 */
(function () {
  'use strict';

  var X = window.Xiangqi;
  var $ = function (id) { return document.getElementById(id); };
  var LS_NAME = 'xq.name';
  var LS_TOKEN = 'xq.token.';
  var NAME_CN = { r: '红方', b: '黑方' };
  var REASON = {
    checkmate: '绝杀', stalemate: '困毙', resign: '认输', timeout: '超时',
    agreement: '双方同意', repetition: '三次重复局面', quiet: '60 回合无吃子'
  };
  var CN_FILE = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
  var NO_SERVER_MSG = '这个地址上没有对局服务器（静态托管只发页面）：把 config.js 的 XQ_SERVER 指向你的服务器，或先用“本地对局”';

  // 棋子上的字（用繁体，跟参考图一致；记谱仍然用简体，不受影响）
  var BOARD_GLYPH = {
    r: { K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵' },
    b: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '砲', P: '卒' }
  };

  /*
   * 两套外观：
   *   dark = 深色盘面 + 实心棋子 + 白色繁体字（默认，就是参考图那种）
   *   wood = 原来的木纹盘面 + 象牙色棋子 + 红黑字
   */
  var THEMES = {
    dark: {
      font: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
      bg1: '#2b2e34', bg2: '#191b1f',
      grain: 'rgba(255,255,255,.018)',
      line: 'rgba(232,238,245,.55)',
      frame: 'rgba(255,255,255,.72)',
      river: 'rgba(255,255,255,.22)',
      label: 'rgba(255,255,255,.38)',
      pieceShadow: 'rgba(0,0,0,.5)',
      piece: {
        // face1=顶面亮部 face2=顶面暗部 side=圆柱侧面 wall=侧面阴影
        r: { face1: '#ef6a58', face2: '#9d1b12', side: '#7d130c', wall: 'rgba(0,0,0,.45)', rim: 'rgba(0,0,0,.30)', inner: 'bevel', innerAt: 0.8, innerW: 0.055, glyph: '#fff', glyphShadow: 'rgba(70,6,2,.55)' },
        b: { face1: '#5c626c', face2: '#191c21', side: '#101317', wall: 'rgba(0,0,0,.5)', rim: 'rgba(0,0,0,.35)', inner: 'bevel', innerAt: 0.8, innerW: 0.055, glyph: '#fff', glyphShadow: 'rgba(0,0,0,.6)' }
      }
    },
    wood: {
      font: 'KaiTi, "Kaiti SC", STKaiti, 楷体, "Songti SC", serif',
      bg1: '#f5dfb4', bg2: '#e5c390',
      grain: 'rgba(107,67,24,.05)',
      line: 'rgba(72,46,18,.78)',
      frame: 'rgba(72,46,18,.85)',
      river: 'rgba(88,58,26,.62)',
      label: 'rgba(88,58,26,.6)',
      pieceShadow: 'rgba(70,42,12,.26)',
      piece: {
        r: { face1: '#fffdf7', face2: '#efdcb6', side: '#c2a066', wall: 'rgba(120,80,30,.35)', rim: '#b3251f', inner: '#b3251f', innerAt: 0.79, innerW: 0.055, glyph: '#ab241d', glyphShadow: 'rgba(255,255,255,.75)' },
        b: { face1: '#fffdf7', face2: '#efdcb6', side: '#c2a066', wall: 'rgba(120,80,30,.35)', rim: '#2c2f36', inner: '#2c2f36', innerAt: 0.79, innerW: 0.055, glyph: '#23262d', glyphShadow: 'rgba(255,255,255,.75)' }
      }
    }
  };

  function theme() { return THEMES[S.theme] || THEMES.dark; }

  /*
   * 棋子字体：只挑各系统"一定有、而且彼此明显不同"的字体，
   * 避免出现"两个选项其实同一个字体"（华文行楷这类在 Windows 默认不装）。
   * 字重固定 500：避免 canvas 对中文字体做合成加粗（糊成一团，就是"字体奇怪"的来源）。
   */
  var FONTS = {
    // bold = 描边加粗量（占棋子半径的比例）。楷体笔画细给得多，黑体/隶书本来就粗给得少。
    kai: { label: '楷体', bold: 0.032, css: 'KaiTi, "Kaiti SC", STKaiti, 楷体, serif' },
    song: { label: '宋体', bold: 0.022, css: '"Songti SC", STSong, SimSun, 宋体, serif' },
    hei: { label: '黑体', bold: 0.008, css: 'SimHei, 黑体, "Microsoft YaHei", "PingFang SC", sans-serif' },
    yuan: { label: '幼圆', bold: 0.022, css: 'YouYuan, 幼圆, "Yuanti SC", "PingFang SC", sans-serif' },
    li: { label: '隶书', bold: 0.01, css: 'LiSu, 隶书, STLibian, "Yuanti SC", serif' }
  };
  function pieceFont() {
    var f = FONTS[S.font];
    return (f ? f.css : FONTS.kai.css);
  }
  function pieceBold() {
    var f = FONTS[S.font] || FONTS.kai;
    return f.bold || 0;
  }

  function boardName(ch) {
    var g = BOARD_GLYPH[X.sideOf(ch)];
    return (g && g[X.typeOf(ch)]) || ch;
  }

  var S = {
    mode: null,            // 'online' | 'local'
    name: '',
    code: null,
    you: null,
    token: null,
    view: null,
    local: null,
    flipped: false,
    userFlipped: false,
    sel: null,
    targets: [],
    legalKey: '',
    legalCache: [],
    sound: true,
    theme: 'dark',
    font: 'kai',
    aiLevel: 'normal',
    aiSide: 'b',            // 人机对战里电脑执哪一边（默认电脑执黑、你执红先行）
    aiThinking: false,
    ws: null,
    serverCfg: null,
    probed: false,
    noServer: false,
    pendingCreate: false,
    queue: [],
    retries: 0,
    reconnTimer: null,
    exiting: false,
    anim: null,
    prev: null,
    clockBase: null,
    cursor: null,
    kb: false,
    confirm: null,
    modalKey: null,
    modalDismissed: null,
    seenChat: {},
    chats: [],
    dirty: true
  };

  /* ---------------- 小工具 ---------------- */

  function toast(text, kind) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, 2200);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtClock(ms) {
    if (ms == null) return '--:--';
    ms = Math.max(0, ms);
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60), s = total % 60;
    if (m >= 60) return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  // 前端本地走表：谁在走就扣谁的时间
  function liveClocks() {
    var v = S.view;
    if (!v || !v.timeBase) return null;
    var b = S.clockBase;
    if (!b) return v.clocks;
    var out = { r: b.clocks.r, b: b.clocks.b };
    // started = 双方都已入座；对手还没进来时不走表
    if (b.status === 'playing' && b.turn && b.started !== false) {
      var left = out[b.turn] - (performance.now() - b.at);
      out[b.turn] = left > 0 ? left : 0;
    }
    return out;
  }

  function resultText(res) {
    if (!res) return '';
    var why = REASON[res.reason] || res.reason;
    if (res.winner === 'draw') return '和棋 · ' + why;
    return (res.winner === 'r' ? '红方胜' : '黑方胜') + ' · ' + why;
  }

  /* ---------------- 音效 ---------------- */

  var Sound = {
    ctx: null,
    init: function () {
      try {
        if (!this.ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
    },
    click: function (strong) {
      if (!S.sound) return;
      this.init();
      var ctx = this.ctx; if (!ctx) return;
      var n = Math.floor(ctx.sampleRate * 0.06);
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, strong ? 5 : 8);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = strong ? 760 : 1500; bp.Q.value = 1.1;
      var g = ctx.createGain(); g.gain.value = strong ? 0.5 : 0.34;
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start();
    },
    tone: function (freq, start, dur, vol) {
      if (!S.sound) return;
      this.init();
      var ctx = this.ctx; if (!ctx) return;
      var t = ctx.currentTime + (start || 0);
      var osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.22, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    check: function () { this.tone(880, 0, 0.16, 0.24); this.tone(1320, 0.13, 0.2, 0.22); },
    over: function (win) {
      if (win) { this.tone(660, 0, .16); this.tone(880, .13, .16); this.tone(1320, .26, .3); }
      else { this.tone(520, 0, .18); this.tone(392, .16, .3); }
    }
  };

  /* ---------------- 画布 ---------------- */

  var canvas = $('board');
  var ctx2d = canvas.getContext('2d');
  // 静态棋盘（木纹、网格、九宫、路数标记）画一次缓存在离屏画布上，
  // 之后每帧只贴图，动画才不会卡。
  var bgCanvas = document.createElement('canvas');
  var bgCtx = bgCanvas.getContext('2d');
  var grid = $('grid');
  var cellBtns = [];
  var geo = { cell: 40, margin: 28, W: 360, H: 400, dpr: 1 };

  function screenPt(x, y) {
    var fx = S.flipped ? 8 - x : x;
    var fy = S.flipped ? 9 - y : y;
    return { cx: geo.margin + fx * geo.cell, cy: geo.margin + fy * geo.cell };
  }

  function layout() {
    var wrap = document.querySelector('.board-wrap');
    var area = document.querySelector('.board-area');
    var narrow = window.matchMedia('(max-width: 900px)').matches;
    var availW = wrap.clientWidth || (window.innerWidth - 40);

    /*
     * 可用高度不能直接读 wrap.clientHeight —— 画布本身有固定尺寸，
     * 会把这个 flex 子项撑住，形成"量到旧高度 → 画布不缩 → 继续溢出"的死循环。
     * 所以自己算：棋board区总高 - 其它兄弟元素（计时条、状态栏…）- 间隙。
     */
    var siblings = 0, count = 0;
    if (area) {
      Array.prototype.forEach.call(area.children, function (el) {
        if (el === wrap || el.hidden) return;
        siblings += el.getBoundingClientRect().height;
        count++;
      });
    }
    var areaH = area && area.clientHeight ? area.clientHeight : Math.min(window.innerHeight * 0.72, 720);
    var availH = narrow
      ? Math.max(200, Math.min(window.innerHeight * 0.66, 620) - siblings - 10 * count)
      : Math.max(200, areaH - siblings - 10 * count);

    // 上限放宽一点：宽屏上棋盘能跟着变大，不至于两边空一大片
    var cell = Math.min(availW / 9.56, availH / 10.56, 120);
    cell = Math.max(20, Math.floor(cell));
    geo.cell = cell;
    geo.margin = Math.round(cell * 0.78);
    geo.W = 8 * cell + 2 * geo.margin;
    geo.H = 9 * cell + 2 * geo.margin;
    geo.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = geo.W + 'px';
    canvas.style.height = geo.H + 'px';
    canvas.width = Math.round(geo.W * geo.dpr);
    canvas.height = Math.round(geo.H * geo.dpr);
    renderBg();
    placeGrid();
    S.dirty = true;
  }

  // 只在布局变化或翻转棋盘时重画静态背景
  function renderBg() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    bgCtx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    bgCtx.clearRect(0, 0, geo.W, geo.H);
    drawBoard(bgCtx);
  }

  /* 交叉点按钮层：真人用鼠标点，键盘 / 读屏也能用 */

  function buildGrid() {
    var frag = document.createDocumentFragment();
    for (var by = 0; by < 10; by++) {
      for (var bx = 0; bx < 9; bx++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.dataset.bx = String(bx);
        b.dataset.by = String(by);
        b.setAttribute('aria-label', (bx + 1) + '路 ' + (by + 1) + '线 空');
        cellBtns.push(b);
        frag.appendChild(b);
      }
    }
    grid.appendChild(frag);
  }

  function placeGrid() {
    var size = Math.max(16, geo.cell * 0.92);
    for (var i = 0; i < 90; i++) {
      var b = cellBtns[i];
      if (!b) continue;
      var p = screenPt(i % 9, Math.floor(i / 9));
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.left = (p.cx - size / 2) + 'px';
      b.style.top = (p.cy - size / 2) + 'px';
    }
  }

  // 把棋盘状态写进按钮的无障碍标签，读屏和自动化都能读到
  function syncGrid() {
    var v = S.view;
    for (var i = 0; i < 90; i++) {
      var b = cellBtns[i];
      if (!b) continue;
      var ch = v ? v.board[i] : '.';
      var label = (i % 9 + 1) + '路 ' + (Math.floor(i / 9) + 1) + '线 ';
      if (!ch || ch === '.') {
        b.dataset.piece = '';
        b.setAttribute('aria-label', label + '空');
      } else {
        var sd = X.sideOf(ch);
        b.dataset.piece = ch;
        b.setAttribute('aria-label', label + (sd === 'r' ? '红' : '黑') + X.NAME[X.typeOf(ch)][sd]);
      }
    }
  }

  function focusCursor(idx, doFocus) {
    S.cursor = idx;
    for (var i = 0; i < 90; i++) cellBtns[i].tabIndex = i === idx ? 0 : -1;
    if (doFocus) cellBtns[idx].focus();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function line(c, x1, y1, x2, y2) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }

  function drawMarker(c, cx, cy, gap, len) {
    c.lineWidth = Math.max(1, geo.cell * 0.022);
    for (var i = 0; i < 4; i++) {
      var dx = (i === 0 || i === 1) ? 1 : -1;
      var dy = (i === 0 || i === 2) ? -1 : 1;
      c.beginPath();
      c.moveTo(cx + dx * gap, cy + dy * gap + dy * len);
      c.lineTo(cx + dx * gap, cy + dy * gap);
      c.lineTo(cx + dx * gap + dx * len, cy + dy * gap);
      c.stroke();
    }
  }

  function pieceChar(ch) { return X.NAME[X.typeOf(ch)][X.sideOf(ch)]; }

  function drawPiece(c, cx, cy, ch, scale) {
    var r = geo.cell * 0.462 * (scale || 1);
    var side = X.sideOf(ch);
    var th = theme();
    var pal = th.piece[side];
    var depth = r * 0.13;            // 棋子厚度（侧面高度，调矮一点）
    var faceY = cy - depth * 0.18;   // 顶面比圆心略上移，视觉上像俯视一枚圆片
    c.save();

    // 1) 落地阴影：几层逐渐变淡的椭圆模拟模糊
    for (var i = 3; i >= 1; i--) {
      c.beginPath();
      c.ellipse(cx + r * 0.05 * i, cy + depth * 0.6 + r * 0.06 * i,
        r * (0.98 + 0.05 * i), r * (0.86 + 0.05 * i), 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(0,0,0,' + (0.10 + 0.04 * i) + ')';
      c.fill();
    }

    // 2) 圆柱侧面（整体先画一个偏下的深色圆）
    var sideGrad = c.createLinearGradient(cx - r, cy - r, cx + r * 0.4, cy + r);
    sideGrad.addColorStop(0, pal.face2);
    sideGrad.addColorStop(1, pal.side);
    c.beginPath(); c.arc(cx, cy + depth * 0.5, r, 0, Math.PI * 2);
    c.fillStyle = sideGrad; c.fill();

    // 3) 侧面与顶面交界的暗环，让厚度看得出来
    c.beginPath(); c.arc(cx, faceY + depth * 0.55, r * 0.995, 0, Math.PI * 2);
    c.lineWidth = Math.max(1, depth * 0.9);
    c.strokeStyle = pal.wall;
    c.stroke();

    // 4) 顶面：左上亮、右下暗的径向渐变
    var gr = c.createRadialGradient(cx - r * 0.4, faceY - r * 0.48, r * 0.08, cx, faceY, r * 1.08);
    gr.addColorStop(0, pal.face1);
    gr.addColorStop(0.62, pal.face2);
    gr.addColorStop(1, pal.side);
    c.beginPath(); c.arc(cx, faceY, r * 0.985, 0, Math.PI * 2);
    c.fillStyle = gr; c.fill();

    // 5) 顶面斜上方的高光（塑料圆片那种反光）
    c.beginPath();
    c.ellipse(cx - r * 0.34, faceY - r * 0.42, r * 0.52, r * 0.3, -0.6, 0, Math.PI * 2);
    var hl = c.createLinearGradient(cx - r, faceY - r, cx, faceY);
    hl.addColorStop(0, 'rgba(255,255,255,.30)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = hl; c.fill();

    // 6) 顶面边沿：木纹主题保留细圈，深色主题用一圈暗边
    if (pal.rim) {
      c.beginPath(); c.arc(cx, faceY, r * 0.965, 0, Math.PI * 2);
      c.lineWidth = Math.max(1, r * 0.045);
      c.strokeStyle = pal.rim;
      c.stroke();
    }

    // 6b) 内沿那一圈台阶：左上受光、右下背光，细看就能看出圆片分了外沿和内面
    if (pal.inner) {
      c.beginPath(); c.arc(cx, faceY, r * (pal.innerAt || 0.8), 0, Math.PI * 2);
      c.lineWidth = Math.max(1, r * (pal.innerW || 0.05));
      if (pal.inner === 'bevel') {
        var ig = c.createLinearGradient(cx - r * 0.6, faceY - r * 0.6, cx + r * 0.6, faceY + r * 0.6);
        ig.addColorStop(0, 'rgba(255,255,255,.26)');
        ig.addColorStop(0.45, 'rgba(255,255,255,.05)');
        ig.addColorStop(1, 'rgba(0,0,0,.30)');
        c.strokeStyle = ig;
      } else {
        c.strokeStyle = pal.inner;
      }
      c.stroke();
      // 内面再稍微提亮一点点，和外沿分开
      c.beginPath(); c.arc(cx, faceY, r * (pal.innerAt || 0.8) - Math.max(1, r * (pal.innerW || 0.05)) / 2, 0, Math.PI * 2);
      c.fillStyle = pal.inner === 'bevel' ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.18)';
      c.fill();
    }

    /*
     * 7) 字：先压一层暗影再写白字，做出刻上去的感觉。
     * 位置用 measureText 的墨迹边界精确居中 —— 不同字体在字身框里的位置不一样，
     * 按字身框 + 固定偏移估会出现"看着偏一点"。
     */
    var glyph = boardName(ch);
    c.textAlign = 'center';
    // 500：中文系统字体大多只有 400/700，用 700 会被 canvas 合成加粗（发糊、发虚）
    c.font = '500 ' + (r * 1.34) + 'px ' + pieceFont();
    var gx = cx;
    // 竖直方向按"整颗棋子"（含下方圆柱侧面）的视觉中心对齐，而不是只对齐顶面
    var visualCenter = cy + depth * 0.16;
    var gy = visualCenter + r * 0.05;        // 兜底：按字身框居中
    // 关键：必须先设成 alphabetic 再量 —— 否则 measureText 返回的墨迹边界
    // 是以"字身中间"为基准的，套用基线公式会差出半个字高（实测偏高 11~14px）
    c.textBaseline = 'alphabetic';
    var mt = null;
    try { mt = c.measureText(glyph); } catch (e) { mt = null; }
    if (mt && typeof mt.actualBoundingBoxAscent === 'number') {
      var asc = mt.actualBoundingBoxAscent || 0;
      var desc = mt.actualBoundingBoxDescent || 0;
      var inkL = mt.actualBoundingBoxLeft || 0;
      var inkR = mt.actualBoundingBoxRight || 0;
      gx = cx + (inkL - inkR) / 2;
      gy = visualCenter + (asc - desc) / 2;
    } else {
      c.textBaseline = 'middle';
    }
    // 先描边再填充：描边加粗比 canvas 的合成加粗均匀得多（合成加粗会把笔画糊在一起）
    var bw = pieceBold() * r;
    var drawInk = function (style, y) {
      c.fillStyle = style;
      c.fillText(glyph, gx, y);
      if (bw > 0.4) {
        c.lineWidth = bw;
        c.lineJoin = 'round';
        c.strokeStyle = style;
        c.strokeText(glyph, gx, y);
      }
    };
    drawInk(pal.glyphShadow, gy + Math.max(1, r * 0.045));
    drawInk(pal.glyph, gy);
    c.restore();
  }

  function drawBoard(c) {
    var m = geo.margin, cell = geo.cell;
    var th = theme();
    var px = function (i) { return m + i * cell; };
    var py = function (j) { return m + j * cell; };

    // 盘面底色
    var bg = c.createLinearGradient(0, 0, geo.W, geo.H);
    bg.addColorStop(0, th.bg1);
    bg.addColorStop(0.45, th.bg1);
    bg.addColorStop(1, th.bg2);
    roundRect(c, 0, 0, geo.W, geo.H, Math.round(cell * 0.3));
    c.fillStyle = bg; c.fill();

    c.save();
    roundRect(c, 0, 0, geo.W, geo.H, Math.round(cell * 0.3));
    c.clip();
    // 木纹只属于 wood 主题；深色盘面用极淡的斜向纹理
    c.globalAlpha = 1;
    c.strokeStyle = th.grain;
    c.lineWidth = cell * 0.05;
    for (var i = 0; i < 22; i++) {
      var y = (i + 0.5) * geo.H / 22 + Math.sin(i * 1.7) * cell * 0.35;
      c.beginPath();
      c.moveTo(-10, y);
      c.bezierCurveTo(geo.W * 0.3, y + cell * 0.5, geo.W * 0.7, y - cell * 0.5, geo.W + 10, y);
      c.stroke();
    }
    c.restore();

    var ink = th.line;
    c.strokeStyle = ink;
    c.lineCap = 'round';
    c.lineWidth = Math.max(1, cell * 0.017);

    for (var j = 0; j < 10; j++) line(c, px(0), py(j), px(8), py(j));
    for (var x = 0; x < 9; x++) {
      if (x === 0 || x === 8) line(c, px(x), py(0), px(x), py(9));
      else {
        line(c, px(x), py(0), px(x), py(4));
        line(c, px(x), py(5), px(x), py(9));
      }
    }

    // 外框
    c.lineWidth = Math.max(1.6, cell * 0.05);
    var pad = cell * 0.2;
    c.strokeStyle = th.frame;
    c.strokeRect(px(0) - pad, py(0) - pad, 8 * cell + 2 * pad, 9 * cell + 2 * pad);

    // 九宫
    c.lineWidth = Math.max(1, cell * 0.017);
    c.strokeStyle = ink;
    line(c, px(3), py(0), px(5), py(2));
    line(c, px(5), py(0), px(3), py(2));
    line(c, px(3), py(7), px(5), py(9));
    line(c, px(5), py(7), px(3), py(9));

    // 兵炮位记号
    c.strokeStyle = ink;
    var g = cell * 0.08, len = cell * 0.16;
    [[1, 2], [7, 2], [1, 7], [7, 7]].forEach(function (p) { drawMarker(c, px(p[0]), py(p[1]), g, len); });
    [[0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]].forEach(function (p) {
      drawMarker(c, px(p[0]), py(p[1]), g, len);
    });

    // 楚河汉界
    c.save();
    c.fillStyle = th.river;
    c.font = (cell * 0.58) + 'px ' + th.font;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    var ry = py(4) + cell * 0.5;
    c.fillText('楚  河', px(2), ry);
    c.fillText('漢  界', px(6), ry);
    c.restore();

    // 路数标记：红方汉字（下），黑方数字（上）
    c.save();
    c.fillStyle = th.label;
    c.font = (cell * 0.34) + 'px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var k = 0; k < 9; k++) {
      c.fillText(CN_FILE[k], screenPt(k, 9).cx, py(9) + cell * 0.5);
      c.fillText(String(k + 1), screenPt(k, 0).cx, py(0) - cell * 0.5);
    }
    c.restore();
  }

  function draw() {
    var c = ctx2d;
    var v = S.view;
    c.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    c.clearRect(0, 0, geo.W, geo.H);
    c.drawImage(bgCanvas, 0, 0, geo.W, geo.H);   // 静态棋盘直接贴图
    if (!v) return;

    var cell = geo.cell;

    // 上一步的落点框
    var lm = v.lastMove;
    if (lm) {
      c.save();
      c.strokeStyle = 'rgba(214,150,25,.85)';
      c.lineWidth = Math.max(1.5, cell * 0.035);
      [lm.from, lm.to].forEach(function (i) {
        var p = screenPt(X.xOf(i), X.yOf(i));
        var d = cell * 0.2, l = cell * 0.2;
        for (var q = 0; q < 4; q++) {
          var dx = q % 2 ? 1 : -1, dy = q < 2 ? -1 : 1;
          c.beginPath();
          c.moveTo(p.cx + dx * d, p.cy + dy * (d + l));
          c.lineTo(p.cx + dx * d, p.cy + dy * d);
          c.lineTo(p.cx + dx * (d + l), p.cy + dy * d);
          c.stroke();
        }
      });
      c.restore();
    }

    // 选中提示 + 可走点
    if (S.sel != null) {
      var sp = screenPt(X.xOf(S.sel), X.yOf(S.sel));
      c.save();
      c.strokeStyle = 'rgba(226,168,52,.95)';
      c.lineWidth = Math.max(1.6, cell * 0.05);
      c.beginPath(); c.arc(sp.cx, sp.cy, cell * 0.47, 0, Math.PI * 2); c.stroke();
      c.restore();
      S.targets.forEach(function (to) {
        var p = screenPt(X.xOf(to), X.yOf(to));
        var occupied = v.board[to] !== '.';
        c.save();
        if (occupied) {
          c.strokeStyle = 'rgba(217,75,63,.9)';
          c.lineWidth = Math.max(2, cell * 0.07);
          c.beginPath(); c.arc(p.cx, p.cy, cell * 0.46, 0, Math.PI * 2); c.stroke();
        } else {
          c.fillStyle = 'rgba(214,150,25,.55)';
          c.beginPath(); c.arc(p.cx, p.cy, cell * 0.13, 0, Math.PI * 2); c.fill();
        }
        c.restore();
      });
    }

    // 键盘光标
    if (S.kb && S.cursor != null) {
      var cp = screenPt(X.xOf(S.cursor), X.yOf(S.cursor));
      c.save();
      c.strokeStyle = 'rgba(226,168,52,.85)';
      c.lineWidth = Math.max(1.2, cell * 0.03);
      c.setLineDash([cell * 0.14, cell * 0.1]);
      c.strokeRect(cp.cx - cell * 0.46, cp.cy - cell * 0.46, cell * 0.92, cell * 0.92);
      c.restore();
    }

    // 将军脉冲
    var kingIdx = -1;
    if (v.check && v.status === 'playing') {
      var target = v.turn === 'r' ? 'K' : 'k';
      for (var i = 0; i < 90; i++) if (v.board[i] === target) { kingIdx = i; break; }
      if (kingIdx >= 0) {
        var kp = screenPt(X.xOf(kingIdx), X.yOf(kingIdx));
        var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        c.save();
        c.strokeStyle = 'rgba(230,60,45,' + (0.45 + 0.5 * pulse) + ')';
        c.lineWidth = Math.max(2, cell * (0.06 + 0.05 * pulse));
        c.beginPath(); c.arc(kp.cx, kp.cy, cell * (0.5 + 0.06 * pulse), 0, Math.PI * 2); c.stroke();
        c.restore();
      }
    }

    // 棋子
    var anim = S.anim;
    for (var i2 = 0; i2 < 90; i2++) {
      var ch = v.board[i2];
      if (!ch || ch === '.') continue;
      var bx = X.xOf(i2), by = X.yOf(i2);
      var p = screenPt(bx, by);
      if (anim && anim.to === i2 && v.board[anim.from] === '.') {
        var fp = screenPt(X.xOf(anim.from), X.yOf(anim.from));
        var t = Math.min(1, (performance.now() - anim.t0) / anim.dur);
        var e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
        var cx = fp.cx + (p.cx - fp.cx) * e;
        var cy = fp.cy + (p.cy - fp.cy) * e;
        drawPiece(c, cx, cy, ch, 1 + 0.06 * Math.sin(Math.PI * t));
      } else {
        drawPiece(c, p.cx, p.cy, ch, 1);
      }
    }
  }

  var lastDraw = 0;

  function loop() {
    var now = performance.now();
    if (S.anim && now - S.anim.t0 >= S.anim.dur) S.anim = null;
    var live = !!S.anim || !!S.sel || !!(S.view && S.view.check && S.view.status === 'playing');
    // 只要画面里有动的东西（走子动画 / 选中高亮 / 将军脉冲）就按刷新率满帧跑，
    // 静态时靠 dirty 触发，不空转。
    if (S.dirty || live) {
      lastDraw = now;
      S.dirty = false;
      draw();
    }
    requestAnimationFrame(loop);
  }

  /* ---------------- 视图 ---------------- */

  function setView(v) {
    var old = S.view;
    if (old && v && old.board !== v.board && v.moveCount === old.moveCount + 1 && v.lastMove) {
      // 刚好前进一着：滑子动画 + 落子声（吃子时声音更重）
      S.anim = { from: v.lastMove.from, to: v.lastMove.to, t0: performance.now(), dur: 185 };
      Sound.click(old.board[v.lastMove.to] !== '.');
    } else if (old && v && old.board !== v.board) {
      S.anim = null;
    }
    if (v && v.check && (!old || !old.check)) setTimeout(function () { Sound.check(); }, 120);
    if (v && v.result && (!old || !old.result)) {
      setTimeout(function () {
        Sound.over(S.mode === 'local' || v.result.winner === v.you);
        toast(resultText(v.result), 'ok');
      }, 260);
    }
    S.view = v;
    // 时钟：服务端只给"某个时刻的剩余量"，之后由前端自己走表
    if (v && v.timeBase) {
      S.clockBase = {
        clocks: { r: v.clocks.r, b: v.clocks.b },
        at: performance.now(),
        turn: v.turn,
        status: v.status,
        started: v.started
      };
    } else {
      S.clockBase = null;
    }
    S.sel = null;
    S.targets = [];
    S.legalKey = '';
    S.dirty = true;
  }

  function localView() {
    var g = S.local;
    var last = g.moves.length ? g.moves[g.moves.length - 1] : null;
    var seats = { r: { name: '红方', online: true }, b: { name: '黑方', online: true } };
    var you = 'both';
    if (S.mode === 'ai') {
      seats[S.aiSide] = { name: '电脑（' + levelName(S.aiLevel) + '）', online: true };
      seats[X.other(S.aiSide)] = { name: S.name || '你', online: true };
      you = X.other(S.aiSide);        // 人机对战里"你"只有一边，棋盘朝向也跟着它
    }
    return {
      board: g.board.join(''),
      turn: g.turn,
      status: g.status,
      check: g.check,
      result: g.result,
      history: g.notations,
      moveCount: g.moves.length,
      lastMove: last ? { from: last.from, to: last.to } : null,
      seats: seats,
      you: you,
      spectating: false,
      spectators: 0,
      timeBase: 0,
      clocks: null,
      pending: null,
      rematchVotes: [],
      started: true
    };
  }

  function levelName(lv) {
    return { easy: '简单', normal: '普通', hard: '较难' }[lv] || '普通';
  }

  /* ---------------- 人机对战 ---------------- */

  function startAI() {
    S.mode = 'ai';
    S.code = null;
    S.you = null;
    S.aiLevel = ($('aiLevel') && $('aiLevel').value) || 'normal';
    S.aiSide = 'b';                       // 电脑执黑，你执红先行
    S.aiThinking = false;
    S.local = new X.Game();
    S.flipped = false;
    $('chatCard').classList.add('hidden');
    history.replaceState(null, '', location.pathname);
    hideLobby();
    setView(localView());
    renderAll();
    toast('人机对战开始，你执红先行（难度：' + levelName(S.aiLevel) + '）', 'ok');
  }

  // 轮到电脑就走一步；先让界面画出"思考中"，再算，避免看起来像卡死
  function scheduleAI() {
    if (S.mode !== 'ai' || !S.local || S.local.status !== 'playing') return;
    if (S.local.turn !== S.aiSide) return;
    S.aiThinking = true;
    renderAll();
    setTimeout(runAI, 80);
  }

  function runAI() {
    var g = S.local;
    if (S.mode !== 'ai' || !g || g.status !== 'playing' || g.turn !== S.aiSide) {
      S.aiThinking = false;
      renderAll();
      return;
    }
    var eng = window.XiangqiEngine;
    var cfg = (eng && eng.levels && eng.levels[S.aiLevel]) || { timeMs: 400, depth: 3 };
    var res = null;
    try { res = eng ? eng.findMove(g.board.join(''), g.turn, cfg) : null; } catch (e) { res = null; }
    var applied = false;
    if (res && res.move) applied = !!g.move(res.move[0], res.move[1]).ok;
    if (!applied) {
      // 兜底：引擎不可用或超时，随便走一步合法的，别让对局卡住
      var ms = g.legalMoves();
      if (ms.length) {
        var pick = ms[Math.floor(Math.random() * ms.length)];
        g.move(pick.from, pick.to);
      }
    }
    S.aiThinking = false;
    setView(localView());
    renderAll();
  }

  /* ---------------- 走子 ---------------- */

  function legalAll() {
    var v = S.view;
    if (!v) return [];
    var key = v.board + v.turn;
    if (key !== S.legalKey) {
      S.legalKey = key;
      S.legalCache = X.legalMoves(v.board, v.turn);
    }
    return S.legalCache;
  }

  function selectFrom(idx) {
    var v = S.view;
    S.sel = idx;
    S.targets = legalAll().filter(function (m) { return m.from === idx; }).map(function (m) { return m.to; });
    S.dirty = true;
    if (!S.targets.length) toast('这个子暂时走不动');
  }

  function doMove(from, to) {
    var v = S.view;
    if (!v || v.status !== 'playing') return;
    if (S.mode === 'ai') {
      var gg = S.local;
      if (!gg) return;
      if (S.aiThinking) { toast('电脑正在思考，稍等一下'); return; }
      if (gg.turn !== X.other(S.aiSide)) { toast('还没轮到你走棋'); return; }
      var ra = gg.move(from, to);
      if (!ra.ok) { toast(ra.error || '这一步走不了'); return; }
      setView(localView());
      renderAll();
      if (gg.status === 'playing') scheduleAI();
      return;
    }
    if (S.mode === 'local') {
      var r = S.local.move(from, to);
      if (!r.ok) { toast(r.error || '这一步走不了'); return; }
      setView(localView());
      renderAll();          // 本地对局没有服务端广播，自己刷新侧栏
      return;
    }
    if (v.spectating || !v.you) { toast('你在观战，没有座位'); return; }
    if (v.turn !== v.you) { toast('还没轮到你走棋'); return; }
    if (!v.started) { toast('等对手入座'); return; }
    var nb = v.board.split('');
    var note = X.notation(v.board, from, to);
    nb[to] = nb[from]; nb[from] = '.';
    setView({
      board: nb.join(''), turn: X.other(v.turn), status: 'playing', check: false, result: null,
      history: v.history.concat([note]), moveCount: v.moveCount + 1, lastMove: { from: from, to: to },
      seats: v.seats, you: v.you, spectating: false, spectators: v.spectators,
      timeBase: v.timeBase, clocks: v.clocks, pending: null, rematchVotes: [], started: v.started,
      optimistic: true
    });
    send({ t: 'move', from: from, to: to });
  }

  function onPoint(bx, by) {
    var v = S.view;
    if (!v) return;
    Sound.init();
    if (v.status !== 'playing') { S.dirty = true; return; }
    var idx = X.idx(bx, by);
    var ch = v.board[idx];
    var mover = S.mode === 'local' ? v.turn : v.you;

    if (S.sel != null && S.targets.indexOf(idx) >= 0) { doMove(S.sel, idx); return; }
    if (ch !== '.' && X.sideOf(ch) === v.turn) {
      if (X.sideOf(ch) !== mover) { toast('还没轮到你走棋'); return; }
      selectFrom(idx);
      return;
    }
    S.sel = null; S.targets = []; S.dirty = true;
  }

  /* ---------------- 面板 ---------------- */

  function statusLine() {
    var v = S.view;
    if (!v) return '等待开始…';
    if (v.status === 'over' && v.result) return '对局结束：' + resultText(v.result);
    if (S.mode === 'ai') {
      if (S.aiThinking) return '<b>电脑思考中…</b>';
      if (v.check) return '<span class="warn">' + NAME_CN[v.turn] + '被将军</span>';
      return v.turn === v.you ? '轮到你走棋（' + NAME_CN[v.you] + '）' : '电脑走棋…';
    }
    if (S.mode === 'local') return v.check ? '<span class="warn">' + NAME_CN[v.turn] + '被将军</span>' : '轮到 <b>' + NAME_CN[v.turn] + '</b> 走棋（本机轮流）';
    if (v.spectating) return '观战中 · ' + (v.check ? '<span class="warn">' + NAME_CN[v.turn] + '被将军</span> ' : '') + '轮到 <b>' + NAME_CN[v.turn] + '</b>';
    if (!v.started) return '等对手加入…把房间号 <b>' + esc(S.code || '') + '</b> 发给朋友';
    if (v.check) return '<span class="warn">将军！</span> 轮到 <b>' + NAME_CN[v.turn] + '</b>';
    if (v.turn === v.you) return '轮到你走棋（' + NAME_CN[v.you] + '）';
    return '等对方走棋…（' + NAME_CN[v.you] + '）';
  }

  function renderPlayers() {
    var v = S.view;
    var box = $('players');
    if (!v) { box.innerHTML = ''; return; }
    var clocks = liveClocks() || v.clocks || { r: null, b: null };
    var order = S.flipped ? ['b', 'r'] : ['r', 'b'];
    box.innerHTML = order.map(function (side) {
      var s = v.seats[side];
      var cls = 'pcard ' + (side === 'r' ? 'red' : 'black');
      if (v.status === 'playing' && v.turn === side) cls += ' active';
      if (!s) cls += ' empty';
      var name = s ? esc(s.name) : '等待对手加入…';
      var you = (v.you === side) ? ' <span class="badge-you">你</span>' : '';
      var meta = s
        ? '<span class="dot ' + (s.online === false ? '' : 'live') + '"></span>' + NAME_CN[side] + (s.online === false ? ' · 已断开' : ' · 在线')
        : NAME_CN[side] + ' · 空座';
      // 时间放回玩家卡片里（这是最初的样式）
      var clock = v.timeBase
        ? '<div class="clock' + ((clocks[side] != null && clocks[side] < 30000) ? ' low' : '') + '">' + fmtClock(clocks[side]) + '</div>'
        : '';
      return '<div class="' + cls + '">' +
        '<div class="face">' + (side === 'r' ? '帥' : '將') + '</div>' +
        '<div class="who"><div class="n">' + name + you + '</div><div class="m">' + meta + '</div></div>' +
        clock + '</div>';
    }).join('');
  }

  function renderActions() {
    var v = S.view;
    var box = $('actions');
    if (!v) { box.innerHTML = ''; return; }
    if (S.mode === 'ai') {
      box.classList.add('hidden');
      var ab = $('localActions');
      ab.classList.remove('hidden');
      var opts = ['easy', 'normal', 'hard'].map(function (lv) {
        return '<option value="' + lv + '"' + (S.aiLevel === lv ? ' selected' : '') + '>' + levelName(lv) + '</option>';
      }).join('');
      ab.innerHTML = S.confirm === 'reset'
        ? '<button class="btn primary" data-act="reset-yes" style="grid-column:1/-1">确定重新开始（交换先手）</button>'
          + '<button class="btn" data-act="cancel" style="grid-column:1/-1">取消</button>'
        : '<button class="btn" data-act="ai-undo">悔棋</button>'
          + '<button class="btn" data-act="reset">重新开始</button>'
          + '<select class="btn" id="aiLevel2" style="grid-column:1/-1" title="电脑棋力">' + opts + '</select>';
      return;
    }
    if (S.mode === 'local') {
      box.classList.add('hidden');
      var lb = $('localActions');
      lb.classList.remove('hidden');
      lb.innerHTML = S.confirm === 'reset'
        ? '<button class="btn primary" data-act="reset-yes">确定重新开始</button><button class="btn" data-act="cancel">取消</button>'
        : '<button class="btn" data-act="local-undo">悔棋</button><button class="btn" data-act="reset">重新开始</button>';
      return;
    }
    $('localActions').classList.add('hidden');
    box.classList.remove('hidden');
    var playing = v.status === 'playing';
    var seated = !!v.you;
    var html = '';
    if (seated) {
      html += '<button class="btn" data-act="undo" ' + (playing && v.moveCount > 0 && v.started ? '' : 'disabled') + '>悔棋</button>';
      html += '<button class="btn" data-act="draw" ' + (playing && v.started ? '' : 'disabled') + '>求和</button>';
      if (S.confirm === 'resign' && playing && v.started) {
        html += '<button class="btn primary" data-act="resign-yes">确定认输</button>';
        html += '<button class="btn" data-act="cancel">再想想</button>';
      } else {
        html += '<button class="btn danger" data-act="resign" ' + (playing && v.started ? '' : 'disabled') + '>认输</button>';
      }
      html += '<button class="btn ' + (!playing ? 'primary' : '') + '" data-act="rematch" ' + (!playing && v.started ? '' : 'disabled') + '>再来一局</button>';
      var votes = (v.rematchVotes || []).length;
      if (!playing && votes > 0 && votes < 2) html += '<div class="ask wide" style="grid-column:1/-1">' + (v.rematchVotes.indexOf(v.you) >= 0 ? '已发送，等对方确认' : '对方想再来一局') + '</div>';
      // 我自己发起的悔棋/和棋，也在这里留个可见的状态（对方那边是弹窗）
      if (v.pending && v.pending.by === v.you) {
        html += '<div class="ask wide" style="grid-column:1/-1">已请求'
          + (v.pending.kind === 'draw' ? '和棋' : '悔棋') + '，等对方答复</div>';
      }
    } else {
      html += '<button class="btn wide" data-act="sit">入座观战席（有空位就能下）</button>';
    }
    box.innerHTML = html;
  }

  function renderHist() {
    var v = S.view;
    var box = $('hist');
    if (!v) { box.innerHTML = ''; return; }
    var h = v.history || [];
    $('histCount').textContent = h.length ? h.length + ' 手' : '';
    if (!h.length) { box.innerHTML = '<div class="empty">还没有走棋</div>'; return; }
    var rows = [];
    for (var i = 0; i < h.length; i += 2) {
      rows.push('<div class="hrow"><span class="no">' + (i / 2 + 1) + '.</span>' +
        '<span class="r">' + esc(h[i]) + '</span>' +
        '<span class="b">' + esc(h[i + 1] || '') + '</span></div>');
    }
    box.innerHTML = rows.join('');
    box.scrollTop = box.scrollHeight;
  }

  /*
   * 聊天渲染：服务端把聊天记录随状态一起下发（最多 40 条）+ 也会单独推消息，
   * 所以这里按 id 去重；没有 id 的老消息用 时间+名字+内容 兜底去重。
   */
  function renderChat(msgs) {
    var log = $('chatlog');
    if (msgs && msgs.length) {
      msgs.forEach(function (m) {
        if (!m || m.t !== 'chat' || !m.text) return;
        var key = (m.id != null) ? ('i' + m.id) : ('k' + m.ts + '|' + (m.name || '') + '|' + m.text);
        if (S.seenChat[key]) return;
        S.seenChat[key] = true;
        S.chats.push(m);
        var el = document.createElement('div');
        if (m.system) {
          el.className = 'msg sys ' + (m.kind || '');
          el.textContent = m.text;
        } else {
          var mine = m.seat && m.seat === S.you && !m.system;
          el.className = 'msg' + (mine ? ' mine' : '');
          el.innerHTML = '<div class="who">' + esc(m.name || '棋友') + (m.seat ? ' · ' + NAME_CN[m.seat] : ' · 观战') + '</div><span class="bubble">' + esc(m.text) + '</span>';
        }
        log.appendChild(el);
      });
      while (log.children.length > 200) log.removeChild(log.firstChild);
      if (S.chats.length < 60) log.scrollTop = log.scrollHeight;
    }
  }

  function renderStatus() {
    $('statusText').innerHTML = statusLine();
    var v = S.view;
    var right = $('statusRight');
    if (!v || S.mode === 'local') { right.innerHTML = ''; return; }
    var bits = [];
    if (v.spectators) bits.push('观战 ' + v.spectators + ' 人');
    right.innerHTML = bits.join(' · ');
  }

  function renderTop() {
    var inRoom = (S.mode === 'online' && S.code);
    var playing = !!S.mode;                  // 本地对局也要有翻转/声音
    $('topbarActions').hidden = !playing;
    var conn = $('connState');
    if (conn) {
      var live = wsOpen();
      conn.className = 'conn' + (live ? ' live' : '');
      conn.querySelector('b').textContent = S.mode === 'ai' ? '人机对战'
        : (S.mode === 'local' ? '本地对局' : (live ? '已连接' : '连接中…'));
    }
    $('codeChip').hidden = !inRoom;
    $('btnInvite').hidden = !inRoom;
    if (inRoom) $('roomCode').textContent = S.code;
    $('btnExit').textContent = inRoom
      ? (S.confirm === 'exit' ? '确认退出？' : '退出房间')
      : (S.confirm === 'exit' ? '确认返回？' : '返回大厅');
  }

  function renderAll() {
    renderTop();
    renderPlayers();
    renderActions();
    renderHist();
    renderStatus();
    renderModal();
    syncGrid();
    if (S.view) renderChat(S.view.chat);
    S.dirty = true;
  }

  /* ---------------- 弹窗：对方请求 / 对局结果 ---------------- */

  function openModal(html) {
    $('modalCard').innerHTML = html;
    $('modal').hidden = false;
  }
  function closeModal() {
    $('modal').hidden = true;
  }

  function renderModal() {
    var v = S.view;
    if (!v) { if (S.modalKey) { closeModal(); S.modalKey = null; } return; }
    var open = !$('modal').hidden;
    var who;

    // 1）对方请求悔棋 / 和棋，需要我裁决 —— 这个必须看得见
    if (v.pending && v.pending.by !== v.you) {
      var k1 = 'ask:' + v.pending.kind + ':' + v.pending.by;
      if (S.modalKey === k1 && open) return;
      S.modalKey = k1;
      who = (v.seats[v.pending.by] || {}).name || '对方';
      openModal(
        '<div class="mhead">' + (v.pending.kind === 'draw' ? '对方提议和棋' : '对方请求悔棋') + '</div>'
        + '<div class="mbody">' + esc(who) + (v.pending.kind === 'draw'
          ? ' 提议和棋。同意就判和，拒绝继续走棋。'
          : ' 想悔一步棋。同意后棋盘回到他走棋。') + '</div>'
        + '<div class="mrow"><button class="btn primary" data-modal="accept">同意</button>'
        + '<button class="btn" data-modal="decline">拒绝</button></div>');
      return;
    }

    // 2）对局结束后，对方想再来一局
    if (v.status === 'over' && v.rematchVotes && v.rematchVotes.length === 1 && v.rematchVotes.indexOf(v.you) < 0) {
      var k2 = 'again:' + v.moveCount;
      if (S.modalKey === k2 && open) return;
      S.modalKey = k2;
      openModal(
        '<div class="mhead">对方想再来一局</div>'
        + '<div class="mbody">同意后立刻开新局，双方交换先手。</div>'
        + '<div class="mrow"><button class="btn primary" data-modal="rematch">同意，开始新局</button>'
        + '<button class="btn" data-modal="close">先等等</button></div>');
      return;
    }

    // 3）对局结果（含对方认输、绝杀、超时、和棋）
    if (v.status === 'over' && v.result) {
      var k3 = 'over:' + v.result.winner + ':' + v.result.reason + ':' + v.moveCount;
      if (S.modalDismissed === k3) { if (S.modalKey) { closeModal(); S.modalKey = null; } return; }
      if (S.modalKey === k3 && open) return;
      S.modalKey = k3;
      var local = S.mode === 'local';
      var solo = (S.mode === 'local' || S.mode === 'ai');
      var mine = v.you === v.result.winner;
      var cls = v.result.winner === 'draw' ? '' : (mine ? ' win' : ' lose');
      var head = v.result.winner === 'draw' ? '和棋'
        : (local ? '对局结束' : (mine ? '你赢了！' : '你输了'));
      var voted = (v.rematchVotes || []).indexOf(v.you) >= 0;
      openModal(
        '<div class="mhead' + cls + '">' + esc(head) + '</div>'
        + '<div class="mbody big">' + esc(resultText(v.result)) + '</div>'
        + '<div class="mrow">'
        + (solo
          ? '<button class="btn primary" data-modal="localfresh">重新开始</button>'
          : '<button class="btn primary" data-modal="rematch"' + (voted ? ' disabled' : '') + '>'
            + (voted ? '已请求，等对方' : '再来一局') + '</button>')
        + '<button class="btn" data-modal="close">关闭</button></div>');
      return;
    }

    if (S.modalKey) { closeModal(); S.modalKey = null; }
  }

  /* ---------------- 连接 ---------------- */

  function wsOpen() { return S.ws && S.ws.readyState === 1; }

  // 对局服务器地址：config.js 的 XQ_SERVER 优先，其次网址参数 ?server=，都没有就用同域名
  function serverUrl() {
    var cfg = '';
    try { if (typeof window.XQ_SERVER === 'string') cfg = window.XQ_SERVER.trim(); } catch (e) { }
    var qs = '';
    try { qs = (new URLSearchParams(location.search).get('server') || '').trim(); } catch (e) { }
    S.serverCfg = qs || cfg || null;

    var url;
    if (!S.serverCfg) url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    else if (/^wss?:\/\//i.test(S.serverCfg)) url = S.serverCfg.replace(/\/+$/, '') + '/ws';
    else if (/^https?:\/\//i.test(S.serverCfg)) url = S.serverCfg.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws';
    else url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + S.serverCfg.replace(/\/+$/, '') + '/ws';

    // 房间号放进连接地址：Cloudflare 版靠它路由到对应房间的 Durable Object
    if (S.code) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'room=' + encodeURIComponent(S.code);
    return url;
  }

  // 本地生成房间号：Cloudflare 版必须在连接之前就知道房间号
  function newCode(len) {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', i, b;
    try {
      b = new Uint8Array(len || 6);
      crypto.getRandomValues(b);
      for (i = 0; i < b.length; i++) s += A[b[i] % A.length];
    } catch (e) {
      s = '';
      for (i = 0; i < (len || 6); i++) s += A[Math.floor(Math.random() * A.length)];
    }
    return s;
  }

  /*
   * 棋盘朝向跟着自己的座位走：执黑就翻转，让自家棋子永远在下方。
   * 换先（再来一局）后座位会互换，所以每次收到状态都要重算一次；
   * 用户手动点过「翻转棋盘」就不再自动干预。
   * 返回朝向是否变化（变化了就要重新摆放交叉点按钮）。
   */
  function autoFlipFor(you) {
    if (S.userFlipped) return false;
    if (you !== 'r' && you !== 'b') return false;   // 观战 / 本地对局不动
    var want = (you === 'b');
    if (want === S.flipped) return false;
    S.flipped = want;
    return true;
  }

  function send(obj) {
    if (wsOpen()) S.ws.send(JSON.stringify(obj));
    else S.queue.push(obj);
  }

  function connect() {
    if (S.mode !== 'online') return;
    if (S.noServer) { toast(NO_SERVER_MSG, 'err'); return; }
    // 每个房间一条连接：换房间时先把旧连接关掉
    if (S.ws) {
      try { S.ws.onclose = null; S.ws.close(); } catch (e) { }
      S.ws = null;
    }
    var url = serverUrl();
    var ws;
    try { ws = new WebSocket(url); }
    catch (e) { toast('无法连接服务器', 'err'); return; }
    S.ws = ws;
    ws.onopen = function () {
      S.retries = 0;
      // 新建房间时还没 create，不能先 join（会提示"没找到房间"）
      if (S.code && !S.pendingCreate) send({ t: 'join', code: S.code, name: S.name, token: S.token });
      var q = S.queue.slice(); S.queue = [];
      q.forEach(function (m) { send(m); });
      renderStatus();
    };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      handle(m);
    };
    ws.onclose = function () {
      renderStatus();
      if (S.exiting || S.mode !== 'online') return;
      // 没配服务器时先探一下同域名有没有对局服务（静态托管的站点没有）
      if (!S.serverCfg && !S.probed) { S.probed = true; probeLocalServer(); return; }
      scheduleReconnect();
    };
    ws.onerror = function () { };
  }

  // 同域名有没有 /health？有 = 服务器只是临时断开，可以重试；没有 = 静态托管，直接说清楚
  function probeLocalServer() {
    var settled = false;
    var timer = setTimeout(function () { if (!settled) { settled = true; noServer(); } }, 2500);
    function finish(hasServer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hasServer) scheduleReconnect(); else noServer();
    }
    function noServer() {
      S.noServer = true;
      S.retries = 40;
      toast(NO_SERVER_MSG, 'err');
    }
    try {
      fetch('/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { finish(!!(j && j.ok)); }, function () { finish(false); });
    } catch (e) { finish(false); }
  }

  function scheduleReconnect() {
    if (S.exiting || S.mode !== 'online') return;
    {
      if (S.retries < 40) {
        S.retries++;
        if (S.retries === 1) toast('连接中断，正在重连…', 'err');
        clearTimeout(S.reconnTimer);
        S.reconnTimer = setTimeout(connect, Math.min(4000, 400 * S.retries));
      } else {
        toast('连不上服务器了，刷新页面重试', 'err');
      }
    }
  }

  function handle(m) {
    switch (m.t) {
      case 'joined':
        S.pendingCreate = false;
        S.code = m.code;
        S.you = m.seat || null;
        S.token = m.token || S.token;
        if (S.token) { try { localStorage.setItem(LS_TOKEN + m.code, S.token); } catch (e) { } }
        S.seenChat = {};                    // 换房间了，聊天去重表与记录清空
        S.chats = [];
        if ($('chatlog')) $('chatlog').innerHTML = '';
        if (autoFlipFor(S.you)) { renderBg(); placeGrid(); }
        history.replaceState(null, '', '?room=' + m.code);
        hideLobby();
        renderAll();
        if (m.spectating) toast('房间满了，你在观战席', 'ok');
        break;
      case 'state':
        S.code = m.code;
        S.you = m.you;
        if (autoFlipFor(S.you)) { renderBg(); placeGrid(); }   // 再来一局会交换红黑，朝向要跟着换
        setView(m);
        renderAll();
        break;
      case 'clocks':
        if (S.view) {
          S.view.clocks = { r: m.r, b: m.b };
          S.clockBase = {
            clocks: { r: m.r, b: m.b },
            at: performance.now(),
            turn: S.view.turn,
            status: S.view.status,
            started: S.view.started
          };
          renderPlayers();
        }
        break;
      case 'chat':
        renderChat([m]);
        break;
      case 'note':
        toast(m.text, m.kind === 'ok' ? 'ok' : 'err');
        if (/不合规则|没有棋子|轮到你/.test(m.text || '')) send({ t: 'sync' });
        break;
      case 'ready':
        break;
    }
  }

  /* ---------------- 大厅 ---------------- */

  function showLobby() { $('lobby').hidden = false; }
  function hideLobby() { $('lobby').hidden = true; }

  // 已发布到公网的站点（https）别说"用局域网地址"，那是本地服务才有的说法
  function lobbyHintText() {
    return location.protocol === 'https:'
      ? '提示：创建房间后把房间号或邀请链接发给朋友，他打开就能入座；同一台设备上也可以轮流下。'
      : '提示：同一 Wi-Fi 下，朋友用你电脑的局域网地址打开即可；也可以用内网穿透让别人从外网加入。';
  }

  // 邀请链接进来时大厅会被改写，退出房间后要还原
  function resetLobby() {
    document.querySelector('.lobbycard h2').textContent = '象棋';
    $('btnCreate').textContent = '创建房间，我执红先行';
    $('lobbyHint').textContent = lobbyHintText();
  }

  function currentTime() {
    var b = document.querySelector('#timeSeg button[aria-pressed="true"]');
    return b ? parseInt(b.dataset.min, 10) || 0 : 0;
  }

  function startOnline() {
    S.mode = 'online';
    connect();
  }

  function createRoom() {
    S.name = ($('nameInput').value || '').trim() || '红方';
    saveName();
    S.token = null; S.queue = [];
    S.code = newCode(6);          // 自己先定房间号，才能连到对应的房间
    S.pendingCreate = true;
    startOnline();
    send({ t: 'create', code: S.code, name: S.name, timeBase: currentTime() });
  }

  function joinRoom() {
    var code = ($('codeInput').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { toast('房间号是 4 位', 'err'); return; }
    S.name = ($('nameInput').value || '').trim() || '棋友';
    saveName();
    S.code = code;
    S.token = getToken(code);
    S.pendingCreate = false;
    startOnline();
  }

  function saveName() {
    try { localStorage.setItem(LS_NAME, S.name); } catch (e) { }
  }

  function startLocal() {
    S.mode = 'local';
    S.code = null;
    S.you = null;
    S.local = new X.Game();
    S.flipped = false;
    $('chatCard').classList.add('hidden');
    history.replaceState(null, '', location.pathname);
    hideLobby();
    setView(localView());
    renderAll();
    toast('本地对局：两人轮流用这台设备走棋', 'ok');
  }

  function exitRoom() {
    S.exiting = true;
    clearTimeout(S.reconnTimer);
    if (S.ws) { try { S.ws.close(); } catch (e) { } }
    S.ws = null;
    S.code = null; S.you = null; S.token = null; S.view = null; S.mode = null;
    S.queue = []; S.sel = null; S.targets = [];
    S.seenChat = {};
    S.chats = [];
    $('chatlog').innerHTML = '';
    $('chatCard').classList.remove('hidden');
    $('localActions').classList.add('hidden');
    $('linkBox').classList.add('hidden');
    history.replaceState(null, '', location.pathname);
    setView(null);
    resetLobby();
    showLobby();
    renderAll();
    S.exiting = false;
  }

  function inviteText() {
    return location.origin + location.pathname + '?room=' + S.code;
  }

  function copyText(text) {
    var done = function () { toast('已复制：' + text, 'ok'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done();
      else {
        $('linkBox').classList.remove('hidden');
        $('linkInput').value = text;
        $('linkInput').select();
        toast('请手动复制下面的链接', 'err');
      }
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  canvas.addEventListener('click', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var fx = Math.round((x - geo.margin) / geo.cell);
    var fy = Math.round((y - geo.margin) / geo.cell);
    if (fx < 0 || fx > 8 || fy < 0 || fy > 9) return;
    var bx = S.flipped ? 8 - fx : fx;
    var by = S.flipped ? 9 - fy : fy;
    S.kb = false;
    onPoint(bx, by);
  });

  grid.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-bx]') : null;
    if (!b) return;
    onPoint(parseInt(b.dataset.bx, 10), parseInt(b.dataset.by, 10));
  });

  grid.addEventListener('focusin', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-bx]') : null;
    if (!b) return;
    S.cursor = X.idx(parseInt(b.dataset.bx, 10), parseInt(b.dataset.by, 10));
    if (!S.kb) S.dirty = true;
  });

  grid.addEventListener('focusout', function () { S.kb = false; S.dirty = true; });

  grid.addEventListener('keydown', function (e) {
    var dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    var d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    S.kb = true;
    var cur = S.cursor == null ? 0 : S.cursor;
    var bx = cur % 9, by = Math.floor(cur / 9);
    bx = Math.min(8, Math.max(0, bx + (S.flipped ? -d[0] : d[0])));
    by = Math.min(9, Math.max(0, by + (S.flipped ? -d[1] : d[1])));
    focusCursor(X.idx(bx, by), true);
    S.dirty = true;
  });

  document.addEventListener('pointerdown', function once() {
    Sound.init();
    document.removeEventListener('pointerdown', once);
  });

  function onActionClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    var act = btn.dataset.act;
    // 点了别的操作就退出“二次确认”状态
    if (S.confirm && act !== 'resign' && act !== 'reset' && act !== 'cancel') {
      S.confirm = null;
      renderAll();
    }
    if (act === 'sit') send({ t: 'sit' });
    else if (act === 'rematch') send({ t: 'rematch' });
    else if (act === 'reset') { S.confirm = 'reset'; renderAll(); }
    else if (act === 'reset-yes') {
      S.confirm = null;
      if (S.mode === 'ai') S.aiSide = X.other(S.aiSide);   // 人机对战重新开始会交换先手
      S.local = new X.Game();
      S.aiThinking = false;
      setView(localView());
      renderAll();
      if (S.mode === 'ai') scheduleAI();
    }
    else if (act === 'ai-undo') {
      if (!S.local) return;
      if (S.aiThinking) { toast('电脑思考中，稍等一下'); return; }
      if (!S.local.moves.length) { toast('还没走棋'); return; }
      // 撤两步：把电脑的应手和你自己那一步一起收回
      S.local.undo(S.local.moves.length > 1 ? 2 : 1);
      S.aiThinking = false;
      setView(localView());
      renderAll();
    }
    else if (act === 'local-undo') {
      if (!S.local.moves.length) { toast('还没走棋'); return; }
      S.local.undo(1);
      setView(localView());
      renderAll();
    }
    else if (act === 'resign') { S.confirm = 'resign'; renderAll(); }
    else if (act === 'resign-yes') { S.confirm = null; renderAll(); send({ t: 'resign' }); }
    else if (act === 'cancel') { S.confirm = null; renderAll(); }
    else send({ t: act });
  }
  $('actions').addEventListener('click', onActionClick);
  $('localActions').addEventListener('click', onActionClick);
  // 人机对战的难度下拉（容器是动态重建的，所以用委托的 change 事件）
  $('localActions').addEventListener('change', function (e) {
    if (e.target && e.target.id === 'aiLevel2') {
      S.aiLevel = e.target.value;
      toast('电脑棋力已切到「' + levelName(S.aiLevel) + '」', 'ok');
      setView(localView());
      renderAll();
    }
  });

  // 弹窗按钮
  $('modal').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-modal]');
    if (!btn || btn.disabled) {
      // 点空白处：需要裁决的请求不允许随手关掉
      if (e.target === $('modal') && !/data-modal="accept"/.test($('modalCard').innerHTML)) {
        S.modalDismissed = S.modalKey;
        closeModal();
        S.modalKey = null;
      }
      return;
    }
    var act = btn.dataset.modal;
    if (act === 'accept') { send({ t: 'reply', accept: true }); closeModal(); S.modalKey = null; }
    else if (act === 'decline') { send({ t: 'reply', accept: false }); closeModal(); S.modalKey = null; }
    else if (act === 'rematch') { send({ t: 'rematch' }); }
    else if (act === 'localfresh') {
      if (S.mode === 'ai') S.aiSide = X.other(S.aiSide);
      S.local = new X.Game();
      S.aiThinking = false;
      setView(localView());
      renderAll();
      if (S.mode === 'ai') scheduleAI();
      closeModal(); S.modalKey = null;
    } else if (act === 'close') {
      S.modalDismissed = S.modalKey;
      closeModal();
      S.modalKey = null;
    }
  });

  $('chatform').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('chatinput');
    var text = input.value.trim();
    if (!text) return;
    send({ t: 'chat', text: text });
    input.value = '';
  });

  $('btnFlip').addEventListener('click', function () {
    S.flipped = !S.flipped;
    S.userFlipped = true;
    renderPlayers();
    renderBg();                 // 路数标记跟朝向有关，要重画
    placeGrid();
    S.dirty = true;
  });

  // 棋盘外观：深色（默认，参考图那种）⇄ 木纹
  $('btnTheme').addEventListener('click', function () {
    setTheme(S.theme === 'dark' ? 'wood' : 'dark');
  });

  // 棋子字体：即时生效，不用重新部署
  $('fontSel').addEventListener('change', function () {
    setFont(this.value);
  });

  function setFont(name) {
    S.font = FONTS[name] ? name : 'kai';
    try { localStorage.setItem('xq.font', S.font); } catch (e) { }
    $('fontSel').value = S.font;
    S.dirty = true;                 // 棋子是每帧绘制的，重画一次即可
  }

  function setTheme(name) {
    S.theme = (name === 'wood') ? 'wood' : 'dark';
    try { localStorage.setItem('xq.theme', S.theme); } catch (e) { }
    $('btnTheme').textContent = S.theme === 'dark' ? '深色' : '木纹';
    renderBg();
    S.dirty = true;
  }

  $('btnSound').addEventListener('click', function () {
    S.sound = !S.sound;
    $('btnSound').textContent = S.sound ? '🔊' : '🔈';
    if (S.sound) { Sound.init(); Sound.click(false); }
  });

  $('btnInvite').addEventListener('click', function () { copyText(inviteText()); });
  $('codeChip').addEventListener('click', function () { copyText(inviteText()); });
  $('btnCopyLink').addEventListener('click', function () { copyText($('linkInput').value); });
  $('btnCloseLink').addEventListener('click', function () { $('linkBox').classList.add('hidden'); });
  // 退出房间也走二次确认，避免误触（用按钮本身确认，不弹原生对话框）
  $('btnExit').addEventListener('click', function () {
    if (S.confirm === 'exit') { S.confirm = null; exitRoom(); return; }
    S.confirm = 'exit';
    renderTop();
    toast(S.mode === 'online' ? '再点一次就离开房间' : '再点一次回到大厅', 'ok');
  });

  $('timeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', 'false'); });
    b.setAttribute('aria-pressed', 'true');
  });

  $('btnCreate').addEventListener('click', createRoom);
  $('btnJoin').addEventListener('click', joinRoom);
  $('btnLocal').addEventListener('click', startLocal);
  $('btnAI').addEventListener('click', function () { startAI(); });
  $('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') joinRoom(); });
  $('nameInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { if (($('codeInput').value || '').trim().length >= 4) joinRoom(); else createRoom(); }
  });

  window.addEventListener('resize', function () { layout(); });
  window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) S.dirty = true; });

  setInterval(function () {
    if (wsOpen()) send({ t: 'ping' });
    if (document.hidden) S.dirty = true;
  }, 20000);

  // 有计时的对局里刷新玩家卡片上的时间（只改这两个节点，不重建 DOM）
  setInterval(function () {
    var v = S.view;
    if (!v || !v.timeBase || v.status !== 'playing') return;
    if (document.hidden) return;
    var clocks = liveClocks();
    if (!clocks) return;
    var nodes = $('players').querySelectorAll('.pcard .clock');
    var order = S.flipped ? ['b', 'r'] : ['r', 'b'];
    for (var i = 0; i < nodes.length && i < order.length; i++) {
      var ms = clocks[order[i]];
      nodes[i].textContent = fmtClock(ms);
      nodes[i].className = 'clock' + (ms != null && ms < 30000 ? ' low' : '');
    }
  }, 250);

  /* ---------------- 启动 ---------------- */

  function init() {
    var savedTheme = '';
    try { savedTheme = localStorage.getItem('xq.theme') || ''; } catch (e) { }
    S.theme = (savedTheme === 'wood') ? 'wood' : 'dark';      // 默认深色
    $('btnTheme').textContent = S.theme === 'dark' ? '深色' : '木纹';
    var savedFont = '';
    try { savedFont = localStorage.getItem('xq.font') || ''; } catch (e) { }
    setFont(savedFont || 'kai');
    buildGrid();
    layout();
    focusCursor(0, false);
    requestAnimationFrame(loop);
    var saved = '';
    try { saved = localStorage.getItem(LS_NAME) || ''; } catch (e) { }
    if (saved) $('nameInput').value = saved;
    var params = new URLSearchParams(location.search);
    var room = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (room) {
      $('codeInput').value = room;
      $('lobbyHint').innerHTML = '朋友邀请你加入房间 <b>' + esc(room) + '</b>。填个名字点“加入”即可。';
      document.querySelector('.lobbycard h2').textContent = '加入房间 ' + room;
      $('btnCreate').textContent = '或者自己开一间新房';
      if (saved) {
        // 有存档名字就直接进房（connect() 打开后会带着 token 自动入座）
        S.name = saved; S.code = room; S.token = getToken(room);
        startOnline();
      }
      else setTimeout(function () { $('nameInput').focus(); }, 100);
    } else {
      $('lobbyHint').textContent = lobbyHintText();
    }
    /*
     * 只在"确实是静态托管"时才提示。注意别只看 https ——
     * Cloudflare Workers 那种整站部署也是 https，页面和 /ws 在同一个域名下。
     * 所以实际去问一下 /health：有对局服务器就不提示。
     */
    var cfg = '';
    try { cfg = (window.XQ_SERVER || '').trim(); } catch (e) { }
    if (location.protocol === 'https:' && !cfg) {
      var warn = function () {
        $('lobbyHint').innerHTML += '<br><br><b>注意：</b>当前页面是静态托管，没有对局服务器，联机模式不可用；'
          + '要么在 <code>config.js</code> 里把 <code>XQ_SERVER</code> 指向你的对局服务器，要么先用下面的“本地对局”。';
      };
      try {
        fetch('/health', { cache: 'no-store' })
          .then(function (r) { return r.text().then(function (t) { return { status: r.status, body: t }; }); })
          .then(function (res) {
            var ok = false;
            try { ok = JSON.parse(res.body).ok === true; } catch (e) { ok = false; }
            if (!ok) warn();          // 拿到了响应但不是对局服务器 → 确实是静态托管
          }, function () {
            // 请求本身失败（代理/拦截/离线）→ 不下结论，交给连接时的探测提示
          });
      } catch (e) { /* 同上 */ }
    }
    renderAll();
  }

  function getToken(code) {
    try { return localStorage.getItem(LS_TOKEN + code); } catch (e) { return null; }
  }

  window.__xq = { S: S, draw: draw, layout: layout, setView: setView, localView: localView, renderAll: renderAll, toast: toast };
  init();
})();


