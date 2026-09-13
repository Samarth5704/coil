# Coil

Snake that shows you how much room you have left. Play it at
**https://samarth5704.github.io/coil/**

## What it is

Every tick, Coil flood-fills the cells reachable from the snake's head and
turns that one number into colour, pitch and score: the body shifts through a
five-step ramp as space closes, the tick pulse rises with it, and an apple
taken in a tight pocket pays up to five times an apple taken in the open. The
game pays you for the risk it has just shown you.

## Running it locally

There is no build step. Serve the repository as static files and open
`index.html`:

```bash
npx serve -l 4173 .
```

Then visit http://localhost:4173/. Any static server works; `python -m
http.server` does too.

Tests and gates:

```bash
npm ci
npm test               # Vitest
npm run contrast       # WCAG contrast of every meaningful token, fails below 4.5:1
npm run constraints    # purity, no innerHTML, no stray hex, no dependencies, no audio files
npm run publish        # the deploy allowlist; writes the publish tree to dist/
```

CI runs all of these, plus `node --check` over every script, on every push and
pull request. Deployment goes through `tools/publish.mjs`: every top-level
entry in the repository is classified against an explicit list, and an
unclassified entry fails the build rather than being uploaded.

## Design notes

<!-- DESIGN NOTES: supplied separately -->

## Attribution

Coil is an original game. It is not a recreation of, a port of, or an homage
to any existing product, and nothing in it is taken from one.

**Genre.** The snake genre begins with *Blockade* (Gremlin Industries, 1976)
and reached most people through the versions bundled with mobile handsets in
the late 1990s. Coil takes the genre and none of the assets. No handset
maker's marks, product names, sprites, sounds, palettes or handset designs
appear anywhere in this project — not in the code, the page title, the
repository name or this file. The look is an original design and is not a
reproduction of any device.

**RTTTL.** Every sound in the game is an RTTTL string, synthesised at runtime
through a small-speaker filter chain. The parser in `src/audio/rtttl.js` was
written from scratch against the published RTTTL specification:
http://merwin.bespin.org/t4a/specs/nokia_rtttl.txt

**Prior art.** [oddurs/3310](https://github.com/oddurs/3310) (MIT) was
consulted during research. No code was taken from it. One idea was: routing
synthesised voices through a bandpass chain so they sound like they are coming
out of a small piezo speaker. That idea is credited here as an idea.

## Licence

MIT. See [LICENSE](LICENSE).
