/**
 * One owner for what a skill is (ACP-460): the TypeScript load pass imports the skills walk's rule,
 * and the Python front end, which cannot import it, keeps a copy whose lists must equal it. Read
 * from the script as text; a list edited on one side only turns this red.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { TEXT_EXT } from '../code/ts/program.js';
import { COPILOT_FILE, INSTRUCTION_FILES, SHAPE_EXTENSIONS } from './index.js';

const PY = readFileSync(fileURLToPath(new URL('../../py/ziffer_scan_code.py', import.meta.url)), 'utf8');

/** The quoted strings of one Python assignment `NAME = (...)` or `NAME = {...}`, read as text. */
function pyStrings(name: string): string[] {
  const m = new RegExp(`^${name} = [({]([^)}]*)[)}]`, 'm').exec(PY);
  assert.ok(m !== null, `${name} is not assigned in the Python script`);
  return [...(m[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1] ?? '').sort();
}

test('the Python front end\'s text extensions are the TypeScript ones, and the shape signal reads the same list', () => {
  assert.deepEqual(pyStrings('TEXT_EXTS'), [...TEXT_EXT].sort());
  assert.deepEqual([...SHAPE_EXTENSIONS].sort(), [...TEXT_EXT].sort());
});

test('the Python front end\'s instruction file names are the TypeScript ones that carry a text extension, and the Copilot file is the same', () => {
  const ts = INSTRUCTION_FILES.filter((f) => TEXT_EXT.has(extname(f).toLowerCase())).sort();
  assert.ok(ts.length > 0);
  assert.deepEqual(pyStrings('INSTRUCTION_NAMES'), ts);
  const copilot = /^COPILOT_FILE = "([^"]+)"/m.exec(PY);
  assert.equal(copilot?.[1], COPILOT_FILE);
});

test('the load pass holds no copy of the shape rule: it imports the skills walk\'s', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/code/ts/loads.ts', import.meta.url)), 'utf8');
  assert.ok(/import \{[^}]*\bhasSkillShape\b[^}]*\} from '\.\.\/\.\.\/skills\/index\.js'/.test(src));
  assert.ok(!/skillShapeLocal|INSTRUCTION_NAMES_LOCAL|'CLAUDE\.md'/.test(src), 'a local copy of the rule');
});
