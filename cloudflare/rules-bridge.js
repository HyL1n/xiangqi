/*
 * 规则引擎桥接：public/rules.js 是一份 UMD 文件，浏览器直接 <script> 加载，
 * Node 用 require，而 Cloudflare Workers 是 ESM。
 *
 * 这里两种环境都能拿到同一个引擎对象：
 *   - Node / wrangler 的 CJS 互操作：namespace.default 就是 module.exports
 *   - Workers（esbuild 打包，看成一个没有导出语句的模块）：执行时会
 *     走 UMD 的 root.Xiangqi = factory() 分支，挂到 globalThis 上
 *
 * 只保留这一份规则实现，perft 测试仍然测的是它。
 */
import * as NS from '../public/rules.js';

const X = (NS && NS.default && NS.default.Game ? NS.default : null)
  || globalThis.Xiangqi
  || (NS && NS.Xiangqi)
  || null;

if (!X || !X.Game) {
  throw new Error('规则引擎加载失败：public/rules.js 没有暴露 Xiangqi');
}

export default X;
