// Phase 6 — key mapping, and the three questions that gate preventDefault.
//
// preventDefault is the dangerous half of keyboard input. Called blanket on
// the document it takes Tab away from the page, which is the whole keyboard
// for anyone not using a mouse; called while a settings control has focus it
// stops the arrow keys from moving through a select. So the mapping is pure
// and the permission is a function of state, not a habit.

import { describe, it, expect } from 'vitest';
import { directionForKey, interpretKey, ADVANCE_KEYS } from '../src/input/keyboard.js';

const playing = { running: true, surfaceFocused: true, stepMode: false };

describe('directionForKey', () => {
  it('maps the arrows and WASD to the four directions', () => {
    expect(directionForKey('ArrowUp')).toBe('up');
    expect(directionForKey('ArrowDown')).toBe('down');
    expect(directionForKey('ArrowLeft')).toBe('left');
    expect(directionForKey('ArrowRight')).toBe('right');
    expect(directionForKey('w')).toBe('up');
    expect(directionForKey('a')).toBe('left');
    expect(directionForKey('s')).toBe('down');
    expect(directionForKey('d')).toBe('right');
  });

  it('maps WASD with caps lock or shift held, which reports an upper-case key', () => {
    expect(directionForKey('W')).toBe('up');
    expect(directionForKey('D')).toBe('right');
  });

  it('returns null for every key that is not a direction', () => {
    for (const key of ['Tab', 'Escape', 'q', 'F5', 'Home', 'PageDown', '', undefined]) {
      expect(directionForKey(key)).toBe(null);
    }
  });
});

describe('interpretKey', () => {
  it('steers and prevents the default when the game is running and the surface has focus', () => {
    const action = interpretKey({ key: 'ArrowUp' }, playing);
    expect(action.direction).toBe('up');
    expect(action.preventDefault).toBe(true);
  });

  it('does not prevent arrow keys when focus is in the settings panel', () => {
    // Named case. The arrow keys belong to whatever control has focus. Taking
    // them means a select cannot be changed and a radio group cannot be moved
    // through, which is the panel that holds step mode — the affordance a
    // keyboard-only player came here for.
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const action = interpretKey({ key }, { ...playing, surfaceFocused: false });
      expect(action.preventDefault).toBe(false);
      expect(action.direction).toBe(null);
    }
  });

  it('does not prevent arrow keys when the game is over', () => {
    // Named case. A finished run holds the page until the player leaves it,
    // and scrolling the summary into view is the first thing they will do.
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const action = interpretKey({ key }, { ...playing, running: false });
      expect(action.preventDefault).toBe(false);
      expect(action.direction).toBe(null);
    }
  });

  it('never prevents Tab, in any state', () => {
    // Named case, and the one that has no exception. Tab is how the page is
    // used without a mouse; there is no game state in which taking it is a
    // trade worth making.
    for (const running of [true, false]) {
      for (const surfaceFocused of [true, false]) {
        for (const stepMode of [true, false]) {
          for (const shiftKey of [true, false]) {
            const action = interpretKey(
              { key: 'Tab', shiftKey },
              { running, surfaceFocused, stepMode },
            );
            expect(action.preventDefault).toBe(false);
            expect(action.advance).toBe(false);
          }
        }
      }
    }
  });

  it('leaves a browser shortcut alone: a modifier held means the key belongs to the browser', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      const action = interpretKey({ key: 'ArrowRight', [modifier]: true }, playing);
      expect(action.preventDefault).toBe(false);
      expect(action.direction).toBe(null);
    }
  });

  it('asks for one advance per direction key in step mode, and none out of it', () => {
    expect(interpretKey({ key: 'ArrowUp' }, { ...playing, stepMode: true }).advance).toBe(true);
    expect(interpretKey({ key: 'ArrowUp' }, playing).advance).toBe(false);
  });

  it('does not ask for an advance on a repeat from a held key', () => {
    const held = interpretKey({ key: 'ArrowUp', repeat: true }, { ...playing, stepMode: true });
    expect(held.advance).toBe(false);
    // Still prevented: a held arrow scrolls the page whether or not this
    // particular repeat moves the snake.
    expect(held.preventDefault).toBe(true);
  });

  it('advances on the advance keys without steering', () => {
    for (const key of ADVANCE_KEYS) {
      const action = interpretKey({ key }, { ...playing, stepMode: true });
      expect(action.advance).toBe(true);
      expect(action.direction).toBe(null);
      expect(action.preventDefault).toBe(true);
    }
  });
});
