// Coil - what the board sounds like.
//
// The mapping from a thing that happened on the board to a string in
// sounds.js. It is separated from src/audio/synth.js because it is the half
// with decisions in it - which sound, and when - while the synth is the half
// with nodes in it, and only one of those two halves can be tested without a
// browser.
//
// No DOM, no globals, no clock. `audio` is anything with a `play(rtttl,
// options)` method, which in the app is the object src/audio/synth.js returns
// and in a test is a three-line stub that records what it was asked for.

import { rampStepFor } from '../core/game.js';
import { CUES, pulseForRampStep } from './sounds.js';

// The death cue is 600 ms. The fanfare waits it out rather than playing over
// it: two melodies at once is one noise, and the news that the run was a best
// is the news the player is most likely to want to hear cleanly.
const FANFARE_DELAY_S = 0.7;

/**
 * @param {object} options
 * @param {object} options.audio anything with `play(rtttl, { delay })`
 */
export function createCues({ audio } = {}) {
  if (!audio || typeof audio.play !== 'function') {
    throw new TypeError('createCues needs something with a play method');
  }

  return {
    /**
     * One tick happened.
     *
     * A tick that ate is an eat, and a tick that did not is the per-tick
     * pulse, pitched by the ramp step. Never both: the eat is the louder news
     * and layering the pulse under it would only muddy the one sound in the
     * game a player is listening for.
     *
     * @param {object} state the board after the tick
     * @param {object} previous the board before it
     * @param {object} [options] `{ rampStep }` for a caller that already has
     *   it; otherwise it is derived here, which is the same computation the
     *   readout and the renderer do from the same function.
     */
    ticked(state, previous, { rampStep = null } = {}) {
      if (previous && state.foodEaten > previous.foodEaten) {
        return audio.play(CUES.eat);
      }
      const step = rampStep === null ? rampStepFor(state) : rampStep;
      return audio.play(pulseForRampStep(step));
    },

    /** A steer was accepted into the turn queue. */
    turned() {
      return audio.play(CUES.turn);
    },

    /**
     * The run ended.
     *
     * A filled board is a win and gets the fanfare alone - playing the death
     * cue for it would be telling the player they lost the game they just
     * won. A death gets the death cue, and a death that was also a new best
     * gets the fanfare after it.
     */
    ended(state, { newHighScore = false } = {}) {
      const won = state.status === 'won';
      if (!won) audio.play(CUES.death);
      if (won || newHighScore) {
        audio.play(CUES.highScore, { delay: won ? 0 : FANFARE_DELAY_S });
      }
    },
  };
}
