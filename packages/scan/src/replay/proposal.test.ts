import assert from 'node:assert/strict';
import { test } from 'node:test';

import { packageEnginePin } from '../package-info.js';
import { loadReplayData } from './data.js';
import { NotInGrammar, canonText, proposalHash, toProposal } from './proposal.js';

const data = loadReplayData();

test('the port carries the eight harness cases and their provenance, no ninth', () => {
  assert.deepEqual(
    data.cases.map((c) => c.id),
    ['fx-01', 'fx-02', 'fx-03', 'fx-04', 'fx-05', 'fx-06', 'fx-07', 'fx-08'],
  );
  for (const p of [data.caseProvenance, data.bundle.provenance]) {
    assert.equal(p.copied_from, 'reference/suites/art_harness.py');
    // The port is a copy of the harness AT THE PIN this package wraps. After a
    // pin bump this goes red until someone re-reads art_harness.py at the new
    // pin and re-stamps the two files: the copy's commit is evidence of what
    // was read, so tools/bump-pin.sh does not move it (tools/check-pin-sites.py
    // lists it under DATED_FIELDS, not SITES).
    assert.equal(p.engine_commit, packageEnginePin());
    assert.equal(p.copied_on, '2026-09-26');
  }
});

test("to_proposal's port produces the harness's own Proposal for fx-01, and the harness's own hash", () => {
  const first = data.cases[0];
  assert.ok(first !== undefined);
  const p = toProposal(first.intended_call, data.bundle.grammar, data.operator, data.bundle.grammar.tenant_id);
  // Printed by `to_proposal(FIXTURES[0].intended_call)` at 0ce0567 (re-run 2026-09-26; the reference is unchanged since 96f4ec8).
  assert.deepEqual(p, {
    schema_id: 'pay.v1',
    schema_version: '1.0.0',
    schema_hash: 'sha256:pay',
    fidelity: 'F-HIGH',
    tenant_id: 't1',
    payload: {
      task_type: 'transfer_funds',
      operator: 'agent_ops',
      targets: ['payments'],
      params: { amount: 50000, to: 'attacker' },
      cidrs: {},
    },
  });
  // `h(to_proposal(...))` at 0ce0567: the reference's canonical digest.
  assert.equal(proposalHash(p), 'sha256:4a5e7f941b0f54b0a18d824e7c6b0dfb26a6a2f4a1469f9db83dd274ca6827c5');
});

test('a tool outside the grammar produces no Proposal (the harness: REFUSED_AT_INGRESS)', () => {
  const fx06 = data.cases.find((c) => c.id === 'fx-06');
  assert.ok(fx06 !== undefined);
  assert.throws(() => toProposal(fx06.intended_call, data.bundle.grammar, data.operator, 't1'), NotInGrammar);
});

test('canonText sorts keys, keeps array order, and refuses a non-integer', () => {
  assert.equal(canonText({ b: 1, a: [2, 1], c: { z: null, y: true } }), '{"a":[2,1],"b":1,"c":{"y":true,"z":null}}');
  assert.throws(() => canonText({ x: 1.5 }), /CanonicalFloat/);
});
