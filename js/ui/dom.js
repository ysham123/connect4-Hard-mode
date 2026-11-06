// Small DOM helpers shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export const TEAM_HEX = ['#ff2e63', '#ffc233', '#19d3f5', '#7cf05a'];

export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage blocked */ }
  return null;
}

export function toast(msg, opts = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (opts.kind ? ' ' + opts.kind : '') + (opts.team != null ? ' t' + opts.team : '');
  el.textContent = msg;
  root.appendChild(el);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, opts.ms || 2200);
}

let openCount = 0;
export function modalOpen() {
  return openCount > 0;
}

export function openModal(html, { small = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${small ? ' small' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(back);
  openCount++;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const first = back.querySelector('[data-autofocus]') || back.querySelector('button');
  if (first) first.focus();
  return { el: back, close };
}

export function confirmModal({ title, body, ok = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal(`
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      <div class="modal-actions">
        <button class="btn ghost" data-close>${esc(cancel)}</button>
        <button class="btn ${danger ? 'hot' : 'primary'}" data-ok data-autofocus>${esc(ok)}</button>
      </div>`, { small: true, onClose: () => resolve(result) });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { result = true; m.close(); });
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export const ICONS = {
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};
