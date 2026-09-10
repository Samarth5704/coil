// Phase 6 correction — the board that waits.
//
// A fresh load used to run: eleven ticks, a wall, and focus taken to the
// restart button about a second and a half after the page appeared. Two things
// wrong with that at once. The visitor arrives at a game already over, having
// never played it; and the page moves focus on a timer, with no user action
// anywhere in the causal chain, which is the thing a screen reader user
// experiences as the page grabbing them.
//
// So: idle, and one line of real text saying how to leave it.

import { describe, it, expect } from 'vitest';
import { createIdleNote } from '../src/ui/idle.js';
import { createGameOver } from '../src/ui/gameover.js';
import { createReadout } from '../src/ui/readout.js';
import { createSession, MAX_FRAME_MS } from '../src/session.js';
import { createStore } from '../src/store.js';
import { STORAGE_KEY, defaultRecord } from '../src/persist.js';
import {
  gameOverSummary, IDLE_INSTRUCTION, IDLE_INSTRUCTION_WITH_DPAD,
  idleInstructionFor, ariaLabelFor, createAriaLabeller,
} from '../src/render/labels.js';
import { createGame } from '../src/core/game.js';
import { appMarkup } from './fake-dom.js';
import { createFakeStorage, mulberry32, WIDTH, HEIGHT } from './helpers.js';

// What phase 5's auto-restart used to wait before it wiped the board, and
// roughly what a fresh board used to take to kill itself.
const FORMER_RESTART_DELAY_MS = 2600;

// main.js's wiring, in main.js's order.
function mountApp({ record = {}, seed = 7 } = {}) {
  const markup = appMarkup();
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ ...defaultRecord(), ...record }),
  });
  const store = createStore({ storage });
  const readout = createReadout({ root: markup.panel });
  const surface = markup.doc.createElement('canvas');
  markup.panel.appendChild(surface);
  const idleNote = createIdleNote({ root: markup.panel });

  let session;
  const gameOver = createGameOver({
    root: markup.panel,
    writeSummary: readout.setSummary,
    onRestart: () => {
      session.restart();
      surface.focus();
    },
  });

  session = createSession({
    width: WIDTH,
    height: HEIGHT,
    rng: mulberry32(seed),
    store,
    view: {
      started: () => idleNote.hide(),
      ended: (state, meta) => gameOver.show(gameOverSummary(state, meta)),
      restarted: () => {
        gameOver.hide();
        idleNote.show();
      },
    },
  });

  idleNote.show();
  return {
    ...markup, store, readout, session, gameOver, idleNote, surface,
  };
}

const noteText = (app) => app.panel.querySelector('[data-role="idle"]');

function frames(app, ms) {
  let elapsed = 0;
  while (elapsed < ms) {
    app.session.elapse(MAX_FRAME_MS);
    elapsed += MAX_FRAME_MS;
  }
}

describe('the idle instruction', () => {
  it('is present, as real text, while the board is idle', () => {
    const app = mountApp();

    expect(app.session.lifecycle).toBe('idle');
    expect(noteText(app).getAttribute('hidden')).toBe(null);
    expect(noteText(app).textContent.trim()).toBe(IDLE_INSTRUCTION);
    expect(IDLE_INSTRUCTION).toMatch(/arrow/i);
  });

  it('is gone once the board is running', () => {
    const app = mountApp();

    app.session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: true });

    expect(app.session.lifecycle).toBe('running');
    // Hidden by the hidden attribute, so it leaves the accessibility tree as
    // well as the page. An instruction for starting a game already started is
    // not merely redundant, it is wrong.
    expect(noteText(app).getAttribute('hidden')).not.toBe(null);
  });

  it('comes back on restart, because restart lands in idle', () => {
    const app = mountApp();
    app.session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
    frames(app, 20000);
    expect(app.session.lifecycle).toBe('over');

    app.gameOver.button.click();

    expect(app.session.lifecycle).toBe('idle');
    expect(noteText(app).getAttribute('hidden')).toBe(null);
  });
});

describe('focus while idle', () => {
  it('is never moved by the app, including past the point that used to kill the board', () => {
    // The named case. Nothing here is a user action, so nothing here may take
    // focus. The death focus move is not in scope and is not weakened: by the
    // time a run ends, the player has pressed something.
    const app = mountApp();
    expect(app.doc.activeElement).toBe(app.doc.body);

    frames(app, FORMER_RESTART_DELAY_MS * 4);

    expect(app.doc.activeElement).toBe(app.doc.body);
    expect(app.session.lifecycle).toBe('idle');
    expect(app.session.ticks).toBe(0);
    expect(app.region.getAttribute('hidden')).not.toBe(null);
    expect(app.panel.querySelector('[data-field="summary"]').textContent).toBe('');
  });

  it('still moves to the restart button on a death, which the player played into', () => {
    const app = mountApp();
    app.session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
    frames(app, 20000);

    expect(app.session.lifecycle).toBe('over');
    expect(app.doc.activeElement).toBe(app.gameOver.button);
  });
});

// ---------------------------------------------------------------------------
// Phase 7 carry-over — the instruction names what is actually on screen.
//
// The sentence used to name the arrow buttons unconditionally. The d-pad is
// displayed only under `@media (pointer: coarse)`, so a desktop visitor was
// told to use a control that was not on their page — and for a screen reader
// user, told about buttons that were `display: none` and therefore not in the
// accessibility tree to find. An instruction that lists a control the reader
// does not have is worse than one that leaves a control unmentioned: it sends
// them looking.

describe('the idle instruction names only the controls that are on screen', () => {
  it('leaves the arrow buttons out where the d-pad is not displayed', () => {
    expect(idleInstructionFor({ dpadVisible: false })).toBe(IDLE_INSTRUCTION);
    expect(IDLE_INSTRUCTION).not.toMatch(/button/i);
    // The two ways in that every visitor has, on every device.
    expect(IDLE_INSTRUCTION).toMatch(/arrow key/i);
    expect(IDLE_INSTRUCTION).toMatch(/swipe/i);
  });

  it('names them where it is', () => {
    const withDpad = idleInstructionFor({ dpadVisible: true });

    expect(withDpad).toBe(IDLE_INSTRUCTION_WITH_DPAD);
    expect(withDpad).toMatch(/arrow buttons/i);
  });

  it('defaults to the form without them, which is the form in the markup', () => {
    // No argument is the safe answer: a caller that has not decided has not
    // established that the buttons are there, and the markup the browser parses
    // before any script runs can only be this form.
    expect(idleInstructionFor()).toBe(IDLE_INSTRUCTION);
  });

  it('says the same thing about the keyboard and the swipe in both forms', () => {
    // One sentence with a clause swapped, not two sentences maintained apart.
    const shared = IDLE_INSTRUCTION.replace(/\.$/, '');
    expect(IDLE_INSTRUCTION_WITH_DPAD.startsWith(shared)).toBe(true);
  });

  it('is one sentence either way', () => {
    for (const text of [IDLE_INSTRUCTION, IDLE_INSTRUCTION_WITH_DPAD]) {
      expect(text.match(/\./g)).toHaveLength(1);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('puts the form the page is showing on the node, not the form in the markup', () => {
    // The note rewrites its own text on every show, because whether the d-pad
    // is displayed is a media query and a media query can change without the
    // page reloading.
    const markup = appMarkup();
    let coarse = false;
    const note = createIdleNote({
      root: markup.panel,
      instruction: () => idleInstructionFor({ dpadVisible: coarse }),
    });

    note.show();
    expect(markup.idle.textContent).toBe(IDLE_INSTRUCTION);

    coarse = true;
    note.show();
    expect(markup.idle.textContent).toBe(IDLE_INSTRUCTION_WITH_DPAD);
  });

  it('gives the canvas the same form the page is showing', () => {
    // Two descriptions of one board is the drift the single source exists to
    // prevent, and it would be invisible: the person reading the page and the
    // person hearing the label are never the same person.
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: () => 0.5 });

    expect(ariaLabelFor(state, { idle: true })).toContain(IDLE_INSTRUCTION);
    expect(ariaLabelFor(state, { idle: true, dpadVisible: true }))
      .toContain(IDLE_INSTRUCTION_WITH_DPAD);
  });

  it('lets the labeller rewrite when the pointer changes but the phase does not', () => {
    // A hybrid laptop gains a coarse pointer the moment a finger touches the
    // screen. The board is still idle, so nothing about the phase changed, and
    // without invalidate() the label would keep the sentence it was born with
    // while the page under it swapped.
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: () => 0.5 });
    const labeller = createAriaLabeller();

    expect(labeller.update(state, { idle: true }).label).toContain(IDLE_INSTRUCTION);
    expect(labeller.update(state, { idle: true, dpadVisible: true }).changed).toBe(false);

    labeller.invalidate();
    const again = labeller.update(state, { idle: true, dpadVisible: true });
    expect(again.changed).toBe(true);
    expect(again.label).toContain(IDLE_INSTRUCTION_WITH_DPAD);
  });
});
