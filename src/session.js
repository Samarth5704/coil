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

  const running = () => state.status === 'playing';
  const stepMode = () => Boolean(store.getState().stepMode);

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
    if (!running()) return false;
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
    if (stepMode() || !running()) {
      accumulator = 0;
      return 0;
    }

    accumulator += Math.min(MAX_FRAME_MS, Math.max(0, deltaMs));

    let spent = 0;
    // The step is re-read each pass, because the interval shortens as the
    // snake eats and the loop has to follow it within the same frame.
    let step = tickIntervalFor(state);
    while (accumulator >= step && running()) {
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
      running: running(), surfaceFocused, stepMode: stepMode(),
    });
    if (action.direction !== null) turn(action.direction);
    if (action.advance) {
      advance();
      view.updated?.(state);
    }
    return action;
  }

  function restart() {
    state = newBoard();
    accumulator = 0;
    ticks = 0;
    ended = false;
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
    get running() {
      return running();
    },
    elapse,
    advance,
    applyKey,
    turn,
    steer,
    restart,
  };
}
