// OVERDROP game engine. Pure rules, no DOM, no networking.
// Board layout: board[r][c], r = 0 is the bottom row.
// Cell values: 0 empty, 1..4 team discs (team index + 1), 9 steel wall.

export const EMPTY = 0;
export const WALL = 9;
export const COSTS = { wall: 2, bomb: 4, surge: 6 };
export const ENERGY_CAP = 6;

export const MODES = {
  duel: { label: '1v1 Duel', teams: [0, 1] },
  teams: { label: '2v2 Teams', teams: [0, 1, 0, 1] },
  ffa3: { label: '3 Player FFA', teams: [0, 1, 2] },
  ffa4: { label: '4 Player FFA', teams: [0, 1, 2, 3] },
};

export const TEAM_NAMES = ['Crimson', 'Gold', 'Cyan', 'Lime'];

export const PRESETS = {
  overdrive: { label: 'Overdrive', cols: 9, rows: 7, clock: 15, abilities: true, collapse: 12, matchTo: 3 },
  blitz: { label: 'Blitz', cols: 8, rows: 7, clock: 6, abilities: true, collapse: 10, matchTo: 3 },
  classic: { label: 'Classic', cols: 7, rows: 6, clock: 0, abilities: false, collapse: 0, matchTo: 1 },
};

export const OPTIONS = {
  board: [[7, 6], [8, 7], [9, 7], [10, 8]],
  clock: [0, 5, 6, 8, 10, 15, 20, 30],
  collapse: [0, 8, 10, 12, 16, 20],
  matchTo: [1, 2, 3, 5],
  botLevel: ['easy', 'normal', 'hard'],
};

export function defaultSettings() {
  return { mode: 'duel', preset: 'overdrive', botLevel: 'normal', ...stripLabel(PRESETS.overdrive) };
}

function stripLabel(p) {
  const { label, ...rest } = p;
  return rest;
}

export function matchPreset(s) {
  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.cols === s.cols && p.rows === s.rows && p.clock === s.clock &&
      p.abilities === s.abilities && p.collapse === s.collapse && p.matchTo === s.matchTo) return key;
  }
  return 'custom';
}

// Merge a patch into settings and clamp every field to an allowed value.
export function applySettingsPatch(current, patch = {}) {
  let s = { ...current };
  if (patch.preset && PRESETS[patch.preset]) s = { ...s, ...stripLabel(PRESETS[patch.preset]) };
  if (patch.mode && MODES[patch.mode]) s.mode = patch.mode;
  if (Array.isArray(patch.board)) {
    const hit = OPTIONS.board.find(([c, r]) => c === patch.board[0] && r === patch.board[1]);
    if (hit) { s.cols = hit[0]; s.rows = hit[1]; }
  }
  if (OPTIONS.clock.includes(patch.clock)) s.clock = patch.clock;
  if (OPTIONS.collapse.includes(patch.collapse)) s.collapse = patch.collapse;
  if (OPTIONS.matchTo.includes(patch.matchTo)) s.matchTo = patch.matchTo;
  if (typeof patch.abilities === 'boolean') s.abilities = patch.abilities;
  if (OPTIONS.botLevel.includes(patch.botLevel)) s.botLevel = patch.botLevel;
  s.preset = matchPreset(s);
  return s;
}

export function teamCount(mode) {
  return Math.max(...MODES[mode].teams) + 1;
}

export function newGame(settings) {
  const teams = MODES[settings.mode].teams;
  const g = {
    settings: { ...settings },
    seats: teams.map((team) => ({
      team,
      energy: 0,
      stats: { drops: 0, walls: 0, bombs: 0, surges: 0, timeouts: 0 },
    })),
    teamScores: new Array(teamCount(settings.mode)).fill(0),
    round: 0,
    phase: 'intro',
    board: [],
    current: 0,
    startSeat: 0,
    turn: 0,
    surge: 0,
    used: null,
    collapses: 0,
    result: null,
    fx: null,
    seq: 0,
  };
  startRound(g);
  return g;
}

export function startRound(g) {
  const { rows, cols } = g.settings;
  g.round += 1;
  g.board = Array.from({ length: rows }, () => new Array(cols).fill(EMPTY));
  g.startSeat = (g.round - 1) % g.seats.length;
  g.current = g.startSeat;
  g.turn = 0;
  g.surge = 0;
  g.used = null;
  g.collapses = 0;
  g.result = null;
  for (const s of g.seats) s.energy = 0;
  gainEnergy(g, g.current);
  g.phase = 'intro';
  g.fx = { kind: 'round' };
  g.seq += 1;
}

export function beginPlay(g) {
  if (g.phase !== 'intro') return false;
  g.phase = 'play';
  g.fx = { kind: 'go' };
  g.seq += 1;
  return true;
}

export function nextRound(g) {
  if (g.phase !== 'roundEnd') return false;
  startRound(g);
  return true;
}

export function rematch(g) {
  const fresh = newGame(g.settings);
  fresh.seq = g.seq + 1;
  return fresh;
}

function gainEnergy(g, seat) {
  if (!g.settings.abilities) return;
  const s = g.seats[seat];
  s.energy = Math.min(ENERGY_CAP, s.energy + 1);
}

export function canDrop(board, c) {
  return c >= 0 && c < board[0].length && board[board.length - 1][c] === EMPTY;
}

export function legalCols(board) {
  const out = [];
  for (let c = 0; c < board[0].length; c++) if (canDrop(board, c)) out.push(c);
  return out;
}

export function landingRow(board, c) {
  for (let r = 0; r < board.length; r++) if (board[r][c] === EMPTY) return r;
  return -1;
}

function place(board, c, v) {
  const r = landingRow(board, c);
  board[r][c] = v;
  return r;
}

// Gravity for one column. Records every disc that moved.
function compactColumn(board, c, moved) {
  let write = 0;
  for (let r = 0; r < board.length; r++) {
    const v = board[r][c];
    if (v === EMPTY) continue;
    if (r !== write) {
      board[write][c] = v;
      board[r][c] = EMPTY;
      moved.push({ c, from: r, to: write });
    }
    write++;
  }
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

// Returns Map<cellValue, { lines, cells: [[r, c], ...] }> for every run of 4 or more.
export function findLines(board) {
  const rows = board.length;
  const cols = board[0].length;
  const out = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = board[r][c];
      if (v === EMPTY || v === WALL) continue;
      for (const [dr, dc] of DIRS) {
        const pr = r - dr;
        const pc = c - dc;
        if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && board[pr][pc] === v) continue; // not a run start
        let len = 0;
        let rr = r;
        let cc = c;
        while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr][cc] === v) {
          len++;
          rr += dr;
          cc += dc;
        }
        if (len >= 4) {
          if (!out.has(v)) out.set(v, { lines: 0, cells: [] });
          const entry = out.get(v);
          entry.lines += 1;
          for (let i = 0; i < len; i++) entry.cells.push([r + dr * i, c + dc * i]);
        }
      }
    }
  }
  return out;
}

function uniqueCells(cells) {
  const seen = new Set();
  const out = [];
  for (const [r, c] of cells) {
    const k = r * 100 + c;
    if (!seen.has(k)) { seen.add(k); out.push([r, c]); }
  }
  return out;
}

function endRound(g, team, cells, reason) {
  g.result = { team, cells: uniqueCells(cells || []), reason };
  g.surge = 0;
  g.used = null;
  if (team >= 0) {
    g.teamScores[team] += 1;
    g.phase = g.teamScores[team] >= g.settings.matchTo ? 'matchEnd' : 'roundEnd';
  } else {
    g.phase = 'roundEnd';
  }
}

// Check lines after an action by moverSeat. Mover's own line has priority.
function resolveAfterMove(g, moverSeat, reason) {
  const found = findLines(g.board);
  if (found.size === 0) return false;
  const moverTeam = g.seats[moverSeat].team;
  if (found.has(moverTeam + 1)) {
    endRound(g, moverTeam, found.get(moverTeam + 1).cells, reason);
    return true;
  }
  const n = g.seats.length;
  for (let i = 1; i <= n; i++) {
    const t = g.seats[(moverSeat + i) % n].team;
    if (found.has(t + 1)) {
      endRound(g, t, found.get(t + 1).cells, reason === 'bomb' ? 'backfire' : reason);
      return true;
    }
  }
  return false;
}

// Check lines after a collapse. Most lines wins, a tie is a drawn round.
function resolveAfterCollapse(g) {
  const found = findLines(g.board);
  if (found.size === 0) return false;
  let best = -1;
  let bestLines = 0;
  let tie = false;
  for (const [v, entry] of found) {
    if (entry.lines > bestLines) { best = v; bestLines = entry.lines; tie = false; } else if (entry.lines === bestLines) tie = true;
  }
  if (tie) {
    const all = [];
    for (const e of found.values()) all.push(...e.cells);
    endRound(g, -1, all, 'collapseTie');
  } else {
    endRound(g, best - 1, found.get(best).cells, 'collapse');
  }
  return true;
}

function doCollapse(g, fx) {
  const { cols } = g.settings;
  const bottom = g.board.shift();
  g.board.push(new Array(cols).fill(EMPTY));
  g.collapses += 1;
  fx.collapsed = bottom;
  fx.placed = fx.placed.filter((p) => p.r > 0).map((p) => ({ ...p, r: p.r - 1 }));
  fx.moved = fx.moved.filter((m) => m.to > 0).map((m) => ({ ...m, to: m.to - 1 }));
}

export function turnsUntilCollapse(g) {
  const n = g.settings.collapse;
  if (!n) return null;
  return n - (g.turn % n);
}

function endTurn(g, fx) {
  g.turn += 1;
  g.surge = 0;
  g.used = null;
  const S = g.settings;
  if (S.collapse > 0 && g.turn % S.collapse === 0) {
    doCollapse(g, fx);
    if (resolveAfterCollapse(g)) return;
  }
  g.current = (g.current + 1) % g.seats.length;
  gainEnergy(g, g.current);
  if (legalCols(g.board).length === 0) {
    if (S.collapse > 0) {
      doCollapse(g, fx);
      fx.forced = true;
      resolveAfterCollapse(g);
    } else {
      endRound(g, -1, [], 'full');
    }
  }
}

function newFx(kind, seat) {
  return { kind, seat, placed: [], moved: [], destroyed: [], collapsed: null };
}

function commit(g, fx) {
  g.fx = fx;
  g.seq += 1;
  return { ok: true };
}

const fail = (error) => ({ ok: false, error });

// Validate an action without mutating. Returns null when legal, else an error string.
export function validate(g, seat, a) {
  if (g.phase !== 'play') return 'Round is not live';
  if (seat !== g.current) return 'Not your turn';
  if (!a || typeof a.type !== 'string') return 'Bad action';
  const S = g.settings;
  const me = g.seats[seat];
  const { rows, cols } = S;
  const colOk = (c) => Number.isInteger(c) && c >= 0 && c < cols && canDrop(g.board, c);
  switch (a.type) {
    case 'drop':
      return colOk(a.col) ? null : 'Column is full';
    case 'wall':
      if (!S.abilities) return 'Abilities are off';
      if (g.used) return 'One ability per turn';
      if (me.energy < COSTS.wall) return 'Not enough energy';
      return colOk(a.col) ? null : 'Column is full';
    case 'bomb': {
      if (!S.abilities) return 'Abilities are off';
      if (g.used) return 'One ability per turn';
      if (me.energy < COSTS.bomb) return 'Not enough energy';
      const { r, c } = a;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= rows || c < 0 || c >= cols) return 'Bad target';
      const v = g.board[r][c];
      if (v === EMPTY) return 'Nothing to bomb there';
      if (v === me.team + 1) return 'You cannot bomb your own side';
      return null;
    }
    case 'surge':
      if (!S.abilities) return 'Abilities are off';
      if (g.used) return 'One ability per turn';
      if (me.energy < COSTS.surge) return 'Not enough energy';
      return legalCols(g.board).length ? null : 'Board is full';
    default:
      return 'Unknown action';
  }
}

export function applyAction(g, seat, a) {
  const err = validate(g, seat, a);
  if (err) return fail(err);
  const me = g.seats[seat];
  const v = me.team + 1;
  const fx = newFx(a.type, seat);
  switch (a.type) {
    case 'drop': {
      const r = place(g.board, a.col, v);
      fx.placed.push({ r, c: a.col, v });
      me.stats.drops += 1;
      if (g.surge > 0) {
        g.surge -= 1;
        fx.surgeStep = 2 - g.surge;
      }
      if (resolveAfterMove(g, seat, 'connect')) return commit(g, fx);
      if (g.surge > 0 && legalCols(g.board).length) return commit(g, fx);
      endTurn(g, fx);
      return commit(g, fx);
    }
    case 'wall': {
      const r = place(g.board, a.col, WALL);
      fx.placed.push({ r, c: a.col, v: WALL });
      me.energy -= COSTS.wall;
      me.stats.walls += 1;
      g.used = 'wall';
      // A wall is a free action: the same player still drops a disc this turn.
      if (!legalCols(g.board).length) endTurn(g, fx);
      return commit(g, fx);
    }
    case 'bomb': {
      const old = g.board[a.r][a.c];
      g.board[a.r][a.c] = EMPTY;
      fx.destroyed.push({ r: a.r, c: a.c, v: old });
      compactColumn(g.board, a.c, fx.moved);
      me.energy -= COSTS.bomb;
      me.stats.bombs += 1;
      if (resolveAfterMove(g, seat, 'bomb')) return commit(g, fx);
      endTurn(g, fx);
      return commit(g, fx);
    }
    case 'surge': {
      me.energy -= COSTS.surge;
      me.stats.surges += 1;
      g.used = 'surge';
      g.surge = 2;
      return commit(g, fx);
    }
    default:
      return fail('Unknown action');
  }
}

// Shot clock expired: drop for the current seat in random columns (both drops if surging).
export function applyTimeout(g, rand = Math.random) {
  if (g.phase !== 'play') return fail('Round is not live');
  const seat = g.current;
  const me = g.seats[seat];
  const v = me.team + 1;
  const fx = newFx('timeout', seat);
  me.stats.timeouts += 1;
  let drops = g.surge > 0 ? g.surge : 1;
  while (drops > 0) {
    const cols = legalCols(g.board);
    if (!cols.length) break;
    const c = cols[Math.floor(rand() * cols.length)];
    const r = place(g.board, c, v);
    fx.placed.push({ r, c, v });
    me.stats.drops += 1;
    drops -= 1;
    if (resolveAfterMove(g, seat, 'connect')) return commit(g, fx);
  }
  endTurn(g, fx);
  return commit(g, fx);
}
