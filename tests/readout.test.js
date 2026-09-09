// Phase 5 — the readout is DOM text, and it is reconciled, never rebuilt.
//
// innerHTML destroys focus and selection and thrashes layout. On a panel that
// updates every 140 ms that is not a style preference, it is a page that
// cannot be used with a keyboard.

import { describe, it, expect } from 'vitest';
import { createReadout } from '../src/ui/readout.js';
import { readoutMarkup } from './fake-dom.js';

const fields = {
  score: '340', highScore: '900', reachable: '413',
  multiplier: '1×', ramp: 'calm', length: '38',
};

describe('createReadout', () => {
  it('writes through textContent on the same node across two renders', () => {
    // Node identity is the assertion. A rebuild produces a node that reads the
    // same and is not the same, and only identity catches it.
    const root = readoutMarkup();
    const readout = createReadout({ root });

    readout.update(fields);
    const scoreNode = root.querySelector('[data-field="score"]');
    const rampNode = root.querySelector('[data-field="ramp"]');
    expect(scoreNode.textContent).toBe('340');

    readout.update({ ...fields, score: '350', ramp: 'sealed', multiplier: '5×' });

    expect(root.querySelector('[data-field="score"]')).toBe(scoreNode);
    expect(root.querySelector('[data-field="ramp"]')).toBe(rampNode);
    expect(scoreNode.textContent).toBe('350');
    expect(rampNode.textContent).toBe('sealed');
  });

  it('leaves a node alone when its value has not changed', () => {
    // Not an optimisation for its own sake: an untouched text node is one the
    // browser does not re-lay-out, and one a screen reader does not re-read.
    const root = readoutMarkup();
    const readout = createReadout({ root });
    readout.update(fields);

    const node = root.querySelector('[data-field="ramp"]');
    let writes = 0;
    const raw = node.textContent;
    Object.defineProperty(node, 'textContent', {
      configurable: true,
      get: () => raw,
      set: () => { writes++; },
    });

    readout.update({ ...fields, score: '999' });
    expect(writes).toBe(0);
  });

  it('names every field it was asked to render, so a typo is not a silent blank', () => {
    const root = readoutMarkup();
    const readout = createReadout({ root });
    expect(() => readout.update({ ...fields, nonesuch: 'x' })).toThrow(/nonesuch/);
  });

  it('writes the game-over summary into the visually hidden node', () => {
    const root = readoutMarkup();
    const readout = createReadout({ root });
    const summary = root.querySelector('[data-field="summary"]');

    readout.setSummary('Game over. Final score 340, length 38, 0 cells reachable, ramp step sealed.');

    expect(root.querySelector('[data-field="summary"]')).toBe(summary);
    expect(summary.textContent).toContain('sealed');
  });

  it('shows the hint node only when there is a hint, and hides it again when there is not', () => {
    const root = readoutMarkup();
    const readout = createReadout({ root });
    const hint = root.querySelector('[data-field="hint"]');
    expect(hint.getAttribute('hidden')).not.toBe(null);

    readout.setHint('Preferences will not be saved this session.');
    expect(hint.getAttribute('hidden')).toBe(null);
    expect(hint.textContent).toMatch(/not be saved/);

    readout.setHint(null);
    expect(hint.getAttribute('hidden')).not.toBe(null);
    expect(hint.textContent).toBe('');
  });
});
