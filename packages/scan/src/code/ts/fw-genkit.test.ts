/**
 * Genkit (record §3.21): `ai.defineTool(config, fn)` and `ai.defineInterrupt(config)`
 * on the instance `genkit()` returns, handed to `generate` / `definePrompt` by value or
 * by name; K3 at the tool function, K2 for an interrupt. Shapes from genkit 1.42.0 and
 * firebase/genkit js/testapps (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog, CodeTool } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-genkit-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function byName(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, name);
  return t;
}

test('genkit: ai.defineTool on the genkit() instance is a tool with its Zod input and its function', () => {
  const rows = catalog.tools.map((t) => [t.name, t.params, t.schema_kind, t.execute_at === undefined ? '-' : 'fn']).sort();
  assert.deepEqual(rows, [
    ['confirmRefund', ['orderId'], 'zod', '-'],
    ['lookupOrder', ['orderId'], 'zod', 'fn'],
    ['refundOrder', ['orderId', 'cents'], 'zod', 'fn'],
    ['shelveTitle', [], 'unknown', 'fn'],
  ]);
  assert.equal(byName('refundOrder').description, 'Refund an order in full');
  assert.equal(byName('refundOrder').delegates_to, 'runBookshopAction');
  assert.match(byName('confirmRefund').via, /^defineInterrupt\(\) from "genkit" \(the call pauses the run/);
  for (const t of catalog.tools) assert.ok(EMITTED_SDKS.includes(t.sdk) && t.sdk === 'genkit', t.sdk);
});

test('genkit: generate and definePrompt are exposures, a tool named by a string included; the note names K3 and K2', () => {
  const ex = catalog.exposures.map((e) => [e.via, e.kind, e.tools]).sort();
  assert.deepEqual(ex, [
    ['definePrompt({ tools }) from "genkit"', 'static', ['lookupOrder']],
    ['generate({ tools }) from "genkit"', 'static', ['lookupOrder', 'confirmRefund', 'refundOrder']],
  ]);
  for (const e of catalog.exposures) assert.match(e.note, /tool function \(K3\).*\(K2\)/);
});

test('genkit: a .prompt file declaring tools in front matter, and z taken from the application\'s own module, are each said (ACP-455, 2026-09-28)', () => {
  assert.deepEqual(catalog.not_seen.filter((l) => l.includes('Genkit')), [
    '1 Genkit tool(s) write their input schema with `z` imported from the application\'s own module (src/shelf.ts:5); the scan does not follow that re-export to Zod, so their parameters are not listed.',
    '1 Genkit .prompt file(s) declare tools in their front matter (prompts/refund.prompt:3); those lists are not read, so which tools those prompts hand a model is not listed here.',
  ]);
});
