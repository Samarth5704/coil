// Coil — swipe resolution.
//
// Pure. Two numbers in, a direction or null out. No DOM, no events, no
// element: main.js measures the gesture and hands the deltas here, which is
// what lets the two decisions in this file be tested as arithmetic instead of
// as a browser.

export const SWIPE_THRESHOLD = 30;

const DIRECTIONS = {
  horizontal: { positive: 'right', negative: 'left' },
  // Screen coordinates: y grows downward, so a positive dy is a swipe down.
  vertical: { positive: 'down', negative: 'up' },
};

/**
 * The direction a drag of `dx, dy` asks for, or null if it asks for nothing.
 *
 * Two rules, both of which have a wrong answer that looks reasonable:
 *
 * **Dominant axis.** A real thumb swipe is never axis-aligned; 50 right and
 * 30 down is a swipe right with a wobble, not an ambiguous gesture. Requiring
 * a clean axis drops it, and a dropped swipe on a board that keeps moving is
 * a death the player did not make.
 *
 * **The threshold is measured against the winning axis, not the diagonal.**
 * 25 by 25 is a 35 px hypotenuse — over the threshold on a distance test —
 * while neither axis carries 30 px of intent. That gesture is a tap with a
 * wobble, and it must not steer.
 *
 * A tie on exact equality resolves to the horizontal axis. That is a decision,
 * not an accident: it has to go somewhere, and a board 24 wide and 18 tall
 * gives the horizontal more room to be wrong in. It comes up only when
 * |dx| === |dy| to the pixel, which on a real touch surface is rare and on a
 * synthetic event is a test.
 */
export function resolveSwipe({ dx, dy, threshold = SWIPE_THRESHOLD } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;

  const horizontal = Math.abs(dx) >= Math.abs(dy); // the tie, decided
  const axis = horizontal ? DIRECTIONS.horizontal : DIRECTIONS.vertical;
  const travel = horizontal ? dx : dy;

  if (Math.abs(travel) < threshold) return null;
  return travel > 0 ? axis.positive : axis.negative;
}
