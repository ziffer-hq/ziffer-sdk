/**
 * A `covered` flag in `data/code-sdks.json` is a claim the report prints ("read by this
 * scan"). This test holds every such claim to a fixture a test scans (ACP-455, ACP-462):
 * for each framework marked `milestone-1`, and for each language its `language` list names
 * (`TS`, `Py`; `JSON` is read by the TypeScript front end and counts with `TS`), at least
 * one fixture directory that some test in this package scans must yield the framework's
 * evidence when the real front end of that language reads it. A flag with no test behind
 * it is the defect that caused the 2026-09-28 work: twelve frameworks were listed, none
 * read, and nothing said so.
 *
 * Evidence is what the scan emits, never what a test file says: a `CodeTool` whose `sdk`
 * is the id and whose definition is a file of that language; for the two frameworks that
 * define no tool, what the front end emits instead (Instructor: a `structured_output` entry;
 * coding-assistant hooks: the hook file's honesty line).
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from './index.js';
import { findPython, scanPython } from './py/index.js';
import { loadCodeSdks } from './sdks.js';
import type { CodeCatalog } from './types.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/code/', import.meta.url));
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

type Lang = 'TS' | 'Py';

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...testFiles(p));
    else if (name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * The fixture directories some test scans: named literally (`fixtures/code/<dir>/`), or
 * through the one template the Python frameworks test uses (`fixtures/code/fw-${id}-py/`),
 * expanded over the quoted ids that test file writes.
 */
function scannedFixtures(): string[] {
  const dirs = new Set(readdirSync(FIXTURES).filter((d) => statSync(join(FIXTURES, d)).isDirectory()));
  const out = new Set<string>();
  for (const f of testFiles(SRC)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/fixtures\/code\/([A-Za-z0-9._-]+)\//g)) if (m[1] !== undefined && dirs.has(m[1])) out.add(m[1]);
    for (const m of text.matchAll(/fixtures\/code\/fw-\$\{id\}-(py|ts)\//g)) {
      const lang = m[1];
      for (const q of text.matchAll(/'([a-z0-9-]+)'/g)) {
        const d = `fw-${q[1]}-${lang}`;
        if (dirs.has(d)) out.add(d);
      }
    }
  }
  return [...out].sort();
}

function holds(dir: string, exts: readonly string[]): boolean {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (holds(p, exts)) return true;
    } else if (exts.includes(extname(name))) return true;
  }
  return false;
}

function langOf(file: string): Lang {
  const f = file.split('#')[0] ?? file;
  return f.endsWith('.py') || f.endsWith('.ipynb') ? 'Py' : 'TS';
}

/** `id@lang` for everything one catalog is evidence of. */
function evidence(c: CodeCatalog, lang: Lang): Set<string> {
  const out = new Set<string>();
  for (const t of c.tools) out.add(`${t.sdk}@${langOf(t.defined_at.file)}`);
  if ((c.structured_output ?? []).length > 0) out.add(`instructor@${lang}`);
  if (lang === 'TS' && c.not_seen.some((l) => /\) registers (no hook|hooks)/.test(l))) out.add('coding-assistant-hooks@TS');
  return out;
}

const found = new Map<string, string[]>();
let scanned: string[] = [];

before(async () => {
  assert.ok((await findPython()) !== null, 'no python3 >= 3.9 on PATH: the Python half of this test cannot run');
  scanned = scannedFixtures();
  for (const d of scanned) {
    const dir = join(FIXTURES, d);
    const runs: [Lang, Promise<CodeCatalog>][] = [];
    if (holds(dir, ['.py', '.ipynb'])) runs.push(['Py', scanPython(dir)]);
    if (holds(dir, ['.ts', '.tsx', '.js', '.mjs', '.json']) && existsSync(dir)) runs.push(['TS', scanCode(dir)]);
    for (const [lang, p] of runs) {
      for (const k of evidence(await p, lang)) found.set(k, [...(found.get(k) ?? []), d]);
    }
  }
});

test('the scanned fixtures are found (a template or a path the finder no longer reads would empty this test)', () => {
  assert.ok(scanned.length >= 30, `only ${scanned.length} fixture directories found: ${scanned.join(', ')}`);
  assert.ok(scanned.includes('fw-semantic-kernel-py') && scanned.includes('frameworks-ts'), scanned.join(', '));
});

test('every framework marked covered has a fixture a test scans, in each language it is listed for', () => {
  const missing: string[] = [];
  for (const e of loadCodeSdks()) {
    if (e.kind !== 'framework' || e.covered !== 'milestone-1') continue;
    const langs = new Set<Lang>(e.language.map((l) => (l === 'Py' ? 'Py' : 'TS')));
    for (const l of langs) if (!found.has(`${e.id}@${l}`)) missing.push(`${e.id} (${l})`);
  }
  assert.deepEqual(missing, [], `covered in data/code-sdks.json with no fixture test yielding it: ${missing.join(', ')}`);
});
