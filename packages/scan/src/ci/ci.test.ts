/**
 * `ziffer-scan --ci <policy-dir>` end to end (ACP-442): the repository's own
 * MCP configuration (`fixtures/ci/project/.mcp.json`, the echo server), the
 * draft policy tree `fixtures/ci/policy`, the real engine module. Every verdict
 * asserted below is the engine's; the refusing tree is a COPY of the fixture
 * with one risk function removed, made per test in a temporary directory.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { type CliContext, run } from '../cli.js';
import { UNSIGNED_CI_LINE } from './ci.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const POLICY = join(PKG, 'fixtures', 'ci', 'policy');
const PROJECT = join(PKG, 'fixtures', 'ci', 'project');
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-ci-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

let copies = 0;
/** A copy of the fixture policy tree, `edit` applied to one member. */
function policyCopy(member: string, edit: (doc: Record<string, unknown>) => void): string {
  copies += 1;
  const dir = join(WORK, `policy-${copies}`);
  cpSync(POLICY, dir, { recursive: true });
  const path = join(dir, member);
  const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(typeof doc === 'object' && doc !== null && !Array.isArray(doc));
  const obj: Record<string, unknown> = { ...doc };
  edit(obj);
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  return dir;
}

function withoutSendEmailRisk(doc: Record<string, unknown>): void {
  const list = doc['risk_functions'];
  assert.ok(Array.isArray(list));
  doc['risk_functions'] = list.filter((r: unknown) => !(typeof r === 'object' && r !== null && 'applies_to' in r && r.applies_to === 'send_email'));
}

async function ci(args: string[]): Promise<{ code: number; out: string[]; err: string[]; prompted: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const prompted: string[] = [];
  const ctx: CliContext = {
    env: process.env,
    platform: 'linux',
    // A home full of configured servers: --ci must read none of it.
    home: join(PKG, 'fixtures', 'home'),
    cwd: PKG,
    stdin: Readable.from([]),
    isTTY: false,
    prompt: (t) => prompted.push(t),
    now: () => new Date('2026-09-26T12:00:00Z'),
  };
  const code = await run(args, { out: (l) => out.push(l), err: (l) => err.push(l) }, ctx);
  return { code, out, err, prompted: prompted.join('') };
}

test('--ci: a tool with a risk function is graded by the engine, and a run with no refusal exits 0', async () => {
  const r = await ci(['--ci', POLICY, '--cwd', PROJECT]);
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.equal(r.out[0], UNSIGNED_CI_LINE);
  assert.ok(r.out.includes('mail read_email → ALLOW LOW REVERSIBLE T1 [read_email]'), r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('2 tools graded: 2 allowed, 0 held for approval, 0 refused;')), r.out.join('\n'));
  assert.ok(!r.out.some((l) => l.includes('REFUSED')));
  // --ci implies --yes; the list of what is started is still printed, and it is
  // the repository's server alone: nothing from the home directory.
  assert.match(r.prompted, /^1 tool server will be started to list their tools:\n {2}Claude Code {2}mail {2}node fixtures\/mcp\/echo-server\.mjs\n$/);
});

test('--ci: policy, policy/ and ./policy are one folder, named `policy` in the JSON and on the Policy: line', async () => {
  // The run's cwd is the package root, so `fixtures/ci/policy` is the folder in all three spellings.
  for (const spelling of ['fixtures/ci/policy', 'fixtures/ci/policy/', './fixtures/ci/policy']) {
    const text = await ci(['--ci', spelling, '--cwd', PROJECT]);
    assert.equal(text.code, 0, `${spelling}: ${text.err.join('\n')}`);
    assert.equal(text.out[1], 'Policy: fixtures/ci/policy', `${spelling}: ${text.out.join('\n')}`);
    const json = await ci(['--ci', spelling, '--cwd', PROJECT, '--json']);
    const doc: unknown = JSON.parse(json.out[0] ?? '');
    assert.ok(typeof doc === 'object' && doc !== null && 'policy_dir' in doc);
    assert.equal(doc.policy_dir, 'fixtures/ci/policy', spelling);
  }
});

test('--ci: a tool absent from reversibility.json is reported IRREVERSIBLE, citing its Annex E rows', async () => {
  const r = await ci(['--ci', POLICY, '--cwd', PROJECT]);
  assert.ok(
    r.out.includes('mail send_email → ALLOW MEDIUM IRREVERSIBLE T1 [send_email] (EU AI Act Art. 14(4)(d))'),
    r.out.join('\n'),
  );
});

test('--ci: a resource absent from floors.json is graded at T3, the engine\'s own answer', async () => {
  const dir = policyCopy('floors.json', (d) => {
    d['floors'] = {};
  });
  const r = await ci(['--ci', dir, '--cwd', PROJECT]);
  assert.ok(r.out.includes('mail read_email → ALLOW LOW REVERSIBLE T3 [read_email]'), r.out.join('\n'));
});

test('--ci: a tool with no risk function is REFUSED at 8.4-3, exits 1, and the fix line grades it once applied', async () => {
  const dir = policyCopy('risk_functions.json', withoutSendEmailRisk);
  const r = await ci(['--ci', dir, '--cwd', PROJECT]);
  assert.equal(r.code, 1, r.out.join('\n'));
  assert.ok(
    r.out.includes('mail send_email → REFUSED [8.4-3] no risk function for task_type "send_email" (risk_functions) (NIS2 Art. 21(2)(a); DORA Art. 8(1))'),
    r.out.join('\n'),
  );
  assert.ok(r.out.some((l) => l.startsWith('2 tools graded: 1 allowed, 0 held for approval, 1 refused;') && l.endsWith('Exit 1.')));
  const fix = r.out.find((l) => l.startsWith('  risk_functions.json: '));
  assert.ok(fix !== undefined, r.out.join('\n'));
  // The line is the generator's own risk-function entry: add it and the engine grades the tool.
  const entry: unknown = JSON.parse(fix.slice('  risk_functions.json: '.length));
  assert.ok(typeof entry === 'object' && entry !== null && 'applies_to' in entry && entry.applies_to === 'send_email');
  const path = join(dir, 'risk_functions.json');
  const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(typeof doc === 'object' && doc !== null && 'risk_functions' in doc && Array.isArray(doc.risk_functions));
  writeFileSync(path, JSON.stringify({ ...doc, risk_functions: [...doc.risk_functions, entry] }));
  const again = await ci(['--ci', dir, '--cwd', PROJECT]);
  assert.equal(again.code, 0, again.out.join('\n'));
  assert.ok(again.out.some((l) => l.startsWith('mail send_email → ') && !l.includes('REFUSED')), again.out.join('\n'));
});

test('--ci --json: one document on stdout, the engine verdicts, the controls, the fix and the exit code', async () => {
  const dir = policyCopy('risk_functions.json', withoutSendEmailRisk);
  const r = await ci(['--ci', dir, '--cwd', PROJECT, '--json']);
  assert.equal(r.code, 1);
  assert.equal(r.out.length, 1);
  const doc: unknown = JSON.parse(r.out[0] ?? '');
  assert.ok(typeof doc === 'object' && doc !== null);
  assert.ok('mode' in doc && doc.mode === 'ci');
  assert.ok('unsigned' in doc && doc.unsigned === UNSIGNED_CI_LINE);
  assert.ok('exit_code' in doc && doc.exit_code === 1);
  assert.ok('summary' in doc);
  assert.deepEqual(doc.summary, { allowed: 1, held: 0, not_checked: 0, refused: 1, tools: 2 });
  assert.ok('tools' in doc && Array.isArray(doc.tools));
  const send: unknown = doc.tools.find((t: unknown) => typeof t === 'object' && t !== null && 'tool' in t && t.tool === 'send_email');
  assert.ok(typeof send === 'object' && send !== null);
  assert.ok('result' in send);
  assert.deepEqual(send.result, { clause: '8.4-3', message: 'no risk function for task_type "send_email" (risk_functions)', verdict: 'REFUSED' });
  assert.ok('fix' in send && typeof send.fix === 'object' && send.fix !== null && 'file' in send.fix);
  assert.equal(send.fix.file, 'risk_functions.json');
  assert.ok('controls' in send && Array.isArray(send.controls));
  assert.deepEqual(
    send.controls.map((c: unknown) => (typeof c === 'object' && c !== null && 'framework' in c && 'clause' in c ? `${String(c.framework)} ${String(c.clause)}` : '')),
    ['NIS2 Art. 21(2)(a)', 'DORA Art. 8(1)'],
  );
});

test('--ci: an absent policy member is refused by name, exit 2, before any server is started', async () => {
  const dir = join(WORK, 'empty-policy');
  mkdirSync(dir);
  const r = await ci(['--ci', dir, '--cwd', PROJECT]);
  assert.equal(r.code, 2);
  assert.match(r.err[0] ?? '', /^PolicyTreeUnreadable: .*floors\.json: absent$/);
  assert.equal(r.prompted, '');
});

test('--ci: a repository that configures no MCP server says NOT CHECKED and exits 0', async () => {
  const dir = join(WORK, 'bare-project');
  mkdirSync(dir);
  const r = await ci(['--ci', POLICY, '--cwd', dir]);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('NOT CHECKED: no MCP server is configured in this repository, so no tool was graded.'), r.out.join('\n'));
});

test('--ci output: "agent" is never bare, and "control plane" never appears', async () => {
  const dir = policyCopy('risk_functions.json', withoutSendEmailRisk);
  const r = await ci(['--ci', dir, '--cwd', PROJECT]);
  const text = [...r.out, r.prompted].join('\n');
  const bare = [...text.matchAll(/(\S*\s)?agent/gi)].filter((m) => m[1] !== 'AI ');
  assert.deepEqual(bare.map((m) => m[0]), []);
  assert.ok(!/control plane/i.test(text));
});
