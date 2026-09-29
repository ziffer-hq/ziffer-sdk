/**
 * The four tool handlers (ACP-197, section 6b point 5).
 *
 * # Where the stub sits, and why not at HTTP
 *
 * The runbook asks for a stub HTTP server. The stub is at {@link ZifferSurface}
 * instead — the seam these handlers actually consume — because
 * `packages/acp-client` already drives a stub HTTP server over every §1 status
 * and shape in `client.test.ts`, and a second one here would test that package
 * again rather than this one. What these tests own is the layer above: that a
 * gateway refusal reaches the agent under the GATEWAY's name and not the error
 * class's, that a DENY is not framed as a tool failure, and that an
 * unconfigured server sends nothing. Every §1 response shape and named refusal
 * is driven through the seam, using @ziffer-io/client's own `ApiRefusal` so the
 * refusal objects are the real ones.
 *
 * # What is NOT tested here, on purpose
 *
 * `explain_receipt` does no verification of its own, so the crypto lives in
 * `@ziffer-io/verify`'s own suite and is not re-asserted here — the same rule §6
 * states for `@ziffer-io/client` ("zero crypto tests here"). What IS asserted is that
 * the wiring is live: a real refusal from the real verifier arrives with its
 * clause intact, and the one branch this package adds on top of a verifier
 * verdict — the 9.3-3 hint — is exercised against a genuinely signed receipt
 * rather than asserted by reading the source.
 */

import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
// By its workspace path on purpose: `testkeys` is deliberately absent from the
// verify package's index, its tarball and its export map, because a deployment
// must never load keys from it. A test using it is that intent, not an
// exception to it -- and the alternative, re-deriving the seed scheme here,
// would be two definitions of one identity.
import { hybridKeyFromSeed } from '../../acp-verify/dist/testkeys.js';
import { canon } from '@ziffer-io/verify';

import {
  ApiRefusal,
  DeadlineExceeded,
  ResponseMalformed,
  ERROR_ADMISSION_UNAVAILABLE,
  ERROR_API_KEY_UNKNOWN,
  ERROR_DECISION_UNKNOWN,
  ERROR_PROPOSAL_MALFORMED,
  ERROR_TENANT_MISMATCH,
} from '@ziffer-io/client';

import { classifyReach, ServiceUnreachable, zifferClientFactory } from './client.js';
import { VARS, type Env } from './config.js';
import {
  checkDecision,
  explainReceipt,
  getDecision,
  getIntegrationGuide,
  isSandboxName,
  listDecisions,
  propose,
  SANDBOX_SUFFIX,
  sandboxStatus,
  whoami,
  type ClientFactory,
  type DecisionClient,
  type DecisionListItem,
  type ZifferSurface,
  type DecisionRecord,
  type ListArgs,
  type SubmittedDecision,
} from './tools.js';

const dir = mkdtempSync(join(tmpdir(), 'ziffer-mcp-tools-'));

const KEY = hybridKeyFromSeed('mcp-test');
const SUITE = 'hybrid-ed25519-mldsa65';

const ANCHOR_PATH = join(dir, 'anchor.json');
writeFileSync(
  ANCHOR_PATH,
  JSON.stringify({
    ed25519_pk_hex: Buffer.from(KEY.classical).toString('hex'),
    mldsa65_pk_hex: Buffer.from(KEY.pq).toString('hex'),
  }),
);

const ENV: Env = {
  [VARS.API_URL]: 'https://api.example.test',
  [VARS.API_KEY]: 'zfr_' + 'a'.repeat(43),
  [VARS.TRUST_ANCHOR]: ANCHOR_PATH,
  [VARS.SUITE_FLOOR]: SUITE,
};

/** A client that answers, for the shape under test.
 *
 * Every call not stubbed REJECTS rather than returning a benign value: a
 * default answer here would let a test pass over a call it never meant to
 * make, which is how a tool that quietly posts feedback would go unnoticed. */
function clientReturning(answers: Partial<ZifferSurface>): ClientFactory {
  return async () => ({
    propose: answers.propose ?? (() => Promise.reject(new Error('propose not stubbed'))),
    decision: answers.decision ?? (() => Promise.reject(new Error('decision not stubbed'))),
    // A method that REJECTS by default rather than one returning an empty
    // page: an empty page is an answer, and a test that forgot to stub the
    // call it is about would pass against it.
    list: answers.list ?? (() => Promise.reject(new Error('list not stubbed'))),
    feedback: answers.feedback ?? (() => Promise.reject(new Error('feedback not stubbed'))),
    whoami: answers.whoami ?? (() => Promise.reject(new Error('whoami not stubbed'))),
  });
}

/**
 * A client that refuses the way the real one does.
 *
 * `ApiRefusal` is @ziffer-io/client's own class, not a stand-in: it sets `.name` to
 * `'ApiRefusal'` and carries the gateway's §1 name in `.error`, so a handler
 * that reported `.name` would tell every agent "ApiRefusal" and hide which
 * refusal it was. Using the real class is what makes that assertable.
 */
function clientRejecting(status: number, name: string): ClientFactory {
  const error = new ApiRefusal(status, name);
  return async () => ({
    propose: () => Promise.reject(error),
    decision: () => Promise.reject(error),
    list: () => Promise.reject(error),
    feedback: () => Promise.reject(error),
    whoami: () => Promise.reject(error),
  });
}

const PROPOSAL = {
  schema_id: 'example.transfer',
  schema_version: '1',
  schema_hash: 'sha256:' + '11'.repeat(32),
  fidelity: 'PROVEN',
  tenant_id: 't1',
  payload: { amount: 100 },
};

// ------------------------------------------------------------------ propose

test('propose returns the §1 accepted response verbatim', async () => {
  const answer: SubmittedDecision = { decision_id: '01j0abc', status: 'pending' };
  const out = await propose(clientReturning({ propose: async () => answer }), ENV, PROPOSAL);
  assert.equal(out.isError, false);
  // Verbatim: the §1 field spelling survives, so an agent reading the guide's
  // HTTP examples sees the same names coming out of the tool.
  assert.deepEqual(JSON.parse(out.text), answer);
});

test('propose returns an already-decided response, including outcome and refusal_category', async () => {
  const answer: SubmittedDecision = {
    decision_id: '01j0abc',
    status: 'decided',
    outcome: 'DENY',
    refusal_category: 'PolicyRefused',
  };
  const out = await propose(clientReturning({ propose: async () => answer }), ENV, PROPOSAL);
  // A denial is NOT a tool error: the tool was asked for a decision and got
  // one. Flagging it would teach an agent that "the policy said no" is a
  // malfunction to route around, which is the behaviour this system exists to
  // prevent.
  assert.equal(out.isError, false);
  assert.equal(JSON.parse(out.text).outcome, 'DENY');
});

test('propose passes the proposal through untouched', async () => {
  let seen: unknown = null;
  await propose(
    clientReturning({
      propose: async (proposal) => {
        seen = proposal;
        return { decision_id: 'x', status: 'pending' };
      },
    }),
    ENV,
    PROPOSAL,
  );
  // ACP-197 §1: a mismatched tenant_id is REFUSED, never rewritten, because the
  // proposal is signed material downstream. A helpful correction here would be
  // exactly the silent authorship that refusal exists to prevent.
  assert.deepEqual(seen, PROPOSAL);
});

test('every §1 refusal reaches the agent under the gateway s name, not the class s', async () => {
  // The trap this closes: ApiRefusal.name is 'ApiRefusal' for all five, so a
  // handler reporting `.name` passes a weaker version of this test while
  // telling every agent the same useless string. Asserting the NAME leads is
  // what distinguishes them -- and they are different developer actions:
  // ApiKeyUnknown is a credential, TenantMismatch is the body.
  const cases: ReadonlyArray<readonly [number, string]> = [
    [401, ERROR_API_KEY_UNKNOWN],
    [403, ERROR_TENANT_MISMATCH],
    [400, ERROR_PROPOSAL_MALFORMED],
    [502, ERROR_ADMISSION_UNAVAILABLE],
  ];
  for (const [status, name] of cases) {
    const out = await propose(clientRejecting(status, name), ENV, PROPOSAL);
    assert.equal(out.isError, true, `${name} was not reported as an error`);
    assert.match(out.text, new RegExp(`^${name}: `), `${name} was not named first`);
    assert.doesNotMatch(out.text, /^ApiRefusal/, `${name} was reported as the class name`);
    // The status is context and is carried, but it is not what leads.
    assert.match(out.text, new RegExp(`HTTP ${status}`));
  }
});

test('a missing api key stops propose before a client is ever built', async () => {
  // The PRODUCTION factory: it resolves configuration and then constructs.
  // With the key absent it must refuse at the first step, so nothing is
  // constructed and no socket is opened. Failing closed did not become failing
  // open when the refusal moved from process exit to tool result.
  const env: Record<string, string | undefined> = { ...ENV };
  delete env[VARS.API_KEY];
  const out = await propose(zifferClientFactory, env, PROPOSAL);
  assert.equal(out.isError, true);
  assert.match(out.text, /ApiKeyUnconfigured/);
  assert.match(out.text, new RegExp(`Set ${VARS.API_KEY}\\.`));
});

test('the production factory builds a real client once configuration resolves', async () => {
  // No network here: reaching a constructed ZifferClient is the assertion. What
  // it proves is that the factory gets PAST config resolution and that
  // ZifferClient satisfies ZifferSurface structurally -- if §6's surface and
  // the interface in tools.ts ever diverge, this is where it fails to compile.
  const client = await zifferClientFactory(ENV);
  assert.equal(typeof client.propose, 'function');
  assert.equal(typeof client.decision, 'function');
});

// ----------------------------------------------------------- check_decision

test('check_decision returns the §1 GET response, receipt included when present', async () => {
  const receipt = { receipt_version: 3, decision: 'ALLOW' };
  const answer: DecisionRecord = {
    decision_id: '01j0abc',
    status: 'decided',
    outcome: 'ALLOW',
    receipt,
  };
  const out = await checkDecision(clientReturning({ decision: async () => answer }), ENV, '01j0abc');
  assert.equal(out.isError, false);
  assert.deepEqual(JSON.parse(out.text), answer);
});

test('check_decision returns a pending decision with no receipt field at all', async () => {
  const answer: DecisionRecord = { decision_id: '01j0abc', status: 'pending' };
  const out = await checkDecision(clientReturning({ decision: async () => answer }), ENV, '01j0abc');
  const parsed: Record<string, unknown> = JSON.parse(out.text);
  // Absent, not null: an optional that arrives as null is the defect codegen
  // closes on the wire root, and an agent seeing "receipt": null could read it
  // as a receipt that exists and is empty.
  assert.equal('receipt' in parsed, false);
  assert.equal(parsed['status'], 'pending');
});

test('an unknown id is DecisionUnknown, the same as another tenant s id', async () => {
  const out = await checkDecision(clientRejecting(404, ERROR_DECISION_UNKNOWN), ENV, '01j0zzz');
  assert.equal(out.isError, true);
  assert.match(out.text, /^DecisionUnknown: /);
});

// ---------------------------------------------------------- explain_receipt

/** Sign a receipt body under KEY, as the reference's `sign()` does (CR-2 hex). */
function signed(body: Record<string, unknown>): Record<string, unknown> {
  const bytes = canon(body);
  return {
    ...body,
    sig: {
      classical: Buffer.from(ed25519.sign(bytes, KEY.edSecret)).toString('hex'),
      pq: Buffer.from(ml_dsa65.sign(bytes, KEY.pqSecret)).toString('hex'),
    },
  };
}

/** A receipt valid at this process's real clock: explain_receipt takes no
 * clock argument, deliberately -- a debugging tool that let the caller choose
 * "now" would answer a question the caller's production code never asks. */
function receiptFor(proposal: unknown): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const iso = (t: number): string => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return signed({
    receipt_version: 3,
    alg: SUITE,
    decision: 'ALLOW',
    proposal_hash: `sha256:${createHash('sha256').update(canon(proposal)).digest('hex')}`,
    tenant_id: 't1',
    operator: 'op-1',
    issued_at: iso(now - 10),
    expires_at: iso(now + 60),
    nonce: 'b64:AAAAAAAAAAAAAAAAAAAAAA==',
  });
}

const PROPOSAL_B64 = Buffer.from(canon(PROPOSAL)).toString('base64');

test('a valid receipt reports the hash it is bound to', async () => {
  const out = await explainReceipt(ENV, {
    receipt: receiptFor(PROPOSAL),
    proposalB64: PROPOSAL_B64,
  });
  assert.equal(out.isError, false, out.text);
  assert.match(out.text, /^valid: bound to sha256:[0-9a-f]{64}$/m);
  // The hash reported is the verifier's OWN recomputation from the bytes passed
  // in, never the receipt's claim (RES-8). Same bytes, same value.
  const expected = createHash('sha256').update(canon(PROPOSAL)).digest('hex');
  assert.match(out.text, new RegExp(`bound to sha256:${expected}`));
  // A verified receipt says nothing about replay, and the answer says so: an
  // agent told only "valid" would reasonably conclude it was safe to act twice.
  assert.match(out.text, /says nothing about whether it was already used/);
});

test('a receipt bound to other bytes is refused 9.3-3, with the cause named', async () => {
  const out = await explainReceipt(ENV, {
    receipt: receiptFor({ ...PROPOSAL, payload: { amount: 999 } }),
    proposalB64: PROPOSAL_B64,
  });
  assert.equal(out.isError, true);
  // The name leads; the rule is still on the line, last, in brackets.
  assert.match(out.text, /^refused: ReceiptNotBoundToProposal\n/);
  assert.match(out.text, /\(9\.3-3\)\n/);
  assert.match(out.text, /what to do: /);
  // The hint is the one thing this package adds on top of a verifier verdict,
  // and it is appended to the clause rather than substituted for it. It must
  // name the REAL cause: an earlier draft blamed key order, which the test
  // below proves is not a cause at all.
  assert.match(out.text, /bound to a DIFFERENT proposal/);
  assert.match(out.text, /not key order or whitespace/);
});

test('any JSON spelling of one proposal verifies: the verifier re-canonicalises', async () => {
  // This is a CORRECTION, kept as a test so it cannot quietly reverse. The
  // package (and docs/onboarding/sdk.md) once told developers they had to pass
  // canon(proposal) and that JSON.stringify would produce a spurious 9.3-3.
  // Both verifiers parse these bytes and canonicalise them themselves, because
  // the hash is defined over the canonical encoding and not over the
  // transport's spacing -- so all three spellings below are the same receipt.
  // If a future change made the hash depend on the caller's byte spelling, the
  // guide's advice and this tool's hint would both become wrong, and this is
  // what would say so.
  const unordered = { tenant_id: 't1', payload: { amount: 100 }, schema_id: 'z' };
  const receipt = receiptFor(unordered);
  const spellings: ReadonlyArray<readonly [string, Buffer]> = [
    ['canon', Buffer.from(canon(unordered))],
    ['JSON.stringify, insertion order', Buffer.from(JSON.stringify(unordered))],
    ['JSON.stringify, indented', Buffer.from(JSON.stringify(unordered, null, 2))],
  ];
  for (const [label, bytes] of spellings) {
    const out = await explainReceipt(ENV, {
      receipt,
      proposalB64: bytes.toString('base64'),
    });
    assert.equal(out.isError, false, `${label} was refused: ${out.text}`);
  }
});

test('a real refusal from the real verifier arrives with its clause intact', async () => {
  const receipt = receiptFor(PROPOSAL);
  receipt['receipt_version'] = 2;
  const out = await explainReceipt(ENV, { receipt, proposalB64: PROPOSAL_B64 });
  assert.equal(out.isError, true);
  // AB-0, from @ziffer-io/verify -- proof the wiring reaches the verifier rather than
  // this package deciding anything for itself.
  assert.match(out.text, /^refused: ReceiptVersionUnsupported\nReceiptVersionUnsupported: .* \(AB-0\)\n/);
});

test('explain_receipt refuses an unconfigured anchor or floor by variable', async () => {
  for (const [variable, refusal] of [
    [VARS.TRUST_ANCHOR, 'TrustAnchorUnconfigured'],
    [VARS.SUITE_FLOOR, 'SuiteFloorUnconfigured'],
  ] as const) {
    const env: Record<string, string | undefined> = { ...ENV };
    delete env[variable];
    const out = await explainReceipt(env, {
      receipt: receiptFor(PROPOSAL),
      proposalB64: PROPOSAL_B64,
    });
    assert.equal(out.isError, true);
    assert.match(out.text, new RegExp(refusal));
    assert.match(out.text, new RegExp(`Set ${variable}\\.`));
  }
});

test('the trust_anchor_path argument overrides the variable', async () => {
  const env: Record<string, string | undefined> = { ...ENV };
  delete env[VARS.TRUST_ANCHOR];
  const out = await explainReceipt(env, {
    receipt: receiptFor(PROPOSAL),
    proposalB64: PROPOSAL_B64,
    trustAnchorPath: ANCHOR_PATH,
  });
  assert.equal(out.isError, false, out.text);
});

test('an anchor that is a signing key is refused before anything is verified', async () => {
  const keyPath = join(dir, 'secret.json');
  writeFileSync(keyPath, JSON.stringify({ ed25519_sk_hex: 'ef'.repeat(32) }));
  const out = await explainReceipt(ENV, {
    receipt: receiptFor(PROPOSAL),
    proposalB64: PROPOSAL_B64,
    trustAnchorPath: keyPath,
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /TrustAnchorHoldsSecret/);
});

test('proposal_b64 that is not base64 is refused as the argument, not as the receipt', async () => {
  // Node's base64 decoder DROPS characters it does not recognise rather than
  // throwing, so hex or raw JSON here would decode to silent garbage and
  // produce a 9.3-3 that blames a perfectly good receipt.
  for (const bad of ['not base64!!', Buffer.from(canon(PROPOSAL)).toString('hex'), '{"a":1}']) {
    const out = await explainReceipt(ENV, { receipt: receiptFor(PROPOSAL), proposalB64: bad });
    assert.equal(out.isError, true, `${bad.slice(0, 20)} was accepted`);
    assert.match(out.text, /^ProposalBytesMalformed: /);
  }
});

test('a receipt that is not an object is refused, never crashed on', async () => {
  for (const junk of [null, 'a string', 42, []]) {
    const out = await explainReceipt(ENV, { receipt: junk, proposalB64: PROPOSAL_B64 });
    assert.equal(out.isError, true);
    assert.match(out.text, /^refused: /);
  }
});

// ----------------------------------------------------- get_integration_guide

test('get_integration_guide needs no configuration at all', () => {
  // The point of starting unconfigured: an agent can read how to integrate
  // before any credential exists. Asserted with an EMPTY environment, so this
  // stays true if a future tool starts resolving config eagerly.
  const out = getIntegrationGuide('python');
  assert.equal(out.isError, false);
  assert.ok(out.text.length > 2000);
});

// ----------------------------------------------------------- sandbox_status

/** A factory that fails the test if a tool builds a client it should not. */
const clientForbidden: ClientFactory = async () => {
  throw new Error('a client was built for a call that needs no gateway');
};

test('a sandbox tenant is reported as one, with the guarantee AND the non-guarantee', async () => {
  const out = await sandboxStatus(clientForbidden, ENV, { tenantId: 'acme-sandbox' });
  assert.equal(out.isError, false);
  assert.match(out.text, /sandbox: yes, by name/);
  // The guarantee: a different receipt identity, so production verify refuses.
  assert.match(out.text, /production verifier refuses them/);
  // And the limit, in the same answer rather than in a doc the agent may not
  // read: an ALLOW here is a path that worked, not a person who agreed. An
  // answer carrying only the first half is how "it said sandbox: yes" becomes
  // "it said this was approved".
  assert.match(out.text, /never as "someone agreed"/);
  // The half no client can see is named rather than implied.
  assert.match(out.text, /allowlist of receipt/);
});

test('a production tenant is reported as not a sandbox, and the fix is a credential', async () => {
  const out = await sandboxStatus(clientForbidden, ENV, { tenantId: 'acme' });
  assert.equal(out.isError, false);
  assert.match(out.text, /sandbox: no, by name/);
  // ACP-197 §1: the KEY is the tenant, so pointing at a sandbox is a different
  // key and not a flag. An agent told otherwise would try to edit tenant_id,
  // which the gateway refuses as TenantMismatch.
  assert.match(out.text, /"acme-sandbox"/);
  assert.match(out.text, /credential change, not a flag/);
});

test('the suffix must be attached to something', () => {
  // Same predicate, same words, as sandbox.rs::is_sandbox_name and
  // tools/provision-sandbox.py. `-sandbox` alone is a tenant with an empty
  // production name.
  assert.equal(isSandboxName('a' + SANDBOX_SUFFIX), true);
  assert.equal(isSandboxName(SANDBOX_SUFFIX), false);
  assert.equal(isSandboxName('acme'), false);
  assert.equal(isSandboxName('acme-sandboxed'), false);
});

test('with no decision_id the tool answers on the name alone and calls nothing', async () => {
  const out = await sandboxStatus(clientForbidden, ENV, { tenantId: 'acme-sandbox' });
  assert.equal(out.isError, false);
  assert.match(out.text, /approver: not checked/);
});

test('a pending decision is reported as the deployment not having answered yet', async () => {
  const out = await sandboxStatus(
    clientReturning({ decision: async () => ({ decision_id: '01j0abc', status: 'pending' }) }),
    ENV,
    { tenantId: 'acme-sandbox', decisionId: '01j0abc' },
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /still pending/);
  // ACP-231 item 3: this used to be told to the agent as the signature of a
  // stopped robot, and the 2026-09-03 live run showed that case never reaches
  // `pending` at all -- a floor-HIGH sandbox proposal answers decided/ATTEST in
  // the POST. So the branch says what pending IS and points at the branch that
  // sees the real thing.
  assert.match(out.text, /NOT the\s+signature of a stopped approver/);
  assert.match(out.text, /decided with\s+outcome ATTEST and no receipt/);
});

test('a decided decision with a receipt sends the agent to explain_receipt, not to a verdict', async () => {
  const out = await sandboxStatus(
    clientReturning({
      decision: async () => ({
        decision_id: '01j0abc',
        status: 'decided',
        outcome: 'ALLOW',
        receipt: { receipt_version: 3 },
      }),
    }),
    ENV,
    { tenantId: 'acme-sandbox', decisionId: '01j0abc' },
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /outcome ALLOW/);
  // This tool runs no verification. Saying "valid" here would be a status field
  // dressed as a signature -- the exact substitution rung 1 makes and rung 2
  // exists to stop.
  assert.doesNotMatch(out.text, /valid:/);
  assert.match(out.text, /a status field is not a signature/);
});

test('a decided decision with no receipt says nothing is verifiable', async () => {
  const out = await sandboxStatus(
    clientReturning({
      decision: async () => ({
        decision_id: '01j0abc',
        status: 'decided',
        outcome: 'DENY',
        refusal_category: 'PolicyRefused',
      }),
    }),
    ENV,
    { tenantId: 'acme-sandbox', decisionId: '01j0abc' },
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /refusal_category PolicyRefused/);
  assert.match(out.text, /nothing here is verifiable/);
  // A DENY is finished. Telling the agent to poll for a receipt that is never
  // coming would be the quorum advice attached to the wrong outcome, which is
  // the defect ACP-231 item 3 is about, one branch over.
  assert.doesNotMatch(out.text, /quorum gate/);
});

test('a decided ATTEST with no receipt is named as the quorum gate and the poll to make', async () => {
  // ACP-231 item 3 / ACP-227's 2026-09-03 live run: this is the shape a
  // floor-HIGH sandbox proposal answers with, in the POST itself. The advice
  // that used to live on `pending` could never fire, because this decision is
  // `decided`.
  const out = await sandboxStatus(
    clientReturning({
      decision: async () => ({ decision_id: '01j0abc', status: 'decided', outcome: 'ATTEST' }),
    }),
    ENV,
    { tenantId: 'acme-sandbox', decisionId: '01j0abc' },
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /outcome ATTEST/);
  assert.match(out.text, /§8\.6 quorum gate and not a refusal/);
  // The receipt is the change to watch; the outcome field is not.
  assert.match(out.text, /poll for the\s+RECEIPT and never for a change of outcome/);
  assert.match(out.text, /never grows a receipt is what a stopped or\s+mis-enrolled robot approver/);
  assert.match(out.text, /no health endpoint/);
});

test('a gateway refusal keeps the sandbox answer and appends the refusal by name', async () => {
  // Collapsing the two would let a brief gateway failure read as "your tenant
  // is not a sandbox", which is the wrong developer action entirely.
  const out = await sandboxStatus(clientRejecting(404, ERROR_DECISION_UNKNOWN), ENV, {
    tenantId: 'acme-sandbox',
    decisionId: '01j0zzz',
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /sandbox: yes, by name/);
  assert.match(out.text, /approver: not established — DecisionUnknown: /);
});

test('an empty tenant is refused by name rather than answered', async () => {
  const out = await sandboxStatus(clientForbidden, ENV, { tenantId: '   ' });
  assert.equal(out.isError, true);
  assert.match(out.text, /^TenantUnnamed: /);
});

// ------------------------------------------------- list_decisions (ACP-390)

/** One object field of a parsed answer, narrowed rather than asserted -- the
 * input is JSON this test just produced, which is exactly the value a cast
 * would wave through if the shape ever changed. */
function fields(value: unknown, where: string): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), `${where} is not an object`);
  return { ...value };
}

/** One page, in §1's spelling. */
function pageOf(items: readonly Record<string, unknown>[], next: string | null): ClientFactory {
  return async () => ({
    propose: () => Promise.reject(new Error('propose not stubbed')),
    decision: () => Promise.reject(new Error('decision not stubbed')),
    feedback: () => Promise.reject(new Error('feedback not stubbed')),
    whoami: () => Promise.reject(new Error('whoami not stubbed')),
    list: async (options?: ListArgs) => {
      seenListOptions = options;
      const rows: DecisionListItem[] = [];
      for (const item of items) {
        const id = item['decision_id'];
        const status = item['status'];
        const receipt = item['receipt'];
        const createdAt = item['created_at'];
        const waiting = item['waiting'];
        assert.equal(typeof id, 'string');
        assert.ok(status === 'pending' || status === 'decided');
        assert.ok(receipt === 'attached' || receipt === 'absent');
        assert.equal(typeof createdAt, 'string');
        rows.push({
          decision_id: String(id),
          status,
          receipt,
          created_at: String(createdAt),
          waiting: waiting === true,
          ...(typeof item['outcome'] === 'string' ? { outcome: item['outcome'] } : {}),
          ...(typeof item['expires_at'] === 'string' ? { expires_at: item['expires_at'] } : {}),
        });
      }
      return { items: rows, next_cursor: next };
    },
  });
}

let seenListOptions: ListArgs | undefined;

const ROW = {
  decision_id: '01j0abc',
  status: 'decided',
  receipt: 'attached',
  created_at: '2026-09-21T18:00:00Z',
  waiting: false,
  outcome: 'ALLOW',
};

test('list_decisions returns the gateway page verbatim', async () => {
  const out = await listDecisions(pageOf([ROW], 'c-2'), ENV, {});
  assert.equal(out.isError, false);
  const parsed: unknown = JSON.parse(out.text);
  assert.deepEqual(parsed, { items: [ROW], next_cursor: 'c-2' });
});

test('the end of the list is next_cursor null, which is an answer and not an absence', async () => {
  const out = await listDecisions(pageOf([], null), ENV, {});
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.equal('next_cursor' in parsed, true);
  assert.equal(parsed['next_cursor'], null);
});

test('an omitted since or limit is an ABSENT property, never a present undefined', async () => {
  // exactOptionalPropertyTypes, and a real consequence rather than a type
  // nicety: a present `undefined` reaches the client, which renders it into the
  // query string, and the gateway answers ListQueryMalformed for the whole
  // query without saying which parameter was wrong.
  seenListOptions = undefined;
  await listDecisions(pageOf([ROW], null), ENV, {});
  assert.deepEqual(seenListOptions, {});

  seenListOptions = undefined;
  await listDecisions(pageOf([ROW], null), ENV, { since: '2026-09-21T18:00:00Z' });
  assert.deepEqual(seenListOptions, { since: '2026-09-21T18:00:00Z' });

  seenListOptions = undefined;
  await listDecisions(pageOf([ROW], null), ENV, { limit: 10, cursor: 'c-1' });
  assert.deepEqual(seenListOptions, { limit: 10, cursor: 'c-1' });
});

test('a list refusal reaches the agent under the GATEWAYs name', async () => {
  const out = await listDecisions(clientRejecting(400, 'ListQueryMalformed'), ENV, { limit: 9999 });
  assert.equal(out.isError, true);
  assert.match(out.text, /^ListQueryMalformed: /);
});

test('an unconfigured list_decisions sends no request, names the key, and says how to get one', async () => {
  // Nothing set at all: the address defaults to the hosted service, so the
  // refusal is about the one thing that has no default, the key (ACP-467).
  const out = await listDecisions(zifferClientFactory, {}, {});
  assert.equal(out.isError, true);
  assert.match(out.text, /^ApiKeyUnconfigured: /);
  assert.match(out.text, new RegExp(`Set ${VARS.API_KEY}\\.`));
  assert.match(out.text, /hello@ziffer\.io/);
});

// --------------------------------------------------- get_decision (ACP-390)

/** A client answering one decision record. */
function decisionOf(record: DecisionRecord): ClientFactory {
  return async () => ({
    propose: () => Promise.reject(new Error('propose not stubbed')),
    decision: async () => record,
    list: () => Promise.reject(new Error('list not stubbed')),
    whoami: () => Promise.reject(new Error('whoami not stubbed')),
    feedback: () => Promise.reject(new Error('feedback not stubbed')),
  });
}

const DECIDED = { decision_id: '01j0abc', status: 'decided' as const, outcome: 'ALLOW' };

test('a receipt that verifies comes back, with the hash recomputed from the callers bytes', async () => {
  const receipt = receiptFor(PROPOSAL);
  const out = await getDecision(decisionOf({ ...DECIDED, receipt }), ENV, {
    decisionId: '01j0abc',
    proposalB64: PROPOSAL_B64,
  });
  assert.equal(out.isError, false, out.text);
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.deepEqual(parsed['receipt'], receipt);
  assert.deepEqual(parsed['decision'], DECIDED);
  const verification = fields(parsed['verification'], 'verification');
  assert.equal(verification['status'], 'verified');
  const expected = createHash('sha256').update(canon(PROPOSAL)).digest('hex');
  assert.equal(verification['proposal_hash'], `sha256:${expected}`);
  assert.equal(verification['suite_floor'], SUITE);
});

test('WITHOUT the proposal bytes the receipt is WITHHELD, because nothing could verify it', async () => {
  // The promise this tool makes is that a receipt coming out of it is a
  // verified receipt. There is no proposal on this side of the wire to hash --
  // recomputing from the decision being verified would be accepting a derived
  // security value from the party under verification (RES-9) -- so the honest
  // answer is to keep the status and hold the receipt back.
  const receipt = receiptFor(PROPOSAL);
  const out = await getDecision(decisionOf({ ...DECIDED, receipt }), ENV, { decisionId: '01j0abc' });
  assert.equal(out.isError, true);
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.equal('receipt' in parsed, false, 'an unverified receipt was handed back');
  assert.deepEqual(parsed['decision'], DECIDED);
  const verification = fields(parsed['verification'], 'verification');
  assert.equal(verification['status'], 'not attempted');
  assert.match(String(verification['detail']), /WITHHELD/);
  assert.match(String(verification['detail']), /check_decision/);
});

test('a receipt bound to another proposal is refused by clause, and is not returned', async () => {
  const receipt = receiptFor(PROPOSAL);
  const other = Buffer.from(canon({ ...PROPOSAL, tenant_id: 't2' })).toString('base64');
  const out = await getDecision(decisionOf({ ...DECIDED, receipt }), ENV, {
    decisionId: '01j0abc',
    proposalB64: other,
  });
  assert.equal(out.isError, true);
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.equal('receipt' in parsed, false, 'a refused receipt was handed back');
  const verification = fields(parsed['verification'], 'verification');
  assert.equal(verification['status'], 'refused');
  assert.equal(verification['refusal'], 'ReceiptNotBoundToProposal');
  assert.equal(verification['clause'], '9.3-3');
});

test('a decision with no receipt says so, and says ATTEST is a gate rather than a refusal', async () => {
  const out = await getDecision(decisionOf({ ...DECIDED, outcome: 'ATTEST' }), ENV, {
    decisionId: '01j0abc',
    proposalB64: PROPOSAL_B64,
  });
  assert.equal(out.isError, false);
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.equal('receipt' in parsed, false);
  const verification = fields(parsed['verification'], 'verification');
  assert.equal(verification['status'], 'absent');
  assert.match(String(verification['detail']), /poll for the RECEIPT/);
  assert.match(String(verification['detail']), /a second proposal is a second action/);
});

test('proposal_b64 that is not base64 names the ARGUMENT rather than the receipt', async () => {
  const out = await getDecision(decisionOf({ ...DECIDED, receipt: receiptFor(PROPOSAL) }), ENV, {
    decisionId: '01j0abc',
    proposalB64: 'deadbeef!!',
  });
  assert.equal(out.isError, true);
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.equal('receipt' in parsed, false);
  const verification = fields(parsed['verification'], 'verification');
  assert.match(String(verification['detail']), /^ProposalBytesMalformed: /);
});

test('an unconfigured anchor withholds the receipt and names the variable', async () => {
  const out = await getDecision(decisionOf({ ...DECIDED, receipt: receiptFor(PROPOSAL) }), {
    [VARS.API_URL]: 'https://api.example.test',
    [VARS.API_KEY]: 'zfr_' + 'a'.repeat(43),
  }, { decisionId: '01j0abc', proposalB64: PROPOSAL_B64 });
  assert.equal(out.isError, true);
  const parsed: Record<string, unknown> = { ...JSON.parse(out.text) };
  assert.equal('receipt' in parsed, false);
  const verification = fields(parsed['verification'], 'verification');
  assert.equal(verification['status'], 'refused');
  assert.match(String(verification['detail']), new RegExp(`Set ${VARS.TRUST_ANCHOR}\\.`));
});

test('a gateway refusal on the fetch is the gateways name, before any verification', async () => {
  const out = await getDecision(clientRejecting(404, ERROR_DECISION_UNKNOWN), ENV, {
    decisionId: '01j0zzz',
    proposalB64: PROPOSAL_B64,
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /^DecisionUnknown: /);
});

// ------------------------------------ the service does not answer (ACP-467)
//
// When the service does not answer, a tool says which address it called and
// what to check: never a stack trace and never a bare "fetch failed".

const URL_ = 'https://api.example.test';

function fetchFailed(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

test('a refused connection becomes ServiceUnreachable, naming the address and the reason in words', () => {
  const out = classifyReach(URL_, fetchFailed('ECONNREFUSED'));
  assert.ok(out instanceof ServiceUnreachable);
  assert.equal(out.name, 'ServiceUnreachable');
  assert.equal(out.url, URL_);
  assert.match(out.message, /ZIFFER did not answer at https:\/\/api\.example\.test \(the connection was refused/);
  assert.doesNotMatch(out.message, /fetch failed/);
  assert.ok(out.checks().some((line) => line.includes(`curl -sS ${URL_}/v1/whoami`)));
});

test('a name that does not resolve, a timeout and spent retries are each named', () => {
  const dns = classifyReach(URL_, fetchFailed('ENOTFOUND'));
  assert.ok(dns instanceof ServiceUnreachable && dns.reason.includes('does not resolve'));
  const timeout = new Error('GET /v1/whoami did not answer within 10000ms');
  timeout.name = 'TimeoutError';
  assert.ok(classifyReach(URL_, timeout) instanceof ServiceUnreachable);
  assert.ok(classifyReach(URL_, new DeadlineExceeded('TypeError', 0)) instanceof ServiceUnreachable);
  const unknown = classifyReach(URL_, fetchFailed('EWHATEVER'));
  assert.ok(unknown instanceof ServiceUnreachable && unknown.reason.includes('EWHATEVER'));
});

test('an answer that is not the ZIFFER API names the address to check', () => {
  const out = classifyReach(URL_, new ResponseMalformed('decision response is not a JSON object'));
  assert.ok(out instanceof ServiceUnreachable);
  assert.equal(out.name, 'ServiceAnswerUnreadable');
  assert.ok(out.checks().some((line) => line.includes('the address itself is the one to check')));
});

test('a named refusal from the service passes through as it came', () => {
  const refusal = new ApiRefusal(401, 'ApiKeyUnknown');
  assert.equal(classifyReach(URL_, refusal), refusal);
  const shed = new DeadlineExceeded('ApiRefusal', 503);
  assert.equal(classifyReach(URL_, shed), shed, 'a 503 is an answer from the service, not a failure to reach it');
});

test('over the real client: nothing listening answers ServiceUnreachable with the address, no "fetch failed"', async () => {
  // A port that was open a moment ago and is closed now: nothing listens there.
  const probe = createHttpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  assert.ok(typeof address === 'object' && address !== null, 'the probe has no port');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const out = await whoami(zifferClientFactory, { [VARS.API_URL]: base, [VARS.API_KEY]: 'zfr_' + 'a'.repeat(43) });
  assert.equal(out.isError, true);
  assert.match(out.text, new RegExp(`^ServiceUnreachable: ZIFFER did not answer at ${base.replace(/\./g, '\\.')} `));
  assert.match(out.text, /What to check:/);
  assert.doesNotMatch(out.text, /fetch failed|TypeError|\n\s+at /);
});
