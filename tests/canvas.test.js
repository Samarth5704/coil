// Phase 5 — motion settings, and the drawing that has to differ by shape.

import { describe, it, expect } from 'vitest';
import { drawOptionsFor, createRenderer } from '../src/render/canvas.js';
import { createGame, tickIntervalFor } from '../src/core/game.js';
import { mulberry32, WIDTH, HEIGHT, at } from './helpers.js';

const palette = {
  bg: '#0a0e0c',
  lattice: '#1a211d',
  wall: '#7d8d85',
  food: '#e8f2ec',
  focus: '#7dc4ff',
  ramp: ['#6fe3a1', '#d8e06a', '#f0a83c', '#ff8f4a', '#ff7361'],
};

// Records every call and every colour assignment, so a test can ask what was
// drawn without a canvas and without a browser.
function recordingContext() {
  const calls = [];
  const ctx = {
    canvas: { width: 0, height: 0 },
    imageSmoothingEnabled: true,
    fills: [],
    calls,
    lineWidth: 1,
    _alpha: 1,
    set globalAlpha(v) { this._alpha = v; calls.push(['globalAlpha', v]); },
    get globalAlpha() { return this._alpha; },
    set fillStyle(v) { this._fill = v; calls.push(['fillStyle', v]); },
    get fillStyle() { return this._fill; },
    set strokeStyle(v) { this._stroke = v; calls.push(['strokeStyle', v]); },
    get strokeStyle() { return this._stroke; },
  };
  for (const name of [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect',
    'stroke', 'clearRect', 'translate', 'setTransform', 'strokeRect',
  ]) {
    ctx[name] = (...args) => { calls.push([name, ...args]); };
  }
  ctx.fillRect = (...args) => {
    calls.push(['fillRect', ...args]);
    ctx.fills.push({ colour: ctx._fill, args });
  };
  ctx.fill = (...args) => {
    calls.push(['fill', ...args]);
    ctx.fills.push({ colour: ctx._fill, args });
  };
  return ctx;
}

function fakeCanvas() {
  const ctx = recordingContext();
  const element = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    setAttribute(name, value) { this[`attr:${name}`] = value; },
    getAttribute(name) { return this[`attr:${name}`] ?? null; },
  };
  return { ctx, element };
}

function rendererOn(element, options = {}) {
  return createRenderer({ canvas: element, cols: WIDTH, rows: HEIGHT, palette, ...options });
}

const still = () => drawOptionsFor({ systemPrefersReducedMotion: true, override: null });

// Every strokeRect in call order, each carrying the strokeStyle in force when
// it ran. Order is the point: "two strokes of opposing lightness" is satisfied
// by an inverted ring too, and an inverted ring is the bug this pairs with.
function strokedRects(ctx) {
  const out = [];
  let colour = null;
  for (const call of ctx.calls) {
    if (call[0] === 'strokeStyle') colour = call[1];
    if (call[0] === 'strokeRect') {
      const [, x, y, w, h] = call;
      out.push({ colour, x, y, w, h });
    }
  }
  return out;
}

// The wall frame, as the rectangle its four fills enclose.
function wallFrame(ctx) {
  const fills = ctx.fills.filter((f) => f.colour === palette.wall);
  const xs = fills.map((f) => f.args[0]);
  const ys = fills.map((f) => f.args[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), count: fills.length };
}

describe('drawOptionsFor', () => {
  it('disables flicker and cross-fade under a reducedMotionOverride of true, and does not touch the clock', () => {
    // The motion of the snake IS the information. Reduced motion removes the
    // decoration around it, never the movement itself, so nothing in these
    // options may reach the tick interval.
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(1) });

    const options = drawOptionsFor({ systemPrefersReducedMotion: false, override: true });

    expect(options.reducedMotion).toBe(true);
    expect(options.flicker).toBe(false);
    expect(options.crossFade).toBe(false);
    expect(options).not.toHaveProperty('tickInterval');
    expect(tickIntervalFor(state)).toBe(140);
  });

  it('leaves flicker and cross-fade on when motion is allowed', () => {
    const options = drawOptionsFor({ systemPrefersReducedMotion: false, override: null });
    expect(options.reducedMotion).toBe(false);
    expect(options.flicker).toBe(true);
    expect(options.crossFade).toBe(true);
  });

  it('follows the OS when the override is null and overrides it in both directions', () => {
    expect(drawOptionsFor({ systemPrefersReducedMotion: true, override: null }).reducedMotion).toBe(true);
    expect(drawOptionsFor({ systemPrefersReducedMotion: false, override: null }).reducedMotion).toBe(false);
    // An override of false is a player saying yes to motion, and it wins.
    expect(drawOptionsFor({ systemPrefersReducedMotion: true, override: false }).reducedMotion).toBe(false);
  });
});

describe('createRenderer', () => {
  it('turns image smoothing off, because a smoothed pixel grid is the wrong grid', () => {
    const { ctx, element } = fakeCanvas();
    rendererOn(element).resize({ containerW: 640, containerH: 480, dpr: 2 });

    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(element.width).toBe(1280);
    expect(element.height).toBe(960);
  });

  it('draws the body in the current ramp colour and gives the head no colour of its own', () => {
    // Tinting the head would need either a ramp colour, which is already the
    // body colour, or a colour outside the ramp, which then meets the same
    // 1.0-1.5:1 wall the focus ring meets. The head differs by SHAPE.
    const { ctx, element } = fakeCanvas();
    const state = createGame({
      width: WIDTH,
      height: HEIGHT,
      rng: mulberry32(5),
      snake: [at(6, 6), at(5, 6), at(4, 6)],
      food: at(10, 10),
    });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
    renderer.draw(state, still());

    const colours = new Set(ctx.fills.map((f) => f.colour));
    const tokens = [palette.bg, palette.lattice, palette.wall, palette.food, ...palette.ramp];

    expect(colours.has(palette.ramp[0])).toBe(true);
    for (const colour of colours) expect(tokens).toContain(colour);
    // Only the step the board is standing on is ever painted.
    for (let step = 1; step < 5; step++) expect(colours.has(palette.ramp[step])).toBe(false);
  });

  it('draws the food with a different silhouette from a body segment', () => {
    // --food sits at 1.24:1 against ramp step "close": a food pixel and a body
    // pixel are the same pixel there, so the difference has to be geometry.
    const { ctx, element } = fakeCanvas();
    const state = createGame({
      width: WIDTH,
      height: HEIGHT,
      rng: mulberry32(5),
      snake: [at(6, 6), at(5, 6)],
      food: at(10, 10),
    });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
    renderer.draw(state, still());

    const foodFills = ctx.fills.filter((f) => f.colour === palette.food);
    const bodyFills = ctx.fills.filter((f) => f.colour === palette.ramp[0]);

    expect(foodFills.length).toBeGreaterThan(0);
    // The food is a path fill; a body segment is an axis-aligned fillRect.
    expect(foodFills.every((f) => f.args.length === 0)).toBe(true);
    expect(bodyFills.some((f) => f.args.length === 4)).toBe(true);
  });

  it('cuts the notch out of the leading edge, so the head reads as a head from its shape', () => {
    // The notch is painted in the background colour over the head cell, on the
    // side the snake is travelling towards. Two headings, two different sides.
    const { ctx, element } = fakeCanvas();
    const right = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(5), snake: [at(6, 6), at(5, 6)], food: at(10, 10),
    });
    const down = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(5), snake: [at(6, 6), at(6, 5)], food: at(10, 10),
    });

    const notchOf = (state) => {
      const renderer = rendererOn(element);
      renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
      ctx.fills.length = 0;
      renderer.draw(state, still());
      const cut = ctx.fills.filter((f) => f.colour === palette.bg && f.args.length === 4);
      expect(cut.length).toBeGreaterThan(0);
      return cut[cut.length - 1].args;
    };

    expect(notchOf(right)).not.toEqual(notchOf(down));
  });

  it('draws the focus ring as two strokes of opposing lightness, never one', () => {
    // Per phase 4: no single hex both clears 4.5:1 on the background and
    // separates from the ramp by luminance. One tone is guaranteed to vanish
    // against some step, so the ring is two.
    const { ctx, element } = fakeCanvas();
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(9) });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
    renderer.draw(state, { ...still(), focused: true });

    const strokes = ctx.calls.filter((c) => c[0] === 'strokeStyle').map((c) => c[1]);
    expect(strokes).toContain(palette.focus); // the light outer
    expect(strokes).toContain(palette.bg); // the dark inner
    expect(ctx.calls.filter((c) => c[0] === 'strokeRect').length).toBeGreaterThanOrEqual(2);
  });

  it('draws the focus ring with --focus as its OUTER stroke and --bg as its inner one', () => {
    // Regression. The ring shipped inverted for one build: dark on the outside
    // against the dark page ground, light on the inside against the board. It
    // was two strokes of opposing lightness the whole time, so the test that
    // only counted colours passed, and only looking at it caught the bug.
    // Order is therefore asserted, not membership.
    const { ctx, element } = fakeCanvas();
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(9) });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
    renderer.draw(state, { ...still(), focused: true });

    const rects = strokedRects(ctx);
    expect(rects.length).toBe(2);

    const [outer, inner] = rects;
    expect(outer.colour).toBe(palette.focus);
    expect(inner.colour).toBe(palette.bg);

    // And the one named "outer" actually encloses the one named "inner", so
    // the names cannot drift from the geometry either.
    expect(outer.x).toBeLessThan(inner.x);
    expect(outer.y).toBeLessThan(inner.y);
    expect(outer.w).toBeGreaterThan(inner.w);
    expect(outer.h).toBeGreaterThan(inner.h);
  });

  it('draws the focus ring band outside the wall band and inside the canvas', () => {
    // The other half of the same regression: the ring was drawn at the canvas
    // edge over a wall band that had no room reserved beyond it, so focusing
    // the board erased the wall — and the wall is a meaningful mark, the edge
    // the snake dies against. The geometry now reserves a band for each.
    const { ctx, element } = fakeCanvas();
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(9) });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 2 });
    renderer.draw(state, { ...still(), focused: true });

    const fit = renderer.fit;
    const rects = strokedRects(ctx);
    const line = ctx.lineWidth;

    // A stroke is centred on its rect, so it covers half a line width either
    // side. These are the outermost and innermost pixels the ring paints.
    const ringOuterEdge = Math.min(...rects.map((r) => r.x - line / 2));
    const ringInnerEdge = Math.max(...rects.map((r) => r.x + line / 2));

    expect(ringOuterEdge).toBeGreaterThanOrEqual(0); // inside the canvas
    expect(rects[0].x + rects[0].w + line / 2).toBeLessThanOrEqual(fit.canvasW);

    const wall = wallFrame(ctx);
    expect(wall.count).toBe(4);
    // Nothing of the ring reaches the first pixel of the wall.
    expect(ringInnerEdge).toBeLessThanOrEqual(wall.left);
    // And the wall itself still sits outside the board it fences in.
    expect(wall.left).toBeLessThan(fit.offsetX);
  });

  it('draws no focus ring when the canvas does not have focus', () => {
    const { ctx, element } = fakeCanvas();
    const state = createGame({ width: WIDTH, height: HEIGHT, rng: mulberry32(9) });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
    renderer.draw(state, { ...still(), focused: false });

    const strokes = ctx.calls.filter((c) => c[0] === 'strokeStyle').map((c) => c[1]);
    expect(strokes).not.toContain(palette.focus);
  });

  it('holds the ramp colour steady under reduced motion instead of cross-fading it', () => {
    // A cross-fade is a colour changing over time, which is motion. Under
    // reduced motion the new step is simply the colour, from the first frame.
    const { ctx, element } = fakeCanvas();
    const state = createGame({
      width: WIDTH, height: HEIGHT, rng: mulberry32(5), snake: [at(6, 6), at(5, 6)], food: at(10, 10),
    });
    const renderer = rendererOn(element);
    renderer.resize({ containerW: 640, containerH: 480, dpr: 1 });
    renderer.draw(state, still());

    const alphas = ctx.calls.filter((c) => c[0] === 'globalAlpha');
    expect(alphas.length).toBe(0);
    expect(ctx.globalAlpha).toBe(1);
  });
});
