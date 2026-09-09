// Coil — the app edge.
//
// This is the only file in the project that references `window` or
// `localStorage`. Everything below it takes what it needs as an argument: the
// core takes an rng, persist takes a storage object, the renderer takes a
// canvas and a palette, the readout takes a root element. That is what keeps
// the game testable without a browser, and it only holds if the reaching-out
// happens in exactly one place. This place.
//
// It owns the fixed-timestep loop, and it wires the store to the views.
//
// Phase 5 has no input — that is phase 6. The snake therefore holds its
// heading, runs, and dies against a wall. The loop, the renderer, the readout
// and the accessibility text are all real; only the steering is missing.

import { createGame, tick, tickIntervalFor } from './core/game.js';
import { createStore } from './store.js';
import { load } from './persist.js';
import { createRenderer, readPalette, drawOptionsFor } from './render/canvas.js';
import {
  readoutStrings, gameOverSummary, nonWritableHint, createAriaLabeller,
} from './render/labels.js';
import { createReadout } from './ui/readout.js';

const COLS = 24;
const ROWS = 18;

// The accumulated delta is clamped to this per frame. A backgrounded tab
// returns with a delta measured in seconds; without the clamp that is three
// hundred ticks in one frame, and the player comes back to a corpse.
const MAX_FRAME_MS = 250;

// TEMPORARY, AND SCOPED TO THIS PHASE.
//
// How long a finished board stays on screen before the next one starts on its
// own. It exists for exactly one reason: phase 5 has no input, so a run ends
// in about a second and a half and there is no control with which to start
// another. A page frozen on a corpse cannot be looked at, and this phase has
// to be looked at.
//
// PHASE 6 REMOVES IT. When input lands, a finished run becomes a real
// game-over state that persists until the player leaves it, with an explicit
// restart control — not a timer that takes the board away while they are
// still reading the summary. Deleting this constant and the restartAt clock
// below is part of that phase, not a later tidy-up. See docs/spec.md, phase 6.
const AUTO_RESTART_MS = 2600;

const canvas = document.getElementById('surface');
const boardBox = document.getElementById('board');
const panel = document.querySelector('.panel');

// Colours come from the cascade, so src/tokens.css remains the one place a
// hex is written and tools/contrast.mjs keeps describing what is drawn.
const palette = readPalette(document.documentElement);

const renderer = createRenderer({ canvas, cols: COLS, rows: ROWS, palette });
const readout = createReadout({ root: panel });
const labeller = createAriaLabeller();

const store = createStore({ storage: window.localStorage });

// The one place window.localStorage is named. load() reports whether this
// session may write at all: false means the stored record was written by a
// newer build of the game, and the store then writes NOTHING for the whole
// session — not the high score, not a setting.
//
// Said out loud, once, at start. Not offered as a choice: overwriting a newer
// install's data is not a thing to offer, and letting the player discover it
// by losing a setting on reload is not honest.
readout.setHint(nonWritableHint(load(window.localStorage).writable));

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let state = createGame({ width: COLS, height: ROWS, rng: () => Math.random() });
let paused = document.visibilityState === 'hidden';
let focused = false;
let accumulator = 0;
let lastFrame = null;
let restartAt = null;
let scoreSubmitted = false;

function motionOptions() {
  return drawOptionsFor({
    systemPrefersReducedMotion: motionQuery.matches,
    override: store.getState().reducedMotionOverride,
  });
}

function resize() {
  const box = boardBox.getBoundingClientRect();
  // The height the board may take: whatever is left of the viewport under the
  // masthead, floored so a short window still gets a board rather than a line.
  const available = Math.max(200, window.innerHeight - box.top - 24);
  renderer.resize({
    containerW: Math.max(1, box.width),
    containerH: Math.max(1, Math.min(available, (box.width * ROWS) / COLS + 32)),
    dpr: window.devicePixelRatio || 1,
  });
  render();
}

// Everything the DOM shows about a board, written together so the canvas and
// the text can never disagree about which board they are describing.
function syncViews() {
  readout.update(readoutStrings(state, { highScore: store.getState().highScore }));

  const update = labeller.update(state, { paused });
  // The label is written to the canvas exactly when the labeller says it
  // changed: at the start, at a pause, at a death and at the win. Never per
  // tick, and never into a live region.
  if (update.changed) canvas.setAttribute('aria-label', update.label);
}

function render(now = 0) {
  renderer.draw(state, { ...motionOptions(), focused, now });
}

function advance(now) {
  const previousStatus = state.status;
  state = tick(state);

  if (state.status !== previousStatus && state.status !== 'playing') {
    // A run has ended. The summary carries the ramp step BY NAME, because the
    // colour it was showing is not information a screen reader ever had.
    readout.setSummary(gameOverSummary(state));
    if (!scoreSubmitted) {
      store.submitScore(state.score);
      scoreSubmitted = true;
    }
    restartAt = now + AUTO_RESTART_MS;
  }
}

function restart() {
  state = createGame({ width: COLS, height: ROWS, rng: () => Math.random() });
  readout.setSummary('');
  restartAt = null;
  scoreSubmitted = false;
  accumulator = 0;
}

// The loop. An accumulator with tickIntervalFor(state) as the step — never one
// tick per animation frame, which runs at double speed on a 120 Hz phone and
// at whatever speed the monitor happens to be on every other machine.
function frame(now) {
  window.requestAnimationFrame(frame);

  if (lastFrame === null) lastFrame = now;
  const delta = Math.min(MAX_FRAME_MS, now - lastFrame);
  lastFrame = now;

  if (paused) {
    render(now);
    return;
  }

  if (restartAt !== null) {
    if (now >= restartAt) restart();
    render(now);
    return;
  }

  accumulator += delta;
  // The step is re-read each pass, because the interval shortens as the snake
  // eats and the loop has to follow it within the same frame.
  let step = tickIntervalFor(state);
  while (accumulator >= step && state.status === 'playing') {
    accumulator -= step;
    advance(now);
    step = tickIntervalFor(state);
  }

  syncViews();
  render(now);
}

function setPaused(next) {
  if (paused === next) return;
  paused = next;
  // The accumulator is dropped rather than carried across the pause: time that
  // passed while the tab was hidden is not time the player was playing.
  accumulator = 0;
  lastFrame = null;
  syncViews();
}

document.addEventListener('visibilitychange', () => {
  setPaused(document.visibilityState === 'hidden');
});

canvas.addEventListener('focus', () => { focused = true; });
canvas.addEventListener('blur', () => { focused = false; });

window.addEventListener('resize', resize);
motionQuery.addEventListener('change', () => render());

// A window dragged from a 1x display to a 2x one changes devicePixelRatio
// without changing its size, so no resize event arrives and the cell size
// would stay computed against the old ratio. The query has to be rebuilt after
// each change, because it is pinned to the ratio it was created for.
function watchPixelRatio() {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener('change', () => {
    resize();
    watchPixelRatio();
  }, { once: true });
}
watchPixelRatio();

store.subscribe(() => {
  readout.update(readoutStrings(state, { highScore: store.getState().highScore }));
});

resize();
syncViews();
window.requestAnimationFrame(frame);
