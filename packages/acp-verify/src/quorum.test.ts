/**
 * §9.3 step 7b, driven with REAL hybrid signatures and REAL WebAuthn
 * assertions over material this file makes.
 *
 * Most refusals sit BEHIND a signature check, so a test that never produces a
 * valid one can only ever assert the refusal it stops at first. Every assertion
 * here checks the CLAUSE and not merely "it threw": on an entry wrong in more
 * than one way the clause is what the three implementations are compared on,
 * and a test asserting only "refused" survives a mutant that refuses at the
 * wrong step.
 *
 * The four breaks ACP-406 names -- a digest altered (AB-1), an entry duplicated
 * (AB-3), an assertion re-signed under a key nobody enrolled (HM-4), and
 * `quorum_k` raised above what the attesters consented to (AT-9) -- are the
 * four tests marked BREAK.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { canon } from './canon.js';
import {
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
  CLAUSE_WIRE_TYPE,
} from './clauses.js';
import { parseInstant } from './instant.js';
import { attestationId, entryDigest, type AttesterCredential, type QuorumPolicy } from './quorum.js';
import { Refusal } from './refusal.js';
import {
  hybridKeyFromSeed,
  signAssertion,
  webauthnCredentialFromSeed,
  type TestCredential,
} from './testkeys.js';
import { WEBAUTHN_SIGNATURE } from './webauthn.js';
import { verifyReceipt, type TrustAnchor } from './verify.js';

// ---------------------------------------------------------------- material

const RECEIPT_KEY = hybridKeyFromSeed('k1');
const CFO = hybridKeyFromSeed('att-cfo');
const ONCALL = hybridKeyFromSeed('att-oncall');
const FRAUD = hybridKeyFromSeed('att-fraud');
const STRANGER = hybridKeyFromSeed('att-stranger');

const RP_ID = 'approve.example.com';
const ALICE = webauthnCredentialFromSeed('alice', 'webauthn-es256', RP_ID);
const BOB = webauthnCredentialFromSeed('bob', 'webauthn-ed25519', RP_ID);
const IMPOSTOR = webauthnCredentialFromSeed('impostor', 'webauthn-es256', RP_ID);

const BUNDLE_HASH = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const BUNDLE_EPOCH = 7;

const PROPOSAL_JSON =
  '{"params":{"action":"allow","port":22},"schema_id":"fw.v1","targets":["prod-db"],"task_type":"modify_firewall_rule","tenant_id":"t1"}';
const PROPOSAL = new TextEncoder().encode(PROPOSAL_JSON);
const PROPOSAL_HASH = `sha256:${createHash('sha256')
  .update(canon(JSON.parse(PROPOSAL_JSON)))
  .digest('hex')}`;

const NOW = parseInstant('2026-09-02T10:00:30Z');
assert.ok(NOW !== null);

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function human(cred: TestCredential, role: string | null): AttesterCredential {
  return {
    kind: 'webauthn',
    rpId: cred.rpId,
    credentialId: cred.credentialId,
    publicKey: cred.coseKey,
    alg: cred.alg,
    role,
  };
}

const REGISTRY = new Map<string, AttesterCredential>([
  ['cfo', { kind: 'hybrid', classical: CFO.classical, pq: CFO.pq, role: 'approver' }],
  ['finance_oncall', { kind: 'hybrid', classical: ONCALL.classical, pq: ONCALL.pq, role: 'approver' }],
  // Enrolled, and a CONFIRMER: AT-1's role resolution is what keeps this entry
  // from counting toward an approval quorum.
  ['fraud_desk', { kind: 'hybrid', classical: FRAUD.classical, pq: FRAUD.pq, role: 'confirmer' }],
  ['alice', human(ALICE, 'approver')],
  ['bob', human(BOB, 'approver')],
]);

const ASSURANCES = new Map<string, string>([
  ['cfo', 'AS1'],
  ['finance_oncall', 'AS1'],
  ['fraud_desk', 'AS1'],
  ['alice', 'AS2'],
  ['bob', 'AS2'],
]);

function policy(over: Partial<QuorumPolicy> = {}): QuorumPolicy {
  return {
    quorumK: 2,
    attesters: REGISTRY,
    assurances: ASSURANCES,
    minAssurance: 'AS0',
    policyBundleHash: BUNDLE_HASH,
    bundleEpoch: BUNDLE_EPOCH,
    ...over,
  };
}

function anchor(over: Partial<TrustAnchor> = {}): TrustAnchor {
  return {
    classical: RECEIPT_KEY.classical,
    pq: RECEIPT_KEY.pq,
    minSuite: 'ed25519',
    quorum: policy(),
    ...over,
  };
}

/** One AT-1 object: exactly the eleven fields, never more, never fewer. */
function attObject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    alg: 'hybrid-ed25519-mldsa65',
    att_nonce: 'b64:AAAAAAAAAAAAAAAAAAAAAA==',
    bundle_epoch: BUNDLE_EPOCH,
    context_snapshot_hash: 'sha256:ctx',
    expires_at: '2026-09-02T10:30:00Z',
    floor_only_risk: 'HIGH',
    operator: 'op-1',
    policy_bundle_hash: BUNDLE_HASH,
    proposal_hash: PROPOSAL_HASH,
    required_count: 2,
    required_roles: ['approver'],
    ...over,
  };
}

interface Key {
  readonly edSecret: Uint8Array;
  readonly pqSecret: Uint8Array;
}

/** A machine attester's entry: the hybrid pair over the DERIVED id. */
function machineEntry(
  attester: string,
  key: Key,
  obj: Record<string, unknown> = attObject(),
  kind = 'approval',
): Record<string, unknown> {
  const aid = utf8(attestationId(obj));
  return {
    obj,
    kind,
    attester,
    sig: {
      classical: hex(Uint8Array.from(ed25519.sign(aid, key.edSecret))),
      pq: hex(Uint8Array.from(ml_dsa65.sign(aid, key.pqSecret))),
    },
  };
}

/** A human attester's entry: HM-3's one primitive over the same derived id. */
function humanEntry(
  attester: string,
  cred: TestCredential,
  over: Record<string, unknown> = {},
  opts: Parameters<typeof signAssertion>[2] = {},
  kind = 'approval',
): Record<string, unknown> {
  const obj = attObject({ alg: cred.alg, ...over });
  return {
    obj,
    kind,
    attester,
    sig: { webauthn: signAssertion(cred, attestationId(obj), opts) },
  };
}

function baseBody(): Record<string, unknown> {
  return {
    receipt_version: 3,
    alg: 'hybrid-ed25519-mldsa65',
    decision: 'ALLOW',
    proposal_hash: PROPOSAL_HASH,
    tenant_id: 't1',
    operator: 'op-1',
    issued_at: '2026-09-02T10:00:00Z',
    expires_at: '2026-09-02T10:01:00Z',
    nonce: 'b64:AAAAAAAAAAAAAAAAAAAAAA==',
  };
}

/** AB-5: the signed body is the transport object minus `sig` and `attestations`. */
function sign(body: Record<string, unknown>): Record<string, unknown> {
  const bytes = canon(body);
  return {
    ...body,
    sig: {
      classical: hex(Uint8Array.from(ed25519.sign(bytes, RECEIPT_KEY.edSecret))),
      pq: hex(Uint8Array.from(ml_dsa65.sign(bytes, RECEIPT_KEY.pqSecret))),
    },
  };
}

/**
 * A receipt committing to `entries`. `digests` may be overridden, which is how
 * the AB-* breaks are expressed: the receipt is then RE-SIGNED over the altered
 * list, so what the test exercises is 7b and not a broken receipt signature.
 */
function receiptWith(
  entries: readonly unknown[],
  digests?: unknown,
  bodyOver: Record<string, unknown> = {},
): Record<string, unknown> {
  const list = digests ?? entries.map(entryDigest).sort();
  const body = { ...baseBody(), attestation_digests: list, ...bodyOver };
  return { ...sign(body), attestations: entries };
}

function clauseOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof Refusal) return e.clause;
    throw e;
  }
  return 'PASSED';
}

const verify = (receipt: unknown, a: TrustAnchor = anchor()) =>
  verifyReceipt(receipt, PROPOSAL, a, { nowUnixSeconds: NOW });

// ------------------------------------------------------------- the controls

test('a 2-of-2 machine quorum passes step 7b and reports the operator from the OBJECTS', () => {
  // The control. Without it every refusal below is satisfied by a gate that
  // refuses everything.
  const out = verify(
    receiptWith([
      machineEntry('cfo', CFO),
      machineEntry('finance_oncall', ONCALL, attObject({ att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' })),
    ]),
  );
  assert.notEqual(out.quorum, null);
  assert.equal(out.quorum?.operator, 'op-1');
  assert.deepEqual(out.quorum?.approvals, ['cfo', 'finance_oncall']);
});

test('a human quorum passes, and the counters come back for the caller to persist', () => {
  // Both key types, because one verifier is p256 and the other ed25519 and a
  // corpus that exercised only one would leave half the branch unrun.
  const out = verify(
    receiptWith([
      humanEntry('alice', ALICE, {}, { counter: 11 }),
      humanEntry('bob', BOB, { att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' }, { counter: 4 }),
    ]),
  );
  assert.deepEqual(out.quorum?.approvals, ['alice', 'bob']);
  assert.equal(out.quorum?.webauthnCounters.get(ALICE.credentialId), 11);
  assert.equal(out.quorum?.webauthnCounters.get(BOB.credentialId), 4);
});

test('a LOW/MEDIUM receipt carries no attestations and passes 7b vacuously, reporting null', () => {
  // AB-1's own note. `null` is the honest answer and not a pass: this package
  // cannot recompute the floor-only risk, so it cannot know a quorum was
  // required -- which is why the fact is RETURNED rather than swallowed.
  const out = verify(sign(baseBody()));
  assert.equal(out.quorum, null);
});

// ----------------------------------------------------------------- AB-1..4

test('BREAK: an attestation digest altered refuses at AB-1', () => {
  const entries = [machineEntry('cfo', CFO), machineEntry('finance_oncall', ONCALL)];
  const digests = entries.map(entryDigest).sort();
  // One hex character of one digest. Everything else -- the entries, the
  // receipt signature over the altered list -- is genuine, so what this
  // exercises is the recomputation and nothing else.
  const first = digests[0];
  assert.ok(first !== undefined);
  digests[0] = `${first.slice(0, -1)}${first.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(clauseOf(() => verify(receiptWith(entries, digests.sort()))), CLAUSE_MEMBERSHIP);
});

test('AB-1: an entry carrying an unknown field refuses before its signature is examined', () => {
  const e = { ...machineEntry('cfo', CFO), note: 'hello' };
  assert.equal(clauseOf(() => verify(receiptWith([e, machineEntry('finance_oncall', ONCALL)]))), CLAUSE_MEMBERSHIP);
});

test('AB-1: an ABSENT digest list beside present entries is a type failure, not "no digests to check"', () => {
  const entries = [machineEntry('cfo', CFO)];
  const body = { ...baseBody() };
  assert.equal(
    clauseOf(() => verify({ ...sign(body), attestations: entries })),
    CLAUSE_MEMBERSHIP,
  );
});

test('AB-1: a receipt carrying attestations refuses when the anchor names no registry', () => {
  // FAIL CLOSED, and this is the whole of ACP-406 gap 1 in one assertion. Before
  // this change the same receipt PASSED: the verifier checked our signature and
  // trusted us for the approvals.
  const entries = [machineEntry('cfo', CFO), machineEntry('finance_oncall', ONCALL)];
  const bare: TrustAnchor = {
    classical: RECEIPT_KEY.classical,
    pq: RECEIPT_KEY.pq,
    minSuite: 'ed25519',
  };
  assert.equal(clauseOf(() => verify(receiptWith(entries), bare)), CLAUSE_MEMBERSHIP);
  // ...and a receipt with no attestations is unaffected: an optional input is
  // not a licence to skip a check, it is an input a LOW/MEDIUM caller does not
  // have.
  assert.equal(verify(sign(baseBody()), bare).quorum, null);
});

test('AB-2: an unsorted digest list refuses, prefix included in the ordering', () => {
  const entries = [machineEntry('cfo', CFO), machineEntry('finance_oncall', ONCALL)];
  const digests = entries.map(entryDigest).sort().reverse();
  assert.equal(clauseOf(() => verify(receiptWith(entries, digests))), CLAUSE_DIGEST_ORDER);
});

test('BREAK: an entry duplicated refuses at AB-3, BEFORE the ordering check', () => {
  // The same entry twice, and its digest twice. In an Executor holding a
  // Consumption Ledger CL-3 would mask this; this package has no ledger, and
  // here AB-3 is the only thing between a duplicated digest and a quorum
  // counted twice.
  const e = machineEntry('cfo', CFO);
  const d = entryDigest(e);
  assert.equal(clauseOf(() => verify(receiptWith([e, e], [d, d]))), CLAUSE_DIGEST_DUP);
});

test('AB-4: a withheld entry refuses on cardinality, and so does an injected one', () => {
  const cfo = machineEntry('cfo', CFO);
  const oncall = machineEntry('finance_oncall', ONCALL);
  const both = [cfo, oncall].map(entryDigest).sort();
  // Fewer received than signed: the withholding attack, where every digest sent
  // still matches and the quorum silently shrinks.
  assert.equal(clauseOf(() => verify(receiptWith([cfo], both))), CLAUSE_CARDINALITY);
  // More received than signed: injection.
  assert.equal(
    clauseOf(() => verify(receiptWith([cfo, oncall], [entryDigest(cfo)]))),
    CLAUSE_CARDINALITY,
  );
});

test('INV-1-HIGH: a receipt committing to attestations that did not arrive', () => {
  const cfo = machineEntry('cfo', CFO);
  assert.equal(clauseOf(() => verify(receiptWith([], [entryDigest(cfo)]))), CLAUSE_NO_ATTESTATIONS);
});

// ------------------------------------------------------------- the object

test('AT-8: an entry carrying no object is the pre-v1.3.3 form and is named as one', () => {
  const e = { ...machineEntry('cfo', CFO), obj: null };
  assert.equal(clauseOf(() => verify(receiptWith([e]))), CLAUSE_NO_OBJECT);
});

test('AT-8b: the object schema is CLOSED in both directions', () => {
  const extra = machineEntry('cfo', CFO, attObject({ extra_field: 1 }));
  assert.equal(clauseOf(() => verify(receiptWith([extra]))), CLAUSE_OBJECT_SCHEMA);
  const short = attObject();
  delete short['context_snapshot_hash'];
  assert.equal(clauseOf(() => verify(receiptWith([machineEntry('cfo', CFO, short)]))), CLAUSE_OBJECT_SCHEMA);
});

test('WE-4 then AT-1: the nonce type is checked before its size, and never after', () => {
  // The URL-safe alphabet preserves BOTH the length and the decoded bytes and
  // changes only the string, which is the one shape only WE-4 catches -- the
  // reference records exactly this when explaining why its WE-4 mutant is
  // paired with this input and not with a stripped prefix.
  const urlSafe = machineEntry('cfo', CFO, attObject({ att_nonce: 'b64:AAAAAAAAAAAAAAAAAAAAA-==' }));
  assert.equal(clauseOf(() => verify(receiptWith([urlSafe]))), CLAUSE_WIRE_TYPE);
  // Well-formed and 64-bit: the type holds, the SIZE does not, and the refusal
  // carries the attestation nonce's own clause rather than the receipt's L-17.
  const short = machineEntry('cfo', CFO, attObject({ att_nonce: 'b64:AAAAAAAAAAA=' }));
  assert.equal(clauseOf(() => verify(receiptWith([short]))), CLAUSE_ATT_NONCE_SIZE);
});

// --------------------------------------------------------- the signatures

test('CR-4: an attestation suite below the floor, and an unknown one, both refuse as CR-4', () => {
  const below = machineEntry('cfo', CFO, attObject({ alg: 'ed25519' }));
  const strict = anchor({ quorum: policy() });
  const hybridFloor: TrustAnchor = { ...strict, minSuite: 'hybrid-ed25519-mldsa65' };
  assert.equal(clauseOf(() => verify(receiptWith([below]), hybridFloor)), CLAUSE_ATTESTATION_SUITE);
  // An UNKNOWN suite refuses under CR-4 here and not CR-1, matching
  // `Bundle.suite_ok`; the receipt path spells the same condition CR-1, and the
  // cross-implementation comparison is on refusal NAMES.
  const unknown = machineEntry('cfo', CFO, attObject({ alg: 'rsa2048' }));
  assert.equal(clauseOf(() => verify(receiptWith([unknown]))), CLAUSE_ATTESTATION_SUITE);
});

test('9.3-7b-i: a name nobody enrolled, and a signature under a key nobody enrolled', () => {
  // ACK-4: a name SELECTS a key; it never establishes identity.
  const ghost = machineEntry('ghost', CFO);
  assert.equal(clauseOf(() => verify(receiptWith([ghost]))), CLAUSE_ATTESTER_SIG);
  // The right name, the wrong key: the signature is genuine and is not the
  // registry's.
  const forged = machineEntry('cfo', STRANGER);
  assert.equal(clauseOf(() => verify(receiptWith([forged]))), CLAUSE_ATTESTER_SIG);
  // CR-3 conjunctive: the post-quantum leg stripped from a hybrid suite.
  const stripped = machineEntry('cfo', CFO);
  const sig = stripped['sig'];
  assert.ok(typeof sig === 'object' && sig !== null);
  stripped['sig'] = { classical: Reflect.get(sig, 'classical') };
  assert.equal(clauseOf(() => verify(receiptWith([stripped]))), CLAUSE_ATTESTER_SIG);
});

// ------------------------------------------------------------ the bindings

test('9.3-7b-ii: a genuine quorum raised for ANOTHER proposal is refused -- this is Y1', () => {
  const other = machineEntry('cfo', CFO, attObject({ proposal_hash: 'sha256:deadbeef' }));
  assert.equal(clauseOf(() => verify(receiptWith([other]))), CLAUSE_BINDING);
});

test('9.3-7b-iii: the policy basis, the epoch, and the object\'s own freshness', () => {
  const wrongBundle = machineEntry('cfo', CFO, attObject({ policy_bundle_hash: 'sha256:0' }));
  assert.equal(clauseOf(() => verify(receiptWith([wrongBundle]))), CLAUSE_POLICY_BASIS);
  const wrongEpoch = machineEntry('cfo', CFO, attObject({ bundle_epoch: BUNDLE_EPOCH + 1 }));
  assert.equal(clauseOf(() => verify(receiptWith([wrongEpoch]))), CLAUSE_POLICY_BASIS);
  // Expired before the receipt was issued. PARSED and compared as instants:
  // two RFC 3339 strings compare lexicographically and would agree for every
  // canonical value and then disagree on the first one that was not (ACP-167).
  const stale = machineEntry('cfo', CFO, attObject({ expires_at: '2026-09-02T09:59:59Z' }));
  assert.equal(clauseOf(() => verify(receiptWith([stale]))), CLAUSE_POLICY_BASIS);
  const notAnInstant = machineEntry('cfo', CFO, attObject({ expires_at: '2026-09-02 10:30:00' }));
  assert.equal(clauseOf(() => verify(receiptWith([notAnInstant]))), CLAUSE_POLICY_BASIS);
});

test('9.3-7b-iii-a: objects that disagree on the operator refuse -- this is Y4', () => {
  const a = machineEntry('cfo', CFO);
  const b = machineEntry('finance_oncall', ONCALL, attObject({ operator: 'op-2' }));
  assert.equal(clauseOf(() => verify(receiptWith([a, b]))), CLAUSE_OPERATOR_DISAGREE);
});

test('Y1b: a transmitted attestation_id that disagrees with the derived one', () => {
  const e = { ...machineEntry('cfo', CFO), attestation_id: 'sha256:not-the-derived-id' };
  const e2 = machineEntry('finance_oncall', ONCALL);
  assert.equal(clauseOf(() => verify(receiptWith([e, e2]))), CLAUSE_DERIVED_ID);
  // A transmitted id that AGREES is permitted, matching the engine: closing the
  // entry schema over four fields would retire Y1b's attack rather than defend
  // against it.
  const ok = { ...machineEntry('cfo', CFO) };
  const obj = ok['obj'];
  ok['attestation_id'] = attestationId(obj);
  assert.notEqual(verify(receiptWith([ok, e2])).quorum, null);
});

// ------------------------------------------------------------------ AT-9/3

test('BREAK: quorum_k raised in the bundle above what the attesters consented to -> AT-9', () => {
  // AT-9's SECOND requirement, and the one that fires first here. The attesters
  // signed objects stating `required_count: 2`; the bundle now says 3. The
  // invariant is intact -- three approvals would be demanded -- and what failed
  // is CONSENT: two humans approved believing two reviewers sufficed.
  const entries = [machineEntry('cfo', CFO), machineEntry('finance_oncall', ONCALL, attObject({ att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' }))];
  const raised = anchor({ quorum: policy({ quorumK: 3 }) });
  assert.equal(clauseOf(() => verify(receiptWith(entries), raised)), CLAUSE_CONSENT);
});

test('AT-3: fewer distinct approvals than the threshold recomputed from the bundle', () => {
  // The threshold comes from the BUNDLE and never from `entries[0]`: through
  // v1.3.14 the reference read it from the object, and one compromised attester
  // key signing `required_count: 1` executed a floor-HIGH action.
  const entries = [
    machineEntry('cfo', CFO, attObject({ required_count: 3 })),
    machineEntry('finance_oncall', ONCALL, attObject({ required_count: 3, att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' })),
  ];
  assert.equal(
    clauseOf(() => verify(receiptWith(entries), anchor({ quorum: policy({ quorumK: 3 }) }))),
    CLAUSE_QUORUM,
  );
  // Distinct ATTESTERS, not distinct entries: two entries from one identity are
  // one approval.
  const twice = [
    machineEntry('cfo', CFO),
    machineEntry('cfo', CFO, attObject({ att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' })),
  ];
  assert.equal(clauseOf(() => verify(receiptWith(twice))), CLAUSE_QUORUM);
});

test('AT-2: the operator never counts toward their own quorum', () => {
  const entries = [
    machineEntry('cfo', CFO, attObject({ operator: 'cfo' })),
    machineEntry('finance_oncall', ONCALL, attObject({ operator: 'cfo', att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' })),
  ];
  assert.equal(clauseOf(() => verify(receiptWith(entries))), CLAUSE_OPERATOR_SELF);
});

test('AT-10: an identity enrolled below the registry assurance floor contributes to nothing', () => {
  // Checked BEFORE the count, approvals and confirmations alike: every check
  // above it verifies a SIGNATURE, and a signature says only that a key was
  // used -- a private key in a config file on a build host satisfies all of
  // them.
  const low = policy({ minAssurance: 'AS2' });
  const entries = [machineEntry('cfo', CFO), machineEntry('finance_oncall', ONCALL, attObject({ att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' }))];
  assert.equal(clauseOf(() => verify(receiptWith(entries), anchor({ quorum: low }))), CLAUSE_ASSURANCE);
});

test("AT-1 role resolution: a CONFIRMER's approval does not satisfy required_roles ['approver']", () => {
  // The one place this implementation is STRICTER than both engine sides, and
  // it is stated in `quorum.ts`'s header rather than smuggled in: the customer's
  // registry says who may approve, and `fraud_desk` is enrolled as a confirmer.
  const entries = [
    machineEntry('cfo', CFO),
    machineEntry('fraud_desk', FRAUD, attObject({ att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' })),
  ];
  assert.equal(clauseOf(() => verify(receiptWith(entries))), CLAUSE_QUORUM);
  // An EMPTY list means the rule demanded a quorum and named no role, so any
  // enrolled attester satisfies it (AT-1 as amended in v1.3.32) -- which is
  // exactly the engine's behaviour, and the same two entries now pass.
  const open = [
    machineEntry('cfo', CFO, attObject({ required_roles: [] })),
    machineEntry('fraud_desk', FRAUD, attObject({ required_roles: [], att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' })),
  ];
  assert.deepEqual(verify(receiptWith(open)).quorum?.approvals, ['cfo', 'fraud_desk']);
});

// -------------------------------------------------------------------- §8.6c

test('BREAK: an assertion re-signed under a key nobody enrolled -> HM-4 (e)', () => {
  // Every earlier HM-4 step passes: the type is `webauthn.get`, the challenge is
  // the recomputed id, the origin is the registry's, the flags are set. The
  // signature is genuine and is the IMPOSTOR's. The refusal must name the step,
  // because `WebauthnSignature` and `WebauthnOrigin` are two different
  // investigations.
  const entries = [
    humanEntry('alice', ALICE, {}, { signWith: IMPOSTOR }),
    humanEntry('bob', BOB, { att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' }),
  ];
  assert.equal(clauseOf(() => verify(receiptWith(entries))), WEBAUTHN_SIGNATURE);
});

test('HM-3: the registry and the object must agree about what KIND of key this is', () => {
  // A machine identity whose object claims a WebAuthn alg. Taking the kind from
  // the object would route a machine's entry down the human path; taking it from
  // the registry would verify an object claiming a hybrid suite as an assertion.
  // The DISAGREEMENT is the refusal, before a byte of the assertion is parsed.
  const e = machineEntry('cfo', CFO, attObject({ alg: 'webauthn-es256' }));
  assert.equal(clauseOf(() => verify(receiptWith([e]))), CLAUSE_WEBAUTHN_ALG);
  // ...and the mirror: a human identity whose object claims the machine suite.
  const h = humanEntry('alice', ALICE, { alg: 'hybrid-ed25519-mldsa65' });
  assert.equal(clauseOf(() => verify(receiptWith([h]))), CLAUSE_WEBAUTHN_ALG);
});

test('HM-3: a human entry carries EXACTLY the one `webauthn` primitive', () => {
  const h = humanEntry('alice', ALICE);
  const sig = h['sig'];
  assert.ok(typeof sig === 'object' && sig !== null);
  // A machine leg stapled to a human one is not a stronger signature: it is two
  // different claims about who decided.
  h['sig'] = { webauthn: Reflect.get(sig, 'webauthn'), classical: 'ab' };
  assert.equal(clauseOf(() => verify(receiptWith([h]))), CLAUSE_MALFORMED);
  // WE-4 on the carrier itself: the `b64:` prefix is part of the value.
  const h2 = humanEntry('alice', ALICE);
  const sig2 = h2['sig'];
  assert.ok(typeof sig2 === 'object' && sig2 !== null);
  const raw = Reflect.get(sig2, 'webauthn');
  assert.ok(typeof raw === 'string');
  h2['sig'] = { webauthn: raw.slice('b64:'.length) };
  assert.equal(clauseOf(() => verify(receiptWith([h2]))), CLAUSE_MALFORMED);
});

test('HM-4 (f): a counter that does not advance is a CLONED authenticator, not a retry', () => {
  // The caller's stored value is `T` at this boundary and is handed in.
  const stored = new Map([[ALICE.credentialId, 11]]);
  const entries = [
    humanEntry('alice', ALICE, {}, { counter: 11 }),
    humanEntry('bob', BOB, { att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' }, { counter: 2 }),
  ];
  assert.equal(
    clauseOf(() => verify(receiptWith(entries), anchor({ quorum: policy({ webauthnCounters: stored }) }))),
    CLAUSE_WEBAUTHN_COUNTER,
  );
  // Two entries in ONE receipt from one credential are held to the same rule:
  // without the local working copy the second would be compared against the
  // stored value the first already passed.
  const twice = [
    humanEntry('alice', ALICE, {}, { counter: 9 }),
    humanEntry('alice', ALICE, { att_nonce: 'b64:AQAAAAAAAAAAAAAAAAAAAA==' }, { counter: 9 }),
  ];
  assert.equal(clauseOf(() => verify(receiptWith(twice))), CLAUSE_WEBAUTHN_COUNTER);
});

test('HM-4 (c): the origin is compared against the REGISTRY rp_id, which is the phishing defence', () => {
  // The person really did touch their key, with user verification, over HTTPS
  // -- on a page an attacker served. The registry's `rp_id` is what makes that
  // detectable; an origin taken from the assertion would compare a value with
  // itself.
  const e = humanEntry('alice', ALICE, {}, { origin: 'https://approve.example.com.evil.test' });
  assert.equal(clauseOf(() => verify(receiptWith([e]))), 'WebauthnOrigin');
});

test('HM-4 (d): user verification cleared is possession, and possession is not a person', () => {
  const e = humanEntry('alice', ALICE, {}, { flags: 0x01 });
  assert.equal(clauseOf(() => verify(receiptWith([e]))), 'WebauthnAuthenticatorData');
});

// --------------------------------------------------------------- the shapes

test('a non-list `attestations` is refused rather than iterated', () => {
  // A NARROWER acceptance than the reference, whose `receipt.get(...) or []`
  // would iterate a truthy string into per-character entries. Pinned so the
  // divergence cannot vanish or widen silently.
  const body = { ...baseBody(), attestation_digests: [] };
  assert.equal(
    clauseOf(() => verify({ ...sign(body), attestations: 'two' })),
    CLAUSE_MEMBERSHIP,
  );
});

test('the entry digest is over the WHOLE entry, never over the object alone', () => {
  // ENTRY-SCOPED, and this is the trap ACP-102 names: `attestation_id` already
  // exists and reusing it here is the obvious move and is wrong. `kind` and
  // `attester` decide quorum composition and the attester signs neither, so an
  // object-scoped digest would let a transit flip of `kind` keep matching.
  const e = machineEntry('cfo', CFO);
  assert.notEqual(entryDigest(e), attestationId(e['obj']));
  const flipped = { ...e, kind: 'confirmation' };
  assert.notEqual(entryDigest(flipped), entryDigest(e));
});
