/**
 * Claude Agent SDK, TypeScript (record §3.3): positional `tool()` bundled by
 * `createSdkMcpServer`, handed to `query()`; built-in tools named in the options are
 * tools; the interception point is a PreToolUse hook (K1). Shapes from
 * @anthropic-ai/claude-agent-sdk 0.3.284 sdk.d.ts and anthropics/claude-agent-sdk-demos
 * (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog, CodeTool } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-claude-agent-sdk-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function byName(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, name);
  return t;
}

test('claude-agent-sdk: positional tool(name, description, shape, handler) is a tool with its Zod shape and handler', () => {
  const custom = catalog.tools.filter((t) => t.via.startsWith('tool() from')).map((t) => [t.name, t.description, t.params, t.schema_kind]).sort();
  assert.deepEqual(custom, [
    ['lookup_order', 'Read an order', ['orderId'], 'zod'],
    ['refund_order', 'Refund an order in full', ['orderId', 'cents'], 'zod'],
  ]);
  assert.equal(byName('refund_order').execute_at?.line, 10);
  assert.equal(byName('refund_order').delegates_to, 'runBookshopAction');
  for (const t of catalog.tools) assert.ok(EMITTED_SDKS.includes(t.sdk), t.sdk);
});

test('claude-agent-sdk: extras.annotations are claims', () => {
  assert.deepEqual(byName('refund_order').authority_claims?.map((c) => c.name), ['annotations', 'destructiveHint']);
});

test('claude-agent-sdk: built-in tools named in allowedTools or tools are listed once per name, a permission rule read to its tool', () => {
  const builtins = catalog.tools.filter((t) => t.via.startsWith('built-in tool')).map((t) => t.name).sort();
  assert.deepEqual(builtins, ['Bash', 'Grep', 'Read', 'Write']);
});

test('claude-agent-sdk: createSdkMcpServer and query() are exposures that name PreToolUse (K1)', () => {
  const server = catalog.exposures.find((e) => e.via.startsWith('createSdkMcpServer'));
  assert.ok(server !== undefined);
  assert.deepEqual([server.kind, server.tools], ['static', ['refund_order', 'lookup_order']]);
  assert.match(server.note, /PreToolUse hook .* \(K1\)/);
  const q = catalog.exposures.filter((e) => e.via === 'query({ options })').sort((a, b) => a.at.line - b.at.line).map((e) => [e.at.line, e.kind, e.tools]);
  assert.deepEqual(q, [[6, 'computed', ['Read', 'Bash', 'refund_order']], [24, 'static', ['Read', 'Grep']]]);
  assert.match(catalog.exposures.find((e) => e.at.line === 6 && e.via === 'query({ options })')?.note ?? '', /A PreToolUse hook is already registered here\./);
  assert.ok(catalog.not_seen.some((l) => l.startsWith('Claude Agent SDK: permissions configured outside the code')));
  // An external server in mcpServers is an attach point; the in-process one is not.
  assert.ok(catalog.not_seen.some((l) => l.startsWith('Tools fetched at runtime from an MCP server are not listed (1 client attach point(s): src/agent.ts:9)')));
});
