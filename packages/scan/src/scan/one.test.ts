/**
 * ONE scan (ACP-455, 0.3.0), the whole command in process: the codebase and
 * the installed AI tools in one run, one result, ONE draft policy.
 *
 * The codebase is `fixtures/code/example-shape` (six tools, one dispatcher),
 * the installed tools are `fixtures/home` (the echo server under three names,
 * see `e2e.test.ts`). Run from packages/scan, as `pnpm test` runs it: the
 * echo server's path is relative, and the fixture codebase resolves its SDK
 * types through this package's node_modules.
 *
 * The one-policy test does not trust the run's own account of its policy: it
 * reads the folder back from disk, has the ENGINE verify its signature and
 * recompute its tree hash, and asks `decide` again, against the members on
 * disk, for every code tool, with the Proposal the pasted snippet would send
 * (built from `ziffer-tools.json`). A second policy anywhere in the run (the
 * pre-0.3.0 shape: one for the code, one for the installed tools) fails it.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listBundle, SUITE } from '../bundle/generate.js';
import { type CliContext, NO_CODEBASE_LINE, notACodebase, run } from '../cli.js';
import { loadReplayData } from '../replay/data.js';
import { FIDELITY } from '../replay/generated.js';
import { isJson, isRecord, type Json } from '../wasm/json.js';
import { type Engine, loadEngine } from '../wasm/loader.js';
import { locateWasm } from '../wasm/locate.js';
import { bundleVerify, decide, treeHash } from '../wasm/ops.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const HOME = join(PKG, 'fixtures', 'home');
const CODE = join(PKG, 'fixtures', 'code', 'example-shape');
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-one-'));
after(() => rmSync(WORK, { recursive: true, force: true }));
const NOW = new Date('2026-09-27T12:00:00Z');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NO_COLOR'));

let engine: Engine;
before(async () => {
  engine = await loadEngine(readFileSync(locateWasm()));
});

interface Ran {
  code: number;
  out: string[];
  err: string[];
  said: string;
}

async function scan(args: string[], over: Partial<CliContext> = {}): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const prompted: string[] = [];
  const ctx: CliContext = {
    env: ENV,
    platform: 'darwin',
    home: join(WORK, 'not-the-home'),
    cwd: WORK,
    stdin: Readable.from([]),
    isTTY: false,
    prompt: (t) => prompted.push(t),
    now: () => NOW,
    ...over,
  };
  const code = await run(args, { out: (l) => out.push(l), err: (l) => err.push(l) }, ctx);
  return { code, out, err, said: prompted.join('') };
}

function json(r: Ran): Record<string, unknown> {
  const doc: unknown = JSON.parse(r.out.join('\n'));
  assert.ok(isRecord(doc), r.out.join('\n'));
  return doc;
}

function array(v: unknown, what: string): unknown[] {
  assert.ok(Array.isArray(v), what);
  return v;
}

function record(v: unknown, what: string): Record<string, unknown> {
  assert.ok(isRecord(v), what);
  return v;
}

function text(v: unknown, what: string): string {
  assert.equal(typeof v, 'string', what);
  return String(v);
}

function readJson(path: string): Record<string, unknown> {
  return record(JSON.parse(readFileSync(path, 'utf8')), path);
}

/** Every directory under `dir` that holds a signed policy (a manifest.json beside a SIGNATURE). */
function policyFolders(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    const names = readdirSync(d);
    if (names.includes('manifest.json') && names.includes('SIGNATURE')) found.push(d);
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(join(d, e.name));
  };
  walk(dir);
  return found.sort();
}

const hex = (b64: string): string => Buffer.from(b64, 'base64').toString('hex');

test('the default run reads the codebase AND the installed tools: one result with both halves, ONE policy the engine verifies, every code verdict made against it', async () => {
  const base = join(WORK, 'both');
  mkdirSync(base);
  const out = join(base, 'ziffer-scan', 'ziffer-policy');
  const r = await scan(['--home', HOME, '--cwd', CODE, '--platform', 'darwin', '--yes', '--json', '--out', out]);
  assert.equal(r.code, 0, `${r.err.join('\n')}\n${r.said}`);
  const doc = json(r);

  // Both halves in the one result.
  const code = record(doc['code'], 'code');
  const counts = record(code['counts'], 'code.counts');
  assert.equal(counts['tools'], 6);
  // The JSON carries today's grade, written by the one function the reports print it from (ACP-464 item 8).
  const grade = record(code['grade'], 'code.grade');
  assert.deepEqual(Object.keys(grade).sort(), ['best', 'provisional_files', 'today', 'unclassified', 'worst', ...(grade['best'] === grade['worst'] ? [] : ['reachable'])].sort());
  assert.equal(grade['today'], grade['worst'], 'today is the worst case');
  if (grade['best'] !== grade['worst']) assert.equal(grade['reachable'], grade['best']);
  assert.ok(array(doc['catalog'], 'catalog').length > 0, 'the installed tools are in the result');
  assert.ok(array(doc['clients_scanned'], 'clients_scanned').length > 0);
  assert.ok(isRecord(doc['reach']), 'reach');
  assert.ok(isRecord(doc['replay']), 'the replay ran, against the same policy');
  // The codebase was read first, before the listing of servers to start.
  assert.ok(r.said.indexOf('of your code') >= 0 && r.said.indexOf('of your code') < r.said.indexOf('tool servers will be started'), r.said);

  // ONE policy folder in everything the run wrote.
  assert.deepEqual(policyFolders(base), [out]);
  const policy = record(doc['policy'], 'policy');
  assert.equal(policy['path'], out);

  // The engine verifies the folder on disk and recomputes the tree hash the result states.
  const files = listBundle(out);
  const members = files.filter((p) => p !== 'SIGNATURE').map((p) => ({ path: p, bytes_hex: readFileSync(join(out, p)).toString('hex') }));
  const sig = readJson(join(out, 'SIGNATURE'));
  const parts = record(sig['parts'], 'SIGNATURE.parts');
  const identity = readJson(join(out, 'receipt_identity.json'));
  const verified = await bundleVerify(engine, {
    suite: SUITE,
    members,
    signature: { suite: text(sig['suite'], 'suite'), parts: { classical: text(parts['classical'], 'classical'), pq: text(parts['pq'], 'pq') } },
    pubkeys: { classical_pub_hex: hex(text(identity['classical'], 'classical')), pq_pub_hex: hex(text(identity['pq'], 'pq')) },
    now: Math.floor(NOW.getTime() / 1000),
  });
  assert.ok(verified.ok, JSON.stringify(verified));
  const digests = files
    .filter((p) => p !== 'SIGNATURE')
    .map((p) => ({ path: p, sha256_hex: createHash('sha256').update(readFileSync(join(out, p))).digest('hex') }));
  const hash = await treeHash(engine, SUITE, digests);
  assert.ok(hash.ok, JSON.stringify(hash));
  assert.equal(hash.result.hash, policy['tree_hash']);

  // The policy names both halves: an installed tool's server and every code tool's resource.
  const floors = record(readJson(join(out, 'floors.json'))['floors'], 'floors');
  assert.ok('mail' in floors && 'inbox' in floors, Object.keys(floors).join(', '));
  const toolsPath = text(doc['tools_file'], 'tools_file');
  const toolsFile = readJson(toolsPath);
  const table = record(toolsFile['tools'], 'ziffer-tools.json tools');
  const verdicts = array(code['verdicts'], 'code.verdicts');
  assert.equal(Object.keys(table).length, verdicts.length);

  // Every code verdict is decide's answer against the members ON DISK, for the Proposal the snippet sends.
  const asJson = (v: unknown, what: string): Json => {
    assert.ok(isJson(v), what);
    return v;
  };
  const disk = (name: string): Json => asJson(JSON.parse(readFileSync(join(out, `${name}.json`), 'utf8')), name);
  const onDisk = {
    floors: disk('floors'),
    risk_functions: disk('risk_functions'),
    reversibility: disk('reversibility'),
    notice_targets: disk('notice_targets'),
    adapters: disk('adapters'),
  };
  const operator = loadReplayData().operator;
  for (const v of verdicts) {
    const row = record(v, 'verdict');
    const name = text(record(row['tool'], 'tool')['name'], 'tool.name');
    const keys = record(table[name], `ziffer-tools.json ${name}`);
    assert.ok(text(keys['resource'], 'resource') in floors, `${name}: its resource is not in the policy on disk`);
    const proposal = {
      schema_id: keys['resource'],
      schema_version: toolsFile['schema_version'],
      schema_hash: keys['schema_hash'],
      fidelity: FIDELITY,
      tenant_id: policy['tenant_id'],
      payload: { task_type: keys['task_type'], operator, targets: [keys['resource']], params: {}, cidrs: {} },
    };
    const again = await decide(engine, { proposal: asJson(proposal, 'proposal'), policy: onDisk });
    const recorded = record(row['verdict'], 'verdict.verdict');
    if (again.ok) assert.equal(recorded['verdict'], again.result.decision, name);
    else {
      assert.equal(again.error.kind, 'refusal', `${name}: ${again.error.message}`);
      assert.equal(recorded['verdict'], 'REFUSED', name);
    }
  }
});

test('--code reads the codebase only: no client configuration read, no server started, no replay', async () => {
  const out = join(WORK, 'code-only', 'ziffer-scan', 'ziffer-policy');
  // The home holds the fixture configuration: were discovery to run, it would find and start the echo server.
  const r = await scan(['--code', '--cwd', CODE, '--json', '--out', out], { home: HOME });
  assert.equal(r.code, 0, r.err.join('\n'));
  const doc = json(r);
  assert.deepEqual(doc['catalog'], []);
  assert.deepEqual(doc['clients_scanned'], []);
  assert.equal(doc['reach'], undefined);
  assert.equal(doc['replay'], null);
  assert.equal(record(record(doc['code'], 'code')['counts'], 'counts')['tools'], 6);
  assert.ok(!r.said.includes('will be started') && !r.said.includes('starting'), r.said);
  // The preamble opens with the wordmark and wraps at the terminal width, as the default run's does.
  // Re-pointed by ACP-464: reading Python runs this machine's own Python, so the preamble no longer says "starts nothing".
  assert.ok(r.said.replace(/\s+/g, ' ').includes(`Reads your code under ${CODE}; starts no tool server, runs this machine's Python to read Python`), r.said);
  assert.ok(!r.said.includes('starts nothing'), r.said);
  assert.ok(existsSync(text(doc['tools_file'], 'tools_file')));
});

test('--no-code reads the installed tools only: no codebase walked, no ziffer-tools.json', async () => {
  const base = join(WORK, 'no-code');
  const out = join(base, 'ziffer-scan', 'ziffer-policy');
  const r = await scan(['--no-code', '--home', HOME, '--cwd', CODE, '--platform', 'darwin', '--yes', '--no-replay', '--json', '--out', out]);
  assert.equal(r.code, 0, r.err.join('\n'));
  const doc = json(r);
  assert.equal(doc['code'], undefined);
  assert.equal(doc['tools_file'], undefined);
  assert.ok(array(doc['catalog'], 'catalog').length > 0);
  assert.ok(!r.said.includes('of your code'), r.said);
  assert.ok(!existsSync(join(base, 'ziffer-scan', 'ziffer-tools.json')));
  assert.deepEqual(policyFolders(base), [out]);
});

test('run from the home directory: the codebase is not walked, one line says why, the installed tools are still read', async () => {
  const home = join(WORK, 'a-home');
  mkdirSync(home);
  const out = join(WORK, 'from-home', 'ziffer-policy');
  const r = await scan(['--home', HOME, '--platform', 'darwin', '--yes', '--no-replay', '--json', '--out', out], { home, cwd: home });
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.ok(r.said.includes(NO_CODEBASE_LINE), r.said);
  assert.ok(!r.said.includes('of your code'), r.said);
  const doc = json(r);
  assert.equal(doc['code'], undefined);
  assert.ok(array(doc['catalog'], 'catalog').length > 0);
});

test('--code from the home directory refuses by name, exit 2, nothing written', async () => {
  const home = join(WORK, 'b-home');
  mkdirSync(home);
  const out = join(WORK, 'code-from-home', 'ziffer-policy');
  const r = await scan(['--code', '--out', out], { home, cwd: home });
  assert.equal(r.code, 2);
  assert.match(r.err[0] ?? '', /^NoCodebase: /);
  assert.equal(existsSync(out), false);
});

test('not a codebase: the filesystem root and any home given; a project folder is one', () => {
  assert.equal(notACodebase('/', []), true);
  assert.equal(notACodebase('/Users/someone', ['/Users/someone']), true);
  assert.equal(notACodebase('/Users/someone/', ['/Users/someone']), true);
  assert.equal(notACodebase('/Users/someone/project', ['/Users/someone']), false);
});
