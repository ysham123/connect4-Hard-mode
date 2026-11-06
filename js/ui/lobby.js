// Lobby: room code and invite, seats, match settings, start.

import { $, $$, esc, toast, copyText, ICONS } from './dom.js';
import { MODES, TEAM_NAMES, PRESETS, OPTIONS } from '../engine.js';
import { showRules } from './rules.js';

const MODE_SHORT = { duel: '1v1', teams: '2v2', ffa3: '3 FFA', ffa4: '4 FFA' };
const LEVEL_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

function summary(s) {
  return [
    `${s.cols} x ${s.rows} board`,
    s.clock ? `${s.clock}s shot clock` : 'no shot clock',
    s.abilities ? 'abilities on' : 'abilities off',
    s.collapse ? `floor collapses every ${s.collapse} turns` : 'no collapse',
    `first to ${s.matchTo}`,
  ].join(', ');
}

function seg(key, items, current, editable) {
  return `<div class="seg" data-key="${key}">${items.map(([val, label]) =>
    `<button data-val="${esc(val)}" class="${String(val) === String(current) ? 'on' : ''}" ${editable ? '' : 'disabled'}>${esc(label)}</button>`).join('')}</div>`;
}

function settingsCard(snap) {
  const s = snap.settings;
  const editable = snap.you.isHost;
  const solo = snap.kind === 'solo';
  const presetItems = Object.entries(PRESETS).map(([k, p]) => [k, p.label]);
  if (s.preset === 'custom') presetItems.push(['custom', 'Custom']);
  return `
    <div class="card settings">
      <h3>Match settings${editable ? '' : ' <em style="font-style:normal;text-transform:none;letter-spacing:0;color:var(--dim)">(host controls these)</em>'}</h3>
      ${solo ? `
        <div class="setting"><div class="setting-label">Bot difficulty</div>
          ${seg('botLevel', OPTIONS.botLevel.map((l) => [l, LEVEL_LABEL[l]]), s.botLevel, editable)}</div>` : `
        <div class="setting"><div class="setting-label">Mode</div>
          ${seg('mode', Object.keys(MODES).map((k) => [k, MODE_SHORT[k]]), s.mode, editable)}</div>`}
      <div class="setting"><div class="setting-label">Preset</div>
        ${seg('preset', presetItems, s.preset, editable)}
        <p class="preset-desc">${esc(summary(s))}.</p></div>
      <div class="setting"><div class="setting-label">Board <em>columns x rows</em></div>
        ${seg('board', OPTIONS.board.map(([c, r]) => [`${c}x${r}`, `${c} x ${r}`]), `${s.cols}x${s.rows}`, editable)}</div>
      <div class="setting"><div class="setting-label">Shot clock <em>per move</em></div>
        ${seg('clock', OPTIONS.clock.map((v) => [v, v ? `${v}s` : 'Off']), s.clock, editable)}</div>
      <div class="setting"><div class="setting-label">Abilities <em>wall, bomb, surge</em></div>
        ${seg('abilities', [['on', 'On'], ['off', 'Off']], s.abilities ? 'on' : 'off', editable)}</div>
      <div class="setting"><div class="setting-label">Floor collapse <em>every N turns</em></div>
        ${seg('collapse', OPTIONS.collapse.map((v) => [v, v ? String(v) : 'Off']), s.collapse, editable)}</div>
      <div class="setting"><div class="setting-label">Match length</div>
        ${seg('matchTo', OPTIONS.matchTo.map((v) => [v, `First to ${v}`]), s.matchTo, editable)}</div>
    </div>`;
}

function seatsCard(snap) {
  const teams = MODES[snap.settings.mode].teams;
  const isTeams = snap.settings.mode === 'teams';
  const local = snap.kind === 'local';
  const rows = snap.seats.map((seat, i) => {
    const team = teams[i];
    const mine = snap.you.seat === i;
    const sub = isTeams ? `Team ${TEAM_NAMES[team]}` : TEAM_NAMES[team];
    if (!seat) {
      return `<div class="seat empty t${team}"><span class="seat-disc"></span>
        <div class="seat-body"><div class="seat-name">Open seat</div><div class="seat-sub">${esc(sub)}</div></div>
        ${snap.kind === 'online' ? `<button class="btn small" data-sit="${i}">Sit here</button>` : ''}</div>`;
    }
    if (local) {
      return `<div class="seat t${team}"><span class="seat-disc"></span>
        <div class="seat-body"><input class="input" id="lname-${i}" data-lname="${i}" maxlength="16" value="${esc(seat.name)}" aria-label="Player ${i + 1} name"><div class="seat-sub">${esc(sub)}</div></div></div>`;
    }
    const tags = [
      mine ? '<span class="tag you">You</span>' : '',
      seat.host ? '<span class="tag">Host</span>' : '',
      seat.bot ? '<span class="tag">Bot</span>' : '',
      seat.connected ? '' : '<span class="tag off">Offline</span>',
    ].join('');
    return `<div class="seat t${team}${mine ? ' me' : ''}"><span class="seat-disc"></span>
      <div class="seat-body"><div class="seat-name">${esc(seat.name)}${tags}</div><div class="seat-sub">${esc(sub)}</div></div>
      ${mine && snap.kind === 'online' ? '<button class="btn small ghost" data-spectate>Watch</button>' : ''}</div>`;
  }).join('');
  const spec = snap.spectators.length
    ? `<div class="spectators">Watching: ${snap.spectators.map(esc).join(', ')}</div>` : '';
  const title = snap.kind === 'solo' ? 'Matchup' : snap.kind === 'local' ? 'Players on this screen' : 'Players';
  return `<div class="card"><h3>${title}</h3><div class="seat-list">${rows}</div>${spec ? `<div style="margin-top:12px">${spec}</div>` : ''}</div>`;
}

function codeCard(snap) {
  const share = typeof navigator.share === 'function';
  return `
    <div class="card room-code-card">
      <h3 style="margin:0">Room code</h3>
      <div class="room-code">${esc(snap.code)}</div>
      <div class="room-code-actions">
        <button class="btn small primary" data-copy="link">Copy invite link</button>
        <button class="btn small" data-copy="code">Copy code</button>
        ${share ? '<button class="btn small" data-share>Share</button>' : ''}
      </div>
      <p class="hint">Friends open the link, or enter the code on the home screen. Extra people join as spectators.</p>
    </div>`;
}

function startArea(snap) {
  const filled = snap.seats.filter(Boolean).length;
  const need = snap.seats.length - filled;
  if (!snap.you.isHost) {
    return `<div class="start-area"><button class="btn big block" disabled>Waiting for the host to start</button></div>`;
  }
  let label = 'Start match';
  if (!snap.canStart) label = need > 0 ? `Waiting for ${need} more player${need > 1 ? 's' : ''}` : 'Waiting for players to reconnect';
  return `<div class="start-area"><button class="btn hot big block" id="l-start" ${snap.canStart ? '' : 'disabled'}>${label}</button></div>`;
}

export function renderLobby(root, snap, ctx) {
  // Keep focus and caret in a name field across re-renders.
  const active = document.activeElement;
  const keep = active && active.id && root.contains(active) && active.tagName === 'INPUT'
    ? { id: active.id, value: active.value, s: active.selectionStart, e: active.selectionEnd } : null;

  const title = snap.kind === 'online' ? 'Lobby' : snap.kind === 'solo' ? 'Bot practice' : 'Same screen';
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="l-leave" title="Leave" aria-label="Leave">${ICONS.back}</button>
      <div class="brand">OVERDROP</div>
      <div class="spacer"></div>
      <div class="meta">${title}</div>
      <button class="icon-btn" id="l-help" title="How to play" aria-label="How to play">?</button>
    </header>
    <section class="lobby">
      <div class="lobby-col">
        ${snap.kind === 'online' ? codeCard(snap) : ''}
        ${seatsCard(snap)}
        ${startArea(snap)}
      </div>
      <div class="lobby-col">${settingsCard(snap)}</div>
    </section>`;

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.s, keep.e); } catch { /* not a text input */ }
    }
  }

  $('#l-leave', root).addEventListener('click', ctx.leave);
  $('#l-help', root).addEventListener('click', showRules);
  const start = $('#l-start', root);
  if (start) start.addEventListener('click', () => ctx.send({ t: 'start' }));

  $$('.seg', root).forEach((group) => {
    const key = group.dataset.key;
    group.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.classList.contains('on')) return;
      const raw = b.dataset.val;
      let patch;
      if (key === 'board') patch = { board: raw.split('x').map(Number) };
      else if (key === 'abilities') patch = { abilities: raw === 'on' };
      else if (key === 'clock' || key === 'collapse' || key === 'matchTo') patch = { [key]: Number(raw) };
      else if (key === 'preset' && raw === 'custom') return;
      else patch = { [key]: raw };
      ctx.send({ t: 'cfg', p: patch });
    });
  });

  $$('[data-sit]', root).forEach((b) => b.addEventListener('click', () => ctx.send({ t: 'sit', i: Number(b.dataset.sit) })));
  const spec = $('[data-spectate]', root);
  if (spec) spec.addEventListener('click', () => ctx.send({ t: 'spectate' }));

  $$('[data-lname]', root).forEach((input) => {
    const commit = () => ctx.send({ t: 'lname', i: Number(input.dataset.lname), n: input.value });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });

  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.copy === 'link' ? inviteLink(snap.code) : snap.code;
    const ok = await copyText(text);
    toast(ok ? (b.dataset.copy === 'link' ? 'Invite link copied' : 'Code copied') : 'Copy failed. Select the code instead.', ok ? {} : { kind: 'err' });
  }));
  const share = $('[data-share]', root);
  if (share) {
    share.addEventListener('click', () => {
      navigator.share({ title: 'OVERDROP', text: `Join my OVERDROP room: ${snap.code}`, url: inviteLink(snap.code) }).catch(() => {});
    });
  }
}
