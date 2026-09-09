// Phase 6 — the on-screen d-pad.
//
// Four buttons, and the only thing that can be quietly wrong about them is
// their names. Four controls called "Up", "Down", "Left", "Right" read fine
// on screen next to a board and read as nothing in a list of the page's
// controls, which is how a screen reader user meets them. Four controls that
// share a name are worse: whichever one is announced, the player cannot tell
// which one they are on.

import { describe, it, expect } from 'vitest';
import { createDpad, DPAD_BUTTONS } from '../src/ui/dpad.js';
import { FakeDocument } from './fake-dom.js';

function mount() {
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const pressed = [];
  const dpad = createDpad({ document: doc, root, onDirection: (d) => pressed.push(d) });
  return { doc, root, dpad, pressed };
}

const accessibleName = (button) => button.getAttribute('aria-label') || button.textContent;

describe('the d-pad', () => {
  it('gives every button a distinct accessible name', () => {
    // The named case. Distinct, and distinct as names rather than as glyphs:
    // the visible label is an arrowhead, which has no reading.
    const { dpad } = mount();
    const names = dpad.buttons.map(accessibleName);

    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
    for (const name of names) {
      expect(name.trim().length).toBeGreaterThan(0);
      // Contextual: it says what moves, not only which way.
      expect(name).toMatch(/snake/i);
    }
  });

  it('names one button per direction, and only the four', () => {
    const { dpad } = mount();
    expect(dpad.buttons.map((b) => b.getAttribute('data-direction')).sort())
      .toEqual(['down', 'left', 'right', 'up']);
    expect(DPAD_BUTTONS).toHaveLength(4);
  });

  it('builds real button elements, typed so they do not submit anything', () => {
    const { dpad } = mount();
    for (const button of dpad.buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('reports the direction of the button that was pressed', () => {
    const { dpad, pressed } = mount();
    for (const button of dpad.buttons) button.click();
    expect(pressed).toEqual(dpad.buttons.map((b) => b.getAttribute('data-direction')));
  });

  it('appends its nodes rather than assigning innerHTML over the root', () => {
    // innerHTML would throw away whatever the root already held, and rebuild
    // the buttons out from under any focus that was on one of them.
    const { doc, root } = mount();
    const existing = doc.createElement('p');
    root.appendChild(existing);

    createDpad({ document: doc, root, onDirection: () => {} });

    expect(root.children).toContain(existing);
  });
});
