/**
 * The FOURTH consumer of the engine's shared instant corpus
 * (`tools/instant-type-vectors.json`, mirrored byte-identically into
 * fixtures/). The engine already runs it against instant.rs, the Python
 * reference and the schema pattern; a spelling that tells any two of the four
 * apart now turns something red here too.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseInstant } from './instant.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

test('the shared instant corpus is answered identically', () => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/instant-type-vectors.json', import.meta.url), 'utf8'),
  );
  assert.ok(isRecord(raw));
  const cases = raw['cases'];
  assert.ok(Array.isArray(cases));
  let checked = 0;
  for (const c of cases) {
    assert.ok(isRecord(c));
    const value = c['value'];
    const conforms = c['conforms'];
    const why = c['why'];
    assert.ok(typeof value === 'string' && typeof conforms === 'boolean');
    assert.equal(
      parseInstant(value) !== null,
      conforms,
      `corpus case ${JSON.stringify(value)}: ${typeof why === 'string' ? why : ''}`,
    );
    checked += 1;
  }
  // instant.rs's own floor: a smaller corpus is a weaker claim.
  assert.ok(checked >= 10, `corpus shrank to ${checked} cases`);
});

test('epoch conversion matches known instants from an independent implementation', () => {
  // The values instant.rs pins, sourced there from Python's datetime -- an
  // implementation none of the four consumers is. A subtly wrong leap-year
  // rule shifts an expiry by a day and nothing else notices.
  assert.equal(parseInstant('1970-01-01T00:00:00Z'), 0);
  assert.equal(parseInstant('2000-03-01T00:00:00Z'), 951_868_800);
  assert.equal(parseInstant('2026-08-18T00:00:00Z'), 1_787_011_200);
  assert.equal(parseInstant('2038-01-19T03:14:07Z'), 2_147_483_647);
});

test('an impossible calendar date is refused rather than rolled over', () => {
  // 2026-02-31 used to PARSE in the engine and rolled forward to the same
  // instant as 2026-03-03 -- two spellings of one value in the field that
  // decides when a receipt stops being valid. The port must not resurrect it.
  for (const bad of [
    '2026-02-31T00:00:00Z',
    '2026-02-29T00:00:00Z', // 2026 is not a leap year
    '2100-02-29T00:00:00Z', // divisible by 100, not by 400
    '2026-01-00T00:00:00Z',
    '2026-08-18T23:59:60Z', // leap second: the reference datetime refuses it
  ]) {
    assert.equal(parseInstant(bad), null, `accepted impossible date ${bad}`);
  }
  // The controls, so the refusals are not "refuses everything".
  assert.notEqual(parseInstant('2024-02-29T00:00:00Z'), null);
  assert.notEqual(parseInstant('2000-02-29T00:00:00Z'), null);
});
