#!/usr/bin/env node
/**
 * Coil — contrast checker.
 *
 * Parses src/tokens.css, computes the WCAG 2.x contrast ratio of every
 * meaningful token against --bg, prints the actual ratios, and exits non-zero
 * if any meaningful token falls below 4.5:1.
 *
 * The hexes are read from the CSS file. Change a hex in src/tokens.css and
 * this tool's output changes with no edit to this file — which is the whole
 * reason it exists, since a ratio written by hand drifts from the colour it
 * describes.
 *
 * No dependencies. Node's built-in fs only.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Tokens exempt from the 4.5:1 threshold, listed BY NAME.
 *
 * Never by a threshold and never by a naming convention: if exemption were
 * decided by "anything under 4.5:1 is decoration" the check would be vacuous,
 * and if it were decided by a name pattern then any token that drifted below
 * the line could be rescued by renaming it. A meaningful token that drops
 * below 4.5:1 must fail the build. Adding a name here is a deliberate act and
 * a reviewable diff.
 *
 * Each of these is marked decorative in src/tokens.css with the reason.
 */
export const DECORATIVE = ['lattice', 'surface'];

/** The token every meaningful ratio is measured against. */
export const BACKGROUND = 'bg';

export const THRESHOLD = 4.5;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Pull `--name: #hex;` declarations out of a CSS source string.
 * Comments are stripped first so a hex quoted in prose is not mistaken for a
 * declaration. Non-hex custom properties are ignored rather than rejected.
 */
export function parseTokens(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map();

  for (const match of withoutComments.matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g)) {
    const name = match[1];
    const value = match[2].trim();
    if (HEX.test(value)) tokens.set(name, value.toLowerCase());
  }

  return tokens;
}

/** Expand #abc to #aabbcc; pass #aabbcc through. */
function expand(hex) {
  if (!HEX.test(hex)) throw new Error(`not a hex colour: ${hex}`);
  if (hex.length === 7) return hex.toLowerCase();
  const [, r, g, b] = hex.toLowerCase();
  return `#${r}${r}${g}${g}${b}${b}`;
}

/** sRGB channel -> linear, per WCAG 2.x. */
function linearise(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a hex colour, per WCAG 2.x. */
export function luminance(hex) {
  const n = parseInt(expand(hex).slice(1), 16);
  return (
    0.2126 * linearise((n >> 16) & 0xff) +
    0.7152 * linearise((n >> 8) & 0xff) +
    0.0722 * linearise(n & 0xff)
  );
}

/** WCAG 2.x contrast ratio between two hex colours. Order does not matter. */
export function contrastRatio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  const lighter = Math.max(x, y);
  const darker = Math.min(x, y);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Two decimals, as printed and as asserted in the tests. */
export function round2(ratio) {
  return Number(ratio.toFixed(2));
}

/**
 * Check a token set against its background.
 *
 * Takes the tokens rather than reading the file, so tests can inject a
 * deliberately failing set without writing to src/tokens.css.
 *
 * Returns { rows, failures, ok }. `rows` covers every meaningful token — that
 * is, every token except the background itself and the names in DECORATIVE.
 */
export function checkTokens(
  tokens,
  { decorative = DECORATIVE, background = BACKGROUND } = {},
) {
  const bg = tokens.get(background);
  if (!bg) throw new Error(`token set has no --${background} to measure against`);

  const exempt = new Set(decorative);
  const rows = [];

  for (const [name, hex] of tokens) {
    if (name === background || exempt.has(name)) continue;
    const ratio = round2(contrastRatio(hex, bg));
    rows.push({ name, hex, ratio, passes: ratio >= THRESHOLD });
  }

  const failures = rows.filter((row) => !row.passes);
  return { rows, failures, ok: failures.length === 0, background: bg };
}

/**
 * The ramp steps in index order, read off the token names (--ramp-N-label).
 * Informational only; nothing here passes or fails.
 */
export function rampSteps(tokens) {
  const steps = [];
  for (const [name, hex] of tokens) {
    const match = /^ramp-(\d+)-(.+)$/.exec(name);
    if (match) steps.push({ index: Number(match[1]), name, label: match[2], hex });
  }
  return steps.sort((a, b) => a.index - b.index);
}

/** Ratio of each ramp step against the next one. Information, not pass/fail. */
export function adjacentRampRatios(tokens) {
  const steps = rampSteps(tokens);
  const pairs = [];
  for (let i = 0; i < steps.length - 1; i += 1) {
    pairs.push({
      from: steps[i],
      to: steps[i + 1],
      ratio: round2(contrastRatio(steps[i].hex, steps[i + 1].hex)),
    });
  }
  return pairs;
}

/** Ratio of --food against each ramp step. Information, not pass/fail. */
export function foodVersusRampRatios(tokens) {
  const food = tokens.get('food');
  if (!food) return [];
  return rampSteps(tokens).map((step) => ({
    step,
    ratio: round2(contrastRatio(food, step.hex)),
  }));
}

export function loadTokenFile(path) {
  return parseTokens(readFileSync(path, 'utf8'));
}

const pad = (s, n) => String(s).padEnd(n);
const padStart = (s, n) => String(s).padStart(n);

/** Prints the report. Returns the process exit code. */
export function report(tokens, path) {
  const result = checkTokens(tokens);

  console.log(`Coil — contrast against --bg ${result.background}`);
  console.log(`Source: ${path}`);
  console.log('');
  console.log(`${pad('token', 20)}${pad('hex', 10)}${padStart('ratio', 8)}   result`);
  console.log('-'.repeat(56));

  for (const row of result.rows) {
    const verdict = row.passes ? 'pass' : `FAIL  (below ${THRESHOLD.toFixed(1)}:1)`;
    console.log(
      `${pad(row.name, 20)}${pad(row.hex, 10)}${padStart(row.ratio.toFixed(2), 7)}:1   ${verdict}`,
    );
  }

  console.log('');
  console.log('Decorative, excluded by name, not measured against the threshold:');
  for (const name of DECORATIVE) {
    const hex = tokens.get(name);
    if (!hex) continue;
    const ratio = round2(contrastRatio(hex, result.background));
    console.log(
      `${pad(name, 20)}${pad(hex, 10)}${padStart(ratio.toFixed(2), 7)}:1   exempt`,
    );
  }

  console.log('');
  console.log('Information only — adjacent ramp steps against each other:');
  for (const pair of adjacentRampRatios(tokens)) {
    console.log(
      `  ${pad(`${pair.from.label} vs ${pair.to.label}`, 26)}${padStart(pair.ratio.toFixed(2), 6)}:1`,
    );
  }

  console.log('');
  console.log('Information only — --food against each ramp step:');
  for (const pair of foodVersusRampRatios(tokens)) {
    console.log(
      `  ${pad(`food vs ${pair.step.label}`, 26)}${padStart(pair.ratio.toFixed(2), 6)}:1`,
    );
  }

  console.log('');
  console.log('Neither the ramp step nor food-versus-snake can be carried by colour');
  console.log('alone. The ramp needs its name and number in text; food needs a');
  console.log('different shape from the snake.');
  console.log('');

  if (result.ok) {
    console.log(
      `OK — ${result.rows.length} meaningful tokens, all at or above ${THRESHOLD.toFixed(1)}:1.`,
    );
    return 0;
  }

  for (const row of result.failures) {
    console.error(
      `FAIL — --${row.name} (${row.hex}) is ${row.ratio.toFixed(2)}:1 against --bg, below ${THRESHOLD.toFixed(1)}:1.`,
    );
  }
  return 1;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = process.argv[2] ?? join(here, '..', 'src', 'tokens.css');
  process.exit(report(loadTokenFile(path), path));
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
