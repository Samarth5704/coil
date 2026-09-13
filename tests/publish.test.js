import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PUBLISH,
  EXCLUDE,
  classify,
  classifyEntries,
  readTopLevel,
  isUnderExcluded,
  collectPublishFiles,
  publish,
} from '../tools/publish.mjs';

// The classification cases inject listings; the copy cases build a throwaway
// tree under the OS temp directory and remove it afterwards. Nothing here
// writes into the repo, and the real-tree cases copy OUT of it into a temp
// directory, never the other way.

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');

const dir = (name) => ({ name, isDirectory: true });
const file = (name) => ({ name, isDirectory: false });

const temps = [];
function tempDir(label) {
  const path = mkdtempSync(join(tmpdir(), `coil-${label}-`));
  temps.push(path);
  return path;
}
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop(), { recursive: true, force: true });
});

function write(root, rel, text = '') {
  const full = join(root, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function listTree(root, rel = '') {
  const abs = rel === '' ? root : join(root, ...rel.split('/'));
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const next = rel === '' ? name : `${rel}/${name}`;
    if (statSync(join(abs, name)).isDirectory()) out.push(...listTree(root, next));
    else out.push(next);
  }
  return out;
}

describe('an unclassified top-level entry fails the build and is named', () => {
  it('reports a file on neither list as unclassified, by name', () => {
    const result = classifyEntries([file('index.html'), dir('src'), file('notes.txt')]);

    expect(result.ok).toBe(false);
    expect(result.unclassified).toEqual(['notes.txt']);
  });

  it('reports a directory on neither list as unclassified, with its trailing slash', () => {
    const result = classifyEntries([file('index.html'), dir('src'), dir('assets')]);

    expect(result.ok).toBe(false);
    expect(result.unclassified).toEqual(['assets/']);
  });

  it('does not let a directory pass on a file entry of the same name, or the reverse', () => {
    // The kind is part of the decision: `index.html/` is not `index.html`.
    expect(classify(dir('index.html'))).toBe('UNCLASSIFIED');
    expect(classify(file('src'))).toBe('UNCLASSIFIED');
  });

  it('classifies by exact name only — a near miss is unclassified, not matched', () => {
    expect(classify(file('index.htm'))).toBe('UNCLASSIFIED');
    expect(classify(dir('test'))).toBe('UNCLASSIFIED');
    expect(classify(file('CLAUDE.md.bak'))).toBe('UNCLASSIFIED');
  });

  it('exits non-zero from the CLI naming the entry, when run against a tree with a stray file', () => {
    const root = tempDir('stray');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', 'export const a = 1;');
    write(root, 'stray.txt', 'not on any list');

    const result = publish(root);

    expect(result.classification.ok).toBe(false);
    expect(result.classification.unclassified).toEqual(['stray.txt']);
    expect(result.copied).toBe(false);
  });

  it('copies nothing when anything is unclassified, even with --out given', () => {
    const root = tempDir('stray-out');
    const out = tempDir('stray-out-dist');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', 'export const a = 1;');
    write(root, 'stray.txt', 'not on any list');

    const result = publish(root, { out });

    expect(result.copied).toBe(false);
    expect(result.files).toEqual([]);
    expect(existsSync(join(out, 'index.html'))).toBe(false);
  });
});

describe('a nested file under an EXCLUDE name is not copied', () => {
  it('refuses src/tests/x.test.js even though src/ is on the PUBLISH list', () => {
    const root = tempDir('nested');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', 'export const a = 1;');
    write(root, 'src/tests/a.test.js', 'nope');
    write(root, 'src/node_modules/left-pad/index.js', 'nope');
    write(root, 'src/deep/package.json', '{}');

    const { files, refused } = collectPublishFiles(root);

    expect(files).toEqual(['index.html', 'src/a.js']);
    expect(refused).toEqual(['src/deep/package.json', 'src/node_modules', 'src/tests']);
  });

  it('does not create the refused paths in the output tree', () => {
    const root = tempDir('nested-copy');
    const out = tempDir('nested-copy-dist');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', 'export const a = 1;');
    write(root, 'src/tests/a.test.js', 'nope');

    const result = publish(root, { out });

    expect(result.copied).toBe(true);
    expect(listTree(out)).toEqual(['index.html', 'src/a.js']);
    expect(existsSync(join(out, 'src', 'tests'))).toBe(false);
  });

  it('applies every EXCLUDE name at every depth', () => {
    for (const form of EXCLUDE) {
      const name = form.replace(/\/$/, '');
      expect(isUnderExcluded(`src/${name}/anything.js`)).toBe(true);
      expect(isUnderExcluded(`src/deeper/${name}`)).toBe(true);
    }
    expect(isUnderExcluded('src/core/game.js')).toBe(false);
  });

  it('does not follow a top-level EXCLUDE directory at all', () => {
    const root = tempDir('top-exclude');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', '');
    write(root, 'tests/a.test.js', '');
    write(root, 'docs/spec.md', '');

    const { files } = collectPublishFiles(root);

    expect(files).toEqual(['index.html', 'src/a.js']);
  });
});

describe('the copied tree, from the real repo', () => {
  it('contains src/tokens.css and index.html', () => {
    const out = tempDir('real-dist');

    const result = publish(REPO, { out });

    expect(result.classification.ok).toBe(true);
    expect(result.copied).toBe(true);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'src', 'tokens.css'))).toBe(true);
  });

  it('contains no .test.js file', () => {
    const out = tempDir('real-dist-tests');

    publish(REPO, { out });

    const copied = listTree(out);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.filter((path) => path.endsWith('.test.js'))).toEqual([]);
  });

  it('contains nothing outside index.html and src/', () => {
    const out = tempDir('real-dist-shape');

    publish(REPO, { out });

    for (const path of listTree(out)) {
      expect(path === 'index.html' || path.startsWith('src/')).toBe(true);
    }
  });

  it('classifies every top-level entry of the repo as it stands, with nothing unclassified', () => {
    const result = classifyEntries(readTopLevel(REPO));

    expect(result.unclassified).toEqual([]);
    expect(result.publish).toEqual(['index.html', 'src/']);
  });

  it('leaves the tool\'s own output directory out of the classification, by identity', () => {
    // Running `--out dist` twice must not fail on the dist/ it made the first
    // time. The skip is on the resolved path of the --out argument, not on
    // the name "dist".
    const root = tempDir('rerun');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', '');

    publish(root, { out: 'dist' });
    const second = publish(root, { out: 'dist' });

    expect(second.classification.ok).toBe(true);
    expect(second.copied).toBe(true);
  });

  it('refuses to write the output into the repo root or into the PUBLISH set', () => {
    const root = tempDir('refuse');
    write(root, 'index.html', '<!doctype html>');
    write(root, 'src/a.js', '');

    expect(() => publish(root, { out: '.' })).toThrow(/PUBLISH set/);
    expect(() => publish(root, { out: 'src/out' })).toThrow(/PUBLISH set/);
  });
});

describe('the lists themselves', () => {
  it('hold every directory with a trailing slash and every file without one', () => {
    for (const form of [...PUBLISH, ...EXCLUDE]) {
      const isDir = form.endsWith('/');
      const real = join(REPO, form.replace(/\/$/, ''));
      if (!existsSync(real)) continue;
      expect(statSync(real).isDirectory()).toBe(isDir);
    }
  });

  it('share no entry, so nothing can be both published and excluded', () => {
    for (const form of PUBLISH) expect(EXCLUDE).not.toContain(form);
  });
});
