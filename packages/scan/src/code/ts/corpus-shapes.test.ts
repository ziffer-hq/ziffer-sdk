/**
 * The shapes the public-repository corpus (scripts/corpus.json) showed the code scan
 * missing, one per rule, over `fixtures/code/corpus-shapes/` COPIED to a temporary
 * directory first: nothing is installed there and no `node_modules` sits above it, so
 * every framework import is unresolved -- a fresh clone, a customer's CI checkout. In
 * the package's own tree the fixture would resolve `ai`, `zod` and the MCP SDK through
 * packages/scan/node_modules and prove nothing about the fallback.
 *
 * The copy also gains what git cannot carry: a nested checkout (a directory holding a
 * `.git` FILE) with a duplicate of a tool file, which must not be read.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode, type CodeScanStats } from '../index.js';
import { findPython, scanPython, type PyScanStats } from '../py/index.js';
import { ownSourceReader } from '../sdks.js';
import type { CodeCatalog, CodeTool } from '../types.js';
import { NESTED_CHECKOUT } from './program.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/corpus-shapes/', import.meta.url));

let dir: string;
let catalog: CodeCatalog;
let stats: CodeScanStats | undefined;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ziffer-corpus-shapes-'));
  cpSync(FIXTURE, dir, { recursive: true });
  mkdirSync(join(dir, 'copy'));
  writeFileSync(join(dir, 'copy', '.git'), 'gitdir: /elsewhere/.git/worktrees/copy\n');
  cpSync(join(FIXTURE, 'agents.ts'), join(dir, 'copy', 'agents.ts'));
  catalog = await scanCode(dir, { onStats: (s) => { stats = s; } });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tool(name: string): CodeTool | undefined {
  return catalog.tools.find((t) => t.name === name);
}

test('unresolved imports: an OpenAI Agents SDK tool() is found through its import declaration, with its Zod parameters', () => {
  const t = tool('refund_order');
  assert.ok(t !== undefined, `refund_order not found; found: ${catalog.tools.map((x) => x.name).join(', ')}`);
  assert.equal(t.sdk, 'openai-agents');
  assert.equal(t.via, 'tool() from "@openai/agents"');
  assert.deepEqual(t.params, ['orderId', 'reason']);
  assert.equal(t.schema_kind, 'zod');
  assert.equal(t.defined_at.file, 'agents.ts');
  const exposure = catalog.exposures.find((e) => e.via === 'new Agent({ tools })');
  assert.ok(exposure !== undefined);
  assert.deepEqual([...exposure.tools].sort(), ['lookup_order', 'refund_order']);
  assert.ok(catalog.not_seen.some((l) => l.includes('webSearchTool() from "@openai/agents"')), 'the hosted tool is named as provider-executed');
  assert.ok(stats !== undefined && stats.unresolvedFrameworkFiles >= 4, `unresolved framework files: ${stats?.unresolvedFrameworkFiles}`);
  assert.ok(catalog.not_seen.some((l) => l.includes('import packages the type checker could not resolve')));
});

test('unresolved imports: an MCP server in an .mjs file is the SDK server side by its import; a parameter with no type is not guessed', () => {
  const t = tool('delete_file');
  assert.ok(t !== undefined);
  assert.equal(t.sdk, 'mcp');
  assert.equal(t.defined_at.file, 'server.mjs');
  assert.deepEqual(t.params, ['path']);
  assert.equal(tool('never_found'), undefined);
});

test('JavaScript: a plain .js file with require() is read, and its AI SDK tool is named by the map key', () => {
  const t = tool('sendInvoice');
  assert.ok(t !== undefined);
  assert.equal(t.sdk, 'ai');
  assert.equal(t.defined_at.file, 'plain.js');
  assert.deepEqual(t.params, ['invoiceId', 'to']);
  assert.ok(stats !== undefined && stats.jsFiles >= 2);
});

test('a LangChain tool written as a class extending StructuredTool', () => {
  const t = tool('transfer_funds');
  assert.ok(t !== undefined);
  assert.equal(t.sdk, 'langchain');
  assert.equal(t.via, 'class extending StructuredTool from "@langchain/core"');
  assert.deepEqual(t.params, ['from', 'to', 'amount']);
  assert.ok(t.execute_at !== undefined);
});

test('a hidden directory is walked; a nested checkout and test code are not, and each is counted by reason', () => {
  assert.equal(tool('notifyOps')?.defined_at.file, '.agents/hooks/notify.js');
  assert.equal(tool('test_probe'), undefined);
  assert.deepEqual(catalog.tools.filter((t) => t.defined_at.file.startsWith('copy/')), []);
  assert.equal(catalog.tools.filter((t) => t.name === 'refund_order').length, 1);
  const by = new Map((stats?.skipped ?? []).map((s) => [s.reason, s]));
  assert.deepEqual(by.get(NESTED_CHECKOUT), { reason: NESTED_CHECKOUT, dirs: 1, files: 1 });
  // A test FOLDER is skipped for what it holds and counted under the data file's words (ACP-476); a test FILE's reason is TEST_CODE.
  assert.deepEqual(by.get('test code'), { reason: 'test code', dirs: 1, files: 1 });
  assert.ok(catalog.not_seen.some((l) => l.includes('1 source file(s) in a nested git worktree')));
});

test("a framework's own source is not the application's; an example beside it is", () => {
  assert.equal(tool('framework_builtin'), undefined);
  assert.equal(tool('example_weather')?.defined_at.file, 'vendor-fw/examples/demo.ts');
  assert.deepEqual(stats?.ownSource, [{ pkg: '@openai/agents-core', tools: 1 }]);
  assert.ok(catalog.not_seen.some((l) => l.startsWith("1 tool definition(s) sit in the source of a tool-calling framework") && l.includes('@openai/agents-core 1')));
});

test("the own-source rule holds for MCP attach points and honesty lines too: the framework's are not said, the example's is (ACP-455, 2026-09-28)", async () => {
  const mcp = catalog.not_seen.filter((l) => l.startsWith('Tools fetched at runtime from an MCP server'));
  assert.equal(mcp.length, 1);
  assert.match(mcp[0] ?? '', /vendor-fw\/examples\/demo\.ts/);
  assert.doesNotMatch(mcp[0] ?? '', /vendor-fw\/src\//);
  // A counting line is recounted over the application's places.
  assert.deepEqual(catalog.not_seen.filter((l) => l.includes('Bedrock InvokeModel')).map((l) => /^\d+ Bedrock InvokeModel call\(s\) \([^)]*\)/.exec(l)?.[0]), ['1 Bedrock InvokeModel call(s) (vendor-fw/examples/demo.ts:12)']);
  const py = await scanPython(dir);
  const pyMcp = py.not_seen.filter((l) => l.startsWith('tools fetched at runtime from an MCP server'));
  assert.deepEqual(pyMcp, ["tools fetched at runtime from an MCP server are named by the server, not listed; scan that server's own repository (pyfw/examples/app.py:17)"]);
});

test('ownSourceReader: the nearest manifest decides, an examples directory anywhere on the path exempts', () => {
  const own = ownSourceReader(dir);
  assert.equal(own('vendor-fw/src/builtin.ts')?.pkg, '@openai/agents-core');
  assert.equal(own('vendor-fw/examples/demo.ts'), undefined);
  assert.equal(own('pyfw/internal_tools.py')?.pkg, 'openai-agents');
  assert.equal(own('pyfw/examples/app.py'), undefined);
  assert.equal(own('agents.ts'), undefined, 'the application manifest names no framework');
});

test('Python: a notebook is read cell by cell, magics skipped and a broken cell left out; the framework-own rule applies', async () => {
  const py = await findPython();
  assert.ok(py !== null, 'no python3 >= 3.9 on PATH: this test runs the real walker');
  let pyStats: PyScanStats | undefined;
  const cat = await scanPython(dir, { onStats: (s) => { pyStats = s; } });
  const nb = cat.tools.find((t) => t.name === 'cancel_subscription');
  assert.ok(nb !== undefined, `found: ${cat.tools.map((t) => t.name).join(', ')}`);
  assert.deepEqual(nb.defined_at, { file: 'notebook.ipynb#cell-3', line: 2, col: 5 });
  assert.deepEqual(nb.params, ['customer_id']);
  const exp = cat.exposures.find((e) => e.at.file === 'notebook.ipynb#cell-5');
  assert.ok(exp !== undefined, 'the call in the fifth cell hands the list to the model');
  assert.deepEqual(exp.tools, ['cancel_subscription']);
  assert.equal(pyStats?.notebooks, 1);
  assert.ok(cat.tools.some((t) => t.name === 'book_meeting'));
  assert.equal(cat.tools.find((t) => t.name === 'framework_internal'), undefined);
  assert.deepEqual(pyStats?.ownSource, [{ pkg: 'openai-agents', tools: 1 }]);
  assert.equal(pyStats?.nestedCheckouts, 1);
});
