// Phase 6 — the frame loop, driven without a browser.
//
// The loop could not be watched in the preview pane: requestAnimationFrame
// does not fire while the pane is not painting, so the timed board sat still
// there and only step mode and pointer input could be seen working. That is a
// reason to test the loop, not a reason to trust it.
//
// The clock is injected as the frame scheduler, because that is what a clock
// is here: rAF passes its callback the timestamp, and src/loop.js reads no
// other source of time — no Date.now(), no performance.now(). Handing over the
// scheduler therefore hands over the clock entire, and these cases drive fifty
// simulated ticks, a forty-second frame and a tab switch through it at
// whatever speed they like.

import { describe, it, expect } from 'vitest';
import { createLoop } from '../src/loop.js';
import { createSession, MAX_FRAME_MS } from '../src/session.js';
import { createStore } from '../src/store.js';
import { STORAGE_KEY, defaultRecord } from '../src/persist.js';
import { tickIntervalFor } from '../src/core/game.js';
import { createFakeStorage, mulberry32, chooseDirection, WIDTH, HEIGHT } from './helpers.js';

const BASE_INTERVAL_MS = 140;
const MIN_INTERVAL_MS = 70;

// The rAF stub. It holds the one callback the loop has scheduled and hands it
// whatever timestamp the test decides, which is the whole of the injection:
// the test owns the clock, and nothing here advances on its own.
function fakeFrames() {
  let pending = null;
  return {
    requestFrame(callback) { pending = callback; },
    frame(now) {
      const callback = pending;
      pending = null;
      if (callback === null) throw new Error('the loop has no frame scheduled');
      callback(now);
    },
    get scheduled() { return pending !== null; },
  };
}

function mount({ record = {}, seed = 77, paused = false } = {}) {
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ ...defaultRecord(), ...record }),
  });
  const store = createStore({ storage });
  const session = createSession({
    width: WIDTH, height: HEIGHT, rng: mulberry32(seed), store,
  });
  const frames = fakeFrames();
  const drawn = [];
  const loop = createLoop({
    requestFrame: frames.requestFrame,
    session,
    render: (now) => drawn.push(now),
    paused,
  });
  loop.start();
  // A fresh board is idle and buys no ticks until the player acts. These cases
  // are about the clock rather than the lifecycle, so they act once, up front,
  // and as neutrally as possible: along the heading the board already has.
  session.steer(session.state.direction);
  return { session, store, frames, loop, drawn };
}

describe('the loop against an injected clock', () => {
  it('advances one tick per tickIntervalFor(state) of elapsed time, across 60 ticks', () => {
    // Fed exactly the interval the board asks for, one frame at a time, and
    // asserted one tick per frame. The interval is read from the public
    // tickIntervalFor before each frame rather than reimplemented here, and
    // the run eats, so the interval shrinks underneath the loop and the loop
    // has to follow it down within the same run.
    const { session, frames, loop } = mount();

    // The first frame sets the origin: its delta is zero by construction, so
    // the clock starts here rather than at whenever the page loaded.
    frames.frame(0);
    expect(session.ticks).toBe(0);

    let now = 0;
    const intervals = [];
    for (let expected = 1; expected <= 60; expected++) {
      // Steered so the run survives long enough to eat; the chaser is the
      // same one phase 2 measured with.
      session.turn(chooseDirection(session.state));

      const interval = tickIntervalFor(session.state);
      // The interval the board charges for this tick is the one its own food
      // count dictates, checked against the formula rather than against
      // tickIntervalFor a second time.
      expect(interval).toBe(
        Math.max(MIN_INTERVAL_MS, BASE_INTERVAL_MS - 6 * session.state.foodEaten),
      );
      intervals.push(interval);
      now += interval;
      frames.frame(now);

      expect(session.ticks, `after ${expected} intervals of board time`).toBe(expected);
      expect(session.state.status).toBe('playing');
    }

    // The interval did shrink during the run, so the equality above is not
    // being satisfied by a constant 140 sixty times over.
    expect(session.state.foodEaten).toBeGreaterThan(0);
    expect(intervals[0]).toBe(BASE_INTERVAL_MS);
    expect(intervals.at(-1)).toBeLessThan(BASE_INTERVAL_MS);
    expect(new Set(intervals).size).toBeGreaterThan(1);

    // And the total board time spent is the sum of the intervals it charged
    // for, with nothing left over: 60 ticks, exactly paid for.
    expect(now).toBe(intervals.reduce((a, b) => a + b, 0));
    expect(loop.frames).toBe(61);
  });

  it('spends elapsed time at the flat rate while nothing is eaten', () => {
    // The same claim in the divided form, on a board whose interval cannot
    // move: eight frames of 140 ms buy eight ticks, no more and no fewer.
    const { session, frames } = mount();
    frames.frame(0);

    let now = 0;
    for (let i = 0; i < 8; i++) {
      now += BASE_INTERVAL_MS;
      frames.frame(now);
    }

    expect(session.state.foodEaten).toBe(0);
    expect(session.ticks).toBe(now / BASE_INTERVAL_MS);
  });

  it('advances at most what the 250 ms clamp allows on a single 40-second frame', () => {
    // The backgrounded tab that never fired visibilitychange. Unclamped, forty
    // seconds at 140 ms is 285 ticks in one frame and the player returns to a
    // corpse they never saw die.
    const { session, frames } = mount();
    frames.frame(0);

    frames.frame(40000);

    expect(session.ticks).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_MS / MIN_INTERVAL_MS));
    // 250 ms of budget at the opening 140 ms interval is exactly one tick.
    expect(session.ticks).toBe(1);
    expect(session.state.status).toBe('playing');
  });

  it('stops advancing when the tab goes hidden, and does not replay the missed time', () => {
    const { session, frames, loop } = mount();
    frames.frame(0);

    let now = 0;
    for (let i = 0; i < 4; i++) {
      now += BASE_INTERVAL_MS;
      frames.frame(now);
    }
    const ticksBeforeHiding = session.ticks;
    expect(ticksBeforeHiding).toBe(4);

    // Hidden. The loop keeps being scheduled — it still draws — but it spends
    // no time on the board.
    loop.setPaused(true);
    const framesBeforeHiding = loop.frames;
    for (let i = 0; i < 5; i++) {
      now += 8000;
      frames.frame(now);
    }
    expect(session.ticks).toBe(ticksBeforeHiding);
    expect(loop.frames).toBe(framesBeforeHiding + 5);

    // Visible again, forty seconds later. The first frame back has a delta of
    // zero: that time was not time the player was playing, and it is dropped
    // rather than caught up. Nothing replays.
    loop.setPaused(false);
    now += 100;
    frames.frame(now);
    expect(session.ticks).toBe(ticksBeforeHiding);

    // And the clock runs again from there.
    now += BASE_INTERVAL_MS;
    frames.frame(now);
    expect(session.ticks).toBe(ticksBeforeHiding + 1);
  });

  it('keeps scheduling frames after the run has ended, with no clock that restarts it', () => {
    // The loop does not stop at a death — the board has to stay on screen —
    // and there is no branch left in it that replaces the board on a timer.
    const { session, frames, loop } = mount();
    frames.frame(0);

    let now = 0;
    while (session.state.status === 'playing' && now < 20000) {
      now += MAX_FRAME_MS;
      frames.frame(now);
    }
    expect(session.state.status).toBe('dead');
    const dead = session.state;

    for (let i = 0; i < 100; i++) {
      now += MAX_FRAME_MS;
      frames.frame(now);
    }

    expect(frames.scheduled).toBe(true);
    expect(loop.frames).toBeGreaterThan(100);
    expect(session.state).toBe(dead);
  });

  it('starts paused when the page is loaded into a hidden tab', () => {
    const { session, frames } = mount({ paused: true });
    frames.frame(0);
    frames.frame(5000);
    expect(session.ticks).toBe(0);
  });
});
