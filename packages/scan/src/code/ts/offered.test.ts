/**
 * `CallerCheck.offered` (ACP-455, third reading 2026-09-28) over `fixtures/code/offered`: the tools
 * the MODEL IS TOLD ABOUT on one dispatcher path, read where the calling function is installed
 * beside a tool list. A name-prefix filter of the catalog (in a script outside the tsconfig, made by
 * a factory, plus one named tool), a literal list handed on beside the function by name, and a
 * decoy whose list is computed from a value the source does not show, which must stay absent.
 * The names in the fixture are invented.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';
import type { CallerCheck, CodeCatalog } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/offered/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function entry(inFunction: string): CallerCheck {
  assert.equal(catalog.dispatchers.length, 1);
  const c = catalog.dispatchers[0]?.caller_checks?.find((x) => x.in_function === inFunction);
  assert.ok(c !== undefined, `${inFunction}: ${JSON.stringify(catalog.dispatchers[0]?.caller_checks)}`);
  return c;
}

test('offered: a prefix filter of the catalog, plus one named tool, read where a factory-made caller is installed', () => {
  const c = entry('loggedShelfCall');
  assert.deepEqual(c.offered, ['sendReceipt', 'shelf_count', 'shelf_restock']);
  assert.equal(c.offered_from, 'scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_", plus sendReceipt');
  assert.equal(c.reaches, undefined, 'a list offered to the model is not a bound on what the path runs');
});

test('offered: a literal list handed on beside the function by name', () => {
  const c = entry('tillCall');
  assert.deepEqual(c.offered, ['till_close', 'till_open']);
  assert.equal(c.offered_from, 'src/agents/till-agent.ts:12, the literal list [tillOpen, tillClose]');
});

test('offered DECOY: a list computed from a value the source does not show leaves the field absent', () => {
  const c = entry('openCall');
  assert.equal(c.offered, undefined);
  assert.equal(c.offered_from, undefined);
});

test('offered: the field is present only with its reader phrase', () => {
  for (const c of catalog.dispatchers[0]?.caller_checks ?? []) assert.equal(c.offered === undefined, c.offered_from === undefined, c.in_function);
});
