/**
 * @ziffer-io/client — the TypeScript SDK for the public decision API (ACP-197 §6).
 *
 * Two halves, one boundary:
 *
 * - `ZifferClient` (./client.js) carries proposals out and decisions back.
 *   It computes no security value: the proposal goes as the caller wrote it,
 *   the receipt comes back as the gateway stored it (RES-8 — a compromised
 *   client writes the whole message, so nothing a client derives is
 *   evidence).
 * - `verifyReceipt` is RE-EXPORTED from `@ziffer-io/verify`, unchanged. The runbook
 *   rule this line implements: verification has ONE home, and the client
 *   adds none of its own — a second verifier behind a client-shaped API
 *   would be the two-definitions defect with a signature on it. The tests
 *   assert the re-export is the SAME function object, so this cannot decay
 *   into a copy silently.
 */

export {
  API_KEY_EXPIRES_HEADER,
  API_KEY_EXPIRY_WARNING_DAYS,
  ApiRefusal,
  ERROR_ADMISSION_UNAVAILABLE,
  ERROR_API_KEY_UNKNOWN,
  ERROR_DECISION_UNKNOWN,
  ERROR_FEEDBACK_MALFORMED,
  ERROR_FEEDBACK_RATE_LIMITED,
  ERROR_FEEDBACK_TOO_LARGE,
  ERROR_FEEDBACK_UNAVAILABLE,
  ERROR_LIST_QUERY_MALFORMED,
  ERROR_PROPOSAL_MALFORMED,
  ERROR_RATE_LIMITED,
  ERROR_TENANT_MISMATCH,
  ResponseMalformed,
  WaitTimeout,
  ZifferClient,
  type Decision,
  type DecisionListItem,
  type DecisionPage,
  type DecisionStatus,
  type RefusalCategory,
  type Feedback,
  type FeedbackStored,
  type FetchInit,
  type FetchLike,
  type Identity,
  type ListOptions,
  type ReceiptPresence,
  type RequestOptions,
  type WaitOptions,
  type WireProposal,
  type WireProposalPayload,
  type ZifferClientOptions,
} from './client.js';

// The retry surface a caller can act on: the error a deadline produces, the
// counters to read, and the two numbers a runbook would quote. The rules
// themselves (the policy, the jitter, the header parser) stay inside the
// package — they are the client's behaviour, not an API to call, and
// exporting them would invite a second retry loop built out of this one's
// parts, which is the thing `packages/mcp` is careful not to have.
export {
  DeadlineExceeded,
  REQUEST_TIMEOUT_MS,
  RETRY_BUCKET_CAPACITY,
  type RetryCounters,
} from './retry.js';

// The verify surface a receipt-holding caller needs, and ONLY that: the
// verifier itself, its refusal type, and the types its signature names.
// The rest of @ziffer-io/verify (canon, the strict Ed25519 predicate, suite
// algebra) stays importable from its own home — re-exporting internals here
// would hand this package an API surface it does not implement.
//
// The two readers belong to that surface (ACP-473, ACP-479): a caller cannot
// verify without a trust anchor, nor a held-and-approved receipt without its
// own attester registry, and a reader each caller writes for themselves is a
// transcription of key material per caller. Re-exported, the SAME functions.
export {
  AnchorError,
  Refusal,
  loadAttesterRegistry,
  loadTrustAnchor,
  verifyReceipt,
  type AttesterRegistry,
  type QuorumPolicy,
  type TrustAnchor,
  type Verified,
  type VerifyOptions,
} from '@ziffer-io/verify';
