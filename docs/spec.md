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

- **Colour.** A five-step ramp from calm to sealed.
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
count rather than a death the head can reach. `tailHeldOnNextMove(state)` is the
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

Three derived helpers are exported alongside them, computed on demand and
never stored: `pendingDirection(state)` is the heading the next move will use,
`nextHead(state)` is the cell the head will occupy after it, and
`tailHeldOnNextMove(state)` is true when that move lands on the food and the
tail is therefore not popped. Phase 2's flood fill reads the last of these for
its tail-vacate exception, and `tick` calls it too, so there is one definition
of the rule rather than two.

The name is future-tense on purpose. The flood fill runs on a settled
post-tick state, where the honest question is whether the move that has not
happened yet will hold the tail. Inside `tick` that next move is the one being
executed, so the same function answers both callers.

#### Setup overrides on `createGame`

`createGame` takes two further optional arguments, `snake` and `food`. They
exist so tests can stand the board up in a position that would take hundreds of
ticks to play into, or that cannot be played into at all — a board with exactly
one free cell has no reachable route from a fresh game. Phase 2's
hand-constructed boards use them. Omit both for a real game.

`snake` is an array of `{x, y}`, head first. The heading is read from the head
and its neck rather than passed separately, so the two cannot disagree. `food`
is a single `{x, y}`, or `null` for a board holding no food; omit it entirely
and food is spawned through `rng` as normal.

Seven rejections, each a `RangeError` naming the offending index and cell, and
each with a test under "rejecting crafted setups":

1. An empty snake.
2. A snake of fewer than two segments — one segment has no neck, so it has no
   heading to read.
3. A snake that repeats a cell.
4. A snake with a segment off the board, or off the integer grid.
5. A snake with two consecutive segments that are not four-way adjacent, which
   includes diagonal neighbours.
6. Food off the board, or off the integer grid.
7. Food on a cell the snake occupies. This is also what keeps the eating
   exception in `tick`'s collision loop unreachable; see the tail-vacate rule.

The default starting snake is validated on the same path, so a board too small
to hold the starting length is rejected rather than quietly producing a snake
inside the wall.

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
tail-vacate exception. `tickIntervalFor(state)` derives
`max(70, 140 - 6 * foodEaten)` in milliseconds.

`multiplierFor(state)` bands **slack**, which is
`reachableFrom(state) / snake.length` — reachable space per segment of snake:

| slack          | multiplier |
|----------------|------------|
| `>= 8`         | 1×         |
| `>= 4`, `< 8`  | 2×         |
| `>= 2`, `< 4`  | 3×         |
| `>= 1`, `< 2`  | 4×         |
| `< 1`          | 5×         |

Scaled by the snake's own length, never by board area. An earlier version
divided by `total`, which made the multiplier a length meter in disguise: on a
432-cell board it took 120 segments to leave 1× and 250 to reach 3×, so a
hundred-segment run still read 1× and how the player was actually playing
never entered into it. Length is never zero — `validateSnake` requires two
segments — but `multiplierFor` asserts it rather than assuming, because the
whole measure divides by it.

What the count includes: the head's own cell is where the snake stands, not
room it has, so it is never counted. The tail's cell **is** counted whenever
`tailHeldOnNextMove(state)` is false, because the tail leaves it as the head
arrives and the head can move into it. An open board therefore reads
`total - snake.length + 1`, not `total - snake.length` — the extra cell is the
vacating tail, and it is the same cell the tail-vacate rule already says the
head may enter.

`rampStepFor` is exactly `multiplier - 1`, an index 0–4: five ramp steps
against five multipliers, one each. An earlier four-step ramp collapsed 4× and
5× into a single colour, which spent the distinction at precisely the point in
a run where it carries the most information.

Score is the one **stored** value in this phase. It accumulates and cannot be
recovered from a board, unlike the reachable count, the multiplier, the ramp
step and the tick interval, which are all computed on demand and stored
nowhere. Eating adds `10 * multiplierFor(state)` read from the board **before**
the food is taken, so the payout reflects the confinement the player accepted
in going for the apple rather than the confinement the apple itself caused.

**Stop point:** `npm test` passes. The confinement value is correct on
hand-constructed boards. Still nothing visible.

#### Measured — the band responds, this bot does not exercise it

Seed 77 under the slack formula, driven by the test suite's greedy
food-chaser: 544 ticks, 34 food, final length 38, final score 340.

| point             | tick | reachable | length | slack  | multiplier |
|-------------------|------|-----------|--------|--------|------------|
| start             | 0    | 429       | 4      | 107.25 | 1×         |
| midpoint          | 271  | 413       | 20     | 20.65  | 1×         |
| tick before death | 543  | 0         | 38     | 0.00   | 5×         |

Occupancy: **1× for 538 ticks (98.9%)**, 2× and 3× for none at all, 4× for
four ticks, 5× for two. Average payout 10.00 per apple, meaning every apple in
the run paid at 1×.

That is the driver, not the formula. The chaser goes straight at the food,
never coils, and dies at length 38 with 413 cells still open to it — slack
never falls below 8 until the two ticks in which it seals itself in. The
formula does respond to confinement independently of length, which is what the
coiled-versus-open case proves: two snakes of 21 segments each, one flat along
the top row and one walled into a 17-cell strip, read 1× and 5×.

Re-measure with a real player in phase 5. Do not tune the bands against a bot
that never gets into trouble.

Tests:

- A snake in the centre of an empty board reaches every free cell.
- A head sealed into a three-cell pocket by its own body returns exactly 3.
- The tail cell is counted as reachable when the move about to happen does not
  land the head on the food, because the tail vacates as the head moves.
- The tail cell is not counted as reachable when the move about to happen lands
  the head on the food, because that is the move on which the tail is held.
  Read it from `tailHeldOnNextMove(state)`; do not restate the rule. The flood
  fill runs on a settled post-tick state, so the question is always about the
  move that has not happened yet.
- A pocket reachable only diagonally is **not** counted; adjacency is four-way.
- A head against a wall with body on three sides returns 0, which is slack 0
  and therefore 5×, without dividing by zero or exceeding the band.
- The multiplier is 1 on a fresh board, where slack is 107.25.
- The multiplier never decreases across a scripted sequence of shrinking
  reachable space with **snake length held constant**. Length has to be pinned:
  the multiplier depends on both terms, so a sequence that lets the snake grow
  proves nothing about confinement.
- A coiled snake and an open snake **of the same length** get different
  multipliers. This is the case that proves the multiplier is not merely a
  length meter, and it is the most important test in this phase.
- `rampStepFor` returns 0–4 and equals `multiplierFor` minus one, across all
  five bands.
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
Not persisted: any in-progress game. One key, `coil.save`, unversioned in the
key itself: the version lives inside the record where `migrate()` can read it,
because a version in the key orphans the old record at every bump instead of
upgrading it.

#### `load` returns a flag, not a bare record

`load(storage)` returns `{ record, writable }`. `writable` is false in exactly
one case: the stored record's version is newer than this build's. The store
carries that flag for the whole session and writes **nothing at all** while it
is false — not the high score, not a settings toggle, nothing.

The flag is what actually enforces "never overwritten". Leaving the future
record alone at load time satisfies the rule only until the first setting the
player toggles; the very next write clobbers the newer install's data a second
later. Failing to write is the correct behaviour here, and it is deliberate,
not an oversight — phase 5 has to say so out loud rather than swallow it.

#### `submitScore` commits directly

`submitScore` builds and commits the next record itself rather than routing
through the store's generic `set()`. `set()` skips the write when the value is
unchanged, and that second guard masks the high-score comparison: with the
comparison mutated from `>` to `>=`, an equal score passes the broken check and
is then stopped by `set()` anyway, so the "equal score does not write at all"
case passes on a broken comparison. The comparison has to be the only thing
standing between an equal score and a write. Do not simplify this back into
`set()`.

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

The five-step ramp, computed against background `#0a0e0c`:

| Step | Name   | Hex       | Contrast |
|------|--------|-----------|----------|
| 0    | calm   | `#6fe3a1` | 12.19:1  |
| 1    | close  | `#d8e06a` | 13.68:1  |
| 2    | tight  | `#f0a83c` | 9.59:1   |
| 3    | hot    | `#ff8f4a` | 8.58:1   |
| 4    | sealed | `#ff7361` | 7.29:1   |

All five clear AAA at every text size. Adjacent steps sit at only 1.12:1,
1.43:1, 1.12:1 and 1.18:1 **against each other** — which is exactly why the
ramp cannot be the only signal. See accessibility below.

Every ratio in this section was recomputed, not carried over. One figure in the
previous four-step table did not survive that: it gave tight against sealed as
1.48:1, and the two hexes actually sit at 1.32:1. Moot now that `hot` falls
between them, but `tools/contrast.mjs` exists precisely because a number
written by hand drifts from the colour it describes.

The remaining meaningful tokens, on the same background:

| Token            | Hex       | Contrast |
|------------------|-----------|----------|
| `--food`         | `#e8f2ec` | 16.97:1  |
| `--text-primary` | `#f2f7f4` | 17.93:1  |
| `--text-muted`   | `#8a9a91` | 6.58:1   |
| `--wall`         | `#7d8d85` | 5.57:1   |
| `--focus`        | `#7dc4ff` | 10.37:1  |

`--wall` is meaningful, not decorative: walls kill, so the boundary carries
information and clears the threshold like any other mark. It sits at 3.05:1
against `--food` — the dimmer of the candidates, chosen so a wall reads as
boundary rather than as content, since a wall as bright as the food competes
with the thing the player is steering toward.

#### No single-colour focus ring can be luminance-distinct from the ramp

`--focus` was originally `#6fe3a1`, which is the same hex as `--ramp-0-calm`.
The focus ring therefore vanished completely against a calm-state snake. It is
now `#7dc4ff`, which fixes that particular collision — and does not fix the
general problem, because nothing in a token file can.

WCAG contrast is luminance-only. Every colour bright enough to clear 4.5:1
against `#0a0e0c` sits at 1.0–1.5:1 against every ramp step. `#7dc4ff`
measures 1.18, 1.32, 1.08, 1.21 and 1.42:1 against calm through sealed. There
is no hex that both clears the threshold on the background and separates from
the ramp by luminance; the ramp occupies the bright end of this background, and
so must anything legible on it. `#7dc4ff` is hue-distinct, not
luminance-distinct, and hue alone is exactly what a colour-blind player does
not receive.

This is a property of the background and the ramp, not a bad colour choice, and
it is why phase 5 draws the ring as two strokes rather than one.

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

The snake's body draws in the current ramp colour, so the body is the
confinement readout. The **head is distinguished from the body by shape — an
inset notch on its leading edge — and never by colour.** Tinting the head is
not an option: the head would either take a ramp colour, which is the body's
own colour, or a colour outside the ramp, which then has to survive the same
1.0–1.5:1 problem the focus ring has against every step. Shape has no such
constraint. Death reuses `--ramp-4-sealed` rather than introducing a colour.

**The focus ring is drawn as two strokes: a dark inner and a light outer.** A
single-colour ring is **not acceptable**, whatever its ratio against the
background. Per phase 4, no single hex separates from the ramp by luminance, so
a one-tone ring is guaranteed to disappear against one ramp step or another
depending on which colour is chosen. Two strokes of opposing lightness mean one
edge always separates from whatever the ring lands on — the snake at any ramp
step, the food, a wall, or the bare background. This is the same reasoning as
the ramp needing its name in text: where colour cannot carry a distinction, the
distinction is carried by something that is not colour.

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
- When the store is in its non-writable state — see phase 3, `load` returns a
  flag — the UI shows one honest line near the settings saying that
  preferences will not be saved this session because the saved data comes from
  a newer version of the game. It does **not** fail silently, and it does
  **not** offer to overwrite the record. Same treatment as the iOS
  ringer-switch hint: where something cannot be fixed, say so plainly rather
  than pretending it is handled or letting the player discover it by losing a
  setting on reload.
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
