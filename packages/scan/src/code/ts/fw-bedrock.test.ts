/**
 * Amazon Bedrock Converse, TypeScript (record §3.9): `toolSpec` with the
 * `inputSchema.json` wrap, handed to `ConverseCommand` or `converse` in `toolConfig`,
 * dispatched by the application (K4). Shapes from @aws-sdk/client-bedrock-runtime
 * 3.1141.0 and the AWS SDK for JavaScript v3 examples (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-bedrock-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

test('bedrock: a toolSpec in a typed constant, inline in a Converse call, and in an imported JSON toolConfig', () => {
  const rows = catalog.tools.map((t) => [t.name, t.description, t.params, t.schema_kind, t.defined_at.file]).sort();
  assert.deepEqual(rows, [
    ['lookup_order', 'Read an order', ['orderId'], 'json_schema', 'src/converse.ts'],
    ['refund_order', 'Refund an order in full', ['orderId', 'cents'], 'json_schema', 'src/tools.ts'],
    ['ship_order', 'Hand an order to the courier', ['orderId', 'address'], 'json_schema', 'src/bookshop-tools.json'],
  ]);
  for (const t of catalog.tools) {
    assert.equal(t.sdk, 'bedrock');
    assert.ok(EMITTED_SDKS.includes(t.sdk));
    assert.equal(t.execute_at, undefined, 'Converse runs nothing: no run function');
  }
});

test('bedrock: ConverseCommand and converse are exposures that name the application dispatcher (K4)', () => {
  const ex = catalog.exposures.map((e) => [e.via, e.kind, e.tools]).sort();
  assert.deepEqual(ex, [
    ['converse({ toolConfig })', 'static', ['ship_order']],
    ['new ConverseCommand({ toolConfig })', 'static', ['refund_order', 'lookup_order']],
  ]);
  for (const e of catalog.exposures) assert.match(e.note, /runs nothing: the application's own dispatcher.*\(K4\)/);
});

test('bedrock: the service-configured tools and an InvokeModel body are said where the tree calls Bedrock (ACP-455, 2026-09-28)', () => {
  assert.deepEqual(catalog.not_seen.filter((l) => l.includes('Bedrock')), [
    'Amazon Bedrock is called in this code (src/converse.ts:10, src/converse.ts:27, src/invoke.ts:8): tools a Bedrock Agents action group or an AgentCore gateway gives a model are configured in the AWS service and run by it, not written in this code, so they are not listed here.',
    '1 Bedrock InvokeModel call(s) (src/invoke.ts:8) send a request body in the model provider\'s own format; a tools list inside it (an Anthropic Messages body) is not read as an exposure, so the tools such a call offers a model are not listed.',
  ]);
  assert.equal(catalog.tools.find((t) => t.name === 'restock_title'), undefined, 'the body\'s tools list is not read as a definition either');
});
