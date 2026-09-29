/**
 * The whole command, in process, over the fixture home (ACP-440).
 *
 * `fixtures/home` holds one Claude Code config (`.claude.json`: the echo server
 * as "mail", with a credential in its arguments and its environment, and
 * "tickets", whose command does not exist; then three project blocks that each
 * name the same remote server "docs", whose address carries a token, and the
 * same local server "notes") and one Cursor config (`.cursor/mcp.json`: the
 * echo server as "inbox"). The echo server's
 * path is RELATIVE, resolved against the directory the servers are started in,
 * which is this process's: the run is made from packages/scan, as `pnpm test`
 * makes it. The first test says so if it is not.
 *
 * Needs the engine module, as the replay and bundle tests do: ZIFFER_SCAN_WASM
 * or dist/acp_wasm.wasm. Without it every run here refuses EngineWasmAbsent and
 * the tests fail; nothing is skipped.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listBundle } from './bundle/generate.js';
import { type CliContext, run } from './cli.js';
import { UNSIGNED_DEMO_LINE } from './replay/replay.js';
import { FULL_DETAIL, MCP_NEXT, NEXT_OPEN, NEXT_RUN, PREAMBLE_ASK, PREAMBLE_YES, REVIEW_URL, stripAnsi } from './report/terminal.js';

const PKG = fileURLToPath(new URL('../', import.meta.url));
const HOME = join(PKG, 'fixtures', 'home');
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-e2e-'));
const PROJECT = join(WORK, 'project');
mkdirSync(PROJECT);
after(() => rmSync(WORK, { recursive: true, force: true }));

const NOW = new Date('2026-09-25T12:00:00Z');

/** Every credential-shaped value in fixtures/home, none of which may be printed (ACP-449). */
const SECRETS = ['sk_test_fixture_0001', 'sntryu_fixture_0002', 'fixture-remote-0003', 'fixture-env-value-0004'];

function assertNoSecret(text: string, where: string): void {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${where} printed ${secret}`);
  assert.ok(text.includes('[redacted]'), `${where} shows no [redacted] where a credential was`);
}

/** No NO_COLOR from the environment the tests run in: each test says what it wants. */
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NO_COLOR'));

function context(over: Partial<CliContext> = {}): { ctx: CliContext; prompted: string[] } {
  const prompted: string[] = [];
  return {
    prompted,
    ctx: {
      env: ENV,
      platform: 'darwin',
      home: join(WORK, 'not-the-home'),
      cwd: WORK,
      stdin: Readable.from([]),
      isTTY: false,
      prompt: (t) => prompted.push(t),
      now: () => NOW,
      ...over,
    },
  };
}

async function scan(args: string[], over: Partial<CliContext> = {}): Promise<{ code: number; out: string[]; err: string[]; prompted: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const { ctx, prompted } = context(over);
  const code = await run(['--home', HOME, '--cwd', PROJECT, '--platform', 'darwin', ...args], { out: (l) => out.push(l), err: (l) => err.push(l) }, ctx);
  return { code, out, err, prompted };
}

/** Every file and directory under `dir`, with its mtime and size. */
function tree(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const s = statSync(p);
      m.set(p, `${s.mtimeMs}:${s.size}`);
      if (e.isDirectory()) walk(p);
    }
  };
  m.set(dir, `${statSync(dir).mtimeMs}`);
  walk(dir);
  return m;
}

const THIRTEEN = [
  'SIGNATURE',
  'adapters.json',
  'alert_targets.json',
  'attesters/registry.json',
  'door_identities.json',
  'floors.json',
  'limits.json',
  'manifest.json',
  'notice_targets.json',
  'receipt_identity.json',
  'reversibility.json',
  'risk_functions.json',
  'tool-names.json',
];

test('the run is made from packages/scan, where the fixture configs resolve the echo server', () => {
  assert.ok(existsSync(join(process.cwd(), 'fixtures', 'mcp', 'echo-server.mjs')), `run from ${PKG}, not ${process.cwd()}`);
});

test('scan --yes over the fixture home: one screen a person reads top-down, and nothing of the complete report (ACP-452)', async () => {
  const out = join(WORK, 'screen', 'ziffer-policy');
  const r = await scan(['--yes', '--out', out]);
  // Removed before any assertion: a red here must not leave a directory that turns the next test red too.
  rmSync(join(WORK, 'screen'), { recursive: true, force: true });
  // --out elsewhere: the folder it names is the one the line after the header reports.
  assert.equal(r.out[2], 'Wrote ./screen/ (2 items). It is yours to delete; nothing was sent.');
  assert.deepEqual(r.err, [], r.err.join('\n'));
  assert.equal(r.code, 0);
  const text = r.out.join('\n');
  assert.match(r.out[0] ?? '', /^ZIFFER scan \S+ · this machine · nothing was sent anywhere$/);
  // No terminal, no --color: not one escape (ACP-454).
  assert.ok(!text.includes('\u001b['), 'a pipe got colour');
  // Cursor's "inbox" and Claude Code's "notes" run one program (ACP-454): two
  // servers answered with four tools, from two clients; send_email is
  // irreversible under each name, in a table.
  assert.match(text.replace(/\n/g, ' '), /can reach 2 tool servers with 4 tools, from 2 AI agent clients\. 3 of them can do damage that cannot be undone:/);
  assert.ok(r.out.some((l) => /^ {2}server +tool +what it can do$/.test(l)), text);
  for (const server of ['inbox', 'mail', 'notes']) {
    assert.ok(r.out.some((l) => new RegExp(`^ {2}${server} +send_email +send off this machine$`).test(l)), `${server}\n${text}`);
  }
  // What the scan does, before the listing, and the start progress: all on stderr, none on stdout.
  const said = r.prompted.join('');
  const listingAt = said.indexOf('tool servers will be started');
  // 0.3.0 (ACP-455): the default reads the codebase first, and the preamble says so before the MCP half.
  // Read with its line breaks as spaces (ACP-483): the preamble wraps at 80 columns and names the
  // project folder, whose length is the temporary directory's -- long under macOS's /var/folders,
  // short under Linux's /tmp, where the break fell inside this phrase and the test went red.
  assert.ok(said.replace(/\n/g, ' ').indexOf('then the MCP configuration of your AI tools') >= 0 && said.indexOf('ZIFFER scan\n') === 0, said);
  assert.ok(said.indexOf(PREAMBLE_YES) > 0 && said.indexOf(PREAMBLE_YES) < listingAt, said);
  assert.ok(!said.includes(PREAMBLE_ASK), 'with --yes the preamble says a yes is still to come');
  assert.match(said, /starting 3 servers, 3 at a time, 60 s each…\n/);
  assert.match(said, /\n2 answered · 1 did not start\n/);
  assert.ok(said.indexOf('starting 3 servers') > listingAt);
  assert.ok(!text.includes('answered') && !text.includes('Reads the MCP configuration'), 'stdout carries stderr\'s lines');
  assert.ok(r.out.includes('  HIGH  Cursor: an AI agent that reads read_email can then run send_email'), text);
  // What it could not see, as counts: the remote "docs", the missing "tickets" runtime, JetBrains.
  assert.ok(r.out.includes('  1 remote server is not started by this scan'), text);
  assert.ok(r.out.includes('  1 other server could not be started or read and is not in this picture'), text);
  assert.ok(r.out.includes('  JetBrains AI Assistant is not covered'), text);
  // The replay in its summary, under the UNSIGNED DEMO line; the table is --full's.
  const replayAt = r.out.indexOf('REPLAY');
  assert.equal(r.out.slice(replayAt + 1, replayAt + 3).join(' '), UNSIGNED_DEMO_LINE);
  assert.match(text.replace(/\n {2}/g, ' '), /Without ZIFFER, all 8 injected actions execute; under the draft policy, /);
  assert.ok(!r.out.includes(UNSIGNED_DEMO_LINE), 'the replay table was printed without --full');
  // NEXT without --report: how to get the report first; then the pointer to the rest; last, a verb.
  const next = r.out.indexOf('NEXT');
  assert.equal(r.out[next + 1], '  Get the shareable report:  ziffer-scan --report');
  assert.ok(r.out.includes(`  Review and sign off:       ${REVIEW_URL}`), text);
  assert.ok(r.out.includes(`  ${MCP_NEXT}`), text);
  assert.equal(r.out.at(-2), FULL_DETAIL);
  assert.equal(r.out.at(-1), NEXT_RUN);
  assert.ok(text.includes('screen/ziffer-policy (13 files)'), 'the policy path is not on the screen');
  for (const h of ['CLIENTS', 'SERVERS', 'TOOLS', 'WHAT THIS SCAN CANNOT SEE']) assert.ok(!r.out.includes(h), h);
  assert.ok(!text.includes('{policy_path}'));
  // Every line but one carrying a path (a path is one word, printed whole) fits 80 columns.
  assert.deepEqual(r.out.filter((l) => l.length > 80 && !l.includes(WORK)), []);
  assertNoSecret(listingOf(r), 'the confirmation listing');
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `the one screen printed ${secret}`);
});

function listingOf(r: { prompted: string[] }): string {
  return r.prompted.join('');
}

test('scan --yes --full --report over the fixture home, default --out: exit 0, one folder, thirteen files, the one screen, the complete report, the UNSIGNED DEMO replay, nothing else touched', async () => {
  const folder = join(WORK, 'ziffer-scan');
  const out = join(folder, 'ziffer-policy');
  const homeBefore = tree(HOME);
  const r = await scan(['--yes', '--full', '--report']);
  assert.deepEqual(r.err, [], r.err.join('\n'));
  assert.equal(r.code, 0);

  // Twelve members and the sidecar, and nothing else: the tree hash covers every
  // file in the folder. The replay's ninth case sits beside the folder (ACP-451).
  assert.deepEqual(listBundle(out), [...THIRTEEN].sort());
  assert.ok(existsSync(join(folder, 'ziffer-replay-own.json')), 'the own case is not beside the policy folder');

  // The one screen comes first and ends with the pointer to the rest; the
  // complete report follows and ends with the review link and the MCP line
  // after it; the replay's first line is the UNSIGNED DEMO line.
  const pointer = r.out.indexOf(FULL_DETAIL);
  assert.ok(pointer > 0 && r.out[pointer + 1] === NEXT_OPEN && r.out[pointer + 2] === '', 'the one screen does not come first');
  // ACP-454: the line after the header says what was written, and NEXT opens the report first.
  assert.equal(r.out[2], 'Wrote ./ziffer-scan/ (5 items). It is yours to delete; nothing was sent.');
  assert.equal(r.out[3], '', 'a temporary directory is not a git work tree');
  const next = r.out.indexOf('NEXT');
  assert.deepEqual(r.out.slice(next + 1, next + 4), [
    '  Open the report:      open ziffer-scan/ziffer-scan-report.html',
    `  Review and sign off:  ${REVIEW_URL}`,
    '                        Attach ziffer-scan/ziffer-review.tar.gz to the email',
  ]);
  const review = r.out.lastIndexOf(REVIEW_URL);
  assert.ok(review > pointer, 'the complete report has no review link');
  assert.equal(r.out[review + 1], MCP_NEXT);
  assert.equal(r.out[review + 2], '');
  assert.equal(r.out[review + 3], UNSIGNED_DEMO_LINE);
  assert.ok(r.out.some((l) => l.includes(`Draft policy: ${out} (13 files)`)));
  assert.ok(!r.out.includes('{policy_path}'), 'the policy path token was printed unreplaced');

  // What was found: two servers listed their tools, one runtime missing, named.
  assert.ok(r.out.some((l) => l.includes('"ziffer-scan-fixture-no-such-command" is not installed')));
  assert.ok(r.out.some((l) => l.startsWith('    inbox ') && l.includes('2 tools')));
  assert.ok(r.out.some((l) => l.startsWith('    mail ') && l.includes('2 tools')));

  // The list of servers was shown before any started, even with --yes; "notes",
  // configured in three projects (ACP-450), and Cursor's "inbox" run one
  // program, and it is ONE line naming both clients (ACP-454).
  const listing = r.prompted.join('');
  assert.match(listing, /3 tool servers will be started/);
  assert.equal(listing.split('\n').filter((l) => l.includes('notes')).length, 1, listing);
  assert.match(listing, /\n {2}inbox, notes +node fixtures\/mcp\/echo-server\.mjs {2}\(configured in 2 AI agent clients: Cursor, Claude Code\)\n/);

  // ACP-449: the listing shows every credential form redacted in place, and
  // neither the listing nor the report nor stderr carries one of the values.
  assert.match(listing, / {2}mail +MAIL_PASSWORD=\[redacted\] node fixtures\/mcp\/echo-server\.mjs --api-key=\[redacted\] --access-token \[redacted\] {2}\(Claude Code\)\n/);
  assertNoSecret(listing, 'the confirmation listing');
  assertNoSecret(r.out.join('\n'), 'the terminal report');
  for (const secret of SECRETS) assert.ok(!r.err.join('\n').includes(secret), `stderr printed ${secret}`);

  // ACP-450: one SERVERS row, one TOOLS block and one finding per server, however many projects configure it.
  const notesRows = r.out.filter((l) => l.startsWith('    notes '));
  assert.equal(notesRows.length, 1, r.out.join('\n'));
  const notesAt = r.out.indexOf(notesRows[0] ?? '');
  // The row's path may wrap to its own line; the count is on the line after the row.
  assert.ok(r.out.slice(notesAt + 1, notesAt + 3).some((l) => l.trim() === 'configured in 3 projects'), r.out.join('\n'));
  assert.equal(r.out.filter((l) => l === '  Claude Code · notes').length, 1);
  const docs = r.out.filter((l) => /^ {2}INFO {2}docs · Claude Code$/.test(l));
  assert.equal(docs.length, 1, r.out.join('\n'));
  const docsText = r.out.slice(r.out.indexOf(docs[0] ?? ''), r.out.indexOf(docs[0] ?? '') + 4).join(' ');
  assert.match(docsText, /token=\[redacted\]/);
  assert.match(docsText, /configured in 3 projects/);

  // ACP-450: CLIENTS names the configured clients apart from the ones with no configuration here.
  assert.ok(r.out.some((l) => /^ {2}Configured: +Cursor, Claude Code$/.test(l)), r.out.join('\n'));
  assert.ok(r.out.some((l) => l.startsWith('  No configuration found:  ')));
  assert.ok(!r.out.some((l) => l.startsWith('  Scanned:')));

  // Nothing under the fixture home changed; the work directory holds the project
  // and ONE folder (ACP-454), which holds the policy folder, the replay's ninth
  // case (ACP-451) and the three files --report wrote, nothing else.
  assert.deepEqual(tree(HOME), homeBefore);
  assert.deepEqual(readdirSync(WORK).sort(), ['project', 'ziffer-scan']);
  assert.deepEqual(readdirSync(folder).sort(), [
    'ziffer-policy',
    'ziffer-replay-own.json',
    'ziffer-review.tar.gz',
    'ziffer-scan-report.html',
    'ziffer-scan.json',
  ]);
  assert.deepEqual(readdirSync(PROJECT), []);
});

test('--json: one document that parses, a pair finding citing controls, and the replay beside it', async () => {
  // A terminal on stdout and stderr: the preamble and the progress still go to stderr only.
  const r = await scan(['--yes', '--json', '--out', join(WORK, 'policy-json')], { stdoutTTY: true, stderrTTY: true, columns: 100 });
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.match(r.prompted.join(''), /starting 3 servers/);
  assert.ok(!r.out.join('\n').includes('\u001b['), 'the JSON document carries an escape');
  const doc: unknown = JSON.parse(r.out.join('\n'));
  assert.ok(typeof doc === 'object' && doc !== null);
  const findings: unknown = Reflect.get(doc, 'findings');
  assert.ok(Array.isArray(findings));
  const pairs = findings.filter((f: unknown) => typeof f === 'object' && f !== null && Reflect.get(f, 'kind') === 'pair');
  assert.ok(pairs.length > 0, 'no pair finding');
  for (const p of pairs) {
    // ACP-454: readers and actors beside the flat list, which stays for existing consumers.
    assert.deepEqual(Reflect.get(p, 'readers'), ['read_email'], JSON.stringify(p));
    assert.deepEqual(Reflect.get(p, 'actors'), ['send_email'], JSON.stringify(p));
    assert.deepEqual(Reflect.get(p, 'tools'), ['read_email', 'send_email']);
    const controls: unknown = Reflect.get(p, 'controls');
    assert.ok(Array.isArray(controls) && controls.length > 0, 'a pair finding cites no control');
  }
  const replay: unknown = Reflect.get(doc, 'replay');
  assert.ok(typeof replay === 'object' && replay !== null);
  assert.equal(Reflect.get(replay, 'first_line'), UNSIGNED_DEMO_LINE);
  // ACP-449: the JSON document carries no credential, and shows where one was.
  assertNoSecret(r.out.join('\n'), 'the --json document');
  // ACP-450: the remote server configured in three projects is one finding, with its three places.
  const docs = findings.filter((f: unknown) => typeof f === 'object' && f !== null && Reflect.get(f, 'server') === 'docs');
  assert.equal(docs.length, 1);
  const places: unknown = Reflect.get(docs[0], 'configured_in');
  assert.ok(Array.isArray(places) && places.length === 3, JSON.stringify(docs[0]));
  rmSync(join(WORK, 'policy-json'), { recursive: true, force: true });
});

test('without --yes and with no terminal: NotInteractive on one line, exit 2, nothing started and nothing written', async () => {
  const out = join(WORK, 'policy-refused');
  const r = await scan(['--out', out]);
  assert.equal(r.code, 2);
  assert.equal(r.err.length, 1);
  assert.match(r.err[0] ?? '', /^NotInteractive: /);
  assert.deepEqual(r.out, []);
  assert.equal(existsSync(out), false);
});

test('an output directory that already holds a bundle is refused by name, exit 2', async () => {
  const r = await scan(['--yes', '--no-replay']);
  assert.equal(r.code, 2);
  assert.equal(r.err.length, 1);
  assert.match(r.err[0] ?? '', /^BundleDirectoryOccupied: /);
});

test('replay alone: the harness policy, first line UNSIGNED DEMO, exit 0', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(['replay'], { out: (l) => out.push(l), err: (l) => err.push(l) }, context().ctx);
  assert.equal(code, 0, err.join('\n'));
  assert.equal(out[0], UNSIGNED_DEMO_LINE);
  assert.ok(out.some((l) => l.includes('with the harness policy')));
});

test('--timeout: a server slower than the timeout is a WARN finding that says what to do (ACP-450)', async () => {
  const home = join(WORK, 'slow-home');
  mkdirSync(join(home, '.cursor'), { recursive: true });
  writeFileSync(
    join(home, '.cursor', 'mcp.json'),
    JSON.stringify({ mcpServers: { slow: { command: 'node', args: ['fixtures/mcp/echo-server.mjs', '--sleep', '4000'] } } }),
  );
  const out: string[] = [];
  const err: string[] = [];
  const { ctx } = context();
  const code = await run(
    ['--home', home, '--cwd', PROJECT, '--platform', 'darwin', '--yes', '--no-replay', '--full', '--timeout', '1', '--out', join(WORK, 'policy-slow')],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    ctx,
  );
  assert.equal(code, 0, err.join('\n'));
  // The one screen counts it and doubles the timeout (ACP-452).
  assert.match(out.join('\n'), /1 server took longer than 1 s to start and is not in this picture \(rerun with\n {4}--timeout 2\)/);
  assert.ok(!out.includes('REPLAY'), '--no-replay printed a replay block');
  const at = out.findIndex((l) => /^ {2}WARN {2}slow · Cursor$/.test(l));
  assert.ok(at > 0, out.join('\n'));
  const text = out.slice(at + 1, at + 4).join(' ').replace(/\s+/g, ' ');
  assert.match(text, /took longer than 1 s to start; rerun with --timeout 2, or start it once by hand so its packages are cached\./);
  rmSync(join(WORK, 'policy-slow'), { recursive: true, force: true });
});

test('--timeout takes whole seconds and refuses anything else by name', async () => {
  for (const bad of ['0', '-1', '1.5', 'soon']) {
    const err: string[] = [];
    const code = await run(['--timeout', bad], { out: () => undefined, err: (l) => err.push(l) }, context().ctx);
    assert.equal(code, 2, bad);
    assert.match(err[0] ?? '', /^TimeoutInvalid: /);
  }
});

test('colour: on for a terminal, off under NO_COLOR or --no-color, forced on a pipe by --color, and never a different text (ACP-454)', async () => {
  const run1 = async (name: string, args: string[], over: Partial<CliContext>): Promise<string> => {
    const out = join(WORK, name);
    const r = await scan(['--yes', '--no-replay', '--out', out, ...args], over);
    rmSync(out, { recursive: true, force: true });
    assert.equal(r.code, 0, r.err.join('\n'));
    return r.out.join('\n');
  };
  const tty = await run1('policy-c1', [], { stdoutTTY: true, columns: 200 });
  const noColor = await run1('policy-c2', [], { stdoutTTY: true, columns: 200, env: { ...ENV, NO_COLOR: '1' } });
  const flagOff = await run1('policy-flagoff', ['--no-color'], { stdoutTTY: true, columns: 200 });
  const forced = await run1('policy-forced', ['--color'], {});
  assert.ok(tty.includes('\u001b[1;38;5;202mZIFFER\u001b[0m'), 'a terminal got no colour');
  assert.ok(!noColor.includes('\u001b[') && !flagOff.includes('\u001b['), 'NO_COLOR or --no-color still coloured');
  assert.ok(forced.includes('\u001b['), '--color on a pipe gave no colour');
  // A 200-column terminal is clamped to 120: the widest line is over 80 and at most 120.
  const widths = stripAnsi(tty).split('\n').filter((l) => !l.includes(WORK)).map((l) => l.length);
  assert.ok(Math.max(...widths) > 80 && Math.max(...widths) <= 120, String(Math.max(...widths)));
  // Stripped, the terminal's rendering is the NO_COLOR one, byte for byte, but for the output paths.
  const unpath = (t: string): string => t.replace(/policy-c[12]/g, 'policy-cX');
  assert.equal(unpath(stripAnsi(tty)), unpath(noColor));
});

/**
 * One program configured in three clients (ACP-454): the first real run
 * listed `uvx code-review-graph serve` seven times, once per client, started
 * seven processes and counted it seven times. The home is written here, not
 * kept under fixtures/, because the start log's path is absolute. The three
 * entries give the one environment variable three different VALUES: values are
 * not part of what makes two entries one program.
 */
function sharedHome(name: string): { home: string; log: string } {
  const home = join(WORK, name);
  const log = join(WORK, `${name}-starts.log`);
  const entry = (value: string) => ({
    mcpServers: {
      mail: { command: 'node', args: ['fixtures/mcp/echo-server.mjs', '--start-log', log], env: { SHARED_TOKEN: value } },
    },
  });
  const put = (path: string, value: string): void => {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(join(home, path), JSON.stringify(entry(value)));
  };
  put('.cursor/mcp.json', 'fixture-shared-a');
  put('.codeium/windsurf/mcp_config.json', 'fixture-shared-b');
  put('.gemini/settings.json', 'fixture-shared-c');
  return { home, log };
}

async function sharedScan(name: string, extra: string[]): Promise<{ code: number; out: string[]; err: string[]; prompted: string[]; log: string }> {
  const { home, log } = sharedHome(name);
  const out: string[] = [];
  const err: string[] = [];
  const { ctx, prompted } = context();
  const code = await run(
    ['--home', home, '--cwd', PROJECT, '--platform', 'darwin', '--yes', '--no-replay', '--out', join(WORK, `${name}-policy`), ...extra],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    ctx,
  );
  rmSync(join(WORK, `${name}-policy`), { recursive: true, force: true });
  return { code, out, err, prompted, log };
}

test('one program configured in three clients: one listing line naming them, started once, one row per client in the catalog, counted once (ACP-454)', async () => {
  const r = await sharedScan('shared-json', ['--json']);
  assert.equal(r.code, 0, r.err.join('\n'));

  // The listing: one line for the program, naming the three clients; the count is of programs.
  const listing = r.prompted.join('');
  assert.match(listing, /\n1 tool server will be started to list their tools:\n/);
  const lines = listing.split('\n').filter((l) => l.includes('echo-server.mjs'));
  assert.equal(lines.length, 1, listing);
  assert.match(
    lines[0] ?? '',
    /^ {2}mail {2}SHARED_TOKEN=\[redacted\] node fixtures\/mcp\/echo-server\.mjs --start-log \S+ {2}\(configured in 3 AI agent clients: Windsurf, Cursor, Gemini CLI\)$/,
  );
  assert.match(listing, /starting 1 server, 1 at a time/);

  // Started ONCE: the echo server appends a line to its start log per start.
  const starts = readFileSync(r.log, 'utf8').split('\n').filter((l) => l !== '');
  assert.equal(starts.length, 1, `started ${starts.length} times`);

  const doc: unknown = JSON.parse(r.out.join('\n'));
  assert.ok(typeof doc === 'object' && doc !== null);
  // The catalog stays per client: three rows per tool, one per client, identical tools.
  const catalog: unknown = Reflect.get(doc, 'catalog');
  assert.ok(Array.isArray(catalog));
  const rows = catalog.map((t: unknown) => (typeof t === 'object' && t !== null ? `${String(Reflect.get(t, 'client'))}|${String(Reflect.get(t, 'tool'))}` : ''));
  assert.deepEqual([...rows].sort(), [
    'Cursor|read_email', 'Cursor|send_email',
    'Gemini CLI|read_email', 'Gemini CLI|send_email',
    'Windsurf|read_email', 'Windsurf|send_email',
  ]);
  // Counted once: one server, two tools, three clients.
  assert.deepEqual(Reflect.get(doc, 'reach'), { servers: 1, tools: 2, clients: 3, not_started: { remote: 0, timed_out: 0, other: 0 } });
  // A pair finding is per client: each client's AI agent can chain the pair.
  const findings: unknown = Reflect.get(doc, 'findings');
  assert.ok(Array.isArray(findings));
  const pairs = findings.filter((f: unknown) => typeof f === 'object' && f !== null && Reflect.get(f, 'kind') === 'pair');
  assert.deepEqual(pairs.map((f: unknown) => (typeof f === 'object' && f !== null ? Reflect.get(f, 'client') : undefined)).sort(), ['Cursor', 'Gemini CLI', 'Windsurf']);
  for (const secret of ['fixture-shared-a', 'fixture-shared-b', 'fixture-shared-c']) {
    assert.ok(!listing.includes(secret) && !r.out.join('\n').includes(secret), `printed ${secret}`);
  }
});

test('one program configured in three clients: the headline counts it once, from three clients (ACP-454)', async () => {
  const r = await sharedScan('shared-text', []);
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.equal(readFileSync(r.log, 'utf8').split('\n').filter((l) => l !== '').length, 1);
  const text = r.out.join('\n').replace(/\n/g, ' ');
  assert.match(text, /The AI agents you code with can reach 1 tool server with 2 tools, from 3 AI agent clients\. /);
});
