// Phase 5 — the words.
//
// The five ramp steps sit at 1.12:1 to 1.43:1 against each ADJACENT step, so
// the ramp cannot speak for itself. Everything in this file exists because a
// colour that a player cannot separate has to arrive as text instead.

import { describe, it, expect } from 'vitest';
import {
  RAMP_NAMES,
  rampFor,
  readoutStrings,
  gameOverSummary,
  createAriaLabeller,
  nonWritableHint,
} from '../src/render/labels.js';
import {
  createGame, tick, rampStepFor, multiplierFor, reachableFrom,
} from '../src/core/game.js';
import { load } from '../src/persist.js';
import {
  mulberry32, serpentine, at, WIDTH, HEIGHT, createFakeStorage,
} from './helpers.js';

const rng = () => 0;

// Boards standing at a known band. A snake laid along the serpentine path is
// as coiled as a snake gets, so a long prefix of it is sealed and a short one
// is calm.
function boardOfLength(n, food = at(0, HEIGHT - 1)) {
  const path = serpentine(WIDTH, HEIGHT);
  const body = path.slice(0, n).reverse(); // head first, off the serpentine end
  return createGame({ width: WIDTH, height: HEIGHT, rng, snake: body, food });
}

describe('the ramp step the renderer draws', () => {
  it('is rampStepFor(state) — the renderer maps a step to a name, it does not recompute one', () => {
    // Walked across the bands rather than asserted on one board: a renderer
    // that recomputed the step from the multiplier, or from the reachable
    // count against thresholds of its own, agrees on some lengths and not on
    // others. The whole range is the test.
    const seen = new Set();
    for (let n = 4; n < 420; n += 7) {
      const state = boardOfLength(n);
      const step = rampStepFor(state);
      seen.add(step);
      expect(rampFor(state).step, `length ${n}`).toBe(step);
      expect(rampFor(state).name).toBe(RAMP_NAMES[step]);
    }
    expect(seen.size).toBeGreaterThan(1); // the walk actually crossed a band
  });

  it('points at the token of its own step, so no hex is written in JS', () => {
    expect(RAMP_NAMES).toEqual(['calm', 'close', 'tight', 'hot', 'sealed']);
    for (const n of [4, 60, 200, 380, 430]) {
      const ramp = rampFor(boardOfLength(n, null));
      expect(ramp.token).toBe(`--ramp-${ramp.step}-${ramp.name}`);
    }
  });
});

describe('the readout strings', () => {
  it('carries the reachable count, the multiplier and the ramp step by name', () => {
    const state = boardOfLength(4);
    const strings = readoutStrings(state, { highScore: 120 });

    expect(strings.reachable).toBe(String(reachableFrom(state)));
    expect(strings.multiplier).toBe(`${multiplierFor(state)}×`);
    expect(strings.ramp).toBe(RAMP_NAMES[rampStepFor(state)]);
    expect(strings.length).toBe('4');
    expect(strings.score).toBe('0');
    expect(strings.highScore).toBe('120');
  });

  it('leaves the ramp and multiplier readable on a dead board rather than blanking them', () => {
    // The board a player wants to read is the one that just killed them.
    let state = createGame({
      width: WIDTH, height: HEIGHT, rng, snake: [at(0, 0), at(1, 0)], food: at(5, 5),
    });
    state = tick(state); // head at x=-1: wall death
    expect(state.status).toBe('dead');

    const strings = readoutStrings(state, { highScore: 0 });
    expect(strings.ramp).toBe(RAMP_NAMES[rampStepFor(state)]);
    expect(strings.reachable).toBe(String(reachableFrom(state)));
  });
});

describe('the game-over summary', () => {
  it('gives the ramp step by NAME, not only as an index', () => {
    // The point of the whole file. A summary that says "ramp step 4" hands a
    // colour-blind player the number and withholds the word.
    const path = serpentine(WIDTH, HEIGHT);
    const body = path.slice(0, 200).reverse();
    let state = createGame({ width: WIDTH, height: HEIGHT, rng, snake: body, food: null });
    const name = RAMP_NAMES[rampStepFor(state)];

    const summary = gameOverSummary(state);
    expect(summary).toContain(name);
    expect(summary).toMatch(/final score/i);
    expect(summary).toContain(String(state.snake.length));
    expect(summary).toContain(String(reachableFrom(state)));
    expect(summary).not.toMatch(/step \d/i); // a bare index is not the answer
  });
});

describe('the canvas aria-label', () => {
  // Updated on state transitions ONLY. Never per tick, and never in a live
  // region: a sentence read aloud every 140 ms is not information, it is a
  // denial of service on the screen reader.
  it('is byte-identical across two consecutive ticks with no transition between them', () => {
    const labeller = createAriaLabeller();
    let state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(7) });

    labeller.update(state, { paused: false });
    state = tick(state);
    const first = labeller.update(state, { paused: false });
    state = tick(state);
    const second = labeller.update(state, { paused: false });

    expect(first.changed).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.label).toBe(first.label);
    // Byte-identical, so nothing per-tick leaked into the sentence.
    expect(second.label).toBe(labeller.current);
    // And the sentence was produced once, at the start, not three times. This
    // is the count of writes the accessibility tree would have seen.
    expect(labeller.writes).toBe(1);
  });

  it('changes when the game dies, because that is a transition', () => {
    const labeller = createAriaLabeller();
    let state = createGame({
      width: WIDTH, height: HEIGHT, rng, snake: [at(0, 0), at(1, 0)], food: at(5, 5),
    });
    const before = labeller.update(state, { paused: false }).label;

    state = tick(state);
    const after = labeller.update(state, { paused: false });

    expect(state.status).toBe('dead');
    expect(after.changed).toBe(true);
    expect(after.label).not.toBe(before);
    expect(after.label).toMatch(/over|died|dead/i);
  });

  it('changes when the game pauses and changes back when it resumes', () => {
    const labeller = createAriaLabeller();
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(3) });

    const running = labeller.update(state, { paused: false }).label;
    const paused = labeller.update(state, { paused: true });
    expect(paused.changed).toBe(true);
    expect(paused.label).toMatch(/pause/i);

    const resumed = labeller.update(state, { paused: false });
    expect(resumed.changed).toBe(true);
    expect(resumed.label).toBe(running);
  });
});

describe('the non-writable hint', () => {
  // Phase 3 decided the store writes NOTHING while the stored record comes
  // from a newer build. Phase 5's job is to say so out loud.
  it('is produced for a record from a newer version of the game', () => {
    const storage = createFakeStorage({ 'coil.save': JSON.stringify({ version: 99 }) });
    const { writable } = load(storage);

    expect(writable).toBe(false);
    const hint = nonWritableHint(writable);
    expect(hint).toMatch(/not be saved/i);
    expect(hint).toMatch(/newer version/i);
    // It does not offer to overwrite the newer install's data.
    expect(hint).not.toMatch(/overwrite|reset|clear|erase/i);
  });

  it('is absent when the record is writable', () => {
    const storage = createFakeStorage();
    const { writable } = load(storage);

    expect(writable).toBe(true);
    expect(nonWritableHint(writable)).toBe(null);
  });
});
