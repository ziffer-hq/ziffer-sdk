/**
 * The grader seam: what one `ziffer decide --unsigned` run is read as, and what
 * `simulate_decision` does with it.
 *
 * Two kinds of test here and the difference matters. The PARSER is driven from
 * strings, so every branch runs on every machine — including the ones a machine
 * without `ziffer` cannot produce. The TOOL is driven against the shipped
 * template through a stub runner, so what is asserted is the argument vector
 * the CLI is handed and the report built from what it said, rather than
 * whichever answer this laptop's binary happens to give.
 *
 * One test does use the real binary when it is there, and skips by NAME when it
 * is not (`ziffer` on PATH). A suite that only ever saw a stub would agree with
 * its own idea of the CLI's output format forever.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gradeProposal,
  parseVerdict,
  resolveTree,
  simulateDecision,
  TreeError,
  unsignedLine,
} from './decide.js';
import { execFileRunner, type CliOutcome, type CliRunner } from './repo-check.js';

/** dist/decide.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const templateRoot = join(repoRoot, 'templates', 'policy-repo');

const UNSIGNED =
  'UNSIGNED: the signature was not checked; this is a lint of the tree, not a verdict on a bundle';

const ABSENT: CliRunner = async () => ({ ran: false, code: -1, output: '' });

function recording(outcome: CliOutcome): { runner: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CliRunner = async (_cwd, argv) => {
    calls.push([...argv]);
    return outcome;
  };
  return { runner, calls };
}

const PROPOSAL = {
  schema_id: 'finance_agent_v1',
  schema_version: '1.0.0',
  schema_hash: `sha256:${'0'.repeat(64)}`,
  fidelity: 'F-HIGH',
  tenant_id: 'ten-example',
  payload: {
    task_type: 'wire_transfer',
    operator: 'finance-agent',
    targets: ['bank-api'],
    params: { amount_eur: 9000, currency: 'EUR', to_account: '48812' },
    cidrs: {},
  },
};

/** Is the real CLI on PATH? The one test that uses it says so when it is not,
 * rather than passing quietly. */
async function cliPresent(): Promise<boolean> {
  return new Promise((done) => {
    execFile('ziffer', ['--help'], (error) => done(error === null));
  });
}

// ------------------------------------------------------------------ the parser

test('a PASSED line is read as its four fields and nothing is inferred', () => {
  const graded = parseVerdict(
    `${UNSIGNED}\nPASSED\ttask_type=issue_refund\trisk=MEDIUM\treversibility=IRREVERSIBLE\tnotice=finance_oncall,fraud_desk\n`,
  );
  assert.equal(graded.kind, 'passed');
  if (graded.kind !== 'passed') return;
  assert.equal(graded.taskType, 'issue_refund');
  assert.equal(graded.risk, 'MEDIUM');
  assert.equal(graded.reversibility, 'IRREVERSIBLE');
  assert.deepEqual(graded.notice, ['finance_oncall', 'fraud_desk']);
});

test('the CLI\'s own <none owed> is an empty audience, and an empty string is not', () => {
  // The two spellings mean different things. A reader that treated a missing
  // value as "nobody is told" would report a parse failure as a policy fact.
  const owed = parseVerdict(
    'PASSED\ttask_type=a\trisk=LOW\treversibility=REVERSIBLE\tnotice=<none owed>',
  );
  assert.equal(owed.kind, 'passed');
  if (owed.kind === 'passed') assert.deepEqual(owed.notice, []);

  const dropped = parseVerdict('PASSED\ttask_type=a\trisk=LOW\treversibility=REVERSIBLE');
  assert.equal(
    dropped.kind,
    'unreadable',
    'a PASSED line missing a field was read as a verdict with a hole in it',
  );
});

test('a REFUSED line is read as its clause and the reason beneath it', () => {
  const graded = parseVerdict(
    `${UNSIGNED}\nREFUSED\tTR-8\n  schema_id not bound to a registered adapter\n`,
  );
  assert.equal(graded.kind, 'refused');
  if (graded.kind !== 'refused') return;
  assert.equal(graded.clause, 'TR-8');
  assert.equal(graded.message, 'schema_id not bound to a registered adapter');
});

test('output with no verdict line is unreadable, never a refusal', () => {
  // "your rules refused this" and "this tool could not get a verdict" are
  // different sentences, and only one of them is about policy.
  for (const output of [
    'cannot walk the bundle: Io("/no/such/dir: No such file or directory (os error 2)")',
    `${UNSIGNED}\n/tmp/p.json is not JSON: expected ident at line 1 column 2`,
    '',
  ]) {
    assert.equal(parseVerdict(output).kind, 'unreadable', JSON.stringify(output));
  }
});

test('the unsigned disclaimer is sliced out of the run, never retyped', () => {
  assert.equal(unsignedLine(`${UNSIGNED}\nPASSED\tx=1`), UNSIGNED);
  assert.equal(unsignedLine('PASSED\tx=1'), null);
});

// -------------------------------------------------------------- the invocation

test('the CLI is handed the argument vector the customer workflow hands it', async () => {
  const { runner, calls } = recording({ ran: true, code: 0, output: `${UNSIGNED}\nPASSED\ttask_type=a\trisk=LOW\treversibility=REVERSIBLE\tnotice=<none owed>` });
  await gradeProposal('/bundle', PROPOSAL, runner, new Date('2026-09-23T13:28:39.512Z'));
  assert.equal(calls.length, 1);
  const argv = calls[0];
  assert.ok(argv !== undefined);
  // `--unsigned` and a second-resolution `--now`: the same shape
  // policy-validate.yml runs, because "the same invocation" has to mean the
  // same argument vector and not one that looks like it.
  assert.deepEqual(argv.slice(0, 5), ['ziffer', 'decide', '/bundle', '--unsigned', '--now']);
  assert.equal(argv[5], '2026-09-23T13:28:39Z');
  assert.equal(argv[6], '--proposal');
  assert.ok((argv[7] ?? '').endsWith('proposal.json'), argv[7]);
});

test('the temporary directory the proposal is written to is removed', async () => {
  let written: string | undefined;
  const runner: CliRunner = async (_cwd, argv) => {
    written = argv[7];
    return { ran: true, code: 1, output: `${UNSIGNED}\nREFUSED\tPR-1\n  no` };
  };
  await gradeProposal('/bundle', PROPOSAL, runner);
  assert.ok(written !== undefined);
  await assert.rejects(
    () => import('node:fs/promises').then((fs) => fs.stat(written ?? '')),
    'the proposal file outlived the call',
  );
});

test('a proposal that is not JSON-serialisable is unreadable, not four letters on disk', async () => {
  const { runner, calls } = recording({ ran: true, code: 0, output: 'PASSED\ttask_type=a' });
  const graded = await gradeProposal('/bundle', undefined, runner);
  assert.equal(graded.kind, 'unreadable');
  assert.equal(calls.length, 0, 'the CLI was run on a proposal that was never written');
});

test('an absent binary is its own case and never a verdict', async () => {
  assert.equal((await gradeProposal('/bundle', PROPOSAL, ABSENT)).kind, 'absent');
});

// ------------------------------------------------------------------- the tree

test('both spellings of a policy tree resolve, and nothing else does', async () => {
  const fromRoot = await resolveTree(templateRoot);
  assert.equal(fromRoot.bundleDir, join(templateRoot, 'policy'));
  const fromBundle = await resolveTree(join(templateRoot, 'policy'));
  assert.equal(fromBundle.bundleDir, join(templateRoot, 'policy'));

  // A directory with neither shape is refused BY NAME rather than searched
  // upward from: walking up is how a tool ends up grading a tree the caller
  // did not mean.
  const empty = await mkdtemp(join(tmpdir(), 'acp391-'));
  try {
    await assert.rejects(
      () => resolveTree(empty),
      (error: unknown) => error instanceof TreeError && error.name === 'PolicyTreeNotFound',
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
  }

  await assert.rejects(
    () => resolveTree('/no/such/tree'),
    (error: unknown) => error instanceof TreeError && error.name === 'PolicyPathUnreadable',
  );
  await assert.rejects(
    () => resolveTree('   '),
    (error: unknown) => error instanceof TreeError && error.name === 'PolicyPathUnnamed',
  );
});

test('a path that is a file and not a directory is refused by its own name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acp391-'));
  try {
    const file = join(dir, 'risk_functions.json');
    await writeFile(file, '{}', 'utf8');
    await assert.rejects(
      () => resolveTree(file),
      (error: unknown) => error instanceof TreeError && error.name === 'PolicyPathNotADirectory',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------- simulate_decision

test('simulate_decision reports a refusal as a report, not as a tool error', async () => {
  const { runner } = recording({
    ran: true,
    code: 1,
    output: `${UNSIGNED}\nREFUSED\tTR-8\n  schema_id not bound to a registered adapter\n`,
  });
  const out = await simulateDecision(templateRoot, PROPOSAL, runner);
  assert.equal(
    out.isError,
    false,
    'a refusal was framed as a malfunction, which teaches an agent to route around the check',
  );
  assert.match(out.text, /REFUSED {2}TR-8/);
  assert.match(out.text, /schema_id not bound to a registered adapter/);
  // The CLI's own text is reproduced, including the sentence that says a lint
  // is not a verdict on a bundle.
  assert.match(out.text, /this is a lint of the tree, not a verdict on a bundle/);
});

test('simulate_decision says what a PASSED grade is not', async () => {
  const { runner } = recording({
    ran: true,
    code: 0,
    output: `${UNSIGNED}\nPASSED\ttask_type=wire_transfer\trisk=HIGH\treversibility=IRREVERSIBLE\tnotice=<none owed>\n`,
  });
  const out = await simulateDecision(templateRoot, PROPOSAL, runner);
  assert.equal(out.isError, false);
  assert.match(out.text, /PASSED {3}wire_transfer/);
  assert.match(out.text, /risk {11}HIGH/);
  // The line that stops an agent reading a grade as permission.
  assert.match(out.text, /not permission to act/);
  assert.match(out.text, /The signature was NOT checked/);
});

test('simulate_decision says NOT CHECKED when the binary is absent, and never PASS', async () => {
  const out = await simulateDecision(templateRoot, PROPOSAL, ABSENT);
  assert.equal(out.isError, false);
  assert.match(out.text, /NOT CHECKED/);
  assert.doesNotMatch(out.text, /PASSED/);
});

test('output the grader could not produce a verdict from is a tool error', async () => {
  const { runner } = recording({
    ran: true,
    code: 1,
    output: 'cannot walk the bundle: Io("no")',
  });
  const out = await simulateDecision(templateRoot, PROPOSAL, runner);
  assert.equal(out.isError, true, 'nothing was graded, so this is not a report');
  assert.match(out.text, /NO VERDICT/);
});

test('simulate_decision refuses a path that is not a policy tree', async () => {
  const out = await simulateDecision('/no/such/tree', PROPOSAL);
  assert.equal(out.isError, true);
  assert.match(out.text, /^PolicyPathUnreadable: /);
});

// ------------------------------------------------------------- the real binary

test('the real CLI, when it is installed, answers in the shape this reader parses', async () => {
  if (!(await cliPresent())) {
    // Named rather than silent: a suite that only ever saw a stub would agree
    // with its own idea of the CLI's output format forever.
    console.log('    NOT CHECKED: `ziffer` is not on PATH, so the real output shape was not read.');
    return;
  }
  const graded = await gradeProposal(
    join(templateRoot, 'policy'),
    PROPOSAL,
    execFileRunner,
    new Date('2026-09-23T13:28:39Z'),
  );
  assert.notEqual(graded.kind, 'absent');
  assert.notEqual(
    graded.kind,
    'unreadable',
    `the installed CLI said something this reader does not recognise as a verdict: ${
      graded.kind === 'absent' ? '' : graded.output
    }`,
  );
});
