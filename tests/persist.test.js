import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEY,
  SCHEMA_VERSION,
  defaultRecord,
  migrate,
  load,
  save,
} from '../src/persist.js';

import { createFakeStorage } from './helpers.js';

// Every case here injects a fake storage object. Nothing in src/persist.js
// reaches for localStorage, or for window at all — the call site that passes
// window.localStorage in does not exist until phase 5.

describe('loading a record that is not there or not usable', () => {
  it('loads the defaults without throwing when the storage key is absent', () => {
    const storage = createFakeStorage();

    const { record } = load(storage);

    expect(record).toEqual(defaultRecord());
    expect(storage.setCalls).toBe(0);
  });

  it('loads the defaults without throwing when the key holds malformed JSON', () => {
    const storage = createFakeStorage({ [STORAGE_KEY]: '{"highScore": 41,' });

    let record;
    expect(() => { ({ record } = load(storage)); }).not.toThrow();

    expect(record).toEqual(defaultRecord());
  });

  it('falls back to the default for a field of the wrong type rather than coercing it, and keeps the fields that are well formed', () => {
    // "yes" is truthy, so a coercing loader would read it as sound on and be
    // right by accident. false is the value that catches it.
    const storage = createFakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: 1,
        highScore: 99,
        soundOn: 'yes',
        reducedMotionOverride: null,
        stepMode: false,
      }),
    });

    const { record } = load(storage);

    expect(record.soundOn).toBe(defaultRecord().soundOn);
    expect(record.soundOn).not.toBe('yes');
    expect(record.highScore).toBe(99);
  });
});

describe('migrating a record at a known version', () => {
  it('gives a version 1 record missing a field that field’s default and leaves every other stored field unchanged', () => {
    const stored = {
      version: 1,
      highScore: 1234,
      soundOn: false,
      stepMode: true,
      // reducedMotionOverride absent
    };
    const storage = createFakeStorage({ [STORAGE_KEY]: JSON.stringify(stored) });

    expect(migrate(stored).reducedMotionOverride)
      .toBe(defaultRecord().reducedMotionOverride);

    const { record } = load(storage);

    expect(record.reducedMotionOverride).toBe(defaultRecord().reducedMotionOverride);
    expect(record.highScore).toBe(1234);
    expect(record.soundOn).toBe(false);
    expect(record.stepMode).toBe(true);
    expect(record.version).toBe(SCHEMA_VERSION);
  });
});

describe('a record written by a newer version of the game', () => {
  it('leaves a version 99 record byte-for-byte on disk and runs the session on the defaults', () => {
    const future = '{"version":99,"highScore":8800,"soundOn":false,"chromaticAberration":true}';
    const storage = createFakeStorage({ [STORAGE_KEY]: future });

    const { record, writable } = load(storage);

    // Runs on defaults ...
    expect(record).toEqual(defaultRecord());
    expect(record.highScore).toBe(0);
    // ... and the bytes are exactly the ones that were there.
    expect(storage.peek(STORAGE_KEY)).toBe(future);
    expect(storage.setCalls).toBe(0);
    // Marked unwritable, so a later setting change cannot clobber it either.
    expect(writable).toBe(false);
  });
});

describe('a round trip through storage', () => {
  it('writes a record byte-identical to the one it loaded when nothing has changed', () => {
    const written = '{"version":1,"highScore":4210,"soundOn":false,'
      + '"reducedMotionOverride":true,"stepMode":true}';
    const storage = createFakeStorage({ [STORAGE_KEY]: written });

    const { record } = load(storage);
    save(storage, record);

    expect(storage.peek(STORAGE_KEY)).toBe(written);
  });
});
