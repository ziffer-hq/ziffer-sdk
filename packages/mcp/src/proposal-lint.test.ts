/**
 * The linter, against the schema it actually ships and against proposals that
 * are wrong in one named way each.
 *
 * Every invalid case here starts from a VALID proposal and breaks exactly one
 * thing, so a finding naming that field is evidence the rule fired rather than
 * evidence that something was wrong somewhere. A test built the other way --
 * an object wrong in six ways, asserted to produce findings -- passes when five
 * of the six rules are missing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IGNORED_KEYWORDS,
  IMPLEMENTED_KEYWORDS,
  lintFindings,
  lintProposal,
  PROPOSAL_SCHEMA,
  SCHEMA_KEYWORDS,
  SCHEMA_ROOT,
  SchemaUnsupported,
  SCHEMAS,
} from './proposal-lint.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A proposal that satisfies the schema. It is the shape
 * `docs/onboarding/sdk.md` section 8 writes, with a real 71-character hash. */
function valid(): Record<string, unknown> {
  return {
    schema_id: 'transfer',
    schema_version: '1.0.0',
    schema_hash: `sha256:${'ab'.repeat(32)}`,
    fidelity: 'F-HIGH',
    tenant_id: 'ten-example',
    payload: {
      task_type: 'transfer',
      operator: 'jane.o',
      targets: ['bank-api'],
      params: { amount: 100, to_account: 'acct-7' },
      cidrs: {},
    },
  };
}

test('the embedded schema is the one on disk, and it is the wire Proposal', () => {
  // The staleness assertion `guide.test.ts` makes about the guide, one artifact
  // over: the generated module is gitignored and rewritten on every build, so
  // what this proves is that the build read THIS file.
  for (const [relative, embedded] of Object.entries(SCHEMAS)) {
    const onDisk: unknown = JSON.parse(readFileSync(join(REPO, SCHEMA_ROOT, relative), 'utf8'));
    assert.deepEqual(embedded, onDisk, `${relative} drifted from ${SCHEMA_ROOT}`);
  }
  assert.ok(SCHEMAS[PROPOSAL_SCHEMA] !== undefined, 'the Proposal schema itself is not embedded');
});

test('every keyword the embedded closure uses is implemented or deliberately ignored', () => {
  // THE CHECK THE HALT DEPENDS ON. `lintFindings` throws on a keyword it does
  // not know, which is the right runtime behaviour and a terrible thing to
  // discover from a customer. This asserts the halt cannot fire against the
  // schemas we ship, so a schema edit that introduces `oneOf` or `const` is a
  // red suite here rather than a tool that refuses in the field.
  const known = new Set([...IMPLEMENTED_KEYWORDS, ...IGNORED_KEYWORDS]);
  const unhandled = SCHEMA_KEYWORDS.filter((keyword) => !known.has(keyword) && !keyword.startsWith('x-acp-'));
  assert.deepEqual(unhandled, [], `the shipped schemas use keywords this reader does not implement`);
  // And the other direction: an implemented keyword the schemas never use is a
  // branch nothing exercises. Reported rather than asserted away -- `enum` is
  // used by `fidelity`, and if one of these stops being used the list should
  // shrink with it.
  const used = new Set(SCHEMA_KEYWORDS);
  const unused = IMPLEMENTED_KEYWORDS.filter((keyword) => !used.has(keyword));
  assert.deepEqual(unused, [], `implemented but unreachable in the shipped schemas: ${unused.join(', ')}`);
});

test('a valid proposal produces no findings', () => {
  assert.deepEqual(lintFindings(valid()), []);
  const out = lintProposal(valid());
  assert.equal(out.isError, false);
  assert.match(out.text, /^lint_proposal against /);
  assert.match(out.text, /PASS {2}the proposal satisfies/);
});

test('a PASS says it is about the shape, and what is decided when you propose', () => {
  // A green line that reads as more than it is, is the shape this repository
  // publishes corrections about. The limits are part of the answer; since
  // ACP-467 they are written as instructions, and each one is still there.
  const { text } = lintProposal(valid());
  assert.match(text, /A PASS is about the SHAPE/);
  assert.match(text, /input schema registered for this action/i);
  assert.match(text, /TenantMismatch/);
  assert.match(text, /a valid proposal can still be held or denied/i);
  assert.doesNotMatch(text, /services\//, 'the answer names a path in our repository');
});

test('a missing required property is named, at both levels', () => {
  const top = valid();
  delete top['fidelity'];
  assert.deepEqual(lintFindings(top), ['proposal.fidelity: required property is missing']);

  const nested = valid();
  const payload = nested['payload'];
  assert.ok(typeof payload === 'object' && payload !== null);
  const inner: Record<string, unknown> = { ...payload };
  delete inner['cidrs'];
  nested['payload'] = inner;
  assert.deepEqual(lintFindings(nested), ['proposal.payload.cidrs: required property is missing']);
});

test('an undeclared property is refused at both levels, because both are closed', () => {
  const top = valid();
  top['risk_level'] = 'LOW';
  assert.deepEqual(lintFindings(top), ['proposal.risk_level: not a property this object admits']);

  const nested = valid();
  const payload = nested['payload'];
  assert.ok(typeof payload === 'object' && payload !== null);
  nested['payload'] = { ...payload, screening_verdict: 'clean' };
  assert.deepEqual(lintFindings(nested), ['proposal.payload.screening_verdict: not a property this object admits']);
});

test('a pattern miss names the field and the pattern it failed', () => {
  const bad = valid();
  bad['schema_hash'] = 'sha256:not-a-digest';
  const findings = lintFindings(bad);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /^proposal\.schema_hash: /);
  assert.match(findings[0] ?? '', /does not match/);
});

test('an enum miss names the value and what was allowed', () => {
  const bad = valid();
  bad['fidelity'] = 'F-MAXIMUM';
  const findings = lintFindings(bad);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /^proposal\.fidelity: "F-MAXIMUM" is not one of /);
});

test('a type miss ends at that field rather than cascading', () => {
  // One mistake, one finding. Reporting "not an object" AND "missing task_type"
  // about one value is two findings about one mistake, and the second one sends
  // a reader to a field they did not touch.
  const bad = valid();
  bad['payload'] = 'a string';
  assert.deepEqual(lintFindings(bad), ['proposal.payload: expected object, found "a string"']);
});

test('the bounds on targets and on a CIDR width are applied', () => {
  const empty = valid();
  const payload = empty['payload'];
  assert.ok(typeof payload === 'object' && payload !== null);
  empty['payload'] = { ...payload, targets: [] };
  assert.deepEqual(lintFindings(empty), ['proposal.payload.targets: 0 items, fewer than the 1 required']);

  const wide = valid();
  wide['payload'] = { ...payload, cidrs: { source_cidr: 129 } };
  assert.deepEqual(lintFindings(wide), ['proposal.payload.cidrs.source_cidr: 129 is above the maximum 128']);
});

test('a param value outside EL-2s domain is refused rather than coerced', () => {
  const bad = valid();
  const payload = bad['payload'];
  assert.ok(typeof payload === 'object' && payload !== null);
  bad['payload'] = { ...payload, params: { amount: true } };
  const findings = lintFindings(bad);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /^proposal\.payload\.params\.amount: expected integer or string/);
});

test('a param NAME outside the declared class is named as a key', () => {
  const bad = valid();
  const payload = bad['payload'];
  assert.ok(typeof payload === 'object' && payload !== null);
  bad['payload'] = { ...payload, params: { Amount: 1 } };
  const findings = lintFindings(bad);
  assert.equal(findings.length, 1);
  assert.match(findings[0] ?? '', /^proposal\.payload\.params\.<key "Amount">: /);
});

test('a proposal that is not an object at all is one finding', () => {
  assert.deepEqual(lintFindings([]), ['proposal: expected object, found []']);
  assert.deepEqual(lintFindings('x'), ['proposal: expected object, found "x"']);
});

test('several findings are all reported, each naming its own field', () => {
  const bad = valid();
  delete bad['tenant_id'];
  bad['schema_version'] = 'one';
  const findings = lintFindings(bad);
  assert.equal(findings.length, 2);
  assert.ok(findings.some((f) => f.startsWith('proposal.tenant_id:')));
  assert.ok(findings.some((f) => f.startsWith('proposal.schema_version:')));
  const out = lintProposal(bad);
  assert.equal(out.isError, false, 'a finding is the tool working, not a tool error');
  assert.match(out.text, /FAIL {2}2 finding\(s\)/);
});

test('a keyword the reader does not implement HALTS rather than passing', () => {
  // The claim the module comment makes, made to fire. `oneOf` is deliberately
  // NOT implemented -- the Proposal's graph does not use it -- so a schema node
  // carrying it must refuse. A reader that shrugged would validate the half it
  // understood and report a PASS about an object matching no branch.
  const document = SCHEMAS[PROPOSAL_SCHEMA];
  assert.ok(typeof document === 'object' && document !== null);
  const doctored: Record<string, unknown> = { ...document, oneOf: [{ type: 'object' }] };
  const saved: unknown = SCHEMAS[PROPOSAL_SCHEMA];
  const table: Record<string, unknown> = SCHEMAS;
  table[PROPOSAL_SCHEMA] = doctored;
  try {
    assert.throws(
      () => lintFindings(valid()),
      (error: unknown) =>
        error instanceof SchemaUnsupported &&
        error.name === 'SchemaKeywordUnsupported' &&
        /`oneOf`/.test(error.message),
      'an unimplemented keyword was shrugged at',
    );
    const out = lintProposal(valid());
    assert.equal(out.isError, true, 'the halt has to reach the caller as a refusal');
    assert.match(out.text, /^SchemaKeywordUnsupported: /);
  } finally {
    table[PROPOSAL_SCHEMA] = saved;
  }
  assert.deepEqual(lintFindings(valid()), [], 'the doctored schema outlived the test');
});

test('an unresolvable $ref refuses by name rather than skipping the constraint', () => {
  const document = SCHEMAS[PROPOSAL_SCHEMA];
  assert.ok(typeof document === 'object' && document !== null);
  const table: Record<string, unknown> = SCHEMAS;
  const saved: unknown = table[PROPOSAL_SCHEMA];
  table[PROPOSAL_SCHEMA] = { $ref: 'https://acp.spec/schemas/wire/nowhere.schema.json#/$defs/x' };
  try {
    const out = lintProposal(valid());
    assert.equal(out.isError, true);
    assert.match(out.text, /^SchemaRefUnresolvable: /);
  } finally {
    table[PROPOSAL_SCHEMA] = saved;
  }
});

test('it sends nothing anywhere: no configuration is consulted and no network is used', () => {
  // Asserted by construction rather than by observation, and said plainly: the
  // module imports neither `config.ts` nor a client, so there is no value it
  // could read and no socket it could open. What this test adds is that the
  // tool answers identically with an empty environment, which a future import
  // would break.
  const before = lintProposal(valid()).text;
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ZIFFER_')) delete process.env[key];
    }
    assert.equal(lintProposal(valid()).text, before);
  } finally {
    Object.assign(process.env, saved);
  }
});
