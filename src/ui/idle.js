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

// The sentence in the markup is the form that is true on every device, because
// the markup is parsed before any script has run. `instruction` is asked again
// on every show, so a page whose d-pad has appeared says so.
import { IDLE_INSTRUCTION } from '../render/labels.js';

export function createIdleNote({ root, instruction = () => IDLE_INSTRUCTION } = {}) {
  if (!root || typeof root.querySelector !== 'function') {
    throw new TypeError('createIdleNote needs a root element to look its node up in');
  }
  if (typeof instruction !== 'function') {
    throw new TypeError('createIdleNote needs instruction to be a function, asked on each show');
  }

  const node = root.querySelector('[data-role="idle"]');
  if (!node) {
    throw new Error('idle: no node with data-role="idle" under the root element');
  }

  let shown = false;

  return {
    show() {
      // Rewritten each time rather than trusted from the markup: which
      // controls are on screen is a media query, and a media query can change
      // between one idle board and the next without the page reloading.
      const text = instruction();
      if (node.textContent !== text) node.textContent = text;
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
