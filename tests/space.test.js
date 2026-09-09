import { describe, it, expect } from 'vitest';
import {
  createGame,
  tick,
  enqueueTurn,
  tailHeldOnNextMove,
  reachableFrom,
  multiplierFor,
  tickIntervalFor,
  rampStepFor,
} from '../src/core/game.js';

import {
  WIDTH,
  HEIGHT,
  TOTAL,
  mulberry32,
  at,
  serpentine,
  chooseDirection,
} from './helpers.js';

const PATH = serpentine(WIDTH, HEIGHT);

// Far from every hand-built position below, so the move about to happen never
// lands on it and the tail is never held by accident.
const FAR_FOOD = at(20, 15);

const build = (overrides) => createGame({
  width: WIDTH, height: HEIGHT, rng: mulberry32(31), ...overrides,
});

// The snake laid along the boustrophedon path with its head at the far end, so
// the free cells are the unfilled remainder of the path — one connected
// region whose size is set by `length`. The tail sits at (0,0), walled in by
// the body for any length past the first row and a bit, so it contributes
// nothing to the count.
function corridor(length, food = PATH[PATH.length - 1]) {
  return build({ snake: PATH.slice(0, length).reverse(), food });
}

// A full-height wall of body at x = c, with the head at (c-1, 0) on its left.
// The head can reach exactly the c columns left of the wall, less its own
// cell, so reachable is 18c - 1. The two cells past the foot of the wall park
// the tail on the far side, where vacating cannot reopen the split.
//
// Length is 21 for every c. That is the whole point of this shape: it moves
// reachable space without moving length, which is the only way to test a
// multiplier that depends on both.
function walled(c) {
  const snake = [at(c - 1, 0)];
  for (let y = 0; y < HEIGHT; y++) snake.push(at(c, y));
  snake.push(at(c + 1, HEIGHT - 1));
  snake.push(at(c + 2, HEIGHT - 1));
  return build({ snake, food: at(0, HEIGHT - 1) });
}

// Same 21 segments, laid flat along the top row, sealing nothing.
const openBoard = () => build({
  snake: PATH.slice(0, 21).reverse(),
  food: PATH[PATH.length - 1],
});

// Head at (1,1), walled into the top-left corner by its own body. The tail is
// out at (5,0), well clear of the pocket, so vacating cannot open it.
const POCKET_SNAKE = [
  at(1, 1), at(1, 2), at(0, 2), at(0, 3), at(1, 3), at(2, 3),
  at(2, 2), at(2, 1), at(2, 0), at(3, 0), at(4, 0), at(5, 0),
];

// A ring around (6,6) broken only at (5,5), where the head sits. Every
// orthogonal neighbour of (6,6) is body, so four-way adjacency cannot reach
// it and eight-way could. The tail is at (6,3), outside the ring.
const DIAGONAL_SNAKE = [
  at(5, 5), at(5, 6), at(5, 7), at(6, 7), at(7, 7),
  at(7, 6), at(7, 5), at(6, 5), at(6, 4), at(6, 3),
];

// Head at (0,5) flat against the left wall with body on the other three
// sides. The tail is at (0,8), two cells clear, so it cannot open a way out.
const ENCLOSED_SNAKE = [
  at(0, 5), at(0, 4), at(1, 4), at(1, 5), at(1, 6), at(0, 6), at(0, 7), at(0, 8),
];

describe('reachable space', () => {
  it('reaches every free cell from a snake in the centre of an empty board', () => {
    const state = build({ food: at(2, 2) });
    expect(state.snake.length).toBe(4);
    expect(tailHeldOnNextMove(state)).toBe(false);

    // The +1 is the tail. It vacates as the head moves, so it is not blocking
    // and it is one more cell the head can move into.
    expect(reachableFrom(state)).toBe(TOTAL - state.snake.length + 1);
    expect(reachableFrom(state)).toBe(429);
  });

  it('returns exactly 3 for a head sealed into a three-cell pocket by its own body', () => {
    const state = build({ snake: POCKET_SNAKE, food: FAR_FOOD });
    expect(state.direction).toBe('up');
    expect(tailHeldOnNextMove(state)).toBe(false);
    expect(reachableFrom(state)).toBe(3); // (0,0), (0,1), (1,0)
  });

  it('counts the tail cell when the move about to happen does not land on the food', () => {
    const state = build({ food: at(2, 2) });
    expect(tailHeldOnNextMove(state)).toBe(false);
    expect(reachableFrom(state)).toBe(429);
  });

  it('does not count the tail cell when the move about to happen lands the head on the food', () => {
    // Same snake as above; only the food moves, onto the cell the head is
    // about to enter, so the tail is held and stops being free space.
    const eating = build({ food: at(14, 9) });
    const notEating = build({ food: at(2, 2) });

    expect(tailHeldOnNextMove(eating)).toBe(true);
    expect(eating.snake).toEqual(notEating.snake);
    expect(reachableFrom(eating)).toBe(428);
    expect(reachableFrom(notEating) - reachableFrom(eating)).toBe(1);
  });

  it('does not count a pocket reachable only diagonally, because adjacency is four-way', () => {
    const state = build({ snake: DIAGONAL_SNAKE, food: FAR_FOOD });
    expect(tailHeldOnNextMove(state)).toBe(false);

    // Nine blocking segments (the tail vacates), and (6,6) sits inside the
    // ring touching the head's region only at the corner.
    const blocked = state.snake.length - 1;
    expect(reachableFrom(state)).toBe(TOTAL - blocked - 1);
    expect(reachableFrom(state)).toBe(422);
  });

  it('returns 0 for a head against a wall with body on the other three sides, and reads slack 0 as 5x', () => {
    const state = build({ snake: ENCLOSED_SNAKE, food: FAR_FOOD });
    expect(state.direction).toBe('down');
    expect(reachableFrom(state)).toBe(0);

    // slack = 0 / 8. Length is never zero, so the division is safe.
    expect(state.snake.length).toBe(8);
    expect(reachableFrom(state) / state.snake.length).toBe(0);
    expect(multiplierFor(state)).toBe(5);
    expect(rampStepFor(state)).toBe(4);
  });

  it('leaves the state it was given untouched', () => {
    const state = build({ snake: POCKET_SNAKE, food: FAR_FOOD });
    const { rng, ...cloneable } = state;
    const before = structuredClone(cloneable);

    reachableFrom(state);
    multiplierFor(state);
    rampStepFor(state);

    const { rng: unused, ...after } = state;
    expect(after).toEqual(before);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('fills a full 24 by 18 board iteratively, and a board far past any recursion limit', () => {
    // Every cell taken: nowhere to go, and no throw.
    const full = build({ snake: PATH });
    expect(full.snake.length).toBe(TOTAL);
    expect(reachableFrom(full)).toBe(0);

    // The widest fill this board allows.
    const open = build({ food: at(2, 2) });
    expect(reachableFrom(open)).toBe(429);

    // 90,000 cells. A recursive fill would run ~90,000 frames deep and blow
    // the stack; an explicit stack does not care.
    const huge = createGame({ width: 300, height: 300, rng: mulberry32(2), food: at(0, 0) });
    expect(reachableFrom(huge)).toBe(300 * 300 - 3);
  });
});

describe('the multiplier', () => {
  it('is 1 on a fresh board, where slack is 107.25', () => {
    const state = build({ food: at(2, 2) });
    expect(reachableFrom(state)).toBe(429);
    expect(state.snake.length).toBe(4);
    expect(reachableFrom(state) / state.snake.length).toBe(107.25);
    expect(multiplierFor(state)).toBe(1);
  });

  it('never decreases as reachable space shrinks with the snake length held constant', () => {
    // Only the wall moves. Every board here is 21 segments, so nothing in the
    // sequence can be explained by the snake getting longer.
    const states = [walled(10), walled(6), walled(3), walled(2), walled(1)];
    for (const state of states) expect(state.snake.length).toBe(21);

    const reachable = states.map(reachableFrom);
    const multipliers = states.map(multiplierFor);

    expect(reachable).toEqual([179, 107, 53, 35, 17]);
    for (let i = 1; i < reachable.length; i++) {
      expect(reachable[i]).toBeLessThan(reachable[i - 1]);
      expect(multipliers[i]).toBeGreaterThanOrEqual(multipliers[i - 1]);
    }

    // A sequence that never leaves 1x would satisfy "never decreases" while
    // proving nothing, so pin the band it actually walks.
    expect(multipliers).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives a coiled snake and an open snake of the same length different multipliers', () => {
    const open = openBoard();
    const coiled = walled(1);

    // Identical length. Anything that differs below is confinement, not size.
    expect(open.snake.length).toBe(21);
    expect(coiled.snake.length).toBe(21);

    expect(reachableFrom(open)).toBe(412);
    expect(reachableFrom(coiled)).toBe(17);

    expect(multiplierFor(open)).toBe(1);
    expect(multiplierFor(coiled)).toBe(5);
    expect(multiplierFor(coiled)).toBeGreaterThan(multiplierFor(open));
  });

  it('returns a ramp step of 0 to 4 that is exactly the multiplier minus one, across all five bands', () => {
    const states = [walled(10), walled(6), walled(3), walled(2), walled(1)];
    const steps = states.map(rampStepFor);

    for (const state of states) {
      expect(rampStepFor(state)).toBe(multiplierFor(state) - 1);
    }
    expect(steps).toEqual([0, 1, 2, 3, 4]);
    for (const step of steps) {
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(4);
    }
  });
});

describe('scoring', () => {
  it('awards 10 times the multiplier from before the food was consumed, not after', () => {
    // 144 segments with 288 reachable is slack 2.0 exactly, the bottom edge of
    // the 3x band. Eating makes it 287 over 145, which is 1.979 and drops into
    // 4x. The two multipliers therefore differ, and reading the wrong one
    // shows up as 40 rather than 30.
    //
    // The path turns a row here, so the heading has to be steered onto the
    // food rather than simply continuing.
    const before = enqueueTurn(corridor(144, PATH[144]), 'down');
    expect(before.food).toEqual(at(0, 6));
    expect(tailHeldOnNextMove(before)).toBe(true);
    expect(before.snake.length).toBe(144);
    expect(reachableFrom(before)).toBe(288);
    expect(reachableFrom(before) / before.snake.length).toBe(2);
    expect(multiplierFor(before)).toBe(3);
    expect(before.score).toBe(0);

    const after = tick(before);
    expect(after.foodEaten).toBe(1);
    expect(after.snake.length).toBe(145);
    expect(reachableFrom(after)).toBe(287);
    expect(multiplierFor(after)).toBe(4);

    expect(after.score).toBe(before.score + 10 * 3);
    expect(after.score).toBe(30);
  });
});

describe('tick interval', () => {
  it('starts at 140, is 134 after one food, and floors at 70 instead of falling below it', () => {
    // Real states from a played game rather than hand-set counters.
    const seen = new Map();
    let state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(77) });
    let ticks = 0;
    while (state.status === 'playing' && ticks < 50000) {
      if (!seen.has(state.foodEaten)) seen.set(state.foodEaten, tickIntervalFor(state));
      state = tick(enqueueTurn(state, chooseDirection(state)));
      ticks++;
    }

    expect(seen.get(0)).toBe(140);
    expect(seen.get(1)).toBe(134);
    expect(seen.get(11)).toBe(74); // 140 - 66, the last step above the floor
    expect(seen.get(12)).toBe(70); // 140 - 72 would be 68
    expect(seen.get(20)).toBe(70); // and it stays there
  });
});
