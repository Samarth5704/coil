// Coil — the pure tick engine.
//
// Nothing here touches the DOM, Date.now(), Math.random(), localStorage or a
// global, and this file imports nothing from outside src/core/. Randomness
// arrives only as the rng() injected into createGame, which must return a
// float in [0, 1).

const START_LENGTH = 4;
const MAX_QUEUED_TURNS = 2;

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

// `snake` and `food` are setup overrides, used by tests to stand the board up
// in a position that would take hundreds of ticks to reach by playing. Omit
// both for a real game.
export function createGame({ width = 24, height = 18, rng, snake, food } = {}) {
  if (typeof rng !== 'function') {
    throw new TypeError('createGame needs an rng() returning a float in [0, 1)');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('createGame needs a positive integer width and height');
  }

  const body = snake ? snake.map((c) => cell(c.x, c.y)) : startingSnake(width, height);
  if (body.length === 0) throw new RangeError('a snake needs at least one segment');

  const direction = body.length > 1 ? headingFrom(body[0], body[1]) : 'right';
  if (direction === null) throw new RangeError('the first two snake segments are not adjacent');

  const placed = food === undefined
    ? spawnFood(width, height, body, rng)
    : food === null ? null : cell(food.x, food.y);

  return makeState({
    width,
    height,
    snake: body,
    direction,
    turns: [],
    food: placed,
    foodEaten: 0,
    // Set on the tick that eats; spent on the tick after, which is the tick
    // the snake actually lengthens on and the tick its tail stays put.
    pendingGrowth: 0,
    status: placed === null ? 'won' : 'playing',
    rng,
  });
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
  const direction = state.turns.length > 0 ? state.turns[0] : state.direction;
  const turns = state.turns.length > 0 ? state.turns.slice(1) : state.turns;

  const step = STEP[direction];
  const head = cell(state.snake[0].x + step.x, state.snake[0].y + step.y);

  if (head.x < 0 || head.y < 0 || head.x >= state.width || head.y >= state.height) {
    return makeState({ ...state, direction, turns, status: 'dead' });
  }

  // The tail is held on a tick that follows an eat, so its cell is still
  // occupied when the head arrives and it kills. On any other tick it vacates
  // as the head moves and the head may legally take it.
  const tailHeld = state.pendingGrowth > 0;
  const last = state.snake.length - 1;
  for (let i = 0; i < state.snake.length; i++) {
    if (i === last && !tailHeld) continue;
    if (sameCell(state.snake[i], head)) {
      return makeState({ ...state, direction, turns, status: 'dead' });
    }
  }

  const body = [head, ...(tailHeld ? state.snake : state.snake.slice(0, last))];

  const ate = state.food !== null && sameCell(head, state.food);
  const food = ate ? spawnFood(state.width, state.height, body, state.rng) : state.food;

  return makeState({
    ...state,
    snake: body,
    direction,
    turns,
    food,
    foodEaten: state.foodEaten + (ate ? 1 : 0),
    pendingGrowth: (tailHeld ? state.pendingGrowth - 1 : 0) + (ate ? 1 : 0),
    status: food === null ? 'won' : 'playing',
  });
}
