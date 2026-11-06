// App entry: screen routing and session lifecycle.

import { HostSession, GuestSession, LocalSession, normalizeCode } from './net.js';
import { renderHome, renderConnecting } from './ui/home.js';
import { renderLobby } from './ui/lobby.js';
import { GameView } from './ui/game.js';
import { toast, confirmModal, openModal, esc } from './ui/dom.js';
import { unlockAudio } from './audio.js';

const root = document.getElementById('app');

const app = {
  session: null,
  view: null,
  snap: null,
  token: 0,
  banner: null,
};

function setQuery(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function remember(code) {
  try {
    if (code) sessionStorage.setItem('overdrop.lastRoom', code);
    else sessionStorage.removeItem('overdrop.lastRoom');
  } catch { /* ignore */ }
}

function lastRoom() {
  try { return sessionStorage.getItem('overdrop.lastRoom'); } catch { return null; }
}

function clearView() {
  if (app.view) { app.view.destroy(); app.view = null; }
  setBanner(null);
}

function teardown() {
  app.token++;
  if (app.session) { try { app.session.close(); } catch { /* ignore */ } }
  app.session = null;
  app.snap = null;
  clearView();
}

function goHome(message) {
  teardown();
  remember(null);
  const invite = normalizeCode(new URLSearchParams(location.search).get('room'));
  renderHome(root, {
    invite: invite.length === 5 ? invite : '',
    onCreate: createRoom,
    onJoin: joinRoom,
    onLocal: (name) => startLocal('local', name),
    onSolo: (name) => startLocal('solo', name),
  });
  window.scrollTo(0, 0);
  if (message) {
    openModal(`<h2>Heads up</h2><p>${esc(message)}</p><div class="modal-actions"><button class="btn primary" data-close data-autofocus>OK</button></div>`, { small: true });
  }
}

function setBanner(text) {
  if (app.banner) { app.banner.remove(); app.banner = null; }
  if (!text) return;
  app.banner = document.createElement('div');
  app.banner.className = 'conn-banner';
  app.banner.textContent = text;
  document.body.appendChild(app.banner);
}

function handlers(token) {
  return {
    onSnapshot: (snap) => { if (token === app.token) onSnapshot(snap); },
    onEvent: (ev) => { if (token === app.token) onEvent(ev); },
    onStatus: (st, reason) => {
      if (token !== app.token) return;
      if (st === 'reconnecting') setBanner('Connection lost. Reconnecting...');
      else if (st === 'ok') { setBanner(null); toast('Reconnected'); } else if (st === 'closed') { setQuery(null); goHome(reason); }
    },
  };
}

async function createRoom(name) {
  unlockAudio();
  teardown();
  const token = app.token;
  renderConnecting(root, { title: 'Creating room', sub: 'Setting up a private room for you and your friends.', onCancel: () => goHome() });
  const s = new HostSession({ name, ...handlers(token) });
  app.session = s;
  try {
    await s.open();
  } catch (err) {
    if (token === app.token) goHome(err.message);
  }
}

async function joinRoom(name, code) {
  unlockAudio();
  teardown();
  const token = app.token;
  renderConnecting(root, { title: `Joining ${code}`, sub: 'Connecting directly to the host.', onCancel: () => { setQuery(null); goHome(); } });
  const s = new GuestSession({ name, code, ...handlers(token) });
  app.session = s;
  try {
    await s.open();
    if (token !== app.token) { s.close(); return; }
    setQuery(code);
    remember(code);
  } catch (err) {
    if (token === app.token) goHome(err.message);
  }
}

function startLocal(kind, name) {
  unlockAudio();
  teardown();
  setQuery(null);
  const token = app.token;
  const s = new LocalSession({ kind, name, ...handlers(token) });
  app.session = s;
  s.open();
}

function ctx() {
  return {
    send: (msg) => app.session && app.session.send(msg),
    leave: () => leave(),
  };
}

function onSnapshot(snap) {
  app.snap = snap;
  if (snap.stage === 'lobby') {
    if (app.view) clearView();
    renderLobby(root, snap, ctx());
  } else {
    if (!app.view) {
      root.innerHTML = '';
      app.view = new GameView(root, ctx());
    }
    app.view.update(snap);
  }
}

function onEvent(ev) {
  if (!ev) return;
  if (ev.t === 'emote') {
    if (app.view) app.view.showEmote(ev);
    else toast(`${ev.name}: ${ev.e}`);
  } else if (ev.t === 'err') {
    if (app.view) app.view.onError(ev.m);
    else toast(ev.m, { kind: 'err' });
  }
}

async function leave() {
  const s = app.session;
  const snap = app.snap;
  if (s && snap) {
    const live = snap.stage === 'game' && snap.game && snap.game.phase !== 'matchEnd';
    const hosting = s instanceof HostSession;
    if (live || hosting) {
      const ok = await confirmModal({
        title: hosting ? 'Close the room?' : 'Leave the match?',
        body: hosting ? 'You are the host. Leaving closes the room for everyone.' : 'Your seat stays open for a bit if you rejoin from this tab.',
        ok: hosting ? 'Close room' : 'Leave',
        danger: true,
      });
      if (!ok) return;
    }
  }
  setQuery(null);
  goHome();
}

window.addEventListener('beforeunload', (e) => {
  const s = app.session;
  if (!s || !app.snap) return;
  const live = app.snap.stage === 'game' && app.snap.game && app.snap.game.phase !== 'matchEnd';
  if (s instanceof HostSession || (live && !(s instanceof LocalSession))) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Boot: rejoin automatically after a refresh, otherwise show home (with an invite if present).
const invite = normalizeCode(new URLSearchParams(location.search).get('room'));
let savedName = '';
try { savedName = localStorage.getItem('overdrop.name') || ''; } catch { /* ignore */ }
if (invite.length === 5 && lastRoom() === invite) {
  joinRoom(savedName, invite);
} else {
  goHome();
}
