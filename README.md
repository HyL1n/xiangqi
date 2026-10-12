# 象棋对弈网站

一个可以和真人朋友在浏览器里下象棋的小网站：服务端只用 Node 内置模块（**零依赖，不用 npm install**），棋盘用 Canvas 画，规则判定、记谱、计时、悔棋都在服务端裁决，客户端改不了棋盘。

## 怎么开始

1. 装好 [Node.js](https://nodejs.org)（LTS 版本即可，本机已是 v24）。
2. 双击 **`启动象棋.bat`**（或在这个目录执行 `node server.js`）。
3. 窗口里会打印两个地址：
   - `http://localhost:8080` —— 你自己用
   - `http://192.168.x.x:8080` —— **同一个 Wi-Fi 下**朋友用这个
4. 你点“创建房间”，把 4 位房间号或邀请链接发给朋友；朋友打开链接、填个名字就能入座。

想换端口：`node server.js --port 9000`，或 `启动象棋.bat 9000`。

## 三个人以上 / 外网对战

- 房间里第三个人自动变成**观战**，可以看棋、聊天；有人离开座位后观战者可以入座。
- 只想在局域网玩：上面的 `192.168.x.x` 地址就够。
- 想让不在同一 Wi-Fi 的朋友加入：把这个服务放到有公网地址的地方（云服务器 `node server.js` 即可），或者用内网穿透（Cloudflare Tunnel、ngrok、frp 之类）把 8080 端口暴露出去，把生成的 https 地址发给朋友。用 `https` 地址打开时是 `wss://`，聊天、走子都照常。

## 部署到公网（含 Netlify）

先说清楚一件事：**Netlify 只能托管静态文件**。它没有常驻进程，Functions 是无状态、短连接的，**不支持 WebSocket**；而对战需要长连接 + 内存里的房间状态（`server.js`）。所以：

- 纯 Netlify 部署 = 只有页面，联机按钮会明确告诉你缺服务器（不会静默失败），只能玩“本地对局”。
- 想联机，要么整站放到支持 WebSocket 的平台，要么前端在 Netlify、对战服务器放到别处。

### 方案 A｜整站部署（最省事，推荐）

支持 WebSocket、能跑常驻 Node 进程的平台都行：Render、Railway、Fly.io、自己的 VPS。仓库里已经备好 `Dockerfile` 和 `render.yaml`（零依赖，不需要 npm install）。

#### Render（推荐，免费且原生支持 WebSocket）

1. 把代码推到 GitHub：这个目录已经是 git 仓库（已提交），只需在 GitHub 上新建一个空仓库，然后

   ```bash
   cd outputs/xiangqi
   git remote add origin https://github.com/你的用户名/xiangqi.git
   git branch -M main
   git push -u origin main
   ```

2. Render 控制台 → **New +** → **Blueprint** → 选中这个仓库 → Apply（它会读 `render.yaml`）。
   不想用 Blueprint 就手动建：New + → Web Service → 选仓库 → Runtime `Node` → Build Command 填 `echo no build needed` → Start Command 填 `npm start` → Health Check Path `/health`。
3. 等 1–2 分钟，拿到 `https://xiangqi-xxxx.onrender.com` —— **这就是完整网站**：页面、走子、聊天、观战都在同一个域名下，`config.js` 一个字都不用改，走子自动走 `wss://` 长连接。
4. 把这个地址发给朋友，创建房间互发房间号即可。

两个注意点（都是免费档的固有特性，不是 bug）：

- 免费实例约 15 分钟无人访问会休眠，下一个人打开要等 30–60 秒冷启动；想随时可用就升级实例，或改用 Cloudflare Workers + Durable Objects 版本。
- `render.yaml` 里 `region: singapore`（离国内最近），可以按需改；**不要自己设 `PORT` 环境变量**，Render 会注入端口，`server.js` 读的是 `process.env.PORT`，写死会连不上。

#### Railway / Fly.io

这两个都能直接用仓库里的 `Dockerfile`：

- Railway：New Project → Deploy from GitHub repo，自动识别 Dockerfile。
- Fly：在项目目录里 `fly launch`（会沿用 Dockerfile），再 `fly deploy`。

#### 自己的 VPS

```bash
# Docker 方式
docker build -t xiangqi .
docker run -d --name xiangqi --restart unless-stopped -p 80:8080 xiangqi
```

```bash
# 不用 Docker：直接用 node 跑（或用 systemd / pm2 守护）
node server.js --port 8080
```

想要 HTTPS 就套一层 Nginx 反代，**别忘 WebSocket 升级的头**（这是最常见的踩坑点）：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### 方案 B｜前端放 Netlify + 对战服务器放别处

1. 先按方案 A 起一台对战服务器，记下地址，例如 `wss://xiangqi-xxxx.onrender.com`。
2. 打开 `public/config.js`，填上：

   ```js
   window.XQ_SERVER = 'wss://xiangqi-xxxx.onrender.com';
   ```

   （也可以不写 `wss://`，只写域名，代码会按页面协议补全；临时测试还能用网址参数 `?server=域名` 覆盖。）
3. 发布前端，二选一：
   - **Netlify Drop**：把 `public` 文件夹直接拖到 <https://app.netlify.com/drop>，几秒就有 HTTPS 域名。
   - **连 Git**：Netlify 会自动读仓库里的 `netlify.toml`（发布目录已经设成 `public`）。
4. 打开 Netlify 域名 → 创建房间 → 生成的邀请链接就是 Netlify 域名，朋友点开就能下；所有走子/聊天都走 `wss://` 到那台服务器。

### 方案 C｜只想先看看页面

把 `public` 拖到 Netlify Drop 就够了：能玩“同一台设备轮流下”的本地对局，棋盘、记谱、规则判定、音效都在前端跑。

### 方案 D｜Cloudflare Workers（免费、不用绑卡、不休眠）— 推荐

这是目前最省心的免费方案：不需要信用卡，免费额度每天 10 万次请求，**不会像 Render 免费档那样闲置休眠**，自带 `https://xxx.workers.dev` 域名。

架构上有一点不同：Workers 没有常驻进程，所以**每个房间由一个 Durable Object 承载**，静态页面由 Workers 的静态资源功能直接提供 —— 整个网站还是同一个域名，前端一行都不用改。

**一键部署**

1. 注册一个免费 Cloudflare 账号（<https://dash.cloudflare.com/sign-up>，填邮箱+密码即可，不需要绑卡，也不需要先有域名）。
2. 双击项目里的 **`部署到Cloudflare.bat`**：
   - 它会先把项目复制到 `%USERPROFILE%\xiangqi-cloudflare`（避开跨账户权限问题）
   - 第一次会打开浏览器让你**授权登录 Cloudflare**（点 Allow / 选你的账号）
   - 然后自动执行 `wrangler deploy`，创建 Worker、Durable Object 和静态资源
3. 成功后窗口里会打印网站地址：

   ```
   ✅ 部署成功！
      网站地址: https://xiangqi.你的子域.workers.dev
   ```

   这个地址就是完整网站，发给朋友即可。以后想更新，改完代码再双击一次这个 bat。

**手动部署（等价）**

```bash
cd xiangqi
npx wrangler login      # 浏览器授权
npx wrangler deploy
```

配置在仓库根目录的 `wrangler.toml`：Worker 入口 `cloudflare/worker.js`，静态资源目录 `./public`，Durable Object 绑定名 `ROOMS`；免费方案要求用 SQLite 版 DO，所以迁移写的是 `new_sqlite_classes`。

**成本与限制**

- 免费额度：Workers 每天 10 万次请求；Durable Object 用 WebSocket Hibernation（没人说话时不占时长、会被回收，靠 storage 里的房间快照恢复），两个人的一局棋远远用不完。
- 房间数据存在 Durable Object 的存储里，重新部署不会丢正在进行中的棋局。
- 单个 DO 是单点的：同一房间的所有消息都落到同一个实例上，这也是它保证不串房间的原因。

### 为什么不直接在 Netlify 上做联机

把 WebSocket 换成 HTTP 轮询 + Netlify Blobs 存房间状态理论上可行，但走子要 1–2 秒后才出现在对方屏幕上，而且轮询很快会吃光 Functions 的免费调用额度（两名玩家 1.5 秒轮询一次，一个月大概只能下 50 局）。想要这种“纯 Netlify”的版本可以再改。

## 对局里能做什么

| 功能 | 说明 |
| --- | --- |
| 走子 | 点自己的棋子，再点亮点落子；吃子、翻山炮都会标出来 |
| 规则 | 马蹩腿、象塞眼、过河兵、九宫、飞将（将帅照面）全部判定；将军会闪红圈 |
| 胜负 | 绝杀、困毙、超时、认输、三次重复局面判和、60 回合无吃子判和 |
| 记谱 | 中文记谱：红方「炮二平五」，黑方「炮2平5」，同线同子自动写「前/后」 |
| 计时 | 建房时可选不限时 / 5 / 10 / 15 / 30 分钟包干 |
| 悔棋 | 走错一步点“悔棋”，对方同意就回到自己走棋 |
| 求和 | 双方都同意算和棋 |
| 再来一局 | 双方都点“再来一局”即开新局，**自动交换先手** |
| 聊天 | 右侧聊天区，走子提示、将军、胜负都会自动播报 |
| 断线 | 刷新或换设备后用原链接进来，凭本地令牌自动回到自己的座位 |
| 观战 | 房间满了以观战身份进入，棋盘实时同步 |
| 本地对局 | 没有网络时，两人用同一台设备轮流下 |
| **人机对战** | 大厅里选「和电脑对弈」，电脑执黑陪你下；三档难度（简单／普通／较难），重新开始会自动交换先手 |

### 关于人机对战（内置引擎）

`public/engine.js` 是一个**完全跑在浏览器里的纯 JS 象棋引擎**（α-β 搜索 + 子力位置估值 + 吃子静态搜索 + 迭代加深控时）。

- 为什么不用皮卡鱼：皮卡鱼是 C++ 子进程（UCI 协议），Cloudflare Workers 不能跑原生程序；WASM 版带 NNUE 权重几十 MB，手机吃不消。这个内置引擎不依赖任何外部程序，**线上（Cloudflare）和手机都能直接玩**。
- 强度：三档分别是 简单（120ms/2 层，带随机性）／普通（420ms/3 层）／较难（1100ms/4 层），大致是"业余棋友"水平，适合陪练。
- 它算完只是**当好一次普通走子**发给服务器，服务端依然做权威校验，所以联机那套规则判定完全不受影响。
- 想做真·大师级陪练，可以自己电脑跑 Node 服务（`启动象棋.bat`）时挂上引擎，浏览器端这套作为线上兜底。

小提示：

- 右上角 🔊 是声音开关；「翻转棋盘」可以换自己的视角（执黑时自动翻转）。
- 棋盘上的交叉点是真实的按钮，键盘 Tab 进入后可用方向键移动、回车选子落子，读屏软件也能读出每个点位的棋子。
- 手机浏览器打开局域网地址即可，界面会自动变成窄屏布局。

## 文件结构

```
xiangqi/
├── 启动象棋.bat      双击启动（Windows）
├── 推送到GitHub.bat  双击把代码推到 GitHub
├── 部署到Cloudflare.bat  双击部署到 Cloudflare Workers
├── server.js         HTTP 服务 + 自己实现的 WebSocket + 房间与对局裁决
├── screenshot.png    对局界面截图
├── netlify.toml      Netlify 静态发布配置（只发布 public/）
├── Dockerfile        对战服务器镜像（Render / Railway / Fly / VPS 都能用）
├── render.yaml       Render 一键部署蓝图
├── wrangler.toml     Cloudflare Workers 部署配置
├── package.json      npm start / npm test（无依赖，仅给部署平台识别用）
├── cloudflare/
│   ├── worker.js       Worker 入口 + 房间 Durable Object（WebSocket Hibernation）
│   ├── room.js         房间与对局逻辑（纯逻辑，Node 里也能测）
│   └── rules-bridge.js 让 UMD 版规则引擎同时被 Workers(ESM) 和 Node 复用
├── scripts/
│   ├── push-to-github.js   一键推送脚本
│   └── deploy-cloudflare.js 一键部署脚本
├── tests/
│   ├── test-rules.js   规则引擎测试（perft + 记谱，需要 Node）
│   ├── test-server.js  端到端测试（建房/走子/悔棋/和棋/换先/观战/重连，25 项）
│   └── test-cloudflare-room.mjs  Cloudflare 版房间逻辑测试（40 项）
└── public/
    ├── index.html    页面结构
    ├── style.css     样式（含窄屏适配）
    ├── rules.js      象棋规则引擎（浏览器 / Node 共用，含中文记谱）
    ├── engine.js     内置象棋 AI（纯 JS，浏览器里算，含三档难度）
    ├── config.js     对局服务器地址（静态托管到 Netlify 时填这里）
    └── app.js        棋盘绘制、交互、联机协议
```

## 规则引擎的正确性

用标准 perft 数据校准着法生成：

| 深度 | 本引擎 | 标准值 |
| --- | --- | --- |
| 1 | 44 | 44 |
| 2 | 1920 | 1920 |
| 3 | 79666 | 79666 |
| 4 | 3290240 | 3290240 |

服务端另有 25 项端到端测试（建房、入座、轮次校验、非法着法拦截、悔棋、和棋、换先、观战、断线重连、认输）。

## 已知取舍

- 长将（循环将军）按“三次重复局面判和”处理，没有实现中国象棋竞赛规则里的长将判负细则。
- 房间数据放在内存里，重启服务器后房间会清空；同时没有账号体系，靠本地令牌认座位。
