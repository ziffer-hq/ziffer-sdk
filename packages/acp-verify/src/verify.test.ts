/**
 * The composition, driven with REAL hybrid signatures under keys derived
 * exactly as the reference derives its fixture identities (proven in
 * crypto.test.ts). Most refusals sit BEHIND signature verification, so a test
 * that never gets a valid signature can only ever assert the refusal it stops
 * at first -- receipt.rs makes the same point above its own end-to-end block.
 *
 * Every assertion checks the CLAUSE, not just "it threw": on an input with
 * more than one defect the clause is what the three implementations are
 * compared on, and a test asserting only "refused" survives a mutant that
 * refuses at the wrong step (receipt.rs's cr4 test states the trap).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { canon } from './canon.js';
import {
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
import { parseInstant } from './instant.js';
import { hybridKeyFromSeed } from './testkeys.js';
import { Refusal } from './refusal.js';
import { verifyReceipt, type TrustAnchor } from './verify.js';

// One identity for the whole file, derived as the reference derives "k1".
const KEY = hybridKeyFromSeed('k1');
const ANCHOR: TrustAnchor = { classical: KEY.classical, pq: KEY.pq, minSuite: 'ed25519' };

const PROPOSAL_JSON =
  '{"params":{"action":"allow","port":22},"schema_id":"fw.v1","targets":["prod-db"],"task_type":"modify_firewall_rule","tenant_id":"t1"}';
const PROPOSAL = new TextEncoder().encode(PROPOSAL_JSON);
const PROPOSAL_HASH = `sha256:${createHash('sha256')
  .update(canon(JSON.parse(PROPOSAL_JSON)))
  .digest('hex')}`;

// The verifier's clock for every case: inside the base receipt's window.
const NOW = parseInstant('2026-09-02T10:00:30Z');
assert.ok(NOW !== null);

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
    // 16 zero bytes: `b64:` + 22 chars + `==` -- WE-4 well-formed, L-17 sized.
    nonce: 'b64:AAAAAAAAAAAAAAAAAAAAAA==',
  };
}

/** Sign a body with both legs, as the reference's `sign()` does (CR-2 hex). */
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

function refusalClause(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof Refusal) return e.clause;
    throw e;
  }
  return 'PASSED';
}

const verify = (receipt: unknown, proposal: Uint8Array = PROPOSAL, anchor: TrustAnchor = ANCHOR) =>
  verifyReceipt(receipt, proposal, anchor, { nowUnixSeconds: NOW });

test('a well-formed ALLOW receipt passes the whole stateless set', () => {
  // The control. Without it every refusal below is satisfied by a gate that
  // refuses everything.
  const out = verify(signed(baseBody()));
  assert.equal(out.proposalHash, PROPOSAL_HASH);
  assert.equal(out.receiptExpiresAt, parseInstant('2026-09-02T10:01:00Z'));
});

test('AB-0: version 2, a missing version, and a non-object all refuse by name', () => {
  const v2 = baseBody();
  v2['receipt_version'] = 2;
  assert.equal(refusalClause(() => verify(signed(v2))), CLAUSE_VERSION);
  const absent = baseBody();
  delete absent['receipt_version'];
  assert.equal(refusalClause(() => verify(signed(absent))), CLAUSE_VERSION);
  // A non-object receipt has no version at all; AB-0 fires first, as it does
  // in Rust where .get() on a non-object Value is None.
  assert.equal(refusalClause(() => verify(null)), CLAUSE_VERSION);
});

test('AT-8a: a body that cannot be canonically encoded refuses before anything reads it', () => {
  const body = baseBody();
  body['weight'] = 1.5; // the disclosed nested-float divergence, pinned here too
  assert.equal(refusalClause(() => verify({ ...body, sig: {} })), CLAUSE_CANONICAL);
});

test('AB-6: an oversized signed body is refused on its face, before the signature', () => {
  const body = baseBody();
  body['padding'] = 'x'.repeat(5000);
  // sig deliberately absent: AB-6 must fire before the sig is even parsed.
  assert.equal(refusalClause(() => verify(body)), CLAUSE_BODY_SIZE);
});

test('CR-1: no suite, an unknown suite, and an unknown anchor floor', () => {
  const noAlg = baseBody();
  delete noAlg['alg'];
  assert.equal(refusalClause(() => verify(signed(noAlg))), CLAUSE_UNKNOWN_SUITE);
  const badAlg = baseBody();
  badAlg['alg'] = 'ed25519-but-not-really';
  assert.equal(refusalClause(() => verify(signed(badAlg))), CLAUSE_UNKNOWN_SUITE);
  assert.equal(
    refusalClause(() =>
      verify(signed(baseBody()), PROPOSAL, { ...ANCHOR, minSuite: 'strongest-available' }),
    ),
    CLAUSE_UNKNOWN_SUITE,
  );
});

test('CR-4: a hybrid signature does not satisfy an slhdsa128s floor, and the clause says CR-4', () => {
  // Note WHICH clause is asserted (receipt.rs's own trap): delete the floor
  // check and this input still refuses -- at 9.3-1, because slhdsa is
  // unimplemented -- so asserting only "refused" would survive that mutant.
  assert.equal(
    refusalClause(() => verify(signed(baseBody()), PROPOSAL, { ...ANCHOR, minSuite: 'slhdsa128s' })),
    CLAUSE_SUITE_FLOOR,
  );
  // Control: the floor it does satisfy (containment: hybrid contains ed25519).
  verify(signed(baseBody()), PROPOSAL, { ...ANCHOR, minSuite: 'ed25519' });
  verify(signed(baseBody()), PROPOSAL, { ...ANCHOR, minSuite: 'hybrid-ed25519-mldsa65' });
});

test('9.3-1: the CR-2/CR-3 wire-shape refusals', () => {
  const ok = signed(baseBody());

  // A scalar sig -- format confusion is a downgrade in disguise.
  assert.equal(refusalClause(() => verify({ ...ok, sig: 'abc123' })), CLAUSE_SIGNATURE);

  // A stripped PQ leg: one genuine classical signature is not "mostly valid",
  // it is a downgrade to the primitive an attacker can forge.
  const sig = ok['sig'];
  assert.ok(typeof sig === 'object' && sig !== null);
  const legs = Object.entries(sig);
  const classicalLeg = legs.find(([k]) => k === 'classical');
  assert.ok(classicalLeg !== undefined);
  assert.equal(
    refusalClause(() => verify({ ...ok, sig: { classical: classicalLeg[1] } })),
    CLAUSE_SIGNATURE,
  );

  // An extra, undeclared primitive is an accepted code path the attacker chose.
  assert.equal(
    refusalClause(() => verify({ ...ok, sig: { ...sig, extra: 'aa' } })),
    CLAUSE_SIGNATURE,
  );

  // Hex refusals: odd length, then not hex at all.
  assert.equal(
    refusalClause(() => verify({ ...ok, sig: { ...sig, classical: 'abc' } })),
    CLAUSE_SIGNATURE,
  );
  assert.equal(
    refusalClause(() => verify({ ...ok, sig: { ...sig, classical: 'zz'.repeat(64) } })),
    CLAUSE_SIGNATURE,
  );

  // A tampered body under an otherwise genuine signature.
  const tampered = { ...ok, operator: 'op-2' };
  assert.equal(refusalClause(() => verify(tampered)), CLAUSE_SIGNATURE);
});

test('9.3-2: a validly signed DENY does not pass, and the clause is the decision clause', () => {
  // The signature is genuine and the suite meets the floor -- everything is in
  // order except the answer, which is exactly the receipt an attacker replays
  // if step 2 is absent. Reading decision only AFTER the signature verified is
  // what this clause id proves: a forged DENY refuses at 9.3-1 above, never here.
  const deny = baseBody();
  deny['decision'] = 'DENY';
  assert.equal(refusalClause(() => verify(signed(deny))), CLAUSE_DECISION);
});

test('9.3-3: a receipt signed over one proposal does not execute another', () => {
  const other = new TextEncoder().encode('{"task_type":"send_email","tenant_id":"t1"}');
  assert.equal(refusalClause(() => verify(signed(baseBody()), other)), CLAUSE_PROPOSAL_BINDING);
  // Equivalent bytes with different SPACING still bind: the hash is over the
  // canonical encoding, not the transport spelling.
  const spaced = new TextEncoder().encode(
    JSON.stringify(JSON.parse(PROPOSAL_JSON), null, 2),
  );
  verify(signed(baseBody()), spaced);
});

test('AT-8a: proposal bytes that are not UTF-8 JSON refuse by name', () => {
  assert.equal(
    refusalClause(() => verify(signed(baseBody()), new Uint8Array([0xff, 0xfe]))),
    CLAUSE_CANONICAL,
  );
});

test('9.3-5: missing, malformed, expired, and future temporal fields', () => {
  const missing = baseBody();
  delete missing['issued_at'];
  assert.equal(refusalClause(() => verify(signed(missing))), CLAUSE_TEMPORAL);

  // An offset spelling is refused, not normalised (WE-5's strict grammar).
  const offset = baseBody();
  offset['issued_at'] = '2026-09-02T10:00:00+00:00';
  assert.equal(refusalClause(() => verify(signed(offset))), CLAUSE_TEMPORAL);

  // A POSIX number where the wire says RFC 3339 (the ACP-167 correction).
  const posix = baseBody();
  posix['issued_at'] = 1756809600;
  assert.equal(refusalClause(() => verify(signed(posix))), CLAUSE_TEMPORAL);

  // Expired: the verifier's clock is past expires_at.
  const late = parseInstant('2026-09-02T10:02:00Z');
  assert.ok(late !== null);
  assert.equal(
    refusalClause(() => verifyReceipt(signed(baseBody()), PROPOSAL, ANCHOR, { nowUnixSeconds: late })),
    CLAUSE_TEMPORAL,
  );

  // Issued in the future beyond the 5s skew.
  const early = parseInstant('2026-09-02T09:59:00Z');
  assert.ok(early !== null);
  assert.equal(
    refusalClause(() => verifyReceipt(signed(baseBody()), PROPOSAL, ANCHOR, { nowUnixSeconds: early })),
    CLAUSE_TEMPORAL,
  );
});

test('9.3-5 names the condition it refused on: unreadable, expired, or issued in the future', () => {
  // One clause, three conditions the verifier tells apart, three names -- and
  // the clause is unchanged for every one of them.
  const nameAndClause = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e: unknown) {
      if (e instanceof Refusal) return `${e.name} ${e.clause}`;
      throw e;
    }
    return 'PASSED';
  };
  const missing = baseBody();
  delete missing['expires_at'];
  assert.equal(nameAndClause(() => verify(signed(missing))), 'ReceiptTimeUnreadable 9.3-5');
  const offset = baseBody();
  offset['issued_at'] = '2026-09-02T10:00:00+00:00';
  assert.equal(nameAndClause(() => verify(signed(offset))), 'ReceiptTimeUnreadable 9.3-5');
  const late = parseInstant('2026-09-02T10:02:00Z');
  const early = parseInstant('2026-09-02T09:59:00Z');
  assert.ok(late !== null && early !== null);
  assert.equal(
    nameAndClause(() => verifyReceipt(signed(baseBody()), PROPOSAL, ANCHOR, { nowUnixSeconds: late })),
    'ReceiptExpired 9.3-5',
  );
  assert.equal(
    nameAndClause(() => verifyReceipt(signed(baseBody()), PROPOSAL, ANCHOR, { nowUnixSeconds: early })),
    'ReceiptIssuedInFuture 9.3-5',
  );
});

test('L-14: a too-long validity window refuses under its OWN clause, not 9.3-5', () => {
  // A receipt whose window is legal today but 10x too long is an attacker
  // widening the interval a stolen receipt is usable in (Y2); calling that
  // "expired" would tell an operator the wrong thing.
  const wide = baseBody();
  wide['expires_at'] = '2026-09-02T10:05:00Z'; // 300s > 120s
  assert.equal(refusalClause(() => verify(signed(wide))), CLAUSE_VALIDITY_WINDOW);
});

test('WE-4: a URL-safe-alphabet nonce is refused as a type error, never normalised', () => {
  // Length is kept at 28 so ONLY the alphabet is wrong: a stripped prefix or
  // stripped padding also changes the length and L-17 would catch those --
  // the URL-safe spelling is the one shape only WE-4 refuses (decide.rs's
  // mutation note).
  const urlsafe = baseBody();
  urlsafe['nonce'] = 'b64:AAAAAAAAAAAAAAAAAAA-AA==';
  assert.equal(refusalClause(() => verify(signed(urlsafe))), CLAUSE_WIRE_TYPE);

  const noPrefix = baseBody();
  noPrefix['nonce'] = 'AAAAAAAAAAAAAAAAAAAAAA==';
  assert.equal(refusalClause(() => verify(signed(noPrefix))), CLAUSE_WIRE_TYPE);

  const absent = baseBody();
  delete absent['nonce'];
  assert.equal(refusalClause(() => verify(signed(absent))), CLAUSE_WIRE_TYPE);
});

test('L-17: a well-formed 64-bit nonce refuses under the receipt nonce size clause', () => {
  // 8 bytes -> `b64:` + 12 chars: WE-4 passes (perfectly well-formed base64);
  // what is wrong is the LENGTH, and the clause must be L-17 -- not WE-4, and
  // not AT-1, which sizes the ATTESTATION nonce (the ACP-88/89 split).
  const short = baseBody();
  short['nonce'] = 'b64:AAAAAAAAAAA=';
  assert.equal(refusalClause(() => verify(signed(short))), CLAUSE_RECEIPT_NONCE_SIZE);
});

test('on a multi-defect input the EARLIER step names the refusal (spec order)', () => {
  // Wrong version AND bad nonce: AB-0 speaks, because the sequence is the
  // point -- the clause is what a refusal tells an operator, and three
  // implementations disagreeing on which of two true refusals to name have
  // not been shown to agree (decide.rs module doc).
  const both = baseBody();
  both['receipt_version'] = 2;
  both['nonce'] = 'not-a-nonce';
  assert.equal(refusalClause(() => verify(signed(both))), CLAUSE_VERSION);

  // Expired AND over-wide window: 9.3-5 fires before L-14, as in decide.rs.
  const expiredWide = baseBody();
  expiredWide['expires_at'] = '2026-09-02T10:05:00Z';
  const late = parseInstant('2026-09-02T11:00:00Z');
  assert.ok(late !== null);
  assert.equal(
    refusalClause(() =>
      verifyReceipt(signed(expiredWide), PROPOSAL, ANCHOR, { nowUnixSeconds: late }),
    ),
    CLAUSE_TEMPORAL,
  );
});

// ============================================ the shared suite/clause corpus

/**
 * ACP-247 row 12. `fixtures/suite-clause-vectors.json` is run by THIS suite
 * and by `sdk/python/tests/test_verify.py`, over the same (alg, floor) pairs,
 * asserting the same clause id. It exists because the two SDKs had already
 * diverged: for a suite name neither build knew, this verifier said `CR-1`
 * and the Python one said `CR-4`, while `docs/onboarding/sdk.md` told the
 * reader the id was spelled identically in every implementation. Two
 * verifiers that both refuse but name different clauses have not been shown
 * to agree on anything an operator could act on.
 *
 * The corpus is NOT a byte mirror of an engine file, so
 * `tools/check-verify-mirror.py` does not cover its sidecar -- which is why
 * the sha256 in that sidecar is recomputed here rather than trusted.
 */
function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A receipt signed under the suite it declares, per the corpus's reading
 * rule. `ed25519` carries the classical leg ALONE -- signing both and
 * calling it `ed25519` would be a second defect (`parse_sig`'s "primitives
 * are not exactly those the declared suite requires"), and the case would
 * stop being about the floor. An unknown or absent suite has no honest
 * signature at all, so the body is signed hybrid and the field set after.
 */
function signedForDeclaredSuite(alg: string | null): Record<string, unknown> {
  const body = baseBody();
  if (alg !== null) body['alg'] = alg;
  else delete body['alg'];
  const bytes = canon(body);
  const classical = Buffer.from(ed25519.sign(bytes, KEY.edSecret)).toString('hex');
  if (alg === 'ed25519') return { ...body, sig: { classical } };
  return {
    ...body,
    sig: { classical, pq: Buffer.from(ml_dsa65.sign(bytes, KEY.pqSecret)).toString('hex') },
  };
}

function loadVectorFile(name: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
  assert.ok(isRecordValue(raw), `${name} is not a JSON object`);
  return raw;
}

test('the shared suite/clause corpus is the bytes its sidecar names', () => {
  const bytes = readFileSync(new URL('../fixtures/suite-clause-vectors.json', import.meta.url));
  const sidecar = loadVectorFile('suite-clause-vectors.json.provenance.json');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sidecar['sha256']);
});

test('the shared suite/clause corpus: one input, one clause id, in both SDKs', () => {
  const corpus = loadVectorFile('suite-clause-vectors.json');
  const cases = corpus['cases'];
  assert.ok(Array.isArray(cases));

  let refusals = 0;
  let accepted = 0;
  for (const c of cases) {
    assert.ok(isRecordValue(c));
    const { alg, min_suite: minSuite, expect, name } = c;
    assert.ok(alg === null || typeof alg === 'string', 'case alg is neither a string nor null');
    assert.ok(typeof minSuite === 'string', 'case min_suite is not a string');
    assert.ok(expect === null || typeof expect === 'string', 'case expect is neither a clause nor null');

    // The corpus's `how_to_read_a_case` rule, and it is load-bearing: a
    // receipt is signed under the suite it DECLARES whenever that suite is
    // one the signer implements, so the only thing wrong with it is the
    // thing the case is about. Signing hybrid and relabelling would make a
    // receipt wrong in TWO ways, and on a multi-defect input the order
    // decides which clause fires -- which is exactly the divergence the
    // next test pins.
    const receipt = signedForDeclaredSuite(alg);
    const anchor: TrustAnchor = { ...ANCHOR, minSuite };

    const label = typeof name === 'string' ? name : JSON.stringify(c);
    if (expect === null) {
      verifyReceipt(receipt, PROPOSAL, anchor, { nowUnixSeconds: NOW });
      accepted += 1;
    } else {
      assert.equal(
        refusalClause(() => verifyReceipt(receipt, PROPOSAL, anchor, { nowUnixSeconds: NOW })),
        expect,
        `corpus case ${label}`,
      );
      refusals += 1;
    }
  }

  // A corpus that shrank to its refusals would be satisfied by a gate that
  // refuses everything; one that shrank to nothing would be satisfied by
  // anything at all (instant.test.ts's floor, for the same reason).
  assert.ok(cases.length >= 8, `corpus shrank to ${cases.length} cases`);
  assert.ok(refusals >= 4 && accepted >= 2, `corpus is one-sided: ${refusals} refused, ${accepted} accepted`);
});

test('the multi-defect ordering divergence is where the corpus says it is', () => {
  // FOUND BY THIS CORPUS ON ITS FIRST RUN (2026-09-05). A receipt declaring
  // `ed25519` while carrying BOTH signature legs, under a hybrid floor, is
  // wrong in two ways. This verifier mirrors `decide.rs`, which parses the
  // signature object before `verify_receipt`, so `parse_sig` speaks first
  // and the clause is 9.3-1; the Python SDK follows the reference's order,
  // where the floor speaks first, and says CR-4. Recorded rather than
  // fixed: an order is the engine's to settle, and moving either side would
  // put it out of step with the implementation it mirrors. Pinned from both
  // sides so it cannot vanish or move quietly.
  const div = loadVectorFile('suite-clause-vectors.json')['known_divergences'];
  assert.ok(Array.isArray(div) && div.length >= 1);
  const first = div[0];
  assert.ok(isRecordValue(first));
  const relabelled = signed(baseBody()); // hybrid sig, both legs
  relabelled['alg'] = 'ed25519';         // relabelled: two defects at once
  assert.equal(
    refusalClause(() =>
      verifyReceipt(relabelled, PROPOSAL, { ...ANCHOR, minSuite: 'hybrid-ed25519-mldsa65' }, {
        nowUnixSeconds: NOW,
      }),
    ),
    first['typescript_sdk'],
  );
  assert.equal(first['typescript_sdk'], CLAUSE_SIGNATURE);
  assert.equal(first['python_sdk'], CLAUSE_SUITE_FLOOR);
  assert.equal(first['rust_acp_decision'], CLAUSE_SIGNATURE);
});

test('the corpus records what the ENGINE answers, and does not claim all four agree', () => {
  // ACP-82 is open: at the pin, `crates/acp-decision` refuses an unknown
  // suite under CR-1 and the Python reference under CR-4, because its
  // `Bundle.suite_ok` returns false for a name it does not know. The two
  // SDKs follow Rust and the specification (CR-1 §1121: an unregistered or
  // unknown suite MUST fail closed). Recording the reference's answer here
  // is what stops sdk.md §5 from quietly becoming false again -- and the
  // Python suite pins the reference's actual source, which this one cannot
  // reach.
  const corpus = loadVectorFile('suite-clause-vectors.json');
  const engine = corpus['engine_at_pin'];
  assert.ok(isRecordValue(engine));
  assert.equal(engine['rust_acp_decision'], CLAUSE_UNKNOWN_SUITE);
  assert.equal(engine['python_reference_acp_executor'], CLAUSE_SUITE_FLOOR);
  assert.equal(engine['ticket'], 'ACP-82');
});
