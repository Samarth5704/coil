// Coil — persistence.
//
// This file never reaches for localStorage, and never for `window` at all.
// Both load() and save() take the storage object as an explicit parameter, so
// tests inject a fake and no test touches real browser storage. The one call
// site that passes window.localStorage in lives at the app's edge, and it does
// not exist until phase 5.
//
// A storage object is anything with getItem / setItem / removeItem.

// One key. Namespaced so it cannot collide with anything else served from the
// same origin, and unversioned on purpose: the version lives inside the record
// where migrate() can read it, not in the key. A version in the key would
// orphan the old record on every bump instead of upgrading it.
export const STORAGE_KEY = 'coil.save';

// Present from the first commit that writes anything.
export const SCHEMA_VERSION = 1;

// The whole of what is persisted. An in-progress game is not here and is not
// persisted: a half-played board restored under you is worse than a fresh one.
//
// Each field carries its own validator, so a value of the wrong type falls
// back to that field's default rather than being coerced or passed through.
// The order of this array is the order the fields are written in, which is
// what makes a load-then-save round trip byte-identical.
const FIELDS = [
  {
    name: 'highScore',
    fallback: 0,
    valid: (v) => Number.isInteger(v) && v >= 0,
  },
  {
    name: 'soundOn',
    fallback: true,
    valid: (v) => typeof v === 'boolean',
  },
  {
    // null means follow the OS's prefers-reduced-motion; true and false are
    // the player overriding it in either direction.
    name: 'reducedMotionOverride',
    fallback: null,
    valid: (v) => v === null || typeof v === 'boolean',
  },
  {
    name: 'stepMode',
    fallback: false,
    valid: (v) => typeof v === 'boolean',
  },
];

export function defaultRecord() {
  const record = { version: SCHEMA_VERSION };
  for (const field of FIELDS) record[field.name] = field.fallback;
  return Object.freeze(record);
}

// Brings a record at any known version up to SCHEMA_VERSION, filling in every
// field that is missing or the wrong type with that field's default. There is
// only one schema so far, so today that is the whole of it; a version 2 would
// add its step here and the field table would grow a default that a version 1
// record then gains for free.
//
// Idempotent, and it always builds the record in FIELDS order, so migrating an
// already-migrated record produces the identical bytes.
export function migrate(record) {
  const source = (record !== null && typeof record === 'object') ? record : {};
  const out = { version: SCHEMA_VERSION };
  for (const field of FIELDS) {
    const value = source[field.name];
    out[field.name] = field.valid(value) ? value : field.fallback;
  }
  return Object.freeze(out);
}

// Private mode throws on read on some browsers, not only on write.
function readRaw(storage) {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Returns { record, writable }.
//
// `writable` is false for exactly one case: a record written by a newer
// version of the game. That record is left untouched — load never writes — and
// the flag carries the same protection forward, so the first setting the
// player changes in this session cannot clobber it either. The session runs on
// defaults; their newer install still has its data when they go back to it.
export function load(storage) {
  const raw = readRaw(storage);
  if (typeof raw !== 'string') return { record: defaultRecord(), writable: true };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { record: defaultRecord(), writable: true };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { record: defaultRecord(), writable: true };
  }

  const version = parsed.version;
  if (!Number.isInteger(version) || version < 1) {
    return { record: defaultRecord(), writable: true };
  }
  if (version > SCHEMA_VERSION) {
    return { record: defaultRecord(), writable: false };
  }

  return { record: migrate(parsed), writable: true };
}

// Returns true when the bytes reached storage, false when the write was
// refused. A refused write is not an error the game can do anything about:
// quota exhausted, or a private window where setItem throws on every call. The
// caller keeps its in-memory state either way and carries on.
export function save(storage, record) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(migrate(record)));
    return true;
  } catch {
    return false;
  }
}
