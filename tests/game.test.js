import { describe, it, expect } from 'vitest';
import { createGame, enqueueTurn, tick, directionNames } from '../src/core/game.js';

const WIDTH = 24;
const HEIGHT = 18;

// Deterministic generator, kept in the test file so nothing in src/ depends on
// it and no dependency is added.
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const REVERSE = { up: 'down', down: 'up', left: 'right', right: 'left' };

const at = (x, y) => ({ x, y });
const key = (c) => c.x + ',' + c.y;
const head = (state) => state.snake[0];

// A boustrophedon path over the whole board: every cell once, each adjacent to
// the next, so any prefix of it is a legal snake with snake[0] as the head.
function serpentine(width, height) {
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width; i++) {
      cells.push(at(y % 2 === 0 ? i : width - 1 - i, y));
    }
  }
  return cells;
}

// Drops rng, which is a closure and cannot be compared across two games.
const snapshot = (state) => JSON.parse(JSON.stringify(state));

// Steers at the food, refusing moves that leave the board or hit the body.
// Conservative about the tail, which only costs it the occasional legal move.
function chooseDirection(state) {
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

function playTicks(state, count) {
  let s = state;
  for (let i = 0; i < count; i++) s = tick(enqueueTurn(s, chooseDirection(s)));
  return s;
}

describe('the turn queue', () => {
  it('moves a right-moving snake up then left when both are given inside one tick, without ever entering its own neck', () => {
    const start = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(1) });
    expect(start.direction).toBe('right');
    const startHead = head(start);

    const queued = enqueueTurn(enqueueTurn(start, 'up'), 'left');
    expect(queued.turns).toEqual(['up', 'left']);

    const afterUp = tick(queued);
    expect(head(afterUp)).toEqual(at(startHead.x, startHead.y - 1));

    const afterLeft = tick(afterUp);
    expect(head(afterLeft)).toEqual(at(startHead.x - 1, startHead.y - 1));

    // The neck is the segment behind the head. Reversal would put the head on
    // it, which shows up as a duplicated cell.
    for (const state of [afterUp, afterLeft]) {
      expect(new Set(state.snake.map(key)).size).toBe(state.snake.length);
      expect(head(state)).not.toEqual(state.snake[1]);
    }
    expect(afterLeft.status).toBe('playing');
  });

  it('drops a third turn given in the same tick and never holds more than two', () => {
    const start = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(2) });
    const two = enqueueTurn(enqueueTurn(start, 'up'), 'left');
    expect(two.turns).toEqual(['up', 'left']);

    // 'down' is legal against the last queued 'left', so only the cap can
    // reject it.
    const three = enqueueTurn(two, 'down');
    expect(three.turns).toEqual(['up', 'left']);
    expect(three.turns.length).toBe(2);
  });

  it('rejects a turn opposite the last queued direction even when it is legal against the current heading', () => {
    const start = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(3) });
    const up = enqueueTurn(start, 'up');
    expect(up.turns).toEqual(['up']);

    // 'down' is not opposite 'right', the heading, so a check against the
    // heading would wrongly accept it.
    const rejected = enqueueTurn(up, 'down');
    expect(rejected.turns).toEqual(['up']);
  });
});

describe('the tail-vacate rule', () => {
  // Head (1,1), then (1,2), (2,2), tail (2,1): a closed square, so one turn
  // puts the head onto the tail cell.
  const coiled = [at(1, 1), at(1, 2), at(2, 2), at(2, 1)];

  it('survives the head entering the tail cell, because the tail vacates on the same tick', () => {
    const state = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(4),
      snake: coiled, food: at(20, 15),
    });
    expect(state.direction).toBe('up');
    expect(state.pendingGrowth).toBe(0);

    const moved = tick(enqueueTurn(state, 'right'));
    expect(moved.status).toBe('playing');
    expect(head(moved)).toEqual(at(2, 1));
    expect(moved.snake.length).toBe(4);
  });

  it('dies when the head enters the tail cell on a tick where the tail was held by an eat', () => {
    // One tick earlier, positioned so eating lands the snake in `coiled`.
    const state = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(5),
      snake: [at(1, 2), at(2, 2), at(2, 1), at(3, 1)], food: at(1, 1),
    });
    expect(state.direction).toBe('left');

    const eaten = tick(enqueueTurn(state, 'up'));
    expect(eaten.foodEaten).toBe(1);
    expect(eaten.snake).toEqual(coiled);
    expect(eaten.pendingGrowth).toBe(1);

    // (2,1) is under the snake, so the replacement food cannot sit there.
    const dead = tick(enqueueTurn(eaten, 'right'));
    expect(dead.status).toBe('dead');
  });
});

describe('growth', () => {
  it('leaves a snake of length 4 at 4 on the tick it eats and takes it to 5 on the next tick', () => {
    const state = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(6),
      snake: [at(5, 5), at(4, 5), at(3, 5), at(2, 5)], food: at(6, 5),
    });
    expect(state.snake.length).toBe(4);

    const eaten = tick(state);
    expect(eaten.foodEaten).toBe(1);
    expect(eaten.snake.length).toBe(4);

    const grown = tick(eaten);
    expect(grown.snake.length).toBe(5);
  });
});

describe('food spawning', () => {
  it('never places food on a cell the snake occupies, across 500 spawns from one seeded rng', () => {
    const rng = mulberry32(20260909);
    const path = serpentine(WIDTH, HEIGHT);
    let spawns = 0;

    for (let i = 0; i < 500; i++) {
      // Vary occupancy so the free-cell set differs on every spawn.
      const snake = path.slice(0, 4 + (i % 400));
      const state = createGame({ width: WIDTH, height: HEIGHT, rng, snake });
      expect(state.food).not.toBeNull();
      expect(new Set(snake.map(key)).has(key(state.food))).toBe(false);
      spawns++;
    }
    expect(spawns).toBe(500);
  });

  it('places food in the only free cell when exactly one remains, whatever the rng returns', () => {
    const path = serpentine(WIDTH, HEIGHT);
    const snake = path.slice(0, path.length - 1);
    const onlyFree = path[path.length - 1];

    for (const rng of [() => 0, () => 0.5, () => 0.999999]) {
      const state = createGame({ width: WIDTH, height: HEIGHT, rng, snake });
      expect(state.food).toEqual(onlyFree);
      expect(state.status).toBe('playing');
    }
  });

  it('reports a win with zero free cells, and ticks without looping or throwing', () => {
    const path = serpentine(WIDTH, HEIGHT);
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(8), snake: path });

    expect(state.snake.length).toBe(WIDTH * HEIGHT);
    expect(state.status).toBe('won');
    expect(state.food).toBeNull();

    let ticked;
    expect(() => { ticked = tick(state); }).not.toThrow();
    expect(ticked).toBe(state);
    expect(ticked.status).toBe('won');
  });
});

describe('walls', () => {
  const cases = [
    ['x=0 moving left', [at(0, 5), at(1, 5), at(2, 5), at(3, 5)], 'left'],
    ['x=width-1 moving right', [at(WIDTH - 1, 5), at(WIDTH - 2, 5), at(WIDTH - 3, 5), at(WIDTH - 4, 5)], 'right'],
    ['y=0 moving up', [at(5, 0), at(5, 1), at(5, 2), at(5, 3)], 'up'],
    ['y=height-1 moving down', [at(5, HEIGHT - 1), at(5, HEIGHT - 2), at(5, HEIGHT - 3), at(5, HEIGHT - 4)], 'down'],
  ];

  for (const [name, snake, direction] of cases) {
    it('kills a head at ' + name, () => {
      const state = createGame({
        width: WIDTH, height: HEIGHT, rng: mulberry32(9), snake, food: at(12, 9),
      });
      expect(state.direction).toBe(direction);
      expect(tick(state).status).toBe('dead');
    });
  }
});

describe('a finished game', () => {
  it('returns the identical state from tick when the snake is already dead', () => {
    const state = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(10),
      snake: [at(0, 5), at(1, 5), at(2, 5), at(3, 5)], food: at(12, 9),
    });
    const dead = tick(state);
    expect(dead.status).toBe('dead');

    const again = tick(dead);
    expect(again).toBe(dead);
    expect(snapshot(again)).toEqual(snapshot(dead));
  });
});

describe('determinism', () => {
  it('produces identical states after 200 ticks for two games sharing a seed and an input sequence', () => {
    const a = playTicks(createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(4242) }), 200);
    const b = playTicks(createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(4242) }), 200);

    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.foodEaten).toBeGreaterThan(0); // the rng was actually exercised
  });
});

describe('the stop point', () => {
  it('plays a whole game to completion by calling tick in a loop', () => {
    let state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(77) });
    let ticks = 0;
    const limit = 50000;

    while (state.status === 'playing' && ticks < limit) {
      state = tick(enqueueTurn(state, chooseDirection(state)));
      ticks++;
    }

    expect(ticks).toBeLessThan(limit);
    expect(['dead', 'won']).toContain(state.status);
    expect(state.foodEaten).toBeGreaterThan(0);
    expect(new Set(state.snake.map(key)).size).toBe(state.snake.length);
  });
});
