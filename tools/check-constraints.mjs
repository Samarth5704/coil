#!/usr/bin/env node
/**
 * Coil — the correctness gate.
 *
 * Seven checks, each drawn from a rule in CLAUDE.md or docs/spec.md. Every
 * failure names the offending file and line. Any failure exits non-zero.
 *
 *   1. src/core/ contains zero import statements.
 *   2. src/core/ references none of: document, window, Date.now, Math.random,
 *      localStorage, globalThis, performance.
 *   3. No file in src/ contains innerHTML.
 *   4. No six-digit hex literal appears in src/ except in src/tokens.css.
 *   5. package.json has no "dependencies" key, or it is empty.
 *   6. src/main.js is the only file in src/ referencing window or localStorage.
 *   7. No .mp3, .wav or .ogg exists anywhere in the repo.
 *
 * What counts as a reference. The identifier checks (1, 2, 6) run over the
 * source with comments AND string literals blanked out, because a comment
 * saying "never touches localStorage" and an error message that says "pass
 * window.localStorage in" are not references to the global — they are the
 * rule being explained. The two text checks (3, 4) blank comments only:
 * `el['innerHTML']` and `fillStyle = '#ff0000'` live in strings and are the
 * very things those checks exist to catch. Blanking keeps newlines, so a line
 * number reported here is a line number in the file.
 *
 * Two known limits, named so they are not mistaken for coverage.
 *
 * The identifier checks assume identifiers are written literally. Blanking
 * string literals means a name reached through dynamic property access is
 * not seen: `globalThis['localStorage']` passes check 6 outright,
 * `globalThis['document']` passes check 2 for the `document` half (only the
 * literal `globalThis` is reported), and `el['inner' + 'HTML']` passes
 * check 3 because no token `innerHTML` exists to find. This gate catches
 * the honest mistake — a global reached for out of habit — not code written
 * to get past it; `tests/constraints.test.js` pins the gap as a fact rather
 * than a promise.
 *
 * A regular-expression literal containing a quote or a slash-slash is read as
 * the start of a string or comment. No such literal exists in src/ today.
 *
 * Every check takes a tree it is handed rather than reading the disk itself,
 * so a test can inject a crafted violation without writing into src/.
 *
 * No dependencies. Node's built-in fs and path only.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** Directories the walker never enters. The repo's own metadata and the
 *  installed dev dependencies, which are not repo content. */
export const NOT_WALKED = new Set(['.git', 'node_modules']);

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg'];

export const CORE_FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'localStorage',
  'globalThis',
  'performance',
];

export const HEX_EXEMPT = 'src/tokens.css';
export const WINDOW_ALLOWED = 'src/main.js';

// ---------------------------------------------------------------------------
// Scrubbing

function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Blank comments, and optionally string literals, from JavaScript source.
 * Newlines survive so line numbers are preserved. Template literals keep the
 * code inside `${ }` when strings are blanked, since that is code.
 */
export function scrubJs(source, { strings }) {
  let out = '';
  let i = 0;
  const n = source.length;

  function takeString(quote) {
    // i is on the opening quote
    let j = i + 1;
    while (j < n && source[j] !== quote && source[j] !== '\n') {
      if (source[j] === '\\') j += 1;
      j += 1;
    }
    const end = Math.min(n, j + 1);
    const body = source.slice(i, end);
    out += strings ? quote + blank(body.slice(1, -1)) + quote : body;
    i = end;
  }

  function takeTemplate() {
    // i is on the opening backtick
    out += '`';
    i += 1;
    let literal = '';
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        literal += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') {
        out += strings ? blank(literal) : literal;
        out += '`';
        i += 1;
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        out += strings ? blank(literal) : literal;
        literal = '';
        out += '${';
        i += 2;
        takeCodeUntilBrace();
        out += '}';
        continue;
      }
      literal += c;
      i += 1;
    }
    out += strings ? blank(literal) : literal;
  }

  function takeCodeUntilBrace() {
    let depth = 0;
    while (i < n) {
      const c = source[i];
      if (c === '}' && depth === 0) {
        i += 1;
        return;
      }
      if (c === '{') depth += 1;
      if (c === '}') depth -= 1;
      step();
    }
  }

  function step() {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') j += 1;
      out += blank(source.slice(i, j));
      i = j;
      return;
    }
    if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      return;
    }
    if (c === "'" || c === '"') {
      takeString(c);
      return;
    }
    if (c === '`') {
      takeTemplate();
      return;
    }
    out += c;
    i += 1;
  }

  while (i < n) step();
  return out;
}

/** Blank block comments from CSS, keeping newlines. */
export function scrubCss(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, blank);
}

/** Blank comments from a file by its extension; strings too when asked. */
export function scrub(path, source, { strings }) {
  if (path.endsWith('.css')) return scrubCss(source);
  if (path.endsWith('.js') || path.endsWith('.mjs')) return scrubJs(source, { strings });
  return source;
}

// ---------------------------------------------------------------------------
// The tree

/**
 * Read the repo into { files, paths, packageJson }.
 *
 *   files       Map of repo-relative POSIX path -> text, for every file
 *               under src/ (the only directory the text checks read).
 *   paths       Every repo-relative path in the repo, files only, outside
 *               NOT_WALKED. For the audio-file check.
 *   packageJson The parsed package.json, or null if there is none.
 *   packageJsonText Its raw text, for the line number in a finding.
 */
export function readTree(root) {
  const files = new Map();
  const paths = [];

  function walk(relDir) {
    const abs = relDir === '' ? root : join(root, ...relDir.split('/'));
    for (const name of readdirSync(abs).sort()) {
      if (relDir === '' && NOT_WALKED.has(name)) continue;
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const stat = statSync(join(abs, name));
      if (stat.isDirectory()) {
        walk(rel);
      } else {
        paths.push(rel);
        if (rel.startsWith('src/')) files.set(rel, readFileSync(join(abs, name), 'utf8'));
      }
    }
  }

  walk('');

  let packageJson = null;
  let packageJsonText = null;
  try {
    packageJsonText = readFileSync(join(root, 'package.json'), 'utf8');
    packageJson = JSON.parse(packageJsonText);
  } catch {
    packageJson = null;
  }

  return { files, paths, packageJson, packageJsonText };
}

// ---------------------------------------------------------------------------
// Findings

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** Every match of `pattern` in `text`, as { line, match }. */
function findAll(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const re = new RegExp(pattern.source, flags);
  const hits = [];
  for (const m of text.matchAll(re)) hits.push({ line: lineOf(text, m.index), match: m[0] });
  return hits;
}

function finding(check, file, line, message) {
  return { check, file, line, message };
}

function srcFiles(tree, prefix) {
  return [...tree.files].filter(([path]) => path.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// The seven checks. Each returns an array of findings; empty means pass.

/** 1. src/core/ contains zero import statements. */
export function checkCoreImports(tree) {
  const out = [];
  for (const [path, source] of srcFiles(tree, 'src/core/')) {
    const code = scrub(path, source, { strings: true });
    // `import` is a reserved word: on scrubbed code it can only be a static
    // import, a dynamic import() or import.meta. All three are banned here.
    for (const hit of findAll(code, /\bimport\b/)) {
      out.push(finding('core-imports', path, hit.line, 'src/core/ must not import anything'));
    }
    for (const hit of findAll(code, /\bexport\b[^;\n]*\bfrom\b/)) {
      out.push(finding('core-imports', path, hit.line, 'src/core/ must not re-export from another module'));
    }
  }
  return out;
}

/** 2. src/core/ references no DOM, clock, randomness, storage or global. */
export function checkCoreGlobals(tree) {
  const out = [];
  const names = CORE_FORBIDDEN_GLOBALS.join('|');
  const pattern = new RegExp(`\\b(?:${names})\\b|\\bDate\\s*\\.\\s*now\\b|\\bMath\\s*\\.\\s*random\\b`);
  for (const [path, source] of srcFiles(tree, 'src/core/')) {
    const code = scrub(path, source, { strings: true });
    for (const hit of findAll(code, pattern)) {
      out.push(
        finding('core-globals', path, hit.line, `src/core/ must not reference ${hit.match.replace(/\s+/g, '')}`),
      );
    }
  }
  return out;
}

/** 3. No file in src/ contains innerHTML. Strings are kept: el['innerHTML'] counts. */
export function checkInnerHtml(tree) {
  const out = [];
  for (const [path, source] of srcFiles(tree, 'src/')) {
    const code = scrub(path, source, { strings: false });
    for (const hit of findAll(code, /innerHTML/)) {
      out.push(finding('inner-html', path, hit.line, 'innerHTML is never used; reconcile keyed nodes'));
    }
  }
  return out;
}

/** 4. No six-digit hex literal in src/ outside src/tokens.css. Strings are kept. */
export function checkHexLiterals(tree) {
  const out = [];
  for (const [path, source] of srcFiles(tree, 'src/')) {
    if (path === HEX_EXEMPT) continue;
    const code = scrub(path, source, { strings: false });
    for (const hit of findAll(code, /#[0-9a-fA-F]{6}\b/)) {
      out.push(
        finding('hex-literal', path, hit.line, `hex literal ${hit.match} belongs in ${HEX_EXEMPT}, not here`),
      );
    }
  }
  return out;
}

/** 5. package.json declares no runtime dependencies. */
export function checkNoDependencies(tree) {
  const pkg = tree.packageJson;
  if (pkg === null) return [finding('dependencies', 'package.json', 1, 'package.json is missing or unparseable')];
  if (!('dependencies' in pkg)) return [];
  const names = Object.keys(pkg.dependencies ?? {});
  if (names.length === 0) return [];
  const line = tree.packageJsonText ? lineOf(tree.packageJsonText, tree.packageJsonText.indexOf('"dependencies"')) : 1;
  return [
    finding('dependencies', 'package.json', line, `runtime dependencies are forbidden; found: ${names.join(', ')}`),
  ];
}

/** 6. src/main.js is the only file in src/ referencing window or localStorage. */
export function checkWindowOnlyInMain(tree) {
  const out = [];
  for (const [path, source] of srcFiles(tree, 'src/')) {
    if (path === WINDOW_ALLOWED) continue;
    const code = scrub(path, source, { strings: true });
    for (const hit of findAll(code, /\b(?:window|localStorage)\b/)) {
      out.push(
        finding('window-in-main', path, hit.line, `${hit.match} is named only in ${WINDOW_ALLOWED}; pass it in`),
      );
    }
  }
  return out;
}

/** 7. No audio file anywhere in the repo. Every sound is synthesised. */
export function checkNoAudioFiles(tree) {
  const out = [];
  for (const path of tree.paths) {
    const lower = path.toLowerCase();
    if (AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      out.push(finding('audio-files', path, 0, 'audio files are forbidden; every sound is RTTTL synthesised at runtime'));
    }
  }
  return out;
}

export const CHECKS = [
  checkCoreImports,
  checkCoreGlobals,
  checkInnerHtml,
  checkHexLiterals,
  checkNoDependencies,
  checkWindowOnlyInMain,
  checkNoAudioFiles,
];

/** Run every check over a tree. Returns { findings, ok }. */
export function runChecks(tree, checks = CHECKS) {
  const findings = checks.flatMap((check) => check(tree));
  return { findings, ok: findings.length === 0 };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const tree = readTree(root);

  const { findings, ok } = runChecks(tree);

  console.log('Coil — constraint gate');
  console.log(`Checked ${tree.files.size} files under src/, ${tree.paths.length} paths in the repo.`);
  console.log('');

  if (ok) {
    console.log(`OK — ${CHECKS.length} checks, no findings.`);
    process.exit(0);
  }

  for (const f of findings) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`FAIL [${f.check}] ${where} — ${f.message}`);
  }
  console.error('');
  console.error(`${findings.length} finding(s).`);
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
