/**
 * LlamaIndex, TypeScript (record §3.11): `tool({ ..., execute })`, `tool(fn, meta)` and
 * `FunctionTool.from` define; `agent({ tools })` and `llm.exec({ tools })` expose; K3 at
 * the tool function. Shapes from llamaindex 0.12.1, @llamaindex/workflow 1.1.24 and
 * run-llama/LlamaIndexTS examples (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog, CodeTool } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-llamaindex-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function byName(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, name);
  return t;
}

test('llamaindex: the object form, the two-argument form, FunctionTool.from and a QueryEngineTool (from a destructured dynamic import) are tools', () => {
  const rows = catalog.tools.map((t) => [t.name, t.params, t.schema_kind, t.via]).sort();
  assert.deepEqual(rows, [
    ['bookshopFaq', [], 'unknown', 'new QueryEngineTool() from "llamaindex" (a query engine run as a tool)'],
    ['lookupOrder', ['orderId'], 'zod', 'tool() from "llamaindex"'],
    ['refundOrder', ['orderId', 'cents'], 'zod', 'tool() from "llamaindex"'],
    ['shipOrder', ['orderId', 'address'], 'zod', 'FunctionTool.from() from "llamaindex"'],
  ]);
  assert.equal(byName('lookupOrder').execute_at?.line, 13);
  assert.equal(byName('refundOrder').execute_at?.line, 10);
  for (const t of catalog.tools.filter((x) => x.name !== 'bookshopFaq')) {
    assert.equal(t.delegates_to, 'runBookshopAction', t.name);
    assert.ok(EMITTED_SDKS.includes(t.sdk), t.sdk);
  }
});

test('llamaindex: agent and llm.exec are exposures naming K3; MCP tools and prebuilt tools are said, not listed', () => {
  const ex = catalog.exposures.map((e) => [e.via, e.kind, e.tools]).sort();
  assert.deepEqual(ex, [
    ['agent({ tools }) from "@llamaindex/workflow"', 'computed', []],
    ['agent({ tools }) from "@llamaindex/workflow"', 'computed', ['refundOrder', 'lookupOrder']],
    ['llm.exec({ tools }) from "@llamaindex/openai" (runs the calls itself)', 'static', ['shipOrder']],
  ]);
  for (const e of catalog.exposures) assert.match(e.note, /top of the tool function \(K3\)/);
  assert.ok(catalog.not_seen.some((l) => l.startsWith('1 prebuilt tool(s) from @llamaindex/tools are created (src/agent.ts:8)')));
  assert.ok(catalog.not_seen.some((l) => l.startsWith('Tools fetched at runtime from an MCP server are not listed (1 client attach point(s): src/agent.ts:16)')));
  // A name built at runtime is said by the rule every framework shares (ACP-455, 2026-09-28): one line per framework.
  assert.ok(catalog.not_seen.includes('LlamaIndex: 1 place(s) write a tool\'s shape with a name for the model the scan cannot resolve and no function name to list it under (src/agent.ts:28 (`shelf_${shelf}`)): they are not listed as tools; where one copies a tool defined elsewhere, that tool is listed where it is defined'));
});
