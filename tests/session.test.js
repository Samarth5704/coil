// Phase 6 — the run lifecycle.
//
// The session is the game's clock and its ending, with the DOM lifted out of
// it: it holds the board, drains the accumulator, applies a keypress, ends a
// run exactly once, and starts a new one when it is asked to. main.js turns
// its callbacks into nodes on the page.
//
// Phase 5 ended a run and replaced the board on a timer, for the single
// reason that phase 5 had no input. Phase 6 has input, and the
// timer is gone: a finished run is finished until the player restarts it,
// because the summary is where the ramp step is named and a board that takes
// itself away takes the summary with it.

import { describe, it, expect, vi } from 'vitest';
import { createSession, MAX_FRAME_MS } from '../src/session.js';
import { createStore } from '../src/store.js';
import { STORAGE_KEY, defaultRecord } from '../src/persist.js';
import { createFakeStorage, mulberry32, WIDTH, HEIGHT } from './helpers.js';

// The duration phase 5's auto-restart used to wait before it wiped the board.
// It is not imported from src/ — there is nothing left in src/ to import it
// from, and that is the point of the case that uses it.
const FORMER_RESTART_DELAY_MS = 2600;

function makeStore(fields = {}) {
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ ...defaultRecord(), ...fields }),
  });
  return createStore({ storage });
}

// A board that scores before it dies: head at (5,5) travelling right with an
// apple four cells ahead, then the right-hand wall. createGame's setup
// overrides, used for what phase 1 put them there for.
const SCORING_SETUP = {
  snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
  food: { x: 9, y: 5 },
};

function makeSession({ store = makeStore(), view = {}, seed = 7, setup } = {}) {
  const session = createSession({
    width: WIDTH, height: HEIGHT, rng: mulberry32(seed), store, view, setup,
  });
  return { session, store };
}

// Runs the timed loop until the snake dies against a wall, or gives up. There
// is no input on this board, so it holds its heading and reaches a wall in
// about a dozen ticks.
function playToDeath(session, limit = 20000) {
  let elapsed = 0;
  while (session.state.status === 'playing' && elapsed < limit) {
    session.elapse(MAX_FRAME_MS);
    elapsed += MAX_FRAME_MS;
  }
  return session.state;
}

describe('step mode', () => {
  it('advances exactly one tick per keydown', () => {
    const { session } = makeSession({ store: makeStore({ stepMode: true }) });

    expect(session.ticks).toBe(0);
    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: true });
    expect(session.ticks).toBe(1);
    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: true });
    expect(session.ticks).toBe(2);
  });

  it('does not advance on a repeated keydown from a held key', () => {
    // A held arrow fires keydown at the OS repeat rate, which is faster than
    // the loop it replaced. Step mode exists so there is no clock; a repeat
    // that ticks hands the clock straight back, at a rate the player did not
    // choose and cannot see.
    const { session } = makeSession({ store: makeStore({ stepMode: true }) });

    session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
    expect(session.ticks).toBe(1);

    for (let i = 0; i < 12; i++) {
      session.applyKey({ key: 'ArrowRight', repeat: true }, { surfaceFocused: true });
    }
    expect(session.ticks).toBe(1);

    // The key comes up and goes down again: a fresh press, and one more tick.
    session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
    expect(session.ticks).toBe(2);
  });

  it('does not run the timed loop while step mode is on', () => {
    const { session } = makeSession({ store: makeStore({ stepMode: true }) });
    expect(session.elapse(1000)).toBe(0);
    expect(session.ticks).toBe(0);
  });

  it('restores the timed loop when step mode goes off', () => {
    const store = makeStore({ stepMode: true });
    const { session } = makeSession({ store });

    expect(session.elapse(1000)).toBe(0);

    store.setStepMode(false);

    expect(session.elapse(1000)).toBeGreaterThan(0);
    expect(session.ticks).toBeGreaterThan(0);
  });

  it('ignores a keypress the play surface did not have focus for', () => {
    const { session } = makeSession({ store: makeStore({ stepMode: true }) });
    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: false });
    expect(session.ticks).toBe(0);
  });
});

describe('the timed loop', () => {
  it('clamps the delta of one frame, so a backgrounded tab does not return and run three hundred ticks', () => {
    const { session } = makeSession();
    const ticks = session.elapse(40000);
    // 250 ms of budget at a 140 ms opening interval is one tick, not 285.
    expect(ticks).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_MS / 70));
  });
});

describe('a fresh board left alone', () => {
  it('survives eleven ticks before the wall, rather than dying on the spot', () => {
    // Pinned because a summary reading "final score 0, length 4" was mistaken
    // for a board that dies immediately. It does not: the starting snake is
    // four segments facing right with its head at x=13 on a 24-wide board, so
    // it has eleven moves before the wall at 140 ms each, and 1540 ms of it.
    // Nothing about this is input-dependent, which is why it is worth a name.
    const { session } = makeSession();
    expect(session.state.snake[0]).toEqual({ x: 13, y: 9 });
    expect(session.state.direction).toBe('right');

    const dead = playToDeath(session);

    expect(session.ticks).toBe(11);
    expect(dead.status).toBe('dead');
    expect(dead.snake.length).toBe(4);
  });
});

describe('the end of a run', () => {
  it('calls submitScore exactly once, with the final score', () => {
    const store = makeStore();
    const spy = vi.spyOn(store, 'submitScore');
    const { session } = makeSession({ store });

    const dead = playToDeath(session);
    expect(dead.status).not.toBe('playing');

    // Kept elapsing past the death: the loop goes on running frames, and a
    // submit per frame would be a storage write per frame.
    for (let i = 0; i < 40; i++) session.elapse(MAX_FRAME_MS);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(dead.score);
  });

  it('tells the view whether the run beat the stored high score, measured before the submit', () => {
    const ended = [];
    const store = makeStore({ highScore: 0 });
    const { session } = makeSession({
      store, setup: SCORING_SETUP, view: { ended: (s, meta) => ended.push(meta) },
    });

    playToDeath(session);

    expect(session.state.score).toBe(10);
    expect(ended).toHaveLength(1);
    expect(ended[0].newHighScore).toBe(true);
    // Measured before the submit, or the store has already taken the score and
    // every run is a new best against itself.
    expect(store.getState().highScore).toBe(10);
  });

  it('does not report a new high score when the stored one is out of reach', () => {
    const ended = [];
    const store = makeStore({ highScore: 100000 });
    const { session } = makeSession({
      store, setup: SCORING_SETUP, view: { ended: (s, meta) => ended.push(meta) },
    });

    playToDeath(session);

    expect(ended[0].newHighScore).toBe(false);
  });

  it('stays finished after the duration the auto-restart used to wait', () => {
    // The named case, and the reason the auto-restart is gone rather than set
    // to something large. A finished run is finished until the player says
    // otherwise.
    const { session } = makeSession();
    const dead = playToDeath(session);
    const score = dead.score;

    let waited = 0;
    while (waited < FORMER_RESTART_DELAY_MS * 4) {
      session.elapse(MAX_FRAME_MS);
      waited += MAX_FRAME_MS;
    }

    expect(session.state.status).toBe(dead.status);
    expect(session.state.status).not.toBe('playing');
    expect(session.state.score).toBe(score);
    expect(session.state.snake).toEqual(dead.snake);
  });

  it('starts a new board only when restart is called', () => {
    const { session } = makeSession();
    playToDeath(session);
    const finished = session.state;

    session.restart();

    expect(session.state.status).toBe('playing');
    expect(session.state).not.toBe(finished);
    expect(session.state.score).toBe(0);
    expect(session.ticks).toBe(0);
  });

  it('submits again after a restart, because the next run is a different run', () => {
    const store = makeStore();
    const spy = vi.spyOn(store, 'submitScore');
    const { session } = makeSession({ store });

    playToDeath(session);
    session.restart();
    playToDeath(session);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not steer or advance a finished board', () => {
    // Stepped to death rather than run to it: in step mode the clock does not
    // run at all, so the only thing that can reach the wall is a keypress.
    const { session } = makeSession({ store: makeStore({ stepMode: true }) });
    let presses = 0;
    while (session.state.status === 'playing' && presses < 100) {
      session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
      presses++;
    }
    const dead = session.state;
    expect(dead.status).toBe('dead');

    const ticksAtDeath = session.ticks;
    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: true });
    session.steer('down');
    session.turn('down');

    expect(session.state).toBe(dead);
    expect(session.ticks).toBe(ticksAtDeath);
  });
});
