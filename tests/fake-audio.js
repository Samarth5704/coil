// A fake Web Audio context, only as real as the tests need.
//
// This is NOT an attempt to test the Web Audio graph. The graph is plumbing,
// and a fake elaborate enough to prove a square wave came out of a speaker
// would be a synthesiser, not a test. What this exists for is the one audio
// question that IS logic and IS worth pinning: whether an AudioContext gets
// constructed, and when.
//
// So the constructor counts its calls, the nodes record what they were told,
// and nothing here models sound.

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    // Every automation call, in order. Enough for a test to see that a ramp
    // was scheduled at all; not enough to know what it sounds like.
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'ramp', value, time });
    return this;
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancel', time });
    return this;
  }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeOscillator extends FakeNode {
  constructor(context) {
    super(context, 'oscillator');
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.started = null;
    this.startCount = 0;
    this.stopped = null;
    this.onended = null;
  }

  start(when) {
    // OscillatorNode is single-use by specification: the real node throws
    // InvalidStateError on a second start, and a pool of them is a pool of
    // nodes that throw. Modelled rather than merely counted, so reuse
    // anywhere surfaces at the call site instead of at an assertion later.
    if (this.startCount > 0) {
      throw new Error('InvalidStateError: oscillator already started; they are single-use');
    }
    this.startCount++;
    this.started = when;
    this.context.started.push(this);
  }

  stop(when) {
    // Recorded rather than overwritten, so a second stop() - which is what an
    // immediate mute does to a voice already scheduled to end - is visible.
    this.stopped = when;
    this.context.stops.push({ oscillator: this, when });
  }
}

class FakeGain extends FakeNode {
  constructor(context) {
    super(context, 'gain');
    this.gain = new FakeParam(1);
  }
}

class FakeFilter extends FakeNode {
  constructor(context) {
    super(context, 'filter');
    this.type = 'lowpass';
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
  }
}

/**
 * Returns a constructor and the record of what it was asked to do.
 *
 * `record.constructed` is the count the "no AudioContext before the first
 * gesture" case stands on.
 */
export function fakeAudio({ state = 'running' } = {}) {
  const record = { constructed: 0, contexts: [], resumes: 0 };

  class FakeAudioContext {
    constructor() {
      record.constructed++;
      record.contexts.push(this);
      this.state = state;
      this.currentTime = 0;
      this.destination = new FakeNode(this, 'destination');
      this.oscillators = [];
      this.gains = [];
      this.filters = [];
      this.started = [];
      this.stops = [];
    }

    createOscillator() {
      const node = new FakeOscillator(this);
      this.oscillators.push(node);
      return node;
    }

    createGain() {
      const node = new FakeGain(this);
      this.gains.push(node);
      return node;
    }

    createBiquadFilter() {
      const node = new FakeFilter(this);
      this.filters.push(node);
      return node;
    }

    resume() {
      record.resumes++;
      this.state = 'running';
      return Promise.resolve();
    }

    // Not used by the game, but a real context has it and a test that advances
    // the clock reads better than one that assigns to currentTime.
    advance(seconds) {
      this.currentTime += seconds;
    }
  }

  return { FakeAudioContext, record };
}
