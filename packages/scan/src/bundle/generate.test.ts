/**
 * The bundle generator against the REAL engine module (`ZIFFER_SCAN_WASM`, or
 * the vendored copy). No fake stands in for `bundle_verify`: the claim under
 * test is that the engine activates what this package writes, and only the
 * engine can make it. Where a fake engine appears it wraps the real one and
 * changes a single answer, to prove what this module does with that answer.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALERT_CLASSES, SCHEMAS } from '../generated/schema-source.js';
import type { CatalogTool, Classification } from '../types.js';
import { isJson, isRecord } from '../wasm/json.js';
import type { Json } from '../wasm/json.js';
import { loadEngine } from '../wasm/loader.js';
import type { Engine } from '../wasm/loader.js';
import { locateWasm } from '../wasm/locate.js';
import { bundleVerify, decide, keygen } from '../wasm/ops.js';
import type { KeygenResult } from '../wasm/ops.js';
import {
  BundleDirectoryOccupied,
  BundleVerifyRefused,
  generateBundle,
  listBundle,
  policyMembers,
  SIDECAR,
  SUITE,
  validateMembers,
  writeBundle,
} from './generate.js';
import type { GeneratedBundle } from './generate.js';
import { BundleMemberInvalid, MEMBER_SCHEMAS, validateMember } from './schemas.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'bundle');

function strings(v: unknown): string[] {
  assert.ok(Array.isArray(v));
  return v.map((x) => {
    assert.equal(typeof x, 'string');
    return String(x);
  });
}

function loadCatalog(): CatalogTool[] {
  const doc: unknown = JSON.parse(readFileSync(join(FIXTURES, 'catalog.json'), 'utf8'));
  assert.ok(isRecord(doc) && Array.isArray(doc['catalog']));
  return doc['catalog'].map((t: unknown) => {
    assert.ok(isRecord(t));
    const s = (k: string): string => {
      const v = t[k];
      assert.equal(typeof v, 'string', k);
      return String(v);
    };
    return {
      client: s('client'),
      server: s('server'),
      tool: s('tool'),
      description: s('description'),
      params: strings(t['params']),
      source_path: s('source_path'),
    };
  });
}

function loadClassifications(): Classification[] {
  const doc: unknown = JSON.parse(readFileSync(join(FIXTURES, 'classifications.json'), 'utf8'));
  assert.ok(isRecord(doc) && Array.isArray(doc['classifications']));
  return doc['classifications'].map((c: unknown) => {
    assert.ok(isRecord(c));
    const effect = c['effect'];
    assert.ok(effect === 'read' || effect === 'write' || effect === 'irreversible');
    assert.equal(c['draft'], true);
    return {
      client: String(c['client']),
      server: String(c['server']),
      tool: String(c['tool']),
      effect,
      egress: c['egress'] === true,
      untrusted_input: c['untrusted_input'] === true,
      matched: strings(c['matched']),
      draft: true,
    };
  });
}

function doc(bundle: GeneratedBundle, path: string): Record<string, unknown> {
  const f = bundle.files.find((x) => x.path === path);
  assert.ok(f, `${path} was generated`);
  const d: unknown = JSON.parse(f.text);
  assert.ok(isRecord(d));
  return d;
}

function table(bundle: GeneratedBundle, path: string, key: string): Record<string, unknown> {
  const t = doc(bundle, path)[key];
  assert.ok(isRecord(t), `${path}.${key}`);
  return t;
}

const NOW = new Date('2026-09-25T12:00:00Z');
let engine: Engine;
let runKey: KeygenResult;
let bundle: GeneratedBundle;

before(async () => {
  engine = await loadEngine(readFileSync(locateWasm()));
  const k = await keygen(engine);
  assert.ok(k.ok, 'keygen');
  runKey = k.result;
  bundle = await generateBundle(loadCatalog(), loadClassifications(), engine, { runKey, now: NOW, scanVersion: '0.1.0' });
});

test('the embedded schemas are the engine files byte for byte: each sha256 recomputes over the embedded text', () => {
  assert.equal(SCHEMAS.filter((s) => s.bundle).length, 12);
  for (const s of SCHEMAS) {
    assert.equal(createHash('sha256').update(s.text, 'utf8').digest('hex'), s.sha256, s.path);
  }
});

test('twelve members are generated, each valid against its engine schema, plus the sidecar', () => {
  const paths = bundle.files.map((f) => f.path);
  assert.deepEqual(new Set(paths.filter((p) => p !== SIDECAR)), new Set(MEMBER_SCHEMAS.keys()));
  assert.equal(paths.length, 13);
  for (const f of bundle.files) {
    if (MEMBER_SCHEMAS.has(f.path)) validateMember(f.path, JSON.parse(f.text));
  }
});

test('the unclassified tool gets NO risk function, and is listed as unclassified', () => {
  const rf = doc(bundle, 'risk_functions.json')['risk_functions'];
  assert.ok(Array.isArray(rf));
  const applies = rf.map((r: unknown) => (isRecord(r) ? r['applies_to'] : undefined));
  assert.ok(!applies.includes('mystery_tool'), 'an unclassified tool must be refused by the engine, not graded');
  assert.deepEqual(bundle.unclassified, [{ server: 'misc', tool: 'mystery_tool' }]);
  assert.equal(applies.length, 7, 'one per classified tool');
});

test('write tools are absent from reversibility, and present in notice_targets', () => {
  const rev = table(bundle, 'reversibility.json', 'reversibility');
  const notice = table(bundle, 'notice_targets.json', 'notice_targets');
  for (const w of ['send_email', 'create_issue']) {
    assert.ok(!(w in rev), `${w} must be left to RV-1`);
    assert.deepEqual(notice[w], ['developer']);
  }
  assert.equal(rev['deploy_production'], 'IRREVERSIBLE');
  assert.equal(rev['read_email'], 'REVERSIBLE');
  assert.ok(!('read_email' in notice));
});

test('floors: one per server from the drafts; a server with no classified tool has none', () => {
  assert.deepEqual(table(bundle, 'floors.json', 'floors'), {
    deploy_server: 'T3',
    github: 'T1',
    gitlab: 'T1',
    mail: 'T2',
  });
  assert.deepEqual(Object.keys(table(bundle, 'adapters.json', 'adapters')).sort(), [
    'deploy_server',
    'github',
    'gitlab',
    'mail',
    'misc',
  ]);
});

test('every PB-10 class has an addressee, the class list being the one the engine schema describes', () => {
  const alerts = table(bundle, 'alert_targets.json', 'alert_targets');
  // A second source for the list: the embedded schema's own text. The
  // generator reads ALERT_CLASSES (the loader's constant); this reads the
  // schema, so the two readings agreeing is a claim and not a tautology.
  const schema = SCHEMAS.find((s) => s.path.endsWith('/alert_targets.schema.json'));
  assert.ok(schema);
  const described = /enumerates \(([A-Z_, ]+)\)/.exec(schema.text);
  assert.ok(described?.[1]);
  const fromSchema = described[1].split(',').map((s) => s.trim());
  assert.ok(fromSchema.includes('FLOOD_CAP'));
  assert.deepEqual(Object.keys(alerts).sort(), [...fromSchema].sort());
  assert.deepEqual([...ALERT_CLASSES].sort(), [...fromSchema].sort());
  for (const c of fromSchema) assert.deepEqual(alerts[c], ['developer']);
});

test('the sidecar records the collision rather than merging the tools', () => {
  const side = doc(bundle, SIDECAR);
  assert.deepEqual(side['collisions'], [
    {
      kind: 'tool',
      normalised: 'search_code',
      originals: [
        { server: 'github', tool: 'search.code', assigned: 'search_code' },
        { server: 'github', tool: 'search_code', assigned: 'search_code_2' },
        { server: 'gitlab', tool: 'search_code', assigned: 'search_code_3' },
      ],
    },
  ]);
  const tools = side['tools'];
  assert.ok(Array.isArray(tools));
  assert.ok(tools.some((t: unknown) => isRecord(t) && t['tool'] === 'Create Issue' && t['key'] === 'create_issue'));
  // One name on two servers is two tools, each graded by its own draft.
  const rf = doc(bundle, 'risk_functions.json')['risk_functions'];
  assert.ok(Array.isArray(rf));
  const base = (k: string): unknown => rf.find((r: unknown) => isRecord(r) && r['applies_to'] === k);
  assert.deepEqual(base('search_code_2'), { applies_to: 'search_code_2', base: 'LOW', raise_to: [] });
  assert.deepEqual(base('search_code_3'), {
    applies_to: 'search_code_3',
    base: 'MEDIUM',
    raise_to: [{ if: 'resource.effective_tier >= T2', then: 'HIGH' }],
  });
});

test('bundle_verify, the real engine: the bundle activates with the run key, as generated and as written', async () => {
  assert.deepEqual(bundle.verified.tenant_id, bundle.tenantId);
  assert.match(bundle.tenantId, /^ten_demo_[0-9a-f]{8}$/);
  assert.equal(bundle.verified.epoch, 1);
  const v = bundle.verified;
  const ri = isRecord(v.receipt_identity) ? v.receipt_identity['name'] : undefined;
  const doors = isRecord(v.doors) ? Object.keys(v.doors).sort().join(',') : '';
  process.stdout.write(
    `# bundle_verify: ok tenant_id=${JSON.stringify(v.tenant_id)} epoch=${JSON.stringify(v.epoch)} ` +
      `receipt_identity=${String(ri)} doors=${doors} limits=${JSON.stringify(v.limits)}\n`,
  );

  const dir = join(mkdtempSync(join(tmpdir(), 'scan-bundle-')), 'bundle');
  writeBundle(bundle, dir);
  const files = listBundle(dir);
  assert.equal(files.length, 13);
  const sig: unknown = JSON.parse(readFileSync(join(dir, 'SIGNATURE'), 'utf8'));
  assert.ok(isRecord(sig) && typeof sig['suite'] === 'string' && isRecord(sig['parts']));
  const parts = sig['parts'];
  const again = await bundleVerify(engine, {
    suite: SUITE,
    members: files
      .filter((p) => p !== 'SIGNATURE')
      .map((p) => ({ path: p, bytes_hex: readFileSync(join(dir, p)).toString('hex') })),
    signature: { suite: sig['suite'], parts: { classical: String(parts['classical']), pq: String(parts['pq']) } },
    pubkeys: { classical_pub_hex: runKey.classical_pub_hex, pq_pub_hex: runKey.pq_pub_hex },
    now: Math.floor(NOW.getTime() / 1000),
  });
  assert.ok(again.ok, JSON.stringify(again));
  for (const p of files) process.stdout.write(`# member ${p} ${readFileSync(join(dir, p)).length} bytes\n`);
});

test('the engine grades with the generated policy: the raise clause parses and the unclassified tool is refused', async () => {
  const member = (path: string): Json => {
    const v: unknown = JSON.parse(bundle.files.find((f) => f.path === path)?.text ?? 'null');
    assert.ok(isJson(v) && v !== null, path);
    return v;
  };
  const policy = {
    floors: member('floors.json'),
    risk_functions: member('risk_functions.json'),
    reversibility: member('reversibility.json'),
    notice_targets: member('notice_targets.json'),
    adapters: member('adapters.json'),
  };
  const proposal = (task: string, server: string): Json => ({
    schema_id: server,
    schema_version: '1',
    schema_hash: 'sha256:s',
    fidelity: 'F-HIGH',
    tenant_id: bundle.tenantId,
    payload: { task_type: task, operator: 'developer', targets: [server], params: {}, cidrs: {} },
  });
  const send = await decide(engine, { proposal: proposal('send_email', 'mail'), policy });
  assert.ok(send.ok, JSON.stringify(send));
  assert.equal(send.result.risk_floor_only, 'HIGH', 'egress write at T2 is raised');
  assert.equal(send.result.decision, 'ATTEST');
  const read = await decide(engine, { proposal: proposal('read_email', 'mail'), policy });
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.result.decision, 'ALLOW');
  const issue = await decide(engine, { proposal: proposal('create_issue', 'github'), policy });
  assert.ok(issue.ok, JSON.stringify(issue));
  assert.deepEqual(issue.result.notice_recipients, ['developer'], 'a write below HIGH is IRREVERSIBLE by RV-1 and has an addressee');
  const mystery = await decide(engine, { proposal: proposal('mystery_tool', 'misc'), policy });
  assert.ok(!mystery.ok && mystery.error.kind === 'refusal', JSON.stringify(mystery));
  assert.equal(mystery.error.clause, '8.4-3');
});

test('a planted invalid member is refused by name before signing', () => {
  const { members } = policyMembers(loadCatalog(), loadClassifications());
  members.set('floors.json', { schema_version: '1', floors: { mail: 'T9' } });
  assert.throws(
    () => validateMembers(members),
    (e: unknown) => e instanceof BundleMemberInvalid && e.message.startsWith('floors.json: /floors/mail '),
  );
});

test('a planted invalid member is refused by name at write, and nothing is written', () => {
  const planted: GeneratedBundle = {
    ...bundle,
    files: bundle.files.map((f) =>
      f.path === 'reversibility.json'
        ? { path: f.path, text: JSON.stringify({ schema_version: '1', reversibility: { read_email: 'MAYBE' } }) }
        : f,
    ),
  };
  const dir = join(mkdtempSync(join(tmpdir(), 'scan-bundle-')), 'bundle');
  assert.throws(
    () => writeBundle(planted, dir),
    (e: unknown) =>
      e instanceof BundleMemberInvalid && String(e).startsWith('BundleMemberInvalid: reversibility.json: /reversibility/read_email '),
  );
  assert.ok(!existsSync(dir), 'nothing is written after a refusal');
});

test('a directory that already holds a manifest.json is never written into', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-bundle-'));
  writeFileSync(join(dir, 'manifest.json'), '{}');
  assert.throws(() => writeBundle(bundle, dir), BundleDirectoryOccupied);
  assert.deepEqual(listBundle(dir), ['manifest.json']);
});

test("the engine's refusal name is surfaced verbatim, and every throwaway key is dropped", async () => {
  const dropped: number[] = [];
  const minted: number[] = [];
  const wrapped: Engine = {
    callRaw: (op, t) => engine.callRaw(op, t),
    call: async (op, request) => {
      if (op === 'bundle_verify') {
        return { ok: false, error: { kind: 'refusal', clause: 'AuthorIsReviewer', message: '' } };
      }
      const r = await engine.call(op, request);
      if (op === 'drop_key' && typeof request['handle'] === 'number') dropped.push(request['handle']);
      if (op === 'keygen' && r.ok && isRecord(r.result) && typeof r.result['handle'] === 'number') minted.push(r.result['handle']);
      return r;
    },
  };
  await assert.rejects(
    generateBundle(loadCatalog(), loadClassifications(), wrapped, { runKey, now: NOW, scanVersion: '0.1.0' }),
    (e: unknown) => e instanceof BundleVerifyRefused && e.message === 'AuthorIsReviewer',
  );
  assert.equal(minted.length, 4);
  assert.deepEqual([...dropped].sort(), [...minted].sort(), 'approver and door keys are dropped');
  assert.ok(!dropped.includes(runKey.handle), 'the run key belongs to the caller');
});
