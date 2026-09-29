/**
 * The ninth case (ACP-451) against the REAL engine module, on the fixture home.
 *
 * The fixture home's echo server lists `read_email` and `send_email` on three
 * servers (`inbox`, `mail`, `notes`); `send` is on the irreversible keyword
 * list, so `send_email` is the only irreversible tool, every one of its servers
 * is floored T3, and the tie goes to the first server key: `inbox`. The
 * expected verdict is derived from the generation rules, not from running this
 * module: irreversible => base HIGH => the engine answers ATTEST => HELD for
 * the generated registry's `quorum_k`.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { generateBundle, writeBundle } from '../bundle/generate.js';
import type { GeneratedBundle } from '../bundle/generate.js';
import { classify } from '../classify/index.js';
import { discover } from '../discovery/index.js';
import { listServerTools } from '../mcp/client.js';
import type { CatalogTool } from '../types.js';
import { isJson, isRecord } from '../wasm/json.js';
import { loadEngine } from '../wasm/loader.js';
import type { Engine } from '../wasm/loader.js';
import type { Policy } from '../wasm/ops.js';
import { locateWasm } from '../wasm/locate.js';
import { dropKey, keygen } from '../wasm/ops.js';
import { loadReplayData } from './data.js';
import type { OwnTool } from './data.js';
import { generatedReplayData } from './generated.js';
import { hasOwnCase, OWN_FILE, selectOwn } from './own.js';
import { proposalHash } from './proposal.js';
import { WIDTH, renderReplay } from './render.js';
import { replay } from './replay.js';
import type { ReplayResult } from './replay.js';

const HOME = join(process.cwd(), 'fixtures', 'home');
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-own-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

const NOW = new Date('2026-09-25T12:00:00Z');
const LABEL = 'a proposal this scan wrote, not one an AI agent made';

let engine: Engine;
before(async () => {
  engine = await loadEngine(readFileSync(locateWasm()));
});

async function generated(catalog: CatalogTool[], out: string): Promise<{ bundle: GeneratedBundle; result: ReplayResult }> {
  const drafted = classify(catalog);
  const k = await keygen(engine);
  assert.ok(k.ok);
  let bundle: GeneratedBundle;
  try {
    bundle = await generateBundle(catalog, drafted.classifications, engine, { runKey: k.result, now: NOW });
    writeBundle(bundle, out);
  } finally {
    assert.ok((await dropKey(engine, k.result.handle)).ok);
  }
  const data = generatedReplayData(loadReplayData(), bundle, catalog, {
    path: out,
    engine_pin: 'pin-for-test',
    date: '2026-09-25T12:00:00Z',
  });
  return { bundle, result: await replay(engine, { now: Math.floor(NOW.getTime() / 1000), data }) };
}

let home: { bundle: GeneratedBundle; result: ReplayResult; out: string } | undefined;
async function fixtureHome(): Promise<{ bundle: GeneratedBundle; result: ReplayResult; out: string }> {
  if (home === undefined) {
    const found = discover('darwin', HOME, WORK, process.env);
    const catalog: CatalogTool[] = [];
    for (const s of found.servers) {
      const r = await listServerTools(s, 20_000);
      if (r.ok) catalog.push(...r.tools);
    }
    const out = join(WORK, 'policy');
    home = { ...(await generated(catalog, out)), out };
  }
  return home;
}

function registryK(bundle: GeneratedBundle): number {
  const f = bundle.files.find((x) => x.path === 'attesters/registry.json');
  assert.ok(f !== undefined);
  const r: unknown = JSON.parse(f.text);
  assert.ok(isRecord(r) && typeof r['quorum_k'] === 'number');
  return r['quorum_k'];
}

test('fixture home: the ninth case is send_email on inbox, HELD for the generated quorum', async () => {
  const { bundle, result } = await fixtureHome();
  const own = result.own;
  assert.ok(hasOwnCase(own), JSON.stringify(own));
  assert.equal(own.server, 'inbox');
  assert.equal(own.original_name, 'send_email');
  assert.equal(own.without, 'executes');
  assert.equal(own.label, LABEL);
  assert.equal(own.outcome.kind, 'held', JSON.stringify(own.outcome));
  assert.ok(own.outcome.kind === 'held');
  assert.equal(own.outcome.awaits.k, registryK(bundle));
  assert.equal(own.outcome.awaits.k, 2);
  assert.equal(own.outcome.risk, 'HIGH');
  assert.equal(own.outcome.reversibility, 'IRREVERSIBLE');
  assert.equal(own.outcome.awaits.policy_bundle_hash, result.run.policy_bundle_hash);
  // The eight harness rows are untouched by the ninth.
  assert.equal(result.rows.length, 8);
});

test('fixture home: ziffer-replay-own.json is written beside the policy folder, carries its provenance, and binds the same hash', async () => {
  const { result, out } = await fixtureHome();
  const own = result.own;
  assert.ok(hasOwnCase(own) && own.outcome.kind === 'held');
  const path = join(dirname(out), OWN_FILE);
  assert.ok(existsSync(path));
  const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(isRecord(doc));
  assert.equal(doc['label'], LABEL);
  const prov = doc['provenance'];
  assert.ok(isRecord(prov));
  assert.match(String(prov['scan_version']), /^\d+\.\d+\.\d+/);
  assert.equal(prov['engine_pin'], 'pin-for-test');
  assert.equal(prov['date'], '2026-09-25T12:00:00Z');
  assert.equal(prov['policy'], out);
  assert.deepEqual(prov['built_from'], {
    server: 'inbox',
    server_key: 'inbox',
    tool: own.tool,
    original_name: 'send_email',
    floor: 'T3',
    reversibility: 'IRREVERSIBLE',
  });
  const proposal = doc['proposal'];
  assert.ok(isRecord(proposal));
  const payload = proposal['payload'];
  assert.ok(isRecord(payload));
  assert.equal(payload['task_type'], own.tool);
  assert.deepEqual(payload['targets'], ['inbox']);
  assert.deepEqual(payload['params'], {});
  assert.equal(proposal['tenant_id'], result.run.tenant_id);
  // One hash: the file's, the row's, and the digest of the file's own Proposal.
  assert.equal(doc['proposal_hash'], own.outcome.awaits.proposal_hash);
  const again: unknown = JSON.parse(JSON.stringify(proposal));
  assert.ok(isJson(again));
  assert.equal(proposalHash(again), doc['proposal_hash']);
});

test('fixture home: the ninth row is printed under the eight, labelled, within 80 columns', async () => {
  const { result } = await fixtureHome();
  const text = renderReplay(result, { policyLabel: 'with the generated policy' });
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('own '));
  assert.ok(at > 0, text);
  assert.match(lines[at] ?? '', /^own\s+your tool on inbox\s+send_email\s+executes\s+HELD for 2 approvers$/);
  assert.equal((lines[at + 1] ?? '').trim(), '(high risk)');
  assert.equal((lines[at + 2] ?? '').trim(), LABEL);
  for (const l of lines.slice(1)) assert.ok(l.length <= WIDTH, `over ${WIDTH}: ${l}`);
});

test('a machine with no irreversible tool: own is absent, with the reason, and the file says so', async () => {
  const catalog: CatalogTool[] = [
    { client: 'Claude Code', server: 'mail', tool: 'read_email', description: 'Read the latest email.', params: [], source_path: '/x' },
  ];
  const out = join(WORK, 'policy-read-only');
  const { result } = await generated(catalog, out);
  assert.deepEqual(result.own, { absent: true, reason: 'no tool on this machine is classified irreversible; no ninth case' });
  assert.equal(hasOwnCase(result.own), false);
  const doc: unknown = JSON.parse(readFileSync(join(dirname(out), OWN_FILE), 'utf8'));
  assert.ok(isRecord(doc));
  assert.equal(doc['absent'], true);
  assert.equal(doc['reason'], 'no tool on this machine is classified irreversible; no ninth case');
  const text = renderReplay(result);
  assert.match(text, /no tool on this machine is classified irreversible; no ninth case/);
  assert.doesNotMatch(text, /^own /m);
});

test('the harness replay has no ninth case and writes nothing', async () => {
  const result = await replay(engine, { now: Math.floor(NOW.getTime() / 1000) });
  assert.equal(result.own, undefined);
  assert.equal('own' in result, false);
});

test('hasOwnCase is structural: a near miss is refused', async () => {
  const { result } = await fixtureHome();
  const own = result.own;
  assert.ok(hasOwnCase(own));
  assert.equal(hasOwnCase({ ...own, label: 'a proposal' }), false);
  assert.equal(hasOwnCase({ ...own, without: 'held' }), false);
  assert.equal(hasOwnCase({ ...own, outcome: { kind: 'held' } }), false);
  assert.equal(hasOwnCase(null), false);
});

test('selectOwn: at equal floors, a production execute_sql outranks a send-class tool; alphabetical between the two prod servers', () => {
  // ACP-454: the 0.2.3 run picked aws-pricing-calculator add_service over two production execute_sql.
  const catalog: CatalogTool[] = [
    { client: 'Claude Code', server: 'aws-pricing-calculator', tool: 'add_service', description: 'Sends the services to an estimate.', params: ['estimate_id'], source_path: '/x' },
    { client: 'Claude Code', server: 'db-prod-pgvector', tool: 'execute_sql', description: 'Execute a SQL statement.', params: ['sql'], source_path: '/x' },
    { client: 'Claude Code', server: 'db-prod-convergence', tool: 'execute_sql', description: 'Execute a SQL statement.', params: ['sql'], source_path: '/x' },
  ];
  const drafted = classify(catalog).classifications;
  assert.deepEqual(
    drafted.map((c) => [c.server, c.effect, c.reason]),
    [
      ['aws-pricing-calculator', 'irreversible', 'description says "Sends the services"'],
      ['db-prod-pgvector', 'irreversible', 'name says "execute"'],
      ['db-prod-convergence', 'irreversible', 'name says "execute"'],
    ],
  );
  const tools: OwnTool[] = [
    { key: 'add_service', server_key: 'aws_pricing_calculator', server: 'aws-pricing-calculator', original_name: 'add_service', effect_class: 1 },
    { key: 'execute_sql', server_key: 'db_prod_pgvector', server: 'db-prod-pgvector', original_name: 'execute_sql', effect_class: 3 },
    { key: 'execute_sql_2', server_key: 'db_prod_convergence', server: 'db-prod-convergence', original_name: 'execute_sql', effect_class: 3 },
  ];
  const policy: Policy = {
    floors: { floors: { aws_pricing_calculator: 'T3', db_prod_pgvector: 'T3', db_prod_convergence: 'T3' } },
    reversibility: { reversibility: { add_service: 'IRREVERSIBLE', execute_sql: 'IRREVERSIBLE', execute_sql_2: 'IRREVERSIBLE' } },
    risk_functions: {},
    notice_targets: {},
    adapters: {},
  };
  const picked = selectOwn(policy, tools);
  assert.equal(picked?.tool.server, 'db-prod-convergence');
  assert.equal(picked?.tool.original_name, 'execute_sql');
  assert.equal(picked?.floor, 'T3');
  // Production beats alphabetical at equal class: a non-prod execute_sql whose key sorts first loses.
  const plus: OwnTool[] = [...tools, { key: 'execute_sql_3', server_key: 'aaa_db', server: 'aaa-db', original_name: 'execute_sql', effect_class: 3 }];
  const withFloor: Policy = { ...policy, floors: { floors: { aws_pricing_calculator: 'T3', db_prod_pgvector: 'T3', db_prod_convergence: 'T3', aaa_db: 'T3' } }, reversibility: { reversibility: { add_service: 'IRREVERSIBLE', execute_sql: 'IRREVERSIBLE', execute_sql_2: 'IRREVERSIBLE', execute_sql_3: 'IRREVERSIBLE' } } };
  assert.equal(selectOwn(withFloor, plus)?.tool.server, 'db-prod-convergence');
});

test('the own-case classes come from the classifier: generatedReplayData carries effect_class for each tool', async () => {
  const catalog: CatalogTool[] = [
    { client: 'Claude Code', server: 'mail', tool: 'send_email', description: 'Send an email.', params: [], source_path: '/x' },
    { client: 'Claude Code', server: 'db-prod-convergence', tool: 'execute_sql', description: 'Execute a SQL statement.', params: ['sql'], source_path: '/x' },
    { client: 'Claude Code', server: 'mail', tool: 'read_email', description: 'Read the latest email.', params: [], source_path: '/x' },
  ];
  const out = join(WORK, 'policy-classes');
  const drafted = classify(catalog);
  const k = await keygen(engine);
  assert.ok(k.ok);
  let bundle: GeneratedBundle;
  try {
    bundle = await generateBundle(catalog, drafted.classifications, engine, { runKey: k.result, now: NOW });
  } finally {
    assert.ok((await dropKey(engine, k.result.handle)).ok);
  }
  const data = generatedReplayData(loadReplayData(), bundle, catalog, { path: out, engine_pin: 'pin', date: '2026-09-25T12:00:00Z' });
  assert.deepEqual(
    (data.own?.tools ?? []).map((t) => [t.original_name, t.effect_class]).sort(),
    [['execute_sql', 3], ['read_email', 0], ['send_email', 1]],
  );
  const { result } = await generated(catalog, out);
  assert.ok(hasOwnCase(result.own));
  assert.equal(result.own.original_name, 'execute_sql');
});
