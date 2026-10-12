/*
 * 象棋 AI 的后台线程：把引擎放进 Web Worker，长考时界面不会卡住。
 * 主线程把局面发过来，这里算完把着法发回去；算不出就回 null，主线程有兜底。
 */
importScripts('rules.js', 'engine.js');

self.onmessage = function (e) {
  var d = e.data || {};
  var out = { id: d.id, move: null, score: 0, nodes: 0, ms: 0, error: null };
  var t0 = Date.now();
  try {
    var res = self.XiangqiEngine.findMove(d.board, d.side, d.cfg || {});
    out.move = res.move;
    out.score = res.score;
    out.nodes = res.nodes;
  } catch (err) {
    out.error = String(err && err.message ? err.message : err);
  }
  out.ms = Date.now() - t0;
  self.postMessage(out);
};
