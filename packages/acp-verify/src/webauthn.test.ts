/**
 * §8.6c against the ENGINE's own bytes.
 *
 * `fixtures/refused_webauthn.json` is a byte-identical mirror of
 * `crates/acp-crypto/tests/vectors/refused_webauthn.json` at the pin
 * (`tools/check-verify-mirror.py` holds it there), and every case below is
 * driven from it. That is the point: this is the third implementation of HM-4,
 * and what keeps three copies of one rule honest is a shared executable corpus
 * rather than three readings of the clause.
 *
 * Every assertion checks the refusal NAME, never just "it threw". HM-4 states
 * six checks in order and says no step is skipped for a smaller one that
 * already failed, so the property the implementations must agree on is WHICH
 * step refused -- `WebauthnOrigin` is a phishing finding and
 * `WebauthnChallenge` is a replay, and a test asserting only "refused" survives
 * a mutant that refuses at the wrong step.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { WebauthnRefusal, verifyWebauthn, webauthnChallenge } from './webauthn.js';

interface Vector {
  readonly name: string;
  readonly why: string;
  readonly alg: string;
  readonly rp_id: string;
  readonly message_utf8: string;
  readonly cose_key_hex: string;
  readonly assertion_hex: string;
  readonly expect: string;
  readonly counter?: number;
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = Number.parseInt(s.slice(i, i + 2), 16);
  return out;
}

function loadVectors(): Vector[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/refused_webauthn.json', import.meta.url), 'utf8'),
  );
  if (typeof raw !== 'object' || raw === null || !('vectors' in raw)) {
    throw new Error('the mirrored corpus has no `vectors`');
  }
  const vectors: unknown = Reflect.get(raw, 'vectors');
  if (!Array.isArray(vectors)) throw new Error('`vectors` is not a list');
  return vectors.map((v: unknown): Vector => {
    const g = (k: string): unknown =>
      typeof v === 'object' && v !== null ? Reflect.get(v, k) : undefined;
    const str = (k: string): string => {
      const x = g(k);
      if (typeof x !== 'string') throw new Error(`vector field ${k} is not a string`);
      return x;
    };
    const counter = g('counter');
    return {
      name: str('name'),
      why: str('why'),
      alg: str('alg'),
      rp_id: str('rp_id'),
      message_utf8: str('message_utf8'),
      cose_key_hex: str('cose_key_hex'),
      assertion_hex: str('assertion_hex'),
      expect: str('expect'),
      ...(typeof counter === 'number' ? { counter } : {}),
    };
  });
}

const VECTORS = loadVectors();

test('the mirrored corpus is the engine corpus: 18 vectors, two of them ACCEPT', () => {
  // The instrument before the measurement. A corpus that lost its positive
  // vectors is satisfied by a verifier that refuses everything, and a corpus
  // that lost its negative ones is satisfied by one that accepts everything --
  // both go green, which is why the shape is asserted rather than assumed.
  assert.equal(VECTORS.length, 18);
  assert.equal(VECTORS.filter((v) => v.expect === 'ACCEPT').length, 2);
  const steps = new Set(VECTORS.map((v) => v.expect));
  for (const name of [
    'WebauthnType',
    'WebauthnChallenge',
    'WebauthnOrigin',
    'WebauthnAuthenticatorData',
    'WebauthnSignature',
    'Malformed',
    'RegistryKeyWeak',
  ]) {
    assert.ok(steps.has(name), `the corpus no longer exercises ${name}`);
  }
});

for (const v of VECTORS) {
  test(`${v.expect === 'ACCEPT' ? 'ACCEPT' : v.expect}: ${v.name}`, () => {
    const run = (): number =>
      verifyWebauthn(
        v.alg,
        unhex(v.cose_key_hex),
        new TextEncoder().encode(v.message_utf8),
        v.rp_id,
        unhex(v.assertion_hex),
      );
    if (v.expect === 'ACCEPT') {
      // The counter comes back as the engine read it -- bytes 33..37, big
      // endian. Asserting the VALUE and not merely "it did not throw" is what
      // makes this vector cover HM-4 (f)'s input as well as (a)-(e).
      assert.equal(run(), v.counter, v.why);
      return;
    }
    try {
      run();
    } catch (e: unknown) {
      assert.ok(e instanceof WebauthnRefusal, `${v.name} threw something other than a refusal`);
      assert.equal(e.refusalName, v.expect, `${v.name}: ${v.why}`);
      return;
    }
    assert.fail(`${v.name} was ACCEPTED; the engine refuses it as ${v.expect}`);
  });
}

test('HM-2: the challenge is RFC 4648 §5 base64url WITHOUT padding', () => {
  // The §5 vectors, in the URL alphabet, unpadded -- because WebAuthn's
  // `clientDataJSON.challenge` is defined that way and a padded or `+/`
  // spelling compares unequal against every real authenticator's output. One
  // definition, so "the challenge encoding" cannot mean two things here.
  const e = (s: string): string => webauthnChallenge(new TextEncoder().encode(s));
  assert.equal(e(''), '');
  assert.equal(e('f'), 'Zg');
  assert.equal(e('fo'), 'Zm8');
  assert.equal(e('foo'), 'Zm9v');
  assert.equal(e('foob'), 'Zm9vYg');
  assert.equal(e('fooba'), 'Zm9vYmE');
  assert.equal(e('foobar'), 'Zm9vYmFy');
  // The two characters that separate the URL alphabet from the standard one.
  assert.equal(webauthnChallenge(Uint8Array.from([0xfb, 0xf0])), '-_A');
});
