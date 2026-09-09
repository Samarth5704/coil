// Phase 6 — swipe resolution.
//
// Pure arithmetic on two numbers. It is here as its own module and its own
// test because it is the only part of touch input that can be wrong in a way
// the player feels: a threshold that lets a tap through steers the snake when
// nobody asked, and a rule that needs a clean axis loses every real thumb
// swipe, which is diagonal.

import { describe, it, expect } from 'vitest';
import { resolveSwipe, SWIPE_THRESHOLD } from '../src/input/swipe.js';

describe('resolveSwipe', () => {
  it('ignores a swipe of 20 px and registers one of 40 px', () => {
    // The named case. 20 px is a thumb resting on a moving board; 40 px is a
    // gesture. The threshold sits between them.
    expect(SWIPE_THRESHOLD).toBeGreaterThan(20);
    expect(SWIPE_THRESHOLD).toBeLessThanOrEqual(40);
    expect(resolveSwipe({ dx: 20, dy: 0 })).toBe(null);
    expect(resolveSwipe({ dx: 40, dy: 0 })).toBe('right');
    expect(resolveSwipe({ dx: 0, dy: -20 })).toBe(null);
    expect(resolveSwipe({ dx: 0, dy: -40 })).toBe('up');
  });

  it('resolves 50 right and 30 down to right rather than to nothing', () => {
    // A real swipe is never axis-aligned. Requiring one would drop it, and a
    // dropped swipe on a board that keeps moving is a death.
    expect(resolveSwipe({ dx: 50, dy: 30 })).toBe('right');
    expect(resolveSwipe({ dx: -50, dy: 30 })).toBe('left');
    expect(resolveSwipe({ dx: 30, dy: 50 })).toBe('down');
    expect(resolveSwipe({ dx: 30, dy: -50 })).toBe('up');
  });

  it('resolves an exactly equal dx and dy above the threshold to the horizontal axis', () => {
    // A tie has to go somewhere. Horizontal, decided rather than fallen into:
    // see the comment in src/input/swipe.js.
    expect(resolveSwipe({ dx: 40, dy: 40 })).toBe('right');
    expect(resolveSwipe({ dx: -40, dy: 40 })).toBe('left');
    expect(resolveSwipe({ dx: 40, dy: -40 })).toBe('right');
    expect(resolveSwipe({ dx: -40, dy: -40 })).toBe('left');
  });

  it('measures the threshold against the winning axis, not against the diagonal', () => {
    // 25 by 25 is a 35 px diagonal, which would clear a hypotenuse test while
    // neither axis carries 30 px of intent. It is a tap with a wobble.
    expect(resolveSwipe({ dx: 25, dy: 25 })).toBe(null);
  });

  it('takes a threshold of its own, so the caller is not stuck with the default', () => {
    expect(resolveSwipe({ dx: 20, dy: 0, threshold: 10 })).toBe('right');
    expect(resolveSwipe({ dx: 40, dy: 0, threshold: 60 })).toBe(null);
  });

  it('returns null for a stationary press and for values that are not numbers', () => {
    expect(resolveSwipe({ dx: 0, dy: 0 })).toBe(null);
    expect(resolveSwipe({ dx: NaN, dy: 40 })).toBe(null);
    expect(resolveSwipe({})).toBe(null);
  });
});
