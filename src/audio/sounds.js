// Coil - every sound in the game, as data.
//
// Nothing in here is code. Each sound is one RTTTL string, parsed by
// src/audio/rtttl.js and played by src/audio/synth.js, which means changing
// how the game sounds is editing a line of text rather than editing a
// synthesiser. It also means every sound is checkable: tests/audio.test.js
// iterates the table below and parses each entry, so a sound added with a
// typo in it fails the suite instead of failing silently in a browser at the
// moment the player eats an apple.
//
// TWO CONSTRAINTS SHAPED THE PITCHES, AND BOTH ARE PHYSICAL:
//
// 1. The voices run through the piezo chain in synth.js - a highpass at
//    400 Hz and a lowpass at 3.8 kHz. Anything written below about 500 Hz is
//    attenuated to nothing by the time it reaches the speaker, so octave 4,
//    though the format permits it, is where notes go to be inaudible. Every
//    pitch here sits between 523 Hz and 2093 Hz, inside the passband.
//
// 2. Every tempo below is one of the format's 32 permitted values. Writing
//    b=120 - the obvious tempo, and not one of them - would have been snapped
//    to 125 by the parser, and the sound would then have been timed against a
//    number nobody wrote down. The values here are the values that play.
//
// No sound is longer than 600 ms. The tick interval floors at 70 ms, so a cue
// that outlasts its own tick would still be sounding when the next one starts.

/**
 * The event cues: something happened, and it is worth a sound.
 *
 * `turn` is deliberately the shortest and highest thing here. It fires on
 * every accepted steer, which at speed is several a second, and anything with
 * a shape to it becomes noise at that rate.
 */
export const CUES = Object.freeze({
  // Two notes up, a fifth apart, 42 ms each. Short enough to land inside one
  // tick at full speed.
  eat: 'eat:d=32,o=6,b=180:c7,g7',

  // One 21 ms tick at C7. A confirmation, not a melody.
  turn: 'turn:d=32,o=7,b=355:c',

  // Falling: C6, A5, F5, then C5 held twice as long. 600 ms in total, which is
  // the longest sound in the game and the only one that has room to be one.
  death: 'death:d=16,o=6,b=125:c,a5,f5,8c5',

  // Rising, the mirror of death: a C major arpeggio landing on C7. Played on a
  // new best score and on a filled board.
  highScore: 'highscore:d=16,o=6,b=160:c,e,g,8c7',
});

/**
 * The per-tick pulse, one string per ramp step.
 *
 * The pitch is derived from `rampStepFor` - five ramp steps, five pitches,
 * rising as the space around the snake closes. This is the sound half of the
 * thing the whole game is about: the colour says confinement to a player who
 * can separate 1.12:1, the readout says it in words, and this says it to a
 * player who is looking at the board rather than at the panel.
 *
 * A5, C6, E6, A6, C7 - an A minor shape climbing two octaves, so consecutive
 * steps are far enough apart to be told apart by ear rather than merely
 * measured apart in hertz. All five are 21 ms at b=355.
 */
export const PULSES = Object.freeze([
  'pulse0:d=32,o=5,b=355:a', //   880.00 Hz - calm
  'pulse1:d=32,o=6,b=355:c', //  1046.50 Hz - close
  'pulse2:d=32,o=6,b=355:e', //  1318.51 Hz - tight
  'pulse3:d=32,o=6,b=355:a', //  1760.00 Hz - hot
  'pulse4:d=32,o=7,b=355:c', //  2093.00 Hz - sealed
]);

/**
 * The pulse for a ramp step, 0 to 4.
 *
 * Throws rather than clamping. A step outside the range means `rampStepFor`
 * and this table have come apart, and playing the nearest sound would hide
 * that - the same reasoning as `rampFor` in src/render/labels.js, which
 * throws on a step that has no name.
 */
export function pulseForRampStep(step) {
  const sound = PULSES[step];
  if (sound === undefined) {
    throw new RangeError(
      'ramp step ' + step + ' has no pulse; there are ' + PULSES.length,
    );
  }
  return sound;
}

/**
 * Every sound in the game, as `[label, rtttl]` pairs.
 *
 * The one thing a test can iterate to prove the table is playable. It is built
 * FROM the two exports above rather than being a third list written by hand,
 * so a sound added to either is a sound the suite parses; a hand-maintained
 * copy would be a list of the sounds somebody remembered to add.
 */
export const ALL_SOUNDS = Object.freeze([
  ...Object.entries(CUES),
  ...PULSES.map((rtttl, step) => ['pulse' + step, rtttl]),
].map(Object.freeze));
