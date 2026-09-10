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

**Stop point:** the game renders, runs on its own from the fixed-timestep
loop, and dies against a wall. It is **not** playable — input is phase 6, so
nothing on the board is controllable at the end of this phase. Stop for a
taste review.

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

#### Removing phase 5's auto-restart

Phase 5 ends a run and starts a new board on its own after `AUTO_RESTART_MS` in
`src/main.js`. That timer exists only because phase 5 has no input: a run ends
in about a second and a half and there is no control with which to start
another, so a page left on a corpse cannot be reviewed.

Phase 6 **removes it**. The constant and the `restartAt` clock in the loop both
go, and a finished run becomes a real game-over state that persists until the
player leaves it, with an explicit restart control carrying an accessible name.
This is required work in this phase, not a later tidy-up: a board that takes
itself away on a timer takes the game-over summary with it, and that summary is
where the ramp step is named for a player who could not read the colour.

#### The lifecycle: idle, running, over

A run has three states, not two.

```
        first directional input
idle ─────────────────────────────> running
 ^                                     │
 │                                     │ wall, self, or the board filled
 │            restart button           v
 └──────────────────────────────────  over
```

**idle** — the board is drawn and has not moved: starting position, walls,
lattice and readout, and the loop scheduling frames that buy no ticks. This
state exists because the alternative is a page that plays itself. A fresh
board holds its heading, reaches the right-hand wall in **eleven ticks**, and
is therefore finished about a second and a half after the page loads — so a
visitor arrives at a game they never played, already over, with the summary
written and the score submitted.

**running** — entered by the first directional input, from any source: an
arrow or WASD key, a swipe on the play surface, or an on-screen d-pad press.
That input is **also applied as the first turn**. A press that only wakes the
board and is then swallowed reads as a dropped input — the player presses up,
the snake carries on right, and they blame the game rather than the design. In
step mode the same press starts the run and advances exactly one tick, because
step mode has no clock and a first press that moves nothing has done nothing.

##### Space and enter do not leave idle, and that is a decision

The keys that only advance — space and enter — do **not** leave idle. Steering
is what starts a game; there is nothing yet to advance.

This is recorded here as a decision rather than left to be read as an
oversight, because it looks like one. Space and enter are the two keys that
mean "go" everywhere else on a page, a reviewer will expect at least one of
them to start the board, and the obvious fix — have them call `begin()` — is
two lines. So the reasoning:

An advance key advances the board along its current heading. On an idle board
that heading is the starting one, pointing right, and the board has never
moved. A space that started the run would therefore start it by moving the
snake one cell toward the right-hand wall — which is a move the player did not
choose, in a direction they were not asked about, on a board whose whole
purpose in existing is that it does not move until they say so. Idle is there
because a board that plays itself is over eleven ticks after it appears; a
board that plays itself for one tick on a keypress is the same mistake at a
smaller scale.

There is also nothing for it to mean. Step mode's contract is one tick per
press, and the first press has to be a *directional* one in every mode from
every source, so that it is applied as the first turn rather than swallowed by
the transition. An advance key has no direction to apply. It would be a press
that starts the game and steers nothing, which is exactly the dropped-input
feeling the "applied as the first turn" rule exists to prevent.

So the gate is on `acted`, in `applyKey`: `action.advance` ticks the board only
once the board has been started, and only a direction starts it. `interpretKey`
still returns `advance: true` for those keys while idle — it answers what the
key means, not what the session should do with it — and the session declines.
The session is where the lifecycle lives, and that is the one place that
question is answered.

**over** — a finished run. It stays finished; see "Removing phase 5's
auto-restart" above. The restart button is the only way out, and it returns to
**idle**, not to running: the player asked for a board to play, not to be
dropped into a run already under way with their hand off the keys.

#### The app never moves focus before the player has acted

Focus moves in exactly two places, and both answer something the player did:
to the restart button when a run ends, and to the play surface when the
restart button is pressed. **Nothing moves focus while the board is idle**, and
nothing moves it on a timer.

This is not a nicety. The old behaviour moved focus to a button roughly 1.5
seconds after page load, with no user action anywhere in the causal chain — a
page grabbing the visitor rather than answering them, and for a screen reader
user, being taken somewhere they did not ask to go while still reading the
page. The death focus move is not weakened by this rule and is not in tension
with it: by the time a run ends, the player has pressed something.

#### The swipe tie, and where the threshold is measured

The threshold is measured against the **winning axis**, not against the
diagonal. 25 by 25 is a 35 px hypotenuse — over a distance test — while
neither axis carries 30 px of intent; that gesture is a tap with a wobble and
must not steer.

A swipe with `|dx|` exactly equal to `|dy|` resolves to the **horizontal**
axis. It has to go somewhere, the board is wider than it is tall, and a rule
written down is a decision rather than an accident.

#### Where phase 6's code lives

`src/input/keyboard.js` and `src/input/swipe.js` are pure — a key or a pair of
deltas in, an intention out — and hold the three questions that gate
`preventDefault`. `src/session.js` owns the board, the accumulator and the end
of a run, with no DOM, so the game-over lifecycle and step mode are tested as
logic. `src/loop.js` turns frames into elapsed time and owns the pause; it
takes its frame scheduler as an argument, which is the whole of its clock,
because rAF hands its callback the timestamp and nothing in that file reads
`Date.now()` or `performance.now()`. Injecting the scheduler therefore lets a
test drive sixty ticks, a forty-second frame and a tab switch through the real
loop without a browser — which is not a luxury: `requestAnimationFrame` does
not fire in a preview pane that is not painting, so the timed loop cannot be
observed there at all. `src/ui/gameover.js`, `src/ui/idle.js`,
`src/ui/dpad.js` and `src/ui/settings.js` are the nodes. The idle
instruction is written once, as `IDLE_INSTRUCTION` in `src/render/labels.js`,
because it is said twice — as text on the page and inside the canvas
aria-label for the idle phase — and two copies of a sentence drift. `src/main.js` remains the only file that
names `window` or `localStorage`, and the only place `preventDefault` is
called.

##### The idle instruction names only what is on screen

The sentence originally named all three ways in unconditionally — keyboard,
swipe, and the arrow buttons — on the reasoning that the page has all three and
cannot know which the visitor will use. That was wrong about the third. The
d-pad is displayed only under `@media (pointer: coarse)`, so a desktop visitor
was told to use a control that is not on their screen, and a screen reader user
was told about buttons that are `display: none` and therefore not in the
accessibility tree to find. An instruction listing a control the reader does
not have is worse than one that leaves a control unmentioned: it sends them
looking for something that is not there.

So the sentence has two forms, and they are one sentence with a clause swapped
rather than two sentences maintained apart:

- `IDLE_INSTRUCTION` — keyboard and swipe. True on every device, and the copy
  in `index.html`, because that markup is parsed before any script has run and
  can therefore only be the form that is true everywhere.
- `IDLE_INSTRUCTION_WITH_DPAD` — the same, plus the arrow buttons.

`idleInstructionFor({ dpadVisible })` picks between them, against
`DPAD_MEDIA_QUERY` — one string, exported from `src/ui/dpad.js`, matched in
`main.js` through `matchMedia` and pinned to the stylesheet by
`tests/markup.test.js`. Two copies of a media query drift exactly the way two
copies of a sentence do.

`src/ui/idle.js` rewrites the node's text on every `show()` rather than
trusting the markup, because a hybrid laptop gains a coarse pointer the moment
a finger touches the screen and the d-pad appears with it. The board is still
idle when that happens, so the labeller sees no phase change and would keep the
sentence it was born with while the page under it swapped — hence
`labeller.invalidate()`, which is called from that one media-query handler and
from nowhere else.

The readout still owns the summary node, as it owns every node it writes; the
game-over region is handed the string through an injected `writeSummary` so
there is one owner of that element rather than two modules taking turns.

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
- A finished run stays finished: no timer replaces the board, and the game-over
  summary is still in the DOM after phase 5's `AUTO_RESTART_MS` would have
  elapsed. The restart control, and only the restart control, starts a new one.
- On death, `store.submitScore` is called exactly once, with the final score,
  however many frames run afterwards.
- On death, focus lands on the restart button rather than on `<body>`. Both
  outcomes put the same region on the page; only `activeElement` separates
  them, and only one of them tells the player the run ended.
- A run that beats the stored high score produces summary text saying so, and
  a run that does not, does not. Measured before the submit, or every run is a
  new best against itself.
- Arrow keys are not prevented once the run is over.
- Tab is never prevented, in any state.
- A fresh session is idle and advances zero ticks across ten seconds of
  simulated frames.
- The first directional input transitions to running **and** is applied as the
  first turn: a fresh board given "up" has its head one cell up after one
  tick, not one cell right. Asserted for a key, and for a swipe or d-pad
  press.
- In step mode, the first keypress both starts the game and advances exactly
  one tick.
- No focus move occurs while idle, including past the point at which the board
  used to have killed itself.
- The idle instruction is present in idle and absent in running, and comes
  back on restart.
- Restart from over lands in idle, not running, and advances zero ticks until
  the next input.
- A *started* board left alone survives eleven ticks before the right-hand
  wall, which is what "no further input" looks like — not a board that dies on
  load.
- The loop advances one tick per `tickIntervalFor(state)` of elapsed time
  across sixty ticks, with the interval shrinking underneath it as food is
  eaten. Driven through an injected frame scheduler.
- A single forty-second frame advances only what the 250 ms clamp allows.
- Going hidden stops the board, and returning does not replay the missed time.
- The game-over region is not displayed before the first death. The fake DOM
  has no cascade, so the assertion available is that index.html carries the
  `[hidden] { display: none !important }` rule that outranks an author
  `display` — named in the test as the weaker check it is.
- The reduced-motion control's `label for` matches the select's `id`, so the
  binding cannot be parted by a rename.

### Phase 7 — Audio

`src/audio/rtttl.js` parses RTTTL from its published specification, written
from scratch. `src/audio/synth.js` plays parsed notes as square waves through a
bandpass chain, with 2–3 ms ramps. `src/audio/sounds.js` is the table.
`src/audio/cues.js` is the mapping from a thing that happened on the board to a
string in that table — separated from the synth because it is the half with
decisions in it, and the only half that can be tested without a browser.

Sounds: eat, turn, death, new high score, and the per-tick pulse whose pitch is
derived from the ramp step. All defined as RTTTL strings in one data file, so
every sound in the game is data rather than code.

#### The pitches, and why they are where they are

| Sound   | RTTTL                             | Pitches                        |
|---------|-----------------------------------|--------------------------------|
| eat     | `eat:d=32,o=6,b=180:c7,g7`        | C7 2093, G7 3136 — 42 ms each  |
| turn    | `turn:d=32,o=7,b=355:c`           | C7 2093 — 21 ms                |
| death   | `death:d=16,o=6,b=125:c,a5,f5,8c5`| C6, A5, F5, C5 — 600 ms total  |
| best    | `highscore:d=16,o=6,b=160:c,e,g,8c7` | C6, E6, G6, C7 — 469 ms     |
| pulse 0 | `pulse0:d=32,o=5,b=355:a`         | A5 880 — calm                  |
| pulse 1 | `pulse1:d=32,o=6,b=355:c`         | C6 1046.5 — close              |
| pulse 2 | `pulse2:d=32,o=6,b=355:e`         | E6 1318.5 — tight              |
| pulse 3 | `pulse3:d=32,o=6,b=355:a`         | A6 1760 — hot                  |
| pulse 4 | `pulse4:d=32,o=7,b=355:c`         | C7 2093 — sealed               |

Two constraints, both physical, decided these:

The voices run through the piezo chain — a 400 Hz highpass and a 3.8 kHz
lowpass — so anything written below about 500 Hz is attenuated to nothing.
Octave 4, which the format permits, is therefore where notes go to be
inaudible, and every pitch above sits between 523 Hz and 2093 Hz. A test
iterates the exported table and asserts it.

Every tempo above is one of the format's 32 permitted values. `b=120` — the
obvious tempo, and not one of them — snaps to 125, and the sound would then be
timed against a number nobody wrote down. The parser's own test fixtures were
written against 120 first and this is how it was found.

The pulse climbs an A minor shape across two octaves rather than stepping by
semitones, so consecutive ramp steps are far enough apart to be told apart by
ear rather than merely measured apart in hertz. This is the sound half of the
confinement signal: the colour says it to a player who can separate 1.12:1, the
readout says it in words, and this says it to a player who is looking at the
board rather than at the panel.

#### The tie in the BPM snap resolves downward

A tempo equidistant from two permitted values — 106, between 100 and 112 —
takes the **lower**. Both neighbours are equally wrong by the only measure
there is, so the rule is decided rather than left to fall out of the direction
the table happens to be walked. Lower means a note comes out slightly longer
than its author asked for, which keeps a short cue audible rather than clipping
it, and every sound in this game is under 600 ms.

#### What is tested, and what is not

The parser is logic and is tested properly: 36 named cases in
`tests/rtttl.test.js`.

`tests/audio.test.js` covers the audio edge in four parts, against the fake in
`tests/fake-audio.js`, which records automation calls rather than synthesising:

1. **When a context gets constructed.** Never at module load, never across ten
   seconds of frames on an idle board, never on a request to play. Exactly one
   on the first `unlock()`, and a suspended one is resumed rather than
   replaced.
2. **Whether a sound is scheduled at all.** Muted, hidden, or before the first
   gesture, nothing is — and muting stops what is already sounding at the mute
   rather than at the end of the note.
3. **The envelope contract**, on every voice of every cue:
   - a ramp up from zero at the onset, reaching peak exactly `RAMP_MS` later;
   - a ramp back to zero ending at `startAt + hold`, held at peak until
     `RAMP_MS` before that, with `stop()` scheduled no earlier than the bottom
     of that ramp;
   - each oscillator started exactly once across a run of fifteen notes — the
     fake throws on a second `start()` the way the real node does, so reuse
     fails at the call site as well as at the assertion;
   - each voice reaching the destination through the highpass and *then* the
     lowpass, at the frequencies this document names. A lowpass before a
     highpass is the same pair of filters and a different sound.
   - a rest builds no oscillator and still occupies its time.
   This is the whole contract rather than the release alone. A suite pinning
   only the release would imply the graph was covered while the onset, the
   single-use rule and the filter order were not — which is the failure mode
   the earlier "not tested" note was trying to avoid and did not.
4. **The sound table**, iterated from its actual export: every string parses,
   every pitch clears the piezo chain, every ramp step has its own pulse, and
   every name is inside the format's ten-character cap.

**What is still not covered, named so it is not mistaken for coverage.** The
fake records; it does not synthesise. Nothing in this suite can say that a
square wave was audible, that 2.5 ms is long enough to remove the click on real
hardware rather than merely being scheduled, or that the chain sounds like a
small speaker rather than only being wired like one. Those are ear questions
and they were answered by listening. Nor is the timed tick cadence covered in a
browser: `requestAnimationFrame` does not fire in a preview pane that is not
painting, so the per-tick pulse under the real loop was verified through step
mode, which advances without a clock.

#### The ringer hint is gated on the platform and on the toggle

The line is shown only when all three hold: the browser has no
`navigator.audioSession`, the platform is plausibly iOS or iPadOS, and sound is
currently on.

The first condition alone was the original gate and it was wrong. Absence of
`navigator.audioSession` means "not Safari 17 or later", not "iOS", so every
desktop Chromium and Firefox was being warned about a hardware switch its
machine does not have. **A hint shown to everyone is furniture, and a hint
shown to the wrong platform is worse than silence — it is the reason the next
one gets skipped.** The same standard the ramp-name and the unwritable-save
lines are held to: say what is true for this reader, on this page, or do not
say it.

`plausiblyIosAudio` in `src/audio/synth.js` is the platform test, from feature
probes rather than a user-agent string, and it needs two terms:

- **touch** — `navigator.maxTouchPoints > 0`. macOS Safari reports 0; iPadOS
  reports 5 while claiming to be a Mac everywhere else.
- **Apple** — `window.GestureEvent`, which exists only in the WebKit family, or
  `CSS.supports('-webkit-touch-callout', 'none')`, which mobile WebKit
  supports and macOS Safari does not. Either will do.

Both terms are necessary and each covers the other's blind spot: macOS Safari
passes Apple and fails touch; a touchscreen Windows laptop or an Android tablet
passes touch and fails Apple.

It **cannot** tell an iPhone from an iPad and does not try — both have the
problem, hardware switch or Control Centre toggle. It cannot tell whether the
switch is actually silent, which no browser exposes, which is why the line says
*may*. It does not survive a browser spoofing WebKit's non-standard surface,
and it does not need to: a false positive costs one line of text. And it is a
proxy throughout — it observes the shape of the browser and infers the
platform; it never observes the audio session.

**Uncertain means no.** Every probe absent returns false.

The third condition is read live, so switching sound off takes the line off the
page and switching it back on returns it. With sound off there is nothing for a
ringer switch to be silencing, and the line is answering a question the player
is not asking.

#### The context is built on a gesture, and there is always one

`createAudio` constructs nothing. `unlock()` does, and it is called only from
inside a real gesture handler — keydown, pointerdown on the play surface, a
d-pad press, the sound toggle's own change event. `AudioContext` and
`navigator.audioSession` are named in `src/main.js` and passed in as arguments,
which is what lets a test spy on the constructor.

Phase 6's idle board is what guarantees a gesture exists: the player has to
steer to begin, so there is always a real press behind the first sound. This is
the second thing the idle state bought, and it was not the reason it was added.

Muting silences immediately — every live voice has its automation cancelled, is
ramped down over the same 2.5 ms as a normal release, and is stopped at the
bottom of that ramp. A mute that waits for the current note is late by up to
600 ms, which is the death cue: the sound a player is most likely to reach for
the toggle during.

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
  spy — during module load, and across ten seconds of frames on an idle board.
- Every string in the table `src/audio/sounds.js` exports parses without
  throwing, iterating the actual export so a sound added with a typo in it
  fails the suite rather than failing silently in a browser.
- Every pitch in that table is inside the piezo chain's passband, so a sound
  written into octave 4 out of habit is caught rather than played to nobody.
- Every voice ramps from zero to peak over `RAMP_MS` at its onset.
- Every voice ramps back to zero ending at `startAt + hold`, and is stopped no
  earlier than the bottom of that ramp. **This is the case that fails when the
  release is removed**, with the message "the voice does not ramp back to
  silence".
- No oscillator is started twice, across a run of fifteen notes.
- Every voice reaches the destination through the highpass and then the
  lowpass, at 400 Hz and 3.8 kHz.
- The ringer hint is shown when the browser lacks `audioSession` **and** the
  platform is plausibly iOS **and** sound is on; and is absent when any one of
  those fails — asserted for desktop Chrome, desktop Safari, a touchscreen
  Windows laptop, a browser that has `audioSession`, sound switched off, and a
  probe that says nothing at all.

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
