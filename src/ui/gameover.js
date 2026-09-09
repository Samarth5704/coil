// Coil — the game-over region.
//
// It owns three things: whether the region is on the page, the restart
// button, and where focus is when a run ends. It does not own the summary
// text — the readout owns that node and every other node it writes, and the
// string arrives here as an injected `writeSummary` so there is one owner
// rather than two modules taking turns on the same element.
//
// Phase 5 replaced a finished board on a timer, because it had no control
// that could start another. This is what replaces that timer.
//
// Focus is the part with a wrong answer. A region that simply appears leaves
// focus wherever it was — on the canvas, or on <body> once the canvas is no
// longer the interesting thing on the page — and a player using a screen
// reader is then sitting on nothing, with no indication the run ended. Moving
// it to the restart button says the run is over and offers the next one in the
// same movement. It is moved deliberately, once, at the transition, and given
// back to the play surface on restart by the caller that owns the canvas.

function requireNode(root, selector, description) {
  const node = root.querySelector(selector);
  if (!node) {
    throw new Error(`gameover: no ${description} matching ${selector} under the root element`);
  }
  return node;
}

export function createGameOver({ root, onRestart, writeSummary } = {}) {
  if (!root || typeof root.querySelector !== 'function') {
    throw new TypeError('createGameOver needs a root element to look its nodes up in');
  }
  if (typeof onRestart !== 'function') {
    throw new TypeError('createGameOver needs an onRestart function');
  }
  if (typeof writeSummary !== 'function') {
    throw new TypeError('createGameOver needs a writeSummary function to hand the summary to');
  }

  const region = requireNode(root, '[data-role="gameover"]', 'game-over region');
  const button = requireNode(root, '[data-role="restart"]', 'restart control');

  // A real <button>, asserted rather than assumed. A div with a click handler
  // is not focusable, is not reachable by Tab, does not fire on Enter or
  // Space, and is not announced as a control — and it looks identical.
  if (button.tagName !== 'BUTTON') {
    throw new TypeError(
      `gameover: the restart control must be a <button>; found <${button.tagName.toLowerCase()}>`,
    );
  }

  let shown = false;

  button.addEventListener('click', () => onRestart());

  function show(summary) {
    writeSummary(summary);
    region.removeAttribute('hidden');
    shown = true;
    // Deliberate, and never to <body>.
    button.focus();
  }

  function hide() {
    writeSummary('');
    region.setAttribute('hidden', '');
    shown = false;
  }

  return {
    show,
    hide,
    isShown: () => shown,
    button,
    region,
  };
}
