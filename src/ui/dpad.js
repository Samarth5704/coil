// Coil — the on-screen d-pad.
//
// Four real <button> elements, built and appended; never innerHTML, which
// would throw away whatever the container held and rebuild the controls out
// from under any focus sitting on one of them.
//
// The names are the part that can be quietly wrong. "Up" reads fine on screen
// beside a board and reads as nothing in a list of the page's controls, which
// is how a screen reader user meets them — so each one names what it moves and
// which way. The visible label is an arrowhead, which has no reading at all,
// and that is exactly why the accessible name is carried by aria-label rather
// than left to the glyph.
//
// The 44 px minimum target is CSS, in index.html, on `.dpad button`.

/**
 * The media query that decides whether the d-pad is on screen at all.
 *
 * index.html's stylesheet shows `.dpad` under exactly this query and hides it
 * otherwise, and main.js matches the same string to decide whether the idle
 * instruction may name these buttons. Named once, here, because the sentence
 * that tells a player to press a button and the rule that puts the button on
 * the page have to agree, and two copies of a media query drift the same way
 * two copies of a sentence do. tests/markup.test.js pins this to the CSS.
 */
export const DPAD_MEDIA_QUERY = '(pointer: coarse)';

export const DPAD_BUTTONS = Object.freeze([
  { direction: 'up', glyph: '▲', label: 'Steer the snake up' },
  { direction: 'left', glyph: '◀', label: 'Steer the snake left' },
  { direction: 'right', glyph: '▶', label: 'Steer the snake right' },
  { direction: 'down', glyph: '▼', label: 'Steer the snake down' },
].map(Object.freeze));

export function createDpad({ document, root, onDirection } = {}) {
  if (!document || typeof document.createElement !== 'function') {
    throw new TypeError('createDpad needs a document to create its buttons with');
  }
  if (!root || typeof root.appendChild !== 'function') {
    throw new TypeError('createDpad needs a root element to append its buttons to');
  }
  if (typeof onDirection !== 'function') {
    throw new TypeError('createDpad needs an onDirection function');
  }

  const buttons = DPAD_BUTTONS.map(({ direction, glyph, label }) => {
    const button = document.createElement('button');
    // Typed: an untyped button inside a form submits it.
    button.setAttribute('type', 'button');
    button.setAttribute('data-direction', direction);
    button.setAttribute('aria-label', label);
    button.textContent = glyph;
    button.addEventListener('click', () => onDirection(direction));
    root.appendChild(button);
    return button;
  });

  return { buttons, root };
}
