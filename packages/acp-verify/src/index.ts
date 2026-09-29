/**
 * @ziffer-io/verify -- the third receipt-verifier implementation (ACP-197 §5).
 *
 * `verifyReceipt` is the API for a receipt and `verifyChain` for an exported
 * audit chain (ACP-428); everything else is exported so the pieces are
 * individually testable and so `@ziffer-io/client` can re-export ONE verify (the
 * client adds no verification logic of its own -- one home per rule).
 */

export { canon, compareCodePoints, type Json } from './canon.js';
// The two readers of the verifier's own configuration files (ACP-473, ACP-479):
// the `ziffer pubkey` document and the policy folder's attester registry. They
// refuse under AnchorError with a name, never a Refusal: a file that will not
// load is a configuration defect, not a verdict about a receipt.
export { AnchorError, loadTrustAnchor } from './anchor.js';
export {
  HUMAN_ASSURANCE_ABSENT,
  QUORUM_INVALID,
  REGISTRY_KEYS_NOT_DISTINCT,
  REGISTRY_UNREADABLE,
  loadAttesterRegistry,
  parseAttesterRegistry,
  type AttesterRegistry,
} from './registry.js';
export {
  ANCHOR_SUITE,
  AnchorKeyRefusal,
  ChainRefusal,
  chainVerdict,
  parseAnchorKey,
  verifyChain,
  type AnchorKey,
  type AnchorResult,
  type ChainVerdict,
  type ChainVerified,
} from './chain.js';
export {
  CborError,
  cborAsBytes,
  cborEncode,
  cborGetInt,
  cborGetText,
  cborIsMap,
  cborKeys,
  decodeCanonical,
  type Cbor,
  type CborMap,
} from './cbor.js';
export {
  CLAUSE_ASSURANCE,
  CLAUSE_ATTESTATION_SUITE,
  CLAUSE_ATTESTER_SIG,
  CLAUSE_ATT_NONCE_SIZE,
  CLAUSE_BINDING,
  CLAUSE_CARDINALITY,
  CLAUSE_CONSENT,
  CLAUSE_DERIVED_ID,
  CLAUSE_DIGEST_DUP,
  CLAUSE_DIGEST_ORDER,
  CLAUSE_MALFORMED,
  CLAUSE_MEMBERSHIP,
  CLAUSE_NO_ATTESTATIONS,
  CLAUSE_NO_OBJECT,
  CLAUSE_OBJECT_SCHEMA,
  CLAUSE_OPERATOR_DISAGREE,
  CLAUSE_OPERATOR_SELF,
  CLAUSE_POLICY_BASIS,
  CLAUSE_QUORUM,
  CLAUSE_WEBAUTHN_ALG,
  CLAUSE_WEBAUTHN_COUNTER,
} from './clauses.js';
export {
  AT1_FIELDS,
  attestationId,
  entryDigest,
  verifyQuorum,
  type AttesterCredential,
  type DecisionBasis,
  type HybridAttester,
  type QuorumOutcome,
  type QuorumPolicy,
  type WebauthnAttester,
} from './quorum.js';
export {
  ASSERTION_FIELDS,
  MALFORMED,
  REGISTRY_KEY_WEAK,
  WEBAUTHN_ALGS,
  WEBAUTHN_AUTHENTICATOR_DATA,
  WEBAUTHN_CHALLENGE,
  WEBAUTHN_ORIGIN,
  WEBAUTHN_PRIMITIVE,
  WEBAUTHN_SIGNATURE,
  WEBAUTHN_TYPE,
  WebauthnRefusal,
  coseKeyParse,
  decodeAssertion,
  verifyWebauthn,
  webauthnChallenge,
  type Assertion,
  type CredentialKey,
} from './webauthn.js';
export { b64Decode } from './wire.js';
export {
  CLAUSE_BODY_SIZE,
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
export {
  ED25519_PK_LEN,
  ED25519_SIG_LEN,
  ed25519IsSmallOrder,
  verifyEd25519Strict,
} from './ed25519.js';
export { parseInstant } from './instant.js';
export {
  REFUSALS,
  Refusal,
  UNNAMED_REFUSAL,
  isRefusalName,
  refusalLine,
  refusalText,
  refusalsForClause,
  type RefusalEntry,
  type RefusalName,
  type RefusalText,
} from './refusal.js';
export {
  parseSuite,
  satisfiesFloor,
  suitePrimitives,
  verifyHybrid,
  type HybridError,
  type Primitive,
  type PrimitiveVerdict,
  type Suite,
} from './suite.js';
export {
  CLOCK_SKEW_SECS,
  MAX_VALIDITY_WINDOW_SECS,
  MLDSA65_PK_LEN,
  MLDSA65_SIG_LEN,
  NONCE128_BYTES,
  NONCE128_LEN,
  RECEIPT_MAX_SIGNED_BYTES,
  RECEIPT_VERSION,
  SIGNED_EXCLUDE,
  isWe4B64,
  verifyReceipt,
  type TrustAnchor,
  type Verified,
  type VerifyOptions,
} from './verify.js';
