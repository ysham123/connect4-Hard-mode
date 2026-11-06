// Board renderer: discs, fall animations, effects, hover marks and pointer input.

import { WALL, EMPTY, landingRow, canDrop } from '../engine.js';

const DZ = 0.95; // drop zone height in cells

export class Board {
  constructor(area, { onHover, onLeave, onTap }) {
    this.area = area;
    this.cb = { onHover, onLeave, onTap };
    this.el = document.createElement('div');
    this.el.className = 'board-wrap';
    this.el.innerHTML = `
      <div class="dropzone"><div class="dz-disc hidden"></div></div>
      <div class="board-frame">
        <div class="board">
          <div class="discs"></div>
          <div class="plate"></div>
          <div class="rims"></div>
          <div class="sheen"></div>
          <div class="marks"></div>
          <div class="fxl"></div>
        </div>
      </div>
      <div class="hit"></div>`;
    area.prepend(this.el);
    this.frame = this.el.querySelector('.board-frame');
    this.boardEl = this.el.querySelector('.board');
    this.discs = this.el.querySelector('.discs');
    this.marks = this.el.querySelector('.marks');
    this.fxl = this.el.querySelector('.fxl');
    this.dz = this.el.querySelector('.dz-disc');
    this.hit = this.el.querySelector('.hit');
    this.cols = 7;
    this.rows = 6;
    this.cell = 64;
    this.marksKey = '';
    this.bindInput();
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(area);
  }

  setDims(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.el.style.setProperty('--cols', cols);
    this.el.style.setProperty('--rows', rows);
    this.fit();
  }

  fit() {
    const w = this.area.clientWidth - 28;
    const h = this.area.clientHeight - 24;
    if (w <= 0 || h <= 0) return;
    const cell = Math.max(26, Math.min(92, Math.floor(Math.min(w / this.cols, h / (this.rows + DZ)))));
    this.cell = cell;
    this.el.style.setProperty('--cell', cell + 'px');
  }

  // ---------- input ----------

  locate(e) {
    const rect = this.hit.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / this.cell);
    if (col < 0 || col >= this.cols) return null;
    const dzH = this.cell * DZ;
    const row = y < dzH ? null : this.rows - 1 - Math.floor((y - dzH) / this.cell);
    return { col, row: row != null && row >= 0 && row < this.rows ? row : null };
  }

  bindInput() {
    let downType = 'mouse';
    this.hit.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const at = this.locate(e);
      if (at) this.cb.onHover(at.col, at.row); else this.cb.onLeave();
    });
    this.hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.cb.onLeave(); });
    this.hit.addEventListener('pointerdown', (e) => { downType = e.pointerType || 'mouse'; });
    this.hit.addEventListener('click', (e) => {
      const at = this.locate(e);
      if (at) this.cb.onTap(at.col, at.row, downType === 'touch' || downType === 'pen');
    });
  }

  setLocked(locked, bombMode) {
    this.hit.classList.toggle('locked', !!locked);
    this.hit.classList.toggle('bomb', !!bombMode);
  }

  // ---------- discs and effects ----------

  // Draw all discs. When animate is true, use g.fx to animate exactly what changed.
  // Returns landing events [{ t, r, v }] so the caller can time sounds.
  renderDiscs(g, animate) {
    const { rows } = g.settings;
    this.setDims(g.settings.cols, rows);
    const fx = animate ? g.fx : null;
    const placed = new Map();
    const moved = new Map();
    let collapsed = false;
    if (fx && fx.placed) {
      fx.placed.forEach((p, i) => placed.set(p.r * 100 + p.c, i));
      for (const m of fx.moved) moved.set(m.to * 100 + m.c, m.from);
      collapsed = !!fx.collapsed;
    }
    const win = new Set(g.result && g.result.team >= 0 ? g.result.cells.map(([r, c]) => r * 100 + c) : []);
    if (g.result && g.result.team < 0) for (const [r, c] of g.result.cells) win.add(r * 100 + c);
    const bombDelay = fx && fx.kind === 'bomb' ? 200 : 0;
    const lands = [];
    let html = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < g.settings.cols; c++) {
        const v = g.board[r][c];
        if (v === EMPTY) continue;
        const k = r * 100 + c;
        let fall = 0;
        let delay = 0;
        if (placed.has(k)) { fall = rows - r + 0.3; delay = placed.get(k) * 180; } else if (moved.has(k)) { fall = moved.get(k) - r; delay = bombDelay; } else if (collapsed) { fall = 1; delay = 150; }
        const cls = `disc ${v === WALL ? 'tw' : 't' + (v - 1)}${win.has(k) ? ' win' : ''}`;
        if (fall > 0) {
          const dur = Math.round(140 + 100 * Math.sqrt(fall));
          html += `<div class="${cls} fall" style="--r:${r};--c:${c};--fall:${fall};--dur:${dur}ms;--delay:${delay}ms"></div>`;
          if (placed.has(k) || moved.has(k)) lands.push({ t: delay + dur * 0.72, r, v });
        } else {
          html += `<div class="${cls}" style="--r:${r};--c:${c}"></div>`;
        }
      }
    }
    if (fx && fx.collapsed) {
      fx.collapsed.forEach((v, c) => {
        if (v !== EMPTY) html += `<div class="phantom sink ${v === WALL ? 'tw' : 't' + (v - 1)}" style="--r:0;--c:${c}"></div>`;
      });
    }
    if (fx && fx.destroyed && fx.destroyed.length) {
      for (const d of fx.destroyed) {
        html += `<div class="phantom shatter ${d.v === WALL ? 'tw' : 't' + (d.v - 1)}" style="--r:${d.r};--c:${d.c}"></div>`;
        this.explode(d.r, d.c, d.v);
      }
    }
    this.discs.innerHTML = html;
    this.boardEl.classList.toggle('has-result', !!(g.result && g.result.cells.length));
    return lands;
  }

  explode(r, c, v) {
    const colors = ['#ffd166', '#ff3b5c', '#ffffff', v === WALL ? '#9aa3cf' : ['#ff2e63', '#ffc233', '#19d3f5', '#7cf05a'][v - 1]];
    let shards = '';
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const d = this.cell * (0.8 + Math.random() * 1.1);
      shards += `<i style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d)}px;--pc:${colors[i % colors.length]};animation-delay:${Math.round(Math.random() * 60)}ms"></i>`;
    }
    const el = document.createElement('div');
    el.className = 'boom';
    el.style.cssText = `--r:${r};--c:${c}`;
    el.innerHTML = shards;
    this.fxl.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  shake(kind = 'quake') {
    this.frame.classList.remove('quake', 'jolt');
    void this.frame.offsetWidth;
    this.frame.classList.add(kind);
    clearTimeout(this.shakeT);
    this.shakeT = setTimeout(() => this.frame.classList.remove(kind), 700);
  }

  flash(color) {
    this.frame.style.setProperty('--flash', color);
    this.frame.classList.remove('surge-flash');
    void this.frame.offsetWidth;
    this.frame.classList.add('surge-flash');
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => this.frame.classList.remove('surge-flash'), 750);
  }

  setGlow(color) {
    this.frame.style.setProperty('--glow', color || 'rgba(139, 92, 246, 0.25)');
  }

  setHurry(on) {
    this.frame.classList.toggle('hurry', !!on);
  }

  // ---------- marks (hover, targets, win rings, collapse warning) ----------

  renderMarks(o) {
    const g = o.g;
    const key = JSON.stringify([g.seq, o.tool, o.hoverCol, o.hoverRow, o.armed, o.canAct, o.team, o.collapseSoon, o.showResult]);
    if (key === this.marksKey) return;
    this.marksKey = key;
    let html = '';
    if (o.collapseSoon) html += '<div class="collapse-warn"></div>';
    if (o.showResult && g.result) {
      g.result.cells.forEach(([r, c], i) => {
        const v = g.board[r][c];
        const t = g.result.team >= 0 ? g.result.team : v - 1;
        html += `<div class="mark win t${t}" style="--r:${r};--c:${c};--d:${(i * 0.06).toFixed(2)}s"></div>`;
      });
    }
    let dz = null;
    if (o.canAct) {
      const myVal = o.team + 1;
      if (o.tool === 'bomb') {
        for (let r = 0; r < g.settings.rows; r++) {
          for (let c = 0; c < g.settings.cols; c++) {
            const v = g.board[r][c];
            if (v !== EMPTY && v !== myVal) {
              const isTarget = o.hoverCol === c && o.hoverRow === r;
              const armed = o.armed && o.armed.r === r && o.armed.c === c;
              html += `<div class="mark ${isTarget || armed ? 'target' : 'bombable'}${armed ? ' armed' : ''}" style="--r:${r};--c:${c}"></div>`;
            }
          }
        }
      } else if (o.hoverCol != null && canDrop(g.board, o.hoverCol)) {
        const r = landingRow(g.board, o.hoverCol);
        const cls = o.tool === 'wall' ? 'tw' : `t${o.team}`;
        html += `<div class="mark col t${o.team}" style="--c:${o.hoverCol}"></div>`;
        html += `<div class="mark land ${cls}" style="--r:${r};--c:${o.hoverCol}"></div>`;
        dz = { c: o.hoverCol, cls, armed: o.armed && o.armed.c === o.hoverCol && o.armed.r == null };
      }
    }
    this.marks.innerHTML = html;
    if (dz) {
      this.dz.className = `dz-disc ${dz.cls}${dz.armed ? ' armed' : ''}`;
      this.dz.style.setProperty('--c', dz.c);
    } else {
      this.dz.className = 'dz-disc hidden';
    }
  }

  destroy() {
    this.ro.disconnect();
    this.el.remove();
  }
}
