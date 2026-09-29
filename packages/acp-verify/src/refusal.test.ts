/**
 * Refusal names: every name resolves from its clause and back, a clause this
 * build has no name for still prints a named line, the printed form is
 * `Name: meaning (clause)`, `clause` is unchanged for code that reads it, and
 * the line for every refusal is the one the Python SDK prints for it --
 * `fixtures/refusal-lines.json` is read by both suites.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  REFUSALS,
  Refusal,
  UNNAMED_REFUSAL,
  isRefusalName,
  refusalLine,
  refusalText,
  refusalsForClause,
} from './refusal.js';

interface LineCase {
  readonly clause: string;
  readonly name: string | null;
  readonly line: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lineCases(): LineCase[] {
  const raw: unknown = JSON.parse(readFileSync(new URL('../fixtures/refusal-lines.json', import.meta.url), 'utf8'));
  const cases = isRecord(raw) ? raw['cases'] : undefined;
  assert.ok(Array.isArray(cases) && cases.length > 0, 'refusal-lines.json carries no cases');
  const out: LineCase[] = [];
  for (const c of cases) {
    assert.ok(isRecord(c));
    const { clause, name, line } = c;
    assert.ok(typeof clause === 'string' && typeof line === 'string');
    assert.ok(name === null || typeof name === 'string');
    out.push({ clause, name, line });
  }
  return out;
}

test('every name resolves from its clause, and every name leads back to exactly that clause', () => {
  const names = new Set<string>();
  for (const entry of REFUSALS) {
    assert.ok(!names.has(entry.name), `${entry.name} is named twice`);
    names.add(entry.name);
    assert.equal(refusalText(entry.clause, entry.name).name, entry.name);
    assert.ok(refusalsForClause(entry.clause).some((e) => e.name === entry.name));
    assert.equal(REFUSALS.filter((e) => e.name === entry.name).length, 1);
    assert.match(entry.name, /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/);
  }
});

test('the printed line is `Name: meaning (clause)`, and `clause` is what it always was', () => {
  const refusal = new Refusal('9.3-3', 'receipt not bound to this proposal');
  assert.equal(
    String(refusal),
    'ReceiptNotBoundToProposal: the receipt is not bound to the proposal you passed (9.3-3)',
  );
  assert.equal(refusal.line, String(refusal));
  // Existing code reads `clause` and `instanceof Refusal`: both unchanged.
  assert.ok(refusal instanceof Refusal && refusal instanceof Error);
  assert.equal(refusal.clause, '9.3-3');
  assert.equal(refusal.name, 'ReceiptNotBoundToProposal');
  assert.equal(refusal.detail, 'receipt not bound to this proposal');
  assert.ok(refusal.action.length > 0);
});

test('a clause this build has no name for prints a line that says so by name, never undefined', () => {
  const refusal = new Refusal('ZZ-99', 'raised by a newer engine');
  assert.equal(refusal.name, UNNAMED_REFUSAL.name);
  assert.equal(refusal.clause, 'ZZ-99');
  assert.equal(
    String(refusal),
    'UnnamedRefusal: the receipt was refused under a rule this version of the SDK has no name for (ZZ-99)',
  );
  assert.doesNotMatch(String(refusal), /undefined/);
  assert.deepEqual(refusalsForClause('ZZ-99'), []);
});

test('the line for every refusal is the one the Python SDK prints (shared fixture)', () => {
  const cases = lineCases();
  // Every name has a case: a name added to the list and not to the fixture is red here.
  for (const entry of REFUSALS) {
    assert.ok(cases.some((c) => c.name === entry.name && c.clause === entry.clause), `no fixture line for ${entry.name}`);
  }
  for (const c of cases) {
    const name = c.name ?? undefined;
    assert.equal(refusalLine(c.clause, name), c.line, `${c.clause} ${c.name ?? '(no name)'}`);
    const refusal =
      name !== undefined && isRefusalName(name) ? new Refusal(c.clause, 'detail', name) : new Refusal(c.clause, 'detail');
    assert.equal(String(refusal), c.line);
  }
});
