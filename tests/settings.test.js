// Phase 6 — the settings panel.
//
// Three toggles over one store. The only logic here is the three-state
// reduced-motion control, which has to map to the record's null / true /
// false rather than to a checkbox's two states: null is "follow the OS", and
// a checkbox cannot say it. Collapsing the three into two is the bug this
// file exists to stop, because the value that gets lost is the default.

import { describe, it, expect } from 'vitest';
import {
  createSettings, overrideFromChoice, choiceFromOverride, MOTION_CHOICES,
} from '../src/ui/settings.js';
import { createStore } from '../src/store.js';
import { STORAGE_KEY, defaultRecord } from '../src/persist.js';
import { appMarkup } from './fake-dom.js';
import { createFakeStorage } from './helpers.js';

function mount(record = {}) {
  const markup = appMarkup();
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ ...defaultRecord(), ...record }),
  });
  const store = createStore({ storage });
  const settings = createSettings({ root: markup.panel, store });
  return { ...markup, store, storage, settings };
}

const control = (markup, name) => markup.panel.querySelector(`[data-setting="${name}"]`);

describe('the reduced-motion choice', () => {
  it('maps its three values to null, true and false and back again', () => {
    // null is not "off". It is the absence of an override, which is what
    // hands the decision to prefers-reduced-motion.
    expect(overrideFromChoice('system')).toBe(null);
    expect(overrideFromChoice('on')).toBe(true);
    expect(overrideFromChoice('off')).toBe(false);

    expect(choiceFromOverride(null)).toBe('system');
    expect(choiceFromOverride(true)).toBe('on');
    expect(choiceFromOverride(false)).toBe('off');

    expect(MOTION_CHOICES.map((c) => c.value)).toEqual(['system', 'on', 'off']);
  });

  it('falls back to following the OS on a value it does not know', () => {
    expect(overrideFromChoice('nonesuch')).toBe(null);
    expect(choiceFromOverride('nonesuch')).toBe('system');
  });
});

describe('the controls', () => {
  it('opens showing what the record holds', () => {
    const app = mount({ soundOn: false, stepMode: true, reducedMotionOverride: true });

    expect(control(app, 'sound').checked).toBe(false);
    expect(control(app, 'stepMode').checked).toBe(true);
    expect(control(app, 'reducedMotion').value).toBe('on');
  });

  it('writes a toggled checkbox through to the store', () => {
    const app = mount({ stepMode: false });
    const box = control(app, 'stepMode');

    box.checked = true;
    box.dispatchEvent({ type: 'change' });

    expect(app.store.getState().stepMode).toBe(true);
  });

  it('writes the three-state motion choice through as null, true and false', () => {
    const app = mount();
    const select = control(app, 'reducedMotion');

    select.value = 'on';
    select.dispatchEvent({ type: 'change' });
    expect(app.store.getState().reducedMotionOverride).toBe(true);

    select.value = 'off';
    select.dispatchEvent({ type: 'change' });
    expect(app.store.getState().reducedMotionOverride).toBe(false);

    select.value = 'system';
    select.dispatchEvent({ type: 'change' });
    expect(app.store.getState().reducedMotionOverride).toBe(null);
  });

  it('follows the store when something else changes it', () => {
    const app = mount({ soundOn: true });
    app.store.setSoundOn(false);
    expect(control(app, 'sound').checked).toBe(false);
  });

  it('names every control it was told to find, so a renamed node is not a dead toggle', () => {
    const markup = appMarkup();
    const dead = markup.panel.querySelector('[data-setting="stepMode"]');
    dead.setAttribute('data-setting', 'stepmode');
    const storage = createFakeStorage({ [STORAGE_KEY]: JSON.stringify(defaultRecord()) });

    expect(() => createSettings({ root: markup.panel, store: createStore({ storage }) }))
      .toThrow(/stepMode/);
  });
});
