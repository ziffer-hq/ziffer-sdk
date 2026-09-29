/**
 * `CallerCheck.reaches` (ACP-455, second review 2026-09-28) over `fixtures/code/reaches`: which
 * tools one call to the dispatcher can hand it, when the SOURCE bounds the name, and nothing
 * when it does not. The bounded shapes (a literal at the call, a name prefix tested before it,
 * an imported literal list tested before it) each beside a decoy that must stay unbounded (a
 * parameter passed on, a prefix test that only logs, a list that can change). The names in the
 * fixture are invented.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';
import type { CallerCheck, CodeCatalog } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/reaches/', import.meta.url));

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

test('reaches: a name prefix tested before the call, with a throw, bounds the caller to the tools with that prefix', () => {
  const c = entry('shelfDesk');
  assert.deepEqual(c.reaches, ['shelf_count', 'shelf_restock']);
  assert.equal(c.reaches_from, "the name prefix 'shelf_' tested at src/desks/shelf-desk.ts:6");
});

test('reaches: an imported literal list tested before the call bounds it to the list, and a listed name that is no tool reaches nothing', () => {
  const c = entry('tillDesk');
  assert.deepEqual(c.reaches, ['till_close', 'till_open']);
  assert.equal(c.reaches_from, 'the list TILL_TOOLS the name is tested against at src/desks/till-desk.ts:8');
});

test('reaches: a literal name at the call reaches that one tool', () => {
  const c = entry('countShelf');
  assert.deepEqual(c.reaches, ['shelf_count']);
  assert.equal(c.reaches_from, 'the name written at the call');
});

test('reaches DECOY: a parameter passed on, the model path, a test that only logs, and a list that can change bound nothing', () => {
  for (const f of ['relayCall', 'execute', 'loggedShelfCall', 'openCall']) {
    const c = entry(f);
    assert.equal(c.reaches, undefined, f);
    assert.equal(c.reaches_from, undefined, f);
  }
});

test('reaches: every caller carries the field only with its reader phrase', () => {
  for (const c of catalog.dispatchers[0]?.caller_checks ?? []) assert.equal(c.reaches === undefined, c.reaches_from === undefined, c.in_function);
});
