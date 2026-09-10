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
//
// Phase 7 gives it sound, and adds two globals to the list this file is the
// only holder of: `AudioContext` and `navigator.audioSession`. Both are handed
// to src/audio/synth.js as arguments, which is what lets a test spy on the
// constructor and assert that nothing built one before the player acted.

import { createStore } from './store.js';
import { load } from './persist.js';
import { createSession } from './session.js';
import { createLoop } from './loop.js';
import { createRenderer, readPalette, drawOptionsFor } from './render/canvas.js';
import {
  readoutStrings, gameOverSummary, nonWritableHint, ringerHint,
  idleInstructionFor, createAriaLabeller,
} from './render/labels.js';
import { createReadout } from './ui/readout.js';
import { createGameOver } from './ui/gameover.js';
import { createIdleNote } from './ui/idle.js';
import { createDpad, DPAD_MEDIA_QUERY } from './ui/dpad.js';
import { createSettings } from './ui/settings.js';
import { resolveSwipe } from './input/swipe.js';
import { createAudio } from './audio/synth.js';
import { createCues } from './audio/cues.js';

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

// The same query index.html's stylesheet uses to show the d-pad, matched here
// so the idle instruction can name the arrow buttons only where they exist.
// One string, exported from src/ui/dpad.js and pinned to the CSS by
// tests/markup.test.js: a sentence telling the player to press a button that
// is display:none sends them looking for something that is not there.
const dpadQuery = window.matchMedia(DPAD_MEDIA_QUERY);

let focused = false;

// THE AUDIO IS BUILT HERE AND STARTED NOWHERE. `createAudio` constructs no
// AudioContext — it holds the constructor and waits for `unlock()`, which is
// called from inside a real gesture handler and from nowhere else. This is the
// only place `AudioContext` and `navigator.audioSession` are named.
//
// The board starting idle is what guarantees a gesture exists to build it on:
// the player has to steer to begin, so there is always a real press behind the
// first sound. A context created outside a gesture is handed back suspended
// and stays that way for the life of the page.
//
// `platform` is the feature probe the ringer hint is gated on, read here
// because this is the only file allowed to touch `navigator` and `window`.
// Three values, no user-agent string: whether the device reports touch points,
// whether the non-standard `GestureEvent` interface exists, and whether the
// mobile-WebKit-only `-webkit-touch-callout` property is supported.
// `plausiblyIosAudio` in src/audio/synth.js says what that can and cannot
// distinguish, and defaults to no.
const audio = createAudio({
  Context: window.AudioContext || window.webkitAudioContext || null,
  audioSession: window.navigator.audioSession ?? null,
  platform: {
    maxTouchPoints: window.navigator.maxTouchPoints || 0,
    hasGestureEvent: typeof window.GestureEvent !== 'undefined',
    supportsTouchCallout: typeof window.CSS?.supports === 'function'
      && window.CSS.supports('-webkit-touch-callout', 'none'),
  },
});

// The second honest line, and it is the same treatment as the unwritable save:
// where the ringer switch can silence the game and nothing here can stop it,
// say so rather than claiming otherwise. Gated on the platform AND on sound
// being on, so it is not shown to a desktop that has no such switch, and re-
// read on every store change because the second of those can be toggled.
function syncRingerHint() {
  readout.setRingerHint(ringerHint(audio.needsRingerHint));
}

const cues = createCues({ audio });

// Every gesture that can be the first one. `unlock()` is idempotent and cheap
// after the first call — it resumes a suspended context and otherwise returns
// the one it has — so it is safe to hang off all of them, and it MUST be all
// of them: whichever the player reaches for first has to be the one that
// starts the audio, or the first sound of the session is missing.
function firstGesture() {
  if (store.getState().soundOn) audio.unlock();
}

// The line that says how to start, shown while the board is idle. The board no
// longer runs on load: it draws its starting position and waits, because a
// board that starts live is over eleven ticks later, and the end of a run
// moves focus — which, with no user action behind it, is the page grabbing the
// player rather than answering them.
//
// The sentence is asked for on every show rather than read out of the markup,
// because whether the d-pad is on screen is a media query and a media query
// can change without the page reloading.
const idleNote = createIdleNote({
  root: panel,
  instruction: () => idleInstructionFor({ dpadVisible: dpadQuery.matches }),
});

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
    // The player has acted, so the instruction has done its job.
    started: () => {
      idleNote.hide();
      syncViews();
    },
    // The sounds. They hang off the session rather than off the event
    // handlers because they are about what the BOARD did, not about what was
    // pressed: a turn the queue refused makes no sound, and a tick that ended
    // the run is reported by `ended` alone, so a pulse does not play
    // underneath its own death cue.
    ticked: cues.ticked,
    turned: cues.turned,
    ended: (state, { newHighScore }) => {
      syncViews();
      cues.ended(state, { newHighScore });
      // The summary carries the ramp step BY NAME, and says so in words when
      // the run was a new best. Neither is information a screen reader ever
      // had from the colour on the board.
      gameOver.show(gameOverSummary(state, { newHighScore }));
    },
    // Restart returns the board to idle, so the instruction comes back with
    // it. Focus moves to the play surface here — a response to the button the
    // player just pressed, not a move the app made on its own.
    restarted: () => {
      // The death cue and its fanfare belong to the run that ended. A new
      // board arriving under the tail of the old board's sound is the same
      // mistake as a game-over summary left on screen.
      audio.stop();
      gameOver.hide();
      idleNote.show();
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
  firstGesture();
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

  const update = labeller.update(state, {
    paused: loop.isPaused(),
    idle: session.lifecycle === 'idle',
    dpadVisible: dpadQuery.matches,
  });
  // The label is written to the canvas exactly when the labeller says it
  // changed: at the start, at a pause, at a death and at the win. Never per
  // tick, and never into a live region.
  if (update.changed) canvas.setAttribute('aria-label', update.label);
}

function render(now = 0) {
  renderer.draw(session.state, { ...motionOptions(), focused, now });
}

// The frame loop lives in src/loop.js, which takes its frame scheduler as an
// argument. This is the only place the real one is named. rAF passes the
// timestamp to its callback, so handing over the scheduler hands over the
// clock, and the loop can be driven through 50 simulated ticks in a test
// without a browser. There is no restart clock in it: a finished run stays
// finished.
const loop = createLoop({
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  session,
  render,
  paused: document.visibilityState === 'hidden',
});

document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  // Nothing is SCHEDULED while the tab is hidden, and what is already
  // scheduled is stopped. A hidden tab that keeps queueing notes comes back
  // with a backlog of them to play at once, which is the audio version of the
  // three hundred ticks the frame clamp exists to prevent.
  audio.setHidden(hidden);
  if (loop.setPaused(hidden)) syncViews();
});

// One keydown listener, on the document, and the ONLY preventDefault in the
// project. The session answers three questions before it says yes — is the
// game running, does the play surface have focus, and is this a game key at
// all — so Tab is never taken, a key pressed inside the settings panel is
// never taken, and a key pressed after the run has ended is never taken.
document.addEventListener('keydown', (event) => {
  // Unlocked before the key is applied, so the context exists by the time the
  // turn this press queues makes a sound. Still inside the gesture: this is
  // the handler the browser dispatched, not a callback out of it.
  firstGesture();
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
  // The gesture is the press, not the swipe it may turn into. A pointerdown
  // that resolves to no direction still counts as the user action the autoplay
  // policy is asking for.
  firstGesture();
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

// Sound follows the persisted setting, in both directions and immediately.
// Switching it OFF silences what is already sounding rather than waiting for
// the current note: the death cue is 600 ms and is exactly the sound a player
// reaches for the toggle during. Switching it ON is itself a gesture — the
// change event came from a real click or key — so it is a valid moment to
// build the context, which is why a player who arrives with sound off is not
// stuck with silence for the rest of the session.
store.subscribe((record) => {
  audio.setEnabled(record.soundOn);
  if (record.soundOn) audio.unlock();
  // Sound off means nothing for a ringer switch to silence, so the line goes
  // with it and comes back with it.
  syncRingerHint();
});
audio.setEnabled(store.getState().soundOn);
syncRingerHint();

// A hybrid laptop gains a coarse pointer the moment a finger touches the
// screen, and the d-pad appears with it. The board is still idle, so nothing
// about the phase changed and the labeller would otherwise keep the sentence
// it was born with while the page under it swapped.
dpadQuery.addEventListener('change', () => {
  if (session.lifecycle === 'idle') idleNote.show();
  labeller.invalidate();
  syncViews();
});

store.subscribe(syncViews);

// Idle from the first frame: the note is in the markup already, and this is
// the state the rest of the app agrees with.
idleNote.show();

resize();
syncViews();
loop.start();
