/**
 * The §9.3 stateless receipt gate -- the THIRD implementation, after the
 * Python reference (`acp_executor.py`) and Rust (`crates/acp-decision`), both
 * at the engine pin. Composed in the order `decide.rs` states, because on an
 * input carrying more than one defect the ORDER decides which clause fires,
 * and the clause is what a refusal tells an operator.
 *
 * # What is here, and what is NOT -- read this before trusting a green run
 *
 * This function covers exactly the checklist portion runnable with only
 * receipt + proposal + identity (the ACP-197 runbook's stateless set):
 *
 * | step | rule | here |
 * | --- | --- | --- |
 * | -- | AB-0 receipt version, AB-5 signed-body exclusion, AB-6 byte cap | yes |
 * | 1-2 | CR-1 / CR-4 / CR-3 conjunctive, then `decision` | yes |
 * | 3 | `proposal_hash` recomputed from the caller's own bytes (B-1a) | yes |
 * | 4 | policy basis (bundle hash, epoch) | NO -- needs the verifier's bundle |
 * | 5 | temporal position (9.3-5) and the L-14 window ceiling | yes |
 * | 6 | nonce WE-4 type and L-17 size | yes; the CL-2 single-use CLAIM is ledger state |
 * | 7 | TR-8 / RV-3 recomputation | NO -- needs the signed policy |
 * | 7b | the AT-* quorum, AB-1..AB-4 | YES, when the anchor carries a `quorum` policy |
 * | 8 | tenant scoping | NO -- needs the bundle's tenant |
 * | 9-10 | capability recheck, delivery identity | NO -- absent in the engine too |
 *
 * An absent step is a DIVERGENCE, not an agreement: a receipt this function
 * passes may still be refused by a full Executor at any absent step. A pass
 * here means "the stateless set found nothing", never "the receipt may be
 * consumed".
 *
 * # Step 7b, and the one thing it still cannot answer (ACP-406 gap 1)
 *
 * Step 7b runs here when {@link TrustAnchor.quorum} is supplied from the
 * caller's own signed bundle -- see `quorum.ts` for the full checklist and its
 * R/B/T table. Two consequences belong in this header rather than only there:
 *
 * - A receipt that CARRIES attestations while the anchor carries no quorum
 *   policy is **refused** (`AB-1`), not passed. A verifier that cannot
 *   recompute an entry digest has no binding at all, and passing would be the
 *   permissive default this package exists to refuse.
 * - **This function still cannot tell that a quorum was REQUIRED.** That is
 *   step 7's recomputed floor-only risk, which needs the bundle's grading rules
 *   and is not here. A receipt carrying no attestations passes 7b vacuously and
 *   {@link Verified.quorum} is `null`, which the caller can read; taking the
 *   answer from the receipt's own `risk_level_floor_only` instead would be X1,
 *   the defect where a compromised issuer asserting `LOW` suppressed
 *   attestation entirely.
 *
 * # R / B / T classification (suite 12) for the inputs this module reads
 *
 * | input | class | why |
 * | --- | :---: | --- |
 * | `identity` (keys, floor) | R | the verifier's own configuration, never the message's |
 * | signed bytes | R | canonicalised HERE from the receipt body (RES-9) |
 * | `proposal_hash` | R | recomputed from `proposalBytes`, the caller's own copy; the receipt's field is compared, never used |
 * | `alg`, `sig`, `decision`, temporal fields, `nonce`, `receipt_version` | B | inside (or selecting) the signed body; each is read only in a position where reading it can at most cause a refusal |
 * | `nowUnixSeconds` | T | the caller's clock. Nothing here can check it; a stale or forward value silently voids the expiry and skew checks (the engine's residual 3, verbatim). Only L-14 survives such a caller, because it compares the receipt's two instants against each other |
 */

import { createHash } from 'node:crypto';

import { canon } from './canon.js';
import {
  CLAUSE_BODY_SIZE,
  CLAUSE_MEMBERSHIP,
  CLAUSE_CANONICAL,
  CLAUSE_DECISION,
  CLAUSE_PROPOSAL_BINDING,
  CLAUSE_RECEIPT_NONCE_SIZE,
  CLAUSE_SIGNATURE,
  CLAUSE_SUITE_FLOOR,
  CLAUSE_TEMPORAL,
  CLAUSE_UNKNOWN_SUITE,
  CLAUSE_VALIDITY_WINDOW,
  CLAUSE_VERSION,
  CLAUSE_WIRE_TYPE,
} from './clauses.js';
import { parseInstant } from './instant.js';
import {
  verifyQuorum,
  type QuorumOutcome,
  type QuorumPolicy,
} from './quorum.js';
import { Refusal } from './refusal.js';
import { hex, parseSig, verifyUnderSuite, type SignaturePart } from './sig.js';
import { parseSuite, satisfiesFloor, type Suite } from './suite.js';
import { isRecord, isWe4B64, NONCE128_BYTES, NONCE128_LEN, strField } from './wire.js';

// WE-4 and the nonce sizes moved to `wire.ts` so `quorum.ts` can apply the one
// definition to `att_nonce`; re-exported here because they were this module's
// published surface first and a move is not a removal.
export { isWe4B64, NONCE128_BYTES, NONCE128_LEN } from './wire.js';
export { MLDSA65_PK_LEN, MLDSA65_SIG_LEN } from './sig.js';

/** AB-0 (§8.6b): version 3, the digest-bound form, and NO other. A verifier
 * accepting both 2 and 3 lets an attacker present the weaker one -- the CR-4
 * downgrade shape with the format negotiated by the party under verification. */
export const RECEIPT_VERSION = 3;

/** AB-5: the signed body is the transport object MINUS these keys. ONE list --
 * a second exclusion site would be a second definition of "the signed body". */
export const SIGNED_EXCLUDE: readonly string[] = ['sig', 'attestations'];

/** AB-6: the KMS RAW cap; a bigger body could only come from a software key,
 * so accepting one admits a custody downgrade silently. Counted in BYTES. */
export const RECEIPT_MAX_SIGNED_BYTES = 4096;

/** Step 5's tolerated clock skew, seconds -- the reference's `iat > now + 5`. */
export const CLOCK_SKEW_SECS = 5;

/** L-14's ceiling on a receipt's validity window, seconds. */
export const MAX_VALIDITY_WINDOW_SECS = 120;

/**
 * The verifier's own trust anchor: the receipt signing keys from the SIGNED
 * bundle (`receipt_identity`, PB-12) and the bundle's suite floor
 * (`manifest.min_suite`, CR-4).
 *
 * Both key halves, because hybrid composition is conjunctive (CR-3): a
 * verifier holding only the classical key could not tell a stripped
 * post-quantum leg from a suite that never had one. Every field is the
 * VERIFIER's configuration -- reading any of it from the receipt would be
 * RES-8, the five-times-recurred defect class this protocol exists to close.
 */
export interface TrustAnchor {
  /** Ed25519 verification key, 32 raw bytes. */
  readonly classical: Uint8Array;
  /** ML-DSA-65 verification key, 1,952 raw bytes. */
  readonly pq: Uint8Array;
  /** CR-4 floor, by wire suite name, from the signed manifest. */
  readonly minSuite: string;
  /**
   * §9.3 step 7b's policy: the attester registry, `quorum_k`, the assurance
   * floor and the bundle basis, all from the SAME signed bundle (ACP-406).
   *
   * Optional because a caller that never receives a floor-HIGH receipt has no
   * registry to hand over -- NOT because 7b is optional. A receipt that carries
   * attestations while this is absent is REFUSED under `AB-1`: a verifier that
   * cannot recompute an entry digest has no binding at all, and passing it
   * would be the permissive-by-omission default this package exists to refuse.
   */
  readonly quorum?: QuorumPolicy;
}

/** What the stateless set concluded, when it concluded anything. */
export interface Verified {
  /** This verifier's OWN canonical hash of the proposal -- the value the
   * receipt's claim was compared against, never the claim itself (R). */
  readonly proposalHash: string;
  /** The receipt's `expires_at` as step 5 validated it, epoch seconds (B). */
  readonly receiptExpiresAt: number;
  /**
   * What step 7b concluded, or `null` when the receipt carried no attestations
   * and committed to none.
   *
   * `null` means NOTHING WAS VERIFIED, never "a quorum held": this package
   * cannot recompute the floor-only risk, so it cannot know that a quorum was
   * required. A caller that knows the action is floor-HIGH must assert on this
   * field; the module header says why the answer is not taken from the
   * receipt's own risk claim.
   */
  readonly quorum: QuorumOutcome | null;
}

/** Options for {@link verifyReceipt}. */
export interface VerifyOptions {
  /**
   * The verifier's clock, epoch seconds. Defaults to this process's
   * `Date.now()`. A parameter for the reason `decide()` makes it one --
   * a verifier taking its notion of the present from the party it verifies
   * would be RES-8 with a clock -- and classified T either way (residual 3).
   */
  readonly nowUnixSeconds?: number;
}

/**
 * The §9.3 gate steps 1-2 with CR-1/CR-4/CR-3 -- `receipt.rs::verify_receipt`.
 *
 * CR-4 runs BEFORE the signature: the floor exists to rule out PRIMITIVES,
 * not forgeries, and `CR-4` says the deployment's policy was not met, which is
 * a different fact from "this signature is bad". Step 2 (`decision`) is LAST
 * among the cryptographic checks: a receipt whose signature does not verify is
 * not evidence of anything, including of its own decision field.
 */
function verifyReceiptGate(
  alg: string,
  floor: Suite,
  identity: TrustAnchor,
  signedBytes: Uint8Array,
  parts: readonly SignaturePart[],
  decision: string,
): void {
  const suite = parseSuite(alg);
  if (suite === null) {
    throw new Refusal(CLAUSE_UNKNOWN_SUITE, 'unknown signature suite');
  }
  if (!satisfiesFloor(suite, floor)) {
    throw new Refusal(
      CLAUSE_SUITE_FLOOR,
      'signature suite does not contain every primitive of the bundle floor',
    );
  }
  const err = verifyUnderSuite(suite, identity, signedBytes, parts);
  if (err !== null) {
    throw new Refusal(CLAUSE_SIGNATURE, err);
  }
  if (decision !== 'ALLOW') {
    throw new Refusal(CLAUSE_DECISION, 'decision is not ALLOW');
  }
}

/**
 * Run the stateless half of §9.3 in specification order over one receipt.
 *
 * @param receiptJson  the receipt as parsed JSON (`unknown`: this module does
 *                     its own narrowing and refuses by name, never casts).
 * @param proposalBytes the Proposal THE CALLER received, as bytes. The hash is
 *                     recomputed from these -- a transmitted identifier is a
 *                     name for a binding, not evidence of one (RES-9/TR-10).
 * @param identity     the verifier's trust anchor (keys + floor), out-of-band.
 * @throws Refusal     with `clause` spelled exactly as the engine's constants.
 */
export function verifyReceipt(
  receiptJson: unknown,
  proposalBytes: Uint8Array,
  identity: TrustAnchor,
  opts?: VerifyOptions,
): Verified {
  const floor = parseSuite(identity.minSuite);
  if (floor === null) {
    // The anchor is the verifier's own configuration; an unknown floor is a
    // misconfiguration, refused under CR-1's name rather than defaulted --
    // there is no default suite for the reason there is no default tenant.
    throw new Refusal(CLAUSE_UNKNOWN_SUITE, 'trust anchor names an unknown suite floor');
  }
  const now = opts?.nowUnixSeconds ?? Date.now() / 1000;

  // ------------------------------------------------------------- AB-0
  // Version 3 ONLY, checked before the signature so a version-2 receipt is
  // named as a version failure rather than a confusing signature mismatch.
  // On a non-object input the version read yields undefined and AB-0 fires
  // first, matching Rust's `.get()` on a non-object Value.
  const version = isRecord(receiptJson) ? receiptJson['receipt_version'] : undefined;
  if (version !== RECEIPT_VERSION) {
    throw new Refusal(
      CLAUSE_VERSION,
      `receipt_version ${JSON.stringify(version)} is not ${RECEIPT_VERSION}`,
    );
  }
  if (!isRecord(receiptJson)) {
    // Unreachable after AB-0 (a non-object has no version), kept for shape
    // parity with decide.rs, whose body build carries the same guard.
    throw new Refusal(CLAUSE_SIGNATURE, 'receipt is not an object');
  }

  // ---------------------------------------------------------- steps 1-2
  // AB-5: the body is the transport object minus SIGNED_EXCLUDE -- `sig`, and
  // `attestations`, the beside-channel the receipt commits to by digest.
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(receiptJson)) {
    if (!SIGNED_EXCLUDE.includes(k)) body[k] = v;
  }
  const signedBytes = canon(body);

  // AB-6 on the canonical bytes, before suite and signature: an oversized
  // body is refused on its face.
  if (signedBytes.length > RECEIPT_MAX_SIGNED_BYTES) {
    throw new Refusal(
      CLAUSE_BODY_SIZE,
      `signed body is ${signedBytes.length} bytes, over the ${RECEIPT_MAX_SIGNED_BYTES}-byte custody limit`,
    );
  }

  const alg = strField(receiptJson, 'alg');
  if (alg === null) {
    throw new Refusal(CLAUSE_UNKNOWN_SUITE, 'receipt declares no suite');
  }
  const parts = parseSig(receiptJson['sig'], alg);
  verifyReceiptGate(alg, floor, identity, signedBytes, parts, strField(receiptJson, 'decision') ?? '');

  // ------------------------------------------------------------ step 3
  // B-1a: hash the Proposal WE received. The receipt's field is compared,
  // never used. The bytes are parsed and re-canonicalised because the hash is
  // defined over the canonical encoding (`h(canon(proposal))`), not over
  // whatever spacing the transport used.
  let proposalValue: unknown;
  try {
    proposalValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(proposalBytes));
  } catch {
    throw new Refusal(CLAUSE_CANONICAL, 'proposal bytes are not UTF-8 JSON');
  }
  const proposalHash = `sha256:${hex(createHash('sha256').update(canon(proposalValue)).digest())}`;
  if (strField(receiptJson, 'proposal_hash') !== proposalHash) {
    throw new Refusal(CLAUSE_PROPOSAL_BINDING, 'receipt not bound to this proposal');
  }

  // Step 4 (policy basis: bundle hash + epoch) is NOT here -- it needs the
  // verifier's own bundle, which this stateless API deliberately does not
  // take. See the module doc's table; absence is disclosed, never approximated.

  // ------------------------------------------------------------ step 5
  // RFC 3339, PARSED, not a POSIX number (ACP-167): the one WE-5 parser in
  // instant.ts, never a second grammar.
  const iatRaw = strField(receiptJson, 'issued_at');
  const expRaw = strField(receiptJson, 'expires_at');
  if (iatRaw === null || expRaw === null) {
    throw new Refusal(CLAUSE_TEMPORAL, 'missing temporal fields', 'ReceiptTimeUnreadable');
  }
  const iat = parseInstant(iatRaw);
  const exp = parseInstant(expRaw);
  if (iat === null || exp === null) {
    throw new Refusal(CLAUSE_TEMPORAL, 'temporal field is not an RFC 3339 UTC instant', 'ReceiptTimeUnreadable');
  }
  if (now > exp) {
    throw new Refusal(CLAUSE_TEMPORAL, 'receipt expired', 'ReceiptExpired');
  }
  if (iat > now + CLOCK_SKEW_SECS) {
    throw new Refusal(CLAUSE_TEMPORAL, 'issued in the future beyond skew', 'ReceiptIssuedInFuture');
  }
  // L-14 is a SEPARATE clause: a legal-today window 10x too long is Y2 (the
  // widened theft interval), not "expired", and the clause must say so.
  if (exp - iat > MAX_VALIDITY_WINDOW_SECS) {
    throw new Refusal(
      CLAUSE_VALIDITY_WINDOW,
      `validity window ${exp - iat}s exceeds ${MAX_VALIDITY_WINDOW_SECS}s`,
    );
  }

  // ------------------------------------------------------------ step 6
  // The nonce's TYPE and SIZE, in the reference's order -- WE-4 then L-17 --
  // so a value wrong in both ways stops at the same name in all three
  // implementations. The CL-2 single-use CLAIM is ledger state and is not
  // here; what is refused here is a value the ledger must never be handed.
  const nonce = strField(receiptJson, 'nonce') ?? '';
  if (!isWe4B64(nonce)) {
    throw new Refusal(
      CLAUSE_WIRE_TYPE,
      `receipt nonce ${JSON.stringify(receiptJson['nonce'])} is not b64: + RFC 4648 sec 4 base64 with padding`,
    );
  }
  if (nonce.length !== NONCE128_LEN) {
    throw new Refusal(
      CLAUSE_RECEIPT_NONCE_SIZE,
      `receipt nonce is not ${NONCE128_BYTES * 8}-bit`,
    );
  }

  // ----------------------------------------------------------- step 7b
  // The AT-* quorum and §8.6b's AB-*, LAST, because every value it is checked
  // against was established above: `proposalHash` at step 3 and `iat` at step
  // 5. Steps 7 (grading) and 8 (tenant) are still absent -- see the module
  // doc's table -- so `floor_only_risk` is the one 7b(iii) comparison this
  // package cannot make, and `quorum.ts` says so rather than approximating it.
  const entries = receiptJson['attestations'];
  const digests = receiptJson['attestation_digests'];
  const carriesQuorum =
    (Array.isArray(entries) && entries.length > 0) ||
    (Array.isArray(digests) && digests.length > 0) ||
    (entries !== undefined && !Array.isArray(entries)) ||
    (digests !== undefined && !Array.isArray(digests));
  if (identity.quorum === undefined) {
    if (carriesQuorum) {
      // FAIL CLOSED. A verifier with no registry cannot recompute an entry
      // digest, so it has no binding to the attestations at all; passing here
      // would be exactly the permissive-by-omission default RES-8 keeps
      // producing. AB-1 is the clause because it is the obligation that cannot
      // be discharged.
      throw new Refusal(
        CLAUSE_MEMBERSHIP,
        'the receipt carries attestations and this trust anchor names no attester registry: step 7b cannot be discharged',
      );
    }
    return { proposalHash, receiptExpiresAt: exp, quorum: null };
  }
  const quorum = verifyQuorum(
    identity.quorum,
    { proposalHash, receiptIssuedAt: iat, floor },
    entries,
    digests,
  );

  return { proposalHash, receiptExpiresAt: exp, quorum };
}
