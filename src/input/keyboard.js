// Coil — key mapping.
//
// Pure. A key name in, an intention out. No DOM, no listener, no
// preventDefault: this file decides *whether* the default should be
// prevented and main.js is the one holding an event to prevent it on.
//
// That split is the point. preventDefault is the half of keyboard input that
// can take the page away from a player — blanket on the document it eats Tab,
// which is the whole keyboard for anyone not using a mouse — so the
// permission is a value computed from state and asserted in a test, not a
// call buried in a handler.

// Arrows and WASD. The letters are matched case-insensitively, because a
// player with caps lock on, or a shift held from something else, sends 'W'.
const KEY_DIRECTIONS = Object.freeze({
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
});

// Step mode's "move without turning": one tick along the current heading.
// Space and Enter both, because a button-shaped affordance is what both keys
// mean everywhere else on a page.
export const ADVANCE_KEYS = Object.freeze([' ', 'Enter']);

/** The direction a key asks for, or null for every key that is not one. */
export function directionForKey(key) {
  if (typeof key !== 'string') return null;
  const name = KEY_DIRECTIONS[key.toLowerCase()];
  return name === undefined ? null : name;
}

// A key held with a modifier belongs to the browser or the OS, not to the
// game: ctrl+ArrowRight and cmd+ArrowLeft are word-jump and history-back, and
// taking either is taking something the player asked the browser for.
function modified(event) {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

/**
 * What a keydown means, given the state of the game.
 *
 * Returns `{ direction, advance, preventDefault }`:
 *
 * - `direction` — a turn to queue, or null.
 * - `advance` — whether this press should move the snake one tick, which is
 *   true only in step mode and only on a press that is not a repeat. A held
 *   key fires keydown at the OS repeat rate; step mode exists precisely so
 *   there is no clock, and a repeat that ticks hands the clock straight back
 *   at a rate the player did not choose.
 * - `preventDefault` — true only for a game key, only while the game is
 *   running, and only while the play surface has focus. Never for Tab, which
 *   is not a game key and therefore cannot reach the branch that prevents;
 *   never for a key pressed while a settings control has focus, where the
 *   arrows belong to that control; never for a key pressed after the run has
 *   ended, where the player is reading a summary and will want to scroll.
 */
export function interpretKey(event = {}, context = {}) {
  const { running = false, surfaceFocused = false, stepMode = false } = context;

  const direction = modified(event) ? null : directionForKey(event.key);
  const isAdvanceKey = !modified(event) && ADVANCE_KEYS.includes(event.key);
  const isGameKey = direction !== null || isAdvanceKey;

  // One gate, three conditions, and every case in the tests turns one of them
  // off. Tab never reaches it: it is not a game key.
  const mine = isGameKey && running && surfaceFocused;

  return Object.freeze({
    direction: mine ? direction : null,
    advance: mine && stepMode && !event.repeat,
    preventDefault: mine,
  });
}
