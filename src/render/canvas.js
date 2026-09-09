// Coil — the play surface.
//
// The only file in the project that touches a canvas context. It draws the
// lattice, the walls, the snake and the food, and nothing else: no text, no
// score, no HUD. Everything a player has to read as words is DOM text in the
// readout, because the ramp steps sit at 1.12:1 against each other and colour
// alone cannot carry a distinction a player may not be able to see.
//
// Three shape decisions are settled here and are not colour decisions:
//
//   - The HEAD differs from the body by SHAPE — an inset notch cut out of its
//     leading edge — and never by colour. A tinted head would need either a
//     ramp colour, which is the body colour, or a colour outside the ramp,
//     which then meets the same 1.0-1.5:1 wall against every ramp step that
//     the focus ring meets.
//   - FOOD differs from a body segment by SHAPE. --food measures 1.24:1 to
//     2.33:1 against the ramp steps; at the close end a food pixel and a body
//     pixel are the same pixel, so it is drawn as a diamond against squares.
//   - The FOCUS RING is two strokes, a dark inner and a light outer. Per phase
//     4 there is no single hex that both clears 4.5:1 on the background and
//     separates from the ramp by luminance, so a one-tone ring is guaranteed
//     to vanish against one ramp step or another. Two strokes of opposing
//     lightness mean one edge always separates from whatever it lands on.
//
// No hex is written in this file. Colours arrive as a palette read from the
// CSS custom properties in src/tokens.css.

import { cellSizeFor } from './geometry.js';
import { rampFor } from './labels.js';

// Device pixels reserved on every side for the wall band, at dpr 1. Walls
// kill, so the boundary is a mark that carries information and gets real
// thickness rather than a hairline.
const WALL_BAND = 5;

// Device pixels reserved outside the wall band, at dpr 1, for the focus ring.
// Reserved rather than shared: a ring drawn over the wall hides the wall, and
// the wall is a meaningful mark — it is the edge the snake dies against.
const RING_BAND = 6;

// How long a ramp cross-fade lasts. Short: the ramp is a warning, and a
// warning that takes half a second to arrive is late.
const CROSS_FADE_MS = 180;

// The flicker on the sealed step. A slow, shallow breath, not a strobe —
// nothing here goes near the 3 Hz photosensitivity threshold.
const FLICKER_HZ = 1.6;
const FLICKER_DEPTH = 0.18;
const SEALED_STEP = 4;

/**
 * What the renderer is allowed to animate.
 *
 * `override` is the store's reducedMotionOverride: null follows the OS, true
 * and false override it in either direction.
 *
 * Note what is NOT here: the tick interval. Reduced motion removes the
 * decoration around the snake and never the snake's movement — that movement
 * is the information the whole game is made of. Slowing it, or stopping it,
 * would be removing the content in the name of accessibility.
 */
export function drawOptionsFor({ systemPrefersReducedMotion = false, override = null } = {}) {
  const reducedMotion = override === null ? Boolean(systemPrefersReducedMotion) : Boolean(override);
  return Object.freeze({
    reducedMotion,
    flicker: !reducedMotion,
    crossFade: !reducedMotion,
  });
}

/**
 * Read the palette out of the CSS custom properties.
 *
 * The hexes live in src/tokens.css and are read from the cascade, so changing
 * a token changes the game with no edit to any JavaScript — which is the only
 * way the contrast tool can keep telling the truth about what is drawn.
 *
 * Takes the element rather than reaching for a global: this file has no
 * `window` in it.
 */
export function readPalette(element) {
  const view = element.ownerDocument.defaultView;
  const style = view.getComputedStyle(element);
  const token = (name) => style.getPropertyValue(name).trim();

  return Object.freeze({
    bg: token('--bg'),
    lattice: token('--lattice'),
    wall: token('--wall'),
    food: token('--food'),
    focus: token('--focus'),
    ramp: Object.freeze([
      token('--ramp-0-calm'),
      token('--ramp-1-close'),
      token('--ramp-2-tight'),
      token('--ramp-3-hot'),
      token('--ramp-4-sealed'),
    ]),
  });
}

export function createRenderer({ canvas, cols, rows, palette } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createRenderer needs a canvas element');
  }
  if (!palette || !Array.isArray(palette.ramp) || palette.ramp.length !== 5) {
    throw new TypeError('createRenderer needs a palette with five ramp steps');
  }

  const ctx = canvas.getContext('2d');
  let fit = null;

  // Which ramp step was last drawn, and when it changed. A cross-fade needs
  // both; with motion off neither is read.
  let previousStep = null;
  let fadeFrom = null;
  let fadeStartedAt = 0;

  function resize({ containerW, containerH, dpr }) {
    const inset = Math.max(2, Math.round((WALL_BAND + RING_BAND) * dpr));
    fit = cellSizeFor({ containerW, containerH, cols, rows, dpr, inset });

    canvas.width = fit.canvasW;
    canvas.height = fit.canvasH;
    canvas.style.width = `${fit.cssW}px`;
    canvas.style.height = `${fit.cssH}px`;

    // Set after the size, because assigning width or height resets every
    // context attribute to its default — and the default is smoothing on,
    // which is a resampled pixel grid, which is the wrong grid.
    ctx.imageSmoothingEnabled = false;
    return fit;
  }

  function draw(state, options = {}) {
    if (fit === null) {
      throw new Error('createRenderer: resize() must run before draw(); there is no geometry yet');
    }

    const { cell, offsetX, offsetY, boardW, boardH } = fit;
    const now = Number.isFinite(options.now) ? options.now : 0;

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, fit.canvasW, fit.canvasH);

    drawLattice();
    drawWalls();

    const step = rampStepOf(state, options);
    const colour = palette.ramp[step];

    if (state.food) drawFood(state.food);

    // Under a cross-fade the body is painted twice: the step it is leaving,
    // then the step it is arriving at, over the top at a rising alpha. With
    // motion off, globalAlpha is never touched at all — a colour changing over
    // time is motion, whatever it is a colour of.
    const fade = fadeAmount(step, now, options);
    if (fade !== null) {
      drawSnake(state, palette.ramp[fade.from]);
      ctx.globalAlpha = fade.t;
      drawSnake(state, colour);
      ctx.globalAlpha = 1;
    } else {
      drawSnake(state, colour);
    }

    if (options.flicker && step === SEALED_STEP && state.status === 'playing') {
      // A wash of background over the body, breathing. It says "sealed" a
      // second time, in a channel that is not hue.
      const phase = Math.sin((now / 1000) * FLICKER_HZ * Math.PI * 2);
      ctx.globalAlpha = FLICKER_DEPTH * (0.5 + 0.5 * phase);
      drawSnake(state, palette.bg);
      ctx.globalAlpha = 1;
    }

    if (options.focused) drawFocusRing();

    function drawLattice() {
      // A faint ruling that helps the eye read cell boundaries. Decorative at
      // 1.18:1, and the board is entirely legible with it invisible.
      ctx.fillStyle = palette.lattice;
      const line = Math.max(1, Math.floor(cell / 16));
      for (let x = 1; x < cols; x++) {
        ctx.fillRect(offsetX + x * cell, offsetY, line, boardH);
      }
      for (let y = 1; y < rows; y++) {
        ctx.fillRect(offsetX, offsetY + y * cell, boardW, line);
      }
    }

    function drawWalls() {
      // A frame in the band the geometry reserved. Walls kill, so this is a
      // meaningful mark, not a border: it is the edge the snake dies against.
      const band = Math.min(offsetX, offsetY, Math.max(1, Math.round(WALL_BAND * fit.dpr)));
      if (band <= 0) return;
      ctx.fillStyle = palette.wall;
      ctx.fillRect(offsetX - band, offsetY - band, boardW + band * 2, band);
      ctx.fillRect(offsetX - band, offsetY + boardH, boardW + band * 2, band);
      ctx.fillRect(offsetX - band, offsetY, band, boardH);
      ctx.fillRect(offsetX + boardW, offsetY, band, boardH);
    }

    function drawSnake(current, bodyColour) {
      ctx.fillStyle = bodyColour;
      const pad = cell >= 8 ? Math.max(1, Math.floor(cell / 10)) : 0;
      for (let i = current.snake.length - 1; i >= 0; i--) {
        const segment = current.snake[i];
        ctx.fillRect(
          offsetX + segment.x * cell + pad,
          offsetY + segment.y * cell + pad,
          cell - pad * 2,
          cell - pad * 2,
        );
      }
      drawHeadNotch(current, pad);
    }

    function drawHeadNotch(current, pad) {
      // The head is the body square with a notch cut out of the leading edge.
      // Cut, not tinted: the notch is painted in the background colour, so the
      // head is told apart by silhouette and the ramp colour stays the one
      // thing the body says.
      const headCell = current.snake[0];
      const depth = Math.max(1, Math.round((cell - pad * 2) / 3));
      const width = Math.max(1, Math.round((cell - pad * 2) / 3));
      const x0 = offsetX + headCell.x * cell + pad;
      const y0 = offsetY + headCell.y * cell + pad;
      const size = cell - pad * 2;
      if (size < 3) return; // no room for a notch; the shape would be noise

      const centre = Math.round((size - width) / 2);
      ctx.fillStyle = palette.bg;
      switch (current.direction) {
        case 'up':
          ctx.fillRect(x0 + centre, y0, width, depth);
          break;
        case 'down':
          ctx.fillRect(x0 + centre, y0 + size - depth, width, depth);
          break;
        case 'left':
          ctx.fillRect(x0, y0 + centre, depth, width);
          break;
        default:
          ctx.fillRect(x0 + size - depth, y0 + centre, depth, width);
      }
    }

    function drawFood(food) {
      // A diamond: four straight edges, none of them parallel to a body
      // square's. At 1.24:1 against the "close" ramp step this silhouette is
      // the entire difference between food and snake.
      const cx = offsetX + food.x * cell + cell / 2;
      const cy = offsetY + food.y * cell + cell / 2;
      const r = Math.max(1, Math.round(cell / 2) - Math.max(1, Math.floor(cell / 8)));

      ctx.fillStyle = palette.food;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
    }

    function drawFocusRing() {
      // TWO strokes, dark inside and light outside. See the file header: no
      // single hex separates from the ramp by luminance, so the ring carries
      // its own contrast with it wherever it lands.
      const w = Math.max(2, Math.round(2 * fit.dpr));

      ctx.lineWidth = w;
      // Light on the outside, in --focus, against whatever the page ground is.
      ctx.strokeStyle = palette.focus;
      ctx.strokeRect(w / 2, w / 2, fit.canvasW - w, fit.canvasH - w);

      // Dark immediately inside it, against whatever the ring lands on: the
      // snake at any ramp step, the food, a wall, or the bare board.
      ctx.strokeStyle = palette.bg;
      ctx.strokeRect(w * 1.5, w * 1.5, fit.canvasW - w * 3, fit.canvasH - w * 3);
    }
  }

  // The step the board is standing on, through the one door that maps it:
  // labels.rampFor, which calls rampStepFor and does nothing else with the
  // number. The renderer does not derive a step of its own from the
  // multiplier, and does not keep private thresholds against the reachable
  // count. Two definitions of the ramp drift, and they drift silently.
  function rampStepOf(state, options) {
    return Number.isInteger(options.rampStep) ? options.rampStep : rampFor(state).step;
  }

  function fadeAmount(step, now, options) {
    if (!options.crossFade) {
      previousStep = step;
      fadeFrom = null;
      return null;
    }
    if (previousStep === null) {
      previousStep = step;
      return null;
    }
    if (step !== previousStep) {
      fadeFrom = previousStep;
      fadeStartedAt = now;
      previousStep = step;
    }
    if (fadeFrom === null) return null;

    const t = (now - fadeStartedAt) / CROSS_FADE_MS;
    if (!(t >= 0) || t >= 1) {
      fadeFrom = null;
      return null;
    }
    return { from: fadeFrom, t };
  }

  return {
    resize,
    draw,
    get fit() {
      return fit;
    },
  };
}
