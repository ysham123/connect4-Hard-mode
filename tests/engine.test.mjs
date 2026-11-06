// Engine rules tests. Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

function game(patch = {}) {
  const g = E.newGame(E.applySettingsPatch(E.defaultSettings(), patch));
  E.beginPlay(g);
  return g;
}

// Fill the board from a picture. Top line is the top row. '.' empty, 'R' team 0, 'Y' team 1, 'C' team 2, 'L' team 3, '#' wall.
function setBoard(g, picture) {
  const map = { '.': 0, R: 1, Y: 2, C: 3, L: 4, '#': E.WALL };
  const lines = picture.trim().split('\n').map((l) => l.trim());
  const rows = g.settings.rows;
  g.board = Array.from({ length: rows }, () => new Array(g.settings.cols).fill(0));
  lines.forEach((line, i) => {
    const r = lines.length - 1 - i;
    [...line].forEach((ch, c) => { g.board[r][c] = map[ch]; });
  });
}

const act = (g, a) => E.applyAction(g, g.current, a);

test('players alternate and gain energy at the start of their turn', () => {
  const g = game();
  assert.equal(g.current, 0);
  assert.equal(g.seats[0].energy, 1);
  assert.equal(g.seats[1].energy, 0);
  assert.ok(act(g, { type: 'drop', col: 4 }).ok);
  assert.equal(g.current, 1);
  assert.equal(g.seats[1].energy, 1);
  assert.equal(g.board[0][4], 1);
});

test('rejects moves out of turn and into full columns', () => {
  const g = game({ preset: 'classic' });
  assert.equal(E.applyAction(g, 1, { type: 'drop', col: 0 }).ok, false);
  for (let i = 0; i < 6; i++) act(g, { type: 'drop', col: 0 });
  const res = act(g, { type: 'drop', col: 0 });
  assert.equal(res.ok, false);
});

test('four in a row wins the round and scores', () => {
  const g = game({ preset: 'classic' });
  for (const c of [0, 0, 1, 1, 2, 2]) act(g, { type: 'drop', col: c });
  act(g, { type: 'drop', col: 3 });
  assert.equal(g.result.team, 0);
  assert.equal(g.teamScores[0], 1);
  assert.equal(g.phase, 'matchEnd'); // classic is first to 1
});

test('diagonal lines are detected', () => {
  const g = game();
  setBoard(g, `
    .........
    .........
    .........
    ...R.....
    ..RY.....
    .RYY.....
    RYYY.....`);
  const lines = E.findLines(g.board);
  assert.ok(lines.has(1));
  assert.equal(lines.get(1).lines, 1);
});

test('wall is a free action: the same player drops after it', () => {
  const g = game();
  g.seats[0].energy = 6;
  assert.ok(act(g, { type: 'wall', col: 2 }).ok);
  assert.equal(g.current, 0);
  assert.equal(g.board[0][2], E.WALL);
  assert.equal(g.seats[0].energy, 6 - E.COSTS.wall);
  assert.equal(act(g, { type: 'bomb', r: 0, c: 2 }).ok, false, 'only one ability per turn');
  assert.ok(act(g, { type: 'drop', col: 2 }).ok);
  assert.equal(g.board[1][2], 1);
  assert.equal(g.current, 1);
});

test('abilities need enough energy', () => {
  const g = game();
  assert.equal(act(g, { type: 'bomb', r: 0, c: 0 }).ok, false);
  assert.equal(act(g, { type: 'surge' }).ok, false);
});

test('bomb removes an enemy disc and the column falls', () => {
  const g = game();
  setBoard(g, `
    .........
    .........
    .........
    .........
    .R.......
    .Y.......
    .R.......`);
  g.seats[0].energy = 4;
  assert.equal(act(g, { type: 'bomb', r: 0, c: 1 }).ok, false, 'cannot bomb your own side');
  assert.ok(act(g, { type: 'bomb', r: 1, c: 1 }).ok);
  assert.equal(g.board[0][1], 1);
  assert.equal(g.board[1][1], 1);
  assert.equal(g.board[2][1], 0);
  assert.deepEqual(g.fx.moved, [{ c: 1, from: 2, to: 1 }]);
  assert.equal(g.current, 1);
});

test('a bomb that only completes the enemy line is a backfire', () => {
  const g = game();
  setBoard(g, `
    .........
    .........
    .........
    ...R.....
    RRRY.....
    YRYR.....
    RYRY.....`);
  g.current = 1;
  g.seats[1].energy = 4;
  // Yellow bombs the red disc at (1,3). Column 3 falls and red completes row 2.
  assert.ok(E.applyAction(g, 1, { type: 'bomb', r: 1, c: 3 }).ok);
  assert.equal(g.result.team, 0);
  assert.equal(g.result.reason, 'backfire');
});

test('when a move makes lines for both sides, the mover wins', () => {
  const g = game();
  setBoard(g, `
    .........
    .........
    .........
    .........
    .Y.......
    RRRY.....
    YYYR.....`);
  g.current = 1;
  g.seats[1].energy = 4;
  // Yellow bombs red at (0,3): column 3 drops Y into row 0 (YYYY) and nothing for red.
  assert.ok(E.applyAction(g, 1, { type: 'bomb', r: 0, c: 3 }).ok);
  assert.equal(g.result.team, 1);
});

test('surge gives two drops in one turn', () => {
  const g = game();
  g.seats[0].energy = 6;
  assert.ok(act(g, { type: 'surge' }).ok);
  assert.equal(g.surge, 2);
  act(g, { type: 'drop', col: 0 });
  assert.equal(g.current, 0);
  act(g, { type: 'drop', col: 8 });
  assert.equal(g.current, 1);
  assert.equal(g.seats[0].energy, 0);
});

test('floor collapse removes the bottom row on schedule', () => {
  const g = game({ collapse: 8 });
  for (const c of [0, 0, 8, 8, 0, 0, 8]) act(g, { type: 'drop', col: c });
  assert.equal(E.turnsUntilCollapse(g), 1);
  const before = g.board[1][0];
  act(g, { type: 'drop', col: 4 });
  assert.ok(g.fx.collapsed, 'collapse recorded');
  assert.equal(g.board[0][0], before, 'row 1 moved down to row 0');
  assert.equal(g.board[0][4], 0, 'the disc on the bottom row was destroyed');
});

const NEAR_FULL = `
  YYRRYY.
  RRYYRRY
  YYRRYYR
  RRYYRRY
  YYRRYYR
  RRYYRRY`;

test('a full board with collapse off is a drawn round', () => {
  const g = game({ preset: 'classic', matchTo: 2 });
  setBoard(g, NEAR_FULL);
  g.current = 0;
  assert.ok(act(g, { type: 'drop', col: 6 }).ok);
  assert.equal(g.result.team, -1);
  assert.equal(g.result.reason, 'full');
  assert.deepEqual(g.teamScores, [0, 0]);
});

test('a full board with collapse on forces a collapse and play continues', () => {
  const g = game({ preset: 'classic', collapse: 8 });
  setBoard(g, NEAR_FULL);
  g.current = 0;
  assert.ok(act(g, { type: 'drop', col: 6 }).ok);
  assert.equal(g.phase, 'play');
  assert.ok(g.fx.forced);
  assert.equal(E.legalCols(g.board).length, 7);
});

test('timeout drops a random disc and passes the turn', () => {
  const g = game();
  const res = E.applyTimeout(g, () => 0);
  assert.ok(res.ok);
  assert.equal(g.board[0][0], 1);
  assert.equal(g.seats[0].stats.timeouts, 1);
  assert.equal(g.current, 1);
});

test('teams mode: teammates share a color and connect together', () => {
  const g = game({ mode: 'teams' });
  assert.deepEqual(g.seats.map((s) => s.team), [0, 1, 0, 1]);
  // Seats 0 and 2 build a row together on the bottom.
  const moves = [0, 0, 1, 1, 2, 2, 3];
  for (const c of moves) act(g, { type: 'drop', col: c });
  assert.equal(g.result.team, 0);
});

test('rounds rotate who moves first and the match ends at the target', () => {
  const g = game({ preset: 'classic', matchTo: 2 });
  for (const c of [0, 0, 1, 1, 2, 2, 3]) act(g, { type: 'drop', col: c });
  assert.equal(g.phase, 'roundEnd');
  E.nextRound(g);
  E.beginPlay(g);
  assert.equal(g.current, 1, 'second round starts with the other seat');
  for (const c of [0, 0, 1, 1, 2, 2, 3]) act(g, { type: 'drop', col: c });
  assert.equal(g.result.team, 1);
  assert.equal(g.phase, 'roundEnd');
});

test('settings patches are clamped to allowed values', () => {
  const s = E.applySettingsPatch(E.defaultSettings(), { clock: 999, board: [50, 50], collapse: 3, matchTo: 9, mode: 'nope' });
  assert.equal(s.clock, 15);
  assert.equal(s.cols, 9);
  assert.equal(s.collapse, 12);
  assert.equal(s.matchTo, 3);
  assert.equal(s.mode, 'duel');
  assert.equal(E.applySettingsPatch(s, { preset: 'blitz' }).preset, 'blitz');
});
