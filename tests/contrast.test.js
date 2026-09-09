import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DECORATIVE,
  THRESHOLD,
  parseTokens,
  contrastRatio,
  round2,
  checkTokens,
  rampSteps,
} from '../tools/contrast.mjs';

// Every case here works against either an injected token Map or a read-only
// parse of src/tokens.css. Nothing shells out to the CLI and nothing writes to
// src/tokens.css — a test that has to mutate the file it is checking will one
// day leave it mutated.

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = join(here, '..', 'src', 'tokens.css');
const tokensCss = readFileSync(TOKENS_PATH, 'utf8');
const tokens = parseTokens(tokensCss);

const BG = '#0a0e0c';

describe('the checker reports failure on a pair that does not clear the line', () => {
  it('fails a meaningful token deliberately set too dark against the background', () => {
    // #3a4a42 is 2.31:1 on #0a0e0c — visible, and nowhere near 4.5:1.
    const injected = new Map([
      ['bg', BG],
      ['text-primary', '#f2f7f4'],
      ['text-muted', '#3a4a42'],
    ]);

    const result = checkTokens(injected);

    expect(result.ok).toBe(false);
    expect(result.failures.map((row) => row.name)).toEqual(['text-muted']);
    expect(result.failures[0].ratio).toBeLessThan(THRESHOLD);
  });

  it('reports success when the same set clears the line, so the failure above is the token and not the checker', () => {
    const injected = new Map([
      ['bg', BG],
      ['text-primary', '#f2f7f4'],
      ['text-muted', '#8a9a91'],
    ]);

    const result = checkTokens(injected);

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('throws rather than passing vacuously when the token set has no background to measure against', () => {
    expect(() => checkTokens(new Map([['text-primary', '#f2f7f4']]))).toThrow(/--bg/);
  });
});

describe('the computed ratios match the figures the spec records', () => {
  it('gives 12.19 for #6fe3a1 on #0a0e0c', () => {
    expect(round2(contrastRatio('#6fe3a1', BG))).toBe(12.19);
  });

  it('gives 7.29 for #ff7361 on #0a0e0c', () => {
    expect(round2(contrastRatio('#ff7361', BG))).toBe(7.29);
  });

  it('gives 10.37 for the focus colour #7dc4ff on #0a0e0c', () => {
    expect(round2(contrastRatio('#7dc4ff', BG))).toBe(10.37);
  });

  it('gives 5.57 for the wall colour #7d8d85 on #0a0e0c', () => {
    expect(round2(contrastRatio('#7d8d85', BG))).toBe(5.57);
  });

  it('gives the same ratio whichever way round the pair is passed', () => {
    expect(round2(contrastRatio(BG, '#6fe3a1'))).toBe(12.19);
  });
});

describe('--focus does not collide with the ramp', () => {
  // This shipped once: --focus was #6fe3a1, the same hex as --ramp-0-calm, so
  // the focus ring vanished against a calm-state snake. It must not be able to
  // come back quietly.
  it('is not equal to any ramp step hex', () => {
    const focus = tokens.get('focus');
    const rampHexes = rampSteps(tokens).map((step) => step.hex);

    expect(focus).toBeDefined();
    expect(rampHexes).not.toContain(focus);
  });

  it('is 10.37:1 against --bg as declared in the token file', () => {
    expect(round2(contrastRatio(tokens.get('focus'), tokens.get('bg')))).toBe(10.37);
  });

  it('separates from every ramp step by well under 1.5:1, which is why a single-colour ring is not enough', () => {
    // Recorded as a fact, not as a target. WCAG contrast is luminance-only,
    // and no hex that clears 4.5:1 on this background clears it against the
    // ramp too. Phase 5 draws two strokes, a dark inner and a light outer.
    for (const step of rampSteps(tokens)) {
      const ratio = round2(contrastRatio(tokens.get('focus'), step.hex));
      expect(ratio).toBeLessThan(1.5);
    }
  });
});

describe('--wall is meaningful, because walls kill', () => {
  it('is checked against the threshold rather than exempted', () => {
    const result = checkTokens(tokens);
    const wall = result.rows.find((row) => row.name === 'wall');

    expect(wall).toBeDefined();
    expect(wall.passes).toBe(true);
    expect(DECORATIVE).not.toContain('wall');
  });

  it('clears 4.5:1 against --bg at 5.57:1, and reads as boundary rather than content against --food at 3.05:1', () => {
    expect(round2(contrastRatio(tokens.get('wall'), tokens.get('bg')))).toBe(5.57);
    expect(round2(contrastRatio(tokens.get('wall'), tokens.get('food')))).toBe(3.05);
  });
});

describe('the ramp in src/tokens.css', () => {
  it('has all five steps at indices 0 through 4, in order', () => {
    const steps = rampSteps(tokens);

    expect(steps.map((step) => step.index)).toEqual([0, 1, 2, 3, 4]);
    expect(steps.map((step) => step.label)).toEqual([
      'calm',
      'close',
      'tight',
      'hot',
      'sealed',
    ]);
  });

  it('uses no hex value twice, so no two steps are the same colour', () => {
    const hexes = rampSteps(tokens).map((step) => step.hex);

    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('clears 4.5:1 against --bg at every step, since each step is a meaningful mark', () => {
    for (const step of rampSteps(tokens)) {
      expect(round2(contrastRatio(step.hex, tokens.get('bg')))).toBeGreaterThanOrEqual(
        THRESHOLD,
      );
    }
  });
});

describe('decorative tokens are exempted by name and by nothing else', () => {
  const LATTICE = '#1a211d'; // 1.18:1 on #0a0e0c

  it('does not fail on a decorative token below the threshold', () => {
    const injected = new Map([
      ['bg', BG],
      ['lattice', LATTICE],
    ]);

    const result = checkTokens(injected);

    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it('fails on the very same hex under a meaningful token name', () => {
    const injected = new Map([
      ['bg', BG],
      ['text-muted', LATTICE],
    ]);

    const result = checkTokens(injected);

    expect(result.ok).toBe(false);
    expect(result.failures.map((row) => row.name)).toEqual(['text-muted']);
  });

  it('keeps the exemption list to names that are actually declared decorative in the token file', () => {
    for (const name of DECORATIVE) {
      expect(tokens.has(name)).toBe(true);
    }
  });
});

describe('src/tokens.css as it stands', () => {
  it('passes the check with every meaningful token at or above 4.5:1', () => {
    const result = checkTokens(tokens);

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reads its hexes from the file, so an edited hex changes the computed ratio with no edit to the tool', () => {
    const edited = parseTokens(tokensCss.replace('--food: #e8f2ec', '--food: #101010'));

    expect(edited.get('food')).toBe('#101010');
    expect(checkTokens(edited).ok).toBe(false);
    // and the real file is untouched by that
    expect(tokens.get('food')).toBe('#e8f2ec');
  });

  it('ignores hexes that appear inside comments rather than reading them as tokens', () => {
    const withComment = parseTokens(`
      /* --ghost: #ff0000; a hex in prose, not a declaration */
      :root { --bg: ${BG}; }
    `);

    expect(withComment.has('ghost')).toBe(false);
    expect(withComment.get('bg')).toBe(BG);
  });
});
