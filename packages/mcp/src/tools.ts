/**
 * The five tools, as plain functions (ACP-197 section 6b point 2; ACP-213
 * section 9.2 point 3 added the fifth).
 *
 * Every handler here takes its dependencies as arguments and returns a
 * {@link ToolOutcome}. Nothing in this file imports the MCP SDK: `server.ts`
 * adapts these to the protocol's content shape. That seam exists so the tests
 * exercise the behaviour rather than the framing, and so the answer to "what
 * does `propose` do when the key is unset" is one function call.
 *
 * # What is deliberately absent
 *
 * There is no approve tool, no simulated approval, and no tool that writes a
 * file. The reason for the first two is worth carrying here rather than leaving
 * in a ticket: **a simulated approval minted on a developer's laptop is a fake
 * receipt factory**, and a receipt factory is the exact artifact this product
 * exists to make impossible.
 *
 * Until ACP-213 this file also said there was no sandbox tool, and that a
 * sandbox mode was "a follow-up with its own design". That follow-up landed and
 * the design is the reason the sentence could change: a Ziffer sandbox is a
 * SEPARATE TENANT with its own receipt signing identity, approved by a robot
 * that walks the real quorum path with keys enrolled only in sandbox bundles
 * (`services/sandbox-approver`, `docs/onboarding/sandbox.md`). Nothing about it
 * is client-side, which is why {@link sandboxStatus} only ever REPORTS: it
 * reads a name and asks the API about one decision. An approval on this side of
 * the wire would still be a forgery, and there is still no tool for it.
 *
 * The third is a boundary rather than a danger: the handlers in THIS file write
 * no file and run no process, and the one local file they read is the trust
 * anchor `ZIFFER_TRUST_ANCHOR` names (read by `@ziffer-io/verify`'s `loadTrustAnchor`) -- the package is wider, and
 * `server.ts`, `repo-check.ts`, `integration-check.ts` and `decide.ts` each
 * state what they read or run. It serves knowledge and Ziffer-side calls; the coding
 * agent talking to it is the thing that edits code. A file-writing tool here
 * would make this process an editor with none of an editor's review surface.
 */

import { ApiRefusal } from '@ziffer-io/client';
import { AnchorError, canon, loadTrustAnchor, Refusal, verifyReceipt } from '@ziffer-io/verify';

import { anchorConfig, ConfigError, type Env } from './config.js';
import { asLanguage, integrationGuide, LANGUAGES } from './guide.js';

/**
 * What a tool hands back.
 *
 * `isError` is the MCP protocol's flag for "this call did not do what it was
 * asked", and it is set for every refusal — a configuration error, a gateway
 * refusal, a receipt that does not verify. It is deliberately NOT set for a
 * decision whose outcome is `DENY`: the tool was asked to get a decision and it
 * got one. Marking a successful denial as a tool error teaches an agent to
 * treat "the policy said no" as a malfunction to route around, which is the
 * behaviour this whole system exists to prevent.
 */
export interface ToolOutcome {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * The §1 response to `POST /v1/proposals`, as the gateway sends it.
 *
 * Field names are §1's, in its spelling, because the tools return the response
 * VERBATIM. A DTO with prettier names here would mean the agent reading our
 * `docs/onboarding/sdk.md` sees one set of field names in the HTTP examples and
 * a different set coming out of the tools, and would have to be told they are
 * the same object.
 */
export interface SubmittedDecision {
  readonly decision_id: string;
  readonly status: 'pending' | 'decided';
  readonly outcome?: string;
  /** RF-4 (ACP-402): the category, never the clause — verbatim from the API. */
  readonly refusal_category?: string;
  /** DR-15: held until this instant, no receipt readable yet. */
  readonly held_until?: string;
}

/**
 * The response to `GET /v1/whoami`, as the gateway sends it (ACP-391).
 *
 * §1's spelling, like every other shape in this file, because `whoami` returns
 * the response VERBATIM. It is the narrowed `tenant_info` the ticket's own
 * 2026-09-23 comment settled on: the live epoch, the bundle's expiry, the
 * attester names and the three windows are the POLICY AUTHOR's business, no SDK
 * call needs them, and a refusal already carries its clause — so what is left
 * is the pair a developer cannot answer for themselves.
 */
export interface Identity {
  readonly tenant_id: string;
  readonly key_expires_at: string;
}

/** The §1 response to `GET /v1/decisions/{id}`: the above, plus the receipt
 * when a signed one exists. `receipt` is `unknown` because this package never
 * looks inside it — it is served to the agent as it arrived and handed to
 * `@ziffer-io/verify` unparsed by anything of ours. */
export interface DecisionRecord extends SubmittedDecision {
  readonly receipt?: unknown;
}

/**
 * The client surface, fixed by ACP-197 section 6, narrowed to what these tools
 * call.
 *
 * Declared as an interface rather than imported as a class so that `tools.ts`
 * has no dependency on the transport, and so the tests can drive every §1
 * response shape — including the ones a stub HTTP server makes awkward to
 * produce, like a gateway that is unreachable. `client.ts` is the one file that
 * knows the concrete `ZifferClient`, and it is the one place a difference
 * between §6's spelling and §1's would be reconciled.
 */
export interface DecisionClient {
  propose(proposal: unknown): Promise<SubmittedDecision>;
  decision(decisionId: string): Promise<DecisionRecord>;
  list(options?: ListArgs): Promise<DecisionPage>;
  /** `GET /v1/whoami` (ACP-391). Two members and no third — see
   * {@link Identity}. */
  whoami(): Promise<Identity>;
}

/**
 * One row of `GET /v1/decisions` (ACP-356), in §1's spelling.
 *
 * IT CARRIES NO CLAUSE AND NO RECEIPT DOCUMENT, and that is the gateway's
 * design rather than this type being lazy: the list answers WHAT was decided
 * and never WHY, because the caller may be a compromised agent and a sweepable
 * list of clauses is an oracle over the customer's signed rules. `receipt` is
 * two words, `attached` or `absent` — a boolean would read as "the receipt says
 * no", which is the sentence a DENY makes true and this member does not mean.
 */
export interface DecisionListItem {
  readonly decision_id: string;
  readonly status: 'pending' | 'decided';
  readonly receipt: 'attached' | 'absent';
  readonly created_at: string;
  readonly waiting: boolean;
  readonly outcome?: string;
  readonly expires_at?: string;
}

/** One page, and where the next starts. `next_cursor` is `null` at the end and
 * never `undefined`: both are ANSWERS, and a caller must be able to tell "this
 * is the end" from "the server did not say". */
export interface DecisionPage {
  readonly items: readonly DecisionListItem[];
  readonly next_cursor: string | null;
}

/** What `list_decisions` passes down. A narrowed {@link DecisionClient} surface
 * for the same reason the interface exists at all: this package names the two
 * parameters it forwards and nothing else. */
export interface ListArgs {
  readonly since?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/** One short message about something our documentation does not answer
 * (ACP-392). The three members are the route's CLOSED set: the gateway
 * refuses a fourth rather than dropping it, so this type cannot quietly grow
 * a field that carries a developer's environment off their machine. */
export interface FeedbackMessage {
  readonly tool: string;
  readonly question: string;
  readonly context?: string;
}

/** What the gateway answers. `tenant` is the one member the caller did not
 * send — the API key carried it. */
export interface FeedbackStored {
  readonly stored: boolean;
  readonly tenant: string;
}

/** The one outward call in this package that is not about a decision
 * (ACP-392). Separate from {@link DecisionClient} because it is a different
 * thing: naming it `DecisionClient.feedback` would have made that interface's
 * name false, and the name is what a reader uses to know what the surface
 * is. */
export interface FeedbackClient {
  feedback(message: FeedbackMessage): Promise<FeedbackStored>;
}

/** Everything the tools here call on a client. `ZifferClient` satisfies it
 * structurally; `client.ts` is the one file that knows so. */
export type ZifferSurface = DecisionClient & FeedbackClient;

/** How a tool gets a client, given the environment. Async and fallible: it
 * resolves configuration, so an unset `ZIFFER_API_KEY` surfaces here. */
export type ClientFactory = (env: Env) => Promise<ZifferSurface>;

/**
 * Turn any thrown value into an agent-readable refusal.
 *
 * Every branch narrows with `instanceof`; there is no cast. That matters more
 * than usual here because the input is a `catch` binding: the values this sees
 * include the ones nobody planned for, and an `as` would read a `.clause` off a
 * `TypeError` and report a protocol refusal that never happened
 * (`.claude/rules/static-analysis.md`, and section 8 of the guide says the same
 * thing to the reader).
 */
function refusal(error: unknown): ToolOutcome {
  if (error instanceof ConfigError) {
    return { text: `${error.name}: ${error.message}`, isError: true };
  }
  if (error instanceof ApiRefusal) {
    // The gateway's §1 NAME leads, not the class name. `ApiRefusal` carries
    // that name in `.error` and sets `.name` to its own class, so the generic
    // `Error` branch below would report every gateway refusal as "ApiRefusal"
    // and the agent could not tell `TenantMismatch` from `ApiKeyUnknown` —
    // which are different developer actions. The name is the contract; the
    // status is context.
    return { text: `${error.error}: ${error.message}`, isError: true };
  }
  if (error instanceof AnchorError) {
    return { text: error.message, isError: true };
  }
  if (error instanceof Refusal) {
    // The NAME leads: it says what is wrong with the receipt, and it is what an
    // agent should quote back to a human. The line carries the clause last, the
    // value spelled the same in all three implementations, and the action says
    // what to do.
    return {
      text: `refused: ${error.name}\n${String(error)}\nwhat to do: ${error.action}`,
      isError: true,
    };
  }
  if (error instanceof Error) {
    return { text: `${error.name}: ${error.message}`, isError: true };
  }
  return { text: `UnknownError: ${String(error)}`, isError: true };
}

/** JSON as an agent should read it: stable, indented, and never a bare value. */
function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * `propose` — submit one wire Proposal and return the §1 response verbatim.
 *
 * The proposal is passed through untouched. This server does not fill in a
 * `tenant_id`, and it must not: ACP-197 section 1 makes the KEY the tenant, and
 * a body whose `tenant_id` disagrees is refused rather than rewritten, because
 * the proposal is signed material downstream and a rewriter would have become
 * its author. Helpfully "correcting" the field here would produce exactly the
 * silent authorship the gateway's refusal exists to prevent.
 */
export async function propose(
  clientFor: ClientFactory,
  env: Env,
  proposal: unknown,
): Promise<ToolOutcome> {
  try {
    const client = await clientFor(env);
    return { text: asJson(await client.propose(proposal)), isError: false };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * `check_decision` — one decision by id, receipt included when present.
 *
 * The receipt is re-serialised as part of the response object rather than
 * spliced in as text. That is safe HERE, and only here, because this output is
 * for an agent to read: the copy that gets VERIFIED is the one
 * `explain_receipt` is handed, and the hash it checks is recomputed from the
 * proposal bytes, never from a re-encoding of the receipt. Nothing downstream
 * of this tool treats its text as signed material.
 */
export async function checkDecision(
  clientFor: ClientFactory,
  env: Env,
  decisionId: string,
): Promise<ToolOutcome> {
  try {
    const client = await clientFor(env);
    return { text: asJson(await client.decision(decisionId)), isError: false };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * `whoami` — which customer this key is bound to, and when the key ends.
 *
 * # Why this is two facts and not a policy dump
 *
 * ACP-391 asked for a wide `tenant_info` — epoch, bundle expiry, attester
 * names, the three windows — and its own 2026-09-23 comment shrank it before
 * anything was built, on the grounds that a developer does not hit those: they
 * hit a refusal, and a refusal names its clause. The two facts that are
 * genuinely unanswerable from a laptop are which customer the key in
 * `ZIFFER_API_KEY` belongs to and how long it lasts, and both of them are
 * things an agent guesses wrongly and confidently. The wide version was not
 * built and is not deferred behind a flag: a tool that served signed policy
 * would make this process a second place a deployment's rules can be read,
 * and the SDK never needs them.
 *
 * # The answer is the gateway's, and the key is the question
 *
 * Nothing is sent but the bearer token. This server holds no tenant of its own
 * and could not name one if it wanted to — there is no parameter for it on that
 * route, which is the same rule that makes a `tenant_id` in a proposal a
 * `TenantMismatch` rather than something to rewrite.
 */
export async function whoami(clientFor: ClientFactory, env: Env): Promise<ToolOutcome> {
  try {
    const client = await clientFor(env);
    const identity = await client.whoami();
    return {
      text: [
        asJson(identity),
        '',
        `This key is bound to ${identity.tenant_id} and the gateway accepts it until ${identity.key_expires_at}.`,
        'The tenant comes from the key store, not from anything this machine holds: a proposal',
        'naming a different tenant is refused (TenantMismatch), never rewritten. A key that is',
        'expired, revoked or was never minted answers ApiKeyUnknown and the three cannot be told',
        'apart, so a 401 here does not mean "expired".',
      ].join('\n'),
      isError: false,
    };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * `get_integration_guide` — `docs/onboarding/sdk.md`, for one language.
 *
 * The one tool that needs no configuration, deliberately: an agent should be
 * able to read how to integrate before any credential exists. That is also why
 * `config.ts` lets the server start unconfigured — a server that refused to
 * boot without an API key could not answer the question a developer asks first.
 */
export function getIntegrationGuide(language: string): ToolOutcome {
  const known = asLanguage(language);
  if (known === null) {
    return {
      text: `UnknownLanguage: ${JSON.stringify(language)} is not one of ${LANGUAGES.join(', ')}.`,
      isError: true,
    };
  }
  try {
    return { text: integrationGuide(known), isError: false };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * The marker's naming half (ACP-213). One spelling, and it is not the one that
 * decides: `services/sandbox-approver/src/sandbox.rs` holds the rule that
 * governs, against the tenant the SIGNED bundle names, beside an allowlist of
 * receipt identities no client can see. This copy exists so a developer is told
 * what they are pointed at before they send a proposal, and it says so.
 */
export const SANDBOX_SUFFIX = '-sandbox';

/**
 * Is this tenant id spelled as a sandbox?
 *
 * The suffix has to be attached to something: a tenant literally named
 * `-sandbox` would be a tenant with an empty production name, which satisfies
 * the convention while meaning nothing. Same rule, same words, as the Rust
 * predicate and `tools/provision-sandbox.py`.
 */
export function isSandboxName(tenantId: string): boolean {
  return tenantId.length > SANDBOX_SUFFIX.length && tenantId.endsWith(SANDBOX_SUFFIX);
}

/** What `sandbox_status` is handed. */
export interface SandboxArgs {
  /** The tenant id the caller's proposals carry. */
  readonly tenantId: string;
  /** A decision to ask the API about, for the approver's liveness. Optional:
   * the naming half is answerable without one, and saying so is better than
   * requiring an id a developer may not have yet. */
  readonly decisionId?: string;
}

/**
 * `sandbox_status` — say whether this tenant is a sandbox, and whether the
 * robot approver has acted on one decision.
 *
 * # What it can establish, and what it cannot
 *
 * It reports the NAMING half of the marker over the tenant id the caller will
 * actually send, and it names the half it cannot see. The binding half — that
 * this tenant's receipt signing identity is registered in the robot's
 * allowlist — is checked inside the deployment, against signed policy, on every
 * `/v1/present`. There is no endpoint that exposes it and this tool does not
 * invent one: a client-side "you are in a sandbox" that rested on nothing would
 * be worse than no answer, because a developer would plan around it.
 *
 * Liveness is the same discipline. There is no health route on the gateway, so
 * the honest signal is one decision's own status. **The signature of a stopped
 * robot is `decided` with `outcome: "ATTEST"` and no receipt** — not `pending`,
 * which is what this said until the 2026-09-03 live run of
 * `tools/rehearse/03-loop.sh` showed a floor-HIGH sandbox proposal answering
 * `decided`/`ATTEST` in the POST itself and never passing through `pending` at
 * all. So the advice that could never fire moved to the branch that sees the
 * real thing. A quorum-awaiting decision keeps that outcome and grows a
 * RECEIPT; a decision that never grows one is the robot being stopped or
 * mis-enrolled, and the text says which of the cases it saw rather than
 * reducing them to a green tick.
 *
 * # Why the tenant is an argument and not configuration
 *
 * Because this server has never held a tenant name and must not start: ACP-197
 * section 1 makes the KEY the tenant, and a `ZIFFER_TENANT` variable would be a
 * second statement of it that could disagree with the key. The tenant id is a
 * value the caller already writes into every proposal — where the gateway binds
 * it, refusing `TenantMismatch` rather than rewriting it — so checking the
 * string the caller is about to send is checking the thing that matters.
 */
export async function sandboxStatus(
  clientFor: ClientFactory,
  env: Env,
  args: SandboxArgs,
): Promise<ToolOutcome> {
  const tenant = args.tenantId.trim();
  if (tenant === '') {
    return {
      text: 'TenantUnnamed: pass the tenant_id your proposals carry; this server holds no tenant of its own.',
      isError: true,
    };
  }

  const lines: string[] = [`tenant: ${JSON.stringify(tenant)}`];
  if (isSandboxName(tenant)) {
    lines.push(
      `sandbox: yes, by name — it ends in "${SANDBOX_SUFFIX}".`,
      '  What that guarantees: a sandbox tenant is a SEPARATE tenant whose bundle names its own',
      '  receipt signing identity, so receipts issued here are signed by a different key and a',
      '  production verifier refuses them (clause 9.3-1). You cannot get a production-valid',
      '  receipt out of a sandbox, by construction rather than by policy.',
      '  What it does NOT mean: the action is not performed for real by anything Ziffer runs, and',
      '  approvals here are made by a robot approver with no human in them. Treat every ALLOW as',
      '  "the path worked", never as "someone agreed".',
      '  What this tool cannot see: the other half of the marker is an allowlist of receipt',
      '  identities the robot approver reads out of signed policy inside the deployment. It is',
      '  checked there, on every approval, and no client can observe it.',
    );
  } else {
    lines.push(
      `sandbox: no, by name — it does not end in "${SANDBOX_SUFFIX}".`,
      '  Receipts for this tenant are production receipts and its approvals are made by whoever',
      '  its bundle enrols. Nothing here is auto-approved. If you meant to be in a sandbox, you',
      `  want the separate tenant "${tenant}${SANDBOX_SUFFIX}" and its own API key — the key`,
      '  determines the tenant, so pointing at a sandbox is a credential change, not a flag.',
    );
  }

  const decisionId = args.decisionId?.trim();
  if (decisionId === undefined || decisionId === '') {
    lines.push(
      'approver: not checked — pass decision_id to have this tool ask the API about one decision.',
    );
    return { text: lines.join('\n'), isError: false };
  }

  try {
    const client = await clientFor(env);
    const record = await client.decision(decisionId);
    const outcome = record.outcome === undefined ? '' : ` outcome ${record.outcome}`;
    const category =
      record.refusal_category === undefined ? '' : ` refusal_category ${record.refusal_category}`;
    const held = record.held_until === undefined ? '' : ` held_until ${record.held_until}`;
    if (record.status === 'decided') {
      lines.push(`approver: decision ${record.decision_id} is decided —${outcome}${category}${held}`.trimEnd());
      if (record.receipt === undefined) {
        lines.push(
          '  No signed receipt is attached, so nothing here is verifiable: read the refusal category. A',
          '  decided path is evidence the deployment answered, not that a quorum formed.',
        );
        if (record.outcome === 'ATTEST') {
          lines.push(
            '  ATTEST is the §8.6 quorum gate and not a refusal — this decision is waiting on',
            '  approvers, and in a sandbox that is the robot. The receipt attaches to THIS same',
            '  decision on a later check_decision while the outcome stays ATTEST, so poll for the',
            '  RECEIPT and never for a change of outcome. Do not re-propose: a second proposal is',
            '  a second action. A decided ATTEST that never grows a receipt is what a stopped or',
            '  mis-enrolled robot approver looks like from out here. There is no health endpoint;',
            '  this is the only liveness signal the API exposes.',
          );
        }
      } else {
        lines.push(
          '  A signed receipt is attached. Verify it with explain_receipt: this tool checked no',
          '  signature, and a status field is not a signature.',
        );
      }
    } else {
      lines.push(
        `approver: decision ${record.decision_id} is still pending.`,
        '  Pending means the deployment has not answered this decision yet. It is NOT the',
        '  signature of a stopped approver: a decision waiting on its quorum reads decided with',
        '  outcome ATTEST and no receipt, never pending. Ask again in a moment.',
      );
    }
    return { text: lines.join('\n'), isError: false };
  } catch (error) {
    // The naming half already held, and losing it would make a gateway blip
    // read as "your tenant is not a sandbox". The refusal is appended, with its
    // own name intact, rather than replacing what was established.
    const failed = refusal(error);
    return { text: `${lines.join('\n')}\napprover: not established — ${failed.text}`, isError: true };
  }
}

/**
 * The proposal bytes, or the refusal text naming what is wrong with them.
 *
 * ONE reader, used by both `explain_receipt` and `get_decision`, because the
 * argument is the same argument: the exact bytes the caller's own code hashed.
 * A second decode beside it would be a second opinion about what `proposal_b64`
 * means, and the one that drifted would be the one an agent happened to call.
 *
 * Node's base64 decoder is LENIENT: it drops characters it does not recognise
 * rather than throwing, so a caller who passed hex, or a JSON string, gets
 * silent garbage and a 9.3-3 refusal blaming the receipt. Re-encoding and
 * comparing is the cheap way to catch that, and the refusal then names the
 * argument rather than the receipt.
 */
function decodeProposalB64(raw: string): Uint8Array | string {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
  } catch {
    return 'ProposalBytesMalformed: proposal_b64 is not base64.';
  }
  if (Buffer.from(bytes).toString('base64') !== raw.trim()) {
    return (
      'ProposalBytesMalformed: proposal_b64 did not survive a base64 round trip, so it is not the encoding it claims.\n' +
      '  Pass the bytes your code passes to verify, base64-encoded.'
    );
  }
  return bytes;
}

/** What `explain_receipt` is handed. */
export interface ExplainArgs {
  /** The receipt, as parsed JSON. Passed to `@ziffer-io/verify` untouched. */
  readonly receipt: unknown;
  /** The EXACT proposal bytes the caller's own code hashed, base64. */
  readonly proposalB64: string;
  /** Overrides `ZIFFER_TRUST_ANCHOR` for this call. */
  readonly trustAnchorPath?: string;
}

/**
 * `explain_receipt` — verify a receipt and say `valid` or the named clause.
 *
 * **Zero verification logic of its own.** Every check is `@ziffer-io/verify`'s; this
 * function reads a key file, decodes a base64 argument and formats an answer.
 * A second verifier living in a developer-tools package would be a fourth
 * implementation of §9.3 whose disagreements with the other three would be
 * discovered by a customer.
 *
 * # Why the proposal arrives as bytes and not as an object
 *
 * Because `verifyReceipt` takes bytes, and this tool exists to reproduce the
 * call the developer's own code makes. Accepting an object and encoding it here
 * would put an encoding step between their input and the verifier that their
 * production path does not have, and it would hide one real failure class
 * outright: bytes that are not UTF-8 JSON at all — a truncated read, a
 * double-encoded string, a compressed body — which the verifier refuses under
 * `AT-8a`. Handed an object, this tool could never see that.
 *
 * What it is NOT for is key order. An earlier draft of this file, and of the
 * guide, claimed the caller had to pass `canon(proposal)` and that
 * `JSON.stringify` would produce a spurious `9.3-3`. That is false, and the
 * check that showed it was running all three encodings through this function:
 * `verifyReceipt` PARSES these bytes and canonicalises them itself, because the
 * hash is defined over the canonical encoding rather than over the transport's
 * spacing (`verify.ts` step 3; the Python SDK's `verify` does the same). Any
 * JSON spelling of one object verifies. The hint below therefore names the
 * cause that is real — a different object — rather than the one that reads
 * plausibly.
 */
export async function explainReceipt(env: Env, args: ExplainArgs): Promise<ToolOutcome> {
  try {
    const config = anchorConfig(env, args.trustAnchorPath);
    const anchor = await loadTrustAnchor(config.anchorPath, config.suiteFloor);

    const decoded = decodeProposalB64(args.proposalB64);
    if (typeof decoded === 'string') {
      return { text: decoded, isError: true };
    }

    const verified = verifyReceipt(args.receipt, decoded, anchor);
    return {
      text:
        `valid: bound to ${verified.proposalHash}\n` +
        `  suite floor ${config.suiteFloor}, anchor ${config.anchorPath}\n` +
        `  receipt expires at ${new Date(verified.receiptExpiresAt * 1000).toISOString()}\n` +
        '  This receipt verified. It says nothing about whether it was already used:\n' +
        '  replay is a claim against a ledger this process cannot reach (guide section 6, item 2).',
      isError: false,
    };
  } catch (error) {
    const outcome = refusal(error);
    if (error instanceof Refusal && error.clause === '9.3-3') {
      // The one refusal worth a hint, because the obvious suspect is the wrong
      // one. Appended to the named clause, never substituted for it.
      return {
        text:
          `${outcome.text}\n` +
          '  The receipt is bound to a DIFFERENT proposal. It is not key order or whitespace:\n' +
          '  the verifier parses these bytes and canonicalises them itself, so any JSON spelling\n' +
          '  of one object hashes the same. Look for a changed field value, a field added or\n' +
          '  dropped after the proposal was submitted, or the receipt of another decision.',
        isError: true,
      };
    }
    return outcome;
  }
}

/**
 * `list_decisions` — `GET /v1/decisions`, verbatim (ACP-390).
 *
 * # The route already existed, and that is the finding worth recording
 *
 * ACP-390 asked whether a tenant-scoped, key-authenticated LIST exists or
 * whether one had to be added to the gateway. It exists:
 * `services/gateway/src/http.rs` routes `GET /v1/decisions` to `Gateway::list`,
 * which resolves the tenant with `tenant_of(token)` — from the API KEY and
 * nothing else — and parses `since`, `limit` and `cursor` under the one strict
 * WE-5 grammar. `ZifferClient.list` already wraps it. So this tool is a wrapper
 * over a wrapper and adds no route, which is the right amount of code: the
 * alternative the ticket warned against, a client-side list assembled out of
 * ids this package had seen, would have been a second and quieter definition of
 * what a customer's decision list is.
 *
 * The page is returned as it arrives. Every bad parameter is ONE refusal,
 * `ListQueryMalformed`, and the API deliberately does not say which — the same
 * reason a row carries no clause.
 */
export async function listDecisions(
  clientFor: ClientFactory,
  env: Env,
  args: ListArgs,
): Promise<ToolOutcome> {
  try {
    const client = await clientFor(env);
    // exactOptionalPropertyTypes: an omitted argument must be an ABSENT
    // property. A present `undefined` would reach the client as a parameter it
    // then renders into the query string, and the gateway refuses the whole
    // query rather than telling anyone which one was wrong.
    const options: ListArgs = {
      ...(args.since === undefined ? {} : { since: args.since }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    };
    return { text: asJson(await client.list(options)), isError: false };
  } catch (error) {
    return refusal(error);
  }
}

// ---------------------------------------------------------- send_feedback

/**
 * `send_feedback` — tell ZIFFER what our documentation did not answer
 * (ACP-392 item 3).
 *
 * # This is the one tool here whose text leaves the machine
 *
 * `propose` and `check_decision` send a Proposal the developer's own code
 * wrote. This sends words a MODEL wrote, about a developer's work, to us, to
 * be read by a person. That is a different kind of act and the difference is
 * stated in three places rather than one: in this comment, in the tool's
 * description (which is what the model reads before calling it), and in the
 * answer below (which is what it reads after). A tool that quietly posted a
 * developer's question would be the wrong default even if every question were
 * harmless.
 *
 * # What is NOT checked here, and why that is right
 *
 * The size and the rate. Both are the gateway's — `services/gateway/src/
 * feedback.rs` holds the cap and the bucket — and a copy of either number
 * here would be a second definition of a limit the server enforces, which is
 * the shape that ends with a client refusing what the server would have
 * accepted or waving through what it refuses. An over-size or over-rate
 * message comes back as the gateway's own named refusal, which is what the
 * answer reports.
 *
 * There is also no filtering of the text. This package holds no rule about
 * what a developer may say to us, and a redactor here would be a filter with
 * an unreadable policy standing between a customer and their support channel.
 * The honest control is the one above: SAY what is sent.
 */
export async function sendFeedback(
  clientFor: ClientFactory,
  env: Env,
  message: FeedbackMessage,
): Promise<ToolOutcome> {
  const tool = message.tool.trim();
  const question = message.question.trim();
  const context = message.context?.trim();
  if (tool === '' || question === '') {
    // Refused here rather than sent: an empty question is a caller bug, and
    // posting it turns a local defect into a remote 400 whose answer points
    // at the wrong component (`ZifferClient`'s rule in its constructor).
    return {
      text:
        'FeedbackIncomplete: both tool and question must be non-empty. `tool` is which tool ' +
        'could not answer; `question` is what you asked, in your own words.',
      isError: true,
    };
  }
  try {
    const client = await clientFor(env);
    const stored = await client.feedback({
      tool,
      question,
      // exactOptionalPropertyTypes: an absent context must be an ABSENT
      // property, not one present and holding undefined -- the same
      // distinction `explain_receipt` makes for its anchor override, and the
      // one the gateway's closed shape would otherwise refuse.
      ...(context === undefined || context === '' ? {} : { context }),
    });
    return {
      text:
        `stored for tenant ${stored.tenant}.\n` +
        '  The text you sent is now a line in a file an operator reads. It was not filtered, ' +
        'summarised or redacted on the way.\n' +
        '  Nothing answers back through this tool: an answer comes from hello@ziffer.io, to ' +
        'the people who hold this API key.',
      isError: false,
    };
  } catch (error) {
    return refusal(error);
  }
}

/** What `get_decision` is handed. */
export interface GetDecisionArgs {
  /** The decision to fetch. */
  readonly decisionId: string;
  /** The EXACT proposal bytes the caller's own code hashed, base64. Optional,
   * and its absence is answered rather than worked around — see
   * {@link getDecision}. */
  readonly proposalB64?: string;
}

/**
 * `get_decision` — one decision whose receipt is VERIFIED before it is
 * returned, or a named refusal (ACP-390).
 *
 * # Why this is not `check_decision` with a flag
 *
 * `check_decision` serves the gateway's answer verbatim, receipt included,
 * unverified, and says so. That tool is honest and stays. This one makes a
 * different promise, and the promise is the whole of it: **a receipt that comes
 * out of here verified.** The two cannot be one tool with an argument, because
 * then the strong sentence would be true only on some calls and an agent would
 * have to read the arguments to know which.
 *
 * # Why the proposal bytes are the caller's, and why their absence is answered
 *
 * `verifyReceipt` recomputes `proposal_hash` from bytes the CALLER supplies.
 * That is not an API inconvenience, it is RES-9: a transmitted identifier is a
 * name for a binding and not evidence of one, so a verifier that took the
 * receipt's own hash — or re-derived the proposal from the decision it is
 * verifying — would be accepting a derived security value from the party it is
 * verifying. There is no proposal on this side of the wire to hash.
 *
 * So with no `proposal_b64` there is nothing that could be verified, and this
 * tool **withholds the receipt** and says why rather than handing back an
 * unverified one under a tool named for verification. The status, outcome and
 * clause still come back, because those are what a poll is for.
 */
export async function getDecision(
  clientFor: ClientFactory,
  env: Env,
  args: GetDecisionArgs,
): Promise<ToolOutcome> {
  let record: DecisionRecord;
  try {
    const client = await clientFor(env);
    record = await client.decision(args.decisionId);
  } catch (error) {
    return refusal(error);
  }

  // The gateway's object minus the receipt. The receipt is put back only by the
  // branch that verified it, so there is no path through this function on which
  // an unverified receipt is reachable by forgetting a case.
  const decision: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'receipt') decision[key] = value;
  }

  const answer = (verification: Record<string, unknown>, receipt?: unknown): string =>
    asJson(receipt === undefined ? { decision, verification } : { decision, receipt, verification });

  if (record.receipt === undefined) {
    return {
      text: answer({
        status: 'absent',
        detail:
          'This decision carries no signed receipt. That is not a refusal on its own: a decision ' +
          'waiting on its quorum reads decided with outcome ATTEST and grows a receipt later, so ' +
          'poll for the RECEIPT rather than for a change of outcome, and do not re-propose — a ' +
          'second proposal is a second action.',
      }),
      isError: false,
    };
  }

  if (args.proposalB64 === undefined || args.proposalB64.trim() === '') {
    return {
      text: answer({
        status: 'not attempted',
        detail:
          'A receipt is attached and it has been WITHHELD, because nothing here could verify it. ' +
          'The binding is recomputed from the proposal bytes your own code hashed, never from the ' +
          "receipt's own claim about itself, so verification needs those bytes: call this again " +
          'with proposal_b64. check_decision serves the same decision with its receipt unverified ' +
          'if that is what you want, and says so.',
      }),
      isError: true,
    };
  }

  const decoded = decodeProposalB64(args.proposalB64);
  if (typeof decoded === 'string') {
    return { text: answer({ status: 'not attempted', detail: decoded }), isError: true };
  }

  try {
    const config = anchorConfig(env);
    const anchor = await loadTrustAnchor(config.anchorPath, config.suiteFloor);
    const verified = verifyReceipt(record.receipt, decoded, anchor);
    return {
      text: answer(
        {
          status: 'verified',
          proposal_hash: verified.proposalHash,
          suite_floor: config.suiteFloor,
          anchor: config.anchorPath,
          expires_at: new Date(verified.receiptExpiresAt * 1000).toISOString(),
          detail:
            'This receipt verified under the configured anchor. It says nothing about whether it ' +
            'was already used: replay is a claim against a ledger this process cannot reach.',
        },
        record.receipt,
      ),
      isError: false,
    };
  } catch (error) {
    const failed = refusal(error);
    return {
      text: answer({
        status: 'refused',
        ...(error instanceof Refusal ? { refusal: error.name, clause: error.clause } : {}),
        detail: failed.text,
      }),
      isError: true,
    };
  }
}

/** Re-exported so `server.ts` and the tests name one canonicalisation. */
export { canon };
