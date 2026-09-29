/**
 * ACP-476: a folder is skipped for what it holds, never for its name alone.
 *
 * `fixtures/code/folders-476/` is an invented booking application. Its own source sits in
 * folders whose names 0.3.0 skipped (`src/build/`, `src/test/`, `fares/build/`), and beside
 * them are the folders that really are not the application: a bundle its .gitignore names,
 * the outDir a tsconfig names, a copy compiled from `src/`, an installed dependency, a
 * virtual environment, and two folders of tests. Every tool in the first group must be in
 * the catalog, no tool of the second, and the report must say which folders were not read
 * and on what evidence.
 *
 * Three of those folders are ones git itself ignores (`dist/` by the fixture's own .gitignore,
 * `node_modules/` by the repository's), so they cannot be tracked files: a clone made with a
 * plain `git add -A` drops them, and the test would pass or fail by how the tree was copied.
 * They are written here, into a copy of the fixture, before anything is judged.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { gitignoreRule, judgeFolders, parseCodeFolders, skippedFoldersLine, type FolderJudgement } from './folders.js';
import { scanCode } from './index.js';
import { mergeCatalogs } from './merge.js';
import { findPython, scanPython } from './py/index.js';
import type { CodeCatalog } from './types.js';

const TRACKED = fileURLToPath(new URL('../../fixtures/code/folders-476/', import.meta.url));

/** The fixture's git-ignored folders, byte for byte what the scan must NOT read. */
const IGNORED: Readonly<Record<string, string>> = {
  'dist/index.js':
    "// A bundle the project's .gitignore names as output: never read.\n" +
    "import { tool } from 'ai';\n" +
    "import { z } from 'zod';\n" +
    "export const distOnlyTool = tool({ description: 'Only in the ignored bundle', inputSchema: z.object({}), execute: async () => ({}) });\n",
  'node_modules/fake-dep/index.js':
    "import { tool } from 'ai';\n" +
    "import { z } from 'zod';\n" +
    "export const dependencyTool = tool({ description: 'Only in an installed dependency', inputSchema: z.object({}), execute: async () => ({}) });\n",
  'node_modules/fake-dep/package.json': '{ "name": "fake-dep", "version": "1.0.0", "main": "index.js" }\n',
};

/** A copy of the tracked fixture with the ignored folders written into it; ends in a slash. */
function materialise(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'ziffer-folders-476-')), 'app');
  cpSync(TRACKED, dir, { recursive: true });
  for (const [rel, text] of Object.entries(IGNORED)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return `${dir}/`;
}

const FIX = materialise();

/** The one line, as the report prints it for this fixture. */
const LINE =
  '7 folders were not read. ' +
  'Installed dependencies: .venv (holds pyvenv.cfg), node_modules (holds */package.json). ' +
  'Build output or cache: build (compiled from src/index.ts), dist (.gitignore ignores it), out (a tsconfig file in the root names it as output), 3 source files. ' +
  'Test code: fares/tests (holds the test fares/tests/test_quote.py), tests (holds the test tests/answer.test.ts), 2 source files. ' +
  'A folder is skipped for what it holds, never for its name alone.';

let judged: FolderJudgement;
let ts: CodeCatalog;
before(async () => {
  judged = judgeFolders(FIX);
  ts = await scanCode(FIX, { folders: judged });
});

describe('ACP-476: which folders are read', () => {
  it('skips each folder that is not the application, and names what showed it', () => {
    assert.deepEqual(
      judged.skipped.map((s) => [s.path, s.kind, s.evidence]),
      [
        ['.venv', 'dependencies', 'holds pyvenv.cfg'],
        ['build', 'build', 'compiled from src/index.ts'],
        ['dist', 'build', '.gitignore ignores it'],
        ['fares/tests', 'test', 'holds the test fares/tests/test_quote.py'],
        ['node_modules', 'dependencies', 'holds */package.json'],
        ['out', 'build', 'a tsconfig file in the root names it as output'],
        ['tests', 'test', 'holds the test tests/answer.test.ts'],
      ],
    );
  });

  it('reads a folder named build or test that holds hand-written source', () => {
    for (const p of ['src/build', 'src/test', 'fares/build']) assert.equal(judged.skips(`${FIX}${p}`), false, `${p} was skipped by its name`);
    const names = ts.tools.map((t) => `${t.name} ${t.defined_at.file}`).sort();
    assert.deepEqual(names, ['buildItinerary src/build/itinerary.ts', 'cancelBooking src/index.ts', 'holdSeat src/test/rehearsal.ts', 'refundTicket src/build/itinerary.ts']);
  });

  it('says in one line how many folders were not read, and why', () => {
    assert.equal(skippedFoldersLine(judged), LINE);
    assert.equal(ts.not_seen.filter((l) => l === LINE).length, 1, ts.not_seen.join('\n'));
    // The per-file line no longer carries a folder's files: those are said once, in the line above.
    assert.equal(ts.not_seen.some((l) => l.startsWith('Not read by rule:') && l.includes('test code')), false);
  });

  it('the Python half obeys the same judgement: build/ read, a virtual environment and a tests folder not', async () => {
    const py = await findPython();
    assert.ok(py !== null, 'no python3 >= 3.9 on PATH: this test runs the real walker');
    const pyCat = await scanPython(FIX, { folders: judged });
    assert.deepEqual(pyCat.tools.map((t) => `${t.name} ${t.defined_at.file}`), ['quote_fare fares/build/quote.py']);
    // Said once for both languages: the Python half prints no folder line of its own.
    const merged = mergeCatalogs(ts, pyCat);
    assert.equal(merged.not_seen.filter((l) => l.includes('folders were not read')).length, 1);
  });
});

describe('ACP-476: the evidence is data, and an entry with none is refused', () => {
  it('refuses a data entry that would skip a folder by its name alone', () => {
    const text = JSON.stringify({
      kinds: { dependencies: 'd', build: 'b', vcs: 'v', test: 't' },
      tsconfig_names: '^tsconfig\\.json$',
      folders: [{ names: ['build'], kind: 'build' }],
      test_file_names: ['x'],
      test_runners: ['x'],
      test_code: ['x'],
    });
    assert.throws(() => parseCodeFolders(text), /names no evidence: a folder would be skipped by its name alone/);
  });

  it('reads .gitignore patterns as git does, for the folder cases the judgement asks', () => {
    const m = (pattern: string, path: string): boolean => {
      const r = gitignoreRule('/r', pattern);
      return r !== undefined && !r.negate && r.re.test(path);
    };
    assert.equal(m('dist/', 'dist'), true);
    assert.equal(m('dist', 'packages/web/dist'), true, 'a pattern without a slash matches at any depth');
    assert.equal(m('/dist', 'packages/web/dist'), false, 'a leading slash anchors it');
    assert.equal(m('packages/*/build', 'packages/web/build'), true);
    assert.equal(m('packages/*/build', 'packages/web/src/build'), false);
    assert.equal(m('**/out', 'a/b/out'), true);
    assert.equal(m('# dist', 'dist'), false);
    assert.equal(gitignoreRule('/r', '!dist')?.negate, true);
  });
});
