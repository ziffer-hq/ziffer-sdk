import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadEngine } from '../wasm/loader.js';
import type { Engine, EngineResponse } from '../wasm/loader.js';
import { locateWasm } from '../wasm/locate.js';
import { verify } from '../wasm/ops.js';
import { loadReplayData } from './data.js';
import {
  KeyNotDiscarded,
  NOT_EVIDENCE_BECAUSE,
  ReplayBroken,
  replay,
  verifierBundle,
  verifyCaseText,
} from './replay.js';
import type { ReplayResult } from './replay.js';
import { WIDTH, renderReplay } from './render.js';

/**
 * Column B, per case, derived by reading `art_harness.py`'s `run_case` and
 * `make_bundle()` at 0ce0567 -- NOT by running this module. Each row names the
 * rule that decides it. Where this module and the harness's full Executor part
 * company, the row says so: the harness also checks the AI agent's
 * capabilities (its fx-01/03/07 end at that check), and the module holds no
 * capability table, so here they stop at HELD.
 */
const EXPECTED: Record<string, { kind: 'refused' | 'held' | 'allowed'; risk?: string; reversibility?: string; notice?: string[] | null; clause?: string }> = {
  // transfer_funds base HIGH -> ATTEST: waits for quorum_k = 2.
  'fx-01': { kind: 'held', risk: 'HIGH' },
  // share_file base MEDIUM, raised to HIGH because partner-share is floored T3.
  'fx-02': { kind: 'held', risk: 'HIGH' },
  // send_email raised to HIGH: the target partner-share is T3 (>= T2).
  'fx-03': { kind: 'held', risk: 'HIGH' },
  // send_email to inbox (T1): LOW, IRREVERSIBLE -> ALLOW; DR-13 owes a notice
  // to notice_targets.send_email. The harness's EXECUTED_NOTIFIED row.
  'fx-04': { kind: 'allowed', risk: 'LOW', reversibility: 'IRREVERSIBLE', notice: ['secops_oncall', 'mailbox_owner'] },
  // set_device on home-devices (T2): raised to MEDIUM, REVERSIBLE -> ALLOW, no
  // notice (DR-7: reversible). The harness's EXECUTED_SILENTLY row.
  'fx-05': { kind: 'allowed', risk: 'MEDIUM', reversibility: 'REVERSIBLE', notice: null },
  // delete_backups is not in to_proposal's TOOLS: no Proposal exists (the
  // harness's REFUSED_AT_INGRESS, "no such verb"), so no engine call is made.
  'fx-06': { kind: 'refused', clause: 'V-11' },
  // As fx-01; the direct (user-side) subset.
  'fx-07': { kind: 'held', risk: 'HIGH' },
  // read_email on inbox (T1): LOW, REVERSIBLE -> ALLOW, nobody told. EXECUTED_SILENTLY.
  'fx-08': { kind: 'allowed', risk: 'LOW', reversibility: 'REVERSIBLE', notice: null },
};

const NOW = 1_790_000_000;

let cached: { engine: Engine; result: ReplayResult } | undefined;
async function realRun(): Promise<{ engine: Engine; result: ReplayResult }> {
  if (cached === undefined) {
    const engine = await loadEngine(readFileSync(locateWasm()));
    cached = { engine, result: await replay(engine, { now: NOW }) };
  }
  return cached;
}

test('the eight cases, through the real module, land where the harness bundle puts them', async () => {
  const { result } = await realRun();
  assert.deepEqual(result.rows.map((r) => r.id), Object.keys(EXPECTED));
  for (const row of result.rows) {
    const want = EXPECTED[row.id];
    assert.ok(want !== undefined, row.id);
    const o = row.outcome;
    assert.equal(o.kind, want.kind, `${row.id}: ${JSON.stringify(o).slice(0, 200)}`);
    assert.equal(row.without_policy, 'no agent authorization policy: the proposal executes as written');
    if (o.kind === 'refused') {
      assert.equal(o.clause, want.clause, row.id);
      assert.equal(row.proposal, null, `${row.id}: a grammar refusal has no Proposal`);
    } else if (o.kind === 'held') {
      assert.equal(o.risk, want.risk, row.id);
      assert.equal(o.awaits.k, 2, row.id);
      assert.deepEqual(o.awaits.required_roles, ['approver']);
    } else {
      assert.equal(o.risk, want.risk, row.id);
      assert.equal(o.reversibility, want.reversibility, row.id);
      assert.deepEqual(o.notice_recipients, want.notice, row.id);
      assert.equal(o.verification.verdict, 'PASSED', row.id);
      assert.equal(o.verification.risk, want.risk, `${row.id}: the verifier recomputed the risk`);
    }
  }
});

test('every ALLOWED receipt rides in the demo envelope, exactly these fields', async () => {
  const { result } = await realRun();
  const allowed = result.rows.flatMap((r) => (r.outcome.kind === 'allowed' ? [r.outcome] : []));
  assert.equal(allowed.length, 3);
  assert.match(result.run.tenant_id, /^ten_demo_[0-9a-f]{8}$/);
  for (const o of allowed) {
    const e = o.envelope;
    assert.deepEqual(Object.keys(e).sort(), ['demo', 'key_discarded', 'not_evidence_because', 'receipt', 'signed_under']);
    assert.equal(e.demo, true);
    assert.equal(e.key_discarded, true);
    assert.equal(e.not_evidence_because, NOT_EVIDENCE_BECAUSE);
    assert.deepEqual(e.signed_under, { fingerprint: result.run.fingerprint, tier: 'T0', environment: 'Development' });
    assert.ok(typeof e.receipt === 'object' && e.receipt !== null && !Array.isArray(e.receipt));
    assert.equal(e.receipt['tenant_id'], result.run.tenant_id);
    assert.match(String(e.receipt['audit_id']), /^demo_[0-9a-f]{8}_fx-0\d$/);
    // WE-4: the nonce is the engine's own, `b64:` + base64 of 128 bits.
    assert.match(String(e.receipt['nonce']), /^b64:[A-Za-z0-9+/]{22}==$/);
  }
});

test('a receipt round-trips verify as PASSED, and one changed byte is refused at 9.3-1', async () => {
  const { engine, result } = await realRun();
  const row = result.rows.find((r) => r.id === 'fx-04');
  assert.ok(row !== undefined && row.outcome.kind === 'allowed' && row.proposal !== null);
  const bundle = verifierBundle(loadReplayData().bundle, result.run);
  const text = row.outcome.receipt_text;
  const again = await verify(engine, verifyCaseText('fx-04', NOW, text, row.proposal, bundle));
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.result.verdict, 'PASSED');

  // One byte inside the signed body: the last character of the audit id.
  const at = text.indexOf('"audit_id":"') + '"audit_id":"demo_'.length;
  const flipped = text.slice(0, at) + (text[at] === '0' ? '1' : '0') + text.slice(at + 1);
  assert.notEqual(flipped, text);
  assert.equal(flipped.length, text.length);
  const refused = await verify(engine, verifyCaseText('fx-04', NOW, flipped, row.proposal, bundle));
  assert.ok(!refused.ok);
  assert.equal(refused.error.kind, 'refusal');
  assert.equal(refused.error.kind === 'refusal' ? refused.error.clause : '', '9.3-1');
});

test('the rendering starts with the UNSIGNED DEMO line, fits 80 columns, and names no clause', async () => {
  const { result } = await realRun();
  const text = renderReplay(result);
  const lines = text.split('\n');
  // The literal, not the exported constant: a test comparing the constant to
  // itself cannot go red when the constant is edited.
  assert.equal(
    lines[0],
    'UNSIGNED DEMO: the receipts below are signed by a throwaway key made for this run; they are a demonstration, not evidence',
  );
  assert.equal(result.first_line, lines[0]);
  for (const l of lines.slice(1)) assert.ok(l.length <= WIDTH, `over ${WIDTH}: ${l}`);
  assert.doesNotMatch(text, /\b(?:\d+\.\d+(?:\.\d+)?(?:-\d+)?|[A-Z]{1,3}-\d+[a-z]?)\b/, 'a clause id in the plain text');
  // The rows the policy does not stop are printed as such.
  assert.match(text, /fx-04 send_email on inbox: low risk, irreversible; nobody is asked; a notice\s+is owed to secops_oncall, mailbox_owner/);
  assert.match(text, /fx-08 read_email on inbox: low risk, reversible; nobody is asked or told\./);
});

/** An engine that answers keygen and tree_hash, then does what `onDecide` says. */
function fakeEngine(onDecide: () => EngineResponse, dropOk = true): { engine: Engine; dropped: number[] } {
  const dropped: number[] = [];
  const engine: Engine = {
    call: async (op, request) => {
      if (op === 'keygen') {
        return { ok: true, result: { handle: 7, fingerprint: 'abcdef0123456789', classical_pub_hex: '00', pq_pub_hex: '00', tier: 'T0', seeded: false } };
      }
      if (op === 'tree_hash') return { ok: true, result: { hash: 'sha256:00' } };
      if (op === 'decide') return onDecide();
      if (op === 'drop_key') {
        const h = request['handle'];
        if (typeof h === 'number') dropped.push(h);
        return dropOk ? { ok: true, result: {} } : { ok: false, error: { kind: 'request', message: 'no key has handle 7' } };
      }
      return { ok: false, error: { kind: 'request', message: `fake: ${op}` } };
    },
    callRaw: async () => ({ ok: false, error: { kind: 'request', message: 'fake: raw' } }),
  };
  return { engine, dropped };
}

test('drop_key runs even when a case throws, and the original error survives', async () => {
  const { engine, dropped } = fakeEngine(() => {
    throw new Error('boom inside a case');
  });
  await assert.rejects(replay(engine, { now: NOW }), /boom inside a case/);
  assert.deepEqual(dropped, [7]);
});

test('a request failure from the engine is a broken run, and the key is still dropped', async () => {
  const { engine, dropped } = fakeEngine(() => ({ ok: false, error: { kind: 'request', message: 'missing field' } }));
  await assert.rejects(replay(engine, { now: NOW }), ReplayBroken);
  assert.deepEqual(dropped, [7]);
});

test('a drop the module refuses is KeyNotDiscarded, never a result that says the key was discarded', async () => {
  const { engine, dropped } = fakeEngine(
    () => ({ ok: false, error: { kind: 'refusal', clause: '8.4-3', message: 'no risk function' } }),
    false,
  );
  await assert.rejects(replay(engine, { now: NOW }), KeyNotDiscarded);
  assert.deepEqual(dropped, [7]);
});
