// Home screen: name, create room, join room, same screen, bot practice.

import { $, esc, store } from './dom.js';
import { normalizeCode } from '../net.js';
import { showRules } from './rules.js';

export function renderHome(root, { invite = '', onCreate, onJoin, onLocal, onSolo }) {
  const savedName = store('overdrop.name') || '';
  root.innerHTML = `
    <section class="home">
      <div class="home-inner">
        <div>
          <div class="logo-discs"><i class="t0"></i><i class="t1"></i><i class="t2"></i><i class="t3"></i></div>
          <h1 class="logo">OVERDROP</h1>
          <p class="tagline">Four in a row, turned all the way up.<br>Abilities. A shot clock. A floor that falls out.</p>
        </div>
        <div class="feature-row">
          <span class="pill">1v1</span><span class="pill">2v2</span><span class="pill">Free for all</span><span class="pill">Bot practice</span>
        </div>
        ${invite ? `<div class="invite-banner">You were invited to room <b>${esc(invite)}</b>. Enter a name and hit Join.</div>` : ''}
        <label class="field"><span>Your name</span>
          <input class="input" id="h-name" maxlength="16" autocomplete="nickname" placeholder="Pick a name" value="${esc(savedName)}">
        </label>
        <div class="home-actions">
          ${invite ? '' : '<button class="btn primary big block" id="h-create">Create online room</button><div class="or">or join one</div>'}
          <div class="join-row">
            <input class="input code" id="h-code" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(invite)}">
            <button class="btn ${invite ? 'primary' : ''}" id="h-join">Join</button>
          </div>
          ${invite ? '<button class="btn block" id="h-create">Create my own room instead</button>' : ''}
          <div class="or">offline</div>
          <div class="split">
            <button class="btn" id="h-local">Same screen</button>
            <button class="btn" id="h-solo">Practice vs bot</button>
          </div>
          <button class="linkish" id="h-rules">How to play</button>
        </div>
      </div>
    </section>`;

  const nameEl = $('#h-name', root);
  const codeEl = $('#h-code', root);
  const name = () => {
    const n = nameEl.value.trim().slice(0, 16);
    store('overdrop.name', n);
    return n || 'Player';
  };
  const join = () => {
    const code = normalizeCode(codeEl.value);
    codeEl.value = code;
    if (code.length !== 5) {
      codeEl.focus();
      codeEl.classList.remove('shake');
      void codeEl.offsetWidth;
      codeEl.classList.add('shake');
      return;
    }
    onJoin(name(), code);
  };
  codeEl.addEventListener('input', () => { codeEl.value = normalizeCode(codeEl.value); });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') (invite ? join() : onCreate(name())); });
  $('#h-join', root).addEventListener('click', join);
  $('#h-create', root).addEventListener('click', () => onCreate(name()));
  $('#h-local', root).addEventListener('click', () => onLocal(name()));
  $('#h-solo', root).addEventListener('click', () => onSolo(name()));
  $('#h-rules', root).addEventListener('click', showRules);
  if (invite || !savedName) nameEl.focus();
}

export function renderConnecting(root, { title, sub, onCancel }) {
  root.innerHTML = `
    <section class="center-screen">
      <div class="card">
        <div class="spinner"></div>
        <h2 style="margin:0;font-family:var(--display);letter-spacing:.04em">${esc(title)}</h2>
        <p class="hint">${esc(sub || '')}</p>
        <button class="btn ghost small" id="c-cancel">Cancel</button>
      </div>
    </section>`;
  $('#c-cancel', root).addEventListener('click', onCancel);
}
