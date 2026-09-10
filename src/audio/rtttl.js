// Coil - RTTTL, parsed.
//
// Ring Tone Text Transfer Language, implemented from its published
// specification and written here from scratch:
//
//   http://merwin.bespin.org/t4a/specs/nokia_rtttl.txt
//
// There is no library behind this and there will not be one: the project has
// zero runtime dependencies, and an RTTTL parser is a hundred lines of string
// handling. Nothing in this file touches the DOM, the clock or Web Audio. It
// takes a string and returns numbers - hertz and milliseconds - which is what
// makes every rule below testable without a browser.
//
// A string is `name:controls:notes`. What the format actually permits, as
// opposed to what a lenient parser tends to accept, is narrow, and the narrow
// parts are where the errors are: six note values, four octaves, thirty-two
// tempos, and a name of ten characters.
//
// The one place leniency IS specified is the control section: a parser skips
// control names it does not recognise rather than refusing the tone. That is
// in the spec, it is not a shortcut, and there is a test standing on it.

/** The format's defaults, used for any control the string does not carry. */
export const DEFAULTS = Object.freeze({ duration: 4, octave: 6, bpm: 63 });

/** Note values. A duration is a divisor of a whole note, so 4 is a quarter. */
export const DURATIONS = Object.freeze([1, 2, 4, 8, 16, 32]);

/** The octaves the format permits. Octave 4 is the one holding A = 440 Hz. */
export const OCTAVES = Object.freeze([4, 5, 6, 7]);

/** Names are capped at ten characters and may not contain a colon. */
export const MAX_NAME_LENGTH = 10;

/**
 * The thirty-two tempos the format permits, ascending.
 *
 * Anything else in a `b=` control is snapped to the nearest of these; see
 * `snapBpm` for how a tie resolves.
 */
export const BPMS = Object.freeze([
  25, 28, 31, 35, 40, 45, 50, 56, 63, 70,
  80, 90, 100, 112, 125, 140, 160, 180, 200, 225,
  250, 285, 320, 355, 400, 450, 500, 565, 635, 715,
  800, 900,
]);

// Semitones above C. The format writes sharps and no flats, and only the five
// black keys have a sharp spelling: e# and b# are not notes here, and a test
// names e# specifically because it is the plausible-looking one.
const SEMITONES = Object.freeze({
  c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11,
});

// [duration] note [#] [.] [octave] [.]
//
// The dot is matched on either side of the octave digit. The published format
// puts it at the end of the note; ringtones in the wild write `g.6` at least as
// often as `g6.`, and both mean the same note held half again as long. Two dots
// on one note are matched here and rejected below, rather than being silently
// read as one - a string that says something impossible is a string whose
// author meant something else.
const NOTE = /^(\d{1,2})?([a-gp])(#)?(\.)?(\d)?(\.)?$/;

// name=value, with the name a run of letters. The value is captured raw so an
// unparseable one can be quoted back in the error rather than arriving as NaN.
const CONTROL = /^([a-z]+)=(.*)$/;

function fail(message) {
  throw new SyntaxError('RTTTL: ' + message);
}

/**
 * Equal temperament against A4 = 440 Hz, which is where the format's octave 4
 * sits. Exported because the sound table's pitches are worth checking against
 * a tuner, and a private version of this would be checked against nothing.
 *
 * @param {string} name lower-case note name, optionally with a '#'
 * @param {number} octave
 * @returns {number} hertz
 */
export function frequencyOf(name, octave) {
  const semitone = SEMITONES[name];
  if (semitone === undefined) {
    throw new RangeError('RTTTL: "' + name + '" is not a note name');
  }
  if (!OCTAVES.includes(octave)) {
    throw new RangeError(
      'RTTTL: octave ' + octave + ' is outside the permitted '
      + OCTAVES.join(', '),
    );
  }
  // MIDI numbering, where A4 is 69 and octave n begins at 12 * (n + 1).
  const midi = (octave + 1) * 12 + semitone;
  return 440 * (2 ** ((midi - 69) / 12));
}

/**
 * The permitted tempo nearest to `value`.
 *
 * A TIE - a value exactly between two permitted tempos, such as 106 between
 * 100 and 112 - RESOLVES DOWNWARD. Both neighbours are equally wrong by the
 * only measure there is, so the rule is written here rather than left to fall
 * out of the direction the array happens to be walked. Downward means a note
 * comes out slightly longer than its author asked for, which keeps a two-note
 * cue audible rather than clipping it, and that is the tie-break worth having
 * in a game whose sounds are all under half a second.
 *
 * The strict `<` below is what implements it: scanning ascending, an equal
 * distance never displaces the lower candidate already held.
 */
export function snapBpm(value) {
  let best = BPMS[0];
  let bestDistance = Math.abs(value - best);
  for (const bpm of BPMS) {
    const distance = Math.abs(value - bpm);
    if (distance < bestDistance) {
      best = bpm;
      bestDistance = distance;
    }
  }
  return best;
}

function readControls(section, source) {
  const controls = { ...DEFAULTS };
  if (section === '') return controls;

  for (const entry of section.split(',')) {
    // A trailing comma is a shrug, not an error.
    if (entry === '') continue;

    const match = CONTROL.exec(entry);
    if (match === null) {
      fail('"' + entry + '" is not a control in "' + source + '"');
    }

    const [, name, raw] = match;
    const number = /^\d+$/.test(raw) ? Number(raw) : NaN;

    // UNKNOWN CONTROL NAMES ARE IGNORED. This is in the published spec, not a
    // convenience: a tone written for a handset with an extra control still
    // has to play. What is NOT ignored is a control we DO know carrying a
    // value the format forbids - see each branch below.
    if (name === 'd') {
      if (!DURATIONS.includes(number)) {
        fail(
          'duration "' + raw + '" is not one of ' + DURATIONS.join(', ')
          + ' in "' + source + '"',
        );
      }
      controls.duration = number;
    } else if (name === 'o') {
      if (!OCTAVES.includes(number)) {
        fail(
          'octave "' + raw + '" is not one of ' + OCTAVES.join(', ')
          + ' in "' + source + '"',
        );
      }
      controls.octave = number;
    } else if (name === 'b') {
      if (!Number.isFinite(number) || number <= 0) {
        fail('tempo "' + raw + '" is not a positive number in "' + source + '"');
      }
      // Snapped here, so everything downstream times against a tempo the
      // format actually has rather than against the number in the string.
      controls.bpm = snapBpm(number);
    }
  }

  return controls;
}

function readNote(token, controls, source) {
  const match = NOTE.exec(token);
  if (match === null) {
    fail('malformed note "' + token + '" in "' + source + '"');
  }

  const [, rawDuration, letter, sharp, dotBefore, rawOctave, dotAfter] = match;

  if (dotBefore !== undefined && dotAfter !== undefined) {
    fail('note "' + token + '" is dotted twice in "' + source + '"');
  }

  const rest = letter === 'p';
  if (rest && sharp !== undefined) {
    fail('malformed note "' + token + '": a rest has no pitch to sharpen');
  }

  const duration = rawDuration === undefined ? controls.duration : Number(rawDuration);
  if (!DURATIONS.includes(duration)) {
    fail(
      'note "' + token + '" has duration ' + duration + ', which is not one of '
      + DURATIONS.join(', '),
    );
  }

  const octave = rawOctave === undefined ? controls.octave : Number(rawOctave);
  if (!rest && !OCTAVES.includes(octave)) {
    fail(
      'note "' + token + '" is in octave ' + octave + ', outside the permitted '
      + OCTAVES.join(', '),
    );
  }

  const name = sharp === undefined ? letter : letter + '#';
  if (!rest && SEMITONES[name] === undefined) {
    fail('malformed note "' + token + '": there is no ' + name);
  }

  // A whole note is four beats; a beat is 60000 / bpm milliseconds. So a note
  // of value d lasts (240000 / bpm) / d, and the dot is one and a half of it.
  const dotted = dotBefore !== undefined || dotAfter !== undefined;
  const durationMs = ((240000 / controls.bpm) / duration) * (dotted ? 1.5 : 1);

  return Object.freeze({
    // A rest is a frequency of zero and a duration that is not: the gap is the
    // point of it, so it occupies time and makes no sound.
    frequency: rest ? 0 : frequencyOf(name, octave),
    durationMs,
    rest,
  });
}

/**
 * Parse an RTTTL string.
 *
 * @param {string} source
 * @returns {{ name: string, notes: ReadonlyArray<{ frequency: number,
 *   durationMs: number, rest: boolean }> }}
 * @throws {TypeError} for anything that is not a string
 * @throws {SyntaxError} naming the offending token, for anything malformed
 * @throws {RangeError} for a name over ten characters
 */
export function parse(source) {
  if (typeof source !== 'string') {
    throw new TypeError(
      'RTTTL: parse takes a string; got ' + (source === null ? 'null' : typeof source),
    );
  }

  // Whitespace anywhere is ignored - inside the controls, inside a note, and
  // around the colons. A string pasted out of a file arrives with newlines in
  // it and means the same tone.
  const text = source.replace(/\s+/g, '');
  const sections = text.split(':');

  if (sections.length < 2) {
    fail('"' + source + '" has no colon; the format is name:controls:notes');
  }
  if (sections.length > 3) {
    fail(
      '"' + source + '" has ' + sections.length + ' colon-separated sections; a '
      + 'name may not contain a colon and the format is name:controls:notes',
    );
  }

  // The name keeps its case; the controls and the notes do not need theirs,
  // and a player with caps lock on writes C and means c.
  const name = sections[0];
  if (name.length > MAX_NAME_LENGTH) {
    throw new RangeError(
      'RTTTL: the name "' + name + '" is ' + name.length + ' characters; the '
      + 'format caps a name at ' + MAX_NAME_LENGTH + ' characters',
    );
  }

  // Two sections means the control section was left out entirely, which is the
  // same as an empty one: the format's defaults, d=4, o=6, b=63.
  const controlSection = sections.length === 3 ? sections[1].toLowerCase() : '';
  const noteSection = sections[sections.length - 1].toLowerCase();

  const controls = readControls(controlSection, source);

  if (noteSection === '') {
    fail('"' + source + '" has no notes after its last colon');
  }

  const notes = noteSection
    .split(',')
    .map((token) => readNote(token, controls, source));

  return Object.freeze({ name, notes: Object.freeze(notes) });
}
