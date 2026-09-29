/**
 * TEST KEY MATERIAL ONLY -- the reference's `HybridKey` seed derivation
 * (`acp_crypto.py`), mirrored so fixtures signed here are signed under
 * identities the ENGINE derives from the same seeds: ed secret =
 * sha256(seed || "ed"), ML-DSA seed = sha256(seed || "mldsa"), both legs from
 * one seed (an unseeded ML-DSA keygen gave each process a different key for
 * one identity once -- the engine's own recorded defect).
 *
 * A seed derived from a string anyone can read is a key anyone can hold. This
 * module is imported by tests only and is deliberately NOT exported from
 * index.ts; a deployment loads keys from a KMS, never from here.
 */

import { createHash } from 'node:crypto';

import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

export interface TestHybridKey {
  readonly edSecret: Uint8Array;
  readonly classical: Uint8Array;
  readonly pq: Uint8Array;
  readonly pqSecret: Uint8Array;
}

export function hybridKeyFromSeed(seedText: string): TestHybridKey {
  const seed = new TextEncoder().encode(seedText);
  const edSecret = new Uint8Array(
    createHash('sha256').update(seed).update(new TextEncoder().encode('ed')).digest(),
  );
  const mlSeed = new Uint8Array(
    createHash('sha256').update(seed).update(new TextEncoder().encode('mldsa')).digest(),
  );
  const kp = ml_dsa65.keygen(mlSeed);
  return {
    edSecret,
    classical: Uint8Array.from(ed25519.getPublicKey(edSecret)),
    pq: Uint8Array.from(kp.publicKey),
    pqSecret: Uint8Array.from(kp.secretKey),
  };
}

// ---------------------------------------------------------------- §8.6c
//
// A SOFTWARE AUTHENTICATOR, test-only, mirroring `acp_crypto::webauthn::testing`
// and `reference/src/acp_webauthn_testing.py`. It exists so `quorum.test.ts` can
// build a REAL human attestation entry: the mirrored corpus
// (`fixtures/refused_webauthn.json`) proves the HM-4 steps over the engine's own
// bytes, and this proves the entry-level composition around them -- HM-3's
// carrier, the recomputed challenge over an id derived from the object, and the
// signature counter.
//
// The engine keeps its equivalent behind a `testing` feature for one reason and
// it applies here too: a software authenticator is AS0 under AT-10, it is not a
// person, and nothing outside a test may reach it. This module is deliberately
// absent from index.ts.

import { p256 } from '@noble/curves/nist.js';

import { cborEncode, type Cbor } from './cbor.js';
import { webauthnChallenge } from './webauthn.js';

/** One enrolled credential and the private half a real one would never expose. */
export interface TestCredential {
  readonly alg: string;
  readonly rpId: string;
  readonly credentialId: string;
  /** The COSE_Key bytes a registry entry carries (HM-1). */
  readonly coseKey: Uint8Array;
  readonly secret: Uint8Array;
}

function b64(bytes: Uint8Array): string {
  return `b64:${Buffer.from(bytes).toString('base64')}`;
}

function coseMap(entries: readonly (readonly [bigint, Cbor])[]): Uint8Array {
  return cborEncode({ entries });
}

/** Enrol a test credential, deterministically, from a seed string. */
export function webauthnCredentialFromSeed(
  seedText: string,
  alg: string,
  rpId: string,
): TestCredential {
  const credentialId = `cred-${seedText}`;
  if (alg === 'webauthn-ed25519') {
    const secret = new Uint8Array(
      createHash('sha256').update(new TextEncoder().encode(`${seedText}:ed25519`)).digest(),
    );
    const pub = Uint8Array.from(ed25519.getPublicKey(secret));
    // {kty: OKP(1), crv: Ed25519(6), x}
    return {
      alg,
      rpId,
      credentialId,
      coseKey: coseMap([
        [1n, 1n],
        [-1n, 6n],
        [-2n, pub],
      ]),
      secret,
    };
  }
  // ES256. A SHA-256 digest is a valid P-256 scalar with overwhelming
  // probability; the loop is there so "overwhelming" never has to be assumed.
  let secret = new Uint8Array(
    createHash('sha256').update(new TextEncoder().encode(`${seedText}:es256`)).digest(),
  );
  while (!p256.utils.isValidSecretKey(secret)) {
    secret = new Uint8Array(createHash('sha256').update(secret).digest());
  }
  const pub = Uint8Array.from(p256.getPublicKey(secret, false));
  return {
    alg,
    rpId,
    credentialId,
    // {kty: EC2(2), crv: P-256(1), x, y}
    coseKey: coseMap([
      [1n, 2n],
      [-1n, 1n],
      [-2n, pub.slice(1, 33)],
      [-3n, pub.slice(33, 65)],
    ]),
    secret,
  };
}

/** What a test may bend, one knob per HM-4 step, so a break is one argument. */
export interface AssertionOptions {
  /** HM-4 (f)'s counter, big-endian in `authenticator_data`. */
  readonly counter?: number;
  /** HM-4 (a): a `webauthn.create` document is a registration replayed. */
  readonly type?: string;
  /** HM-4 (c): the page the person actually touched their key on. */
  readonly origin?: string;
  /** HM-4 (d): the relying party the authenticator produced data for. */
  readonly rpIdForData?: string;
  /** HM-4 (d): UP and UV, both set by default. */
  readonly flags?: number;
  /** HM-4 (e): sign under this credential instead -- the key-not-enrolled break. */
  readonly signWith?: TestCredential;
}

/**
 * HM-3's `sig.webauthn` value: canonical CBOR of the three fields, `b64:` per
 * WE-4. The challenge is {@link webauthnChallenge} of `messageId`, which the
 * verifier RECOMPUTES -- a test that wrote the challenge in by hand would be
 * asserting against its own copy rather than against HM-2.
 */
export function signAssertion(
  cred: TestCredential,
  messageId: string,
  opts: AssertionOptions = {},
): string {
  const rpForData = opts.rpIdForData ?? cred.rpId;
  const counter = opts.counter ?? 1;
  const ad = new Uint8Array(37);
  ad.set(new Uint8Array(createHash('sha256').update(new TextEncoder().encode(rpForData)).digest()), 0);
  ad[32] = opts.flags ?? 0x05; // UP | UV
  ad[33] = (counter >>> 24) & 0xff;
  ad[34] = (counter >>> 16) & 0xff;
  ad[35] = (counter >>> 8) & 0xff;
  ad[36] = counter & 0xff;
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: opts.type ?? 'webauthn.get',
      challenge: webauthnChallenge(new TextEncoder().encode(messageId)),
      origin: opts.origin ?? `https://${cred.rpId}`,
      crossOrigin: false,
    }),
  );
  const signed = new Uint8Array(ad.length + 32);
  signed.set(ad, 0);
  signed.set(new Uint8Array(createHash('sha256').update(clientData).digest()), ad.length);
  const signer = opts.signWith ?? cred;
  const signature =
    signer.alg === 'webauthn-ed25519'
      ? Uint8Array.from(ed25519.sign(signed, signer.secret))
      : Uint8Array.from(p256.sign(signed, signer.secret, { format: 'der', prehash: true }));
  return b64(
    cborEncode({
      entries: [
        ['authenticator_data', ad],
        ['client_data_json', clientData],
        ['signature', signature],
      ],
    }),
  );
}
