/**
 * The CR-2 signature carrier and the CR-3 conjunctive verification, shared by
 * the receipt gate (`verify.ts`) and the attestation loop (`quorum.ts`).
 *
 * One home, for the reason `quorum.rs` gives when it calls
 * `crate::decide::parse_sig` rather than writing its own: the shape a signature
 * must have is the shape its SUITE requires, and a second parser is a second
 * answer to "which primitives satisfy this suite". The refusal each function
 * raises is the RECEIPT's clause (`9.3-1`); the quorum catches it and re-raises
 * under `9.3-7b-i`, exactly as the engine does, because a bad attester
 * signature and a bad receipt signature are different findings.
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { CLAUSE_SIGNATURE, CLAUSE_UNKNOWN_SUITE } from './clauses.js';
import { verifyEd25519Strict } from './ed25519.js';
import { Refusal } from './refusal.js';
import {
  parseSuite,
  suitePrimitives,
  verifyHybrid,
  type HybridError,
  type Primitive,
  type PrimitiveVerdict,
  type Suite,
} from './suite.js';

/** FIPS 204 ML-DSA-65 public key length. */
export const MLDSA65_PK_LEN = 1952;
/** FIPS 204 ML-DSA-65 signature length. */
export const MLDSA65_SIG_LEN = 3309;

/** Lowercase hex of a byte string. */
export function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Decode a hex signature leg, refusing exactly as `decide.rs`'s `unhex`. */
export function unhex(s: string): Uint8Array {
  if (s.length % 2 !== 0) {
    throw new Refusal(CLAUSE_SIGNATURE, 'signature hex has odd length');
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    const byte = Number.parseInt(s.slice(i, i + 2), 16);
    // parseInt would tolerate "0x", whitespace and a lone valid first digit;
    // requiring both chars to be hex keeps this as strict as Rust's
    // from_str_radix over a 2-char slice.
    if (Number.isNaN(byte) || !/^[0-9a-fA-F]{2}$/.test(s.slice(i, i + 2))) {
      throw new Refusal(CLAUSE_SIGNATURE, 'signature is not hex');
    }
    out[i / 2] = byte;
  }
  return out;
}

/** One primitive's signature as presented on the wire. */
export interface SignaturePart {
  readonly primitive: Primitive;
  readonly bytes: Uint8Array;
}

/**
 * Parse a wire `sig` object into the parts the CR-3 combiner verifies --
 * `decide.rs::parse_sig`, including its rule that the key set must be EXACTLY
 * the suite's. Three attacks live in the difference: a scalar `sig` (format
 * confusion is a downgrade in disguise), a missing primitive (the stripped
 * leg), and an extra undeclared primitive (an accepted code path the attacker
 * chose). An unknown primitive name is refused rather than dropped -- a dropped
 * part would let a suite be satisfied by the parts that remain.
 */
export function parseSig(sig: unknown, alg: string): SignaturePart[] {
  // CR-1 first: an unparseable suite has no primitive set at all, so asking
  // which primitives it requires would be a category error.
  const suite = parseSuite(alg);
  if (suite === null) {
    throw new Refusal(CLAUSE_UNKNOWN_SUITE, 'unknown signature suite');
  }
  if (typeof sig !== 'object' || sig === null || Array.isArray(sig)) {
    throw new Refusal(CLAUSE_SIGNATURE, 'signature is not a per-primitive object');
  }
  const map: Record<string, unknown> = { ...sig };
  const required = suitePrimitives(suite);
  const keys = Object.keys(map);
  if (keys.length !== required.length || !required.every((p) => keys.includes(p))) {
    throw new Refusal(
      CLAUSE_SIGNATURE,
      'signature primitives are not exactly those the declared suite requires',
    );
  }
  const parts: SignaturePart[] = [];
  for (const primitive of required) {
    const value = map[primitive];
    if (typeof value !== 'string') {
      throw new Refusal(CLAUSE_SIGNATURE, 'signature value is not a hex string');
    }
    parts.push({ primitive, bytes: unhex(value) });
  }
  return parts;
}

/**
 * Verify one ML-DSA-65 signature. Never throws; length checks first, exactly as
 * `primitives.rs` -- a malformed input is `invalid`, never `unsupported`: one is
 * a statement about the signature, the other about this build, and reporting one
 * as the other sends the investigation to the wrong place.
 */
export function verifyMlDsa65(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): PrimitiveVerdict {
  if (publicKey.length !== MLDSA65_PK_LEN || signature.length !== MLDSA65_SIG_LEN) {
    return 'invalid';
  }
  try {
    // Empty FIPS 204 context, matching both engine sides (MLDSA_CTX = &[]):
    // a context the signer did not use is a different message.
    return ml_dsa65.verify(signature, message, publicKey) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}

/** A hybrid identity's two public halves -- both, because CR-3 is conjunctive. */
export interface HybridPublicKey {
  readonly classical: Uint8Array;
  readonly pq: Uint8Array;
}

/**
 * CR-3 over a declared suite: every primitive the suite names must be present
 * and must verify. Returns null on success, the `HybridError` name on refusal.
 *
 * The suite is a PARAMETER, exactly as in Rust: a caller that decides how many
 * primitives a hybrid signature needs can be persuaded to decide "one".
 */
export function verifyUnderSuite(
  suite: Suite,
  key: HybridPublicKey,
  message: Uint8Array,
  parts: readonly SignaturePart[],
): HybridError | null {
  const verdicts: (readonly [Primitive, PrimitiveVerdict])[] = parts.map((part) => {
    switch (part.primitive) {
      case 'classical':
        return [
          part.primitive,
          verifyEd25519Strict(key.classical, message, part.bytes) ? 'valid' : 'invalid',
        ];
      case 'pq':
        return [part.primitive, verifyMlDsa65(key.pq, message, part.bytes)];
      case 'pq-slh':
        // Declared, not implemented. Never a pass, and never silently dropped
        // from the set either -- dropping it would let a suite naming it be
        // satisfied by the primitives that remain.
        return [part.primitive, 'unsupported'];
    }
  });
  return verifyHybrid(suite, verdicts);
}
