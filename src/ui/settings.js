// Coil — the settings panel.
//
// Real form controls, found in the markup and wired to the store. It builds
// nothing and it assigns no innerHTML; the labels are in index.html where a
// <label for> can point at an input that exists.
//
// The only logic in here is the reduced-motion control, and it is the one
// place a settings panel of three toggles can be got wrong. The persisted
// value has three states — null, true, false — and a checkbox has two. A
// checkbox therefore cannot express "follow the OS", which is the default and
// the state most players should stay in, so this is a select and the mapping
// between its values and the record's is written out and tested rather than
// left to a coercion.

// value, and the wording the option carries in index.html. The order is the
// order of the options in the markup.
export const MOTION_CHOICES = Object.freeze([
  { value: 'system', override: null, label: 'Follow my system setting' },
  { value: 'on', override: true, label: 'Always reduce motion' },
  { value: 'off', override: false, label: 'Never reduce motion' },
].map(Object.freeze));

/** 'system' | 'on' | 'off' → null | true | false. Anything else → null. */
export function overrideFromChoice(value) {
  const choice = MOTION_CHOICES.find((c) => c.value === value);
  // Unknown falls back to following the OS rather than to an override: an
  // unrecognised value is not a decision the player made, and the absence of
  // a decision is exactly what null means.
  return choice === undefined ? null : choice.override;
}

/** null | true | false → 'system' | 'on' | 'off'. Anything else → 'system'. */
export function choiceFromOverride(override) {
  const choice = MOTION_CHOICES.find((c) => c.override === override);
  return choice === undefined ? 'system' : choice.value;
}

function requireControl(root, name) {
  const node = root.querySelector(`[data-setting="${name}"]`);
  if (!node) {
    throw new Error(
      `settings: no control with data-setting="${name}" under the root element`,
    );
  }
  return node;
}

export function createSettings({ root, store } = {}) {
  if (!root || typeof root.querySelector !== 'function') {
    throw new TypeError('createSettings needs a root element to look its controls up in');
  }
  if (!store || typeof store.getState !== 'function') {
    throw new TypeError('createSettings needs the store');
  }

  const sound = requireControl(root, 'sound');
  const stepMode = requireControl(root, 'stepMode');
  const motion = requireControl(root, 'reducedMotion');

  // The store is the source of truth in both directions: a control writes to
  // it, and every control reads back from it on the notification that follows.
  // Nothing here keeps a copy, so a setting changed from anywhere shows here.
  function sync() {
    const record = store.getState();
    sound.checked = record.soundOn;
    stepMode.checked = record.stepMode;
    motion.value = choiceFromOverride(record.reducedMotionOverride);
  }

  sound.addEventListener('change', () => store.setSoundOn(sound.checked));
  stepMode.addEventListener('change', () => store.setStepMode(stepMode.checked));
  motion.addEventListener('change', () => {
    store.setReducedMotionOverride(overrideFromChoice(motion.value));
  });

  store.subscribe(sync);
  sync();

  return { sync, controls: { sound, stepMode, motion } };
}
