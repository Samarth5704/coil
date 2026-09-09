// Phase 6 — the two bugs that only the rendered page could show.
//
// Both were found by looking at the running game and fixed without a test
// naming either of them, which means both could come back silently. This file
// is the pair of names.
//
// ON THE LIMITS OF WHAT IS ASSERTED HERE, SAID PLAINLY.
//
// The first bug was a CASCADE bug: `.gameover { display: flex }` in the page's
// own stylesheet beats the UA stylesheet's `[hidden] { display: none }`,
// because an author rule outranks a UA rule at equal specificity. The
// game-over region therefore sat on the page, reading "Run over.", from the
// moment the page loaded — while the DOM was entirely correct, the `hidden`
// attribute present and the summary empty.
//
// The fake DOM in tests/fake-dom.js has no cascade. It stores attributes and
// text; it has no stylesheet, no specificity, no computed style, and adding
// one to it would be writing a browser rather than testing this game. So the
// DOM-side assertion below — the region carries `hidden` on a fresh session —
// is real but is NOT the assertion that would have caught this bug, because
// that assertion passed throughout the bug.
//
// What is available instead is the file. These cases parse index.html as text
// and assert the rule that makes `hidden` win is present, and that no rule
// setting `display` on the game-over region is left to outrank it. That is a
// weaker check than a browser would give — it reads a stylesheet rather than
// resolving one — and it is named here as weaker so nobody later mistakes it
// for proof that the page renders correctly. It bites on exactly the edit that
// caused the bug, which is what a regression test is for.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { IDLE_INSTRUCTION } from '../src/render/labels.js';
import { createGameOver } from '../src/ui/gameover.js';
import { createReadout } from '../src/ui/readout.js';
import { appMarkup } from './fake-dom.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

// The page's own <style> block. src/tokens.css holds colours and no layout, so
// every `display` in play is in here.
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

// Rules as { selector, body }, with comments stripped first so a `display`
// mentioned in prose is not read as a declaration.
function parseRules(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  // Flat rules only, plus the contents of any at-rule block, which is where
  // the media queries put theirs.
  const body = withoutComments.replace(/@[\w-]+[^{]*\{/g, '');
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2].trim() });
  }
  return rules;
}

const rules = parseRules(styleBlock);

// The attribute an element carries, from the raw tag text. Written against the
// file rather than a DOM because that is the point of this file.
function tagFor(pattern) {
  const match = html.match(pattern);
  if (!match) return null;
  const attributes = {};
  for (const attribute of match[0].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[attribute[1]] = attribute[2];
  }
  return attributes;
}

describe('the game-over region is not displayed before the first death', () => {
  it('carries the hidden attribute in the markup the browser first parses', () => {
    expect(html).toMatch(/<div[^>]*data-role="gameover"[^>]*\shidden[\s>]/);
  });

  it('carries it on a fresh session too, before any run has ended', () => {
    // True throughout the bug: the DOM was never wrong. Kept because it pins
    // the module's half of the contract, and named honestly at the top of this
    // file as the half that did not catch it.
    const markup = appMarkup();
    const readout = createReadout({ root: markup.panel });
    const gameOver = createGameOver({
      root: markup.panel, writeSummary: readout.setSummary, onRestart: () => {},
    });

    expect(gameOver.isShown()).toBe(false);
    expect(markup.region.getAttribute('hidden')).not.toBe(null);
    expect(markup.panel.querySelector('[data-field="summary"]').textContent).toBe('');
  });

  it('gives [hidden] a rule that outranks an author display, which is what failed', () => {
    // The bug: `.gameover { display: flex }` is an author rule and
    // `[hidden] { display: none }` is a UA rule, so the author rule wins at
    // equal specificity and the region renders while hidden. This rule is what
    // puts it back.
    const hiddenRule = rules.find((rule) => rule.selector === '[hidden]');
    expect(hiddenRule, 'index.html has no [hidden] rule').toBeDefined();
    expect(hiddenRule.body).toMatch(/display\s*:\s*none\s*!important/);
  });

  it('leaves no display declaration on the region that could outrank it again', () => {
    // !important on the [hidden] rule wins over any normal declaration, so
    // this is belt and braces — but a later `display: flex !important` on the
    // region would take the page straight back, and nothing else would notice.
    const offenders = rules.filter((rule) => (
      /\.gameover|data-role="gameover"/.test(rule.selector)
      && /display\s*:[^;]*!important/.test(rule.body)
      && !/\[hidden\]/.test(rule.selector)
    ));
    expect(offenders).toEqual([]);
  });
});

describe('the idle instruction is one sentence, written once', () => {
  it('carries the identical text in index.html and in IDLE_INSTRUCTION', () => {
    // It is said twice — as text on the page and inside the canvas aria-label
    // for the idle phase — and two copies of a sentence drift. The page is the
    // copy a sighted player reads and the label is the copy a screen reader
    // reads; they must not come to describe different games.
    const node = html.match(/<p[^>]*data-role="idle"[^>]*>([\s\S]*?)<\/p>/);
    expect(node, 'no idle instruction in index.html').not.toBe(null);
    expect(node[1].trim()).toBe(IDLE_INSTRUCTION);
  });

  it('is visible on load, because it is not marked hidden in the markup', () => {
    // The board is idle when the page arrives, so the way in is on screen
    // before any script has run.
    const tag = html.match(/<p[^>]*data-role="idle"[^>]*>/)[0];
    expect(tag).not.toMatch(/\shidden[\s>=]/);
  });
});

describe('the reduced-motion control has a label bound to it', () => {
  it('matches the label for attribute to the select id, so a rename cannot part them', () => {
    // The collision: the label and the select shared a flex row, and the label
    // was painted over. It was fixed by stacking them — and a binding that
    // survives a rename is what keeps the control named at all, whatever the
    // layout does to it.
    const select = tagFor(/<select[^>]*data-setting="reducedMotion"[^>]*>/);
    expect(select, 'no reduced-motion select in index.html').not.toBe(null);
    expect(select.id, 'the reduced-motion select has no id to bind to').toBeTruthy();

    const label = tagFor(new RegExp(`<label[^>]*for="${select.id}"[^>]*>`));
    expect(label, `no <label for="${select.id}"> bound to the reduced-motion select`)
      .not.toBe(null);
    expect(label.for).toBe(select.id);
  });

  it('offers the three states the record holds, and only those', () => {
    const options = [...html.matchAll(/<option value="(system|on|off)"/g)].map((m) => m[1]);
    expect(options).toEqual(['system', 'on', 'off']);
  });

  it('binds the other two settings the same way, since it is the same mistake twice', () => {
    for (const setting of ['sound', 'stepMode']) {
      const input = tagFor(new RegExp(`<input[^>]*data-setting="${setting}"[^>]*>`));
      expect(input, `no ${setting} control in index.html`).not.toBe(null);
      expect(input.id, `the ${setting} control has no id`).toBeTruthy();

      const label = tagFor(new RegExp(`<label[^>]*for="${input.id}"[^>]*>`));
      expect(label, `no <label for="${input.id}"> bound to the ${setting} control`)
        .not.toBe(null);
    }
  });
});
