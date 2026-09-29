/**
 * VS Code language model tools (record §3.19), the surface a GitHub Copilot
 * extension gives agent mode its own tools through: declared in package.json,
 * registered with `vscode.lm.registerTool`, joined by name. Shapes read from
 * @types/vscode 1.138.0 and vscode-extension-samples/chat-sample (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog, CodeTool } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-vscode-lm-tools-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function byName(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, name);
  return t;
}

test('vscode-lm-tools: each declared tool is listed from package.json, with its modelDescription and inputSchema', () => {
  const rows = catalog.tools.map((t) => [t.name, t.params, t.schema_kind, t.sdk, `${t.defined_at.file}:${t.defined_at.line}`]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  assert.deepEqual(rows, [
    ['bookshop_archiveOrder', ['orderId'], 'json_schema', 'vscode-lm-tools', 'package.json:30'],
    ['bookshop_lookupOrder', ['orderId'], 'json_schema', 'vscode-lm-tools', 'package.json:24'],
    ['bookshop_notifyCustomer', [], 'unknown', 'vscode-lm-tools', 'src/extension.ts:36'],
    ['bookshop_refundOrder', ['orderId', 'reason'], 'json_schema', 'vscode-lm-tools', 'package.json:9'],
  ]);
  assert.equal(byName('bookshop_refundOrder').description, "Refund a customer's order in full and email the receipt");
  for (const t of catalog.tools) assert.ok(EMITTED_SDKS.includes(t.sdk), t.sdk);
});

test('vscode-lm-tools: the registration is joined by name, its invoke() is the run function, and a declaration nobody registers says so', () => {
  assert.deepEqual(byName('bookshop_refundOrder').execute_at, { file: 'src/extension.ts', line: 11, col: 3 });
  assert.equal(byName('bookshop_lookupOrder').execute_at?.line, 28);
  assert.equal(byName('bookshop_archiveOrder').execute_at, undefined);
  assert.match(byName('bookshop_archiveOrder').via, /no vscode\.lm\.registerTool\(\) for it was found/);
  assert.match(byName('bookshop_notifyCustomer').via, /not declared in a package\.json/);
  assert.equal(byName('bookshop_refundOrder').delegates_to, 'runBookshopAction');
  assert.deepEqual(catalog.dispatchers.map((d) => [d.name, d.tools_delegating]), [['runBookshopAction', 2]]);
});

test('vscode-lm-tools: a prepareInvocation confirmation is recorded as a claim, never relied on', () => {
  assert.deepEqual(byName('bookshop_refundOrder').authority_claims?.map((c) => c.name), ['confirmationMessages']);
  assert.equal(byName('bookshop_lookupOrder').authority_claims, undefined);
});

test('vscode-lm-tools: the manifest is the exposure and names K3 at invoke; a participant offering vscode.lm.tools is computed', () => {
  const manifest = catalog.exposures.find((e) => e.via.startsWith('contributes.languageModelTools'));
  assert.ok(manifest !== undefined);
  assert.deepEqual([manifest.kind, manifest.tools], ['static', ['bookshop_refundOrder', 'bookshop_lookupOrder', 'bookshop_archiveOrder']]);
  assert.match(manifest.note, /top of invoke \(K3\)/);
  const participant = catalog.exposures.find((e) => e.via.startsWith('LanguageModelChat.sendRequest'));
  assert.ok(participant !== undefined);
  assert.equal(participant.kind, 'computed');
  assert.match(participant.note, /other extensions' included/);
  assert.ok(catalog.not_seen.some((l) => l.startsWith('VS Code language model tools are listed as the extension declares them')));
});

test('vscode-lm-tools: an MCP server definition provider is an attach point whose tools are not listed', () => {
  assert.ok(catalog.not_seen.some((l) => l.startsWith('Tools fetched at runtime from an MCP server are not listed (1 client attach point(s): src/participant.ts:15')));
});
