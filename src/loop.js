// Coil — the frame loop.
//
// It takes the frame scheduler as an argument rather than reaching for
// `requestAnimationFrame`, and that one injection is what makes the loop
// testable: rAF hands its callback the timestamp, so the scheduler IS the
// clock. There is no `Date.now()` and no `performance.now()` anywhere in here
// to inject separately — every millisecond this file knows about arrived as
// the argument the scheduler passed in.
//
// The loop holds no game rules. It converts frames into elapsed time and hands
// that to the session, which owns the accumulator and the fixed timestep. What
// it does own is the pause, and the one thing a pause has to get right:
// returning from a hidden tab must not replay the time that passed while it
// was hidden.

export function createLoop({ requestFrame, session, render = () => {}, paused = false }) {
  if (typeof requestFrame !== 'function') {
    throw new TypeError(
      'createLoop needs a requestFrame function; pass window.requestAnimationFrame'
      + ' at the app edge, or a stub in a test',
    );
  }
  if (!session || typeof session.elapse !== 'function') {
    throw new TypeError('createLoop needs a session to spend its frames on');
  }

  let isPaused = Boolean(paused);
  // null means "the next frame is the first one", which makes its delta zero:
  // the clock starts from that frame rather than from whenever the last one
  // happened to be.
  let lastFrame = null;
  let frames = 0;

  function frame(now) {
    // Scheduled first, so a throw below cannot end the loop silently.
    requestFrame(frame);
    frames++;

    if (lastFrame === null) lastFrame = now;
    const delta = now - lastFrame;
    lastFrame = now;

    // The session clamps the delta it accepts. A tab that was hidden for
    // forty seconds returns with a forty-second frame, and without the clamp
    // that is three hundred ticks inside one frame — the player comes back to
    // a corpse. Below, the pause has already dropped that time entirely; the
    // clamp is what covers the hidden tab that never fired visibilitychange.
    if (!isPaused) session.elapse(delta);

    render(now);
  }

  return {
    start() {
      requestFrame(frame);
    },

    /**
     * Pause and resume. Resuming forgets when the last frame was, so the first
     * frame back has a delta of zero: time that passed while the tab was
     * hidden is not time the player was playing, and it is dropped rather than
     * caught up.
     */
    setPaused(next) {
      const value = Boolean(next);
      if (isPaused === value) return false;
      isPaused = value;
      lastFrame = null;
      return true;
    },

    isPaused: () => isPaused,
    get frames() {
      return frames;
    },
  };
}
