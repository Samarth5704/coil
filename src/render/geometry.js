// Coil — board geometry.
//
// Pure arithmetic. No DOM, no canvas, no globals: a container size and a
// device pixel ratio go in, a whole number of device pixels per cell and the
// letterbox offsets come out. The caller reads devicePixelRatio and the
// element box; this file only divides.
//
// The rule this exists to hold: one grid cell is a WHOLE number of device
// pixels. Fractional scale gives some cells three device pixels and others
// four, which on a pixel grid is instantly visible and is the thing that makes
// a retro-styled game look subtly wrong without the viewer being able to say
// why. Everything else here — the floor, the letterbox, the integer offsets —
// follows from refusing that fraction.

const MIN_CELL = 1;

/**
 * @param {object} box
 * @param {number} box.containerW  container width in CSS pixels
 * @param {number} box.containerH  container height in CSS pixels
 * @param {number} box.cols        grid columns
 * @param {number} box.rows        grid rows
 * @param {number} box.dpr         devicePixelRatio
 * @param {number} [box.inset]     device pixels reserved on every side, for
 *                                 the wall band the board is drawn inside
 *
 * Returns device-pixel geometry: the canvas backing store size, the cell size,
 * the drawn board size and the offsets that centre it.
 */
export function cellSizeFor({ containerW, containerH, cols, rows, dpr, inset = 0 } = {}) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new RangeError('cellSizeFor needs a positive integer cols and rows');
  }
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new RangeError('cellSizeFor needs a devicePixelRatio greater than zero');
  }
  if (!Number.isFinite(containerW) || !Number.isFinite(containerH)
    || containerW < 0 || containerH < 0) {
    throw new RangeError('cellSizeFor needs a finite, non-negative container size');
  }
  if (!Number.isFinite(inset) || inset < 0) {
    throw new RangeError('cellSizeFor needs a finite, non-negative inset');
  }

  // The backing store is whole device pixels too. A canvas sized 903.5 device
  // pixels wide is rounded by the browser anyway, and rounding it here means
  // the offsets below are computed against the size that actually exists.
  const canvasW = Math.floor(containerW * dpr);
  const canvasH = Math.floor(containerH * dpr);

  // The inset is the band the walls are drawn in. Reserving it here rather
  // than taking it out of the letterbox afterwards is what keeps the wall
  // visible on a container that happens to divide evenly and so leaves no
  // letterbox at all.
  const usableW = Math.max(0, canvasW - 2 * Math.floor(inset));
  const usableH = Math.max(0, canvasH - 2 * Math.floor(inset));

  // Floor, never round: rounding up overflows the container by up to half a
  // cell on each axis, and the whole point of the letterbox is that the board
  // fits inside the space it was given.
  const fit = Math.min(usableW / cols, usableH / rows);
  const cell = Math.max(MIN_CELL, Math.floor(fit));

  const boardW = cell * cols;
  const boardH = cell * rows;

  // A container smaller than the grid cannot hold one device pixel per cell.
  // The floor of MIN_CELL is what stops a cell size of zero — which draws
  // nothing at all — or a negative one, which flips every rect inside out.
  // The board then overflows, so say so rather than drawing it wrong
  // silently; the caller decides whether to scroll, clip or refuse.
  const clipped = boardW > canvasW || boardH > canvasH;

  // Integer offsets. A half-pixel offset reintroduces exactly the blurring the
  // integer cell size was there to avoid. An odd remainder cannot be split
  // evenly, so the board sits one device pixel left of and above centre —
  // which is the closest an integer can get.
  const offsetX = clipped ? 0 : Math.floor((canvasW - boardW) / 2);
  const offsetY = clipped ? 0 : Math.floor((canvasH - boardH) / 2);

  return Object.freeze({
    cols,
    rows,
    dpr,
    cell,
    canvasW,
    canvasH,
    boardW,
    boardH,
    offsetX,
    offsetY,
    clipped,
    // The CSS box the canvas occupies. Device pixels over the ratio, so the
    // element is exactly as large as its backing store and the browser does
    // no resampling of its own.
    cssW: canvasW / dpr,
    cssH: canvasH / dpr,
  });
}

/** Device-pixel rect of one grid cell, within a fit from cellSizeFor. */
export function cellRect(fit, x, y) {
  return {
    x: fit.offsetX + x * fit.cell,
    y: fit.offsetY + y * fit.cell,
    size: fit.cell,
  };
}
