/**
 * AT-8a: the decoder accepts exactly one encoding of one value.
 *
 * Every case here is a byte string that a merely well-formed CBOR reader
 * accepts and a canonical one must not, because the entry digest AB-1
 * recomputes is taken over the bytes that arrived: a second encoding of one
 * assertion is a second digest for one human decision, which is the Z4
 * encoding split reached through §8.6c.
 *
 * The vectors are written as hex here rather than mirrored, and the reason is
 * worth stating: `fixtures/refused_webauthn.json` already holds the engine's
 * bytes for the two shapes this decoder exists to read, and
 * `webauthn.test.ts` replays them. What this file adds is the decoder's own
 * boundary -- inputs no assertion corpus would contain, because a canonical
 * ENCODER cannot produce them.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CborError,
  cborEncode,
  cborGetInt,
  cborGetText,
  cborIsMap,
  decodeCanonical,
  type Cbor,
} from './cbor.js';

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = Number.parseInt(s.slice(i, i + 2), 16);
  return out;
}

function hex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function refused(bytes: string): string {
  try {
    decodeCanonical(unhex(bytes));
  } catch (e: unknown) {
    assert.ok(e instanceof CborError, 'a non-canonical input threw something else');
    return e.message;
  }
  return 'ACCEPTED';
}

test('the control: a canonical map of the HM-3 shape decodes and round-trips', () => {
  // Without an accepted case every refusal below is satisfied by a decoder that
  // refuses everything.
  const value: Cbor = {
    entries: [
      ['signature', Uint8Array.from([1, 2, 3])],
      ['client_data_json', Uint8Array.from([4])],
      ['authenticator_data', Uint8Array.from([5, 6])],
    ],
  };
  const bytes = cborEncode(value);
  // Canonical order is by ENCODED key bytes, so by LENGTH first: `signature`
  // (9) precedes `client_data_json` (16) precedes `authenticator_data` (18).
  // A reader who assumed alphabetical order would write a decoder that refuses
  // every real assertion -- the engine's own note, checked here.
  assert.match(hex(bytes), /^a3697369676e6174757265/);
  const back = decodeCanonical(bytes);
  assert.ok(cborIsMap(back));
  assert.deepEqual(cborGetText(back, 'signature'), Uint8Array.from([1, 2, 3]));
});

test('a non-shortest argument is refused, not normalised', () => {
  // 0x00 is the canonical encoding of 0; 0x1800 encodes the same value in two
  // bytes. Accepting both gives one integer two spellings, so one COSE_Key two
  // `public_key` strings -- and PB-7's distinctness is a comparison over that
  // string.
  assert.equal(hex(cborEncode(0n)), '00');
  assert.match(refused('1800'), /non-shortest/);
  assert.match(refused('190017'), /non-shortest/);
  assert.match(refused('1a0000ffff'), /non-shortest/);
});

test('an indefinite length is refused', () => {
  // `5f 41 61 ff` is an indefinite-length byte string, legal CBOR and never
  // canonical. A decoder that accepted it would have to re-chunk to compare.
  assert.match(refused('5f4161ff'), /indefinite/);
});

test('map keys out of canonical order, and duplicates, are refused', () => {
  // Out of order: `{"b":1,"a":1}`. The re-encode proof is what catches it, and
  // it catches every §4.2.1 rule at once rather than one hand-written check per
  // rule that can drift from the encoder.
  assert.match(refused('a2616201616101'), /canonical encoding of its value/);
  // A repeated key: `{"a":1,"a":2}`. Two entries, one identity.
  assert.notEqual(refused('a2616101616102'), 'ACCEPTED');
});

test('a float and a tag are refused rather than skipped', () => {
  // WE-1 / AT-8a: a float has several representations of one value and no
  // deterministic ordering story. `fb...` is a 64-bit float, `c0...` a tag.
  assert.match(refused('fb3ff0000000000000'), /float|non-shortest|unsupported/);
  assert.notEqual(refused('c16161'), 'ACCEPTED');
});

test('trailing bytes after a complete value are refused', () => {
  // A decoder that stopped at the first complete value would let an attacker
  // append anything to bytes the receipt committed to under AB-1.
  assert.match(refused('0000'), /trailing bytes/);
});

test('a truncated input is refused rather than read past the end', () => {
  assert.match(refused('4105'.slice(0, 2)), /truncated/);
  assert.match(refused('a1616101'.slice(0, 4)), /truncated/);
});

test('a COSE_Key negative label round-trips as the label, not as its encoding', () => {
  // RFC 9052 §7 writes `x` as label -2, encoded as major type 1 argument 1.
  // A decoder that returned the ARGUMENT rather than the value would look up
  // the wrong coordinate and still find bytes.
  const key = decodeCanonical(
    cborEncode({
      entries: [
        [1n, 2n],
        [-1n, 1n],
        [-2n, Uint8Array.from([9])],
      ],
    }),
  );
  assert.ok(cborIsMap(key));
  assert.equal(cborGetInt(key, 1n), 2n);
  assert.deepEqual(cborGetInt(key, -2n), Uint8Array.from([9]));
  assert.equal(cborGetInt(key, -3n), undefined);
});

test('a 64-bit argument keeps every digit', () => {
  // `bigint` throughout rather than `number`: the argument is a full 64-bit
  // unsigned integer, and JSON-side `canon.ts` refuses past 2^53-1 for the same
  // reason. Re-encoding a length to different bytes than arrived would make the
  // decoder call a canonical input non-canonical for its own reason.
  const big = 0xffffffffffffffffn;
  assert.equal(hex(cborEncode(big)), '1bffffffffffffffff');
  assert.equal(decodeCanonical(unhex('1bffffffffffffffff')), big);
});
