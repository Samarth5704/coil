// Phase 5 — integer scaling and the letterbox.
//
// The rule these pin: one grid cell is a WHOLE number of device pixels. A
// fractional scale gives some cells three device pixels and others four, which
// is the single most visible way a pixel-grid game looks wrong.

import { describe, it, expect } from 'vitest';
import { cellSizeFor } from '../src/render/geometry.js';
import { WIDTH, HEIGHT } from './helpers.js';

const board = { cols: WIDTH, rows: HEIGHT };

describe('cellSizeFor', () => {
  it('gives a whole number of device pixels at devicePixelRatio 1, 1.5, 2 and 3', () => {
    // 1.5 is the one that matters: it is the ratio a 150% Windows display
    // reports, and it is where a naive containerW / cols lands between pixels.
    for (const dpr of [1, 1.5, 2, 3]) {
      const fit = cellSizeFor({ containerW: 903, containerH: 617, ...board, dpr });
      expect(Number.isInteger(fit.cell), `dpr ${dpr} gave cell ${fit.cell}`).toBe(true);
      expect(fit.cell).toBeGreaterThan(0);
    }
  });

  it('rounds the cell size down and letterboxes when the container does not divide evenly', () => {
    // 24 cols into 1000 device px is 41.666..., which must floor to 41.
    const fit = cellSizeFor({ containerW: 1000, containerH: 800, ...board, dpr: 1 });

    expect(fit.cell).toBe(41);
    expect(fit.boardW).toBe(41 * WIDTH); // 984
    expect(fit.boardH).toBe(41 * HEIGHT); // 738

    // The drawn board never exceeds the container it is letterboxed inside.
    expect(fit.boardW).toBeLessThanOrEqual(fit.canvasW);
    expect(fit.boardH).toBeLessThanOrEqual(fit.canvasH);
    expect(fit.clipped).toBe(false);
  });

  it('never drops below one device pixel per cell on a container smaller than the grid', () => {
    // 40 x 30 CSS px cannot hold a 24 x 18 grid at any sensible size. A floor
    // of zero would divide by nothing and draw an empty canvas; a negative one
    // would flip every rect.
    const fit = cellSizeFor({ containerW: 10, containerH: 6, ...board, dpr: 1 });

    expect(fit.cell).toBe(1);
    expect(fit.clipped).toBe(true); // said out loud rather than drawn wrong
    expect(fit.offsetX).toBeGreaterThanOrEqual(0);
    expect(fit.offsetY).toBeGreaterThanOrEqual(0);
  });

  it('centres the board to within one device pixel with integer offsets', () => {
    // An odd remainder cannot be split evenly, so the tolerance is one pixel,
    // and the offset is still an integer — a half-pixel offset reintroduces
    // exactly the blurring the integer cell size was there to avoid.
    const fit = cellSizeFor({ containerW: 1000, containerH: 801, ...board, dpr: 1 });

    expect(Number.isInteger(fit.offsetX)).toBe(true);
    expect(Number.isInteger(fit.offsetY)).toBe(true);

    const rightGap = fit.canvasW - fit.boardW - fit.offsetX;
    const bottomGap = fit.canvasH - fit.boardH - fit.offsetY;
    expect(Math.abs(rightGap - fit.offsetX)).toBeLessThanOrEqual(1);
    expect(Math.abs(bottomGap - fit.offsetY)).toBeLessThanOrEqual(1);
  });

  it('sizes the canvas backing store in device pixels and its box in CSS pixels', () => {
    const fit = cellSizeFor({ containerW: 640, containerH: 480, ...board, dpr: 2 });

    expect(fit.canvasW).toBe(1280);
    expect(fit.canvasH).toBe(960);
    expect(fit.cssW).toBeCloseTo(fit.canvasW / 2, 10);
    expect(fit.cssH).toBeCloseTo(fit.canvasH / 2, 10);
  });

  it('reserves the inset on every side, so the wall band survives a container that divides evenly', () => {
    // 24 x 40 = 960 device px exactly, which letterboxes to nothing. Without
    // the reservation the wall would be drawn outside the canvas and simply
    // not exist.
    const flush = cellSizeFor({ containerW: 960, containerH: 720, ...board, dpr: 1 });
    expect(flush.cell).toBe(40);
    expect(flush.offsetX).toBe(0);

    const inset = cellSizeFor({ containerW: 960, containerH: 720, ...board, dpr: 1, inset: 8 });
    expect(inset.cell).toBe(39);
    expect(inset.offsetX).toBeGreaterThanOrEqual(8);
    expect(inset.offsetY).toBeGreaterThanOrEqual(8);
  });

  it('rejects a non-positive grid rather than returning a board of no size', () => {
    expect(() => cellSizeFor({ containerW: 100, containerH: 100, cols: 0, rows: 18, dpr: 1 }))
      .toThrow(RangeError);
    expect(() => cellSizeFor({ containerW: 100, containerH: 100, cols: 24, rows: 18, dpr: 0 }))
      .toThrow(RangeError);
  });
});
