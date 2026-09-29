import assert from 'node:assert/strict';
import { test } from 'node:test';

import { frameworkRows } from '../report/code.js';
import { CODE } from '../report/code.fixture.test.data.js';
import { mergeCatalogs } from './merge.js';
import type { SkillLoad } from '../types.js';
import type { CodeCatalog } from './types.js';

const empty = (over: Partial<CodeCatalog>): CodeCatalog => ({
  root: '/app', sdks: [], files_read: 0, tools: [], exposures: [], dispatchers: [], gates: [],
  syntax_only: { found: 0, missed: 0 }, not_seen: [], ...over,
});
const LINE = '44 Python file(s) are present; the TypeScript front end does not read them.';

test('the "Python files not read" line goes when the Python front end read them, and stays when it did not', () => {
  assert.ok(!mergeCatalogs(empty({ not_seen: [LINE] }), empty({ files_read: 44 })).not_seen.includes(LINE));
  assert.ok(mergeCatalogs(empty({ not_seen: [LINE] }), empty({ files_read: 0 })).not_seen.includes(LINE));
});

test('a package declared at several ranges is one framework row', () => {
  const code = { ...CODE, catalog: { ...CODE.catalog, sdks: [{ name: 'zod', version: '^4.0.0' }, { name: 'zod', version: '^4.3.2' }, { name: 'ai', version: '^7.0.0' }] } };
  const rows = frameworkRows(code);
  assert.equal(rows.filter((r) => r.name === 'zod').length, 1);
  assert.equal(rows.find((r) => r.name === 'zod')?.version, '^4.0.0, ^4.3.2');
});

test('which checks ran survives the merge, one entry per language, and is absent when neither side said', () => {
  const ts = empty({ checks: [{ language: 'typescript', tool_calls: true, caller_checks: true }] });
  const py = empty({ checks: [{ language: 'python', tool_calls: true, caller_checks: false }] });
  assert.deepEqual(mergeCatalogs(ts, py).checks, [
    { language: 'typescript', tool_calls: true, caller_checks: true },
    { language: 'python', tool_calls: true, caller_checks: false },
  ]);
  assert.equal('checks' in mergeCatalogs(empty({}), empty({})), false);
});

test('skill loads from both languages are one list in the contract order (path, file, line), present when either side looked', () => {
  const load = (path: string, file: string, line: number): SkillLoad => ({ path, how: 'read', at: { file, line } });
  const ts = empty({ checks: [{ language: 'typescript', tool_calls: true, caller_checks: true, skill_loads: true }], skill_loads: [load('skills/returns/SKILL.md', 'src/a.ts', 9), load('skills/order-desk/SKILL.md', 'src/b.ts', 2)] });
  const py = empty({ checks: [{ language: 'python', tool_calls: true, caller_checks: true, skill_loads: true }], skill_loads: [load('skills/order-desk/SKILL.md', 'app/a.py', 40), load('skills/order-desk/SKILL.md', 'app/a.py', 7)] });
  assert.deepEqual(mergeCatalogs(ts, py).skill_loads, [
    load('skills/order-desk/SKILL.md', 'app/a.py', 7),
    load('skills/order-desk/SKILL.md', 'app/a.py', 40),
    load('skills/order-desk/SKILL.md', 'src/b.ts', 2),
    load('skills/returns/SKILL.md', 'src/a.ts', 9),
  ]);
  assert.deepEqual(mergeCatalogs(ts, empty({})).skill_loads?.length, 2);
  // Looked and found none: an empty list, which is not the same as absent.
  assert.deepEqual(mergeCatalogs(empty({ checks: [{ language: 'typescript', tool_calls: true, caller_checks: true, skill_loads: true }] }), empty({})).skill_loads, []);
  assert.equal('skill_loads' in mergeCatalogs(empty({}), empty({})), false);
});
