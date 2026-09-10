// Phase 7 - the audio edge.
//
// WHAT IS AND IS NOT TESTED HERE, SAID PLAINLY.
//
// The RTTTL parser is logic and is tested properly, in tests/rtttl.test.js.
// What this file covers is the audio edge, in four parts:
//
//   - WHEN a context gets constructed. Never at module load, never while the
//     board is idle, and only on a real gesture. Getting this wrong is an
//     autoplay-policy failure that leaves the game silent for the whole
//     session, and it is invisible until someone opens a browser.
//   - WHETHER a sound gets scheduled at all: muted, hidden, or before the
//     first gesture, nothing is.
//   - THE ENVELOPE CONTRACT. Every voice ramps up from zero at its onset,
//     ramps back to zero at its release, is stopped no earlier than the
//     bottom of that ramp, is started exactly once, and reaches the
//     destination through the highpass and then the lowpass. This is the
//     whole contract rather than the release alone, because a suite that
//     pinned only the release would imply the graph was covered when the
//     onset, the single-use rule and the filter order were not.
//   - That every string in the sound table parses.
//
// WHAT IS STILL NOT COVERED, NAMED SO IT IS NOT MISTAKEN FOR COVERAGE: the
// fake below records automation calls; it does not synthesise. Nothing here
// can say a square wave was audible, that 2.5 ms is long enough to remove the
// click on real hardware, or that the piezo chain sounds like a small speaker
// rather than merely being wired like one. Those are ear questions.

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import {
  createAudio, plausiblyIosAudio, RAMP_MS, VOICE_GAIN, HIGHPASS_HZ, LOWPASS_HZ,
} from '../src/audio/synth.js';
import { ringerHint } from '../src/render/labels.js';
import { createCues } from '../src/audio/cues.js';
import { ALL_SOUNDS, CUES, PULSES, pulseForRampStep } from '../src/audio/sounds.js';
import { parse, frequencyOf } from '../src/audio/rtttl.js';
import { createSession } from '../src/session.js';
import { createStore } from '../src/store.js';
import { createFakeStorage, mulberry32 } from './helpers.js';
import { STORAGE_KEY, SCHEMA_VERSION } from '../src/persist.js';
import { fakeAudio } from './fake-audio.js';

function wire({ soundOn = true, state = 'running' } = {}) {
  const { FakeAudioContext, record } = fakeAudio({ state });
  // Seeded through the real persistence key, so the sound setting reaches the
  // store the way the player's own saved setting does.
  const storage = createFakeStorage({
    [STORAGE_KEY]: JSON.stringify({ version: SCHEMA_VERSION, soundOn }),
  });
  const store = createStore({ storage });
  const audio = createAudio({ Context: FakeAudioContext, audioSession: null });
  audio.setEnabled(store.getState().soundOn);

  const cues = createCues({ audio });
  const session = createSession({
    width: 24,
    height: 18,
    rng: mulberry32(7),
    store,
    view: {
      ticked: cues.ticked,
      turned: cues.turned,
      ended: cues.ended,
    },
  });

  return { audio, cues, session, store, record };
}

describe('every sound in the game is a string that parses', () => {
  it('parses each entry in the table sounds.js actually exports', () => {
    // Iterating the export rather than a list written out here is the whole
    // point: a sound added to CUES or PULSES with a typo in it fails this
    // case, and a sound added to a hand-kept copy of the table would not.
    expect(ALL_SOUNDS.length).toBe(Object.keys(CUES).length + PULSES.length);

    for (const [label, rtttl] of ALL_SOUNDS) {
      let song = null;
      expect(() => { song = parse(rtttl); }, label + ' does not parse').not.toThrow();
      expect(song.notes.length, label + ' has no notes').toBeGreaterThan(0);
      for (const note of song.notes) {
        expect(Number.isFinite(note.frequency)).toBe(true);
        expect(note.durationMs).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every pitch inside the piezo chain it is played through', () => {
    // The chain is a 400 Hz highpass and a 3.8 kHz lowpass. A note written
    // outside that is a note nobody hears, and the format permits octave 4,
    // which is mostly below the highpass. This is the case that stops a sound
    // being added there by habit.
    for (const [label, rtttl] of ALL_SOUNDS) {
      for (const note of parse(rtttl).notes) {
        if (note.rest) continue;
        expect(note.frequency, label + ' is under the highpass').toBeGreaterThan(500);
        expect(note.frequency, label + ' is over the lowpass').toBeLessThan(3500);
      }
    }
  });

  it('gives every ramp step its own pitch, rising as the space closes', () => {
    // Five ramp steps, five pulses, one each, and the pitch has to climb or
    // the sound carries no information about which step it is.
    expect(PULSES).toHaveLength(5);

    const pitches = PULSES.map((rtttl) => parse(rtttl).notes[0].frequency);
    for (let step = 1; step < pitches.length; step++) {
      expect(pitches[step]).toBeGreaterThan(pitches[step - 1]);
    }
    // A5, C6, E6, A6, C7.
    expect(pitches[0]).toBeCloseTo(frequencyOf('a', 5), 3);
    expect(pitches[4]).toBeCloseTo(frequencyOf('c', 7), 3);
  });

  it('throws on a ramp step with no pulse rather than playing the nearest one', () => {
    expect(() => pulseForRampStep(5)).toThrow(/ramp step 5/);
    expect(() => pulseForRampStep(-1)).toThrow(/ramp step -1/);
  });

  it('keeps every name inside the format cap it will be parsed against', () => {
    for (const [label, rtttl] of ALL_SOUNDS) {
      expect(parse(rtttl).name.length, label).toBeLessThanOrEqual(10);
    }
  });
});

describe('no AudioContext is constructed before the first gesture', () => {
  const originals = {};

  beforeEach(() => {
    // A spy standing in for the global constructor. If any module reaches for
    // a global AudioContext at load - which is the mutation this case exists
    // to catch - it lands here and is counted.
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      originals[name] = globalThis[name];
    }
  });

  afterEach(() => {
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      if (originals[name] === undefined) delete globalThis[name];
      else globalThis[name] = originals[name];
    }
    vi.resetModules();
  });

  it('constructs none while the audio modules are being imported', async () => {
    const spy = vi.fn(function FakeContext() {});
    globalThis.AudioContext = spy;
    globalThis.webkitAudioContext = spy;

    // Fresh modules, imported with the spy already installed, so a `new
    // AudioContext()` written at the top level of any of them is caught.
    vi.resetModules();
    await import('../src/audio/rtttl.js');
    await import('../src/audio/sounds.js');
    await import('../src/audio/synth.js');
    await import('../src/audio/cues.js');

    expect(spy).not.toHaveBeenCalled();
  });

  it('constructs none while the board sits idle, however many frames pass', () => {
    const { audio, session, record } = wire();

    // Ten seconds of frames on an idle board. The loop runs and the board
    // draws; the player has not acted, so no tick is bought and no cue fires.
    for (let frame = 0; frame < 600; frame++) session.elapse(16);

    expect(session.lifecycle).toBe('idle');
    expect(session.ticks).toBe(0);
    expect(record.constructed).toBe(0);
    expect(audio.started).toBe(false);
  });

  it('constructs none when a sound is asked for before the gesture', () => {
    // The order the app actually runs in: the wiring exists, sound is on in
    // the settings, and something asks for a cue anyway. Asking must not be
    // what builds the context - only unlock() is.
    const { audio, record } = wire();

    expect(audio.play(CUES.eat)).toBe(false);
    expect(record.constructed).toBe(0);
  });

  it('constructs exactly one on the first gesture, and no more on the next', () => {
    const { audio, record } = wire();

    audio.unlock();
    expect(record.constructed).toBe(1);

    audio.unlock();
    audio.unlock();
    expect(record.constructed).toBe(1);
  });

  it('resumes a suspended context from inside the gesture rather than rebuilding it', () => {
    // Safari hands back a context in the suspended state. resume() has to
    // happen inside the handler for the gesture to count, and a second
    // context is not what a suspended first one needs.
    const { audio, record } = wire({ state: 'suspended' });

    audio.unlock();
    expect(record.constructed).toBe(1);
    expect(record.resumes).toBe(1);

    record.contexts[0].state = 'suspended';
    audio.unlock();
    expect(record.constructed).toBe(1);
    expect(record.resumes).toBe(2);
  });
});

describe('nothing plays that the player has switched off or walked away from', () => {
  it('schedules nothing while sound is off, even after the gesture', () => {
    const { audio, record } = wire({ soundOn: false });

    audio.unlock();
    expect(audio.play(CUES.eat)).toBe(false);
    expect(record.contexts[0].oscillators).toHaveLength(0);
  });

  it('schedules nothing while the tab is hidden', () => {
    // Not merely inaudible: nothing is queued. A hidden tab that keeps
    // scheduling returns with a backlog of notes to play at once.
    const { audio, record } = wire();
    audio.unlock();
    audio.setHidden(true);

    expect(audio.play(CUES.eat)).toBe(false);
    expect(record.contexts[0].oscillators).toHaveLength(0);

    audio.setHidden(false);
    expect(audio.play(CUES.eat)).toBe(true);
    expect(record.contexts[0].oscillators.length).toBeGreaterThan(0);
  });

  it('silences what is already sounding the moment sound is switched off', () => {
    // Muting stops the audio, not the next sound. A mute that waits for the
    // current note to finish is a mute that is late by up to 600 ms, which is
    // the length of the death cue - the one a player is most likely to reach
    // for the toggle during.
    const { audio, record } = wire();
    audio.unlock();
    audio.play(CUES.death);

    const context = record.contexts[0];
    const voices = context.oscillators.length;
    expect(voices).toBeGreaterThan(0);

    context.advance(0.01);
    audio.setEnabled(false);

    // Every voice is stopped, and stopped at the mute rather than at the end
    // of the note it was scheduled to play out.
    for (const oscillator of context.oscillators) {
      expect(oscillator.stopped).not.toBe(null);
      expect(oscillator.stopped).toBeLessThan(0.05);
    }
  });
});

describe('the cues say what happened on the board', () => {
  it('plays the eat cue on a tick that eats and a pulse on one that does not', () => {
    const plays = [];
    const audio = { play: (rtttl) => { plays.push(rtttl); return true; } };
    const cues = createCues({ audio });

    const before = { foodEaten: 3 };
    cues.ticked({ foodEaten: 4 }, before, { rampStep: 0 });
    expect(plays).toEqual([CUES.eat]);

    plays.length = 0;
    cues.ticked({ foodEaten: 3 }, before, { rampStep: 2 });
    expect(plays).toEqual([PULSES[2]]);
  });

  it('plays the high-score fanfare after the death cue, not on top of it', () => {
    const plays = [];
    const audio = { play: (rtttl, options = {}) => { plays.push([rtttl, options.delay || 0]); return true; } };
    const cues = createCues({ audio });

    cues.ended({ status: 'dead' }, { newHighScore: true });

    expect(plays[0][0]).toBe(CUES.death);
    expect(plays[0][1]).toBe(0);
    expect(plays[1][0]).toBe(CUES.highScore);
    // Delayed past the death cue's own 600 ms rather than layered over it.
    expect(plays[1][1]).toBeGreaterThanOrEqual(0.6);
  });

  it('plays the fanfare and no death cue on a filled board, which is a win', () => {
    const plays = [];
    const audio = { play: (rtttl) => { plays.push(rtttl); return true; } };
    const cues = createCues({ audio });

    cues.ended({ status: 'won' }, { newHighScore: false });

    expect(plays).toEqual([CUES.highScore]);
  });
});

describe('the envelope contract, on every voice', () => {
  // A voice's scheduled gain automation, in the order it was scheduled.
  const envelopeOf = (context, oscillator) => oscillator.connections[0].gain.events;

  // Walk the graph from a node to the destination, following the first
  // connection at each hop, and report what kind of node each one was.
  function pathFrom(node) {
    const path = [];
    let current = node;
    while (current && current.kind !== 'destination' && path.length < 12) {
      current = current.connections[0];
      if (!current) break;
      path.push(current);
    }
    return path;
  }

  function sounding() {
    const { audio, record } = wire();
    audio.unlock();
    return { audio, context: record.contexts[0] };
  }

  it('ramps up from zero at the onset and reaches peak within RAMP_MS', () => {
    // A square wave switched on at full amplitude is a step discontinuity, and
    // a step is a click - at these gain levels, louder than the note it is
    // introducing.
    const { audio, context } = sounding();
    audio.play(CUES.death);

    expect(context.oscillators.length).toBeGreaterThan(0);
    for (const oscillator of context.oscillators) {
      const events = envelopeOf(context, oscillator);

      const [start, peak] = events;
      expect(start.type).toBe('set');
      expect(start.value).toBe(0);
      expect(peak.type).toBe('ramp');
      expect(peak.value).toBeGreaterThan(0);
      expect(peak.value).toBe(VOICE_GAIN);

      // The onset begins when the note begins, and the climb is no longer
      // than the ramp the spec names.
      expect(start.time).toBeCloseTo(oscillator.started, 9);
      expect(peak.time - start.time).toBeCloseTo(RAMP_MS / 1000, 9);
    }
  });

  it('ramps back to zero ending at startAt + hold, and stops no earlier', () => {
    // THE RELEASE. It is the half that gets left out, because a note that
    // starts cleanly sounds correct right up until it stops. Remove the two
    // release lines from voice() in src/audio/synth.js and this case is the
    // one that fails.
    const { audio, context } = sounding();
    audio.play(CUES.death);

    for (const oscillator of context.oscillators) {
      const events = envelopeOf(context, oscillator);
      const last = events[events.length - 1];

      expect(last, 'the voice schedules no release at all').toBeDefined();
      expect(last.type, 'the last automation on a voice is not a ramp').toBe('ramp');
      expect(last.value, 'the voice does not ramp back to silence').toBe(0);

      // The release holds peak until RAMP_MS before the end, then falls. Both
      // halves matter: a ramp that started at the onset would be a fade over
      // the whole note rather than a release.
      const hold = events[events.length - 2];
      expect(hold.type).toBe('set');
      expect(hold.value).toBe(VOICE_GAIN);
      expect(last.time - hold.time).toBeCloseTo(RAMP_MS / 1000, 9);

      // The oscillator is not stopped before its own ramp has reached zero.
      // Stopping first would cut the note at whatever amplitude the ramp had
      // got to, which is the click the ramp exists to remove.
      expect(oscillator.stopped).toBeGreaterThanOrEqual(last.time);
    }
  });

  it('starts each oscillator exactly once, across more than ten notes', () => {
    // OscillatorNode is single-use by specification. The fake throws on a
    // second start the way the real node does, so a reused node fails at the
    // call rather than here - and this case pins the count as well, so the
    // rule is asserted rather than merely not violated by accident.
    const { audio, context } = sounding();
    audio.play(CUES.death);      // 4
    audio.play(CUES.highScore);  // 4
    audio.play(CUES.eat);        // 2
    for (const pulse of PULSES) audio.play(pulse); // 5

    expect(context.oscillators.length).toBeGreaterThanOrEqual(10);
    for (const oscillator of context.oscillators) {
      expect(oscillator.startCount).toBe(1);
    }
    // No node appears twice in the start log, which is the same claim read
    // from the other end.
    expect(new Set(context.started).size).toBe(context.started.length);
    expect(context.started.length).toBe(context.oscillators.length);
  });

  it('routes every voice through the highpass and then the lowpass', () => {
    // The piezo chain, and the order is the whole of it: a lowpass before a
    // highpass is the same pair of filters and a different sound. The
    // frequencies are the ones the spec names, and sounds.js is checked
    // against them - a pitch under the highpass is a pitch nobody hears.
    const { audio, context } = sounding();
    audio.play(CUES.eat);

    for (const oscillator of context.oscillators) {
      const path = pathFrom(oscillator);
      const filters = path.filter((node) => node.kind === 'filter');

      expect(filters).toHaveLength(2);
      expect(filters[0].type).toBe('highpass');
      expect(filters[0].frequency.value).toBe(HIGHPASS_HZ);
      expect(filters[1].type).toBe('lowpass');
      expect(filters[1].frequency.value).toBe(LOWPASS_HZ);

      expect(HIGHPASS_HZ).toBe(400);
      expect(LOWPASS_HZ).toBe(3800);

      // And it ends at the destination rather than at a dangling node.
      expect(path[path.length - 1]).toBe(context.destination);
    }
  });

  it('makes a rest occupy time without building a node to hear nothing from', () => {
    // A rest is a frequency of zero and a duration that is not. The gap is the
    // point of it, so no oscillator is created for one.
    const { audio, context } = sounding();
    audio.play('rest:d=8,o=6,b=125:c,p,c');

    expect(context.oscillators).toHaveLength(2);
    // The second sounding note starts two slots in, not one: the rest between
    // them took its time. d=8 at b=125 is 240 ms a note, so two slots is
    // 0.48 s.
    const [first, second] = context.oscillators;
    expect(second.started - first.started).toBeCloseTo(0.48, 6);
  });

  it('gives every voice a square wave', () => {
    const { audio, context } = sounding();
    audio.play(CUES.death);

    for (const oscillator of context.oscillators) {
      expect(oscillator.type).toBe('square');
    }
  });
});

describe('the iOS ringer hint is gated, not furniture', () => {
  // The platform probe main.js takes off navigator and window, as values.
  const IOS = { maxTouchPoints: 5, hasGestureEvent: true, supportsTouchCallout: true };
  const DESKTOP_CHROME = {
    maxTouchPoints: 0, hasGestureEvent: false, supportsTouchCallout: false,
  };
  const MAC_SAFARI = {
    maxTouchPoints: 0, hasGestureEvent: true, supportsTouchCallout: false,
  };
  const TOUCH_WINDOWS = {
    maxTouchPoints: 10, hasGestureEvent: false, supportsTouchCallout: false,
  };

  function hinted({ platform = IOS, audioSession = null, soundOn = true } = {}) {
    const { FakeAudioContext } = fakeAudio();
    const audio = createAudio({ Context: FakeAudioContext, audioSession, platform });
    audio.setEnabled(soundOn);
    return audio.needsRingerHint;
  }

  it('shows on a plausibly-iOS browser with no audioSession and sound on', () => {
    expect(hinted()).toBe(true);
    expect(ringerHint(true)).toMatch(/ringer switch/i);
  });

  it('stays silent where the browser has audioSession, because it is handled', () => {
    // Safari 17 and later. The type is set on the session and Web Audio leaves
    // the ambient channel, so there is nothing to warn about.
    expect(hinted({ audioSession: { type: 'auto' } })).toBe(false);
  });

  it('stays silent where sound is off, because there is nothing being silenced', () => {
    expect(hinted({ soundOn: false })).toBe(false);
  });

  it('stays silent on desktop Chrome and Firefox, which have no ringer switch', () => {
    // The bug this gate fixes: absence of navigator.audioSession means "not
    // Safari 17+", not "iOS". Every desktop Chromium and Firefox was being
    // told about a hardware switch its machine does not have.
    expect(hinted({ platform: DESKTOP_CHROME })).toBe(false);
  });

  it('stays silent on desktop Safari, which is Apple and is not iOS', () => {
    // GestureEvent exists on macOS Safari too, so the Apple signal alone is
    // not enough - this is the case that makes the touch term necessary.
    expect(hinted({ platform: MAC_SAFARI })).toBe(false);
  });

  it('stays silent on a touchscreen Windows laptop, which is touch and not Apple', () => {
    // And this is the case that makes the Apple term necessary. Touch alone
    // would light up every Surface and every Android tablet.
    expect(hinted({ platform: TOUCH_WINDOWS })).toBe(false);
  });

  it('prefers silence when the probe says nothing, rather than guessing', () => {
    // An environment where none of the three can be read - the default - is
    // uncertain, and uncertain is not a reason to show a warning. A hint shown
    // to the wrong platform is worse than no hint: it teaches the reader to
    // ignore the next one.
    expect(hinted({ platform: {} })).toBe(false);
    // And the predicate's own no-argument case, which is what createAudio
    // falls back to when main.js hands it no probe at all.
    expect(plausiblyIosAudio()).toBe(false);
    expect(plausiblyIosAudio({})).toBe(false);
  });

  it('needs both halves of the Apple signal to be absent before it gives up', () => {
    // Either signal on its own is enough for the Apple term; a WebKit browser
    // that dropped GestureEvent would still be caught by the mobile-only
    // -webkit-touch-callout property, and the other way about.
    expect(hinted({
      platform: { maxTouchPoints: 5, hasGestureEvent: true, supportsTouchCallout: false },
    })).toBe(true);
    expect(hinted({
      platform: { maxTouchPoints: 5, hasGestureEvent: false, supportsTouchCallout: true },
    })).toBe(true);
  });

  it('follows the sound toggle without being rebuilt', () => {
    // The hint is re-read whenever the store changes, so switching sound off
    // takes it off the page and switching it back on brings it back.
    const { FakeAudioContext } = fakeAudio();
    const audio = createAudio({
      Context: FakeAudioContext, audioSession: null, platform: IOS,
    });

    audio.setEnabled(true);
    expect(audio.needsRingerHint).toBe(true);
    audio.setEnabled(false);
    expect(audio.needsRingerHint).toBe(false);
    audio.setEnabled(true);
    expect(audio.needsRingerHint).toBe(true);
  });

  it('produces no line at all when it is not needed', () => {
    expect(ringerHint(false)).toBe(null);
  });
});
