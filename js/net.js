// Sessions and transports.
// Online play is peer to peer: the host's browser runs the Room and guests connect over WebRTC data channels.
// Signaling uses the free public PeerJS server by default, so no backend is needed.

import { Room } from './room.js';

const PREFIX = 'overdrop-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PING_MS = 3000;
const STALE_MS = 12000;

export const BOT_NAMES = { easy: 'Rookie Bot', normal: 'Grinder Bot', hard: 'Overlord Bot' };

export function makeCode(n = 5) {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function getCid() {
  try {
    let id = sessionStorage.getItem('overdrop.cid');
    if (!id) {
      id = makeCode(12);
      sessionStorage.setItem('overdrop.cid', id);
    }
    return id;
  } catch {
    return makeCode(12);
  }
}

function query() {
  return new URLSearchParams(location.search);
}

function peerOptions() {
  const q = query();
  const opts = { debug: 0 };
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport') || 9000);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') === '1';
  }
  return opts;
}

const useLocalNet = () => query().get('net') === 'local';

function friendly(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') return new Error('Room not found. Check the code and make sure the host is still in the lobby.');
  if (type === 'browser-incompatible') return new Error('This browser does not support peer to peer play. Try a current Chrome, Edge, Firefox or Safari.');
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return new Error('Could not reach the matchmaking server. Check your connection and try again.');
  if (err instanceof Error) return err;
  return new Error('Connection failed. Try again.');
}

// ---------- PeerJS transports ----------

class PeerHost {
  constructor() {
    this.conns = new Map();
    this.next = 1;
    this.onOpen = () => {};
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  start(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Networking library failed to load. Refresh and try again.')); return; }
      const peer = new window.Peer(PREFIX + code, peerOptions());
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) { peer.destroy(); reject(new Error('Could not reach the matchmaking server. Try again.')); }
      }, 12000);
      peer.on('open', () => { opened = true; clearTimeout(timer); resolve(); });
      peer.on('error', (err) => {
        if (!opened) { clearTimeout(timer); peer.destroy(); reject(err); } else console.warn('peer error', err && err.type);
      });
      peer.on('connection', (conn) => this.attach(conn));
      peer.on('disconnected', () => {
        if (peer.destroyed) return;
        setTimeout(() => { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch { /* retry on next event */ } }, 1500);
      });
    });
  }

  attach(conn) {
    const id = this.next++;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.conns.delete(id);
      this.onClose(id);
    };
    conn.on('open', () => { this.conns.set(id, conn); this.onOpen(id); });
    conn.on('data', (d) => this.onMessage(id, d));
    conn.on('close', close);
    conn.on('error', close);
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) { try { c.send(msg); } catch { /* channel closing */ } }
  }

  drop(id) {
    const c = this.conns.get(id);
    if (c) { try { c.close(); } catch { /* ignore */ } }
  }

  destroy() {
    try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
  }
}

class PeerGuest {
  constructor() {
    this.onMessage = () => {};
    this.onClose = () => {};
    this.closed = false;
  }

  connect(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) { reject(new Error('Networking library failed to load. Refresh and try again.')); return; }
      const peer = new window.Peer(peerOptions());
      this.peer = peer;
      let done = false;
      const fail = (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { peer.destroy(); } catch { /* ignore */ }
        reject(friendly(e));
      };
      const timer = setTimeout(() => fail(new Error('The room did not answer. Check the code and try again.')), 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (d) => this.onMessage(d));
        conn.on('close', () => this.lost());
        conn.on('error', () => this.lost());
      });
      peer.on('error', (err) => {
        if (!done) fail(err);
        else if (err && (err.type === 'peer-unavailable' || err.type === 'webrtc')) this.lost();
      });
    });
  }

  lost() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  send(msg) {
    if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch { /* channel closing */ } }
  }

  destroy() {
    this.closed = true;
    try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
  }
}

// ---------- Same-browser transports (add ?net=local to the URL, for testing in several tabs) ----------

class LocalHost {
  constructor() {
    this.conns = new Set();
    this.onOpen = () => {};
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  start(code) {
    this.ch = new BroadcastChannel('overdrop-net-' + code);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== 'host') return;
      if (m.type === 'open') {
        this.conns.add(m.from);
        this.ch.postMessage({ to: m.from, type: 'opened' });
        this.onOpen(m.from);
      } else if (m.type === 'msg' && this.conns.has(m.from)) {
        this.onMessage(m.from, JSON.parse(m.msg));
      } else if (m.type === 'close' && this.conns.has(m.from)) {
        this.conns.delete(m.from);
        this.onClose(m.from);
      }
    };
    return Promise.resolve();
  }

  send(id, msg) {
    if (this.conns.has(id)) this.ch.postMessage({ to: id, type: 'msg', msg: JSON.stringify(msg) });
  }

  drop(id) {
    if (!this.conns.has(id)) return;
    this.ch.postMessage({ to: id, type: 'close' });
    this.conns.delete(id);
    this.onClose(id);
  }

  destroy() {
    if (!this.ch) return;
    this.ch.postMessage({ to: '*', type: 'close' });
    this.ch.close();
    this.ch = null;
  }
}

class LocalGuest {
  constructor() {
    this.onMessage = () => {};
    this.onClose = () => {};
    this.closed = false;
    this.id = 'g' + makeCode(8);
  }

  connect(code) {
    return new Promise((resolve, reject) => {
      this.ch = new BroadcastChannel('overdrop-net-' + code);
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('Room not found. Check the code and make sure the host is still in the lobby.'));
      }, 1500);
      this.ch.onmessage = (e) => {
        const m = e.data;
        if (!m || (m.to !== this.id && m.to !== '*')) return;
        if (m.type === 'opened' && !done) { done = true; clearTimeout(timer); resolve(); } else if (m.type === 'msg') this.onMessage(JSON.parse(m.msg));
        else if (m.type === 'close') this.lost();
      };
      this.ch.postMessage({ to: 'host', from: this.id, type: 'open' });
    });
  }

  lost() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  send(msg) {
    if (this.ch && !this.closed) this.ch.postMessage({ to: 'host', from: this.id, type: 'msg', msg: JSON.stringify(msg) });
  }

  destroy() {
    if (this.ch) {
      if (!this.closed) this.ch.postMessage({ to: 'host', from: this.id, type: 'close' });
      this.ch.close();
      this.ch = null;
    }
    this.closed = true;
  }
}

// ---------- Helpers shared by host and local sessions ----------

let botWorker = null;
let botSeq = 0;
const botPending = new Map();

export function botPlanner(input) {
  return new Promise((resolve) => {
    const fallback = () => import('./bot.js').then((m) => resolve(m.planTurn(input))).catch(() => resolve(null));
    try {
      if (!botWorker) {
        botWorker = new Worker(new URL('./bot.worker.js', import.meta.url), { type: 'module' });
        botWorker.onmessage = (e) => {
          const done = botPending.get(e.data.id);
          if (done) { botPending.delete(e.data.id); done(e.data.plan); }
        };
        botWorker.onerror = () => {
          botWorker = null;
          for (const [, done] of botPending) done(null);
          botPending.clear();
        };
      }
      const id = ++botSeq;
      botPending.set(id, (plan) => (plan ? resolve(plan) : fallback()));
      botWorker.postMessage({ id, input });
    } catch {
      fallback();
    }
  });
}

function startTicker(fn) {
  try {
    const w = new Worker(new URL('./ticker.worker.js', import.meta.url));
    w.onmessage = () => fn();
    w.postMessage('start');
    return () => w.terminate();
  } catch {
    const id = setInterval(fn, 200);
    return () => clearInterval(id);
  }
}

// Routes UI and network messages into the Room.
function routeMessage(room, cid, msg) {
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.t) {
    case 'act': return room.act(cid, msg.a);
    case 'sit': room.sit(cid, msg.i); break;
    case 'spectate': room.spectate(cid); break;
    case 'cfg': room.configure(cid, msg.p || {}); break;
    case 'start': room.start(cid); break;
    case 'rematch': room.rematch(cid); break;
    case 'lobby': room.toLobby(cid); break;
    case 'emote': room.emote(cid, msg.e); break;
    case 'name': room.rename(cid, msg.n); break;
    case 'lname': room.setLocalName(cid, msg.i, msg.n); break;
    default: break;
  }
  return null;
}

class BaseSession {
  constructor({ onSnapshot, onEvent, onStatus }) {
    this.onSnapshot = onSnapshot || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.pushQueued = false;
  }

  schedulePush() {
    if (this.pushQueued) return;
    this.pushQueued = true;
    queueMicrotask(() => {
      this.pushQueued = false;
      if (!this.closed) this.pushAll();
    });
  }

  send(msg) {
    const res = routeMessage(this.room, this.cid, msg);
    if (res && !res.ok) this.onEvent({ t: 'err', m: res.error });
  }
}

// ---------- Host ----------

export class HostSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.name = opts.name;
    this.cid = getCid();
    this.connCid = new Map(); // connId -> cid
    this.cidConn = new Map(); // cid -> latest connId
    this.lastSeen = new Map();
  }

  async open() {
    let lastErr = null;
    for (let attempt = 0; attempt < 4 && !this.transport; attempt++) {
      const code = makeCode();
      const t = useLocalNet() ? new LocalHost() : new PeerHost();
      try {
        await t.start(code);
        this.transport = t;
        this.code = code;
      } catch (err) {
        t.destroy();
        lastErr = err;
        if (!(err && err.type === 'unavailable-id')) break;
      }
    }
    if (!this.transport) throw friendly(lastErr);
    if (this.closed) {
      this.transport.destroy();
      throw new Error('Cancelled');
    }

    this.room = new Room({
      kind: 'online',
      hostCid: this.cid,
      code: this.code,
      onUpdate: () => this.schedulePush(),
      onEvent: (ev) => this.broadcast({ t: 'ev', ev }, true),
    });
    this.room.join(this.cid, this.name);

    const t = this.transport;
    t.onOpen = (id) => this.lastSeen.set(id, Date.now());
    t.onMessage = (id, msg) => this.receive(id, msg);
    t.onClose = (id) => this.closeConn(id);

    this.stopTicker = startTicker(() => this.tick());
    this.unload = () => this.broadcast({ t: 'bye' });
    window.addEventListener('pagehide', this.unload);
    this.schedulePush();
    return this.code;
  }

  receive(id, msg) {
    this.lastSeen.set(id, Date.now());
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const cid = String(msg.cid || '').slice(0, 24);
      if (!cid || cid === this.cid) { this.transport.drop(id); return; }
      const old = this.cidConn.get(cid);
      if (old !== undefined && old !== id) {
        this.connCid.delete(old);
        this.transport.drop(old);
      }
      this.connCid.set(id, cid);
      this.cidConn.set(cid, id);
      this.room.join(cid, msg.name);
      return;
    }
    if (msg.t === 'pong') return;
    const cid = this.connCid.get(id);
    if (!cid) return;
    const res = routeMessage(this.room, cid, msg);
    if (res && !res.ok) this.transport.send(id, { t: 'ev', ev: { t: 'err', m: res.error } });
  }

  closeConn(id) {
    this.lastSeen.delete(id);
    const cid = this.connCid.get(id);
    this.connCid.delete(id);
    if (cid && this.cidConn.get(cid) === id) {
      this.cidConn.delete(cid);
      this.room.leave(cid);
    }
  }

  tick() {
    if (this.closed) return;
    const now = Date.now();
    this.room.tick(now);
    if (!this.lastPing || now - this.lastPing > PING_MS) {
      this.lastPing = now;
      for (const id of this.connCid.keys()) {
        this.transport.send(id, { t: 'ping' });
        if (now - (this.lastSeen.get(id) || now) > STALE_MS) this.transport.drop(id);
      }
    }
  }

  pushAll() {
    for (const [id, cid] of this.connCid) this.transport.send(id, { t: 'snap', s: this.room.snapshot(cid) });
    this.onSnapshot(this.room.snapshot(this.cid));
  }

  broadcast(msg, includeSelf = false) {
    for (const id of this.connCid.keys()) this.transport.send(id, msg);
    if (includeSelf && msg.t === 'ev') this.onEvent(msg.ev);
  }

  close() {
    if (this.closed) return;
    if (this.room) this.broadcast({ t: 'bye' });
    this.closed = true;
    if (this.stopTicker) this.stopTicker();
    if (this.unload) window.removeEventListener('pagehide', this.unload);
    setTimeout(() => this.transport && this.transport.destroy(), 150);
  }
}

// ---------- Guest ----------

export class GuestSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.name = opts.name;
    this.code = opts.code;
    this.cid = getCid();
    this.lastHeard = Date.now();
    this.reconnecting = false;
  }

  async open() {
    await this.connectOnce();
    this.watchdog = setInterval(() => {
      if (!this.closed && !this.reconnecting && Date.now() - this.lastHeard > STALE_MS) this.handleLost();
    }, 2000);
  }

  async connectOnce() {
    const t = useLocalNet() ? new LocalGuest() : new PeerGuest();
    t.onMessage = (msg) => this.receive(msg);
    t.onClose = () => { if (this.transport === t) this.handleLost(); };
    await t.connect(this.code);
    if (this.closed) {
      t.destroy();
      throw new Error('Cancelled');
    }
    this.transport = t;
    this.lastHeard = Date.now();
    t.send({ t: 'hello', cid: this.cid, name: this.name });
  }

  receive(msg) {
    this.lastHeard = Date.now();
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'snap') this.onSnapshot(msg.s);
    else if (msg.t === 'ev') this.onEvent(msg.ev);
    else if (msg.t === 'ping') this.transport.send({ t: 'pong' });
    else if (msg.t === 'bye') this.end('The host closed the room.');
  }

  async handleLost() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.onStatus('reconnecting');
    if (this.transport) this.transport.destroy();
    this.transport = null;
    const delays = [600, 1500, 3000, 5000, 8000];
    for (const d of delays) {
      await new Promise((r) => setTimeout(r, d));
      if (this.closed) return;
      try {
        await this.connectOnce();
        this.reconnecting = false;
        this.onStatus('ok');
        return;
      } catch { /* try again */ }
    }
    this.end('Lost connection to the room.');
  }

  end(reason) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    if (this.transport) this.transport.destroy();
    this.onStatus('closed', reason);
  }

  send(msg) {
    if (this.transport) this.transport.send(msg);
  }

  close() {
    this.closed = true;
    clearInterval(this.watchdog);
    if (this.transport) this.transport.destroy();
  }
}

// ---------- Same screen and bot practice ----------

export class LocalSession extends BaseSession {
  constructor(opts) {
    super(opts);
    this.kind = opts.kind; // 'local' | 'solo'
    this.name = opts.name;
    this.cid = 'local';
  }

  open() {
    this.room = new Room({
      kind: this.kind,
      hostCid: this.cid,
      onUpdate: () => this.schedulePush(),
      onEvent: (ev) => this.onEvent(ev),
      botPlanner,
    });
    if (this.kind === 'solo') {
      this.room.settings.mode = 'duel';
      this.room.seats = [
        { cid: this.cid, name: this.name || 'You', connected: true, bot: false },
        { cid: 'bot', name: BOT_NAMES[this.room.settings.botLevel], connected: true, bot: true },
      ];
    } else {
      this.room.resizeSeats();
      if (this.name) this.room.seats[0].name = this.name;
    }
    this.stopTicker = startTicker(() => !this.closed && this.room.tick(Date.now()));
    this.schedulePush();
  }

  send(msg) {
    super.send(msg);
    if (this.kind === 'solo' && msg.t === 'cfg' && this.room.seats[1]) {
      this.room.seats[1].name = BOT_NAMES[this.room.settings.botLevel];
      this.schedulePush();
    }
  }

  pushAll() {
    this.onSnapshot(this.room.snapshot(this.cid));
  }

  close() {
    this.closed = true;
    if (this.stopTicker) this.stopTicker();
  }
}
