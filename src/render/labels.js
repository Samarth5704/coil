// Coil — the words.
//
// Pure. No DOM: every function here returns a string, and something else puts
// it on the page.
//
// This file exists because of a measured fact, not a preference. The five ramp
// steps sit at 1.12:1 to 1.43:1 against each ADJACENT step, and --food sits at
// 1.24:1 to 2.33:1 against them. A player who cannot separate 1.12:1 has no
// ramp at all — so the reachable count, the multiplier and the ramp step come
// out as text, always, and the ramp step arrives by NAME. Colour is the
// decoration on top of the sentence, never the sentence.

import { rampStepFor, multiplierFor, reachableFrom } from '../core/game.js';

// Indexed 0..4, matching rampStepFor. The order is the order in tokens.css and
// the names are the token names; changing one without the other is what the
// token round-trip below is for.
export const RAMP_NAMES = Object.freeze(['calm', 'close', 'tight', 'hot', 'sealed']);

/**
 * The ramp step this board is standing on, with its name and its CSS custom
 * property.
 *
 * It calls rampStepFor and does nothing else with the number. The renderer
 * MAPS a step to a name and a token; it does not derive a step of its own from
 * the multiplier or from the reachable count against thresholds it keeps
 * privately. Two definitions of the ramp drift, and they drift silently,
 * because both look right on the boards anyone thinks to check.
 */
export function rampFor(state) {
  const step = rampStepFor(state);
  const name = RAMP_NAMES[step];
  if (name === undefined) {
    throw new RangeError(`ramp step ${step} has no name; there are ${RAMP_NAMES.length}`);
  }
  return Object.freeze({ step, name, token: `--ramp-${step}-${name}` });
}

/**
 * The readout, as strings. Every one of these is a derived value computed on
 * demand — none of it is stored anywhere, and none of it is read off the
 * canvas.
 */
export function readoutStrings(state, { highScore = 0 } = {}) {
  const ramp = rampFor(state);
  return Object.freeze({
    score: String(state.score),
    highScore: String(highScore),
    reachable: String(reachableFrom(state)),
    multiplier: `${multiplierFor(state)}×`,
    ramp: ramp.name,
    length: String(state.snake.length),
  });
}

/**
 * Written to a visually hidden node when a run ends.
 *
 * The ramp step is given by name. A summary that says "ramp step 4" hands a
 * colour-blind player the index and withholds the only part of it that was
 * ever legible — which is the same failure as drawing the ramp and calling the
 * job done.
 *
 * A new high score is a sentence for the same reason. Whatever the board does
 * to celebrate one — a colour, a flash, a sound that phase 7 will add — is
 * something at least one player is not receiving, so the fact itself is text.
 */
export function gameOverSummary(state, { newHighScore = false } = {}) {
  const ramp = rampFor(state);
  const outcome = state.status === 'won'
    ? 'Board filled. You win.'
    : 'Game over.';

  return `${outcome} Final score ${state.score}, `
    + `length ${state.snake.length}, `
    + `${reachableFrom(state)} cells reachable at the end, `
    + `confinement ${ramp.name}.`
    + (newHighScore ? ' A new best score.' : '');
}

/**
 * How to leave the idle board, in one line.
 *
 * Written here rather than only in index.html because it is said twice — as
 * text on the page and inside the canvas aria-label for the idle phase — and
 * two copies of a sentence drift. index.html carries the identical string and
 * tests/markup.test.js pins them together.
 *
 * It names all three ways in, because the page has all three and which one is
 * available is not something the page can know: a keyboard, a swipe, and the
 * on-screen buttons that appear on a coarse pointer.
 */
export const IDLE_INSTRUCTION = 'Press an arrow key or W, A, S or D to start '
  + '— or swipe the board, or use the arrow buttons.';

/** The one honest line about a save that this session must not write over. */
export function nonWritableHint(writable) {
  if (writable) return null;
  // No offer to overwrite, and no pretence that it is handled. The stored
  // record belongs to a newer install of the game and this session leaves it
  // alone for the whole session, not just at load.
  return 'Preferences will not be saved this session: the saved data is from a '
    + 'newer version of the game.';
}

// The phases a label is written for. Anything that is not one of these is not
// a transition and does not earn a new sentence.
function phaseOf(state, { paused = false, idle = false } = {}) {
  if (state.status === 'dead') return 'dead';
  if (state.status === 'won') return 'won';
  // Idle outranks paused: a board that has not started is not a board whose
  // run was interrupted, whatever the tab is doing.
  if (idle) return 'idle';
  return paused ? 'paused' : 'playing';
}

/**
 * The canvas sentence, for a given phase.
 *
 * Deliberately free of anything that changes tick to tick — no score, no
 * reachable count, no length. Those live in the readout, which is DOM text a
 * screen reader can visit when the reader wants them. A number in this
 * sentence would be a number that changes every 140 ms, and the labeller below
 * would then be handing out a new string on every frame.
 */
export function ariaLabelFor(state, context = {}) {
  const phase = phaseOf(state, context);
  const board = `${state.width} by ${state.height} grid`;

  switch (phase) {
    case 'dead':
      return `Coil board, ${board}. Game over; the snake hit a wall or itself.`;
    case 'won':
      return `Coil board, ${board}. Board filled; you win.`;
    case 'idle':
      return `Coil board, ${board}. Ready to play. ${IDLE_INSTRUCTION} `
        + 'Score, space and multiplier are in the readout beside the board.';
    case 'paused':
      return `Coil board, ${board}. Paused. Score and space are in the readout beside the board.`;
    default:
      return `Coil board, ${board}. A snake moving between walls. `
        + 'Score, space and multiplier are in the readout beside the board.';
  }
}

/**
 * Holds the current label and recomputes it ONLY on a phase transition.
 *
 * The aria-label is not a live region and must not behave like one. A sentence
 * rewritten every tick is announced by some screen readers on every tick, at
 * seven times a second, which is not information — it is a denial of service
 * on the thing the player is listening to. The label is written at start, at
 * pause, at death and at the win, and at no other moment.
 */
export function createAriaLabeller() {
  let phase = null;
  let label = null;
  // How many sentences this labeller has produced. A caller writes the label
  // to the canvas exactly when this goes up, so the count is the number of DOM
  // writes the accessibility tree saw, and a test can pin it directly.
  let writes = 0;

  return {
    get current() {
      return label;
    },
    get phase() {
      return phase;
    },
    get writes() {
      return writes;
    },
    update(state, context = {}) {
      const next = phaseOf(state, context);
      if (next === phase) return { label, changed: false };
      phase = next;
      label = ariaLabelFor(state, context);
      writes++;
      return { label, changed: true };
    },
  };
}
