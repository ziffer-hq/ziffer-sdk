/**
 * The name the model sees, written as an expression (ACP-455, 2026-09-28; found on Semantic
 * Kernel's own samples: `@kernel_function(name=Functions.SliceFood)` was reported under the
 * Python function's name `slice_food`). The rule, for every framework in both front ends: a
 * constant, a class attribute or an enum member holding a literal in the scanned tree is
 * resolved; anything else keeps the function's name AND is said in one `not_seen` line per
 * framework. Never a silent fallback.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from './index.js';
import { findPython, scanPython } from './py/index.js';
import type { CodeCatalog } from './types.js';

const fx = (d: string): string => fileURLToPath(new URL(`../../fixtures/code/${d}/`, import.meta.url));

describe('TypeScript: fixtures/code/fw-names-ts', () => {
  let c: CodeCatalog;
  before(async () => {
    c = await scanCode(fx('fw-names-ts'));
  });

  it('a constant, an enum member and a class attribute (readonly or not) resolve to the literal', () => {
    assert.deepEqual(c.tools.map((t) => t.name), ['lookup_title', 'reserve_title', 'remove_title', 'rename_title', 'archiveTitle']);
  });

  it('a computed name keeps the function\'s name and is said; one with no function to fall back on is said and not listed', () => {
    const l = c.not_seen.filter((x) => x.startsWith('LangChain'));
    assert.deepEqual(l, [
      "LangChain / LangGraph: 1 tool(s) are given their name for the model by an expression the scan could not resolve to a literal (archiveTitle at src/catalog.ts:30 (nameFor('archive'))): each is listed under its function's name, and the name the model sees is computed; 1 place(s) write a tool's shape with a name for the model the scan cannot resolve and no function name to list it under (src/catalog.ts:32 (nameFor('purge'))): they are not listed as tools; where one copies a tool defined elsewhere, that tool is listed where it is defined",
    ]);
  });
});

describe('Python: fixtures/code/fw-names-py', () => {
  let c: CodeCatalog;
  before(async () => {
    assert.ok((await findPython()) !== null, 'no python3 >= 3.9 on PATH');
    c = await scanPython(fx('fw-names-py'));
  });

  it('a constant, an enum member and an enum nested in the plugin class (each class its own) resolve to the literal', () => {
    assert.deepEqual(c.tools.map((t) => [t.name, t.sdk]), [
      ['lookup_shelf', 'semantic-kernel'],
      ['restock_shelf', 'semantic-kernel'],
      ['count_shelf', 'semantic-kernel'],
      ['clear_shelf', 'semantic-kernel'],
      ['open_desk', 'semantic-kernel'],
      ['label_shelf', 'langchain'],
    ]);
  });

  it('a computed name keeps the function\'s name and is said, one line per framework', () => {
    assert.deepEqual(c.not_seen.filter((x) => x.includes('given their name for the model')), [
      "LangChain / LangGraph: 1 tool(s) are given their name for the model by an expression the scan could not resolve to a literal (label_shelf at shelf.py:51 (name_for('label'))): each is listed under its function's name, and the name the model sees is computed",
      "Semantic Kernel: 1 tool(s) are given their name for the model by an expression the scan could not resolve to a literal (clear_shelf at shelf.py:35 (name_for('clear'))): each is listed under its function's name, and the name the model sees is computed",
    ]);
  });
});
