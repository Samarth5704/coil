# CLAUDE.md — Coil

Snake where the game shows you how much room you have left. Every tick, a flood
fill from the head gives the reachable free-cell count. That number drives the
colour ramp, the tick pitch, and the score multiplier. Board is 24 × 18, walls
kill, there is no wrap.

**Read `docs/spec.md` at the start of every session.** It is the contract. This
file is the short version and the rules that must never be violated.

## Hard stack constraints

- HTML, CSS, JavaScript. Native ES modules. **No build step, ever.** The
  `index.html` in this repo is the file the browser loads.
- **Zero runtime dependencies.** Not one. Vitest is a dev dependency and ships
  nothing.
- No framework. No TypeScript. No WebGL. No CDN links. No service worker.
- No audio files of any kind. Every sound is synthesised at runtime.
- Canvas 2D only for the play surface.

Adding any dependency, or introducing a build step, is a spec change. Stop and
say so rather than doing it.

## Rules that are never violated

**Purity.** `src/core/` has no DOM, no `Date.now()`, no `Math.random()`, no
`localStorage`, no globals, and imports nothing from outside `src/core/`.
Randomness arrives as an injected `rng()`. Time arrives as an explicit argument
or a tick count. This is the most load-bearing rule in the project.

**Turn queue, not a direction variable.** Direction changes go into a queue of
at most two. Each new entry is validated against the **last queued** direction,
not the current heading. Otherwise a right-moving snake given Up then Left
inside one tick reverses into its own neck.

**Tail-vacate.** The head may enter the cell the tail occupies, because the
tail leaves it on the same tick — unless the head reaches the food on that same
tick. Growth is immediate: on an eating tick the tail is not popped, the snake
is one longer at the end of that tick, and the cell the tail sits in stays
occupied throughout it. The same exception applies inside the flood fill, which
reads it from `tailHeldOnNextMove(state)` rather than restating the rule.

Food never sits on the snake, so the head cannot enter the food cell and the
tail cell on one tick. The eating exception therefore governs the flood fill's
reachable count; it is not a death the head can actually die into.

**Food spawning.** Enumerate free cells and index into that array. Never
`while (occupied) pickRandom()`; it is unbounded and hangs on a full board.
Zero free cells is a win state, handled explicitly.

**Fixed timestep.** An accumulator, never one move per animation frame. Clamp
the accumulated delta to 250 ms per frame so a backgrounded tab does not return
and run three hundred ticks at once. Auto-pause on `visibilitychange`.

**Integer scaling.** One grid cell must be a whole number of device pixels,
computed against `devicePixelRatio`, letterboxed. Fractional scale makes some
cells three device pixels wide and others four, and it is the single most
visible way a pixel-grid game looks wrong. `imageSmoothingEnabled = false`.

**Audio.** 2–3 ms gain ramp at onset and release on every note or it clicks.
The release is the one that gets left out, because a note that starts cleanly
sounds correct right up until it stops — `tests/audio.test.js` pins the whole
envelope, and "ramps back to zero ending at startAt + hold, and stops no
earlier" is the case that fails if it goes. One oscillator per note; they are
single-use, and the fake throws on a second `start()` the way the real node
does. Construct the `AudioContext` on the first real user gesture, not on page
load — `createAudio` builds nothing and `unlock()` is called only from inside a
gesture handler.

**The iOS ringer hint is gated on three conditions, not one.** No
`navigator.audioSession`, **and** a platform that is plausibly iOS
(`plausiblyIosAudio` — touch points plus an Apple/WebKit feature probe, never a
UA string), **and** sound currently on. Absence of `audioSession` means "not
Safari 17+", not "iOS": gating on it alone warned every desktop Chromium and
Firefox about a switch its machine does not have. Uncertain means do not show
it.

Every sound is an RTTTL string in `src/audio/sounds.js`, so sound is data. Every
pitch must clear the piezo chain — a 400 Hz highpass and a 3.8 kHz lowpass — so
octave 4 is inaudible however legal it is, and every tempo must be one of the
format's 32 permitted values or the parser snaps it to one nobody wrote down.
Both are asserted over the exported table. Muting silences what is already
sounding, not the note after it.

**Persistence.** Versioned from the first write, with `migrate()`. Loading
validates and falls back to defaults. An unknown future version is left
untouched on disk and the session runs on defaults — it is never overwritten.
`load(storage)` returns `{ record, writable }`. `writable` is false in exactly
one case: the stored record's version is newer than this build's. The store
carries that flag for the whole session and writes **nothing at all** while it
is false — not the high score, not a settings toggle, nothing. Leaving the
future record alone at load time only satisfies "never overwritten" until the
first toggle the player flips, so the flag, not the load, is what enforces it.
Phase 5 must show one honest line saying preferences will not be saved this
session because the saved data comes from a newer version — it does not fail
silently and it does not offer to overwrite. See `docs/spec.md` phase 3,
"`load` returns a flag, not a bare record".

**One store owns all state and persistence.** Views subscribe. Derived values —
reachable space, multiplier, ramp step, length, tick interval — are computed,
never stored as mutable fields.

**Never re-render a list with `innerHTML`.** Reconcile keyed nodes; `innerHTML`
destroys focus and selection and thrashes layout.

**Modulo.** Any wrapping arithmetic uses `((n % w) + w) % w`. `-1 % 24` is
`-1` in JavaScript.

**Flood fill iteratively**, with an explicit stack. Not recursively.

## Accessibility — a requirement, not a polish pass

- Nothing conveys meaning by colour alone. The five ramp steps sit at only
  1.12–1.43:1 **against each other**, so the reachable count and multiplier are
  always present as DOM text, and the ramp step appears by **name** in the
  game-over summary.
- Contrast is verified by computation. `tools/contrast.mjs` prints actual
  ratios and fails CI below 4.5:1 for anything meaningful. Decorative tokens
  are excluded by name, never by threshold.
- The canvas gets a one-sentence `aria-label` updated on state transitions
  only. **Never put a per-tick value in an aria-live region.**
- **Never name a control the page may not be showing.** The idle instruction
  names the arrow buttons only where `DPAD_MEDIA_QUERY` matches, because the
  d-pad is behind that query; an instruction listing a control the reader does
  not have sends them looking for something that is not there. Same rule as the
  ramp needing its name in text — say what is true for this reader, on this
  page, or do not say it.
- `prefers-reduced-motion` removes flicker, ramp cross-fade and the death
  animation. It never removes the snake's motion — that motion is the
  information.
- Step mode (one tick per keypress) is the affordance that makes this playable
  without a clock. Keep it working.
- Touch targets 44 px minimum, each control with a contextual accessible name.
  No horizontal scroll at 320 px.
- `preventDefault` on game keys only while the game is running and focused.
  Never on Tab, never blanket.

## Attribution

Original game. **No Nokia marks, names, sprites, sounds, palettes or handset
designs anywhere** — not in code, README, repo name or page title. Do not use
the words "exact", "authentic", "pixel-accurate" or "faithful" about any real
device. RTTTL is implemented from its published spec and the parser is written
here from scratch; the spec is cited in the README.

## Working practice

- Tests are named edge cases, not categories. Written before the
  implementation for anything with logic in it.
- One phase per session. Commit and push at the end of each. Do not begin the
  next phase in the same session.
- Commits go straight to `main` through phase 7. From phase 8, when CI exists,
  work goes on a feature branch and merges via a PR with a **merge commit** —
  never a squash. The phase history is the point.
- If a decision changes the design, update `docs/spec.md` and this file in the
  same commit, so the next session does not read a contradiction.
- If something could not be verified, say so plainly. Do not write "handled",
  "ensured" or "should be fine" — give the number or say it is unchecked.
- A bug found and fixed mid-session gets a named regression test, or it will
  revert silently.

## Commands

```
npm test              # Vitest
npm run contrast      # node tools/contrast.mjs
npx serve .           # or any static server; there is no dev server to build
```
