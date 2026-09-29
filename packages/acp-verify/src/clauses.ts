/**
 * The refusal names, spelled EXACTLY as the engine's Rust clause constants
 * spell them (crates/acp-decision/src/{receipt,decide,quorum}.rs at the pin).
 *
 * This is the third implementation of receipt verification, and the clause a
 * refusal carries is what the three are compared ON: two verifiers that both
 * refuse a forged, expired receipt -- one saying 9.3-1, the other 9.3-5 --
 * have not been shown to agree on anything an operator could act on
 * (decide.rs module doc). So every name here is a wire contract, not a label,
 * and a constant may change only when the engine's does.
 *
 * The Rust constant NAME is kept beside each value so a reader diffing the two
 * files sees one table, not two vocabularies.
 */

/** Rust `receipt::CLAUSE_VERSION` -- AB-0, the receipt does not declare version 3. */
export const CLAUSE_VERSION = 'AB-0';
/** Rust `receipt::CLAUSE_BODY_SIZE` -- AB-6, the signed body exceeds the custody byte cap. */
export const CLAUSE_BODY_SIZE = 'AB-6';
/** Rust `receipt::CLAUSE_UNKNOWN_SUITE` -- CR-1, the suite name is not one this build knows. */
export const CLAUSE_UNKNOWN_SUITE = 'CR-1';
/** Rust `receipt::CLAUSE_SUITE_FLOOR` -- CR-4, the suite does not contain every floor primitive. */
export const CLAUSE_SUITE_FLOOR = 'CR-4';
/** Rust `receipt::CLAUSE_CANONICAL` -- AT-8a, the structure is not canonically encodable. */
export const CLAUSE_CANONICAL = 'AT-8a';
/** Rust `receipt::CLAUSE_SIGNATURE` -- 9.3-1, the signature did not verify under the bundle key. */
export const CLAUSE_SIGNATURE = '9.3-1';
/** Rust `receipt::CLAUSE_DECISION` -- 9.3-2, the decision was not ALLOW. */
export const CLAUSE_DECISION = '9.3-2';
/**
 * Rust `decide.rs` spells 9.3-3 as a literal at the refusal site, not a
 * constant; the value is the contract either way. Receipt not bound to this
 * proposal (B-1a).
 */
export const CLAUSE_PROPOSAL_BINDING = '9.3-3';
/** Rust literal in `decide.rs` step 5 -- temporal position (missing, malformed, expired, future). */
export const CLAUSE_TEMPORAL = '9.3-5';
/**
 * Rust literal in `decide.rs` step 5 -- L-14, the validity-window ceiling.
 * A SEPARATE clause from 9.3-5: a receipt whose window is 10x too long is an
 * attacker widening the interval a stolen receipt is usable in (Y2), and
 * calling that "expired" would tell an operator the wrong thing.
 */
export const CLAUSE_VALIDITY_WINDOW = 'L-14';
/** Rust `quorum::CLAUSE_WIRE_TYPE` -- WE-4, the nonce is not `b64:` + RFC 4648 s4 base64. */
export const CLAUSE_WIRE_TYPE = 'WE-4';
/**
 * Rust `decide::CLAUSE_RECEIPT_NONCE_SIZE` -- L-17, the receipt nonce is
 * well-formed but not 128-bit. The receipt nonce's OWN size clause, never
 * AT-1 (which sizes the attestation nonce): one number, two clauses, and the
 * refusal carries the field's (ACP-88/ACP-89).
 */
export const CLAUSE_RECEIPT_NONCE_SIZE = 'L-17';

// ------------------------------------------------------------------ step 7b
//
// The AT-* quorum and §8.6b's AB-*, spelled as `crates/acp-decision/src/quorum.rs`
// and `reference/src/acp_executor.py` spell them. Several are literals at the
// refusal site in Rust and named here; the VALUE is the contract either way, and
// the Rust constant name is kept beside each one so a reader diffing the two
// files sees one table rather than two vocabularies.

/** Rust `quorum::CLAUSE_NO_ATTESTATIONS` -- INV-1-HIGH, a receipt commits to
 * attestations and none arrived. */
export const CLAUSE_NO_ATTESTATIONS = 'INV-1-HIGH';
/** Rust `quorum::CLAUSE_NO_OBJECT` -- AT-8, an entry carrying no Attestation
 * Object (the pre-v1.3.3 form, where only the id travelled). */
export const CLAUSE_NO_OBJECT = 'AT-8';
/** Rust `quorum::CLAUSE_OBJECT_SCHEMA` -- AT-8b, the object's field set is not
 * exactly AT-1's. CLOSED: an unknown field is refused, a missing one never
 * defaulted (Z4). */
export const CLAUSE_OBJECT_SCHEMA = 'AT-8b';
/** Rust `quorum::CLAUSE_NONCE_SIZE` -- AT-1, `att_nonce` is well-formed but is
 * not 128-bit. The ATTESTATION nonce's own size clause, never L-17 (which sizes
 * the receipt's): one number, two clauses, and the refusal carries the field's. */
export const CLAUSE_ATT_NONCE_SIZE = 'AT-1';
/** Rust `quorum::CLAUSE_ATTESTATION_SUITE` -- CR-4. An UNKNOWN suite refuses
 * here under CR-4 and not CR-1, matching `Bundle.suite_ok`, which returns False
 * for a name it does not know; the receipt path spells the same condition CR-1
 * and the differential compares names, so the reference wins. */
export const CLAUSE_ATTESTATION_SUITE = 'CR-4';
/** Rust `quorum::CLAUSE_ATTESTER_SIG` -- §9.3 step 7b(i). */
export const CLAUSE_ATTESTER_SIG = '9.3-7b-i';
/** Rust `quorum::CLAUSE_BINDING` -- §9.3 step 7b(ii), the object binds a
 * DIFFERENT proposal. This is Y1: a genuine quorum raised for P1 attached to a
 * receipt for P2. */
export const CLAUSE_BINDING = '9.3-7b-ii';
/** Rust `quorum::CLAUSE_POLICY_BASIS` -- §9.3 step 7b(iii), policy basis or
 * object freshness. */
export const CLAUSE_POLICY_BASIS = '9.3-7b-iii';
/** Rust `quorum::CLAUSE_OPERATOR_DISAGREE` -- §9.3 step 7b(iii-a), the objects
 * disagree on who the operator is (Y4). */
export const CLAUSE_OPERATOR_DISAGREE = '9.3-7b-iii-a';
/** Rust `quorum::CLAUSE_CONSENT` -- AT-9's SECOND requirement: an attester
 * signed for a quorum other than the bundle's. A CONSENT check, not a threshold
 * one; deleting it cannot lower a quorum. */
export const CLAUSE_CONSENT = 'AT-9';
/** Rust `quorum::CLAUSE_DERIVED_ID` -- Y1b, a transmitted `attestation_id`
 * differing from the derived one. */
export const CLAUSE_DERIVED_ID = 'Y1b';
/** Rust `quorum::CLAUSE_MEMBERSHIP` -- AB-1, the entry digest binding: entry
 * schema, digest-list type, or membership. */
export const CLAUSE_MEMBERSHIP = 'AB-1';
/** Rust `quorum::CLAUSE_DIGEST_ORDER` -- AB-2, `attestation_digests` is not in
 * the one canonical ordering. */
export const CLAUSE_DIGEST_ORDER = 'AB-2';
/** Rust `quorum::CLAUSE_DIGEST_DUP` -- AB-3, a repeated digest. */
export const CLAUSE_DIGEST_DUP = 'AB-3';
/** Rust `quorum::CLAUSE_CARDINALITY` -- AB-4, entry count and signed digest
 * count disagree. Fewer is withholding, more is injection. */
export const CLAUSE_CARDINALITY = 'AB-4';
/** Rust `quorum::CLAUSE_ASSURANCE` -- AT-10, an identity enrolled below the
 * registry's assurance floor. */
export const CLAUSE_ASSURANCE = 'AT-10';
/** Rust `quorum::CLAUSE_QUORUM` -- AT-3, fewer distinct approvals than the
 * threshold recomputed from the bundle. */
export const CLAUSE_QUORUM = 'AT-3';
/** Rust `quorum::CLAUSE_OPERATOR_SELF` -- AT-2, the operator counted toward
 * their own quorum. */
export const CLAUSE_OPERATOR_SELF = 'AT-2';
/** Rust `quorum::CLAUSE_WEBAUTHN_ALG` -- HM-3. The object's declared `alg` and
 * the registry's disagree about what KIND of key this identity holds. Either
 * side alone decides nothing; the DISAGREEMENT is the refusal, raised before a
 * byte of the assertion is parsed. */
export const CLAUSE_WEBAUTHN_ALG = 'WebauthnAlgMismatch';
/** Rust `quorum::CLAUSE_WEBAUTHN_COUNTER` -- HM-4 (f). A regression is a CLONED
 * AUTHENTICATOR, not a retry. */
export const CLAUSE_WEBAUTHN_COUNTER = 'WebauthnCounter';
/** Rust `quorum::CLAUSE_MALFORMED` -- the entry's `sig`, the assertion or the
 * credential is not the shape §8.6c declares. Not a statement about a
 * signature. */
export const CLAUSE_MALFORMED = 'Malformed';
