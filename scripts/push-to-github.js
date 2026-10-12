#!/usr/bin/env node
/*
 * 一键把象棋项目推送到 GitHub。
 * 必须在你自己的账户会话里运行（双击 推送到GitHub.bat），因为：
 *   1. 需要你的 GitHub 授权（git 会弹出浏览器让你点 Authorize）
 *   2. 需要能连上 github.com 的网络（走你的 Clash 代理）
 *
 * 用法：
 *   node scripts/push-to-github.js            正常推送
 *   node scripts/push-to-github.js --dry-run  只打印要执行的命令，不做任何改动
 *   XQ_REPO_URL=https://github.com/你/仓库.git node scripts/push-to-github.js   换仓库地址
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');

const SRC = path.resolve(__dirname, '..');
// 项目文件可能来自别的账户，直接在自己账户里 git 写 .git 会被拒绝。
// 所以先把整个项目（含 .git 历史）复制到自己的用户目录，在那里推送。
const WORK = process.env.XQ_WORK || path.join(os.homedir(), 'xiangqi-deploy');
const DIR = SRC;
const REPO_URL = process.env.XQ_REPO_URL || 'https://github.com/HyL1n/xiangqi.git';
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7897';
const DRY = process.argv.includes('--dry-run');

function say(t) { console.log(t); }
function step(t) { console.log('\n▶ ' + t); }
function ok(t) { console.log('  ✓ ' + t); }
function bad(t) { console.log('  ✗ ' + t); }

function git(args, opts) {
  const full = ['-C', WORK].concat(args);
  say('  $ git ' + args.join(' '));
  if (DRY) return { status: 0, stdout: '', stderr: '' };
  return spawnSync('git', full, Object.assign({ encoding: 'utf8' }, opts));
}
function gitOK(args) {
  const r = git(args);
  return r.status === 0;
}
function out(r) { return ((r && r.stdout) || '') + ((r && r.stderr) || ''); }

function portOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: host, port: port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1200, () => { s.destroy(); resolve(false); });
  });
}

(async () => {
  say('==========================================');
  say('  象棋项目 → 推送到 GitHub');
  say('  源目录: ' + SRC);
  say('  工作副本: ' + WORK);
  say('  目标: ' + REPO_URL);
  if (DRY) say('  （dry-run：只显示命令，不真正执行）');
  say('==========================================');

  step('检查环境');
  const v = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (v.status !== 0) { bad('找不到 git，请先安装 Git for Windows'); process.exit(1); }
  ok(v.stdout.trim());

  step('复制项目到你自己的用户目录（避开跨账户权限问题）');
  if (DRY) {
    say('  $ 复制 ' + SRC + '  →  ' + WORK);
  } else {
    try {
      fs.rmSync(WORK, { recursive: true, force: true });
      fs.cpSync(SRC, WORK, { recursive: true });
      ok('已复制到 ' + WORK);
    } catch (e) {
      bad('复制失败: ' + e.message);
      bad('可以手动把 xiangqi 文件夹复制到桌面，再在副本里运行 scripts\\push-to-github.js');
      process.exit(1);
    }
  }

  // 双保险：把副本也加进 git 白名单
  git(['config', '--global', '--add', 'safe.directory', DIR]);
  git(['config', '--global', '--add', 'safe.directory', WORK]);
  ok('已把目录加入 git 白名单（避免 dubious ownership 报错）');

  step('检查本地仓库');
  if (!gitOK(['rev-parse', '--is-inside-work-tree'])) {
    bad('这里不是 git 仓库，脚本会先初始化');
    gitOK(['init']);
  }
  const nameR = git(['config', 'user.name']);
  if (!(nameR.stdout || '').trim()) { git(['config', 'user.name', 'xiangqi']); ok('已设置本地提交者名字'); }
  const mailR = git(['config', 'user.email']);
  if (!(mailR.stdout || '').trim()) { git(['config', 'user.email', 'xiangqi@local']); ok('已设置本地提交者邮箱'); }

  const dirty = (git(['status', '--porcelain']).stdout || '').trim();
  if (dirty) {
    bad('有未提交的改动，先自动提交一次');
    git(['add', '-A']);
    git(['commit', '-m', '更新象棋网站']);
  } else {
    ok('工作区干净，没有未提交改动');
  }

  step('确认要推送的提交');
  const log = git(['log', '--oneline', '-3']);
  say((log.stdout || '').trim() || '(空)');

  step('设置远程仓库');
  const cur = (git(['remote', 'get-url', 'origin']).stdout || '').trim();
  if (!cur) { git(['remote', 'add', 'origin', REPO_URL]); ok('已添加 origin'); }
  else if (cur !== REPO_URL) { git(['remote', 'set-url', 'origin', REPO_URL]); ok('已修正 origin'); }
  else ok('origin 已正确');

  step('整理分支名');
  git(['branch', '-M', 'main']);

  step('检查代理');
  const proxyUp = await portOpen('127.0.0.1', 7897);
  if (proxyUp) ok('本地代理 7897 可用（Clash）'); else bad('本地 7897 没在监听，推送可能连不上 github');

  step('推送（这一步会弹出 GitHub 授权，请在浏览器里确认）');
  let pushed = gitOK(['push', '-u', 'origin', 'main']);
  if (!pushed && proxyUp) {
    bad('第一次推送失败，改用显式代理再试一次');
    pushed = gitOK(['-c', 'http.proxy=' + PROXY, 'push', '-u', 'origin', 'main']);
  }

  console.log('');
  if (pushed) {
    say('✅ 推送成功！');
    say('   仓库地址: ' + REPO_URL.replace(/\.git$/, ''));
    say('   下一步：去 Render 用这个仓库建服务（Blueprint 会读 render.yaml）。');
    say('   这个临时副本可以删掉：' + WORK);
  } else {
    say('❌ 推送没有成功，对照下面的情况处理，然后重新双击本脚本：');
    say('');
    say('  · 提示 Repository not found / 403');
    say('      → 说明 GitHub 上还没有这个仓库。先打开 https://github.com/new');
    say('        名字填 xiangqi，选 Public，不要勾 Add a README，点 Create repository。');
    say('  · 弹出浏览器要求授权 → 点 Authorize 即可（只授权这台电脑访问你的仓库）。');
    say('  · 提示 timeout / 连接被重置 → 说明代理没生效，先在 Clash Verge 里打开系统代理，');
    say('     或执行一次：git config --global http.proxy ' + PROXY);
    say('  · 提示 Permission denied / 需要密码 → GitHub 不再接受账号密码，');
    say('     请用浏览器授权，或改用 Personal Access Token 作为密码。');
  }
})().catch((e) => { console.error('脚本异常: ' + e.message); process.exit(1); });
