/*
 * 前端配置：对局服务器地址
 *
 * 留空 = 和页面同一个域名（本地跑 server.js，或自己用 VPS/容器整站部署时就是这种情况）。
 *
 * 把前端放到静态托管（Netlify / Vercel / GitHub Pages / OSS…）时，
 * 这里必须填上游戏服务器的地址，否则只能玩“本地对局”：
 *
 *   window.XQ_SERVER = 'wss://xiangqi-xxxx.onrender.com';
 *
 * 也可以临时用网址参数覆盖，方便测试：
 *   https://你的站点.netlify.app/?server=xiangqi-xxxx.onrender.com
 */
window.XQ_SERVER = '';
