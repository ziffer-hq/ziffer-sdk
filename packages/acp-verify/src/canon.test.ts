/**
 * The canon proof: byte-identity with the ENGINE's canon on every fixture
 * case. `fixtures/canon_vectors.json` was produced by importing and executing
 * `reference/src/acp_executor.py::canon` at the pin (see the fixture's
 * provenance block), and `tools/check-verify-mirror.py` re-derives every case
 * against the engine -- so agreement with the fixture IS agreement with the
 * engine, with no transcription in between.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { canon, compareCodePoints } from './canon.js';
import { CLAUSE_CANONICAL } from './clauses.js';
import { Refusal } from './refusal.js';

interface CanonCase {
  readonly name: string;
  readonly value: unknown;
  readonly canonical_utf8: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadCases(): CanonCase[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/canon_vectors.json', import.meta.url), 'utf8'),
  );
  assert.ok(isRecord(raw), 'fixture root is not an object');
  const cases = raw['cases'];
  assert.ok(Array.isArray(cases), 'fixture carries no cases');
  return cases.map((c: unknown): CanonCase => {
    assert.ok(isRecord(c), 'fixture case is not an object');
    const name = c['name'];
    const expected = c['canonical_utf8'];
    assert.ok(typeof name === 'string' && typeof expected === 'string');
    return { name, value: c['value'], canonical_utf8: expected };
  });
}

test('canon reproduces the engine canon byte for byte on every fixture case', () => {
  const cases = loadCases();
  // A smaller corpus is a weaker claim (instant.rs's own guard, same reason).
  assert.ok(cases.length >= 10, `corpus shrank to ${cases.length} cases`);
  for (const c of cases) {
    const got = new TextDecoder('utf-8', { fatal: true }).decode(canon(c.value));
    assert.equal(got, c.canonical_utf8, `canon diverged from the engine on ${c.name}`);
  }
});

test('a non-integer number is refused at any depth (disclosed divergence)', () => {
  // The engine accepts a NESTED float (ACP-75, bug-for-bug between Python and
  // Rust). This implementation cannot: JSON.parse collapses 1000.0 and 1000
  // into one value, so reproducing the engine's "1000.0" bytes would be a
  // guess about bytes it never saw. Refusing is the fail-closed side of that
  // divergence, and this test PINS it -- if it ever starts passing floats,
  // the divergence has silently become an encoding split.
  for (const v of [1.5, { issued_at: 1000.5 }, [1, [2.25]]]) {
    assert.throws(
      () => canon(v),
      (e: unknown) => e instanceof Refusal && e.clause === CLAUSE_CANONICAL,
      `accepted a float in ${JSON.stringify(v)}`,
    );
  }
});

test('an integer JSON.parse has already damaged is refused, not signed', () => {
  // Beyond 2^53-1 the digits the engine would have signed are gone before
  // this module ever sees the value (the ACP-54 integer-domain family,
  // reached from the JS side).
  assert.throws(
    () => canon({ big: 9007199254740992 }),
    (e: unknown) => e instanceof Refusal && e.clause === CLAUSE_CANONICAL,
  );
  // The control: the largest safe integer still encodes.
  assert.deepEqual(
    canon({ big: 9007199254740991 }),
    new TextEncoder().encode('{"big":9007199254740991}'),
  );
});

test('key order is code-point order, not UTF-16 unit order', () => {
  // U+10000 encodes as a surrogate pair starting 0xD800, so JS default string
  // comparison puts it BEFORE U+FFFD. Code-point order (Python, Rust UTF-8
  // byte order) puts it after. The fixture pins the full encoding; this pins
  // the comparator on its own so a "simplified" keys.sort() cannot survive.
  assert.ok(compareCodePoints('�', '\u{10000}') < 0, 'comparator is in UTF-16 unit order');
  assert.ok('�' > '\u{10000}', 'JS default order changed?! re-examine the comparator');
});

test('undefined and friends are not canonically encodable', () => {
  assert.throws(
    () => canon(undefined),
    (e: unknown) => e instanceof Refusal && e.clause === CLAUSE_CANONICAL,
  );
});
