// Phase 6 — the game-over state, and where focus goes.
//
// Phase 5 replaced a finished board on a timer because it had no control
// that could start another one. That timer is gone. What replaces it
// is a region that stays: the summary that names the ramp step, and a real
// button that names what it restarts.
//
// Focus is the part with a wrong answer. A region appearing with nothing
// focused leaves focus on <body>, which is where a screen reader user finds
// themselves at the top of the page with no announcement that the run ended
// and nothing under the cursor. Moving it to the restart button says the run
// ended and offers the next one in the same movement.

import { describe, it, expect } from 'vitest';
import { createGameOver } from '../src/ui/gameover.js';
import { createReadout } from '../src/ui/readout.js';
import { createSession, MAX_FRAME_MS } from '../src/session.js';
import { createStore } from '../src/store.js';
import { STORAGE_KEY, defaultRecord } from '../src/persist.js';
import { gameOverSummary } from '../src/render/labels.js';
import { appMarkup } from './fake-dom.js';
import { createFakeStorage, mulberry32, WIDTH, HEIGHT } from './helpers.js';

// What phase 5's auto-restart constant was set to. Written here as a number
// because there is nothing left in src/ to import it from, which is the point
// of the case that uses it.
const FORMER_RESTART_DELAY_MS = 2600;

// A board that scores before it dies. Head at (5,5) travelling right with an
// apple four cells ahead: it eats on tick 4 and runs into the right-hand wall
// on tick 18, so the run is worth exactly one apple at 1x and the high-score
// cases below have a real number to compare rather than a zero. The setup
// overrides are createGame's own, and this is what phase 1 put them there for.
const SCORING_SETUP = {
  snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
  food: { x: 9, y: 5 },
};

// The wiring main.js does, in the same order, so a test is not asserting
// against an arrangement the app does not have: the readout owns the summary
// node and writes the string; the game-over region owns the button, the
// region's visibility, and focus.
function mountApp({ record = {}, seed = 7, setup } = {}) {
  const markup = appMarkup();
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ ...defaultRecord(), ...record }),
  });
  const store = createStore({ storage });
  const readout = createReadout({ root: markup.panel });
  const surface = markup.doc.createElement('canvas');
  markup.panel.appendChild(surface);

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
    setup,
    store,
    view: {
      ended: (state, meta) => gameOver.show(gameOverSummary(state, meta)),
      restarted: () => gameOver.hide(),
    },
  });

  return { ...markup, store, readout, session, gameOver, surface };
}

function playToDeath(app, limit = 20000) {
  let elapsed = 0;
  while (app.session.state.status === 'playing' && elapsed < limit) {
    app.session.elapse(MAX_FRAME_MS);
    elapsed += MAX_FRAME_MS;
  }
  return app.session.state;
}

describe('the restart control', () => {
  it('is a real button with an accessible name saying what it restarts', () => {
    const app = mountApp();
    expect(app.gameOver.button.tagName).toBe('BUTTON');

    const name = app.gameOver.button.getAttribute('aria-label')
      || app.gameOver.button.textContent;
    expect(name.trim()).not.toBe('');
    // "Restart" on its own names an action with no object. Out of context —
    // which is how a screen reader's element list reads it — it could restart
    // the page, the music, or the browser.
    expect(name.trim().toLowerCase()).not.toBe('restart');
    expect(name).toMatch(/run|game|board/i);
  });

  it('throws rather than accept anything that is not a button element', () => {
    const markup = appMarkup();
    const impostor = markup.doc.createElement('div');
    impostor.setAttribute('data-role', 'restart');
    markup.region.children = markup.region.children.filter(
      (c) => c.getAttribute('data-role') !== 'restart',
    );
    markup.region.appendChild(impostor);

    expect(() => createGameOver({
      root: markup.panel, writeSummary: () => {}, onRestart: () => {},
    })).toThrow(/button/i);
  });

  it('is hidden until a run ends', () => {
    const app = mountApp();
    expect(app.region.getAttribute('hidden')).not.toBe(null);
    expect(app.gameOver.isShown()).toBe(false);
  });
});

describe('on death', () => {
  it('moves focus to the restart button, not to the body', () => {
    // The named case. Both outcomes look identical from the outside: the
    // region is on the page either way. Only activeElement separates them,
    // and only one of them tells the player anything.
    const app = mountApp();
    expect(app.doc.activeElement).toBe(app.doc.body);

    playToDeath(app);

    expect(app.doc.activeElement).toBe(app.gameOver.button);
    expect(app.doc.activeElement).not.toBe(app.doc.body);
  });

  it('writes the summary into the visually hidden node, with the ramp step by name', () => {
    const app = mountApp();
    const dead = playToDeath(app);
    const summary = app.panel.querySelector('[data-field="summary"]');

    expect(summary.textContent).toMatch(/final score/i);
    expect(summary.textContent).toContain(String(dead.score));
    expect(summary.textContent).toMatch(/calm|close|tight|hot|sealed/);
  });

  it('leaves the summary in the DOM after the duration the auto-restart used to wait', () => {
    // The named case. Phase 5 wiped the board here; the summary went with it,
    // and with it the only place the ramp step is given as a word.
    const app = mountApp();
    playToDeath(app);
    const summary = app.panel.querySelector('[data-field="summary"]');
    const written = summary.textContent;

    let waited = 0;
    while (waited < FORMER_RESTART_DELAY_MS * 4) {
      app.session.elapse(MAX_FRAME_MS);
      waited += MAX_FRAME_MS;
    }

    expect(app.panel.querySelector('[data-field="summary"]')).toBe(summary);
    expect(summary.textContent).toBe(written);
    expect(app.region.getAttribute('hidden')).toBe(null);
    expect(app.session.state.status).not.toBe('playing');
  });
});

describe('restarting', () => {
  it('starts a new run on a click and moves focus to the play surface', () => {
    const app = mountApp();
    playToDeath(app);

    app.gameOver.button.click();

    expect(app.session.state.status).toBe('playing');
    expect(app.region.getAttribute('hidden')).not.toBe(null);
    expect(app.panel.querySelector('[data-field="summary"]').textContent).toBe('');
    expect(app.doc.activeElement).toBe(app.surface);
  });
});

describe('the summary and a new high score', () => {
  it('says so in text when the run beat the stored high score', () => {
    // Named case. The colour of a new best, if there were one, would be the
    // one thing a colour-blind player is guaranteed not to receive.
    const app = mountApp({ record: { highScore: 0 }, setup: SCORING_SETUP });
    const dead = playToDeath(app);
    const summary = app.panel.querySelector('[data-field="summary"]').textContent;

    // Pinned, so the pair below is a real contrast rather than two runs that
    // both scored nothing.
    expect(dead.score).toBe(10);
    expect(summary).toMatch(/best|high score/i);
  });

  it('does not say so when the run did not beat it', () => {
    const app = mountApp({ record: { highScore: 100000 }, setup: SCORING_SETUP });
    const dead = playToDeath(app);
    expect(dead.score).toBe(10);
    const summary = app.panel.querySelector('[data-field="summary"]').textContent;

    expect(summary).not.toMatch(/best|high score/i);
    expect(summary).toMatch(/final score/i);
  });
});
