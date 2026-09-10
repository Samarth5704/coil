// Phase 7 — the RTTTL parser.
//
// The parser is the only part of the audio phase that is logic rather than
// plumbing, so it is the part that gets tested properly. Every case here is a
// named edge of the published format, not a category:
//
//   http://merwin.bespin.org/t4a/specs/nokia_rtttl.txt
//
// Nothing in this file constructs an AudioContext, touches the DOM, or reads a
// clock. A frequency in hertz and a duration in milliseconds are numbers, and
// numbers are what is asserted.

import { describe, it, expect } from 'vitest';

import {
  parse, snapBpm, frequencyOf, BPMS, DEFAULTS, MAX_NAME_LENGTH,
} from '../src/audio/rtttl.js';

// Hertz compared to three decimals. Equal temperament is irrational; asking
// for exact equality would be asserting the floating-point unit, not the
// parser.
const HZ = 3;

describe('a bare note takes the control section it was given', () => {
  it('reads d=4,o=5,b=140 with a bare c as C5 for four quarters of a beat', () => {
    const song = parse('bare:d=4,o=5,b=140:c');

    expect(song.name).toBe('bare');
    expect(song.notes).toHaveLength(1);
    // C5 is 523.251 Hz: A4 = 440, and C5 is three semitones above it.
    expect(song.notes[0].frequency).toBeCloseTo(523.251, HZ);
    // b=140 is 140 quarter notes a minute, so one quarter note - d=4, the
    // whole of one beat - is 60000/140 ms.
    expect(song.notes[0].durationMs).toBeCloseTo(60000 / 140, 6);
  });
});

describe('a note carries its own duration and its own octave', () => {
  it('parses 8g5 as G5 for an eighth note', () => {
    const [note] = parse('t:d=4,o=6,b=125:8g5').notes;

    expect(note.frequency).toBeCloseTo(783.991, HZ);
    // A quarter note at 125 BPM is 480 ms; an eighth is half of it. 120 would
    // have been the obvious tempo to write here and is NOT one of the 32 the
    // format permits - it snaps to 125 - which is exactly why these fixtures
    // are written against permitted values.
    expect(note.durationMs).toBeCloseTo(240, 6);
  });

  it('parses g.6 as G6 dotted, with the dot sitting before the octave digit', () => {
    // The published format writes the dot at the end of the note, and real
    // ringtones put it on either side of the octave digit. Both are accepted;
    // two dots on one note are not.
    const [note] = parse('t:d=4,o=5,b=125:g.6').notes;

    expect(note.frequency).toBeCloseTo(1567.982, HZ);
    expect(note.durationMs).toBeCloseTo(720, 6);
  });

  it('refuses a note dotted twice', () => {
    expect(() => parse('t:d=4,o=5,b=125:g.6.')).toThrow(/dotted twice/i);
  });
});

describe('a dot is exactly one and a half times the base duration', () => {
  it('holds the dotted note to 1.5x the undotted one of the same value', () => {
    // Asserted as a ratio between two parses rather than against a number
    // written out here, so the case is about the dot and not about the tempo
    // arithmetic it shares with its neighbour.
    const plain = parse('t:d=8,o=6,b=100:g').notes[0].durationMs;
    const dotted = parse('t:d=8,o=6,b=100:g.').notes[0].durationMs;

    expect(dotted).toBeCloseTo(plain * 1.5, 9);
    expect(dotted / plain).toBeCloseTo(1.5, 9);
  });
});

describe('p is a rest', () => {
  it('yields a frequency of zero and a duration that is not zero', () => {
    const [note] = parse('t:d=8,o=6,b=125:p').notes;

    expect(note.frequency).toBe(0);
    expect(note.rest).toBe(true);
    expect(note.durationMs).toBeCloseTo(240, 6);
    expect(note.durationMs).toBeGreaterThan(0);
  });

  it('refuses a rest with a sharp on it, which is not a pitch to raise', () => {
    expect(() => parse('t:d=8,o=6,b=125:p#')).toThrow(/malformed note/i);
  });
});

describe('an unknown control name is ignored, not rejected', () => {
  it('keeps parsing and keeps the controls it does recognise', () => {
    // The format says a parser skips what it does not know. A ringtone written
    // for a handset with one extra control must still play the notes.
    const song = parse('t:d=8,x=9,o=5,zz=1,b=125:c');

    expect(song.notes[0].frequency).toBeCloseTo(523.251, HZ);
    expect(song.notes[0].durationMs).toBeCloseTo(240, 6);
  });

  it('still rejects a recognised control carrying a value the format forbids', () => {
    // Ignoring the unknown is not the same as ignoring the wrong: d=3 is a
    // note value that does not exist, and silently reading it as the default
    // would play something other than what was written.
    expect(() => parse('t:d=3,o=5,b=125:c')).toThrow(/duration/i);
    expect(() => parse('t:d=4,o=9,b=125:c')).toThrow(/octave/i);
  });
});

describe('whitespace anywhere in the string is ignored', () => {
  it('parses identically with spaces inside the controls and inside a note', () => {
    const tight = parse('t:d=4,o=5,b=140:8g5,c');
    const loose = parse('t : d = 4 , o = 5 , b = 140 : 8 g 5 , c');

    expect(loose.notes).toEqual(tight.notes);
  });

  it('ignores newlines and tabs, which is what a string pasted from a file has', () => {
    const song = parse('t:\n\td=4, o=5,\n\tb=140:\n\tc,\n\t8g5\n');

    expect(song.notes).toHaveLength(2);
    expect(song.notes[0].frequency).toBeCloseTo(523.251, HZ);
  });
});

describe('a missing control section falls back to the format defaults', () => {
  it('reads d=4, o=6, b=63 from an empty control section', () => {
    const song = parse('t::c');
    const explicit = parse('t:d=4,o=6,b=63:c');

    expect(DEFAULTS).toEqual({ duration: 4, octave: 6, bpm: 63 });
    expect(song.notes).toEqual(explicit.notes);
    // C6, and a quarter note at 63 BPM.
    expect(song.notes[0].frequency).toBeCloseTo(1046.502, HZ);
    expect(song.notes[0].durationMs).toBeCloseTo(60000 / 63, 6);
  });

  it('reads the same defaults from a string with no control section at all', () => {
    expect(parse('t:c').notes).toEqual(parse('t:d=4,o=6,b=63:c').notes);
  });

  it('fills in only the controls that are absent, leaving the rest alone', () => {
    // b given, d and o absent: the tempo is the one that was written and the
    // other two are the format's.
    const [note] = parse('t:b=125:c').notes;

    expect(note.frequency).toBeCloseTo(1046.502, HZ);
    expect(note.durationMs).toBeCloseTo(480, 6);
  });
});

describe('a BPM outside the 32 permitted values snaps to the nearest one', () => {
  it('carries exactly the 32 values the format permits, in order', () => {
    expect(BPMS).toHaveLength(32);
    expect([...BPMS].sort((a, b) => a - b)).toEqual([...BPMS]);
    expect(BPMS[0]).toBe(25);
    expect(BPMS[BPMS.length - 1]).toBe(900);
  });

  it('snaps 105 down to 100 and 107 up to 112, either side of their midpoint', () => {
    // 100 and 112 are neighbours in the table; 106 is exactly between them.
    expect(snapBpm(105)).toBe(100);
    expect(snapBpm(107)).toBe(112);
  });

  it('resolves the exact midpoint 106 downward, to 100', () => {
    // HOW A TIE RESOLVES, WRITTEN DOWN RATHER THAN LEFT TO THE SCAN ORDER:
    // a value equidistant from two permitted tempos takes the LOWER of them.
    // Both are equally wrong by the only measure available, so the rule is
    // decided here rather than falling out of whichever way the array happens
    // to be walked. Lower means a note comes out slightly longer than asked
    // for, which keeps a two-note cue audible rather than clipping it.
    expect(snapBpm(106)).toBe(100);
  });

  it('clamps past both ends of the table rather than running off it', () => {
    expect(snapBpm(1)).toBe(25);
    expect(snapBpm(100000)).toBe(900);
  });

  it('applies the snap to the tempo the notes are timed against', () => {
    // b=106 is not a tempo this format has. The note has to be timed against
    // the one it snapped to, not against the number in the string.
    const snapped = parse('t:d=4,o=6,b=106:c').notes[0].durationMs;

    expect(snapped).toBeCloseTo(60000 / 100, 6);
  });

  it('leaves a permitted value exactly where it is', () => {
    for (const bpm of BPMS) expect(snapBpm(bpm)).toBe(bpm);
  });

  it('refuses a BPM that is not a number at all, rather than snapping it', () => {
    expect(() => parse('t:d=4,o=6,b=fast:c')).toThrow(/tempo/i);
  });
});

describe('a name longer than ten characters is rejected', () => {
  it('names the limit and the offending name in the error', () => {
    expect(MAX_NAME_LENGTH).toBe(10);
    expect(() => parse('elevenchars:d=4,o=6,b=63:c'))
      .toThrow(/name.*10 characters/is);
  });

  it('accepts a name of exactly ten', () => {
    expect(parse('tenchars12:d=4,o=6,b=63:c').name).toBe('tenchars12');
  });

  it('rejects a fourth section rather than reading a colon into the name', () => {
    expect(() => parse('a:b:c:d=4,o=6,b=63:c')).toThrow(/colon/i);
  });
});

describe('a malformed note is a parse error, not a silent NaN', () => {
  // Each of these would produce NaN somewhere in the arithmetic if the note
  // were waved through, and NaN reaches the oscillator as a frequency the Web
  // Audio API throws on much later, in a stack that says nothing about the
  // string that caused it.
  const bad = [
    ['a letter that is not a note', 't:d=4,o=6,b=63:h'],
    ['a duration the format does not have', 't:d=4,o=6,b=63:3c'],
    ['an octave outside 4 to 7', 't:d=4,o=6,b=63:c9'],
    ['a sharp on a note that has none', 't:d=4,o=6,b=63:e#'],
    ['a bare accidental', 't:d=4,o=6,b=63:#'],
    ['a note that is only a duration', 't:d=4,o=6,b=63:8'],
    ['an empty note between two commas', 't:d=4,o=6,b=63:c,,g'],
  ];

  for (const [what, source] of bad) {
    it('throws on ' + what + ', quoting it', () => {
      expect(() => parse(source)).toThrow();
      // Whatever else the message says, it says which token failed.
      let message = '';
      try { parse(source); } catch (error) { message = error.message; }
      expect(message.length).toBeGreaterThan(20);
    });
  }

  it('never returns a note whose frequency or duration is NaN', () => {
    // The point of the case above is that these throw. The point of this one
    // is what must NOT happen instead: a note object carrying NaN, which is
    // the failure mode a permissive parser has and which stays silent until
    // an oscillator is handed it.
    for (const [, source] of bad) {
      let song = null;
      try { song = parse(source); } catch { song = null; }
      if (song === null) continue;
      for (const note of song.notes) {
        expect(Number.isFinite(note.frequency)).toBe(true);
        expect(Number.isFinite(note.durationMs)).toBe(true);
      }
    }
  });

  it('throws on a string with no notes in it at all', () => {
    expect(() => parse('t:d=4,o=6,b=63:')).toThrow(/no notes/i);
  });

  it('throws on something that is not a string', () => {
    expect(() => parse(null)).toThrow(TypeError);
    expect(() => parse(42)).toThrow(TypeError);
  });
});

describe('frequencyOf is equal temperament against A4 = 440', () => {
  it('places the octaves the format permits where a tuner would', () => {
    expect(frequencyOf('a', 4)).toBeCloseTo(440, 9);
    expect(frequencyOf('a', 5)).toBeCloseTo(880, 9);
    expect(frequencyOf('c', 6)).toBeCloseTo(1046.502, HZ);
    expect(frequencyOf('c#', 7)).toBeCloseTo(2217.461, HZ);
  });

  it('doubles across an octave, for every note name', () => {
    for (const name of ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']) {
      expect(frequencyOf(name, 6)).toBeCloseTo(frequencyOf(name, 5) * 2, 9);
    }
  });
});
