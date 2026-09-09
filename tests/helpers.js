// Shared test helpers. Nothing here is imported by src/; the seeded generator
// lives on this side of the line so no dependency is added and src/core stays
// free of randomness it did not have injected.

import { tick, enqueueTurn, directionNames } from '../src/core/game.js';

export const WIDTH = 24;
export const HEIGHT = 18;
export const TOTAL = WIDTH * HEIGHT;

export function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const REVERSE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export const at = (x, y) => ({ x, y });
export const key = (c) => c.x + ',' + c.y;
export const head = (state) => state.snake[0];

// A boustrophedon path over the whole board: every cell once, each adjacent to
// the next, so any prefix of it is a legal snake with snake[0] as the head.
export function serpentine(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width; i++) {
      cells.push(at(y % 2 === 0 ? i : width - 1 - i, y));
    }
  }
  return cells;
}

// Drops rng, which is a closure and cannot be compared across two games.
export const snapshot = (state) => JSON.parse(JSON.stringify(state));

// Steers at the food, refusing moves that leave the board or hit the body.
// Conservative about the tail, which only costs it the occasional legal move.
export function chooseDirection(state) {
  const h = head(state);
  const target = state.food === null ? h : state.food;
  const dx = target.x - h.x;
  const dy = target.y - h.y;
  const horizontal = dx > 0 ? 'right' : dx < 0 ? 'left' : null;
  const vertical = dy > 0 ? 'down' : dy < 0 ? 'up' : null;
  const preferred = Math.abs(dx) >= Math.abs(dy)
    ? [horizontal, vertical]
    : [vertical, horizontal];
  const order = [...preferred, ...directionNames].filter(
    (d, i, all) => d !== null && all.indexOf(d) === i,
  );

  const occupied = new Set(state.snake.map(key));
  for (const name of order) {
    if (name === REVERSE[state.direction]) continue;
    const [sx, sy] = STEP[name];
    const nx = h.x + sx;
    const ny = h.y + sy;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
    if (occupied.has(nx + ',' + ny)) continue;
    return name;
  }
  return state.direction; // cornered - keep going and take the death
}

export function playTicks(state, count) {
  let s = state;
  for (let i = 0; i < count; i++) s = tick(enqueueTurn(s, chooseDirection(s)));
  return s;
}

// A stand-in for localStorage. Phase 3 asserts reload behaviour against this;
// the real localStorage is never touched from a test, and nothing in src/
// reaches for it — the storage object is always passed in explicitly.
//
// `peek` reads a key without touching the counters, so a test can assert the
// bytes on disk without changing what it is measuring.
export function createFakeStorage(seed = {}) {
  const cells = new Map(Object.entries(seed));

  const storage = {
    getCalls: 0,
    setCalls: 0,
    removeCalls: 0,
    // Set to an Error to make every setItem throw, the way a quota-exceeded
    // or private-mode write does.
    throwOnSet: null,

    getItem(k) {
      storage.getCalls++;
      return cells.has(k) ? cells.get(k) : null;
    },
    setItem(k, v) {
      storage.setCalls++;
      if (storage.throwOnSet) throw storage.throwOnSet;
      cells.set(k, String(v));
    },
    removeItem(k) {
      storage.removeCalls++;
      cells.delete(k);
    },

    peek(k) {
      return cells.has(k) ? cells.get(k) : null;
    },
  };

  return storage;
}
