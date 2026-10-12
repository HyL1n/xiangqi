#!/usr/bin/env node
/*
 * 一键把象棋网站部署到 Cloudflare Workers（免费、不休眠、自带 HTTPS 域名）。
 *
 * 在你自己的账户会话里运行（双击 部署到Cloudflare.bat），因为：
 *   1. 第一次会打开浏览器让你登录 / 授权 Cloudflare
 *   2. 需要能连上 npm 和 Cloudflare 的网络
 *
 * 用法：
 *   node scripts/deploy-cloudflare.js --dry-run   只看要执行什么
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const SRC = path.resolve(__dirname, '..');
const WORK = process.env.XQ_WORK || path.join(os.homedir(), 'xiangqi-cloudflare');
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7897';
const DRY = process.argv.includes('--dry-run');
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'work']);

function say(t) { console.log(t); }
function step(t) { console.log('\n▶ ' + t); }
function ok(t) { console.log('  ✓ ' + t); }
function bad(t) { console.log('  ✗ ' + t); }

function run(cmd, args, opts) {
  say('  $ ' + cmd + ' ' + args.join(' '));
  if (DRY) return { status: 0, stdout: '', stderr: '' };
  return spawnSync(cmd, args, Object.assign({ cwd: WORK, encoding: 'utf8' }, opts));
}
function runLive(cmd, args) {
  say('  $ ' + cmd + ' ' + args.join(' '));
  if (DRY) return 0;
  const r = spawnSync(cmd, args, { cwd: WORK, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status;
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1200, () => { s.destroy(); resolve(false); });
  });
}

function npx() { return process.platform === 'win32' ? 'npx.cmd' : 'npx'; }

(async () => {
  say('==========================================');
  say('  象棋网站 → 部署到 Cloudflare Workers');
  say('  源目录: ' + SRC);
  say('  工作副本: ' + WORK);
  if (DRY) say('  （dry-run：只显示命令，不真正执行）');
  say('==========================================');

  step('检查环境');
  const v = spawnSync('node', ['--version'], { encoding: 'utf8' });
  if (v.status !== 0) { bad('找不到 Node.js'); process.exit(1); }
  ok('node ' + v.stdout.trim());

  step('复制项目到你自己的用户目录（避开跨账户权限问题）');
  if (DRY) {
    say('  $ 复制 ' + SRC + '  →  ' + WORK + '（跳过 node_modules/.git）');
  } else {
    try {
      fs.rmSync(WORK, { recursive: true, force: true });
      fs.cpSync(SRC, WORK, {
        recursive: true,
        filter: (src) => !SKIP.has(path.basename(src))
      });
      ok('已复制');
    } catch (e) {
      bad('复制失败: ' + e.message);
      process.exit(1);
    }
  }

  step('检查代理');
  const proxyUp = await portOpen(7897);
  if (proxyUp) ok('本地代理 7897 可用（Clash）'); else bad('本地 7897 没在监听，npm/Cloudflare 可能连不上');

  step('登录 Cloudflare（第一次会打开浏览器授权）');
  const who = run(npx(), ['--yes', 'wrangler@latest', 'whoami']);
  const loggedIn = !DRY && /You are logged in|associated with the email/i.test((who.stdout || '') + (who.stderr || ''));
  if (loggedIn) {
    ok('已登录');
  } else {
    bad('还没登录，接下来会打开浏览器');
    const st = runLive(npx(), ['--yes', 'wrangler@latest', 'login']);
    if (st !== 0) {
      bad('登录没有完成，重新双击本脚本即可继续');
      process.exit(1);
    }
  }

  step('部署（第一次会自动创建 Worker 和 Durable Object）');
  const dep = run(npx(), ['--yes', 'wrangler@latest', 'deploy']);
  const text = (dep.stdout || '') + (dep.stderr || '');
  const m = text.match(/https:\/\/[a-z0-9.\-]+\.workers\.dev/i);

  console.log('');
  if (DRY) {
    say('（dry-run 结束，没有改动任何东西）');
  } else if (dep.status === 0) {
    say('✅ 部署成功！');
    if (m) say('   网站地址: ' + m[0]);
    say('   这个地址就是完整网站（页面 + 对战服务器），发给朋友即可。');
    say('   免费额度：每天 10 万次请求，不会像 Render 那样休眠。');
  } else {
    say('❌ 部署没成功，把上面最后几行发我。常见原因：');
    say('  · 提示 Durable Objects 需要付费方案 → 告诉我，我换成不依赖 DO 的方案');
    say('  · 提示网络超时 → 先确认 Clash 开着，再重新双击');
    say('  · 提示要选账号 → 在浏览器里选中你的账号后重试');
  }
})().catch((e) => { console.error('脚本异常: ' + e.message); process.exit(1); });
