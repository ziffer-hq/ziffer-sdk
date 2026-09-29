/**
 * Strict Ed25519 -- the small-order rule WRITTEN OUT (ACP-106), the third
 * spelling of the one rule the engine keeps in two places: Rust calls
 * `ed25519-dalek`'s `verify_strict`; the Python reference writes the guard out
 * in `acp_crypto.verify_prim` because `cryptography` has no strict mode. The
 * three MUST stay one rule -- a guard on one side only converts a closed
 * defect into a divergence -- and `fixtures/refused_ed25519.json` (mirrored
 * byte-identically from the engine) is the executable statement of it: every
 * vector there is accepted by RFC 8032 as OpenSSL implements it and must be
 * refused here.
 *
 * WHY. Under a small-order public key A the verification equation
 * `[s]B == R + [k]A` loses its A term -- for the identity point `[k]A` is the
 * identity whatever k is -- so what remains, `[s]B == R`, does not mention the
 * message at all, and ONE signature verifies for EVERY message under that key.
 * A small-order R is the same fail-open reached from the signature side: an
 * honest signer can emit r=0 and a non-strict verifier accepts it over a
 * message it never committed to. Both halves are refused, as in `verify_prim`.
 *
 * @noble/curves' `verify` with `{ zip215: false }` gives RFC 8032 cofactored
 * verification with canonical encodings enforced, but -- like OpenSSL -- it
 * does NOT refuse small-order points: those are perfectly canonical. So the
 * guard is written out here, before the equation, exactly as in Python.
 */

import { ed25519 } from '@noble/curves/ed25519.js';

/** RFC 8032 raw public key length. */
export const ED25519_PK_LEN = 32;
/** RFC 8032 signature length. */
export const ED25519_SIG_LEN = 64;

/**
 * Whether an encoded point has order dividing 8 -- dalek's `is_weak`, the
 * predicate `verify_strict` applies before it checks the equation. Computed on
 * the curve (`[8]P == identity` via the library's own point arithmetic), never
 * from a table of the eight encodings: a hardcoded blacklist is a second
 * definition of "small order" that nothing can check against the curve.
 *
 * Bytes that do not decode as a point are `false`, not `true`: "not a key" is
 * refused by the verifier itself a line later, and a guard that answered
 * "weak" about bytes that are not a point would make its own failure mode
 * unreadable (the engine states this rule on both sides).
 */
export function ed25519IsSmallOrder(encoded: Uint8Array): boolean {
  if (encoded.length !== ED25519_PK_LEN) return false;
  try {
    return ed25519.Point.fromBytes(encoded).isSmallOrder();
  } catch {
    return false;
  }
}

/**
 * Verify one Ed25519 signature under the strict rule.
 *
 * Never throws: a malformed signature is a verification FAILURE, not an
 * exception for a caller further up to catch -- a throw would travel a
 * different path from a `false`, and the two must be indistinguishable to the
 * fail-closed contract (`verify_prim`'s own words).
 */
export function verifyEd25519Strict(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (publicKey.length !== ED25519_PK_LEN || signature.length !== ED25519_SIG_LEN) {
    return false;
  }
  // ACP-106, both halves, BEFORE the equation: a small-order A makes one
  // signature verify for every message; a small-order R (the first 32 bytes
  // of the signature) lets an r=0 signature verify over a message the signer
  // never committed to.
  if (ed25519IsSmallOrder(publicKey) || ed25519IsSmallOrder(signature.subarray(0, 32))) {
    return false;
  }
  try {
    // zip215: false -- canonical point and scalar encodings enforced, matching
    // dalek's strict decoding; the small-order refusals above are the part no
    // library default provides.
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}
