/**
 * The front end over `fixtures/code/example-shape`: the first customer's shape
 * in fourteen files. Every number asserted here is one the report prints, and
 * each would be wrong in a way a customer could see if the rule behind it broke:
 * delete S-LOCAL and the four `local` tools vanish (the count drops to 2); drop
 * the type join and the loop's exposure names nothing; resolve callers by
 * spelling and the lazily imported decorator is lost.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import { loadCodeSdks } from '../sdks.js';
import type { CodeCatalog, CodeTool } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/example-shape/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function bySdk(sdk: string): CodeTool[] {
  return catalog.tools.filter((t) => t.sdk === sdk);
}

const LOCAL_VIA = 'defineTool() (app-local factory, returns ToolModule with input_schema typed Tool.InputSchema from "@anthropic-ai/sdk")';

test('S-LOCAL: exactly the four defineTool() tools, found through the factory return type', () => {
  const local = bySdk('local');
  assert.deepEqual(
    local.map((t) => [t.name, t.params, t.schema_kind, t.via]),
    [
      ['add_charge', ['confirmationCode', 'amountCents', 'label'], 'zod', LOCAL_VIA],
      ['cancel_reservation', ['confirmationCode', 'reason'], 'zod', LOCAL_VIA],
      ['get_property', [], 'zod', LOCAL_VIA],
      ['send_guest_message', ['guestId', 'channel', 'body'], 'zod', LOCAL_VIA],
    ],
  );
  // A description built from constants is read as the model sees it.
  assert.equal(local[0]?.description, 'Post a charge to a booking (minibar, late checkout, damages). Requires PM confirmation.');
  for (const t of local) {
    assert.equal(t.delegates_to, 'executeTool', t.name);
    assert.ok(t.execute_at !== undefined, t.name);
  }
});

test('AI SDK: one tool() from "ai", named by its variable, params from the Zod object', () => {
  const ai = bySdk('ai');
  assert.equal(ai.length, 1);
  assert.equal(ai[0]?.name, 'lookupWeather');
  assert.equal(ai[0]?.via, 'tool() from "ai"');
  assert.deepEqual(ai[0]?.params, ['location']);
  assert.equal(ai[0]?.delegates_to, undefined);
});

test('Anthropic: one { name, input_schema } literal in tools[] on messages.create', () => {
  const a = bySdk('anthropic');
  assert.equal(a.length, 1);
  assert.equal(a[0]?.name, 'search_docs');
  assert.equal(a[0]?.via, 'tools[] on messages.create');
  assert.equal(a[0]?.schema_kind, 'json_schema');
  assert.deepEqual(a[0]?.params, ['query', 'limit']);
  assert.equal(catalog.tools.length, 6);
});

test('exposures: the loop is computed with the four names joined back; streamText joins through the map; messages.create is static', () => {
  const loop = catalog.exposures.find((e) => e.via === 'dynamicTool() in a loop');
  assert.ok(loop !== undefined);
  assert.equal(loop.kind, 'computed');
  assert.deepEqual([...loop.tools].sort(), ['add_charge', 'cancel_reservation', 'get_property', 'send_guest_message']);
  assert.equal(loop.at.file, 'src/orchestrator/tool-bridge.ts');
  assert.match(loop.note, /getToolsForLocation/);

  const st = catalog.exposures.find((e) => e.via === 'streamText({ tools })');
  assert.ok(st !== undefined);
  assert.equal(st.kind, 'computed');
  assert.deepEqual([...st.tools].sort(), ['add_charge', 'cancel_reservation', 'get_property', 'send_guest_message']);

  const mc = catalog.exposures.find((e) => e.via === 'messages.create({ tools })');
  assert.ok(mc !== undefined);
  assert.equal(mc.kind, 'static');
  assert.deepEqual(mc.tools, ['search_docs']);
  assert.equal(catalog.exposures.length, 3);
});

test('dispatcher: exactly one, executeTool, with its written signature, all three callers and four tools delegating', () => {
  assert.equal(catalog.dispatchers.length, 1);
  const d = catalog.dispatchers[0];
  assert.ok(d !== undefined);
  assert.equal(d.name, 'executeTool');
  assert.equal(d.signature, '(name, input, ctx, abortSignal)');
  assert.deepEqual(d.at, { file: 'src/tools/tool-executor.ts', line: 5, col: 1 });
  assert.deepEqual(
    d.callers.map((c) => c.file),
    ['src/decorators/decision-logger.ts', 'src/orchestrator/tool-bridge.ts', 'src/routes/confirmed-write.ts'],
  );
  assert.equal(d.tools_delegating, 4);
});

test('gate: getToolsForLocation, naming the data source getActiveTools', () => {
  assert.equal(catalog.gates.length, 1);
  assert.equal(catalog.gates[0]?.name, 'getToolsForLocation');
  assert.match(catalog.gates[0]?.note ?? '', /getActiveTools/);
});

test('syntax-only pass: finds the two import-named tools and misses the four only the type reveals', () => {
  assert.deepEqual(catalog.syntax_only, { found: 2, missed: 4 });
});

test('sdks and package name come from the manifest', () => {
  assert.deepEqual(catalog.sdks.map((s) => s.name), ['@anthropic-ai/sdk', 'ai', 'zod']);
  assert.equal(catalog.package_name, 'example-shape-fixture');
  assert.equal(catalog.files_read, 14);
});

test('honesty lines name the data-decided exposure and the computed tool sets', () => {
  assert.ok(catalog.not_seen.some((l) => l.includes('getToolsForLocation') && l.includes('CAN be exposed')));
  assert.ok(catalog.not_seen.some((l) => l.startsWith('2 tool set(s) are built at runtime')));
});

test('every sdk value the front end emits is an id in data/code-sdks.json', () => {
  const ids = new Set(loadCodeSdks().map((e) => e.id));
  for (const s of EMITTED_SDKS) assert.ok(ids.has(s), s);
  for (const t of catalog.tools) assert.ok(ids.has(t.sdk), t.sdk);
});

test('syntaxOnly option: the checked signatures are skipped and nothing is written into the tree', async () => {
  const c = await scanCode(FIXTURE, { syntaxOnly: true });
  assert.equal(c.tools.length, 0);
  assert.equal(c.syntax_only.found, 2);
});
