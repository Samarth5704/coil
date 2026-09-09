// Coil — the idle instruction.
//
// One line of real text in the markup, shown while the board is idle and taken
// out of the page — and out of the accessibility tree, via the hidden
// attribute rather than an emptied node — the moment it starts.
//
// It is real text, in index.html, rather than something drawn on the canvas or
// written by JavaScript at load: a board with no visible way in is a board the
// visitor has to guess at, and the canvas is an image as far as a screen
// reader is concerned. The same sentence is in the canvas aria-label for the
// idle phase, and tests/markup.test.js pins the two to one string in
// src/render/labels.js so they cannot drift apart.

export function createIdleNote({ root } = {}) {
  if (!root || typeof root.querySelector !== 'function') {
    throw new TypeError('createIdleNote needs a root element to look its node up in');
  }

  const node = root.querySelector('[data-role="idle"]');
  if (!node) {
    throw new Error('idle: no node with data-role="idle" under the root element');
  }

  let shown = false;

  return {
    show() {
      node.removeAttribute('hidden');
      shown = true;
    },
    hide() {
      node.setAttribute('hidden', '');
      shown = false;
    },
    isShown: () => shown,
    node,
  };
}
