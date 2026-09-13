#!/usr/bin/env node
/**
 * Coil — the deploy allowlist.
 *
 * Walks every top-level entry in the repo and classifies each one against two
 * explicit lists held in this file: PUBLISH and EXCLUDE. An entry on neither
 * list is UNCLASSIFIED, and the tool exits non-zero naming it. Nothing is
 * classified by pattern, extension or heuristic — a new top-level file fails
 * the build until a human puts it on one of the lists, in a diff someone
 * reviews.
 *
 * Given `--out <dir>` it copies the PUBLISH set into that directory, keeping
 * the tree structure. It never copies a directory blind: it walks and copies
 * files one at a time, and refuses to copy anything whose path carries an
 * EXCLUDE name at any depth, even nested inside a PUBLISH directory.
 *
 * No dependencies. Node's built-in fs and path only.
 */

import {
  readdirSync,
  statSync,
  lstatSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

/**
 * The two lists. A trailing slash means "a directory"; no slash means "a
 * file". A directory named `index.html` or a file named `src` would match
 * neither and fail — the kind of an entry is part of the decision, not just
 * its name.
 */
export const PUBLISH = ['index.html', 'src/'];

export const EXCLUDE = [
  'tests/',
  'tools/',
  'docs/',
  '.github/',
  '.claude/',
  'node_modules/',
  'package.json',
  'package-lock.json',
  'CLAUDE.md',
  'README.md',
  'LICENSE',
  '.gitignore',
  '.gitattributes',
  // What this tool writes with `npm run publish`. Ignored by git, but present
  // on a machine that has run it, and a build product is never content.
  'dist/',
  // The repository's own metadata directory. Present in every checkout, never
  // content, and listed here rather than skipped in code so that the rule
  // "everything at the top level is on a list" has no exception hidden in it.
  '.git/',
];

/**
 * An entry as the walker reports it: its top-level name and whether it is a
 * directory. The list form (`name/` for a directory) is what the lists use.
 */
function listForm(entry) {
  return entry.isDirectory ? `${entry.name}/` : entry.name;
}

/**
 * Classify one top-level entry. Returns 'PUBLISH', 'EXCLUDE' or
 * 'UNCLASSIFIED'. Exact match against the list form only.
 */
export function classify(entry, { publish = PUBLISH, exclude = EXCLUDE } = {}) {
  const form = listForm(entry);
  if (publish.includes(form)) return 'PUBLISH';
  if (exclude.includes(form)) return 'EXCLUDE';
  return 'UNCLASSIFIED';
}

/**
 * Classify a whole set of top-level entries. Takes the entries rather than
 * reading the disk, so a test can hand in a crafted listing without creating
 * files.
 *
 * Returns { publish, exclude, unclassified, ok }. `ok` is false when anything
 * is unclassified.
 */
export function classifyEntries(entries, lists = {}) {
  const publish = [];
  const exclude = [];
  const unclassified = [];

  for (const entry of entries) {
    const verdict = classify(entry, lists);
    const form = listForm(entry);
    if (verdict === 'PUBLISH') publish.push(form);
    else if (verdict === 'EXCLUDE') exclude.push(form);
    else unclassified.push(form);
  }

  return { publish, exclude, unclassified, ok: unclassified.length === 0 };
}

/**
 * Read the top-level entries of a directory. `skipPath`, when given, is the
 * absolute path of the tool's own output directory: it is not repo content and
 * is left out of the listing by identity, never by name.
 */
export function readTopLevel(root, { skipPath = null } = {}) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (skipPath !== null && resolve(full) === resolve(skipPath)) continue;
    entries.push({ name, isDirectory: statSync(full).isDirectory() });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The EXCLUDE names that apply at any depth. A path segment equal to one of
 * these — `tests`, `node_modules`, `package.json` and the rest — is refused
 * wherever it appears, so `src/tests/x.test.js` or `src/node_modules/y` is
 * never copied even though `src/` is on the PUBLISH list.
 */
export function excludedSegments(exclude = EXCLUDE) {
  return new Set(exclude.map((form) => form.replace(/\/$/, '')));
}

/**
 * True when any segment of a repo-relative path (POSIX separators) is an
 * EXCLUDE name.
 */
export function isUnderExcluded(relPath, exclude = EXCLUDE) {
  const banned = excludedSegments(exclude);
  return relPath.split('/').some((segment) => banned.has(segment));
}

/**
 * List every file under the PUBLISH set, as repo-relative POSIX paths, with
 * files under an EXCLUDE name refused. Walks file by file; symlinks are not
 * followed and are reported as refused rather than copied, because a link can
 * point anywhere.
 *
 * Returns { files, refused }.
 */
export function collectPublishFiles(root, lists = {}) {
  const publish = lists.publish ?? PUBLISH;
  const exclude = lists.exclude ?? EXCLUDE;
  const files = [];
  const refused = [];

  function walk(relDir) {
    const abs = join(root, ...relDir.split('/'));
    for (const name of readdirSync(abs).sort()) {
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const stat = lstatSync(join(abs, name));

      if (isUnderExcluded(rel, exclude)) {
        refused.push(rel);
        continue;
      }
      if (stat.isSymbolicLink()) {
        refused.push(rel);
        continue;
      }
      if (stat.isDirectory()) walk(rel);
      else files.push(rel);
    }
  }

  for (const form of publish) {
    if (form.endsWith('/')) {
      const dir = form.slice(0, -1);
      if (existsSync(join(root, dir))) walk(dir);
    } else if (existsSync(join(root, form))) {
      files.push(form);
    }
  }

  return { files, refused };
}

/** Copy each listed file from root into out, creating directories as needed. */
export function copyFiles(root, out, files) {
  for (const rel of files) {
    const segments = rel.split('/');
    const from = join(root, ...segments);
    const to = join(out, ...segments);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

/**
 * The whole operation: classify the top level, refuse on anything
 * unclassified, and — when `out` is given — copy the PUBLISH files into it.
 *
 * Returns { classification, files, refused, copied }. Throws nothing on an
 * unclassified entry; the caller decides what a failure looks like.
 */
export function publish(root, { out = null, lists = {} } = {}) {
  const skipPath = out === null ? null : resolve(root, out);
  const classification = classifyEntries(readTopLevel(root, { skipPath }), lists);

  if (!classification.ok) {
    return { classification, files: [], refused: [], copied: false };
  }

  const { files, refused } = collectPublishFiles(root, lists);

  if (out !== null) {
    const outAbs = resolve(root, out);
    const rel = relative(resolve(root), outAbs);
    const publishList = lists.publish ?? PUBLISH;
    const insidePublish = publishList.some(
      (form) => form.endsWith('/') && (rel === form.slice(0, -1) || rel.startsWith(form.slice(0, -1) + sep)),
    );
    if (rel === '' || insidePublish) {
      throw new Error(`refusing to write the publish tree into ${outAbs}: it is inside the PUBLISH set`);
    }
    mkdirSync(outAbs, { recursive: true });
    copyFiles(root, outAbs, files);
    return { classification, files, refused, copied: true };
  }

  return { classification, files, refused, copied: false };
}

function parseArgs(argv) {
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = argv[i + 1];
      if (out === undefined) throw new Error('--out needs a directory');
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { out };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  const { out } = parseArgs(process.argv.slice(2));

  const result = publish(root, { out });
  const { classification } = result;

  console.log('Coil — publish allowlist');
  console.log('');
  for (const form of classification.publish) console.log(`  PUBLISH       ${form}`);
  for (const form of classification.exclude) console.log(`  EXCLUDE       ${form}`);
  for (const form of classification.unclassified) console.log(`  UNCLASSIFIED  ${form}`);
  console.log('');

  if (!classification.ok) {
    for (const form of classification.unclassified) {
      console.error(
        `FAIL — top-level entry "${form}" is on neither the PUBLISH nor the EXCLUDE list in tools/publish.mjs.`,
      );
    }
    console.error('Add it to one of the two lists. Nothing is classified by pattern.');
    process.exit(1);
  }

  console.log(`${result.files.length} files in the publish set:`);
  for (const file of result.files) console.log(`  ${file}`);
  if (result.refused.length > 0) {
    console.log('');
    console.log('Refused — under an EXCLUDE name inside the PUBLISH set:');
    for (const file of result.refused) console.log(`  ${file}`);
  }

  if (result.copied) {
    console.log('');
    console.log(`Copied ${result.files.length} files to ${resolve(root, out)}.`);
  }
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
