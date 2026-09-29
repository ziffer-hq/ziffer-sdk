/**
 * The signature suite table (CR-1, CR-4) and the conjunctive combiner (CR-3),
 * mirroring `crates/acp-crypto/src/suite.rs` and `lib.rs::verify_hybrid` at
 * the pin. Third writing of one table; the mirrored vectors and the shared
 * clause names are what keep the three honest.
 *
 * `pq-slh` (SLH-DSA, FIPS 205) is DECLARED AND NOT IMPLEMENTED, with its own
 * primitive name. Aliasing it to `pq` would mean a receipt claiming suite
 * `slhdsa128s` was verified against an ML-DSA key -- the label naming one
 * algorithm and the bytes another. It fails closed as `unsupported`.
 */

/** One cryptographic primitive within a suite, by its wire name (CR-2 keys). */
export type Primitive = 'classical' | 'pq' | 'pq-slh';

/** A named signature suite, by its wire name. */
export type Suite = 'ed25519' | 'hybrid-ed25519-mldsa65' | 'slhdsa128s';

/**
 * Every primitive a suite requires. Verification is conjunctive over ALL of
 * them (CR-3). Mirrors the Rust `Suite::primitives` and the reference's
 * `SUITES` table.
 */
const SUITES: Readonly<Record<Suite, readonly Primitive[]>> = {
  ed25519: ['classical'],
  'hybrid-ed25519-mldsa65': ['classical', 'pq'],
  slhdsa128s: ['pq-slh'],
};

/**
 * Parse a wire suite name. Unknown names are null and MUST be refused by the
 * caller, never defaulted to a known suite (CR-1).
 */
export function parseSuite(name: string): Suite | null {
  // A switch, so the narrowing is the compiler's and not a cast's (the
  // project rules forbid `as`, and here the cast would be load-bearing).
  switch (name) {
    case 'ed25519':
    case 'hybrid-ed25519-mldsa65':
    case 'slhdsa128s':
      return name;
    default:
      return null;
  }
}

/** The primitives a parsed suite requires, in the table's order. */
export function suitePrimitives(suite: Suite): readonly Primitive[] {
  return SUITES[suite];
}

/**
 * CR-4: whether `suite` satisfies a signed floor.
 *
 * CONTAINMENT, NOT RANK -- the engine's published correction. Under a rank
 * table `hybrid-ed25519-mldsa65` outranked `slhdsa128s` while containing none
 * of its primitives: a deployment whose floor said "hash-based post-quantum,
 * no lattice assumption" was served a lattice signature and told its floor was
 * met. The floor is satisfied iff every primitive it names is present.
 */
export function satisfiesFloor(suite: Suite, floor: Suite): boolean {
  return SUITES[floor].every((needed) => SUITES[suite].includes(needed));
}

/** Outcome of verifying one primitive within a declared suite. */
export type PrimitiveVerdict = 'valid' | 'invalid' | 'unsupported';

/** Why the conjunctive combiner refused; the Rust `HybridError` variants. */
export type HybridError = 'PrimitiveInvalid' | 'PrimitiveUnsupported' | 'SuiteMismatch';

/**
 * CR-3 -- verification is conjunctive over the DECLARED suite: the primitives
 * presented must be exactly those the suite requires, and every one must
 * verify. An `any`-shaped check lets an attacker strip the post-quantum leg,
 * present a genuine classical one, and be accepted -- the downgrade the hybrid
 * suite exists to prevent.
 *
 * The suite is a PARAMETER, exactly as in Rust: a caller that decides how many
 * primitives a hybrid signature needs can be persuaded to decide "one".
 * Completeness compares as multisets, so a primitive presented twice cannot
 * stand in for one not presented at all. `unsupported` is reported before
 * `invalid` -- the first is a statement about this BUILD, the second about the
 * signature, and reporting one as the other sends the investigation to the
 * wrong place.
 *
 * Returns null on success, the error name on refusal (the caller wraps it in
 * a 9.3-1 Refusal; this layer is protocol logic, not the checklist).
 */
export function verifyHybrid(
  suite: Suite,
  verdicts: readonly (readonly [Primitive, PrimitiveVerdict])[],
): HybridError | null {
  const presented = verdicts.map(([p]) => p).sort();
  const required = [...SUITES[suite]].sort();
  if (
    presented.length !== required.length ||
    !presented.every((p, i) => p === required[i])
  ) {
    return 'SuiteMismatch';
  }
  if (verdicts.some(([, v]) => v === 'unsupported')) return 'PrimitiveUnsupported';
  if (verdicts.some(([, v]) => v === 'invalid')) return 'PrimitiveInvalid';
  return null;
}
