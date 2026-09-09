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

const BASE_INTERVAL_MS = 140;

// Runs the timed loop until the snake dies against a wall, or gives up.
//
// A fresh board is idle and buys no ticks, so this acts once to start it, and
// acts as neutrally as it can: it steers along the heading the board already
// has, so the run that follows is the run the board would have played. After
// that there is no further input, and it holds its heading into a wall.
function playToDeath(session, limit = 20000) {
  if (session.lifecycle === 'idle') session.steer(session.state.direction);
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
    // Started, so a zero here is step mode holding the clock rather than the
    // board simply not having begun.
    session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
    expect(session.lifecycle).toBe('running');
    expect(session.ticks).toBe(1);

    expect(session.elapse(1000)).toBe(0);
    expect(session.ticks).toBe(1);
  });

  it('restores the timed loop when step mode goes off', () => {
    const store = makeStore({ stepMode: true });
    const { session } = makeSession({ store });
    session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
    const steppedTicks = session.ticks;

    expect(session.elapse(1000)).toBe(0);

    store.setStepMode(false);

    expect(session.elapse(1000)).toBeGreaterThan(0);
    expect(session.ticks).toBeGreaterThan(steppedTicks);
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
    session.steer('right');
    const ticks = session.elapse(40000);
    // 250 ms of budget at a 140 ms opening interval is one tick, not 285.
    expect(ticks).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_MS / 70));
  });
});

describe('idle', () => {
  it('is where a fresh session starts, and it buys no ticks across ten seconds of frames', () => {
    // The named case, and the whole point of the third state. A board that
    // starts live is a board that has already hit the right-hand wall eleven
    // ticks — a second and a half — after the page loaded, so the first thing
    // a visitor sees is a game they never played, already over.
    const { session } = makeSession();

    expect(session.lifecycle).toBe('idle');

    let elapsed = 0;
    while (elapsed < 10000) {
      session.elapse(MAX_FRAME_MS);
      elapsed += MAX_FRAME_MS;
    }

    expect(session.ticks).toBe(0);
    expect(session.lifecycle).toBe('idle');
    expect(session.state.status).toBe('playing');
    expect(session.state.snake[0]).toEqual({ x: 13, y: 9 });
  });

  it('starts on the first directional key and applies that key as the first turn', () => {
    // The named case. Consuming the press to start the game and throwing it
    // away is the version of this that feels broken: the player presses up,
    // the snake goes right, and they blame the game rather than the design.
    const { session } = makeSession();

    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: true });
    expect(session.lifecycle).toBe('running');

    session.elapse(BASE_INTERVAL_MS);

    expect(session.ticks).toBe(1);
    expect(session.state.snake[0]).toEqual({ x: 13, y: 8 });
    expect(session.state.direction).toBe('up');
  });

  it('starts on a swipe or a d-pad press the same way, and applies it as the first turn', () => {
    const { session } = makeSession();

    session.steer('down');
    expect(session.lifecycle).toBe('running');

    session.elapse(BASE_INTERVAL_MS);

    expect(session.state.snake[0]).toEqual({ x: 13, y: 10 });
  });

  it('is not started by a key the board does not steer with', () => {
    const { session } = makeSession();
    session.applyKey({ key: 'Tab' }, { surfaceFocused: true });
    session.applyKey({ key: ' ' }, { surfaceFocused: true });
    session.applyKey({ key: 'q' }, { surfaceFocused: true });

    expect(session.lifecycle).toBe('idle');
    expect(session.ticks).toBe(0);
  });

  it('is not started by a key pressed somewhere other than the play surface', () => {
    const { session } = makeSession();
    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: false });
    expect(session.lifecycle).toBe('idle');
  });

  it('starts the game and advances exactly one tick on the first keypress in step mode', () => {
    // The named case. Step mode has no clock, so starting the run and moving
    // are the same press or the first press does nothing visible at all.
    const { session } = makeSession({ store: makeStore({ stepMode: true }) });

    session.applyKey({ key: 'ArrowUp' }, { surfaceFocused: true });

    expect(session.lifecycle).toBe('running');
    expect(session.ticks).toBe(1);
    expect(session.state.snake[0]).toEqual({ x: 13, y: 8 });
  });
});

describe('a running board left alone', () => {
  it('survives eleven ticks before the wall, rather than dying on the spot', () => {
    // Pinned because a summary reading "final score 0, length 4" was mistaken
    // for a board that dies immediately. It does not: the starting snake is
    // four segments facing right with its head at x=13 on a 24-wide board, so
    // it has eleven moves before the wall at 140 ms each, and 1540 ms of it.
    // Started here by a press, because a fresh board no longer runs on its own.
    const { session } = makeSession();
    expect(session.state.snake[0]).toEqual({ x: 13, y: 9 });
    expect(session.state.direction).toBe('right');

    session.applyKey({ key: 'ArrowRight' }, { surfaceFocused: true });
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

  it('starts a new board only when restart is called, and lands it in idle', () => {
    // The named case. Restart hands back a board that is ready, not one that
    // is already moving: the player pressed a button, which is not the same as
    // asking to be dropped into a run already under way.
    const { session } = makeSession();
    playToDeath(session);
    const finished = session.state;

    session.restart();

    expect(session.lifecycle).toBe('idle');
    expect(session.state.status).toBe('playing');
    expect(session.state).not.toBe(finished);
    expect(session.state.score).toBe(0);
    expect(session.ticks).toBe(0);

    let elapsed = 0;
    while (elapsed < 10000) {
      session.elapse(MAX_FRAME_MS);
      elapsed += MAX_FRAME_MS;
    }
    expect(session.ticks).toBe(0);
    expect(session.lifecycle).toBe('idle');

    // And the next directional input starts it, exactly as on first load.
    session.steer('up');
    expect(session.lifecycle).toBe('running');
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

  it('reports the finished board as over, not as running', () => {
    const { session } = makeSession();
    playToDeath(session);
    expect(session.lifecycle).toBe('over');
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
