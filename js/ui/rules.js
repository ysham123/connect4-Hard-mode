// How to play.

import { openModal } from './dom.js';
import { COSTS } from '../engine.js';

export function showRules() {
  openModal(`
    <div class="modal-head">
      <h2>How to play</h2>
      <button class="btn small ghost" data-close>Close</button>
    </div>
    <p>Drop discs into the columns. Line up <b>four or more</b> of your color across, up or diagonally to take the round. First to the target number of rounds wins the match.</p>

    <h4>Shot clock</h4>
    <p>Every turn is on the clock. If it hits zero, a disc drops for you in a <b>random column</b>. If you were mid surge, both drops go random.</p>

    <h4>Energy and abilities</h4>
    <p>You gain <b>1 energy</b> at the start of each of your turns, up to 6. Energy resets every round. One ability per turn.</p>
    <div class="rule-abilities">
      <div class="rule-ab" style="--abc:#9aa3cf"><b>WALL<small>${COSTS.wall} energy</small></b><span>Drop a neutral steel block, <b>then still drop a disc</b>. Walls block everyone. Use one to fill the gap under a cell you want, or to plug a threat.</span></div>
      <div class="rule-ab" style="--abc:#ff3b5c"><b>BOMB<small>${COSTS.bomb} energy</small></b><span>Destroy any enemy disc or wall. Everything above it falls one row. Ends your turn. If the fall completes an enemy line and not yours, they win. That is a backfire.</span></div>
      <div class="rule-ab" style="--abc:#ffc233"><b>SURGE<small>${COSTS.surge} energy</small></b><span>Drop <b>two discs</b> this turn. Both count. A surge can finish lines nobody thought were live.</span></div>
    </div>

    <h4>Floor collapse</h4>
    <p>Every few turns (shown under the board) the bottom row is destroyed and the whole board drops one row. Anything you built on the floor goes with it, and every column gets a free cell on top. A full board never stalls: it collapses instead.</p>

    <h4>Tie breaks</h4>
    <ul>
      <li>If your move makes a line for you and for someone else, <b>you</b> win.</li>
      <li>If your move only completes someone else's line, <b>they</b> win.</li>
      <li>A full board with collapse turned off is a drawn round.</li>
    </ul>

    <h4>Reading the board</h4>
    <ul>
      <li>An enemy with 2+ energy can wall then drop. Any enemy winning cell sitting one above a playable cell is live.</li>
      <li>At 6 energy they can surge. Any spot where two more discs finish four is live.</li>
      <li>Energy bars on the player cards are public. Watch them.</li>
    </ul>

    <h4>Modes</h4>
    <p>1v1 duel, 2v2 teams (teammates share a color and alternate turns), and 3 or 4 player free for all.</p>

    <h4>Controls</h4>
    <ul>
      <li>Click a column to drop. On phones, tap once to aim and again to confirm.</li>
      <li>Keys <kbd class="k">1</kbd> to <kbd class="k">9</kbd> and <kbd class="k">0</kbd> drop into a column. <kbd class="k">&larr;</kbd> <kbd class="k">&rarr;</kbd> aim, <kbd class="k">Enter</kbd> drops.</li>
      <li><kbd class="k">W</kbd> wall, <kbd class="k">B</kbd> bomb (aim with arrows), <kbd class="k">S</kbd> surge, <kbd class="k">Esc</kbd> cancel.</li>
    </ul>
    <div class="modal-actions"><button class="btn primary" data-close data-autofocus>Got it</button></div>
  `);
}
