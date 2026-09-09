// Coil — the run.
//
// One board, its clock, and its ending. No DOM and no globals: the session
// takes an rng and a store, and reports what happened through `view`
// callbacks that main.js turns into nodes on the page. That is what makes the
// game-over lifecycle and step mode testable as logic rather than as a
// browser.
//
// Phase 5 ended a run and started a new board on its own, on a constant it
// declared for one reason: phase 5 had no input, so a run ended in
// about a second and a half with no control to start another. Phase 6 has
// input, and that timer is gone rather than lengthened. A finished run is
// finished until the player restarts it, because the game-over summary is
// where the ramp step is named for a player who could not read the colour,
// and a board that takes itself away takes the summary with it.

import { createGame, tick, tickIntervalFor, enqueueTurn } from './core/game.js';
import { interpretKey } from './input/keyboard.js';

// The accumulated delta is clamped to this per frame. A backgrounded tab
// returns with a delta measured in seconds; without the clamp that is three
// hundred ticks in one frame, and the player comes back to a corpse.
export const MAX_FRAME_MS = 250;

/**
 * @param {object} options
 * @param {number} options.width  board width in cells
 * @param {number} options.height board height in cells
 * @param {function} options.rng  injected, returning a float in [0, 1)
 * @param {object} options.store  the one store; read for stepMode and the
 *   high score, written to on death through submitScore
 * @param {object} [options.view] `{ ended, restarted, updated }`, all optional
 * @param {object} [options.setup] `{ snake, food }` handed to createGame, for
 *   tests that need a board a real game would take hundreds of ticks to reach.
 *   Omitted by the app.
 */
export function createSession({
  width, height, rng, store, view = {}, setup = undefined,
}) {
  const newBoard = () => createGame({
    width, height, rng, snake: setup?.snake, food: setup?.food,
  });

  let state = newBoard();
  let accumulator = 0;
  let ticks = 0;
  // One submit per run. The loop keeps running frames after a death — that is
  // how the board stays on screen — and a submit per frame would be a storage
  // write per frame.
  let ended = false;
  // Whether the player has acted on this board yet. A board that has not been
  // acted on does not move: see the lifecycle note below.
  let acted = false;

  // A board accepts steering while it is playing, which is both idle and
  // running. `over` is the one state that does not, and it is the state that
  // hands the arrow keys back to the browser.
  const playable = () => state.status === 'playing';
  const stepMode = () => Boolean(store.getState().stepMode);

  /**
   * idle → running → over → (restart) → idle.
   *
   * **idle** is a board that is drawn and has not moved. It exists because the
   * alternative is a page that plays itself: a fresh board holds its heading,
   * reaches the right-hand wall in eleven ticks, and is therefore over about a
   * second and a half after the page loads — so a visitor arrives at a game
   * they never played, already finished. Worse, the end of a run moves focus,
   * and moving focus on a timer with no user action anywhere behind it is the
   * page grabbing the player rather than answering them.
   *
   * **running** is entered by the first directional input, from any source,
   * and that input is applied as the first turn rather than swallowed. A press
   * that only wakes the board and does not steer it reads as a dropped input,
   * and the player blames the game.
   *
   * **over** is a finished run, which stays finished; only restart leaves it,
   * and restart returns to idle rather than to running.
   */
  const lifecycle = () => {
    if (!playable()) return 'over';
    return acted ? 'running' : 'idle';
  };

  // The player has acted. Idempotent, and the only door out of idle.
  function begin() {
    if (acted || !playable()) return false;
    acted = true;
    view.started?.(state);
    return true;
  }

  function endRun() {
    ended = true;
    // Read BEFORE the submit. submitScore takes the score into the record, so
    // asking afterwards makes every run a new best against itself.
    const newHighScore = state.score > store.getState().highScore;
    store.submitScore(state.score);
    view.ended?.(state, { newHighScore });
  }

  // One tick, wherever it came from: the accumulator or a keypress.
  function advance() {
    if (!playable()) return false;
    const before = state.status;
    state = tick(state);
    ticks++;
    if (state.status !== before && state.status !== 'playing' && !ended) endRun();
    return true;
  }

  /**
   * Spends `deltaMs` of wall clock on the board and returns the number of
   * ticks it bought. Zero while step mode is on: step mode is the absence of
   * a clock, so the clock does not merely go unread, it does not run.
   */
  function elapse(deltaMs) {
    // An idle board buys nothing. The loop still runs and still draws — the
    // starting position, the walls and the lattice are all on screen — it
    // simply does not spend time on a game the player has not started.
    if (!acted || stepMode() || !playable()) {
      accumulator = 0;
      return 0;
    }

    accumulator += Math.min(MAX_FRAME_MS, Math.max(0, deltaMs));

    let spent = 0;
    // The step is re-read each pass, because the interval shortens as the
    // snake eats and the loop has to follow it within the same frame.
    let step = tickIntervalFor(state);
    while (accumulator >= step && playable()) {
      accumulator -= step;
      advance();
      spent++;
      step = tickIntervalFor(state);
    }
    if (spent > 0) view.updated?.(state);
    return spent;
  }

  function turn(direction) {
    state = enqueueTurn(state, direction);
  }

  /**
   * A steering input from a pointer — the d-pad or a swipe.
   *
   * In step mode it also moves, because a tap that queues a turn and leaves
   * the board still would give a touch player a game with no way to advance
   * it. The keyboard reaches the same place through applyKey, which has one
   * extra thing to say first: a held key repeats, and a repeat must not tick.
   * A tap does not repeat.
   */
  function steer(direction) {
    // The first one of these leaves idle, and is then applied as the turn it
    // was, not consumed by the transition.
    begin();
    turn(direction);
    if (stepMode()) {
      advance();
      view.updated?.(state);
    }
  }

  /**
   * A keydown, interpreted and applied. Returns what interpretKey decided, so
   * main.js can call preventDefault at the call site that owns the event.
   */
  function applyKey(event, { surfaceFocused = false } = {}) {
    const action = interpretKey(event, {
      running: playable(), surfaceFocused, stepMode: stepMode(),
    });
    if (action.direction !== null) {
      begin();
      turn(action.direction);
    }
    // `advance` is step mode's one-tick-per-press. It is gated on the board
    // having been started, so the advance keys — space and enter, which steer
    // nothing — cannot tick an idle board. Leaving idle is a directional
    // input's job, in every mode and from every source.
    if (action.advance && acted) {
      advance();
      view.updated?.(state);
    }
    return action;
  }

  // Back to idle, not to running. The player pressed a button, which is a
  // request for a board to play, not a request to be dropped into a run that
  // is already moving before they have their hand back on the keys.
  function restart() {
    state = newBoard();
    accumulator = 0;
    ticks = 0;
    ended = false;
    acted = false;
    view.restarted?.(state);
  }

  return {
    get state() {
      return state;
    },
    // Ticks in the current run, reset by restart. Step mode's contract is one
    // per keypress, and this is the number that says so.
    get ticks() {
      return ticks;
    },
    // 'idle' | 'running' | 'over'.
    get lifecycle() {
      return lifecycle();
    },
    get running() {
      return lifecycle() === 'running';
    },
    elapse,
    advance,
    applyKey,
    turn,
    steer,
    restart,
  };
}
