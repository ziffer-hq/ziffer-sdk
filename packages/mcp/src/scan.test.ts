/**
 * `scan` over the MCP transport (ACP-446 step 2), against the scan package's
 * own fixture home.
 *
 * The fixture configs name the echo server by a RELATIVE path, resolved
 * against the directory the servers are started in, which is this process's —
 * `packages/scan/src/e2e.test.ts` runs from `packages/scan` for that reason.
 * This file runs in its own process under `node --test`, so it changes into
 * `packages/scan` for the servers to resolve and changes back after.
 *
 * Needs the engine module (`packages/scan/dist/acp_wasm.wasm`, or
 * `ZIFFER_SCAN_WASM`), as the scan's own end-to-end test does. Without it every
 * call refuses `EngineWasmAbsent` and the tests fail; nothing is skipped.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HELP } from '@ziffer-io/scan';

import { VARS, type Env } from './config.js';
import { SCAN_JSON_FILE } from './scan.js';
import { isRecord } from './scan-code.js';
import { createServer, type ServerDeps } from './server.js';
import type { ClientFactory } from './tools.js';

/** `packages/scan`, found the way this package finds it at run time. */
const SCAN_PKG = dirname(dirname(createRequire(import.meta.url).resolve('@ziffer-io/scan')));
const HOME = join(SCAN_PKG, 'fixtures', 'home');
const ECHO = join(SCAN_PKG, 'fixtures', 'mcp', 'echo-server.mjs');
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-mcp-scan-'));
const PROJECT = join(WORK, 'project');
mkdirSync(PROJECT);

/**
 * Every credential-shaped value in `packages/scan/fixtures/home`, none of
 * which may be printed. Copied from `SECRETS` in `packages/scan/src/e2e.test.ts`
 * (ACP-449), which is not part of the package's library surface; the fixture
 * home is the same one, so a secret added there without landing here is a
 * value this file does not look for.
 */
const SECRETS = ['sk_test_fixture_0001', 'sntryu_fixture_0002', 'fixture-remote-0003', 'fixture-env-value-0004'];

const ENV: Env = { ...process.env, [VARS.API_URL]: 'https://api.example.test' };

const STUB: ClientFactory = async () => {
  throw new Error('scan must not reach the gateway');
};

const cwdBefore = process.cwd();
before(() => process.chdir(SCAN_PKG));
after(() => {
  process.chdir(cwdBefore);
  rmSync(WORK, { recursive: true, force: true });
});

async function connect(scan: NonNullable<ServerDeps['scan']>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ env: ENV, clientFor: STUB, scan });
  const client = new Client({ name: 'ziffer-mcp-scan-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface Called {
  /** The first content block: what the agent reads first. */
  readonly text: string;
  readonly structured: Record<string, unknown>;
  readonly isError: boolean;
}

/** One tool call, its three content blocks checked against its structured content. */
async function callOn(client: Client, name: string, args: Record<string, unknown>): Promise<Called> {
  const result: unknown = await client.callTool({ name, arguments: args });
  assert.ok(typeof result === 'object' && result !== null, 'result is not an object');
  const record: Record<string, unknown> = { ...result };
  const content = record['content'];
  assert.ok(
    Array.isArray(content) && content.length === 3,
    'expected the text block, the JSON block and the next step',
  );
  const texts = content.map((block: unknown) => {
    assert.ok(typeof block === 'object' && block !== null, 'content block is not an object');
    const fields: Record<string, unknown> = { ...block };
    assert.equal(fields['type'], 'text');
    return String(fields['text']);
  });
  const structured = record['structuredContent'];
  assert.ok(isRecord(structured), 'no structured content');
  assert.deepEqual(JSON.parse(texts[1] ?? ''), structured, 'the JSON block is not the structured content');
  assert.match(texts[2] ?? '', /^Next: \S/, 'the last block is not a next step');
  return { text: texts[0] ?? '', structured, isError: record['isError'] === true };
}

async function callScan(scan: NonNullable<ServerDeps['scan']>, args: Record<string, unknown>): Promise<Called> {
  return callOn(await connect(scan), 'scan', args);
}

/** A field of a structured record that must itself be a record. */
function field(r: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = r[key];
  assert.ok(isRecord(v), `${key} is not an object: ${JSON.stringify(v)}`);
  return v;
}

function assertNoSecret(text: string, where: string): void {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${where} printed ${secret}`);
  assert.ok(text.includes('[redacted]'), `${where} shows no [redacted] where a credential was`);
}

const FIXTURE = { home: HOME, cwd: PROJECT, platform: 'darwin' };

test('the JSON file the tool reads is the one the scan says --report writes', () => {
  assert.ok(HELP.includes(SCAN_JSON_FILE), `the scan's help no longer names ${SCAN_JSON_FILE}`);
});

test('without confirm: the redacted list of what would start, and NOTHING started', async () => {
  // A home whose one server writes a file the moment it starts (the echo
  // server's --env-out). The fixture home cannot show a start: its servers
  // leave no trace, so "nothing started" over it alone would pass forever.
  const probeHome = join(WORK, 'probe-home');
  const marker = join(WORK, 'probe-started.json');
  mkdirSync(probeHome);
  writeFileSync(
    join(probeHome, '.claude.json'),
    JSON.stringify({ mcpServers: { probe: { type: 'stdio', command: process.execPath, args: [ECHO, '--env-out', marker] } } }),
  );
  const probe = { home: probeHome, cwd: PROJECT, platform: 'darwin' };

  const first = await callScan(probe, {});
  assert.ok(!existsSync(marker), 'the first call started a server');
  assert.equal(first.isError, false, first.text);
  assert.match(first.text, /probe/, first.text);
  assert.match(first.text, /confirm: true/, first.text);

  // The probe can see a start: the confirmed call starts it and the marker appears.
  // Each confirmed call gets its own parent: --report writes beside the folder.
  mkdirSync(join(WORK, 'probe'));
  const out = join(WORK, 'probe', 'policy');
  const second = await callScan(probe, { confirm: true, out });
  assert.equal(second.isError, false, second.text);
  assert.ok(existsSync(marker), 'the confirmed call did not start the probe, so its absence above proves nothing');

  // Over the fixture home: the list, every credential redacted, nothing written.
  const listed = await callScan(FIXTURE, {});
  assert.equal(listed.isError, false, listed.text);
  for (const server of ['mail', 'notes', 'inbox']) assert.match(listed.text, new RegExp(`\\b${server}\\b`), listed.text);
  assert.match(listed.text, /Nothing was started/);
  assertNoSecret(listed.text, 'the first call');
});

test('with confirm: true over the fixture home: the one screen, the JSON result, 13 policy files, no secret', async () => {
  mkdirSync(join(WORK, 'confirmed'));
  const out = join(WORK, 'confirmed', 'policy');
  const r = await callScan(FIXTURE, { confirm: true, out });
  assert.equal(r.isError, false, r.text);
  const installed = field(r.structured, 'installed');
  assert.equal(installed['status'], 'scanned');
  const report = installed['report'];
  assert.ok(Array.isArray(report), 'no report lines');
  assert.match(String(report[0]), /^ZIFFER scan \S+ · this machine · nothing was sent anywhere$/, r.text);
  assert.equal(installed['policy'], out);
  const jsonPath = join(WORK, 'confirmed', SCAN_JSON_FILE);
  assert.equal(installed['json'], jsonPath);
  const lines = r.text.split('\n');
  assert.ok(lines.includes(`Policy folder: ${out}`), r.text);
  assert.ok(lines.includes(`JSON result: ${jsonPath}`), r.text);

  const doc = installed['result'];
  assert.deepEqual(doc, JSON.parse(readFileSync(jsonPath, 'utf8')), 'the served JSON is not the file');
  assert.ok(isRecord(doc), 'no JSON result');
  const policy = doc['policy'];
  assert.ok(isRecord(policy) && Array.isArray(policy['files']));
  assert.equal(policy['files'].length, 13);
  assert.ok(existsSync(join(out, 'SIGNATURE')), 'the policy folder was not written');
  assertNoSecret(r.text, 'the confirmed call');
  assertNoSecret(JSON.stringify(r.structured), 'the confirmed call\'s structured content');
});

test('without out, the folder goes under the temporary directory, named for the day', async () => {
  const r = await callScan({ ...FIXTURE, now: () => new Date('2026-09-26T12:00:00Z') }, { confirm: true });
  assert.equal(r.isError, false, r.text);
  const line = r.text.split('\n').find((l) => l.startsWith('Policy folder: ')) ?? '';
  const folder = line.slice('Policy folder: '.length);
  try {
    assert.ok(folder.startsWith(tmpdir()), `${folder} is not under ${tmpdir()}`);
    assert.match(folder, /[/\\]ziffer-policy-2026-09-26$/);
    assert.ok(existsSync(join(folder, 'SIGNATURE')));
  } finally {
    if (folder !== '') rmSync(dirname(folder), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ACP-455: the codebase half, over the scan package's own fixture codebase.

const CODEBASE = join(SCAN_PKG, 'fixtures', 'code', 'example-shape');

/** Model-side remedies the recommendation must never make. Matched case-insensitively. */
const BANNED = ['prompt filter', 'system prompt', 'classifier', 'content filter', 'be careful', 'guardrail', 'requires_confirmation'];

function assertNoBanned(text: string, where: string): void {
  for (const term of BANNED) assert.ok(!text.toLowerCase().includes(term), `${where} recommends "${term}": ${text}`);
}

/** One server, one codebase scan, shared by the tests that read it: the code
 * scan takes seconds, and explain_scan_finding needs the SAME server's scan. */
let shared: Promise<{ client: Client; r: Called }> | undefined;
function codebaseScan(): Promise<{ client: Client; r: Called }> {
  shared ??= (async () => {
    const client = await connect(FIXTURE);
    return { client, r: await callOn(client, 'scan', { cwd: CODEBASE, include_installed: false }) };
  })();
  return shared;
}

function tools(r: Called): Record<string, unknown>[] {
  const list = field(r.structured, 'codebase')['tools'];
  assert.ok(Array.isArray(list), 'no tools list');
  return list.map((t: unknown) => {
    assert.ok(isRecord(t));
    return t;
  });
}

test('codebase: every tool with its file:line and the engine verdict, the insertion, the paths', async () => {
  const { r } = await codebaseScan();
  assert.equal(r.isError, false, r.text);
  const codebase = field(r.structured, 'codebase');
  assert.equal(codebase['status'], 'scanned');
  const listed = tools(r);
  assert.deepEqual(
    listed.map((t) => t['name']).sort(),
    ['add_charge', 'cancel_reservation', 'get_property', 'lookupWeather', 'search_docs', 'send_guest_message'],
  );
  for (const t of listed) {
    assert.match(String(t['at']), /^src\/.+\.ts:\d+$/, JSON.stringify(t));
    assert.ok(['ALLOW', 'ATTEST', 'REFUSED'].includes(String(t['verdict'])), JSON.stringify(t));
    assert.equal(typeof t['what_ziffer_does'], 'string');
  }
  const held = listed.filter((t) => t['outcome'] === 'held').map((t) => t['name']).sort();
  assert.deepEqual(held, ['add_charge', 'cancel_reservation', 'send_guest_message']);
  // The four tallies this package sorts verdicts into equal the scan's own counts.
  const counts = field(r.structured, 'counts');
  for (const outcome of ['held', 'notified', 'allowed', 'refused']) {
    assert.equal(listed.filter((t) => t['outcome'] === outcome).length, counts[outcome], `${outcome} disagrees with the scan's count`);
  }
  const insertion = field(codebase, 'insertion');
  // The fixture's dispatcher has a `ctx` parameter: the operator is passed from it (ACP-455, 2026-09-28).
  assert.equal(insertion['call'], 'await zifferGate(name, input, zifferOperator(ctx));');
  assert.ok(String(insertion['snippet']).includes("from '@ziffer-io/client'"));
  assert.ok(existsSync(String(insertion['tools_file'])), 'ziffer-tools.json was not written');
  const dispatcher = field(codebase, 'dispatcher');
  assert.equal(dispatcher['at'], 'src/tools/tool-executor.ts:5');
  assert.deepEqual(dispatcher['callers'], ['src/decorators/decision-logger.ts:6', 'src/orchestrator/tool-bridge.ts:18', 'src/routes/confirmed-write.ts:6']);
  assert.ok(existsSync(join(String(codebase['draft_policy']), 'SIGNATURE')), 'the draft policy was not written');
  assert.ok(existsSync(String(codebase['report'])), 'the HTML report was not written');
  assert.ok(Array.isArray(codebase['exposures']) && codebase['exposures'].length > 0, 'no exposures');
  assert.ok(Array.isArray(codebase['gates']) && codebase['gates'].length > 0, 'no gates');
  assert.ok(Array.isArray(codebase['not_seen']) && codebase['not_seen'].length > 0, 'no not_seen');
  // Written outside the project, never into it.
  assert.ok(!String(codebase['draft_policy']).startsWith(CODEBASE), 'the draft policy landed in the project');
  // The text leads with the numbers.
  assert.match(r.text.split('\n')[1] ?? '', /6 tools .* 3 held for a person/, r.text);
});

test('remediation: the dispatcher\'s file:line and the call line; model-side remedies only as NOT a fix', async () => {
  const { r } = await codebaseScan();
  const rem = field(r.structured, 'remediation');
  const steps = rem['steps'];
  assert.ok(Array.isArray(steps) && steps.length > 0);
  const recommendation = [rem['finding'], rem['fix'], ...steps, rem['offer']].map(String).join('\n');
  assert.ok(recommendation.includes('src/tools/tool-executor.ts:5'), recommendation);
  assert.ok(recommendation.includes('await zifferGate(name, input, zifferOperator(ctx));'), recommendation);
  assert.ok(recommendation.includes('Which field of ctx identifies the signed-in person is yours to choose there'), recommendation);
  assert.match(recommendation, /remove that authority from the model path/i);
  assert.ok(recommendation.includes('https://ziffer.io/docs/quickstart') && recommendation.includes('https://ziffer.io/docs/developers/sdk'));
  assert.ok(recommendation.includes('ziffer-tools.json'));
  assertNoBanned(recommendation, 'remediation');

  const notFix = field(rem, 'not_a_fix');
  const items = notFix['items'];
  assert.ok(Array.isArray(items));
  const said = [...items, notFix['why']].map(String).join('\n').toLowerCase();
  for (const term of ['prompt filter', 'classifier', 'be careful', 'guardrail', 'requires_confirmation', '5.1a']) {
    assert.ok(said.includes(term), `the not-a-fix section does not name ${term}`);
  }
  assert.match(String(rem['verdicts']), /engine/);
  assert.match(String(rem['verdicts']), /Do not re-grade/);

  // The text block: THE FIX section recommends none of them, NOT A FIX names them.
  const fixStart = r.text.indexOf('THE FIX:');
  const notStart = r.text.indexOf('NOT A FIX');
  assert.ok(fixStart >= 0 && notStart > fixStart, 'the text has no FIX then NOT A FIX sections');
  assertNoBanned(r.text.slice(fixStart, notStart), 'the text\'s fix section');
  assert.match(r.text.slice(notStart), /prompt filter/);
});

test('explain_scan_finding: a held tool names its policy member, the entry and a docs URL', async () => {
  const { client } = await codebaseScan();
  const e = await callOn(client, 'explain_scan_finding', { tool: 'add_charge' });
  assert.equal(e.isError, false, e.text);
  const decided = field(e.structured, 'decided_by');
  assert.equal(decided['file'], 'risk_functions.json');
  assert.equal(decided['key'], 'add_charge');
  assert.ok(isRecord(decided['value']) && decided['value']['base'] === 'HIGH', JSON.stringify(decided));
  assert.equal(decided['doc'], 'https://ziffer.io/docs/policy/by-example#6-risk_functionsjson');
  assert.match(String(e.structured['because']), /ATTEST/);
  const members = e.structured['policy_members'];
  assert.ok(Array.isArray(members) && members.length === 4);
  assert.ok(e.text.includes('src/tools/tool-executor.ts:5'), 'the explanation carries no fix');
  assertNoBanned(e.text.slice(e.text.indexOf('THE FIX:'), e.text.indexOf('NOT A FIX')), 'the explanation\'s fix');

  const missing = await callOn(client, 'explain_scan_finding', { tool: 'no_such_tool' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /^ToolNotInScan: .*add_charge/);
});

test('explain_scan_finding before any scan refuses by name', async () => {
  const e = await callOn(await connect(FIXTURE), 'explain_scan_finding', { tool: 'add_charge' });
  assert.equal(e.isError, true);
  assert.match(e.text, /^NoScanYet: /);
});

test('codebase only, with no cwd and no roots: ScanCwdRequired, and nothing scanned', async () => {
  const r = await callScan(FIXTURE, { include_installed: false });
  assert.equal(r.isError, true);
  assert.match(r.text, /^ScanCwdRequired: /);
});

test('phase one with the codebase: the codebase result comes back and NO server starts', async () => {
  const probeHome = join(WORK, 'probe-home-code');
  const marker = join(WORK, 'probe-code-started.json');
  mkdirSync(probeHome);
  writeFileSync(
    join(probeHome, '.claude.json'),
    JSON.stringify({ mcpServers: { probe: { type: 'stdio', command: process.execPath, args: [ECHO, '--env-out', marker] } } }),
  );
  const r = await callScan({ home: probeHome, cwd: PROJECT, platform: 'darwin' }, { cwd: CODEBASE, report: false });
  assert.equal(r.isError, false, r.text);
  assert.ok(!existsSync(marker), 'phase one started a server');
  assert.equal(r.structured['phase'], 'listing');
  assert.equal(field(r.structured, 'installed')['status'], 'awaiting_confirmation');
  assert.equal(field(field(r.structured, 'codebase'), 'counts')['tools'], 6);
  assert.equal(field(r.structured, 'codebase')['report'], undefined, 'report: false still wrote the HTML report');
  // The result says plainly which half was not scanned.
  assert.deepEqual(r.structured['scope'], { code: 'read', installed: false });
});

// ---------------------------------------------------------------------------
// ACP-455: the confirmed call is ONE scan, as `npx @ziffer-io/scan` is.

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

/** The fresh folders this package makes under the system temporary directory (`freshOut`). */
function freshFolders(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('ziffer-scan-')));
}

function readRecord(path: string): Record<string, unknown> {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(isRecord(v), path);
  return v;
}

test('confirmed, with the codebase: ONE policy folder in everything the call wrote, naming both halves\' tools', async () => {
  const base = join(WORK, 'one');
  mkdirSync(base);
  const out = join(base, 'policy');
  const before = freshFolders();
  const r = await callScan(FIXTURE, { cwd: CODEBASE, confirm: true, out });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.structured['phase'], 'complete');
  assert.deepEqual(r.structured['scope'], { code: 'read', installed: true });

  // ONE policy folder: the one asked for, and none in a fresh temporary folder beside it.
  assert.deepEqual(policyFolders(base), [out]);
  const extra = [...freshFolders()].filter((n) => !before.has(n)).flatMap((n) => policyFolders(join(tmpdir(), n)));
  assert.deepEqual(extra, [], `a second draft policy was written: ${extra.join(', ')}`);

  const codebase = field(r.structured, 'codebase');
  const installed = field(r.structured, 'installed');
  assert.equal(codebase['status'], 'scanned');
  assert.equal(installed['status'], 'scanned');
  assert.equal(codebase['draft_policy'], out, 'the codebase half names another policy');
  assert.equal(installed['policy'], out, 'the installed half names another policy');
  assert.equal(field(codebase, 'counts')['tools'], 6);

  // Both halves' tools in the one policy ON DISK: the installed servers, and every code tool's resource.
  const floors = field(readRecord(join(out, 'floors.json')), 'floors');
  assert.ok('mail' in floors && 'inbox' in floors, `no installed server in the policy: ${Object.keys(floors).join(', ')}`);
  const toolsFile = String(field(codebase, 'insertion')['tools_file']);
  assert.equal(dirname(toolsFile), base, 'ziffer-tools.json is not beside the one policy');
  const table = field(readRecord(toolsFile), 'tools');
  assert.equal(Object.keys(table).length, 6);
  for (const [name, keys] of Object.entries(table)) {
    assert.ok(isRecord(keys), name);
    assert.ok(String(keys['resource']) in floors, `${name}: its resource is not in the policy: ${Object.keys(floors).join(', ')}`);
  }
  // One report, one archive, beside the one folder.
  assert.equal(dirname(String(codebase['report'])), base);
  assert.ok(existsSync(String(codebase['report'])) && existsSync(String(codebase['review_archive'])));
  assert.equal(installed['json'], join(base, SCAN_JSON_FILE));
  assertNoSecret(r.text, 'the confirmed call');
});

test('include_installed false: confirm: true still starts nothing, and the result says the installed half was not scanned', async () => {
  const probeHome = join(WORK, 'probe-home-code-only');
  const marker = join(WORK, 'probe-code-only-started.json');
  mkdirSync(probeHome);
  writeFileSync(
    join(probeHome, '.claude.json'),
    JSON.stringify({ mcpServers: { probe: { type: 'stdio', command: process.execPath, args: [ECHO, '--env-out', marker] } } }),
  );
  const r = await callScan({ home: probeHome, cwd: PROJECT, platform: 'darwin' }, { cwd: CODEBASE, include_installed: false, confirm: true, report: false });
  assert.equal(r.isError, false, r.text);
  assert.ok(!existsSync(marker), 'a codebase-only call started a server');
  assert.deepEqual(r.structured['scope'], { code: 'read', installed: false });
  assert.equal(field(r.structured, 'installed')['status'], 'not_requested');
});

test('the MCP client\'s first root is the project when no cwd is given', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ env: ENV, clientFor: STUB, scan: FIXTURE });
  const client = new Client({ name: 'ziffer-mcp-roots-test', version: '0.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{ uri: pathToFileURL(CODEBASE).href, name: 'fixture' }] }));
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const r = await callOn(client, 'scan', { include_installed: false, report: false });
  assert.equal(r.isError, false, r.text);
  assert.equal(field(r.structured, 'codebase')['root'], CODEBASE);
});
