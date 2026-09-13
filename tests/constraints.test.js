import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  scrubJs,
  readTree,
  runChecks,
  checkCoreImports,
  checkCoreGlobals,
  checkInnerHtml,
  checkHexLiterals,
  checkNoDependencies,
  checkWindowOnlyInMain,
  checkNoAudioFiles,
  CHECKS,
} from '../tools/check-constraints.mjs';

// Each check is exercised twice: on a crafted violation injected as a tree,
// and on the real repo read from disk. Nothing writes into src/.

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');
const real = readTree(REPO);

/** A tree holding just the files given, with a clean package.json. */
function tree(files, extra = {}) {
  return {
    files: new Map(Object.entries(files)),
    paths: [...Object.keys(files), ...(extra.paths ?? [])],
    packageJson: 'packageJson' in extra ? extra.packageJson : { name: 'x', devDependencies: { vitest: '1' } },
    packageJsonText: extra.packageJsonText ?? '{\n  "name": "x"\n}\n',
  };
}

describe('the scrubber', () => {
  it('blanks a line comment but keeps the newline, so lines still count', () => {
    const out = scrubJs('a // window\nb', { strings: true });
    expect(out).toBe('a          \nb');
  });

  it('blanks a block comment across lines and keeps every newline', () => {
    const out = scrubJs('a /* window\n document */ b', { strings: true });
    expect(out.split('\n').length).toBe(2);
    expect(out).not.toMatch(/window|document/);
    expect(out.endsWith(' b')).toBe(true);
  });

  it('blanks string contents when asked, and keeps them when not', () => {
    const src = "throw new Error('pass window.localStorage in')";
    expect(scrubJs(src, { strings: true })).not.toMatch(/window/);
    expect(scrubJs(src, { strings: false })).toMatch(/window/);
  });

  it('keeps the code inside a template literal\'s ${ } while blanking the text around it', () => {
    const src = 'const s = `see window ${window.name} here`;';
    const out = scrubJs(src, { strings: true });
    expect(out.match(/window/g)).toHaveLength(1);
    expect(out).toContain('${window.name}');
  });

  it('does not mistake a slash-slash inside a string for a comment', () => {
    const src = "const u = 'http://x'; window.y";
    expect(scrubJs(src, { strings: false })).toContain('window.y');
    expect(scrubJs(src, { strings: true })).toContain('window.y');
  });
});

describe('1. src/core/ contains zero import statements', () => {
  it('fails on a static import in src/core/, naming the file and line', () => {
    const findings = checkCoreImports(
      tree({ 'src/core/game.js': "const a = 1;\nimport { x } from '../store.js';\n" }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/core/game.js', line: 2 });
  });

  it('fails on a dynamic import() and on export-from', () => {
    expect(checkCoreImports(tree({ 'src/core/a.js': "await import('./b.js');\n" }))).toHaveLength(1);
    expect(checkCoreImports(tree({ 'src/core/a.js': "export { b } from './b.js';\n" }))).toHaveLength(1);
  });

  it('does not fail on the word "import" in a comment or a string', () => {
    const findings = checkCoreImports(
      tree({ 'src/core/a.js': "// this file imports nothing\nconst s = 'import';\n" }),
    );
    expect(findings).toEqual([]);
  });

  it('passes on the real tree', () => {
    expect(checkCoreImports(real)).toEqual([]);
  });
});

describe('2. src/core/ references no DOM, clock, randomness, storage or global', () => {
  const cases = [
    ['document', 'document.body'],
    ['window', 'window.x'],
    ['Date.now', 'Date.now()'],
    ['Date.now with whitespace', 'Date . now()'],
    ['Math.random', 'Math.random()'],
    ['localStorage', 'localStorage.getItem("k")'],
    ['globalThis', 'globalThis.x'],
    ['performance', 'performance.now()'],
  ];

  for (const [label, code] of cases) {
    it(`fails on ${label} in src/core/`, () => {
      const findings = checkCoreGlobals(tree({ 'src/core/game.js': `const a = 1;\nconst b = ${code};\n` }));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ file: 'src/core/game.js', line: 2 });
    });
  }

  it('ignores the same names in a comment', () => {
    const findings = checkCoreGlobals(
      tree({ 'src/core/a.js': '// no Date.now(), no Math.random(), no localStorage\n' }),
    );
    expect(findings).toEqual([]);
  });

  it('ignores the same names outside src/core/', () => {
    expect(checkCoreGlobals(tree({ 'src/main.js': 'window.x = 1;\n' }))).toEqual([]);
  });

  it('passes on the real tree', () => {
    expect(checkCoreGlobals(real)).toEqual([]);
  });
});

describe('3. no file in src/ contains innerHTML', () => {
  it('fails on an innerHTML assignment, naming the file and line', () => {
    const findings = checkInnerHtml(tree({ 'src/ui/list.js': 'const a = 1;\nel.innerHTML = "";\n' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/ui/list.js', line: 2 });
  });

  it('fails on innerHTML reached through a string key too', () => {
    expect(checkInnerHtml(tree({ 'src/ui/list.js': "el['innerHTML'] = '';\n" }))).toHaveLength(1);
  });

  it('ignores innerHTML in a comment', () => {
    expect(checkInnerHtml(tree({ 'src/ui/list.js': '// never innerHTML\n' }))).toEqual([]);
  });

  it('passes on the real tree', () => {
    expect(checkInnerHtml(real)).toEqual([]);
  });
});

describe('4. no six-digit hex literal in src/ except src/tokens.css', () => {
  it('fails on a hex in a JS string, naming the file and line', () => {
    const findings = checkHexLiterals(tree({ 'src/render/canvas.js': "const a = 1;\nctx.fillStyle = '#ff0000';\n" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/render/canvas.js', line: 2 });
    expect(findings[0].message).toContain('#ff0000');
  });

  it('fails on a hex in a CSS file that is not tokens.css', () => {
    expect(checkHexLiterals(tree({ 'src/other.css': 'a { color: #123456; }\n' }))).toHaveLength(1);
  });

  it('allows any number of hexes in src/tokens.css', () => {
    expect(checkHexLiterals(tree({ 'src/tokens.css': ':root { --a: #123456; --b: #abcdef; }\n' }))).toEqual([]);
  });

  it('ignores a hex in a comment', () => {
    expect(checkHexLiterals(tree({ 'src/a.js': '// was #ff0000 once\n' }))).toEqual([]);
    expect(checkHexLiterals(tree({ 'src/a.css': '/* #ff0000 */\n' }))).toEqual([]);
  });

  it('passes on the real tree', () => {
    expect(checkHexLiterals(real)).toEqual([]);
  });
});

describe('5. package.json has no dependencies', () => {
  it('fails when a runtime dependency is declared, naming the line', () => {
    const text = '{\n  "name": "x",\n  "dependencies": { "lodash": "1" }\n}\n';
    const findings = checkNoDependencies(
      tree({}, { packageJson: JSON.parse(text), packageJsonText: text }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'package.json', line: 3 });
    expect(findings[0].message).toContain('lodash');
  });

  it('passes on an empty dependencies object', () => {
    expect(checkNoDependencies(tree({}, { packageJson: { dependencies: {} } }))).toEqual([]);
  });

  it('fails when package.json is missing or unparseable rather than passing vacuously', () => {
    expect(checkNoDependencies(tree({}, { packageJson: null }))).toHaveLength(1);
  });

  it('passes on the real tree', () => {
    expect(checkNoDependencies(real)).toEqual([]);
  });
});

describe('6. src/main.js is the only file in src/ referencing window or localStorage', () => {
  it('fails on window in another file, naming the file and line', () => {
    const findings = checkWindowOnlyInMain(tree({ 'src/loop.js': 'const a = 1;\nwindow.requestAnimationFrame(f);\n' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/loop.js', line: 2 });
  });

  it('fails on localStorage in another file', () => {
    expect(checkWindowOnlyInMain(tree({ 'src/persist.js': 'localStorage.setItem("k", "v");\n' }))).toHaveLength(1);
  });

  it('allows both in src/main.js', () => {
    expect(checkWindowOnlyInMain(tree({ 'src/main.js': 'window.localStorage;\n' }))).toEqual([]);
  });

  it('ignores an error message that tells the caller to pass window.localStorage in', () => {
    const findings = checkWindowOnlyInMain(
      tree({ 'src/store.js': "throw new TypeError('pass window.localStorage at the app edge');\n" }),
    );
    expect(findings).toEqual([]);
  });

  it('passes on the real tree', () => {
    expect(checkWindowOnlyInMain(real)).toEqual([]);
  });
});

describe('7. no .mp3, .wav or .ogg anywhere in the repo', () => {
  it('fails on an audio file at any path, naming it', () => {
    for (const path of ['src/audio/eat.mp3', 'docs/beep.wav', 'sound.ogg', 'assets/LOUD.WAV']) {
      const findings = checkNoAudioFiles(tree({}, { paths: [path] }));
      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe(path);
    }
  });

  it('ignores a file whose name merely contains the extension', () => {
    expect(checkNoAudioFiles(tree({}, { paths: ['src/audio/mp3-notes.md'] }))).toEqual([]);
  });

  it('passes on the real tree', () => {
    expect(checkNoAudioFiles(real)).toEqual([]);
  });
});

describe('the gate as a whole', () => {
  it('runs all seven checks', () => {
    expect(CHECKS).toHaveLength(7);
  });

  it('is not ok when any single check finds something', () => {
    const result = runChecks(tree({ 'src/core/game.js': 'window.x;\n' }));
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.check).sort()).toEqual(['core-globals', 'window-in-main']);
  });

  it('is ok on the real tree, with no findings', () => {
    const result = runChecks(real);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('read every file under src/ from the real tree, not an empty map', () => {
    expect(real.files.has('src/core/game.js')).toBe(true);
    expect(real.files.has('src/main.js')).toBe(true);
    expect(real.files.has('src/tokens.css')).toBe(true);
  });
});
