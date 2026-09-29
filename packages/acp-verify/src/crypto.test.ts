/**
 * The primitive interop half of the third implementation, on the two mirrored
 * engine corpora:
 *
 *  - `refused_ed25519.json` (ACP-106): every vector is ACCEPTED by RFC 8032
 *    as OpenSSL implements it and MUST be refused here, as it is in Rust
 *    (`verify_strict`) and Python (`verify_prim`'s written-out guard). No
 *    differential could find a divergence in this rule while two sides were
 *    wrong identically -- the corpus is what holds all three to it.
 *
 *  - `python_signatures.json`: signatures the Python reference PRODUCED, which
 *    this side must accept -- the TS leg of the cross-language claim
 *    `tests/python_interop.rs` makes for Rust. Also pins the test-key
 *    derivation: HybridKey derives ed from sha256(seed||"ed") and ML-DSA from
 *    sha256(seed||"mldsa"), and the fixture's public keys prove the mirror
 *    below derives the SAME identities, so receipts our tests sign are signed
 *    by keys the engine would derive from the same seed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { ed25519IsSmallOrder, verifyEd25519Strict } from './ed25519.js';
import { hybridKeyFromSeed } from './testkeys.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = Number.parseInt(s.slice(i, i + 2), 16);
  return out;
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

test('every mirrored ACP-106 vector is refused', () => {
  const raw = fixture('refused_ed25519.json');
  assert.ok(isRecord(raw));
  const vectors = raw['vectors'];
  assert.ok(Array.isArray(vectors) && vectors.length >= 3, 'refused corpus shrank');
  for (const v of vectors) {
    assert.ok(isRecord(v));
    const name = v['name'];
    const pk = v['public_key_hex'];
    const msg = v['message_utf8'];
    const sig = v['signature_hex'];
    assert.ok(
      typeof name === 'string' && typeof pk === 'string' &&
      typeof msg === 'string' && typeof sig === 'string',
    );
    assert.equal(
      verifyEd25519Strict(unhex(pk), new TextEncoder().encode(msg), unhex(sig)),
      false,
      `accepted refused vector ${name} -- the strict rule has a hole`,
    );
  }
});

test('the Python reference signatures verify (positive control for both legs)', () => {
  // Without this, the refusals above are satisfiable by a verifier that
  // refuses everything -- the "uniformly broken" trap.
  const raw = fixture('python_signatures.json');
  assert.ok(isRecord(raw));
  const message = raw['message_utf8'];
  const keys = raw['keys'];
  assert.ok(typeof message === 'string' && Array.isArray(keys) && keys.length >= 3);
  const msg = new TextEncoder().encode(message);
  for (const k of keys) {
    assert.ok(isRecord(k));
    const seed = k['seed_utf8'];
    const edPk = k['ed25519_pk_hex'];
    const edSig = k['ed25519_sig_hex'];
    const mlPk = k['mldsa65_pk_hex'];
    const mlSig = k['mldsa65_sig_hex'];
    assert.ok(
      typeof seed === 'string' && typeof edPk === 'string' && typeof edSig === 'string' &&
      typeof mlPk === 'string' && typeof mlSig === 'string',
    );
    assert.ok(
      verifyEd25519Strict(unhex(edPk), msg, unhex(edSig)),
      `Python's Ed25519 signature for seed ${seed} did not verify here`,
    );
    assert.ok(
      ml_dsa65.verify(unhex(mlSig), msg, unhex(mlPk)),
      `Python's ML-DSA-65 signature for seed ${seed} did not verify here`,
    );
    // ...and a flipped message byte fails, so "verifies" means the message.
    const tampered = Uint8Array.from(msg);
    const first = tampered[0];
    assert.ok(first !== undefined);
    tampered[0] = first ^ 1;
    assert.equal(verifyEd25519Strict(unhex(edPk), tampered, unhex(edSig)), false);
  }
});

test('the test-key derivation mirrors the reference HybridKey exactly', () => {
  // The fixture's public keys were derived by acp_crypto.HybridKey from these
  // seeds. If this assertion holds, every receipt the verify tests sign below
  // is signed under an identity the ENGINE would derive from the same seed --
  // "mirroring the reference's test-key derivation" made checkable.
  const raw = fixture('python_signatures.json');
  assert.ok(isRecord(raw));
  const keys = raw['keys'];
  assert.ok(Array.isArray(keys));
  for (const k of keys) {
    assert.ok(isRecord(k));
    const seed = k['seed_utf8'];
    const edPk = k['ed25519_pk_hex'];
    const mlPk = k['mldsa65_pk_hex'];
    assert.ok(typeof seed === 'string' && typeof edPk === 'string' && typeof mlPk === 'string');
    const mine = hybridKeyFromSeed(seed);
    assert.equal(Buffer.from(mine.classical).toString('hex'), edPk,
      `Ed25519 derivation diverged for seed ${seed}`);
    assert.equal(Buffer.from(mine.pq).toString('hex'), mlPk,
      `ML-DSA-65 derivation diverged for seed ${seed}`);
  }
});

test('the small-order predicate answers as the engine rule states', () => {
  // The identity point encoding is small-order...
  const identity = new Uint8Array(32);
  identity[0] = 1;
  assert.equal(ed25519IsSmallOrder(identity), true);
  // ...a genuine public key is not...
  const { classical } = hybridKeyFromSeed('k1');
  assert.equal(ed25519IsSmallOrder(classical), false);
  // ...and bytes that are not a point are FALSE, not true: "not a key" is the
  // verifier's own refusal, and conflating it with "weak key" would make the
  // guard's failure mode unreadable (stated on both engine sides).
  assert.equal(ed25519IsSmallOrder(new Uint8Array(32).fill(0xff)), false);
  assert.equal(ed25519IsSmallOrder(new Uint8Array(31)), false);
});
