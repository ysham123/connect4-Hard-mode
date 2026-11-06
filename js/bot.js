// OVERDROP practice bot. Runs on a flat Int8Array board (index = r * cols + c, r = 0 is the bottom).
// It plans a full turn (plain drop, wall + drop, bomb, or surge + two drops) and returns the steps.

import { COSTS, WALL } from './engine.js';

const WIN = 1000000;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const LEVELS = {
  easy: { depth: 2, timeMs: 150, noise: 35, blunder: 0.3, foresight: false, abilityChance: 0.35, margin: 60 },
  normal: { depth: 6, timeMs: 500, noise: 3, blunder: 0, foresight: true, abilityChance: 0.85, margin: 35 },
  hard: { depth: 10, timeMs: 1200, noise: 0, blunder: 0, foresight: true, abilityChance: 1, margin: 25 },
};

const ENERGY_VALUE = 12;
const DANGER = WIN / 2;

const windowCache = new Map();
function windowsFor(cols, rows) {
  const key = cols * 100 + rows;
  let w = windowCache.get(key);
  if (w) return w;
  const list = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 3;
        const ec = c + dc * 3;
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
        for (let i = 0; i < 4; i++) list.push((r + dr * i) * cols + (c + dc * i));
      }
    }
  }
  w = Int16Array.from(list);
  windowCache.set(key, w);
  return w;
}

function centerOrder(cols) {
  const mid = (cols - 1) / 2;
  return [...Array(cols).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

export function flatten(board) {
  const rows = board.length;
  const cols = board[0].length;
  const b = new Int8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) b[r * cols + c] = board[r][c];
  return b;
}

function heightsOf(b, cols, rows) {
  const h = new Int8Array(cols);
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows && b[r * cols + c] !== 0) r++;
    h[c] = r;
  }
  return h;
}

function winAt(b, cols, rows, r, c, v) {
  for (const [dr, dc] of DIRS) {
    let n = 1;
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && b[rr * cols + cc] === v) { n++; rr += dr; cc += dc; }
    rr = r - dr;
    cc = c - dc;
    while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && b[rr * cols + cc] === v) { n++; rr -= dr; cc -= dc; }
    if (n >= 4) return true;
  }
  return false;
}

function hasFour(b, cols, rows, v) {
  const W = windowsFor(cols, rows);
  for (let i = 0; i < W.length; i += 4) {
    if (b[W[i]] === v && b[W[i + 1]] === v && b[W[i + 2]] === v && b[W[i + 3]] === v) return true;
  }
  return false;
}

const SCORE = [0, 1, 6, 40, 0];

function evaluate(b, cols, rows, me, opp) {
  const W = windowsFor(cols, rows);
  let s = 0;
  for (let i = 0; i < W.length; i += 4) {
    let m = 0;
    let o = 0;
    let dead = false;
    for (let k = 0; k < 4; k++) {
      const v = b[W[i + k]];
      if (v === 0) continue;
      if (v === me) m++;
      else if (v === opp) o++;
      else { dead = true; break; }
    }
    if (dead || (m && o)) continue;
    if (m) s += SCORE[m];
    else if (o) s -= SCORE[o] * 1.15;
  }
  const mid = (cols - 1) / 2;
  for (const c of [Math.floor(mid), Math.ceil(mid)]) {
    for (let r = 0; r < rows; r++) {
      const v = b[r * cols + c];
      if (v === me) s += 3;
      else if (v === opp) s -= 3;
    }
  }
  return s;
}

function negamax(ctx, depth, alpha, beta, me, opp, ply) {
  const { b, h, cols, rows, ord } = ctx;
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.abort = true;
  if (ctx.abort) return 0;
  for (const c of ord) {
    const r = h[c];
    if (r >= rows) continue;
    const i = r * cols + c;
    b[i] = me;
    const w = winAt(b, cols, rows, r, c, me);
    b[i] = 0;
    if (w) return WIN - ply;
  }
  if (depth <= 0) return evaluate(b, cols, rows, me, opp);
  let best = -Infinity;
  for (const c of ord) {
    const r = h[c];
    if (r >= rows) continue;
    const i = r * cols + c;
    b[i] = me;
    h[c]++;
    const sc = -negamax(ctx, depth - 1, -beta, -alpha, opp, me, ply + 1);
    b[i] = 0;
    h[c]--;
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? 0 : best;
}

function dropWins(b, h, cols, rows, v) {
  const out = [];
  for (let c = 0; c < cols; c++) {
    const r = h[c];
    if (r >= rows) continue;
    const i = r * cols + c;
    b[i] = v;
    if (winAt(b, cols, rows, r, c, v)) out.push(c);
    b[i] = 0;
  }
  return out;
}

function bombBoard(b, cols, rows, r, c) {
  const nb = b.slice();
  for (let rr = r; rr < rows - 1; rr++) nb[rr * cols + c] = nb[(rr + 1) * cols + c];
  nb[(rows - 1) * cols + c] = 0;
  return nb;
}

function wallWin(b, h, cols, rows, v) {
  for (let c = 0; c < cols; c++) {
    const r = h[c];
    if (r + 1 >= rows) continue;
    const i = r * cols + c;
    const j = (r + 1) * cols + c;
    b[i] = WALL;
    b[j] = v;
    const w = winAt(b, cols, rows, r + 1, c, v);
    b[i] = 0;
    b[j] = 0;
    if (w) return c;
  }
  return -1;
}

function surgeWin(b, h, cols, rows, v) {
  for (let c1 = 0; c1 < cols; c1++) {
    const r1 = h[c1];
    if (r1 >= rows) continue;
    const i = r1 * cols + c1;
    b[i] = v;
    if (winAt(b, cols, rows, r1, c1, v)) { b[i] = 0; return [c1]; }
    h[c1]++;
    for (let c2 = 0; c2 < cols; c2++) {
      const r2 = h[c2];
      if (r2 >= rows) continue;
      const j = r2 * cols + c2;
      b[j] = v;
      const w = winAt(b, cols, rows, r2, c2, v);
      b[j] = 0;
      if (w) { h[c1]--; b[i] = 0; return [c1, c2]; }
    }
    h[c1]--;
    b[i] = 0;
  }
  return null;
}

function bombWin(b, cols, rows, v) {
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    if (x === 0 || x === v) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (hasFour(bombBoard(b, cols, rows, r, c), cols, rows, v)) return { r, c };
  }
  return null;
}

// Can `who` win on their next turn, given the energy they will have then?
function threatLevel(b, cols, rows, who, energy, abilities) {
  const h = heightsOf(b, cols, rows);
  if (dropWins(b, h, cols, rows, who).length) return 3;
  if (!abilities) return 0;
  if (energy >= COSTS.wall && wallWin(b, h, cols, rows, who) >= 0) return 2;
  if (energy >= COSTS.bomb && bombWin(b, cols, rows, who)) return 2;
  if (energy >= COSTS.surge && surgeWin(b, h, cols, rows, who)) return 2;
  return 0;
}

// Enumerate every way to spend this turn. Each plan carries its resulting board.
function enumeratePlans(b, cols, rows, me, energy, canAbility, surgeLeft) {
  const plans = [];
  const h = heightsOf(b, cols, rows);
  const legal = [];
  for (let c = 0; c < cols; c++) if (h[c] < rows) legal.push(c);

  const dropPlan = (src, srcH, c, steps, cost) => {
    const nb = src.slice();
    const r = srcH[c];
    nb[r * cols + c] = me;
    return { steps: [...steps, { type: 'drop', col: c }], cost, board: nb, win: winAt(nb, cols, rows, r, c, me) };
  };

  if (surgeLeft === 2) {
    for (const c1 of legal) {
      const p1 = dropPlan(b, h, c1, [], 0);
      if (p1.win) { plans.push(p1); continue; }
      const h1 = heightsOf(p1.board, cols, rows);
      for (let c2 = 0; c2 < cols; c2++) {
        if (h1[c2] >= rows) continue;
        const p2 = dropPlan(p1.board, h1, c2, p1.steps, 0);
        plans.push(p2);
      }
    }
    return plans;
  }

  for (const c of legal) plans.push(dropPlan(b, h, c, [], 0));
  if (!canAbility) return plans;

  if (energy >= COSTS.wall) {
    for (const w of legal) {
      const wb = b.slice();
      wb[h[w] * cols + w] = WALL;
      const wh = heightsOf(wb, cols, rows);
      for (let c = 0; c < cols; c++) {
        if (wh[c] >= rows) continue;
        plans.push(dropPlan(wb, wh, c, [{ type: 'wall', col: w }], COSTS.wall));
      }
    }
  }
  if (energy >= COSTS.bomb) {
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      if (x === 0 || x === me) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      const nb = bombBoard(b, cols, rows, r, c);
      plans.push({ steps: [{ type: 'bomb', r, c }], cost: COSTS.bomb, board: nb, win: hasFour(nb, cols, rows, me), bomb: true });
    }
  }
  if (energy >= COSTS.surge) {
    for (const c1 of legal) {
      const p1 = dropPlan(b, h, c1, [{ type: 'surge' }], COSTS.surge);
      if (p1.win) { plans.push(p1); continue; }
      const h1 = heightsOf(p1.board, cols, rows);
      for (let c2 = 0; c2 < cols; c2++) {
        if (h1[c2] >= rows) continue;
        plans.push(dropPlan(p1.board, h1, c2, p1.steps, COSTS.surge));
      }
    }
  }
  return plans;
}

function shallowScore(plan, cols, rows, me, opp, oppEnergyNext, abilities, cfg) {
  if (plan.win) return WIN;
  const b = plan.board;
  if (plan.bomb && hasFour(b, cols, rows, opp)) return -WIN; // bomb that completes the enemy line
  const h = heightsOf(b, cols, rows);
  const ctx = { b, h, cols, rows, ord: centerOrder(cols), deadline: Infinity, abort: false, nodes: 0 };
  let s = -negamax(ctx, 2, -Infinity, Infinity, opp, me, 1);
  if (cfg.foresight && s > -WIN / 2) {
    const t = threatLevel(b, cols, rows, opp, oppEnergyNext, abilities);
    if (t === 2) s -= DANGER;
  }
  return s - plan.cost * ENERGY_VALUE;
}

function deepDropScores(b, cols, rows, me, opp, cfg) {
  const h = heightsOf(b, cols, rows);
  const ord = centerOrder(cols);
  const deadline = Date.now() + cfg.timeMs;
  let final = null;
  for (let d = 1; d <= cfg.depth; d++) {
    const ctx = { b, h, cols, rows, ord, deadline: d === 1 ? Infinity : deadline, abort: false, nodes: 0 };
    const scores = new Map();
    for (const c of ord) {
      const r = h[c];
      if (r >= rows) continue;
      const i = r * cols + c;
      b[i] = me;
      let s;
      if (winAt(b, cols, rows, r, c, me)) s = WIN;
      else {
        h[c]++;
        s = -negamax(ctx, d - 1, -Infinity, Infinity, opp, me, 1);
        h[c]--;
      }
      b[i] = 0;
      if (ctx.abort) break;
      scores.set(c, s);
    }
    if (ctx.abort) break;
    final = scores;
    const top = Math.max(...scores.values());
    if (Math.abs(top) >= WIN - 100) break;
    if (Date.now() > deadline) break;
  }
  return final;
}

// input: { board (2D), me, opp, energy, oppEnergy, abilities, used, surge, level, rand }
// returns: array of steps (engine actions) for the rest of this turn
export function planTurn(input) {
  const cfg = LEVELS[input.level] || LEVELS.normal;
  const rand = input.rand || Math.random;
  const rows = input.board.length;
  const cols = input.board[0].length;
  const b = flatten(input.board);
  const { me, opp, abilities } = input;
  const energy = input.energy || 0;
  const oppEnergyNext = Math.min(6, (input.oppEnergy || 0) + 1);
  const canAbility = !!abilities && !input.used && (rand() < cfg.abilityChance);
  const surgeLeft = input.surge || 0;
  const h = heightsOf(b, cols, rows);
  const legal = [];
  for (let c = 0; c < cols; c++) if (h[c] < rows) legal.push(c);
  if (!legal.length) return [];

  // 1. Win right now with a plain drop.
  const wins = dropWins(b, h, cols, rows, me);
  if (wins.length && rand() >= cfg.blunder / 3) return [{ type: 'drop', col: wins[0] }];

  // 2. Second drop of a surge, or the drop after a wall: plain search.
  if (surgeLeft === 1 || input.used === 'wall') return [{ type: 'drop', col: pickDeepDrop(b, cols, rows, me, opp, cfg, oppEnergyNext, abilities, rand) }];

  // 3. Score every possible turn plan with a shallow search.
  const plans = enumeratePlans(b, cols, rows, me, energy, canAbility, surgeLeft);
  let bestAbility = null;
  let bestPlain = null;
  for (const p of plans) {
    p.score = shallowScore(p, cols, rows, me, opp, oppEnergyNext, abilities, cfg) + (cfg.noise ? (rand() - 0.5) * cfg.noise : 0);
    const isAbility = p.steps[0].type !== 'drop';
    if (isAbility) { if (!bestAbility || p.score > bestAbility.score) bestAbility = p; } else if (!bestPlain || p.score > bestPlain.score) bestPlain = p;
  }

  if (surgeLeft === 2) {
    const best = plans.reduce((a, p) => (p.score > a.score ? p : a), plans[0]);
    return best.steps;
  }

  // Easy bots sometimes miss a forced block.
  const oppWins = dropWins(b, h, cols, rows, opp);
  if (oppWins.length && cfg.blunder && rand() < cfg.blunder) return [{ type: 'drop', col: legal[Math.floor(rand() * legal.length)] }];

  if (bestAbility && (!bestPlain || bestAbility.score > bestPlain.score + cfg.margin)) return bestAbility.steps;
  if (bestPlain && bestPlain.score >= WIN / 2) return bestPlain.steps;

  // 4. No ability worth it: choose the plain drop with a deeper search.
  return [{ type: 'drop', col: pickDeepDrop(b, cols, rows, me, opp, cfg, oppEnergyNext, abilities, rand) }];
}

function pickDeepDrop(b, cols, rows, me, opp, cfg, oppEnergyNext, abilities, rand) {
  const scores = deepDropScores(b, cols, rows, me, opp, cfg);
  let best = -1;
  let bestScore = -Infinity;
  for (const [c, s0] of scores) {
    let s = s0;
    if (cfg.foresight && abilities && s > -WIN / 2 && s < WIN / 2) {
      const nb = b.slice();
      const h = heightsOf(nb, cols, rows);
      nb[h[c] * cols + c] = me;
      if (threatLevel(nb, cols, rows, opp, oppEnergyNext, abilities) === 2) s -= DANGER;
    }
    if (cfg.noise) s += (rand() - 0.5) * cfg.noise;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}
