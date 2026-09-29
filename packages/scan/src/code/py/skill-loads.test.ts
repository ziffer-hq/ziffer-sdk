/**
 * The third signal for Python (ACP-460): the application's code loads this skill. Each fixture
 * under `fixtures/loads-460-py-*` is one corner-bookshop application with invented skills
 * (`order-desk`, `returns`); each assertion names the exact entries, so a matcher that stops
 * matching turns its case red by count and one that over-matches turns it red by value. The
 * negative case (a README read and printed) must yield NO entry: a text file is not a skill.
 * These run the real walker under the machine's python3, as `index.test.ts` does.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { SkillLoad } from '../../types.js';
import { findPython, parsePyScanOutput, scanPython } from './index.js';

const fixture = (name: string): string => fileURLToPath(new URL(`../../../fixtures/loads-460-py-${name}/`, import.meta.url));

before(async () => {
  const py = await findPython();
  assert.ok(py !== null, 'no python3 >= 3.9 on PATH: these tests exercise the real walker and cannot run without one');
});

async function loads(name: string): Promise<SkillLoad[]> {
  const catalog = await scanPython(fixture(name));
  assert.deepEqual(catalog.checks, [{ language: 'python', tool_calls: true, caller_checks: true, skill_loads: true }], `${name}: the pass ran`);
  assert.ok(catalog.skill_loads !== undefined, `${name}: skill_loads present when the pass ran`);
  return catalog.skill_loads;
}

describe('Python skill loads (ACP-460)', () => {
  it('read: os.path.join from __file__, opened in a with block and printed; a SKILL.md is listed without reaches', async () => {
    assert.deepEqual(await loads('read'), [
      { path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'bookshop/app.py', line: 8 } },
    ]);
  });

  it('imported: importlib.resources files().joinpath().read_text() and pkgutil.get_data, a front-matter-shaped file', async () => {
    assert.deepEqual(await loads('imported'), [
      { path: 'bookshop/prompts/returns.md', how: 'imported', at: { file: 'bookshop/loader.py', line: 7 } },
      { path: 'bookshop/prompts/returns.md', how: 'imported', at: { file: 'bookshop/loader.py', line: 11 } },
    ]);
  });

  it('embedded: a string literal carrying the skill body, reflowed', async () => {
    assert.deepEqual(await loads('embedded'), [
      { path: 'skills/returns/SKILL.md', how: 'embedded', at: { file: 'bookshop/registry.py', line: 5 } },
    ]);
  });

  it('a folder: a glob loop and an f-string with one substitution list every SKILL.md, and no other text file', async () => {
    assert.deepEqual(await loads('folder'), [
      { path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'bookshop/skills.py', line: 10 } },
      { path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'bookshop/skills.py', line: 15 } },
      { path: 'skills/returns/SKILL.md', how: 'read', at: { file: 'bookshop/skills.py', line: 10 } },
      { path: 'skills/returns/SKILL.md', how: 'read', at: { file: 'bookshop/skills.py', line: 15 } },
    ]);
  });

  it('reaches instructions: system=, a developer-role message, and Agent(instructions=) through a helper; plain prompt files are listed because they reach', async () => {
    assert.deepEqual(await loads('instructions'), [
      {
        path: 'prompts/developer.txt', how: 'read', at: { file: 'bookshop/chat.py', line: 24 },
        reaches: { kind: 'instructions', at: { file: 'bookshop/chat.py', line: 26 }, via: 'a system-role message passed to chat.completions.create(...) (openai)' },
      },
      {
        path: 'prompts/system.md', how: 'read', at: { file: 'bookshop/chat.py', line: 8 },
        reaches: { kind: 'instructions', at: { file: 'bookshop/chat.py', line: 15 }, via: 'system= on messages.create(...) (anthropic)' },
      },
      {
        path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'bookshop/desk.py', line: 10 },
        reaches: { kind: 'instructions', at: { file: 'bookshop/desk.py', line: 13 }, via: 'instructions= on Agent(...) from agents' },
      },
    ]);
  });

  it('reaches tool_result: a LangChain @tool returns the text a helper read', async () => {
    assert.deepEqual(await loads('tool-result'), [
      {
        path: 'policies/returns-policy.md', how: 'read', at: { file: 'bookshop/tools.py', line: 10 },
        reaches: { kind: 'tool_result', at: { file: 'bookshop/tools.py', line: 17 }, via: 'returned by the tool returns_policy' },
      },
    ]);
  });

  it('negative: a README read and printed, and a tutorial that quotes an inline prompt, are not skill loads', async () => {
    assert.deepEqual(await loads('negative'), []);
  });

  it('the guard: a malformed load is refused, a walker that predates the check reads as not looked for', () => {
    const base = { python_files: 0, files_read: 0, syntax_errors: 0, tools: [], exposures: [], dispatchers: [], gates: [], not_seen: [] };
    const old = parsePyScanOutput({ ...base, checks: { tool_calls: true, caller_checks: true } });
    assert.equal(old?.checks.skill_loads, false);
    assert.deepEqual(old?.skill_loads, []);
    assert.equal(parsePyScanOutput({ ...base, skill_loads: [{ path: 'a.md', how: 'guessed', at: { file: 'a.py', line: 1 } }] }), null);
    assert.equal(parsePyScanOutput({ ...base, skill_loads: [{ path: 'a.md', how: 'read', at: { file: 'a.py', line: 0 } }] }), null);
    assert.equal(parsePyScanOutput({ ...base, skill_loads: [{ path: 'a.md', how: 'read', at: { file: 'a.py', line: 1 }, reaches: { kind: 'elsewhere', at: { file: 'a.py', line: 2 }, via: 'x' } }] }), null);
  });
});
