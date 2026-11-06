// Room: authoritative match host. Owns lobby, seats, settings, game state, clocks and the bot.
// The same class runs online rooms (in the host's browser), local pass-and-play and bot practice.

import * as E from './engine.js';

const INTRO_MS = 1900;
const ROUND_END_MS = 4500;
const BOT_MIN_MS = 550;
const BOT_STEP_MS = 650;

export class Room {
  constructor({ kind, hostCid, code = null, onUpdate = () => {}, onEvent = () => {}, botPlanner = null }) {
    this.kind = kind; // 'online' | 'local' | 'solo'
    this.hostCid = hostCid;
    this.code = code;
    this.onUpdate = onUpdate;
    this.onEvent = onEvent;
    this.botPlanner = botPlanner;
    this.settings = E.defaultSettings();
    this.seats = new Array(E.MODES[this.settings.mode].teams.length).fill(null);
    this.spectators = new Map(); // cid -> { name, connected }
    this.stage = 'lobby';
    this.game = null;
    this.deadline = null; // shot clock, epoch ms
    this.phaseAt = null; // auto transition time, epoch ms
    this.botBusy = false;
    this.botPlan = null;
    this.lastEmote = new Map();
  }

  // ----- lobby -----

  seatOf(cid) {
    return this.seats.findIndex((s) => s && s.cid === cid);
  }

  isHost(cid) {
    return cid === this.hostCid;
  }

  join(cid, rawName) {
    const name = cleanName(rawName);
    const seat = this.seatOf(cid);
    if (seat >= 0) {
      const s = this.seats[seat];
      s.connected = true;
      if (name && this.stage === 'lobby') s.name = name;
      this.changed();
      return;
    }
    if (this.spectators.has(cid)) {
      const sp = this.spectators.get(cid);
      sp.connected = true;
      if (name) sp.name = name;
      this.changed();
      return;
    }
    const free = this.seats.findIndex((s) => s === null);
    if (this.stage === 'lobby' && free >= 0) {
      this.seats[free] = { cid, name: name || `Player ${free + 1}`, connected: true, bot: false };
    } else {
      this.spectators.set(cid, { name: name || 'Spectator', connected: true });
    }
    this.changed();
  }

  leave(cid) {
    const seat = this.seatOf(cid);
    if (seat >= 0) {
      if (this.stage === 'lobby') this.seats[seat] = null;
      else this.seats[seat].connected = false;
    } else if (this.spectators.has(cid)) {
      this.spectators.delete(cid);
    }
    this.changed();
  }

  rename(cid, rawName) {
    const name = cleanName(rawName);
    if (!name || this.stage !== 'lobby') return;
    const seat = this.seatOf(cid);
    if (seat >= 0) this.seats[seat].name = name;
    else if (this.spectators.has(cid)) this.spectators.get(cid).name = name;
    this.changed();
  }

  sit(cid, index) {
    if (this.stage !== 'lobby' || this.kind !== 'online') return;
    if (!Number.isInteger(index) || index < 0 || index >= this.seats.length || this.seats[index]) return;
    const from = this.seatOf(cid);
    let entry;
    if (from >= 0) {
      entry = this.seats[from];
      this.seats[from] = null;
    } else if (this.spectators.has(cid)) {
      const sp = this.spectators.get(cid);
      this.spectators.delete(cid);
      entry = { cid, name: sp.name, connected: true, bot: false };
    } else return;
    this.seats[index] = entry;
    this.changed();
  }

  spectate(cid) {
    if (this.stage !== 'lobby' || this.kind !== 'online') return;
    const from = this.seatOf(cid);
    if (from < 0) return;
    const s = this.seats[from];
    this.seats[from] = null;
    this.spectators.set(cid, { name: s.name, connected: true });
    this.changed();
  }

  configure(cid, patch) {
    if (!this.isHost(cid) || this.stage !== 'lobby') return;
    const prevMode = this.settings.mode;
    if (this.kind === 'solo') delete patch.mode;
    this.settings = E.applySettingsPatch(this.settings, patch);
    if (this.settings.mode !== prevMode) this.resizeSeats();
    this.changed();
  }

  resizeSeats() {
    const n = E.MODES[this.settings.mode].teams.length;
    const old = this.seats;
    const next = new Array(n).fill(null);
    const overflow = [];
    old.forEach((s, i) => {
      if (!s) return;
      if (i < n) next[i] = s;
      else overflow.push(s);
    });
    for (const s of overflow) {
      const free = next.findIndex((x) => x === null);
      if (free >= 0) next[free] = s;
      else if (this.kind === 'online') this.spectators.set(s.cid, { name: s.name, connected: s.connected });
    }
    if (this.kind === 'local') {
      for (let i = 0; i < n; i++) if (!next[i]) next[i] = { cid: this.hostCid, name: `Player ${i + 1}`, connected: true, bot: false };
    }
    this.seats = next;
  }

  setLocalName(cid, index, rawName) {
    if (this.kind !== 'local' || !this.isHost(cid) || this.stage !== 'lobby') return;
    const name = cleanName(rawName);
    if (this.seats[index] && name) this.seats[index].name = name;
    this.changed();
  }

  canStart() {
    return this.stage === 'lobby' && this.seats.every((s) => s && s.connected !== false);
  }

  start(cid) {
    if (!this.isHost(cid) || !this.canStart()) return;
    this.stage = 'game';
    this.game = E.newGame(this.settings);
    this.afterChange();
  }

  rematch(cid) {
    if (!this.isHost(cid) || !this.game || this.game.phase !== 'matchEnd') return;
    this.game = E.rematch(this.game);
    this.afterChange();
  }

  toLobby(cid) {
    if (!this.isHost(cid) || this.stage !== 'game') return;
    this.stage = 'lobby';
    this.game = null;
    this.deadline = null;
    this.phaseAt = null;
    this.botPlan = null;
    // Drop seats of players who left during the match.
    if (this.kind === 'online') this.seats = this.seats.map((s) => (s && s.connected ? s : null));
    this.changed();
  }

  emote(cid, e) {
    if (typeof e !== 'string' || e.length > 8) return;
    const now = Date.now();
    if (now - (this.lastEmote.get(cid) || 0) < 1200) return;
    this.lastEmote.set(cid, now);
    const seat = this.seatOf(cid);
    const name = seat >= 0 ? this.seats[seat].name : (this.spectators.get(cid)?.name || 'Spectator');
    this.onEvent({ t: 'emote', seat: this.kind === 'online' ? seat : (this.game ? this.game.current : 0), name, e });
  }

  // ----- game -----

  controls(cid, seat) {
    const s = this.seats[seat];
    if (!s || s.bot) return false;
    if (this.kind === 'online') return s.cid === cid;
    return cid === this.hostCid;
  }

  act(cid, action) {
    const g = this.game;
    if (this.stage !== 'game' || !g || g.phase !== 'play') return { ok: false, error: 'Round is not live' };
    if (!this.controls(cid, g.current)) return { ok: false, error: 'Not your turn' };
    if (!action || action.type === 'timeout') return { ok: false, error: 'Bad action' };
    const res = E.applyAction(g, g.current, action);
    if (res.ok) this.afterChange();
    return res;
  }

  afterChange() {
    const g = this.game;
    this.deadline = null;
    this.phaseAt = null;
    if (g) {
      const now = Date.now();
      if (g.phase === 'intro') this.phaseAt = now + INTRO_MS;
      else if (g.phase === 'roundEnd') this.phaseAt = now + ROUND_END_MS;
      else if (g.phase === 'play') {
        const seat = this.seats[g.current];
        if (seat && seat.bot) this.runBot();
        else if (g.settings.clock > 0) this.deadline = now + g.settings.clock * 1000;
      }
    }
    this.changed();
  }

  // Called a few times per second by the host's ticker.
  tick(now = Date.now()) {
    const g = this.game;
    if (this.stage !== 'game' || !g) return;
    if (this.phaseAt && now >= this.phaseAt) {
      this.phaseAt = null;
      if (g.phase === 'intro') E.beginPlay(g);
      else if (g.phase === 'roundEnd') E.nextRound(g);
      this.afterChange();
      return;
    }
    if (this.deadline && now >= this.deadline && g.phase === 'play') {
      this.deadline = null;
      E.applyTimeout(g);
      this.afterChange();
    }
  }

  async runBot() {
    if (this.botBusy || !this.botPlanner) return;
    const g = this.game;
    const seat = g.current;
    const seq = g.seq;
    this.botBusy = true;
    const started = Date.now();
    try {
      let step = null;
      if (this.botPlan && this.botPlan.length) {
        step = this.botPlan.shift();
        await wait(BOT_STEP_MS);
      } else {
        const opp = g.seats.find((s, i) => i !== seat);
        const plan = await this.botPlanner({
          board: g.board,
          me: g.seats[seat].team + 1,
          opp: opp.team + 1,
          energy: g.seats[seat].energy,
          oppEnergy: opp.energy,
          abilities: g.settings.abilities,
          used: g.used,
          surge: g.surge,
          level: this.settings.botLevel,
        });
        const elapsed = Date.now() - started;
        if (elapsed < BOT_MIN_MS) await wait(BOT_MIN_MS - elapsed + Math.random() * 350);
        this.botPlan = plan && plan.length ? plan.slice(1) : null;
        step = plan && plan[0];
      }
      if (this.game !== g || g.seq !== seq || g.phase !== 'play' || g.current !== seat) { this.botPlan = null; return; }
      let res = step ? E.applyAction(g, seat, step) : { ok: false };
      if (!res.ok) {
        this.botPlan = null;
        const cols = E.legalCols(g.board);
        if (cols.length) res = E.applyAction(g, seat, { type: 'drop', col: cols[Math.floor(Math.random() * cols.length)] });
      }
      if (g.phase !== 'play' || g.current !== seat) this.botPlan = null;
    } catch (err) {
      console.error('bot error', err);
      this.botPlan = null;
    } finally {
      this.botBusy = false;
    }
    this.afterChange();
  }

  // ----- snapshots -----

  snapshot(cid) {
    const now = Date.now();
    const mySeats = [];
    this.seats.forEach((s, i) => { if (this.controls(cid, i)) mySeats.push(i); });
    return {
      kind: this.kind,
      code: this.code,
      stage: this.stage,
      settings: this.settings,
      seats: this.seats.map((s) => s && { name: s.name, bot: !!s.bot, connected: s.connected !== false, host: s.cid === this.hostCid && this.kind === 'online' }),
      spectators: [...this.spectators.values()].filter((s) => s.connected).map((s) => s.name),
      game: this.game,
      clockMs: this.deadline ? Math.max(0, this.deadline - now) : null,
      phaseMs: this.phaseAt ? Math.max(0, this.phaseAt - now) : null,
      canStart: this.canStart(),
      you: {
        isHost: this.isHost(cid),
        seats: mySeats,
        seat: this.seatOf(cid),
        spectator: this.spectators.has(cid),
      },
    };
  }

  changed() {
    this.onUpdate();
  }
}

function cleanName(n) {
  if (typeof n !== 'string') return '';
  return n.replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
