import { describe, it, expect } from 'vitest';
import { createStore } from '../src/store.js';
import { STORAGE_KEY, defaultRecord } from '../src/persist.js';

import { createFakeStorage } from './helpers.js';

const seeded = (fields) => createFakeStorage({
  [STORAGE_KEY]: JSON.stringify({ ...defaultRecord(), ...fields }),
});

describe('the high score', () => {
  it('does not overwrite a stored high score with a lower one', () => {
    const storage = seeded({ highScore: 500 });
    const store = createStore({ storage });
    const before = storage.peek(STORAGE_KEY);

    store.submitScore(120);

    expect(store.getState().highScore).toBe(500);
    expect(storage.peek(STORAGE_KEY)).toBe(before);
  });

  it('does not write at all when the score equals the stored high score', () => {
    const storage = seeded({ highScore: 500 });
    const store = createStore({ storage });
    const writesBefore = storage.setCalls;

    store.submitScore(500);

    expect(storage.setCalls).toBe(writesBefore);
    expect(store.getState().highScore).toBe(500);
  });
});

describe('a storage write that throws', () => {
  it('keeps the new value in memory after a quota error swallows the write', () => {
    const storage = seeded({ highScore: 10 });
    const store = createStore({ storage });
    const onDisk = storage.peek(STORAGE_KEY);

    const quota = new Error('QuotaExceededError: storage is full');
    quota.name = 'QuotaExceededError';
    storage.throwOnSet = quota;

    expect(() => store.submitScore(900)).not.toThrow();

    // The write was attempted, and failed ...
    expect(storage.setCalls).toBeGreaterThan(0);
    expect(storage.peek(STORAGE_KEY)).toBe(onDisk);
    // ... and the store carried on with the new value regardless.
    expect(store.getState().highScore).toBe(900);
    expect(() => store.setSoundOn(false)).not.toThrow();
    expect(store.getState().soundOn).toBe(false);
  });
});

describe('subscriptions', () => {
  it('delivers an update to two subscribers, and to the survivor after the other unsubscribes', () => {
    const store = createStore({ storage: createFakeStorage() });
    const first = [];
    const second = [];

    const stopFirst = store.subscribe((s) => first.push(s.highScore));
    store.subscribe((s) => second.push(s.highScore));

    store.submitScore(10);
    expect(first).toEqual([10]);
    expect(second).toEqual([10]);

    stopFirst();
    store.submitScore(20);

    expect(first).toEqual([10]);
    expect(second).toEqual([10, 20]);
  });

  it('ignores a second unsubscribe of the same subscriber instead of throwing or removing someone else', () => {
    const store = createStore({ storage: createFakeStorage() });
    const dropped = [];
    const kept = [];

    const stopDropped = store.subscribe((s) => dropped.push(s.highScore));
    store.subscribe((s) => kept.push(s.highScore));

    stopDropped();
    expect(() => stopDropped()).not.toThrow();

    store.submitScore(30);

    expect(dropped).toEqual([]);
    expect(kept).toEqual([30]);
  });

  it('notifies the remaining subscribers when one of them throws', () => {
    const store = createStore({ storage: createFakeStorage() });
    const before = [];
    const after = [];

    store.subscribe((s) => before.push(s.highScore));
    store.subscribe(() => { throw new Error('a view blew up while rendering'); });
    store.subscribe((s) => after.push(s.highScore));

    expect(() => store.submitScore(40)).not.toThrow();

    expect(before).toEqual([40]);
    // The one registered after the thrower is the assertion that matters: an
    // unisolated loop stops here.
    expect(after).toEqual([40]);
  });
});
