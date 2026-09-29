/**
 * The three readings of 2026-09-28 (ACP-455) over `fixtures/code/tool-calls`, each with
 * its decoy: a tool that runs another tool without passing the dispatcher (`calls`),
 * what the source shows before each dispatcher call (`caller_checks`), and what a
 * definition claims or says of itself (`authority_claims`, `declared_stub`). The names
 * in the fixture are invented; the shapes are the first customer's.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';
import { CodeSdksDataInvalid, loadCodeNames, parseCodeNames } from '../sdks.js';
import type { CodeCatalog, CodeTool, Dispatcher } from '../types.js';
import { REACH_DEPTH } from './reach.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/tool-calls/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function tool(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, name);
  return t;
}

function dispatcher(): Dispatcher {
  assert.equal(catalog.dispatchers.length, 1);
  const d = catalog.dispatchers[0];
  assert.ok(d !== undefined);
  return d;
}

// ---------------------------------------------------------------- 1. calls

test('calls: a dynamically imported run function, called in the tool\'s own run, is a direct call', () => {
  assert.deepEqual(tool('closeStore').calls, [
    { tool: 'publishNotice', at: { file: 'src/tools/handlers/close-store.ts', line: 16, col: 33 }, via: 'direct', through: [] },
  ]);
});

test('calls: a static import called directly, and a re-export reached two helpers deep, name the helpers', () => {
  assert.deepEqual(tool('restock').calls, [
    { tool: 'getStock', at: { file: 'src/tools/handlers/restock.ts', line: 21, col: 26 }, via: 'direct', through: [] },
    { tool: 'getStock', at: { file: 'src/tools/handlers/restock.ts', line: 12, col: 10 }, via: 'direct', through: ['shelfLevel', 'countShelf'] },
  ]);
});

test('calls: a run function taken from the tools map by a literal key names the tool', () => {
  assert.deepEqual(tool('auditShelf').calls, [
    { tool: 'getStock', at: { file: 'src/tools/handlers/audit-shelf.ts', line: 13, col: 58 }, via: 'lookup', through: [] },
  ]);
});

test('calls: a context whose method takes ANY tool by a computed name is a lookup with no tool named; the recipe map is not a tools map', () => {
  assert.deepEqual(tool('runRecipe').calls, [
    { at: { file: 'src/recipes/_recipe-context.ts', line: 18, col: 14 }, via: 'lookup', through: ['buildRecipeContext', 'invokeTool'] },
  ]);
});

test('calls DECOY: a tool that runs another THROUGH the dispatcher, and a lookup in a map of non-tools, report nothing', () => {
  assert.equal(tool('notifyOwner').calls, undefined);
  assert.equal(tool('formatPrice').calls, undefined);
  // The dispatcher's own `tool.execute` is never attributed to a tool that calls it.
  for (const t of catalog.tools) for (const c of t.calls ?? []) assert.notEqual(c.at.file, 'src/tools/tool-executor.ts', t.name);
  assert.equal(tool('publishNotice').calls, undefined);
  assert.equal(tool('getStock').calls, undefined);
});

test('calls: the depth followed is said in the honesty lines', () => {
  assert.ok(catalog.not_seen.some((l) => l.includes(`${REACH_DEPTH} calls deep`)), catalog.not_seen.join('\n'));
});

// ---------------------------------------------------------------- 2. caller_checks

test('caller_checks: one entry per caller, same order, same refs', () => {
  const d = dispatcher();
  assert.equal(d.name, 'executeTool');
  assert.deepEqual(d.caller_checks?.map((c) => c.caller), d.callers);
});

test('caller_checks: the model path tests requires_confirmation before it calls', () => {
  const c = dispatcher().caller_checks?.find((x) => x.caller.file === 'src/orchestrator/bridge.ts');
  assert.deepEqual(c, {
    caller: { file: 'src/orchestrator/bridge.ts', line: 24, col: 25 },
    in_function: 'execute',
    check: { at: { file: 'src/orchestrator/bridge.ts', line: 21, col: 9 }, reads: 'requires_confirmation' },
  });
});

test('caller_checks: the route validates `confirmed` before it calls, and is named by its path', () => {
  const c = dispatcher().caller_checks?.find((x) => x.caller.file === 'src/routes/approved-write.ts');
  assert.deepEqual(c, {
    caller: { file: 'src/routes/approved-write.ts', line: 32, col: 23 },
    in_function: "router.post('/stores/:storeId/approved-write')",
    check: { at: { file: 'src/routes/approved-write.ts', line: 28, col: 5 }, reads: 'confirmed' },
  });
});

test('caller_checks DECOY: `confirmedAt`, and a `confirmed` read after the call, are no check', () => {
  const c = dispatcher().caller_checks?.find((x) => x.caller.file === 'src/decorators/audit-logger.ts');
  assert.deepEqual(c, { caller: { file: 'src/decorators/audit-logger.ts', line: 9, col: 21 }, in_function: 'auditedExecute' });
  const n = dispatcher().caller_checks?.find((x) => x.caller.file === 'src/tools/handlers/notify-owner.ts');
  assert.equal(n?.check, undefined);
});

// ---------------------------------------------------------------- 3. claims and stubs

test('authority_claims: the claim names written on a definition, with their values as written', () => {
  assert.deepEqual(tool('closeStore').authority_claims, [{ name: 'requires_confirmation', value: 'true' }]);
  assert.deepEqual(tool('formatPrice').authority_claims, [{ name: 'requires_confirmation', value: 'false' }]);
  assert.deepEqual(tool('lookupWeather').authority_claims, [{ name: 'needsApproval', value: 'true' }]);
  // One source: the honesty line counts the tools that carry the field.
  const n = catalog.tools.filter((t) => t.authority_claims !== undefined).length;
  assert.equal(n, 9);
  // Split by the value written (second review, 2026-09-28): a definition that says `false` declares
  // that NO confirmation is needed, so "declare requires_confirmation" counted it on the wrong side.
  const per = (name: string, value: string): number => catalog.tools.filter((t) => (t.authority_claims ?? []).some((c) => c.name === name && c.value === value)).length;
  const [t, f, a] = [per('requires_confirmation', 'true'), per('requires_confirmation', 'false'), per('needsApproval', 'true')];
  assert.equal(t + f + a, n, 'the split adds up to the definitions counted');
  assert.ok(
    catalog.not_seen.some((l) => l.startsWith(`${n} tool definition(s) carry authority hints (needsApproval: true in ${a}, requires_confirmation: true in ${t}, false in ${f})`)),
    catalog.not_seen.join('\n'),
  );
});

test('declared_stub: the whole word "stub", any case; "stubborn" is not it', () => {
  assert.equal(tool('getStock').declared_stub, true);
  assert.equal(tool('auditShelf').declared_stub, undefined);
  assert.deepEqual(catalog.tools.filter((t) => t.declared_stub === true).map((t) => t.name), ['getStock']);
});

// ---------------------------------------------------------------- 4. checks

test('checks: the TypeScript entry says every check ran (ACP-460 added skill_loads); a syntax-only run says none did', async () => {
  assert.deepEqual(catalog.checks, [{ language: 'typescript', tool_calls: true, caller_checks: true, skill_loads: true }]);
  const s = await scanCode(FIXTURE, { syntaxOnly: true });
  assert.deepEqual(s.checks, [{ language: 'typescript', tool_calls: false, caller_checks: false, skill_loads: false }]);
  assert.equal('skill_loads' in s, false);
});

test('the two name lists are data, and an empty or missing one halts by name', () => {
  const names = loadCodeNames();
  assert.ok(names.authorityClaims.includes('requires_confirmation'));
  assert.ok(names.confirmation.includes('confirmed'));
  assert.ok(!names.confirmation.includes('confirmedAt'));
  assert.throws(() => parseCodeNames('{"authority_claim_names":[],"confirmation_names":["x"]}'), CodeSdksDataInvalid);
  assert.throws(() => parseCodeNames('{"authority_claim_names":["x"]}'), CodeSdksDataInvalid);
});
