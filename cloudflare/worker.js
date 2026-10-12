/*
 * Cloudflare Workers + Durable Objects 版后端
 *
 * 路由：
 *   GET /health          → {"ok":true}
 *   GET /ws?room=CODE    → 升级成 WebSocket，交给该房间的 Durable Object
 *   其它路径             → 交给静态资源（public/，由 wrangler [assets] 提供）
 *
 * 每个房间一个 Durable Object 实例（idFromName(code)），消息协议与 server.js 完全一致。
 * 用 WebSocket Hibernation：没人说话时 DO 不计费、会被回收，靠 storage 里的房间快照恢复。
 */
import {
  newRoom, handleMessage, publicState, nextDeadline, checkTimeout,
  resultText, clockNow, reconcileSeats
} from './room.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, backend: 'cloudflare-workers' }), { headers: JSON_HEADERS });
    }

    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return new Response('missing room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('not found', { status: 404 });
  }
};

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._room = null;
    this._conns = new Map();   // ws -> conn（休眠唤醒后按需重建）
  }

  /* ---------- 房间数据：内存 + storage 快照 ---------- */

  async room() {
    if (this._room) return this._room;
    const saved = await this.state.storage.get('room');
    if (saved) {
      this._room = saved;
      if (!this._room.seats) this._room.seats = { r: null, b: null };
    } else {
      const code = this.state.id && this.state.id.name ? this.state.id.name : 'ROOM';
      this._room = newRoom(code, 0, Date.now());
    }
    // 记录已经下发到哪一条聊天：休眠唤醒后只补发新消息，不重放历史
    this._lastChatId = this._room.chatSeq || 0;
    return this._room;
  }

  /*
   * 把这次处理中新产生的聊天/系统消息发给房间里每个人。
   * 聊天只写进房间状态是不够的 —— DO 广播的是棋局状态，不转发消息，
   * 线上曾经因此"聊天谁都看不到"。
   */
  flushChat(room) {
    const last = this._lastChatId || 0;
    const fresh = room.chat.filter((m) => m && m.id && m.id > last);
    if (!fresh.length) return;
    this._lastChatId = fresh[fresh.length - 1].id;
    const conns = this.liveConns();
    for (const c of conns) {
      for (const m of fresh) c.send(m);
    }
  }

  async persist() {
    if (this._room) await this.state.storage.put('room', this._room);
  }

  /* ---------- 连接 ---------- */

  connFor(ws) {
    let c = this._conns.get(ws);
    if (c) return c;
    let a = {};
    try { a = ws.deserializeAttachment() || {}; } catch (e) { a = {}; }
    c = {
      ws,
      name: a.name || '棋友',
      seat: a.seat || null,
      token: a.token || null,
      send: (obj) => { try { ws.send(JSON.stringify(obj)); } catch (e) { } }
    };
    this._conns.set(ws, c);
    return c;
  }

  saveAttachment(c) {
    try { c.ws.serializeAttachment({ name: c.name, seat: c.seat, token: c.token }); } catch (e) { }
  }

  liveConns() {
    const out = [];
    for (const ws of this.state.getWebSockets()) out.push(this.connFor(ws));
    return out;
  }

  async broadcast() {
    const room = await this.room();
    const now = Date.now();
    const conns = this.liveConns();
    reconcileSeats(room, conns);          // 换先/重连后按 token 重新对齐座位
    for (const c of conns) {
      c.send(publicState(room, c, now));
      this.saveAttachment(c);
    }
  }

  envApi() {
    return {
      now: () => Date.now(),
      send: (c, obj) => c.send(obj),
      broadcast: () => this.broadcast()
    };
  }

  /* ---------- 定时（判超时） ---------- */

  async syncAlarm() {
    const room = await this.room();
    const at = nextDeadline(room, Date.now());
    const cur = await this.state.storage.getAlarm();
    if (!at) { if (cur) await this.state.storage.deleteAlarm(); return; }
    if (!cur || Math.abs(cur - at) > 400) await this.state.storage.setAlarm(at);
  }

  async alarm() {
    const room = await this.room();
    const fired = checkTimeout(room, Date.now());
    if (fired) {
      await this.persist();
      await this.broadcast();
    }
    await this.syncAlarm();
  }

  /* ---------- HTTP：升级成 WebSocket ---------- */

  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    try { server.serializeAttachment({ name: '棋友', seat: null, token: null }); } catch (e) { }
    await this.room();
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------- WebSocket 事件 ---------- */

  async webSocketMessage(ws, message) {
    const room = await this.room();
    const conn = this.connFor(ws);
    let msg = null;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch (e) {
      conn.send({ t: 'note', text: '消息格式不对' });
      return;
    }
    if (msg && msg.t === 'ping') { this.saveAttachment(conn); return; }

    let changed = false;
    try {
      changed = handleMessage(room, conn, msg, this.envApi());
    } catch (e) {
      conn.send({ t: 'note', text: '服务器处理出错：' + (e && e.message ? e.message : '未知错误') });
    }

    if (changed) {
      await this.persist();
      this.flushChat(room);
      await this.broadcast();
      await this.syncAlarm();
    } else {
      this.saveAttachment(conn);
    }
  }

  async webSocketClose(ws) {
    const room = await this.room();
    const conn = this.connFor(ws);
    if (conn.seat && room.seats[conn.seat] && room.seats[conn.seat].token === conn.token) {
      room.seats[conn.seat].online = false;
      room.chat.push({ t: 'chat', name: '系统', text: conn.name + ' 暂时离开', ts: Date.now(), system: true, kind: 'info' });
    } else {
      room.spectators = Math.max(0, room.spectators - 1);
    }
    this._conns.delete(ws);
    await this.persist();
    await this.broadcast();
  }

  async webSocketError(ws) {
    try { await this.webSocketClose(ws); } catch (e) { }
  }
}

export { resultText, clockNow };
