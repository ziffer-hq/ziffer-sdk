/**
 * The TypeScript client for the public decision API (ACP-197 §1) — the
 * sibling of the Python SDK's `Client`, speaking the same two routes:
 *
 *   POST /v1/proposals            submit one wire Proposal
 *   GET  /v1/decisions/{id}       poll a decision; the ONE place receipts are served
 *
 * One rule, carried over from the scaffold this file replaced: this client
 * may never compute or assert a security value on the control plane's
 * behalf. It carries a proposal; it does not carry a risk grade, a
 * reversibility claim, or an authorisation decision. Every one of those is
 * recomputed by the Executor from the signed bundle (RES-8), because a
 * compromised client writes the whole message. The same rule points the
 * other way too: the client sends the caller's proposal EXACTLY as given —
 * no defaulting, no rewriting, no "helpful" normalisation — because the
 * proposal is signed material downstream and a client that edits it has
 * become its author (the §1 gateway refuses a tenant rewrite for the same
 * reason).
 *
 * # R / B / T for what this module handles
 *
 * - `decision_id` is a LOCATOR, classified T (§1). Nothing about it is
 *   evidence. The binding claim — "this receipt is about my proposal" — is
 *   verified by `verifyReceipt` recomputing `proposal_hash` from the
 *   caller's own bytes; the id only tells the client which row to fetch.
 * - `receipt` is served verbatim by the gateway (parse-free passthrough).
 *   This client necessarily parses the enclosing JSON response, so what it
 *   hands back is the parsed VALUE, unmodified — and `verifyReceipt`
 *   canonicalises the body itself, so a parsed value loses nothing the
 *   verifier needs. The client never inspects, normalises or re-encodes it.
 * - Verification has ONE home: `@ziffer-io/verify`, re-exported from this
 *   package's index. Zero verification logic lives here (ACP-197 §6).
 *
 * # Failure surface — named, never silent
 *
 * - A gateway refusal (`{"error": name}` with a non-2xx status) throws
 *   {@link ApiRefusal} carrying the name VERBATIM. The set of names is the
 *   gateway's and is open; this client closes nothing, because a client
 *   that filtered names would turn a new server refusal into a silent one.
 * - An answer that is not §1's shape throws {@link ResponseMalformed}. Fail
 *   closed: a client guessing at a malformed answer is a client inventing a
 *   decision status.
 * - A poll that outlives its deadline throws {@link WaitTimeout}. A timeout
 *   is "no answer yet", never "the answer was no" (ingress-low's rule for
 *   its own dependency, one layer out).
 * - A call that was still retrying when the caller's deadline arrived throws
 *   {@link DeadlineExceeded}, carrying the last failure's name and status.
 *   Inside {@link ZifferClient.wait} it is caught and re-thrown as
 *   {@link WaitTimeout} with that `DeadlineExceeded` as its `cause`: `wait`
 *   has ONE name for "no answer yet" and a caller already catches it.
 *
 * # Timeouts and retries
 *
 * Every round trip carries an abort signal set to {@link REQUEST_TIMEOUT_MS}.
 * **That timeout covers ONE ROUND TRIP** — the send and the reading of the
 * answer's body — and is not a budget for the call: a call that retries may
 * take several times as long and is not wrong for doing so. Waiting for a
 * human to approve is not a round trip at all; that is {@link
 * ZifferClient.wait}, which polls, and each poll is its own round trip under
 * its own timeout.
 *
 * There is ONE request path and the retry loop is inside it, so `propose`,
 * `decision` and every poll of `wait` retry under exactly the same rules
 * (`retry.ts` holds them, `retry.test.ts` replays the corpus both SDKs share).
 * The bytes are serialised once, above the loop, and the same bytes are
 * resent: the gateway keys a pending hold on the hash of what it received, so
 * identical bytes land on the same hold instead of opening a second one.
 */

import type { wire } from '@ziffer-io/types';

import {
  DeadlineExceeded,
  newCall,
  parseRetryAfterSeconds,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_HEADER,
  RetryPolicy,
  type RetryCounters,
} from './retry.js';

// ---------------------------------------------------------------- key expiry

/**
 * The header every SUCCESSFUL answer carries (ACP-256 §5): the instant the key
 * that authenticated the call ends, RFC 3339 in UTC. Lowercase because that is
 * how `Headers.get` and Node's server spell names; the gateway writes it as
 * `X-Ziffer-Api-Key-Expires` and header names are case-insensitive.
 *
 * Never on a refusal. An expired key is refused exactly as an unknown one, so
 * the only moment a caller can learn its key is about to die is while it still
 * works -- which is why this client reads the header off 2xx answers only and
 * would be looking for an oracle if it read it off anything else.
 */
export const API_KEY_EXPIRES_HEADER = 'x-ziffer-api-key-expires';

/** How close to its end a key has to be before the warning fires. */
export const API_KEY_EXPIRY_WARNING_DAYS = 14;

/**
 * ONCE per process: a line per call is noise the operator filters out, and the
 * one that mattered goes with it. `console.warn` and not a logger of this
 * package's own, because that is the channel a deployment already routes.
 */
let expiryWarned = false;

/** Test seam only -- not re-exported from the package index. */
export function _resetApiKeyExpiryWarning(): void {
  expiryWarned = false;
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * `null` is an answer with no such header -- a gateway from before it existed
 * -- and says nothing. A header that is present but not the store's rendering
 * is reported ONCE by name rather than ignored: silence there is exactly how a
 * customer would stop being warned without anyone noticing the drift.
 */
function noteKeyExpiry(value: string | null): void {
  if (value === null || expiryWarned) {
    return;
  }
  const at = RFC3339_UTC.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) {
    expiryWarned = true;
    console.warn(
      `the gateway's ${API_KEY_EXPIRES_HEADER} header is not RFC 3339 UTC (${JSON.stringify(value)}); ` +
        'this client cannot tell when the API key expires',
    );
    return;
  }
  const msLeft = at - Date.now();
  if (msLeft < API_KEY_EXPIRY_WARNING_DAYS * 86_400_000) {
    expiryWarned = true;
    // Whole days ROUNDED UP: 2 days 23 hours is "3 day(s) left" to the person
    // reading it.
    const days = Math.max(Math.ceil(msLeft / 86_400_000), 0);
    console.warn(
      `the ZIFFER API key expires on ${value} (${days} day(s) left). An expired key is ` +
        'refused exactly like an unknown one, so rotate BEFORE then: ask for a successor ' +
        "(tools/mint-api-key.py --rotate <this key's key_hash>), deploy it, then have this one revoked",
    );
  }
}

// ---------------------------------------------------------------- wire types

/**
 * The §1 POST body: one wire Proposal, snake_case on the wire as
 * `spec/schemas/wire/proposal.schema.json` spells it.
 *
 * Field types are INDEXED from the generated `wire.Proposal` rather than
 * restated — `services/approval/src/door.ts`'s `WireRenderedSummary` idiom.
 * The generated model is camelCase; the wire keys are the schema's. Indexing
 * keeps one definition of each field's domain, so this interface cannot
 * drift from the schemas without `tsc` catching it (a retyped field here
 * would be a second definition of a schema object — the encoding-split
 * defect at the source level).
 */
export interface WireProposal {
  readonly schema_id: wire.Proposal['schemaId'];
  readonly schema_version: wire.Proposal['schemaVersion'];
  readonly schema_hash: wire.Proposal['schemaHash'];
  readonly fidelity: wire.Proposal['fidelity'];
  readonly tenant_id: wire.Proposal['tenantId'];
  readonly payload: WireProposalPayload;
}

/** PR-1's closed payload, snake_case as the schema spells it — same indexing
 * rule as {@link WireProposal}. */
export interface WireProposalPayload {
  readonly task_type: wire.ProposalPayload['taskType'];
  readonly operator: wire.ProposalPayload['operator'];
  readonly targets: wire.ProposalPayload['targets'];
  readonly params: wire.ProposalPayload['params'];
  readonly cidrs: wire.ProposalPayload['cidrs'];
}

/** The two §1 states. `decided` means the relay recorded a verdict; it does
 * NOT mean a receipt exists — `receipt` is present iff one does. */
/**
 * ACP-392. One short message about something our documentation does not
 * answer, and the ONLY thing this client sends that is not a Proposal.
 *
 * The three members are the route's CLOSED set: a fourth is refused by the
 * gateway rather than dropped, so this type cannot quietly grow a field that
 * carries a developer's environment off their machine. `context` is optional
 * and absent means absent.
 */
export interface Feedback {
  /** Which tool could not answer — free text, because the tools naming
   * themselves live on the other side of this wire. */
  readonly tool: string;
  /** What was asked. */
  readonly question: string;
  /** Anything else worth knowing. Never a credential: it is stored as written
   * and read by an operator. */
  readonly context?: string;
}

/** What `POST /v1/feedback` answers. `tenant` is the one thing the caller did
 * not send — the key carried it. */
export interface FeedbackStored {
  readonly stored: true;
  readonly tenant: string;
}

export type DecisionStatus = 'pending' | 'decided';

/**
 * RF-4's refusal category (ACP-402): the one thing a caller's code needs to
 * decide whether to try again, served INSTEAD of the clause on every
 * tenant-facing decision route. A closed set of four, carried verbatim (RF-2):
 * never mapped from anything, never invented, and a value outside the set is
 * refused as a malformed answer rather than repaired into one of these.
 *
 * - `PolicyRefused` — a rule refused the action: never retry.
 * - `PolicyBasisMoved` — the policy basis moved: retry once after activation.
 * - `RateBounded` — retry later.
 * - `ProposalMalformed` — fix the submission.
 */
export type RefusalCategory =
  | 'PolicyRefused'
  | 'PolicyBasisMoved'
  | 'RateBounded'
  | 'ProposalMalformed';

const REFUSAL_CATEGORIES: readonly RefusalCategory[] = [
  'PolicyRefused',
  'PolicyBasisMoved',
  'RateBounded',
  'ProposalMalformed',
];

function isRefusalCategory(v: unknown): v is RefusalCategory {
  return REFUSAL_CATEGORIES.some((c) => c === v);
}

/**
 * The two optional members ACP-402 added to a decision and to a list item,
 * read once: `refusal_category` (RF-4) and `held_until` (DR-15/DR-16: the
 * action is held and no receipt is readable until it releases). An absent
 * member is ABSENT, never `null`.
 */
function refusalAndHold(
  raw: Record<string, unknown>,
  where: string,
): { refusal_category?: RefusalCategory; held_until?: string } {
  let out: { refusal_category?: RefusalCategory; held_until?: string } = {};
  if ('refusal_category' in raw) {
    const category = raw['refusal_category'];
    if (!isRefusalCategory(category)) {
      throw new ResponseMalformed(`${where} refusal_category is not one of RF-4's four`);
    }
    out = { ...out, refusal_category: category };
  }
  if ('held_until' in raw) {
    const heldUntil = raw['held_until'];
    if (typeof heldUntil !== 'string') {
      throw new ResponseMalformed(`${where} held_until is not a string`);
    }
    out = { ...out, held_until: heldUntil };
  }
  return out;
}

/**
 * What both §1 routes answer. A refusal exposes `{outcome, refusal_category}`
 * — never the clause, since ACP-402 (RF-4: the caller may be the agent being
 * contained; the clause is in the console) — and an absent member is ABSENT,
 * never `null`: one object, one encoding.
 */
export interface Decision {
  /** The locator (T). Compare nothing against it; fetch with it. */
  readonly decision_id: string;
  readonly status: DecisionStatus;
  /** The engine's outcome type — a fourth spelling of ALLOW / ATTEST / DENY
   * would be a fourth definition of the object every component agrees on. */
  readonly outcome?: wire.DecisionOutcome;
  /** RF-4's category, for a DENY or a refused release. Absent otherwise. */
  readonly refusal_category?: RefusalCategory;
  /** DR-15: the action is HELD until this instant (RFC 3339 UTC) and no
   * receipt is readable yet. Absent once it releases or is refused. */
  readonly held_until?: string;
  /**
   * The signed receipt, verbatim from the one route that serves receipts
   * (GET). Deliberately `unknown`: its ONLY consumer is `verifyReceipt`,
   * which takes `unknown` and refuses by name — typing it here would invite
   * reading fields out of an unverified receipt.
   */
  readonly receipt?: unknown;
}

/** What a list item's `receipt` says. TWO WORDS, never the document: the
 * receipt is served by exactly one route (`GET /v1/decisions/{id}`), and a
 * boolean would read as "the receipt says no" — which is the sentence a DENY
 * makes true and this member does not mean. */
export type ReceiptPresence = 'attached' | 'absent';

/**
 * One row of {@link ZifferClient.list} (ACP-356).
 *
 * IT CARRIES NO CLAUSE AND NO RECEIPT DOCUMENT, and neither is an oversight.
 * The list answers WHAT was decided and never WHY: the caller may be a
 * compromised agent, and a sweepable list of clauses is an oracle over the
 * customer's signed rules. The reason a request was refused is in the audit
 * trail and, for a signed-in human, in the console — not at the API.
 */
export interface DecisionListItem {
  readonly decision_id: string;
  readonly status: DecisionStatus;
  readonly receipt: ReceiptPresence;
  /** When the gateway recorded the submission. Strict RFC 3339 UTC, to the
   * second — the same grammar `since` takes. */
  readonly created_at: string;
  /** The Policy Engine is still holding this Proposal for a quorum. NOT the
   * same as `outcome === 'ATTEST'`, which only says one was asked for. */
  readonly waiting: boolean;
  /** Absent while pending. */
  readonly outcome?: wire.DecisionOutcome;
  /** When the hold ends (AT-5). Present only while `waiting`. */
  readonly expires_at?: string;
  /** RF-4's category — the category, never the clause. */
  readonly refusal_category?: RefusalCategory;
  /** DR-15: held until this instant, no receipt yet. */
  readonly held_until?: string;
}

/**
 * One page of {@link ZifferClient.list}, and where the next one starts.
 *
 * `next_cursor` is `null` at the end — never `undefined`, because both values
 * are ANSWERS and a caller must tell "this is the end" from "the server did
 * not say". Hand it back UNCHANGED: it is opaque, and a cursor built by a
 * caller is a second implementation of the gateway's ordering.
 */
export interface DecisionPage {
  readonly items: readonly DecisionListItem[];
  readonly next_cursor: string | null;
}

/** Per-call options for {@link ZifferClient.list}. */
export interface ListOptions extends RequestOptions {
  /** Strict RFC 3339 UTC, exactly `2026-09-21T18:00:00Z`. Default: 24 hours
   * ago. May not reach further back than 730 days. */
  readonly since?: string;
  /** 1..200. Default 50. */
  readonly limit?: number;
  /** `next_cursor` from a previous page, unchanged. */
  readonly cursor?: string;
}

/**
 * What `GET /v1/whoami` answers (ACP-391): the customer this key is bound to,
 * and when the key stops being accepted.
 *
 * TWO MEMBERS AND NO THIRD. A wider "tenant info" was considered and dropped:
 * the live policy epoch, the bundle's expiry, the attester names and the three
 * windows are the POLICY AUTHOR's business, nothing in this client needs them
 * to call {@link ZifferClient.propose}, and a refusal already names its own
 * clause. What is genuinely unanswerable from this side of the wire is which
 * customer the key in an environment variable belongs to.
 *
 * `key_expires_at` is the same value {@link API_KEY_EXPIRES_HEADER} carries on
 * every 2xx — one date written twice by the gateway from one source, so a
 * caller that ASKED does not have to reach for a header to be told.
 */
export interface Identity {
  /** The tenant the API key resolves to, as the key store holds it. Never a
   * value this client chose: there is no parameter for it and a `tenant_id`
   * in a proposal that disagrees is refused (`TenantMismatch`), not rewritten. */
  readonly tenant_id: string;
  /** Strict RFC 3339 UTC, rendered by the store. A string and not a parsed
   * instant on purpose — the comparison that decides liveness is the store's,
   * and a second place that parsed this would be a second opinion about when a
   * key ends. */
  readonly key_expires_at: string;
}

// ------------------------------------------------------------ error surface

/** §1 names, exported so callers and tests never retype the strings. The set
 * is OPEN — the gateway may name more; {@link ApiRefusal} carries any name
 * verbatim and this list closes nothing. */
export const ERROR_API_KEY_UNKNOWN = 'ApiKeyUnknown';
export const ERROR_TENANT_MISMATCH = 'TenantMismatch';
export const ERROR_PROPOSAL_MALFORMED = 'ProposalMalformed';
export const ERROR_DECISION_UNKNOWN = 'DecisionUnknown';
export const ERROR_ADMISSION_UNAVAILABLE = 'AdmissionUnavailable';
/** ACP-356. ONE name for every way the list's query string is not a legal
 * one — which parameter, and why, is deliberately not said. */
export const ERROR_LIST_QUERY_MALFORMED = 'ListQueryMalformed';
/** ACP-392. `POST /v1/feedback`'s four, in the gateway's own spelling
 * (`services/gateway/src/gateway.rs::error_name`). They are exported for the
 * same reason the five above are: a caller branching on a refusal should
 * import the string rather than type it. */
export const ERROR_FEEDBACK_MALFORMED = 'FeedbackMalformed';
export const ERROR_FEEDBACK_TOO_LARGE = 'FeedbackTooLarge';
export const ERROR_FEEDBACK_RATE_LIMITED = 'FeedbackRateLimited';
export const ERROR_FEEDBACK_UNAVAILABLE = 'FeedbackUnavailable';
/** ACP-422. This key's quota on `propose`, `decision`, `list` and `whoami` is
 * spent: 429 with `Retry-After`, which the retry policy already obeys
 * (ACP-355). A different name from {@link ERROR_FEEDBACK_RATE_LIMITED}
 * because it is a different allowance. */
export const ERROR_RATE_LIMITED = 'RateLimited';

/**
 * The gateway answered, and the answer was a named refusal. `error` is the
 * gateway's name, verbatim — the machine-readable half, as `Refusal.clause`
 * is for verification. `status` is carried for the operator; the NAME is the
 * contract.
 */
export class ApiRefusal extends Error {
  /** The gateway's refusal name, e.g. `ApiKeyUnknown`. Verbatim. */
  readonly error: string;
  /** The HTTP status the name arrived under. */
  readonly status: number;

  constructor(status: number, error: string) {
    super(`${error} (HTTP ${status})`);
    this.name = 'ApiRefusal';
    this.error = error;
    this.status = status;
  }
}

/**
 * The answer was not §1's shape — not JSON, missing or mistyped fields, a
 * receipt where §1 says none can be, an id that is not the one asked for.
 * Thrown instead of guessed at: an SDK that repairs a malformed answer is
 * an SDK that invents decision state.
 */
export class ResponseMalformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseMalformed';
  }
}

/** The deadline passed with the decision still `pending` ({@link
 * ZifferClient.wait}), or with its receipt not yet readable ({@link
 * ZifferClient.waitForReceipt}: a held action nobody has answered yet). Not a
 * refusal and not an answer — the decision may still decide, or be approved;
 * the id remains fetchable.
 *
 * `options.cause` is how the reason survives the rename. A poll that ran out
 * of retry budget produced a {@link DeadlineExceeded} naming the last failure
 * and its status; `wait` reports the event under the name its caller catches
 * and hands the original through as `cause`, so nothing the caller could have
 * learned from the poll is thrown away to keep one name at the surface. A
 * rename that dropped the reason would make "no answer yet" indistinguishable
 * from "the gateway was shedding for thirty seconds". */
export class WaitTimeout extends Error {
  readonly decisionId: string;
  /** The last decision the wait read, or `undefined` when no read answered. */
  readonly last: Decision | undefined;

  constructor(decisionId: string, timeoutMs: number, options?: ErrorOptions & { readonly last?: Decision }) {
    super(waitTimeoutMessage(decisionId, timeoutMs / 1000, options?.last), options);
    this.name = 'WaitTimeout';
    this.decisionId = decisionId;
    this.last = options?.last;
  }
}

/**
 * What a wait that ran out of time says, as an instruction: the state the
 * decision was last read in, and what to do. The same line as the Python
 * SDK's `WaitTimeout` for the same state and timeout
 * (`tools/fixtures/sdk-retry/wait-timeout-lines.json` holds both to it).
 *
 * Three states, because "still pending" is false for two of them: a decision
 * not yet made, an action HELD for an approver (decided `ATTEST`, or held
 * until an instant, with no receipt), and a decision made whose receipt is
 * not readable yet. In every one the answer is the same: read it again with
 * its id, and never propose the action again -- a second proposal is a
 * second action.
 */
export function waitTimeoutMessage(decisionId: string, timeoutSeconds: number, last?: Decision): string {
  const state =
    last === undefined || last.status !== 'decided'
      ? 'was still waiting to be decided'
      : last.receipt === undefined && (last.outcome === 'ATTEST' || last.held_until !== undefined)
        ? 'was held for an approver'
        : 'was decided and its receipt was not readable yet';
  const seconds = Number.isInteger(timeoutSeconds)
    ? String(timeoutSeconds)
    : timeoutSeconds.toFixed(3).replace(/0+$/, '');
  return (
    `decision ${decisionId} ${state} when the wait ended after ${seconds}s: ` +
    'read the decision again later with its id, and never propose the same action again'
  );
}

// ------------------------------------------------------------------- guards

/** The engine's three outcomes, typed from the generated union so a drift in
 * the schema surfaces here as a compile error, not a runtime disagreement. */
const OUTCOMES: readonly wire.DecisionOutcome[] = ['ALLOW', 'ATTEST', 'DENY'];

function isOutcome(v: unknown): v is wire.DecisionOutcome {
  return typeof v === 'string' && OUTCOMES.some((o) => o === v);
}

function isStatus(v: unknown): v is DecisionStatus {
  return v === 'pending' || v === 'decided';
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Narrow one §1 response body to a {@link Decision}, refusing by name on any
 * departure. `receiptAllowed` is false on the POST path: §1 says the receipt
 * is NEVER in the POST response — one place serves receipts — and a client
 * that tolerated one there would quietly stand up a second serving place.
 */
/** The feedback answer, narrowed with no cast (ACP-392). A 200 whose body is
 * not this shape is NOT reported as stored: "the gateway answered something"
 * and "your message is on a disk an operator reads" are different facts, and
 * only the second is what the caller asked for. */
function feedbackFromBody(body: unknown): FeedbackStored {
  if (!isRecord(body)) {
    throw new ResponseMalformed('feedback response is not a JSON object');
  }
  if (body['stored'] !== true) {
    throw new ResponseMalformed('feedback response does not say the message was stored');
  }
  const tenant = body['tenant'];
  if (typeof tenant !== 'string' || tenant.length === 0) {
    throw new ResponseMalformed('feedback response names no tenant');
  }
  return { stored: true, tenant };
}

function decisionFromBody(body: unknown, receiptAllowed: boolean): Decision {
  if (!isRecord(body)) {
    throw new ResponseMalformed('decision response is not a JSON object');
  }
  const id = body['decision_id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new ResponseMalformed('decision response carries no decision_id');
  }
  const status = body['status'];
  if (!isStatus(status)) {
    throw new ResponseMalformed(
      'decision response status is not "pending" or "decided"',
    );
  }
  let decision: Decision = { decision_id: id, status };
  if ('outcome' in body) {
    const outcome = body['outcome'];
    if (!isOutcome(outcome)) {
      // An answer this client cannot read as one of the three is not a
      // verdict and never becomes one (ingress-low's rule for the same
      // value, one hop earlier).
      throw new ResponseMalformed('decision outcome is not ALLOW, ATTEST or DENY');
    }
    decision = { ...decision, outcome };
  }
  decision = { ...decision, ...refusalAndHold(body, 'decision') };
  if ('receipt' in body) {
    if (!receiptAllowed) {
      throw new ResponseMalformed(
        'receipt in a POST response: one place serves receipts (GET)',
      );
    }
    decision = { ...decision, receipt: body['receipt'] };
  }
  return decision;
}

/**
 * Narrow the `GET /v1/whoami` body, refusing by name on any departure.
 *
 * BOTH MEMBERS ARE REQUIRED. There is no optional half of an identity, and a
 * tolerated missing `key_expires_at` would surface as `undefined` in whatever
 * a caller prints — which reads as "no expiry" and is the one wrong reading of
 * a credential that ends.
 */
function identityFromBody(body: unknown): Identity {
  if (!isRecord(body)) {
    throw new ResponseMalformed('whoami response is not a JSON object');
  }
  const tenant = body['tenant_id'];
  if (typeof tenant !== 'string' || tenant.length === 0) {
    throw new ResponseMalformed('whoami response carries no tenant_id');
  }
  const expires = body['key_expires_at'];
  if (typeof expires !== 'string' || expires.length === 0) {
    throw new ResponseMalformed('whoami response carries no key_expires_at');
  }
  return { tenant_id: tenant, key_expires_at: expires };
}

function isReceiptPresence(v: unknown): v is ReceiptPresence {
  return v === 'attached' || v === 'absent';
}

/**
 * Narrow one list body, refusing by name on any departure — never repairing
 * one. `next_cursor` must be PRESENT: `null` is the end, an absent member is a
 * server that did not say, and a client that read the two as one would stop
 * paging early and report a customer's list as shorter than it is.
 */
function pageFromBody(body: unknown): DecisionPage {
  if (!isRecord(body)) {
    throw new ResponseMalformed('list response is not a JSON object');
  }
  const rawItems = body['items'];
  if (!Array.isArray(rawItems)) {
    throw new ResponseMalformed('list response carries no items array');
  }
  if (!('next_cursor' in body)) {
    throw new ResponseMalformed(
      'list response carries no next_cursor: null is the end, absent is silence',
    );
  }
  const rawCursor = body['next_cursor'];
  if (rawCursor !== null && typeof rawCursor !== 'string') {
    throw new ResponseMalformed('next_cursor is neither a string nor null');
  }
  const items: DecisionListItem[] = rawItems.map((raw: unknown) => {
    if (!isRecord(raw)) {
      throw new ResponseMalformed('list item is not a JSON object');
    }
    const id = raw['decision_id'];
    const status = raw['status'];
    const receipt = raw['receipt'];
    const createdAt = raw['created_at'];
    const waiting = raw['waiting'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new ResponseMalformed('list item carries no decision_id');
    }
    if (!isStatus(status)) {
      throw new ResponseMalformed('list item status is not "pending" or "decided"');
    }
    if (!isReceiptPresence(receipt)) {
      throw new ResponseMalformed('list item receipt is not "attached" or "absent"');
    }
    if (typeof createdAt !== 'string') {
      throw new ResponseMalformed('list item created_at is not a string');
    }
    if (typeof waiting !== 'boolean') {
      throw new ResponseMalformed('list item waiting is not a boolean');
    }
    let item: DecisionListItem = {
      decision_id: id,
      status,
      receipt,
      created_at: createdAt,
      waiting,
    };
    if ('outcome' in raw) {
      const outcome = raw['outcome'];
      if (!isOutcome(outcome)) {
        throw new ResponseMalformed('list item outcome is not ALLOW, ATTEST or DENY');
      }
      item = { ...item, outcome };
    }
    if ('expires_at' in raw) {
      const expiresAt = raw['expires_at'];
      if (typeof expiresAt !== 'string') {
        // Includes null: an absent window is spelled ABSENT.
        throw new ResponseMalformed('list item expires_at is not a string');
      }
      item = { ...item, expires_at: expiresAt };
    }
    return { ...item, ...refusalAndHold(raw, 'list item') };
  });
  return { items, next_cursor: rawCursor };
}

// ------------------------------------------------------------------- client

/** Options for {@link ZifferClient.wait} and {@link ZifferClient.waitForReceipt}. */
export interface WaitOptions {
  /** Give up (throw {@link WaitTimeout}) after this long. Default 30 000. */
  readonly timeoutMs?: number;
  /** Delay between polls. Default 500. */
  readonly intervalMs?: number;
}

/** What this client needs of `fetch`, and no more. Narrow on purpose: it is
 * the seam the retry corpus is replayed through, and a seam typed as the whole
 * of `fetch` would invite a test to script something this client never sends. */
export interface FetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

/** The injectable `fetch`. The default is the global one. */
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

/** Per-call options for {@link ZifferClient.propose} and
 * {@link ZifferClient.decision}. */
export interface RequestOptions {
  /**
   * R5. How long from NOW this call may keep retrying, in milliseconds.
   *
   * Before every sleep, directed or computed, the client asks whether the
   * sleep would end after this instant; if it would, it does not sleep and
   * throws {@link DeadlineExceeded} carrying the last failure. Absent means
   * no such check at all — the attempt cap and the token bucket are then the
   * only bounds, and a server that asks for an hour gets an hour.
   */
  readonly deadlineMs?: number;
}

/**
 * Construction-time options. Every one of them has a real default; the clock,
 * the sleep, the draw and `fetch` exist as options so the shared retry corpus
 * can be replayed deterministically, and for no other reason — a client built
 * with none of them is the client a customer runs.
 */
export interface ZifferClientOptions {
  /** R8. The abort timeout on ONE round trip. Default
   * {@link REQUEST_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Default: the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Default: `Date.now`. */
  readonly now?: () => number;
  /** Default: `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** R2's `u`, in [0,1). Default: `Math.random`. */
  readonly random?: () => number;
  /** R6's bucket at construction. Default: full
   * ({@link RETRY_BUCKET_CAPACITY}). A test seam — a deployment that wanted a
   * smaller retry budget would be asking for a different rule, not a
   * different starting level. */
  readonly retryBucketInitial?: number;
}

/**
 * One round trip's outcome, as the retry loop needs to read it: either the
 * parsed 2xx body, or a failure carrying everything R1..R5 asks about it —
 * the status (0 for no HTTP answer at all), what `Retry-After` said, and the
 * error to throw if this attempt turns out to be the last one.
 */
type RoundTrip =
  | { readonly kind: 'ok'; readonly value: unknown }
  | {
      readonly kind: 'failed';
      readonly status: number;
      readonly retryAfterS: number | null;
      readonly error: Error;
    };

/** The global `fetch`, behind {@link FetchLike}. Not `globalThis.fetch`
 * captured at module load: a test that replaces the global would then be
 * replacing something this module already copied. */
const globalFetch: FetchLike = (url, init) => fetch(url, init);

/** The real sleep. */
const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whatever `fetch` (or the body stream) threw, as an `Error`. A thrown
 * non-Error is wrapped rather than re-thrown as-is, because {@link
 * DeadlineExceeded} reports the last failure's NAME and a thrown string has
 * none — the operator would be told the deadline passed and nothing else.
 */
function transportError(thrown: unknown, method: string, path: string): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  return new Error(`${method} ${path} failed with a non-Error: ${String(thrown)}`);
}

/**
 * The client. One instance per (gateway, key); the KEY determines the tenant
 * server-side (§1), so there is nothing tenant-shaped to configure here —
 * a client-side tenant setting would be a value the server must ignore.
 */
export class ZifferClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  /** R6/R9: per CLIENT INSTANCE, as the rules say. Two clients do not share a
   * retry budget, and one client's `propose` and `wait` do. */
  private readonly retry: RetryPolicy;

  constructor(baseUrl: string, apiKey: string, options?: ZifferClientOptions) {
    if (baseUrl.length === 0) {
      throw new TypeError('ZifferClient: baseUrl is empty');
    }
    if (apiKey.length === 0) {
      // Refused here, not sent: an empty bearer token is a caller bug, and
      // mailing it to the server converts a local defect into a remote 401
      // whose log line points at the wrong component.
      throw new TypeError('ZifferClient: apiKey is empty');
    }
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('ZifferClient: timeoutMs must be a positive number of milliseconds');
    }
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options?.fetch ?? globalFetch;
    this.now = options?.now ?? Date.now;
    this.sleep = options?.sleep ?? realSleep;
    this.random = options?.random ?? Math.random;
    this.retry = new RetryPolicy(options?.retryBucketInitial);
  }

  /**
   * R9. The two retry counters and the bucket gauge, as a plain object taken
   * at this instant. Cumulative over the client's life — a caller that wants
   * a delta over one call reads it before and after.
   */
  get retryCounters(): RetryCounters {
    return this.retry.counters;
  }

  /**
   * POST /v1/proposals. The proposal is serialised as given — the caller's
   * values, no edits — and the answer never carries a receipt (§1): fetch it
   * with {@link decision} once decided.
   *
   * `opts.deadlineMs` bounds the RETRYING, not the round trip (R5).
   */
  async propose(proposal: WireProposal, opts?: RequestOptions): Promise<Decision> {
    // R7: serialised ONCE, here, above the retry loop. `request` resends these
    // same bytes on every attempt, so a resend lands on the hold the gateway
    // already keyed on their hash rather than opening a second one. Moving
    // this inside the loop is the defect, not a tidier place for it.
    const body = JSON.stringify(proposal);
    const parsed = await this.request(
      'POST',
      '/v1/proposals',
      body,
      this.deadlineAt(opts?.deadlineMs),
    );
    return decisionFromBody(parsed, false);
  }

  /**
   * POST /v1/feedback — tell ZIFFER what our documentation did not answer
   * (ACP-392).
   *
   * THE TEXT LEAVES THE MACHINE. It is stored under the tenant this API key
   * carries and read by an operator; nothing is filtered on the way, so
   * anything put in `question` or `context` is anything an operator will
   * read. The gateway refuses a member this shape does not define, which is
   * what stops the object growing a field that carries more than a sentence.
   *
   * # ONE round trip and NO retry, unlike every other call on this client
   *
   * `request` retries a 429 and honours its `Retry-After`, which is right for
   * work: a proposal that was refused for backpressure still has to happen.
   * This is not work. A rate-limited feedback message is a message that will
   * not be stored, and riding out a 60-second bucket would block the coding
   * agent that called it for a minute to deliver a sentence. So the failure
   * is raised as it arrives — [`ApiRefusal`] with the gateway's own name —
   * and the caller decides.
   */
  async feedback(message: Feedback): Promise<FeedbackStored> {
    if (message.tool.length === 0 || message.question.length === 0) {
      // Refused here rather than sent, `apiKey`'s rule in the constructor: an
      // empty question is a caller bug, and mailing it converts a local
      // defect into a remote 400.
      throw new TypeError('ZifferClient.feedback: tool and question must both be non-empty');
    }
    const body: Record<string, string> = {
      tool: message.tool,
      question: message.question,
    };
    // Absent means ABSENT, never present-and-undefined: `JSON.stringify`
    // would drop an undefined member anyway, and relying on that would make
    // the wire shape depend on a serialiser's behaviour rather than on this
    // object.
    if (message.context !== undefined) {
      body['context'] = message.context;
    }
    const trip = await this.roundTrip('POST', '/v1/feedback', JSON.stringify(body));
    if (trip.kind !== 'ok') {
      throw trip.error;
    }
    return feedbackFromBody(trip.value);
  }

  /**
   * GET /v1/decisions/{id}. `receipt` is present iff a signed receipt
   * exists; hand it to `verifyReceipt` with your OWN copy of the proposal
   * bytes — the id proves nothing (T), the recomputed hash is the binding.
   */
  async decision(id: string, opts?: RequestOptions): Promise<Decision> {
    if (id.length === 0) {
      throw new TypeError('ZifferClient.decision: id is empty');
    }
    return this.fetchDecision(id, this.deadlineAt(opts?.deadlineMs));
  }

  /** {@link decision}, with the deadline already resolved to an instant —
   * which is what {@link wait} has and a caller does not. */
  private async fetchDecision(
    id: string,
    deadlineAtMs: number | undefined,
  ): Promise<Decision> {
    const body = await this.request(
      'GET',
      `/v1/decisions/${encodeURIComponent(id)}`,
      null,
      deadlineAtMs,
    );
    const d = decisionFromBody(body, true);
    if (d.decision_id !== id) {
      // The id is a locator, but an answer ABOUT A DIFFERENT LOCATOR is not
      // an answer to this question — surfacing it as one would let a
      // confused (or malicious) proxy substitute decisions silently.
      throw new ResponseMalformed(
        `decision response is about ${d.decision_id}, not ${id}`,
      );
    }
    return d;
  }

  /**
   * GET /v1/whoami — which customer this key is bound to, and when it ends.
   *
   * The one call that asks about the CREDENTIAL rather than about a decision.
   * It sends no body and takes no argument: there is nothing to name, because
   * the key is the question. A dead key — expired, revoked or never minted —
   * is one `ApiRefusal` (`ApiKeyUnknown`, 401) and the three cannot be told
   * apart, which is deliberate at the gateway and is not this client's to
   * undo.
   */
  async whoami(opts?: RequestOptions): Promise<Identity> {
    const body = await this.request(
      'GET',
      '/v1/whoami',
      null,
      this.deadlineAt(opts?.deadlineMs),
    );
    return identityFromBody(body);
  }

  /**
   * GET /v1/decisions — what ZIFFER holds and decided for THIS key.
   *
   * Every request waiting for approval (with when its hold ends) and every
   * decision in the window, newest first. The tenant is the API key's and
   * cannot be named any other way: there is no parameter for it and the
   * gateway refuses one by name.
   *
   * Every bad parameter is one refusal, `ListQueryMalformed` (400). The API
   * does not say which one, for the same reason an item carries no clause.
   */
  async list(opts?: ListOptions): Promise<DecisionPage> {
    const params = new URLSearchParams();
    if (opts?.since !== undefined) {
      params.set('since', opts.since);
    }
    if (opts?.limit !== undefined) {
      params.set('limit', String(opts.limit));
    }
    if (opts?.cursor !== undefined) {
      params.set('cursor', opts.cursor);
    }
    const query = params.toString();
    const body = await this.request(
      'GET',
      query.length === 0 ? '/v1/decisions' : `/v1/decisions?${query}`,
      null,
      this.deadlineAt(opts?.deadlineMs),
    );
    return pageFromBody(body);
  }

  /**
   * Poll {@link decision} until `decided` or the deadline. A `WaitTimeout`
   * is "no answer yet", never a verdict; every named refusal (404 included)
   * propagates immediately — retrying `DecisionUnknown` would be the client
   * deciding the server was wrong.
   *
   * A poll that runs out of budget surfaces as `WaitTimeout` too, and NOT as
   * the `DeadlineExceeded` the request path raised. Both mean "the wait's own
   * deadline arrived with the decision still pending"; which of the two a
   * caller saw depended on whether the last poll happened to be mid-retry,
   * which is a detail of the gateway's load and not of this API. The
   * `DeadlineExceeded` rides along as `cause`, so the last failure's name and
   * status are still there for whoever wants them.
   */
  async wait(id: string, opts?: WaitOptions): Promise<Decision> {
    return this.pollUntil('wait', id, opts, (d) => d.status === 'decided');
  }

  /**
   * Poll {@link decision} until the decision's RECEIPT is readable, or it was
   * refused, or the deadline passes (ACP-473).
   *
   * {@link wait} returns when the decision is made; the receipt becomes
   * readable later, once the Executor's part is done, so "wait, then verify
   * `decision.receipt`" can meet an absent receipt. This call returns only
   * with the receipt present, or with a refusal exactly as {@link wait}
   * returns one: a decided `DENY`, or any decision carrying a
   * `refusal_category` (a held action whose release was refused), comes back
   * as a value, never thrown. A held action (decided, `ATTEST`, no receipt
   * yet) keeps this call waiting until a person answers or the deadline
   * passes. The deadline is {@link WaitTimeout}, the same refusal and the
   * same pacing and limits as {@link wait}.
   *
   * It only reads. It never proposes again: a second proposal is a second
   * action.
   */
  async waitForReceipt(id: string, opts?: WaitOptions): Promise<Decision> {
    return this.pollUntil(
      'waitForReceipt',
      id,
      opts,
      (d) =>
        d.status === 'decided' &&
        (d.receipt !== undefined || d.outcome === 'DENY' || d.refusal_category !== undefined),
    );
  }

  /** The one polling loop behind {@link wait} and {@link waitForReceipt}. */
  private async pollUntil(
    caller: string,
    id: string,
    opts: WaitOptions | undefined,
    done: (d: Decision) => boolean,
  ): Promise<Decision> {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const intervalMs = opts?.intervalMs ?? 500;
    if (timeoutMs <= 0 || intervalMs <= 0) {
      throw new TypeError(`ZifferClient.${caller}: timeoutMs and intervalMs must be positive`);
    }
    const deadline = this.now() + timeoutMs;
    let last: Decision | undefined;
    for (;;) {
      // R8: each poll is a request like any other, so R1..R6 hold per poll —
      // including R5, under this wait's OWN deadline. Without that a gateway
      // answering `Retry-After: 3600` on one poll would park a 30-second wait
      // for an hour, and the caller's timeout would have meant nothing.
      let d: Decision;
      try {
        d = await this.fetchDecision(id, deadline);
      } catch (thrown) {
        if (thrown instanceof DeadlineExceeded) {
          // The deadline the poll hit IS this wait's deadline — it is the only
          // one `fetchDecision` was given above. So this is the event the loop
          // below already throws `WaitTimeout` for, reached one branch earlier,
          // and giving it a second name would make a caller catch two.
          throw new WaitTimeout(id, timeoutMs, last === undefined ? { cause: thrown } : { cause: thrown, last });
        }
        throw thrown;
      }
      last = d;
      if (done(d)) {
        return d;
      }
      if (this.now() + intervalMs > deadline) {
        throw new WaitTimeout(id, timeoutMs, { last });
      }
      await this.sleep(intervalMs);
    }
  }

  /** R5: the caller's duration becomes an instant on this client's clock,
   * once, at the start of the call. `undefined` in, `undefined` out — no
   * deadline means no check, not a check against infinity. */
  private deadlineAt(deadlineMs: number | undefined): number | undefined {
    if (deadlineMs === undefined) {
      return undefined;
    }
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0) {
      throw new TypeError('ZifferClient: deadlineMs must be a non-negative number of milliseconds');
    }
    return this.now() + deadlineMs;
  }

  /**
   * THE request path: one loop, R1..R6, for every call this client makes.
   *
   * `body` arrives already serialised and is resent unchanged (R7). The loop
   * owns nothing about the rules themselves — `retry.ts` decides, this
   * sleeps, sends again, or throws what the last attempt produced.
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: string | null,
    deadlineAtMs: number | undefined,
  ): Promise<unknown> {
    const call = newCall();
    for (;;) {
      call.attempts += 1;
      const trip = await this.roundTrip(method, path, body);
      if (trip.kind === 'ok') {
        return trip.value;
      }
      const step = this.retry.decide(
        trip.status,
        trip.retryAfterS,
        call,
        this.now(),
        deadlineAtMs,
        this.random,
      );
      if (step.kind === 'stop') {
        // Nothing invented: the failure this attempt already produced, as it is.
        throw trip.error;
      }
      if (step.kind === 'deadline') {
        throw new DeadlineExceeded(trip.error.name, trip.status);
      }
      await this.sleep(step.ms);
    }
  }

  /**
   * ONE round trip: one request, one parse, one narrowing. 2xx returns the
   * parsed body for the caller's guard; anything else must be §1's
   * `{"error": name}` and yields {@link ApiRefusal} with the name verbatim. A
   * non-JSON or unnamed error body yields {@link ResponseMalformed} — an
   * intermediary's HTML 502 is not the gateway's answer and is never dressed
   * up as one, though it IS retried, because 502 is retryable whoever wrote it.
   *
   * Nothing is thrown from here: the failure is RETURNED, because whether it
   * becomes the caller's error is the retry loop's question and not this
   * method's.
   */
  private async roundTrip(
    method: 'GET' | 'POST',
    path: string,
    body: string | null,
  ): Promise<RoundTrip> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== null) {
      headers['content-type'] = 'application/json';
    }
    // R8: the signal covers the send AND the reading of the body — one round
    // trip, not one call.
    //
    // An AbortController with a timer this method owns, and NOT
    // `AbortSignal.timeout`: that helper's timer is held weakly, so a signal
    // nothing else strongly references can be collected and the abort then
    // never fires — a timeout that silently is not one. It was observed here,
    // once in about fifteen runs of this package's own suite, which is exactly
    // the shape of defect that reaches a customer as "the SDK hung". The timer
    // below is cleared on every path.
    const controller = new AbortController();
    const timedOut = new Error(
      `${method} ${path} did not answer within ${this.timeoutMs}ms`,
    );
    timedOut.name = 'TimeoutError';
    const timer = setTimeout(() => controller.abort(timedOut), this.timeoutMs);

    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== null ? { body } : {}),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (thrown) {
      // R1: no HTTP answer at all — refused, DNS, or the round trip outlived
      // its timeout. Status 0, and retryable.
      return {
        kind: 'failed',
        status: 0,
        retryAfterS: null,
        error: transportError(thrown, method, path),
      };
    } finally {
      clearTimeout(timer);
    }

    const status = res.status;
    const retryAfterS = parseRetryAfterSeconds(res.headers.get(RETRY_AFTER_HEADER));
    if (res.ok) {
      // R6: a successful call adds a token. Counted here, on the STATUS, and
      // not after the parse: R6 is about the call the gateway answered, and a
      // 2xx whose body this client then refuses was still a call that worked.
      this.retry.refill();
      // Only here, on a 2xx (see API_KEY_EXPIRES_HEADER).
      noteKeyExpiry(res.headers.get(API_KEY_EXPIRES_HEADER));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        kind: 'failed',
        status,
        retryAfterS,
        error: new ResponseMalformed(
          `HTTP ${status} with a non-JSON body from ${method} ${path}`,
        ),
      };
    }
    if (res.ok) {
      return { kind: 'ok', value: parsed };
    }
    if (isRecord(parsed)) {
      const name = parsed['error'];
      if (typeof name === 'string' && name.length > 0) {
        return { kind: 'failed', status, retryAfterS, error: new ApiRefusal(status, name) };
      }
    }
    return {
      kind: 'failed',
      status,
      retryAfterS,
      error: new ResponseMalformed(`HTTP ${status} from ${method} ${path} names no error`),
    };
  }
}
