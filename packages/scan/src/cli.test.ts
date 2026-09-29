import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  colourOn,
  DEFAULT_OUT,
  folderShown,
  HELP,
  inGitWorkTree,
  mapBounded,
  packageVersion,
  parseArgs,
  refusalLine,
  run,
  START_CONCURRENCY,
  UsageError,
  widthOf,
} from './cli.js';
import { SpawnRefused } from './mcp/confirm.js';

function capture(): { out: string[]; err: string[]; io: { out: (l: string) => void; err: (l: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l) => out.push(l), err: (l) => err.push(l) } };
}

test('--version prints the package.json version', async () => {
  const c = capture();
  assert.equal(await run(['--version'], c.io), 0);
  assert.deepEqual(c.out, [packageVersion()]);
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/);
});

test('--help prints the usage and names every flag the parser accepts', async () => {
  const c = capture();
  assert.equal(await run(['--help'], c.io), 0);
  assert.deepEqual(c.out, [HELP]);
  for (const flag of ['--json', '--yes', '--out', '--no-replay', '--timeout', '--home', '--cwd', '--platform', '--help', '--version', '--ci', '--report', '--color', '--no-color', '--full', '--code', '--no-code']) {
    assert.ok(HELP.includes(flag), `HELP does not mention ${flag}`);
  }
});

test('--code and --no-code (0.3.0): each skips one half, and they refuse each other, --ci and replay by name', () => {
  assert.equal(parseArgs(['--code']).code, true);
  assert.equal(parseArgs(['--no-code', '--yes']).noCode, true);
  assert.equal(parseArgs([]).code, undefined);
  assert.equal(parseArgs([]).noCode, undefined);
  assert.throws(() => parseArgs(['--code', '--no-code']), /^UsageError: CodeFlagConflict: --code does not take --no-code$/);
  assert.throws(() => parseArgs(['--ci', 'p', '--no-code']), /CiFlagConflict: --ci does not take --no-code/);
  assert.throws(() => parseArgs(['replay', '--no-code']), /CodeFlagConflict: replay does not take --no-code/);
  assert.throws(() => parseArgs(['--code', '--yes']), /CodeFlagConflict: --code does not take --yes/);
});

test('flags parse, value flags take the next argument', () => {
  assert.deepEqual(
    parseArgs(['scan', '--json', '--yes', '--no-replay', '--home', '/h', '--cwd', '/c', '--platform', 'linux', '--out', 'p']),
    {
      command: 'scan',
      full: false,
      json: true,
      yes: true,
      help: false,
      version: false,
      replay: false,
      home: '/h',
      cwd: '/c',
      platform: 'linux',
      out: 'p',
    },
  );
  assert.equal(parseArgs(['replay']).command, 'replay');
  assert.equal(parseArgs([]).command, 'scan');
  assert.equal(parseArgs(['--full']).full, true);
});

test('an unknown argument, a missing value and an unknown platform are usage errors naming the problem, exit 2', async () => {
  const c = capture();
  assert.equal(await run(['--frobnicate'], c.io), 2);
  assert.equal(c.err[0], 'UnknownArgument: --frobnicate');
  assert.throws(() => parseArgs(['scan', 'replay']), /UnknownArgument: replay/);
  assert.throws(() => parseArgs(['--out']), /MissingValue: --out needs a value/);
  assert.throws(() => parseArgs(['--home', '--yes']), /MissingValue: --home/);
  assert.throws(() => parseArgs(['--platform', 'plan9']), /PlatformUnknown: plan9/);
});

test('a refusal is one line, its name said once', () => {
  assert.equal(refusalLine(new SpawnRefused('NotInteractive', 'no terminal')), 'NotInteractive: no terminal');
  assert.equal(refusalLine(new UsageError('x')), 'UsageError: x');
  const multi = new Error('first line\n    at stack frame');
  assert.equal(refusalLine(multi), 'Error: first line');
});

test('mapBounded: never more than the limit in flight, results in input order (ACP-450)', async () => {
  let inFlight = 0;
  let most = 0;
  const items = Array.from({ length: 11 }, (_, i) => i);
  const out = await mapBounded(items, START_CONCURRENCY, async (i) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5 + (i % 3) * 5));
    inFlight -= 1;
    return i * 2;
  });
  assert.equal(START_CONCURRENCY, 4);
  assert.equal(most, 4);
  assert.deepEqual(out, items.map((i) => i * 2));
});

test('--ci takes a policy directory and refuses the flags it would ignore (ACP-442)', () => {
  assert.equal(parseArgs(['--ci', 'policy']).ci, 'policy');
  // One folder, three spellings: the template passes `policy/`, a person types
  // `policy` or `./policy`, and the result names it the same way each time.
  assert.equal(parseArgs(['--ci', 'policy/']).ci, 'policy');
  assert.equal(parseArgs(['--ci', './policy']).ci, 'policy');
  assert.equal(parseArgs(['--ci', './policy/']).ci, 'policy');
  assert.equal(parseArgs(['--ci', 'config/rules/']).ci, 'config/rules');
  assert.equal(parseArgs(['--ci', '/']).ci, '/');
  assert.equal(parseArgs(['--ci', 'policy', '--json', '--cwd', '.', '--timeout', '5']).json, true);
  assert.throws(() => parseArgs(['--ci']), /MissingValue: --ci needs a value/);
  assert.throws(() => parseArgs(['--ci', 'policy', '--out', 'x']), /CiFlagConflict: --ci does not take --out/);
  assert.throws(() => parseArgs(['--ci', 'policy', '--report']), /CiFlagConflict: --ci does not take --report/);
  assert.throws(() => parseArgs(['--ci', 'policy', '--home', '/h']), /CiFlagConflict: --ci does not take --home/);
  assert.throws(() => parseArgs(['replay', '--ci', 'policy']), /CiFlagConflict: --ci does not take replay/);
  assert.equal(parseArgs([]).ci, undefined);
});

test('colour: --color and --no-color win; otherwise a terminal on stdout with NO_COLOR unset (ACP-454)', () => {
  assert.equal(parseArgs(['--color']).color, true);
  assert.equal(parseArgs(['--no-color']).color, false);
  assert.equal(parseArgs([]).color, undefined);
  assert.equal(colourOn({}, { env: {}, stdoutTTY: true }), true);
  assert.equal(colourOn({}, { env: {}, stdoutTTY: false }), false);
  assert.equal(colourOn({}, { env: {} }), false);
  assert.equal(colourOn({}, { env: { NO_COLOR: '1' }, stdoutTTY: true }), false);
  assert.equal(colourOn({}, { env: { NO_COLOR: '' }, stdoutTTY: true }), true, 'an empty NO_COLOR is unset (no-color.org)');
  assert.equal(colourOn({ color: false }, { env: {}, stdoutTTY: true }), false);
  assert.equal(colourOn({ color: true }, { env: { NO_COLOR: '1' }, stdoutTTY: false }), true);
});

test('width: the terminal\'s columns clamped to [80, 120]; 80 for a pipe (ACP-454)', () => {
  assert.equal(widthOf({ stdoutTTY: true, columns: 200 }), 120);
  assert.equal(widthOf({ stdoutTTY: true, columns: 100 }), 100);
  assert.equal(widthOf({ stdoutTTY: true, columns: 40 }), 80);
  assert.equal(widthOf({ stdoutTTY: false, columns: 200 }), 80);
  assert.equal(widthOf({ stdoutTTY: true }), 80);
});

test('one output folder by default, shown as a person types it; a .git above it is a git work tree (ACP-454)', () => {
  assert.equal(DEFAULT_OUT, 'ziffer-scan/ziffer-policy');
  assert.ok(HELP.includes('./ziffer-scan/ziffer-policy'));
  assert.equal(folderShown('/w/ziffer-scan', '/w'), './ziffer-scan/');
  assert.equal(folderShown('/w', '/w'), './');
  assert.equal(folderShown('/elsewhere/out', '/w'), '/elsewhere/out/');
  const root = mkdtempSync(join(tmpdir(), 'ziffer-scan-git-'));
  try {
    const deep = join(root, 'repo', 'a', 'b');
    mkdirSync(deep, { recursive: true });
    assert.equal(inGitWorkTree(deep), false);
    mkdirSync(join(root, 'repo', '.git'));
    assert.equal(inGitWorkTree(deep), true);
    // A worktree's .git is a file, and counts the same.
    const wt = join(root, 'wt');
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), 'gitdir: /x\n');
    assert.equal(inGitWorkTree(wt), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
