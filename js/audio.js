// Synthesized sound effects. No audio files needed.

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('overdrop.muted') === '1'; } catch { /* storage blocked */ }

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() {
  if (!muted) ensure();
}

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('overdrop.muted', muted ? '1' : '0'); } catch { /* ignore */ }
}

function tone({ type = 'sine', f0, f1 = f0, dur = 0.15, vol = 0.3, at = 0, attack = 0.004 }) {
  const c = ensure();
  if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur = 0.3, vol = 0.4, f0 = 2000, f1 = f0, q = 0.8, type = 'lowpass', at = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  drop(row = 0) {
    tone({ type: 'sine', f0: 210 + row * 22, f1: 70, dur: 0.16, vol: 0.45 });
    noise({ dur: 0.06, vol: 0.18, f0: 3500, f1: 900, type: 'bandpass', q: 1.2 });
  },
  wall() {
    tone({ type: 'square', f0: 120, f1: 55, dur: 0.22, vol: 0.18 });
    noise({ dur: 0.18, vol: 0.3, f0: 900, f1: 200 });
    tone({ type: 'triangle', f0: 880, f1: 860, dur: 0.25, vol: 0.06, at: 0.01 });
  },
  bomb() {
    noise({ dur: 1.1, vol: 0.9, f0: 4000, f1: 60 });
    tone({ type: 'sine', f0: 140, f1: 28, dur: 0.8, vol: 0.7 });
    tone({ type: 'sawtooth', f0: 70, f1: 30, dur: 0.5, vol: 0.12 });
  },
  surge() {
    tone({ type: 'sawtooth', f0: 180, f1: 1400, dur: 0.38, vol: 0.12 });
    tone({ type: 'square', f0: 360, f1: 2200, dur: 0.3, vol: 0.05, at: 0.06 });
    noise({ dur: 0.35, vol: 0.12, f0: 1000, f1: 8000, type: 'highpass' });
  },
  collapse() {
    noise({ dur: 1.4, vol: 0.85, f0: 500, f1: 40 });
    tone({ type: 'sine', f0: 65, f1: 30, dur: 1.3, vol: 0.6 });
    tone({ type: 'triangle', f0: 220, f1: 50, dur: 0.6, vol: 0.15, at: 0.05 });
  },
  tick(urgent) {
    tone({ type: 'square', f0: urgent ? 1320 : 990, dur: 0.05, vol: urgent ? 0.09 : 0.05 });
  },
  timeout() {
    tone({ type: 'square', f0: 240, dur: 0.18, vol: 0.12 });
    tone({ type: 'square', f0: 160, dur: 0.3, vol: 0.12, at: 0.18 });
  },
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.32, vol: 0.22, at: i * 0.09 }));
    noise({ dur: 0.6, vol: 0.08, f0: 6000, f1: 9000, type: 'highpass', at: 0.4 });
  },
  lose() {
    [392, 330, 262, 196].forEach((f, i) => tone({ type: 'sawtooth', f0: f, f1: f * 0.97, dur: 0.3, vol: 0.08, at: i * 0.13 }));
  },
  round() {
    tone({ type: 'sawtooth', f0: 90, f1: 360, dur: 0.6, vol: 0.08 });
    noise({ dur: 0.6, vol: 0.12, f0: 300, f1: 3000, type: 'bandpass', q: 2 });
  },
  go() {
    tone({ type: 'square', f0: 880, dur: 0.08, vol: 0.08 });
    tone({ type: 'square', f0: 1320, dur: 0.14, vol: 0.08, at: 0.09 });
  },
  click() {
    tone({ type: 'triangle', f0: 1200, f1: 900, dur: 0.04, vol: 0.06 });
  },
  pop() {
    tone({ type: 'sine', f0: 600, f1: 1200, dur: 0.1, vol: 0.12 });
  },
  error() {
    tone({ type: 'square', f0: 150, dur: 0.12, vol: 0.08 });
  },
};

export function buzz(pattern) {
  try { if (!muted && navigator.vibrate) navigator.vibrate(pattern); } catch { /* unsupported */ }
}
