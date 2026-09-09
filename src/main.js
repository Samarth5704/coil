// Coil — the app edge.
//
// This is the only file in the project that references `window` or
// `localStorage`. Everything below it takes what it needs as an argument: the
// core takes an rng, persist takes a storage object, the renderer takes a
// canvas and a palette, the readout takes a root element, the session takes a
// store. That is what keeps the game testable without a browser, and it only
// holds if the reaching-out happens in exactly one place. This place.
//
// It owns the frame loop, the event listeners, and the wiring between the
// session and the views.
//
// Phase 6 gives the board its input: arrows and WASD, a swipe on the play
// surface, an on-screen d-pad, and step mode for a player who would rather not
// race a clock. Phase 5's auto-restart constant and its clock are gone from
// this file — not lengthened, not disabled, deleted. A finished run stays
// finished until the restart button is pressed, because the game-over summary
// is where the ramp step is named and a board that takes itself away takes the
// summary with it.

import { createStore } from './store.js';
import { load } from './persist.js';
import { createSession } from './session.js';
import { createRenderer, readPalette, drawOptionsFor } from './render/canvas.js';
import {
  readoutStrings, gameOverSummary, nonWritableHint, createAriaLabeller,
} from './render/labels.js';
import { createReadout } from './ui/readout.js';
import { createGameOver } from './ui/gameover.js';
import { createDpad } from './ui/dpad.js';
import { createSettings } from './ui/settings.js';
import { resolveSwipe } from './input/swipe.js';

const COLS = 24;
const ROWS = 18;

const canvas = document.getElementById('surface');
const boardBox = document.getElementById('board');
const panel = document.querySelector('.panel');
const dpadBox = document.getElementById('dpad');

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
// Said out loud, once, at start, next to the settings it applies to. Not
// offered as a choice: overwriting a newer install's data is not a thing to
// offer, and letting the player discover it by losing a setting on reload is
// not honest.
readout.setHint(nonWritableHint(load(window.localStorage).writable));

createSettings({ root: panel, store });

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let paused = document.visibilityState === 'hidden';
let focused = false;
let lastFrame = null;

// The game-over region owns the button and where focus goes; the readout owns
// the summary node, as it owns every node it writes, and is handed the string
// through writeSummary. One node, one owner.
const gameOver = createGameOver({
  root: panel,
  writeSummary: readout.setSummary,
  onRestart: () => {
    session.restart();
    // Focus goes back to the thing that is about to move. Left on a button
    // that has just hidden itself, it would fall to <body>.
    canvas.focus();
  },
});

const session = createSession({
  width: COLS,
  height: ROWS,
  rng: () => Math.random(),
  store,
  view: {
    updated: syncViews,
    ended: (state, { newHighScore }) => {
      syncViews();
      // The summary carries the ramp step BY NAME, and says so in words when
      // the run was a new best. Neither is information a screen reader ever
      // had from the colour on the board.
      gameOver.show(gameOverSummary(state, { newHighScore }));
    },
    restarted: () => {
      gameOver.hide();
      syncViews();
    },
  },
});

// A pointer steering input — a d-pad press or a swipe. It draws immediately
// rather than waiting for the next frame, because in step mode there may not
// be a next frame worth waiting for: the loop still runs, but the board only
// changes when the player asks it to, and a tap that does not draw reads as a
// tap that did nothing.
//
// Neither path focuses the canvas: a thumb on the d-pad wants the next press
// to land on the d-pad.
function steer(direction) {
  session.steer(direction);
  render();
}

createDpad({ document, root: dpadBox, onDirection: steer });

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
  const state = session.state;
  readout.update(readoutStrings(state, { highScore: store.getState().highScore }));

  const update = labeller.update(state, { paused });
  // The label is written to the canvas exactly when the labeller says it
  // changed: at the start, at a pause, at a death and at the win. Never per
  // tick, and never into a live region.
  if (update.changed) canvas.setAttribute('aria-label', update.label);
}

function render(now = 0) {
  renderer.draw(session.state, { ...motionOptions(), focused, now });
}

// The frame loop. The session owns the accumulator and the fixed timestep; all
// this does is hand it the wall clock that passed and draw the result. There
// is no restart clock in here any more, and no branch that replaces a
// finished board.
function frame(now) {
  window.requestAnimationFrame(frame);

  if (lastFrame === null) lastFrame = now;
  const delta = now - lastFrame;
  lastFrame = now;

  if (!paused) session.elapse(delta);

  render(now);
}

function setPaused(next) {
  if (paused === next) return;
  paused = next;
  // Time that passed while the tab was hidden is not time the player was
  // playing, so the clock restarts from this frame rather than catching up.
  lastFrame = null;
  syncViews();
}

document.addEventListener('visibilitychange', () => {
  setPaused(document.visibilityState === 'hidden');
});

// One keydown listener, on the document, and the ONLY preventDefault in the
// project. The session answers three questions before it says yes — is the
// game running, does the play surface have focus, and is this a game key at
// all — so Tab is never taken, a key pressed inside the settings panel is
// never taken, and a key pressed after the run has ended is never taken.
document.addEventListener('keydown', (event) => {
  const action = session.applyKey(event, { surfaceFocused: focused });
  if (action.preventDefault) event.preventDefault();
});

canvas.addEventListener('focus', () => { focused = true; });
canvas.addEventListener('blur', () => { focused = false; });

// The swipe. Pointer events rather than touch events, so a stylus and a mouse
// drag work by the same path; `touch-action: none` is on the canvas alone, so
// the rest of the page still scrolls and pull-to-refresh still works
// everywhere else.
let gestureStart = null;

canvas.addEventListener('pointerdown', (event) => {
  gestureStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
});

canvas.addEventListener('pointerup', (event) => {
  if (gestureStart === null || gestureStart.id !== event.pointerId) return;
  const direction = resolveSwipe({
    dx: event.clientX - gestureStart.x,
    dy: event.clientY - gestureStart.y,
  });
  gestureStart = null;
  if (direction !== null) steer(direction);
});

canvas.addEventListener('pointercancel', () => { gestureStart = null; });

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

store.subscribe(syncViews);

resize();
syncViews();
window.requestAnimationFrame(frame);
