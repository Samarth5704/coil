# Coil — specification

## The idea

Snake, where the game tells you the thing snake never told you: how much room
you have left.

Every tick, the engine flood-fills the cells reachable from the snake's head.
That single integer is the honest measure of danger. Players do not die because
they touched their tail; they die because they sealed a pocket four moves ago
and could not see it. Classic snake hides this. Coil makes it the centre of the
game.

Reachable space drives three things at once:

- **Colour.** A four-step ramp from calm to sealed.
- **Sound.** The tick beep rises in pitch as space closes.
- **Score.** The multiplier is bound to how confined you are, so playing in
  tight space is worth more. The apple in the open is worth 1×; the apple you
  take with forty cells left is worth 5×.

The player is therefore paid for taking the risk they can see. That is the
whole design. Everything in this spec exists to serve it or to keep it honest.

Board is 24 × 18 (432 cells). Walls kill; there is no wrap. Wrapping was
considered and rejected: it relieves corner pressure, and a wrapping board is
much harder to seal yourself into, which makes the entire confinement system
quieter.

---

## Stack — hard constraints

Allowed:

- HTML, CSS, JavaScript. ES modules, native, no bundler.
- Canvas 2D for the play surface.
- `localStorage` for persistence.
- Web Audio API for sound, synthesised only.
- Vitest for tests (dev dependency only; ships nothing).
- GitHub Actions for CI and Pages.

Forbidden, explicitly:

- **No build step.** No Vite, no Rollup, no esbuild, no bundler of any kind.
  The `index.html` in the repo is the one the browser loads.
- **No framework.** No React, Vue, Svelte, Preact, lit, Alpine.
- **No TypeScript.** The domain here is a grid, a turn queue and a flood fill.
  That is not enough complexity to earn a compile step.
- **No WebGL.** Beyond being unnecessary, `image-rendering: pixelated` does not
  apply to a WebGL canvas in Safari or iOS Safari (WebKit bug 193895).
- **No runtime dependencies at all.** Not lodash, not a tween library, not a
  colour library, not an RTTTL parser from npm. If it is needed, it is written
  here.
- **No audio files.** Every sound is synthesised at runtime. No `.mp3`, `.wav`,
  `.ogg` in the repo.
- **No sprite sheets or fonts ripped from any existing game.**
- **No CDN links.** Nothing is fetched from a third-party origin at runtime.
- **No analytics, no telemetry, no service worker, no payment code.**

Any new dependency, of any kind, is a spec change and must be raised before it
is added.

---

## Attribution, stated honestly

Coil is an original game. It is not a recreation of, port of, or homage
requiring permission from any existing product.

- The **snake genre** originates with Blockade (Gremlin Industries, 1976) and
  reached most people through Snake (Nokia 6110, 1997, written by Taneli
  Armanto) and Snake II (Nokia 7110 1998, Nokia 3310 2000). Coil takes the
  genre and none of the assets.
- **No Nokia marks, product names, sprites, sounds, palettes or handset
  designs appear anywhere in this project** — not in the code, not in the
  README, not in the repo name, not in the page title.
- The **RTTTL format** (Ring Tone Text Transfer Language) is implemented from
  its published specification. The parser is written here from scratch. The
  README cites the spec: http://merwin.bespin.org/t4a/specs/nokia_rtttl.txt
- The **retro aesthetic** is an original design, not a reproduction of any
  specific hardware. The README must not use the words "exact", "authentic",
  "pixel-accurate" or "faithful" about any real device. Every such claim found
  in the prior art during research turned out to be false when checked.
- **Prior art consulted:** github.com/oddurs/3310 (MIT). No code was taken. One
  idea was: routing synthesised voices through a bandpass chain to imitate a
  small speaker. Credited in the README as an idea, not as code.

---

## Non-negotiable technical rules

These are this project's specific hazards, not general advice.

### Purity

`src/core/` has no DOM access, no `Date.now()`, no `Math.random()`, no
`localStorage`, no globals, no imports from outside `src/core/`. Every function
takes its inputs explicitly. Randomness enters as an injected `rng()` function.
Time enters as an explicit `now` argument or a tick count. This is what makes
the flood fill and the tick engine testable, and it is the single most
load-bearing rule in the project.

### The turn queue

The snake's direction is **never** a single variable validated against the
current heading. A player moving right who presses Up then Left within one tick
would reverse into their own neck. Direction changes go into a queue of at most
two entries; each new entry is validated against the **last queued** direction,
not the current one. The queue is drained one entry per tick.

### The tail-vacate rule

The cell the tail currently occupies is legal for the head to enter, because
the tail leaves it on the same tick — **unless** the head reaches the food on
that same tick. Growth is immediate: on an eating tick the tail is not popped,
the snake is one longer at the end of that tick, and the cell the tail sits in
stays occupied throughout it. Collision detection that tests the head against
the whole body without the vacate exception produces the most complained-about
bug in snake clones. The same exception applies inside the flood fill: the tail
cell counts as reachable except on a tick that eats.

Because food only ever spawns into an enumerated free cell, and the body only
ever occupies cells the head has already eaten its way through, food never sits
on the snake. The head therefore cannot enter the food cell and the tail cell
on the same tick, and the eating exception governs the flood fill's reachable
count rather than a death the head can reach. `tailHeldThisTick(state)` is the
single expression of it, and `tick` calls that same function, so the engine and
the flood fill cannot drift apart.

### Food spawning

Never by rejection sampling. `while (occupied) pickRandom()` is unbounded and
hangs the tab on a nearly full board. Enumerate free cells into an array and
index into it with `rng()`. A board with zero free cells is a **win state**,
handled explicitly, not a crash and not an infinite loop.

### Timing

Fixed-timestep accumulator, never one move per animation frame — that runs at
double speed on a 120 Hz phone. The accumulated delta is clamped to a maximum
of 250 ms per frame, so a backgrounded tab does not return with a 40-second
delta and run three hundred ticks in one frame. The game auto-pauses on
`visibilitychange` when the document becomes hidden.

### Rendering

Integer scaling only. The device-pixel size of one grid cell must be a whole
number, computed against `devicePixelRatio`, with the result letterboxed inside
its container. Fractional scale gives some cells three device pixels and others
four, which is instantly visible on a pixel grid and is the thing that makes a
retro-styled game look subtly wrong without the viewer being able to say why.
`ctx.imageSmoothingEnabled = false`.

Never re-render any list with `innerHTML`. Reconcile keyed nodes.

### Audio

Every oscillator gets a gain ramp of 2–3 ms at onset and at release. A square
wave started or stopped abruptly clicks. Oscillator nodes are single-use: one
per note, never reused.

The `AudioContext` is constructed **on the first real user gesture**, not on
page load. If one already exists in the `suspended` state, `resume()` is called
from inside a gesture handler.

On iOS, Web Audio plays on the ambient channel, so the hardware ringer switch
silences it while an `<audio>` element is unaffected. Feature-detect
`navigator.audioSession` and set its type when present. Where it is absent, do
**not** claim to have fixed it — show an honest one-line hint near the sound
toggle that the ringer switch may be silencing the game.

### Persistence

One store owns all state and persistence; views subscribe. Persisted data
carries a schema version from the first commit that writes anything, with a
`migrate()` function. Loading validates the shape and falls back to defaults on
anything unrecognised. **An unknown future version fails safe** — it is left
untouched and the session runs on defaults, rather than being overwritten.

### Derived values

Reachable space, the multiplier, the current ramp step, the snake's length and
the tick interval are all **computed** from state. None of them is stored as a
mutable field.

---

## Phases

Logic and tests come before UI. Phases 1–3 produce a game with no visible
output at all; that is intended, and phase 4 is the checkpoint where the look
gets decided cheaply before anything is built on top of it.

Each phase ends at a stop point. Do not begin the next phase in the same
session. Commit, push, `/clear`, re-prime from this file and `CLAUDE.md`.

### Phase 1 — The tick engine

Pure core. `createGame({ width, height, rng })` returns an immutable-ish state
object. `tick(state)` returns the next state. `enqueueTurn(state, direction)`
returns a state with the turn queued. No rendering, no timing, no storage.

Covers: grid, snake as an array of cells, the turn queue, movement, wall
collision, self collision, food spawning, growth, and the game-over state.

Three derived helpers are exported alongside them, computed on demand and never
stored: `pendingDirection(state)` is the heading the next tick will use,
`nextHead(state)` is the cell the head will occupy after it, and
`tailHeldThisTick(state)` is true when that move lands on the food and the tail
is therefore not popped. Phase 2's flood fill reads the last of these for its
tail-vacate exception, and `tick` calls it too, so there is one definition of
the rule rather than two.

#### Setup overrides on `createGame`

`createGame` takes two further optional arguments, `snake` and `food`. They
exist so tests can stand the board up in a position that would take hundreds of
ticks to play into, or that cannot be played into at all — a board with exactly
one free cell has no reachable route from a fresh game. Phase 2's
hand-constructed boards use them. Omit both for a real game.

- `snake` is an array of `{x, y}`, head first. The heading is read from the
  head and its neck rather than passed separately, so the two cannot disagree.
  It throws a `RangeError` if it is empty, has fewer than two segments, repeats
  a cell, places a cell off the board or off the integer grid, or has any two
  consecutive segments that are not four-way adjacent.
- `food` is a single `{x, y}`, or `null` for a board holding no food. It throws
  a `RangeError` if it is off the board or lands on the snake. Omit it entirely
  and food is spawned through `rng` as normal.
- The default starting snake is validated on the same path, so a board too
  small to hold the starting length is rejected rather than quietly producing a
  snake inside the wall.

**Stop point:** `npm test` passes and the game can be played to completion in a
test by calling `tick` in a loop. Nothing is visible in a browser.

Tests, each a named case:

- A right-moving snake given Up then Left inside one tick moves up, then left,
  and does not reverse into itself.
- A third turn queued in the same tick is dropped; the queue never exceeds two.
- A turn directly opposite the last queued direction is rejected, not queued.
- The head entering the cell the tail occupies survives, because the tail
  vacates on the same tick.
- The tail cell stays occupied on a tick where food is eaten, rather than being
  vacated under an arriving head, because the tail did not move. Asserted as
  the tail not moving rather than as a death: the head cannot both eat and
  enter the tail cell on one tick, since food never sits on the snake.
- A snake of length 4 that eats has length 5 on the tick it eats, not one tick
  later.
- Food never spawns on a cell occupied by the snake, asserted over 500 seeded
  spawns.
- With exactly one free cell on the board, food spawns in it deterministically.
- With zero free cells, the game reports a win and `tick` does not loop.
- A head at x=0 moving left dies; a head at x=width−1 moving right dies.
- `tick` on an already-dead state returns the same state, unchanged.
- Two games created with the same seed and given the same inputs produce
  identical states after 200 ticks.

### Phase 2 — Confinement, scoring and speed

Still pure core, still no UI.

`reachableFrom(state)` flood-fills the free cells reachable from the head using
four-way adjacency, treating the snake's body as blocking and applying the
tail-vacate exception. `multiplierFor(state)` derives
`1 + floor((total - reachable) / total * 4)`, clamped to 1–5.
`tickIntervalFor(state)` derives `max(70, 140 - 6 * foodEaten)` in
milliseconds. `rampStepFor(state)` derives an index 0–3 from the multiplier.

**Stop point:** `npm test` passes. The confinement value is correct on
hand-constructed boards. Still nothing visible.

Tests:

- A snake in the centre of an empty board reaches every free cell.
- A head sealed into a three-cell pocket by its own body returns exactly 3.
- The tail cell is counted as reachable on a normal tick.
- The tail cell is not counted as reachable on a tick that eats — the tick
  whose move lands the head on the food, which is the tick the tail is held.
  Read it from `tailHeldThisTick(state)`; do not restate the rule.
- A pocket reachable only diagonally is **not** counted; adjacency is four-way.
- A head against a wall with body on three sides returns 0, and the multiplier
  clamps to 5 rather than dividing by zero or exceeding the band.
- The multiplier is 1 on a fresh board, and rises monotonically as reachable
  space falls across a scripted sequence.
- Score after eating is `previous + 10 * multiplierAtTheMomentOfEating`, using
  the multiplier from the state before the food was consumed.
- Tick interval starts at 140, is 134 after one food, and floors at 70 rather
  than continuing below it.
- Flood fill on a full 24 × 18 board completes without recursion errors —
  implement it iteratively with an explicit stack, not recursively.

### Phase 3 — Store and persistence

`src/store.js` owns all state and subscriptions. `src/persist.js` handles
`localStorage` with a version field and `migrate()`.

Persisted: high score, sound on/off, reduced-motion override, step-mode on/off.
Not persisted: any in-progress game.

**Stop point:** `npm test` passes. Reload behaviour is asserted in tests
against a fake storage object; the real `localStorage` is never touched from
core.

Tests:

- Absent storage key loads defaults without throwing.
- Malformed JSON in the key loads defaults and does not throw.
- A record with `version: 1` and a missing field gains that field's default via
  `migrate()`.
- A record with `version: 99` is left untouched on disk and the session runs on
  defaults.
- A high score lower than the stored one does not overwrite it.
- A storage write that throws (quota, private mode) is caught and the game
  continues.
- Two subscribers both receive an update; unsubscribing one does not affect the
  other.

### Phase 4 — Design tokens ⛔ REVIEW CHECKPOINT

Produce `src/tokens.css` and `tools/contrast.mjs` only. No components, no
canvas drawing, no layout.

The four-step ramp, computed against background `#0a0e0c`:

| Step | Name   | Hex       | Contrast |
|------|--------|-----------|----------|
| 0    | calm   | `#6fe3a1` | 12.19:1  |
| 1    | close  | `#d8e06a` | 13.68:1  |
| 2    | tight  | `#f0a83c` | 9.59:1   |
| 3    | sealed | `#ff7361` | 7.29:1   |

All four clear AAA at every text size. Adjacent steps sit at only 1.12:1,
1.43:1 and 1.48:1 **against each other** — which is exactly why the ramp cannot
be the only signal. See accessibility below.

`tools/contrast.mjs` recomputes every foreground/background pair in the token
file, prints the actual ratios, and exits non-zero if any pair used for text or
for a meaningful mark falls below 4.5:1. It runs in CI. Decorative tokens
(board lattice, at roughly 1.2–1.5:1) are declared decorative in the file and
excluded by name, never by threshold.

**Stop point:** stop and wait for review of the token file and the contrast
output before any component is built. Reviewing a token file takes a minute;
reskinning finished components takes an evening.

Tests:

- `tools/contrast.mjs` on a deliberately failing pair exits non-zero.
- The computed ratio for `#6fe3a1` on `#0a0e0c` matches 12.19 to two decimals.
- Every ramp step is present in the token file and none is a duplicate.

### Phase 5 — Renderer

Canvas 2D. Integer scaling against `devicePixelRatio`, letterboxed. Head, body,
food and wall all differ in **shape**, not only in colour. The score, reachable
count and multiplier render as a readout in the DOM beside the canvas, not as
canvas text.

Accessibility, inline:

- The canvas carries `role="img"` and an `aria-label` describing the board
  state in one sentence, updated only on state transitions, never per tick.
- The readout is real DOM text, so the reachable count and multiplier are
  available to a screen reader without touching the canvas.
- A visually-hidden summary is written on game over: final score, length,
  reachable space at the moment of death, and the ramp step **by name**, so the
  colour information exists as a word.
- `prefers-reduced-motion` removes the flicker, the ramp cross-fade and the
  death animation. It does not slow or remove the snake. The motion of the
  snake is the information.
- No horizontal scroll at 320 px.

**Stop point:** the game is playable and looks right. Stop for a taste review.

Tests:

- Cell pixel size is a whole number at `devicePixelRatio` values of 1, 1.5, 2
  and 3.
- At a container size that does not divide evenly, the canvas letterboxes and
  the cell size rounds down rather than producing a fractional cell.
- The ramp step chosen for a given reachable count matches `rampStepFor`.
- The game-over summary text contains the ramp step name, not only its colour.

### Phase 6 — Input

Keyboard: arrows and WASD. `preventDefault` on those keys **only when the game
is running and focused** — never blanket, and never on Tab.

Touch: swipe on the play surface with a minimum distance threshold and a
dominant-axis rule so a diagonal resolves to one direction rather than none.
`touch-action: none` on the play surface only, so the rest of the page still
scrolls and pull-to-refresh is not broken elsewhere. An on-screen d-pad with
44 px minimum targets, each with a contextual accessible name.

**Step mode**, a settings toggle: the snake advances one cell per keypress
instead of on a timer. The game becomes turn-based and fully playable from a
keyboard with announcements, because there is no clock to lose to. This is
nearly free given a pure `tick(state)` and it is the one accessibility
affordance here that actually works — a real-time spatial game is otherwise not
playable by a screen reader user, and piping per-tick state into a live region
would make it worse, not better.

**Stop point:** playable on a phone and by keyboard alone. Stop.

Tests:

- A swipe of 20 px is ignored; a swipe of 40 px registers.
- A swipe 50 px right and 30 px down resolves to right, not to nothing.
- Arrow keys are not prevented when focus is in the settings panel.
- Step mode advances exactly one tick per keypress and does not advance on key
  repeat held down.
- Every d-pad button has a distinct accessible name.

### Phase 7 — Audio

`src/audio/rtttl.js` parses RTTTL from its published specification, written
from scratch. `src/audio/synth.js` plays parsed notes as square waves through a
bandpass chain, with 2–3 ms ramps.

Sounds: eat, turn, death, new high score, and the per-tick pulse whose pitch is
derived from the ramp step. All defined as RTTTL strings in one data file, so
every sound in the game is data rather than code.

**Stop point:** sound works, mutes cleanly, and survives a tab switch. Stop.

Tests:

- `d=4,o=5,b=140` with a bare `c` yields C5 at 4/4 of a beat.
- `8g5` and `g.6` parse to the correct pitch and duration; a dotted note is
  exactly 1.5× its base.
- `p` yields a rest with a frequency of zero and a non-zero duration.
- An unknown control name is ignored rather than throwing, per the spec.
- Whitespace anywhere in the string is ignored.
- A missing control section falls back to `d=4, o=6, b=63`.
- A BPM outside the format's set of 32 permitted values is snapped to the
  nearest permitted value, and the choice is recorded in a comment.
- A malformed note returns a parse error rather than a silent `NaN` frequency.
- No `AudioContext` is constructed before the first gesture, asserted with a
  spy.

### Phase 8 — Delivery

- CI runs the test suite, `tools/contrast.mjs`, and a check that no file in
  `src/` imports anything outside the repo. All three fail the build.
- Deploy behind an explicit allowlist that fails the build on an unclassified
  entry. Never upload a directory blind.
- Pages source set to **GitHub Actions**, never "deploy from a branch".
- README, including the Design notes section.

---

## Do not build

- Mazes or in-field obstacles. Your own body is the obstacle course; that is
  the point of the confinement system. If runs feel samey once it is real, the
  fix is examined then, not pre-empted now.
- Wrap-around walls. Decided against; see The idea.
- Bonus food, timed food, food of different values. The multiplier already
  varies what an apple is worth, and by a mechanism the player controls.
- Levels, stages, unlockables, progression.
- Rival snakes or any AI opponent.
- A drawn phone shell, bezel, or 3D handset.
- An online leaderboard, accounts, or any server component.
- Payments, pricing, or any commerce. Revisit after there is a game.
- CRT curvature, chromatic aberration, or a scanline shader. This was
  considered and cut with the WebGL ban; a flat pixel grid at correct integer
  scale looks better than a bad shader.
- Difficulty settings. The speed ramp is the difficulty.
- Any sound not expressible as RTTTL.

## Stretch goals, only after phase 8 ships

- A ghost replay of your best run, drawn faintly behind the live snake. The
  pure core plus a seed makes this nearly free — record inputs, not positions.
- A "how you died" screen that replays the last twenty ticks and marks the tick
  at which reachable space dropped below what you needed. This is the concept
  paying off, and it is the most interesting thing on this list.
- A daily seed, so the same board is shared without a server.
