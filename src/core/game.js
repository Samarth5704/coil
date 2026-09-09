// Coil — the pure tick engine.
//
// Nothing here touches the DOM, Date.now(), Math.random(), localStorage or a
// global, and this file imports nothing from outside src/core/. Randomness
// arrives only as the rng() injected into createGame, which must return a
// float in [0, 1).

const START_LENGTH = 4;
const MAX_QUEUED_TURNS = 2;

const SCORE_PER_FOOD = 10;
const MIN_MULTIPLIER = 1;
const MAX_MULTIPLIER = 5;

// Slack is reachable space per segment: how many cells of room the snake has
// for each cell of itself. The lowest slack that still earns each multiplier,
// in order, so 1x needs eight cells of room per segment and anything under one
// cell per segment falls off the end at 5x.
const SLACK_FLOORS = [8, 4, 2, 1];

const BASE_TICK_MS = 140;
const TICK_STEP_MS = 6;
const MIN_TICK_MS = 70;

// The four directions live here rather than in src/core/directions.js. Four
// vectors, an opposite table and one lookup is a paragraph, not a module.
const STEP = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export const directionNames = Object.freeze(Object.keys(STEP));

function cell(x, y) {
  return Object.freeze({ x, y });
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function onBoard(c, width, height) {
  return Number.isInteger(c.x) && Number.isInteger(c.y)
    && c.x >= 0 && c.y >= 0 && c.x < width && c.y < height;
}

// The heading a snake must have been travelling on to put `head` in front of
// `neck`. Lets a caller hand in a board position without also restating the
// direction, and keeps the two from ever disagreeing.
function headingFrom(head, neck) {
  const dx = head.x - neck.x;
  const dy = head.y - neck.y;
  for (const name of directionNames) {
    if (STEP[name].x === dx && STEP[name].y === dy) return name;
  }
  return null;
}

function startingSnake(width, height) {
  // Centred horizontally, facing right, so the head leads.
  const y = Math.floor(height / 2);
  const tailX = Math.floor((width - START_LENGTH) / 2);
  const body = [];
  for (let i = START_LENGTH - 1; i >= 0; i--) body.push(cell(tailX + i, y));
  return body;
}

// Every snake is checked, crafted or not, so a board too small for the
// starting length is rejected here rather than producing a snake in the wall.
function validateSnake(body, width, height) {
  if (body.length === 0) {
    throw new RangeError('a snake cannot be empty');
  }
  if (body.length < 2) {
    throw new RangeError(
      'a snake needs at least two segments, so its heading can be read from the head and its neck',
    );
  }

  const seen = new Set();
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (!onBoard(c, width, height)) {
      throw new RangeError(
        `snake segment ${i} at (${c.x}, ${c.y}) is off a ${width} by ${height} board`,
      );
    }
    const at = c.y * width + c.x;
    if (seen.has(at)) {
      throw new RangeError(`snake segment ${i} repeats the cell (${c.x}, ${c.y})`);
    }
    seen.add(at);

    if (i > 0) {
      const previous = body[i - 1];
      const gap = Math.abs(c.x - previous.x) + Math.abs(c.y - previous.y);
      if (gap !== 1) {
        throw new RangeError(
          `snake segments ${i - 1} at (${previous.x}, ${previous.y}) and ${i} at `
          + `(${c.x}, ${c.y}) are not four-way adjacent`,
        );
      }
    }
  }
}

function validateFood(food, body, width, height) {
  if (!onBoard(food, width, height)) {
    throw new RangeError(
      `food at (${food.x}, ${food.y}) is off a ${width} by ${height} board`,
    );
  }
  for (const c of body) {
    if (sameCell(c, food)) {
      throw new RangeError(`food at (${food.x}, ${food.y}) lands on the snake`);
    }
  }
}

function freeCells(width, height, snake) {
  const taken = new Set();
  for (const c of snake) taken.add(c.y * width + c.x);
  const free = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!taken.has(y * width + x)) free.push(cell(x, y));
    }
  }
  return free;
}

// Enumerate the free cells and index into them. Never rejection sampling:
// `while (occupied) pick()` is unbounded and hangs on a nearly full board.
// Returns null when there is nowhere left to put food, which the caller reads
// as the win.
function spawnFood(width, height, snake, rng) {
  const free = freeCells(width, height, snake);
  if (free.length === 0) return null;
  const i = Math.floor(rng() * free.length);
  return free[i < 0 ? 0 : i >= free.length ? free.length - 1 : i];
}

function makeState(fields) {
  const state = { ...fields };
  Object.freeze(state.snake);
  Object.freeze(state.turns);
  return Object.freeze(state);
}

// `snake` and `food` are setup overrides for tests, which need board positions
// that would take hundreds of ticks to reach by playing and, in the case of a
// single free cell, cannot be reached by playing at all. Both are validated on
// the way in; see docs/spec.md, phase 1. Omit both for a real game.
export function createGame({ width = 24, height = 18, rng, snake, food } = {}) {
  if (typeof rng !== 'function') {
    throw new TypeError('createGame needs an rng() returning a float in [0, 1)');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('createGame needs a positive integer width and height');
  }

  const body = snake
    ? snake.map((c) => cell(c.x, c.y))
    : startingSnake(width, height);
  validateSnake(body, width, height);

  let placed;
  if (food === undefined) {
    placed = spawnFood(width, height, body, rng);
  } else if (food === null) {
    placed = null;
  } else {
    placed = cell(food.x, food.y);
    validateFood(placed, body, width, height);
  }

  return makeState({
    width,
    height,
    snake: body,
    // validateSnake has already proved the head and neck are adjacent, so this
    // cannot come back null.
    direction: headingFrom(body[0], body[1]),
    turns: [],
    food: placed,
    foodEaten: 0,
    // An accumulation, not a derivation — there is no way to recover it from
    // a board, so unlike the multiplier and the reachable count it is stored.
    score: 0,
    status: placed === null ? 'won' : 'playing',
    rng,
  });
}

// The heading the next tick will use: the queued turn if one is waiting,
// otherwise the current one. Derived, never stored.
export function pendingDirection(state) {
  return state.turns.length > 0 ? state.turns[0] : state.direction;
}

// The cell the head will occupy after the next tick. May be off the board;
// that is the wall death, and the caller checks for it.
export function nextHead(state) {
  const step = STEP[pendingDirection(state)];
  return cell(state.snake[0].x + step.x, state.snake[0].y + step.y);
}

// True when the move about to happen will land the head on the food. Growth is
// immediate, so that is exactly the move on which the tail is not popped, and
// therefore exactly the move through which the cell the tail sits in stays
// occupied instead of being vacated under the arriving head.
//
// The tense matters. Called from a settled state — which is where the phase 2
// flood fill runs — this asks about the move that has not happened yet, so it
// is named for the next move rather than for the current tick. Called from
// inside tick(), the next move is the one being executed, and the answer is
// the same. tick() calls this function rather than restating the rule, so the
// engine and the flood fill can never drift apart.
export function tailHeldOnNextMove(state) {
  if (state.status !== 'playing' || state.food === null) return false;
  return sameCell(nextHead(state), state.food);
}

export function enqueueTurn(state, direction) {
  if (state.status !== 'playing') return state;
  if (!Object.prototype.hasOwnProperty.call(STEP, direction)) return state;
  if (state.turns.length >= MAX_QUEUED_TURNS) return state;

  // Validated against the LAST QUEUED direction, not the current heading. A
  // right-moving snake given Up then Left would otherwise have Left measured
  // against Right, find it legal, and reverse into its own neck.
  const reference = state.turns.length > 0
    ? state.turns[state.turns.length - 1]
    : state.direction;
  if (direction === OPPOSITE[reference]) return state;

  return makeState({ ...state, turns: [...state.turns, direction] });
}

export function tick(state) {
  if (state.status !== 'playing') return state;

  // One entry drained per tick.
  const direction = pendingDirection(state);
  const turns = state.turns.length > 0 ? state.turns.slice(1) : state.turns;
  const head = nextHead(state);

  if (!onBoard(head, state.width, state.height)) {
    return makeState({ ...state, direction, turns, status: 'dead' });
  }

  // Growth is immediate: on the tick the head reaches the food the tail is not
  // popped, so the snake is one longer at the end of that same tick.
  const ate = tailHeldOnNextMove(state);

  const last = state.snake.length - 1;
  for (let i = 0; i < state.snake.length; i++) {
    // The tail vacates as the head moves, so the head may legally take its
    // cell — except on an eating move, when the tail stays put.
    //
    // The `!ate` term is dead today, and one invariant is what kills it: food
    // never spawns on an occupied cell, asserted by the "never places food on
    // a cell the snake occupies" case over 500 seeded spawns, and enforced for
    // crafted boards by validateFood. Reaching this branch needs the food and
    // the tail on one cell, so that case is the test you would have to break
    // to get here. It stays because it is the rule, and because dropping it
    // would leave the loop silently wrong the moment food placement changes.
    if (i === last && !ate) continue;
    if (sameCell(state.snake[i], head)) {
      return makeState({ ...state, direction, turns, status: 'dead' });
    }
  }

  const body = [head, ...(ate ? state.snake : state.snake.slice(0, last))];
  const food = ate ? spawnFood(state.width, state.height, body, state.rng) : state.food;

  return makeState({
    ...state,
    snake: body,
    direction,
    turns,
    food,
    foodEaten: state.foodEaten + (ate ? 1 : 0),
    // The multiplier is read from `state`, the board as it stood before the
    // food was taken. Reading it from the board afterwards would pay out at
    // the confinement the apple itself caused, not the confinement the player
    // accepted in going for it.
    score: state.score + (ate ? SCORE_PER_FOOD * multiplierFor(state) : 0),
    status: food === null ? 'won' : 'playing',
  });
}

// ---------------------------------------------------------------------------
// Confinement, scoring and speed.
//
// All derived, all computed on demand, none of it stored. `tick` calls
// multiplierFor above; function declarations hoist, so the order here is for
// reading rather than for the loader.
// ---------------------------------------------------------------------------

// Free cells the head can reach by four-way adjacency, with the body blocking.
// The tail is blocking only when it is about to be held — read from
// tailHeldOnNextMove rather than restated, so this and `tick` cannot disagree
// about which move that is.
//
// Iterative, with an explicit stack. A recursive fill would run one frame per
// cell and overflow on any board of consequence.
export function reachableFrom(state) {
  const { width, height, snake } = state;
  const size = width * height;

  const blocked = new Uint8Array(size);
  const tailHeld = tailHeldOnNextMove(state);
  const last = snake.length - 1;
  for (let i = 0; i < snake.length; i++) {
    if (i === last && !tailHeld) continue; // vacates as the head arrives
    blocked[snake[i].y * width + snake[i].x] = 1;
  }

  const seen = new Uint8Array(size);
  const start = snake[0].y * width + snake[0].x;
  seen[start] = 1; // the head's own cell is where we stand, not room we have
  const stack = [start];
  let count = 0;

  while (stack.length > 0) {
    const from = stack.pop();
    const x = from % width;
    const y = (from - x) / width;

    if (x > 0) count += visit(from - 1, blocked, seen, stack);
    if (x < width - 1) count += visit(from + 1, blocked, seen, stack);
    if (y > 0) count += visit(from - width, blocked, seen, stack);
    if (y < height - 1) count += visit(from + width, blocked, seen, stack);
  }

  return count;
}

function visit(at, blocked, seen, stack) {
  if (seen[at] || blocked[at]) return 0;
  seen[at] = 1;
  stack.push(at);
  return 1;
}

// Scaled by the snake's own length, not by the board. Dividing by board area
// made this a length meter in disguise: on an open 432-cell board it took 120
// segments to leave 1x, so a hundred-segment run scored exactly as flat as a
// four-segment one no matter how the player was playing.
export function multiplierFor(state) {
  const length = state.snake.length;
  if (length < 1) {
    // validateSnake requires two segments, so no state built through
    // createGame can reach this. Asserted rather than assumed, because the
    // whole measure divides by it.
    throw new RangeError('multiplierFor needs a snake of at least one segment');
  }

  const slack = reachableFrom(state) / length;
  let multiplier = MIN_MULTIPLIER;
  for (const floor of SLACK_FLOORS) {
    if (slack >= floor) return multiplier;
    multiplier++;
  }
  return MAX_MULTIPLIER;
}

export function tickIntervalFor(state) {
  return Math.max(MIN_TICK_MS, BASE_TICK_MS - TICK_STEP_MS * state.foodEaten);
}

// Five ramp steps against five multipliers, one each. An earlier four-step
// ramp collapsed 4x and 5x into one colour, which spent the distinction at
// exactly the point in a run where it carries the most information.
export function rampStepFor(state) {
  return multiplierFor(state) - 1;
}
