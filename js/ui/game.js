// In-match screen: player cards, turn banner, board, abilities, emotes, round and match results.

import { $, esc, toast, ICONS, TEAM_HEX, modalOpen } from './dom.js';
import { Board } from './board.js';
import { COSTS, ENERGY_CAP, TEAM_NAMES, WALL, EMPTY, turnsUntilCollapse, canDrop } from '../engine.js';
import { sfx, buzz, isMuted, setMuted, unlockAudio } from '../audio.js';
import { showRules } from './rules.js';

const EMOTES = ['🔥', '😤', '😂', '👀', '🫡', 'GG'];
const REASONS = {
  connect: 'Four in a row.',
  bomb: 'Blasted a gap and the fall lined it up.',
  backfire: 'Backfire. The bomb completed the enemy line.',
  collapse: 'The floor collapse lined it up.',
  collapseTie: 'The collapse made equal lines for more than one side. No point.',
  full: 'Board full. No point.',
};
const ABILITIES = [
  { id: 'wall', key: 'W', name: 'Wall', desc: 'Steel block, then drop' },
  { id: 'bomb', key: 'B', name: 'Bomb', desc: 'Destroy an enemy piece' },
  { id: 'surge', key: 'S', name: 'Surge', desc: 'Drop two discs' },
];

export class GameView {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { send, leave }
    this.tool = 'drop';
    this.hoverCol = null;
    this.hoverRow = null;
    this.armed = null;
    this.pending = null;
    this.lastSeq = null;
    this.overlayKey = '';
    this.bannerKey = '';
    this.controlsKey = '';
    this.clockDeadline = null;
    this.phaseDeadline = null;
    this.lastTick = null;
    this.timers = new Set();
    this.build();
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
    document.body.classList.add('in-game');
  }

  later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  build() {
    this.root.innerHTML = `
      <div class="game">
        <header class="topbar">
          <div class="brand">OVERDROP</div>
          <div class="spacer"></div>
          <div class="round-meta" id="g-round"></div>
          <div class="spacer"></div>
          <span class="code-chip" id="g-code" hidden></span>
          <button class="icon-btn" id="g-sound" title="Sound" aria-label="Toggle sound"></button>
          <button class="icon-btn" id="g-help" title="How to play" aria-label="How to play">?</button>
          <button class="icon-btn" id="g-leave" title="Leave" aria-label="Leave">${ICONS.close}</button>
        </header>
        <section class="players" id="g-players"></section>
        <div class="banner" id="g-banner"></div>
        <section class="board-area" id="g-area"><div class="overlay" id="g-overlay"></div></section>
        <footer class="controls">
          <div class="collapse-meter" id="g-collapse"></div>
          <div class="ability-bar" id="g-abilities"></div>
          <div class="tool-hint" id="g-hint"></div>
          <div class="emote-bar" id="g-emotes"></div>
        </footer>
      </div>`;
    this.board = new Board($('#g-area', this.root), {
      onHover: (c, r) => { this.hoverCol = c; this.hoverRow = r; this.refreshMarks(); },
      onLeave: () => { this.hoverCol = null; this.hoverRow = null; this.refreshMarks(); },
      onTap: (c, r, touch) => { unlockAudio(); this.touchInput = touch; this.tryAct(c, r, touch); },
    });
    this.renderSound();
    $('#g-sound', this.root).addEventListener('click', () => {
      setMuted(!isMuted());
      unlockAudio();
      this.renderSound();
    });
    $('#g-help', this.root).addEventListener('click', showRules);
    $('#g-leave', this.root).addEventListener('click', () => this.ctx.leave());
    $('#g-abilities', this.root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-ab]');
      if (b && !b.disabled) { unlockAudio(); this.pickTool(b.dataset.ab); }
    });
    $('#g-emotes', this.root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-emote]');
      if (b) this.ctx.send({ t: 'emote', e: b.dataset.emote });
    });
  }

  renderSound() {
    $('#g-sound', this.root).innerHTML = isMuted() ? ICONS.soundOff : ICONS.soundOn;
  }

  // ---------- helpers ----------

  get g() {
    return this.snap && this.snap.game;
  }

  seatName(i) {
    const s = this.snap.seats[i];
    return (s && s.name) || `Player ${i + 1}`;
  }

  isMine(seat) {
    return this.snap.you.seats.includes(seat);
  }

  myTeams() {
    const g = this.g;
    return new Set(this.snap.you.seats.map((i) => g.seats[i].team));
  }

  // "You" wording only for a single player perspective (not same screen, not spectators).
  personal() {
    return this.snap.kind !== 'local' && this.snap.you.seats.length > 0;
  }

  teamLabel(team) {
    const g = this.g;
    if (g.settings.mode === 'teams') return `Team ${TEAM_NAMES[team]}`;
    const seat = g.seats.findIndex((s) => s.team === team);
    return this.seatName(seat);
  }

  canAct() {
    const g = this.g;
    return !!g && g.phase === 'play' && this.isMine(g.current) && this.pending === null;
  }

  abilityOk(id) {
    const g = this.g;
    if (!g || !g.settings.abilities || g.used) return false;
    return g.seats[g.current].energy >= COSTS[id];
  }

  // ---------- updates ----------

  update(snap) {
    this.snap = snap;
    const g = snap.game;
    if (!g) return;
    if (g.seq !== this.lastSeq) {
      const animate = this.lastSeq != null && g.seq === this.lastSeq + 1;
      this.pending = null;
      this.tool = 'drop';
      this.armed = null;
      if (this.touchInput) { this.hoverCol = null; this.hoverRow = null; }
      const lands = this.board.renderDiscs(g, animate);
      if (animate) this.playFx(g, lands);
      this.lastSeq = g.seq;
      this.lastTick = null;
    }
    const now = performance.now();
    this.clockDeadline = snap.clockMs != null ? now + snap.clockMs : null;
    this.phaseDeadline = snap.phaseMs != null ? now + snap.phaseMs : null;
    this.renderTop();
    this.renderPlayers();
    this.renderBanner();
    this.renderControls();
    this.renderOverlay();
    this.refreshMarks();
  }

  playFx(g, lands) {
    const fx = g.fx;
    if (!fx) return;
    const team = fx.seat != null ? g.seats[fx.seat].team : null;
    const actor = fx.seat != null ? this.seatName(fx.seat) : '';
    switch (fx.kind) {
      case 'round': sfx.round(); break;
      case 'go': sfx.go(); break;
      case 'surge':
        sfx.surge();
        this.board.flash(TEAM_HEX[team]);
        toast(`${actor} surges`, { kind: 'big', team });
        break;
      case 'bomb':
        sfx.bomb();
        buzz([40, 30, 80]);
        this.board.shake('quake');
        break;
      case 'timeout':
        sfx.timeout();
        toast(`${actor} ran out of time. Random drop.`, { kind: 'err' });
        break;
      default: break;
    }
    for (const l of lands) {
      this.later(() => {
        if (l.v === WALL) { sfx.wall(); this.board.shake('jolt'); } else sfx.drop(l.r);
      }, l.t);
    }
    if (fx.collapsed) {
      this.later(() => { sfx.collapse(); buzz(220); this.board.shake('quake'); }, 60);
      toast('Floor collapse', { kind: 'big' });
    }
    if (g.result && (g.phase === 'roundEnd' || g.phase === 'matchEnd')) {
      const delay = Math.max(380, ...lands.map((l) => l.t + 140));
      this.later(() => {
        const mine = this.myTeams();
        if (g.result.team < 0) sfx.lose();
        else if (!this.personal() || mine.has(g.result.team)) sfx.win();
        else sfx.lose();
      }, delay);
    }
  }

  renderTop() {
    const g = this.g;
    $('#g-round', this.root).textContent = `Round ${g.round} · First to ${g.settings.matchTo}`;
    const chip = $('#g-code', this.root);
    if (this.snap.kind === 'online' && this.snap.code) {
      chip.hidden = false;
      chip.textContent = this.snap.code;
    }
  }

  renderPlayers() {
    const g = this.g;
    const S = g.settings;
    const wrap = $('#g-players', this.root);
    const n = g.seats.length;
    if (wrap.children.length !== n) {
      wrap.style.setProperty('--n', n);
      wrap.classList.toggle('many', n > 2);
      wrap.innerHTML = g.seats.map((s, i) => `<div class="pcard t${s.team}" data-seat="${i}"><div class="pc-inner"></div><div class="pc-clock"><i></i></div></div>`).join('');
    }
    g.seats.forEach((s, i) => {
      const card = wrap.children[i];
      const info = this.snap.seats[i] || {};
      const active = g.phase === 'play' && g.current === i;
      card.classList.toggle('active', active);
      card.classList.toggle('offline', info.connected === false);
      if (!active) {
        card.classList.remove('hurry');
        card.querySelector('.pc-clock i').style.width = '0';
      }
      const mine = this.personal() && this.isMine(i);
      const score = g.teamScores[s.team];
      const pips = Array.from({ length: S.matchTo }, (_, k) => `<i class="${k < score ? 'won' : ''}"></i>`).join('');
      let tag = '';
      if (info.connected === false) tag = '<span class="tag off">Offline</span>';
      else if (mine) tag = '<span class="tag you">You</span>';
      else if (info.bot) tag = '<span class="tag">Bot</span>';
      const energy = S.abilities
        ? `<div class="pc-bottom"><div class="energy${s.energy >= ENERGY_CAP ? ' full' : ''}" title="Energy">${Array.from({ length: ENERGY_CAP }, (_, k) => `<i class="${k < s.energy ? 'on' : ''}"></i>`).join('')}</div><span class="energy-num">${s.energy}</span></div>`
        : '';
      const html = `<div class="pc-top"><span class="pc-disc"></span><span class="pc-name">${esc(this.seatName(i))}</span>${tag}<span class="pc-score" title="Rounds won">${pips}</span></div>${energy}`;
      const inner = card.firstElementChild;
      if (inner._html !== html) { inner.innerHTML = html; inner._html = html; }
    });
  }

  renderBanner() {
    const g = this.g;
    const key = `${g.seq}:${g.phase}:${g.current}:${this.pending}`;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    let label = '';
    let sub = '';
    let team = null;
    let clock = false;
    if (g.phase === 'intro') {
      label = `Round ${g.round}`;
    } else if (g.phase === 'play') {
      team = g.seats[g.current].team;
      const name = this.seatName(g.current);
      const info = this.snap.seats[g.current] || {};
      if (this.isMine(g.current) && this.personal()) label = 'Your turn';
      else if (info.bot) label = `${name} is thinking`;
      else label = `${name}'s turn`;
      if (g.used === 'wall') sub = 'Wall placed. <b>Now drop a disc.</b>';
      else if (g.surge > 0) sub = `Surge. <b>Drop ${3 - g.surge} of 2.</b>`;
      clock = g.settings.clock > 0 && !info.bot;
    } else if (g.result) {
      team = g.result.team >= 0 ? g.result.team : null;
      label = g.result.team < 0 ? 'Drawn round' : `${this.teamLabel(g.result.team)} scores`;
    }
    $('#g-banner', this.root).innerHTML =
      `<div class="turn-label${team != null ? ' t' + team : ''}">${esc(label)}</div>${sub ? `<div class="turn-sub">${sub}</div>` : ''}${clock ? '<div class="clock-num" id="g-clock">' + g.settings.clock + '</div>' : ''}`;
  }

  renderControls() {
    const g = this.g;
    const S = g.settings;
    const canAct = this.canAct();
    const key = `${g.seq}:${this.tool}:${canAct}:${g.phase}`;
    if (key === this.controlsKey) return;
    this.controlsKey = key;

    const meter = $('#g-collapse', this.root);
    if (S.collapse && (g.phase === 'play' || g.phase === 'intro')) {
      const left = turnsUntilCollapse(g);
      const filled = S.collapse - left;
      meter.className = 'collapse-meter' + (left === 1 ? ' soon' : '');
      meter.innerHTML = `<span>${left === 1 ? 'Floor collapses after this turn' : `Floor collapse in ${left} turns`}</span><span class="pips">${Array.from({ length: S.collapse }, (_, k) => `<i class="${k < filled ? 'on' : ''}"></i>`).join('')}</span>`;
    } else {
      meter.className = 'collapse-meter';
      meter.innerHTML = '';
    }

    const bar = $('#g-abilities', this.root);
    if (S.abilities && this.snap.you.seats.length) {
      bar.hidden = false;
      bar.innerHTML = ABILITIES.map((a) => {
        const ok = canAct && this.abilityOk(a.id);
        return `<button class="ab ${a.id}${this.tool === a.id ? ' on' : ''}" data-ab="${a.id}" ${ok ? '' : 'disabled'} title="${a.name}: ${a.desc} (${COSTS[a.id]} energy)">
          <span class="ab-name">${a.name.toUpperCase()} <kbd>${a.key}</kbd></span>
          <span class="ab-desc">${a.desc}</span>
          <span class="ab-cost">${'<i></i>'.repeat(COSTS[a.id])}</span></button>`;
      }).join('');
    } else {
      bar.hidden = true;
      bar.innerHTML = '';
    }

    let hint = '';
    if (canAct) {
      if (this.tool === 'wall') hint = 'Pick a column for the <b>steel block</b>. You still drop a disc after.';
      else if (this.tool === 'bomb') hint = 'Pick an <b>enemy disc or wall</b> to destroy. Esc to cancel.';
    } else if (this.snap.you.spectator) {
      hint = 'You are spectating.';
    }
    $('#g-hint', this.root).innerHTML = hint;

    const emotes = $('#g-emotes', this.root);
    if (this.snap.kind === 'online' && !emotes.children.length) {
      emotes.innerHTML = EMOTES.map((e) => `<button data-emote="${e}" class="${e.length > 2 ? 'txt' : ''}" aria-label="Send ${e}">${e}</button>`).join('');
    }
  }

  renderOverlay() {
    const g = this.g;
    const o = $('#g-overlay', this.root);
    const key = `${g.phase}:${g.round}:${g.phase === 'matchEnd' ? `${g.seq}:${this.snap.you.isHost}` : ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    clearTimeout(this.overlayT);
    o.className = 'overlay';
    o.innerHTML = '';
    if (g.phase === 'intro') {
      const team = g.seats[g.startSeat].team;
      o.innerHTML = `<div class="intro-text t${team}"><div class="big">ROUND ${g.round}</div><div class="small"><b>${esc(this.seatName(g.startSeat))}</b> moves first</div></div>`;
    } else if (g.phase === 'play') {
      if (g.fx && g.fx.kind === 'go') {
        o.innerHTML = '<div class="go-text">GO</div>';
        this.overlayT = this.later(() => { if (this.overlayKey === key) o.innerHTML = ''; }, 750);
      }
    } else if (g.phase === 'roundEnd') {
      this.overlayT = this.later(() => { if (this.overlayKey === key) o.innerHTML = this.roundPanel(); }, 1100);
    } else if (g.phase === 'matchEnd') {
      this.overlayT = this.later(() => {
        if (this.overlayKey !== key) return;
        o.className = 'overlay block';
        o.innerHTML = this.matchPanel();
        this.wireMatchPanel(o);
      }, 1400);
    }
  }

  scoreline() {
    const g = this.g;
    return `<div class="scoreline">${g.teamScores.map((s, t) => `<div class="t${t}"><b>${s}</b><span>${esc(this.teamLabel(t))}</span></div>`).join('')}</div>`;
  }

  roundPanel() {
    const g = this.g;
    const r = g.result;
    let title = 'Draw';
    if (r.team >= 0) title = this.personal() && this.myTeams().has(r.team) ? 'You take it' : `${this.teamLabel(r.team)} takes it`;
    return `<div class="result-panel${r.team >= 0 ? ' t' + r.team : ''}">
      <div class="result-kicker">Round ${g.round}</div>
      <div class="result-title">${esc(title)}</div>
      <div class="result-reason">${esc(REASONS[r.reason] || '')}</div>
      ${this.scoreline()}
      <div class="next-in" id="g-next">Next round soon</div>
    </div>`;
  }

  matchPanel() {
    const g = this.g;
    const r = g.result;
    const won = this.personal() && this.myTeams().has(r.team);
    const lost = this.personal() && !won;
    const title = won ? 'Victory' : `${this.teamLabel(r.team)} wins`;
    const ab = g.settings.abilities;
    const cols = ab ? ['drops', 'walls', 'bombs', 'surges', 'timeouts'] : ['drops', 'timeouts'];
    const rows = g.seats.map((s, i) => `<tr class="t${s.team}"><td>${esc(this.seatName(i))}</td>${cols.map((c) => `<td>${s.stats[c]}</td>`).join('')}</tr>`).join('');
    const host = this.snap.you.isHost;
    const online = this.snap.kind === 'online';
    const actions = host
      ? `<button class="btn hot" data-act="rematch">Rematch</button><button class="btn" data-act="lobby">${online ? 'Back to lobby' : 'Change settings'}</button><button class="btn ghost" data-act="leave">Leave</button>`
      : '<button class="btn" disabled>Waiting for the host</button><button class="btn ghost" data-act="leave">Leave</button>';
    return `<div class="result-panel t${r.team}">
      <div class="result-kicker">${lost ? 'Defeat' : 'Match over'}</div>
      <div class="result-title">${esc(title)}</div>
      ${this.scoreline()}
      <table class="stats"><thead><tr><th>Player</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <div class="result-actions">${actions}</div>
    </div>`;
  }

  wireMatchPanel(o) {
    o.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'leave') this.ctx.leave();
      else this.ctx.send({ t: act });
    }));
  }

  refreshMarks() {
    const g = this.g;
    if (!g) return;
    const canAct = this.canAct();
    const team = g.seats[g.current].team;
    const showResult = (g.phase === 'roundEnd' || g.phase === 'matchEnd') && !!g.result;
    this.board.renderMarks({
      g,
      tool: this.tool,
      hoverCol: this.hoverCol,
      hoverRow: this.hoverRow,
      armed: this.armed,
      canAct,
      team,
      collapseSoon: g.phase === 'play' && turnsUntilCollapse(g) === 1,
      showResult,
    });
    this.board.setLocked(!canAct, canAct && this.tool === 'bomb');
    this.board.setGlow(g.phase === 'play' ? TEAM_HEX[team] + '66' : null);
  }

  // ---------- input ----------

  pickTool(id) {
    if (!this.canAct()) return;
    if (!this.abilityOk(id)) { sfx.error(); return; }
    if (id === 'surge') { this.sendAct({ type: 'surge' }); return; }
    this.tool = this.tool === id ? 'drop' : id;
    this.armed = null;
    sfx.click();
    this.controlsKey = '';
    this.renderControls();
    this.refreshMarks();
  }

  tryAct(col, row, touch) {
    if (!this.canAct()) return;
    const g = this.g;
    if (this.tool === 'bomb') {
      if (row == null) return;
      const v = g.board[row][col];
      if (v === EMPTY || v === g.seats[g.current].team + 1) { sfx.error(); return; }
      if (touch && !(this.armed && this.armed.r === row && this.armed.c === col)) {
        this.armed = { r: row, c: col };
        this.hoverCol = col;
        this.hoverRow = row;
        this.refreshMarks();
        return;
      }
      this.sendAct({ type: 'bomb', r: row, c: col });
      return;
    }
    if (!canDrop(g.board, col)) { sfx.error(); return; }
    if (touch && !(this.armed && this.armed.c === col && this.armed.r == null)) {
      this.armed = { c: col, r: null };
      this.hoverCol = col;
      this.refreshMarks();
      return;
    }
    this.sendAct({ type: this.tool === 'wall' ? 'wall' : 'drop', col });
  }

  sendAct(a) {
    const g = this.g;
    unlockAudio();
    const seq = g.seq;
    this.pending = seq;
    this.armed = null;
    this.ctx.send({ t: 'act', a });
    this.later(() => {
      if (this.pending === seq && this.g && this.g.seq === seq) {
        this.pending = null;
        this.refreshMarks();
      }
    }, 3000);
    this.refreshMarks();
  }

  onError(msg) {
    this.pending = null;
    sfx.error();
    toast(msg, { kind: 'err' });
    this.controlsKey = '';
    this.bannerKey = '';
    if (this.g) { this.renderControls(); this.renderBanner(); this.refreshMarks(); }
  }

  key(e) {
    const g = this.g;
    if (!g || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    const { cols, rows } = g.settings;
    if (/^[0-9]$/.test(k)) {
      const col = k === '0' ? 9 : Number(k) - 1;
      if (col < cols && this.tool !== 'bomb') {
        e.preventDefault();
        this.hoverCol = col;
        this.tryAct(col, null, false);
      }
      return;
    }
    switch (k) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const d = k === 'ArrowLeft' ? -1 : 1;
        const base = this.hoverCol == null ? Math.floor(cols / 2) - (d > 0 ? 1 : -1) : this.hoverCol;
        this.hoverCol = Math.max(0, Math.min(cols - 1, base + d));
        if (this.tool === 'bomb' && this.hoverRow == null) this.hoverRow = 0;
        this.refreshMarks();
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (this.tool !== 'bomb') return;
        e.preventDefault();
        if (this.hoverCol == null) this.hoverCol = Math.floor(cols / 2);
        this.hoverRow = Math.max(0, Math.min(rows - 1, (this.hoverRow == null ? 0 : this.hoverRow) + (k === 'ArrowUp' ? 1 : -1)));
        this.refreshMarks();
        break;
      case 'Enter':
      case ' ':
        if (this.hoverCol != null) {
          e.preventDefault();
          this.tryAct(this.hoverCol, this.hoverRow, false);
        }
        break;
      case 'w': case 'W': this.pickTool('wall'); break;
      case 'b': case 'B': this.pickTool('bomb'); break;
      case 's': case 'S': this.pickTool('surge'); break;
      case 'Escape':
        if (this.tool !== 'drop' || this.armed) {
          this.tool = 'drop';
          this.armed = null;
          this.controlsKey = '';
          this.renderControls();
          this.refreshMarks();
        }
        break;
      default: break;
    }
  }

  showEmote(ev) {
    sfx.pop();
    const wrap = $('#g-players', this.root);
    const card = ev.seat >= 0 && wrap ? wrap.children[ev.seat] : null;
    if (!card) { toast(`${ev.name}: ${ev.e}`); return; }
    card.querySelectorAll('.pc-emote').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = 'pc-emote' + (ev.e.length > 2 ? ' text' : '');
    el.textContent = ev.e;
    card.appendChild(el);
    this.later(() => el.remove(), 2400);
  }

  // ---------- animation frame: clocks and countdowns ----------

  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    const g = this.g;
    if (!g) return;
    let hurry = false;
    if (this.clockDeadline != null && g.phase === 'play') {
      const rem = Math.max(0, this.clockDeadline - now);
      const total = g.settings.clock * 1000 || 1;
      const secs = Math.ceil(rem / 1000);
      hurry = rem <= 3000;
      const el = document.getElementById('g-clock');
      if (el) {
        if (el._s !== secs) { el.textContent = secs; el._s = secs; }
        el.classList.toggle('hurry', rem <= 5000);
      }
      const card = $('#g-players', this.root).children[g.current];
      if (card) {
        card.querySelector('.pc-clock i').style.width = `${Math.min(100, (rem / total) * 100)}%`;
        card.classList.toggle('hurry', rem <= 5000);
      }
      if (secs !== this.lastTick) {
        if (secs <= 5 && secs > 0 && this.lastTick !== null && rem > 50) sfx.tick(secs <= 3);
        this.lastTick = secs;
      }
    }
    this.board.setHurry(hurry);
    const nx = document.getElementById('g-next');
    if (nx && this.phaseDeadline != null) {
      const s = Math.max(1, Math.ceil((this.phaseDeadline - now) / 1000));
      if (nx._s !== s) { nx.textContent = `Next round in ${s}`; nx._s = s; }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.board.destroy();
    document.body.classList.remove('in-game');
  }
}
