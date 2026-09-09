// Coil — the store.
//
// One store owns all state and all persistence; views subscribe to it. Phase 3
// gives it the persisted settings and the subscription machinery. The game
// state joins it in phase 5, where the views that subscribe first appear.
//
// The store does not reach for localStorage either — the storage object is
// handed to createStore, which passes it through to persist.js.

import { load, save } from './persist.js';

export function createStore({ storage } = {}) {
  if (!storage
    || typeof storage.getItem !== 'function'
    || typeof storage.setItem !== 'function') {
    throw new TypeError(
      'createStore needs a storage object with getItem and setItem; pass'
      + ' window.localStorage at the app edge, or a fake in a test',
    );
  }

  const loaded = load(storage);
  let record = loaded.record;

  // False only under a record from a newer version of the game. See load():
  // that record is never written over, so this session keeps its settings in
  // memory and writes nothing at all.
  const writable = loaded.writable;

  // Each subscriber gets its own entry object, so unsubscribing is identity on
  // that entry rather than on the function. Calling an unsubscribe twice is
  // then a no-op that cannot take out a second registration of the same
  // function, and two views may share one callback without interfering.
  const subscribers = new Set();

  function getState() {
    return record; // frozen by migrate()
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('subscribe needs a function');
    }
    const entry = { fn };
    subscribers.add(entry);
    return function unsubscribe() {
      subscribers.delete(entry);
    };
  }

  function notify() {
    // Iterate a copy, so subscribing or unsubscribing from inside a callback
    // does not change the set being walked; re-check membership, so a view
    // that unsubscribes a sibling during this notification is honoured.
    for (const entry of [...subscribers]) {
      if (!subscribers.has(entry)) continue;
      try {
        entry.fn(record);
      } catch {
        // One view throwing must not silence the rest. It has to be caught
        // per subscriber and not around the loop, or the first broken view
        // stops every view registered behind it from ever updating.
      }
    }
  }

  // The write is attempted and its failure swallowed by save(); the in-memory
  // record has already been replaced by then, so a quota error costs the
  // player the reload, not the session.
  function commit(next) {
    record = Object.freeze(next);
    if (writable) save(storage, record);
    notify();
  }

  function set(name, value) {
    if (record[name] === value) return false; // no write, no notification
    commit({ ...record, [name]: value });
    return true;
  }

  return {
    getState,
    subscribe,

    // Strictly greater. An equal score is not a new high score, and writing it
    // would spend a storage write and wake every subscriber to tell them
    // nothing changed.
    submitScore(score) {
      //
      // Committed directly rather than through set(): set() skips the write
      // when the value is unchanged, which would hide a broken comparison
      // here behind a second guard that happens to agree with it. The
      // comparison has to be the only thing stopping an equal-score write, or
      // the test that pins it passes whatever the comparison says.
      if (!Number.isInteger(score) || score <= record.highScore) return false;
      commit({ ...record, highScore: score });
      return true;
    },

    setSoundOn(on) {
      return set('soundOn', Boolean(on));
    },

    setStepMode(on) {
      return set('stepMode', Boolean(on));
    },

    // null hands the decision back to the OS; true and false override it.
    setReducedMotionOverride(value) {
      return set('reducedMotionOverride', value === null ? null : Boolean(value));
    },
  };
}
