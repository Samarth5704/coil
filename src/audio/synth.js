// Coil - the voices.
//
// Web Audio, synthesised only: there is not an audio file in this repo and
// there will not be one. A parsed RTTTL note is a frequency and a duration,
// and this file turns each one into a square-wave oscillator routed through a
// filter chain that behaves roughly like a small piezo speaker.
//
// It names no globals. `AudioContext` arrives as `Context`, and
// `navigator.audioSession` arrives as `audioSession`, both handed in from
// src/main.js, which is the only file in the project allowed to reach for
// `window` or `navigator`. That is not ceremony: it is what lets a test spy on
// the constructor and assert that nothing built one before the player acted.
//
// THE FOUR THINGS THIS FILE HAS TO GET RIGHT
//
// 1. THE RAMPS. A square wave switched on at full amplitude is a step
//    discontinuity, and a step is a click - louder, at these gain levels, than
//    the note it is introducing. 2.5 ms of linear ramp at the onset and 2.5 ms
//    at the release, on every note, no exceptions. The release matters as much
//    as the onset and is the easier one to leave out, because a note that
//    starts cleanly sounds correct right up until it stops.
//
// 2. ONE OSCILLATOR PER NOTE. `OscillatorNode` is single-use by
//    specification: once stopped it cannot be started again, and a pool of
//    them is a pool of nodes that throw. They are cheap. Make one, start it,
//    stop it, drop it.
//
// 3. THE CONTEXT IS BUILT ON A GESTURE. Never at module load, never on the
//    first frame. Every browser's autoplay policy either refuses the context
//    or hands one back suspended, and a context created outside a gesture
//    stays suspended for the life of the page - the game is then silent for
//    the whole session with nothing in the console to say why. The board
//    starting idle is what guarantees a gesture exists to build it on: the
//    player must steer to begin, so there is always a real press behind the
//    first sound.
//
// 4. MUTING IS IMMEDIATE. Not at the end of the current note - the death cue
//    is 600 ms, and the toggle a player reaches for is the one they reach for
//    during it.

import { parse } from './rtttl.js';

/**
 * Onset and release ramp, in milliseconds. The spec's range is 2-3 ms: long
 * enough to remove the step, short enough that a 21 ms tick still has a body
 * between its two ramps.
 */
export const RAMP_MS = 2.5;

/**
 * The piezo chain. A small ceramic speaker passes almost nothing below a few
 * hundred hertz and rolls off hard above a few kilohertz, and running the
 * voices through the same shape is what stops a square wave sounding like a
 * synthesiser pretending to be a small speaker.
 *
 * The idea of routing synthesised voices through a filter chain to imitate a
 * small speaker came from github.com/oddurs/3310 (MIT). The idea, not the
 * code; these values were chosen here and every pitch in sounds.js is checked
 * against them by a test.
 */
export const HIGHPASS_HZ = 400;
export const LOWPASS_HZ = 3800;

/**
 * Peak gain for one voice. Two cues can overlap - a pulse and an eat land on
 * the same tick - so this leaves headroom for a sum rather than assuming one
 * voice at a time.
 */
export const VOICE_GAIN = 0.12;

// Silence between consecutive notes, so two notes at the same pitch articulate
// as two rather than running together into one longer one. Taken out of the
// note's own slot, not added to it, so a parsed duration stays the truth about
// when the next note starts.
const GAP_S = 0.006;

// Scheduling always starts a hair ahead of `currentTime`. A note scheduled at
// exactly now is a note whose onset ramp is already partly in the past, which
// is the click the ramp was there to prevent.
const LOOKAHEAD_S = 0.005;

/**
 * Whether this looks like a browser on iOS or iPadOS, from feature probes
 * rather than from the user-agent string.
 *
 * Two terms, and both are needed:
 *
 * - TOUCH. `maxTouchPoints > 0`. macOS Safari reports 0; iPhone reports 5 and
 *   iPadOS reports 5 even while it is claiming to be a Mac everywhere else.
 * - APPLE. `window.GestureEvent`, a non-standard interface that exists only in
 *   the WebKit family, or `-webkit-touch-callout`, a property mobile WebKit
 *   supports and macOS Safari does not. Either will do; a WebKit release that
 *   dropped one would still be caught by the other.
 *
 * WHAT THIS CAN DISTINGUISH: iOS and iPadOS from desktop Chrome and Firefox
 * (neither term holds), from macOS Safari (Apple holds, touch does not), and
 * from a touchscreen Windows laptop or an Android tablet (touch holds, Apple
 * does not). Chrome and Firefox ON iOS are WebKit underneath and are correctly
 * caught, which is right - they have the same ambient-channel problem.
 *
 * WHAT IT CANNOT: it cannot tell an iPhone from an iPad, and does not try -
 * both have the problem, whether the control is a hardware switch or a Control
 * Centre toggle. It cannot tell whether the switch is actually set to silent,
 * which is not readable from a browser at all, so the hint says "may" and not
 * "is". It cannot survive a browser that spoofs WebKit's non-standard surface,
 * and it is not a security boundary - a false positive here costs one line of
 * text. And it is a proxy either way: nothing here observes the audio session,
 * it observes the shape of the browser and infers the platform.
 *
 * UNCERTAIN MEANS NO. The default is every probe absent, which returns false.
 * A hint shown to the wrong platform is worse than no hint: it is furniture,
 * and it teaches the reader to skip the next one.
 *
 * @param {object} [probe] `{ maxTouchPoints, hasGestureEvent,
 *   supportsTouchCallout }`, read off `navigator` and `window` in main.js
 */
export function plausiblyIosAudio({
  maxTouchPoints = 0, hasGestureEvent = false, supportsTouchCallout = false,
} = {}) {
  const touch = Number(maxTouchPoints) > 0;
  const apple = Boolean(hasGestureEvent) || Boolean(supportsTouchCallout);
  return touch && apple;
}

/**
 * @param {object} options
 * @param {Function} [options.Context] the AudioContext constructor, handed in
 *   from main.js. Absent - an environment with no Web Audio - makes every
 *   method here a no-op that returns false rather than throwing.
 * @param {object} [options.audioSession] `navigator.audioSession`, or null
 *   where the browser does not have it. See `needsRingerHint`.
 * @param {object} [options.platform] the feature probes `plausiblyIosAudio`
 *   reads. Omitted - as it is in every test that is not about the hint - means
 *   no platform evidence, and therefore no hint.
 */
export function createAudio({
  Context = null, audioSession = null, platform = undefined,
} = {}) {
  // Fixed for the life of the page: the probes do not change under a running
  // document, unlike the sound setting, which is read on every ask below.
  const looksLikeIos = plausiblyIosAudio(platform);
  let context = null;
  let master = null;
  let enabled = false;
  let hidden = false;

  // Parsed songs, kept by their source string. The table in sounds.js is small
  // and fixed, so this fills once and never grows: the pulse that fires seven
  // times a second is parsed on the first tick of the session and looked up
  // for the rest of it.
  const songs = new Map();

  // Voices currently scheduled. Held so a mute can reach them; each removes
  // itself when its oscillator ends.
  const voices = new Set();

  function songFor(source) {
    let song = songs.get(source);
    if (song === undefined) {
      // Deliberately not caught. A string in sounds.js that does not parse is
      // a bug in this repo, not a condition to degrade around, and
      // tests/audio.test.js parses the whole table so it cannot reach here.
      song = parse(source);
      songs.set(source, song);
    }
    return song;
  }

  /**
   * Build the context, or resume the one that exists. MUST be called from
   * inside a real gesture handler - a keydown, a pointerdown, a click - and
   * synchronously, because the gesture is only valid for the turn of the event
   * loop it arrived on.
   */
  function unlock() {
    if (context !== null) {
      // An existing context that has gone suspended - a tab switch, an iOS
      // interruption - is resumed rather than replaced. Replacing it would
      // leak the old one and lose nothing but the player's silence.
      if (context.state === 'suspended') {
        try { context.resume(); } catch { /* the gesture was not enough */ }
      }
      return context;
    }
    if (typeof Context !== 'function') return null;

    context = new Context();

    // The piezo chain, built once and shared: every voice connects into
    // `master`, so there is one place to mute and one filter pair rather than
    // a pair per note.
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = HIGHPASS_HZ;

    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = LOWPASS_HZ;

    master = context.createGain();
    master.gain.value = 1;

    master.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(context.destination);

    // FEATURE-DETECTED, NOT ASSUMED. Where the browser has it, saying this is
    // playback is what takes Web Audio off the ambient channel on iOS, which
    // is the channel the hardware ringer switch silences. Where it does not,
    // see `needsRingerHint` - the game says so rather than pretending.
    if (audioSession !== null && typeof audioSession === 'object') {
      try { audioSession.type = 'playback'; } catch { /* not settable here */ }
    }

    if (context.state === 'suspended') {
      try { context.resume(); } catch { /* the gesture was not enough */ }
    }

    return context;
  }

  /**
   * One note: one oscillator, one gain, both dropped when it ends.
   *
   * `startAt` and `seconds` are on the context's own clock. Nothing in this
   * file reads a wall clock - Web Audio's scheduler is the timekeeper, which
   * is what keeps a melody in time while the main thread is busy drawing.
   */
  function voice(frequency, startAt, seconds) {
    const ramp = RAMP_MS / 1000;
    // The release has to finish INSIDE the note's own slot, or the next note
    // starts on top of this one's tail. Floored so a very short note still has
    // room for both ramps and a moment between them.
    const hold = Math.max(seconds - GAP_S, ramp * 2 + 0.002);

    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, startAt);

    const envelope = context.createGain();

    // Onset: silence to peak over RAMP_MS.
    envelope.gain.setValueAtTime(0, startAt);
    envelope.gain.linearRampToValueAtTime(VOICE_GAIN, startAt + ramp);
    // Release: peak to silence over RAMP_MS, ending exactly at the note's end.
    // Omit this and the oscillator stops mid-cycle at full amplitude, which is
    // the same step discontinuity as the onset and clicks just as loudly.
    envelope.gain.setValueAtTime(VOICE_GAIN, startAt + hold - ramp);
    envelope.gain.linearRampToValueAtTime(0, startAt + hold);

    oscillator.connect(envelope);
    envelope.connect(master);

    oscillator.start(startAt);
    // A hair after the ramp reaches zero, so the stop lands in silence.
    oscillator.stop(startAt + hold + 0.001);

    const entry = { oscillator, envelope };
    voices.add(entry);
    oscillator.onended = () => {
      voices.delete(entry);
      try {
        oscillator.disconnect();
        envelope.disconnect();
      } catch { /* already torn down */ }
    };

    return entry;
  }

  /**
   * Play an RTTTL string.
   *
   * Returns false, and schedules nothing at all, when sound is off, the tab is
   * hidden, or the first gesture has not happened yet. Not "plays it silently"
   * - a hidden tab that keeps scheduling comes back with a backlog.
   *
   * @param {string} source an RTTTL string from src/audio/sounds.js
   * @param {object} [options]
   * @param {number} [options.delay] seconds to wait before the first note,
   *   on the audio clock rather than on a timer, so a mute cancels it.
   */
  function play(source, { delay = 0 } = {}) {
    if (!enabled || hidden || context === null || master === null) return false;

    const song = songFor(source);
    let at = context.currentTime + LOOKAHEAD_S + Math.max(0, delay);

    for (const note of song.notes) {
      const seconds = note.durationMs / 1000;
      // A rest occupies its time and makes no sound: no oscillator, and the
      // cursor moves on. Building a silent voice for it would be building a
      // node to hear nothing from.
      if (!note.rest) voice(note.frequency, at, seconds);
      at += seconds;
    }

    return true;
  }

  /**
   * Silence everything now.
   *
   * Now means now: each live voice has its automation cancelled, is ramped
   * down over the same RAMP_MS as a normal release - a mute that cuts is a
   * mute that clicks - and is stopped at the bottom of that ramp rather than
   * at the end of the note it was scheduled to play out.
   */
  function stop() {
    if (context === null) return;
    const now = context.currentTime;
    const ramp = RAMP_MS / 1000;

    for (const { oscillator, envelope } of voices) {
      try {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setValueAtTime(envelope.gain.value, now);
        envelope.gain.linearRampToValueAtTime(0, now + ramp);
        oscillator.stop(now + ramp);
      } catch { /* already ended; onended will drop it */ }
    }
    voices.clear();
  }

  return {
    unlock,
    play,
    stop,

    /** Whether the first gesture has happened and a context exists. */
    get started() {
      return context !== null;
    },

    /** The context, or null. main.js does not use it; tests read the state. */
    get context() {
      return context;
    },

    /**
     * Whether to show the one honest line about the iOS ringer switch.
     *
     * On iOS, Web Audio plays on the ambient channel, which the hardware
     * ringer switch silences while an `<audio>` element is unaffected.
     * `navigator.audioSession` is the API that moves it off that channel.
     * Where the browser does not have it, THERE IS NOTHING THIS CODE CAN DO
     * ABOUT IT - so the game says so, near the sound toggle, rather than
     * claiming to have handled it.
     *
     * THREE CONDITIONS, ALL REQUIRED, AND THE GATE MATTERS AS MUCH AS THE
     * LINE. This originally tested only the first, which was wrong: the
     * absence of `navigator.audioSession` means "not Safari 17 or later", not
     * "iOS", so every desktop Chromium and Firefox was being warned about a
     * hardware switch its machine does not have. A hint shown to everyone is
     * furniture; a hint shown to the wrong platform is worse than silence,
     * because it is the reason the next one gets skipped.
     *
     * 1. The browser has no `audioSession`, so the problem is unfixable here.
     * 2. The platform is plausibly iOS or iPadOS - see `plausiblyIosAudio`,
     *    which says what it can and cannot distinguish. Uncertain means no.
     * 3. Sound is currently on. With sound off there is nothing for a ringer
     *    switch to be silencing, and the line is answering a question the
     *    player is not asking. Read live, so the hint follows the toggle.
     */
    get needsRingerHint() {
      const unhandled = audioSession === null || typeof audioSession !== 'object';
      return unhandled && looksLikeIos && enabled;
    },

    /** The persisted sound setting. Switching it off silences immediately. */
    setEnabled(on) {
      enabled = Boolean(on);
      if (!enabled) stop();
      return enabled;
    },

    /** Tab visibility. Hidden silences and schedules nothing further. */
    setHidden(on) {
      hidden = Boolean(on);
      if (hidden) stop();
      return hidden;
    },

    get enabled() {
      return enabled;
    },

    get hidden() {
      return hidden;
    },
  };
}
