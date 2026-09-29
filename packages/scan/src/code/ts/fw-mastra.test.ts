/**
 * Mastra (record §3.21): `createTool` defines, a tools MAP on `new Agent` exposes and
 * renames by its key (the name the model sees), `requireApproval` is a K2 claim, the
 * run function is `execute` (K3). Shapes from @mastra/core 1.71.0 and
 * mastra-ai/mastra examples (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog, CodeTool } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-mastra-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function byName(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, name);
  return t;
}

test('mastra: createTool is a tool with its Zod input and execute, named by the tools-map key the model sees', () => {
  const rows = catalog.tools.map((t) => [t.name, t.params, t.schema_kind, t.via]).sort();
  assert.deepEqual(rows, [
    ['lookup', ['orderId'], 'zod', 'createTool() from "@mastra/core"'],
    ['refundOrder', ['orderId', 'cents'], 'zod', 'createTool() from "@mastra/core"'],
  ]);
  assert.equal(byName('refundOrder').execute_at?.line, 11);
  assert.equal(byName('refundOrder').delegates_to, 'runBookshopAction');
  for (const t of catalog.tools) assert.ok(EMITTED_SDKS.includes(t.sdk), t.sdk);
});

test('mastra: requireApproval is recorded as a claim (K2), never relied on', () => {
  assert.deepEqual(byName('refundOrder').authority_claims, [{ name: 'requireApproval', value: 'true' }]);
});

test('mastra: new Agent({ tools }) is static, a tools function is computed, new Mastra and MCPServer serve their tools, MCPClient is an attach point, sub-agents are said', () => {
  const ex = catalog.exposures.map((e) => [e.via, e.kind, e.tools]).sort();
  assert.deepEqual(ex, [
    ['new Agent({ tools }) from "@mastra/core"', 'computed', []],
    ['new Agent({ tools }) from "@mastra/core"', 'static', ['refundOrder', 'lookup']],
    ['new MCPServer({ tools }) from "@mastra/mcp" (served to MCP clients)', 'static', ['lookup']],
    ['new Mastra({ tools }) (served by the Mastra server to its clients)', 'static', ['refundOrder']],
  ]);
  assert.ok(catalog.not_seen.some((l) => l.startsWith('1 Mastra agent(s) hand the model their sub-agents or workflows (the agents / workflows options of new Agent: src/agent.ts:15)')));
  for (const e of catalog.exposures) assert.match(e.note, /requireApproval on a tool \(K2\).*execute \(K3\)/);
  assert.ok(catalog.not_seen.some((l) => l.startsWith('Tools fetched at runtime from an MCP server are not listed (1 client attach point(s): src/agent.ts:24)')));
});
