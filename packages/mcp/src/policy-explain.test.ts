/**
 * What `explain_policy` finds, against real trees on disk.
 *
 * Every tree here is a COPY of `templates/policy-repo` with exactly one thing
 * changed, `repo-check.test.ts`'s rule: a hand-made tree would agree with
 * whatever this tool happens to look for, and the shipped template is the
 * artifact a customer starts from.
 *
 * The VERDICTS come from a stub runner, because the question these tests ask is
 * what the report says about what the grader said — and a suite whose answers
 * depended on whether this laptop has `ziffer` installed would assert one thing
 * on a developer's machine and another in the gate. The one test that does use
 * the installed binary says NOT CHECKED by name when it is absent.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { explainPolicy, explainPolicyTool, formatExplained } from './policy-explain.js';
import type { CliOutcome, CliRunner } from './repo-check.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const templateDir = join(repoRoot, 'templates', 'policy-repo');

const UNSIGNED =
  'UNSIGNED: the signature was not checked; this is a lint of the tree, not a verdict on a bundle';

const ABSENT: CliRunner = async () => ({ ran: false, code: -1, output: '' });

/** A runner that answers by the `task_type` in the proposal it was handed, so
 * one stub can play a whole bundle's worth of verdicts. It READS the file the
 * module wrote, which is also how these tests know the proposal reached the
 * CLI as a file rather than as an argument. */
function grading(table: Readonly<Record<string, string>>, fallback: string): CliRunner {
  return async (_cwd, argv) => {
    const path = argv[7] ?? '';
    let task = '';
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (typeof value === 'object' && value !== null) {
        const root: Record<string, unknown> = { ...value };
        const payload = root['payload'];
        if (typeof payload === 'object' && payload !== null) {
          const fields: Record<string, unknown> = { ...payload };
          const found = fields['task_type'];
          if (typeof found === 'string') task = found;
        }
      }
    } catch {
      // A runner that cannot read the file answers the fallback, which is what
      // the caller asked for on every unknown action.
    }
    const line = table[task] ?? fallback;
    const outcome: CliOutcome = {
      ran: true,
      code: line.startsWith('REFUSED') ? 1 : 0,
      output: `${UNSIGNED}\n${line}\n`,
    };
    return outcome;
  };
}

function passed(task: string, risk: string, rev: string, notice: string): string {
  return `PASSED\ttask_type=${task}\trisk=${risk}\treversibility=${rev}\tnotice=${notice}`;
}

/** Every action the template's risk functions name, graded the way the
 * template's own values would grade them if its examples were accepted. */
const TEMPLATE_VERDICTS: Readonly<Record<string, string>> = {
  draft_purchase_order: passed('draft_purchase_order', 'LOW', 'REVERSIBLE', '<none owed>'),
  send_customer_email: passed('send_customer_email', 'MEDIUM', 'IRREVERSIBLE', 'finance_oncall'),
  issue_refund: passed('issue_refund', 'MEDIUM', 'IRREVERSIBLE', 'finance_oncall,fraud_desk'),
  wire_transfer: passed('wire_transfer', 'HIGH', 'IRREVERSIBLE', '<none owed>'),
};

async function freshCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'acp391-'));
  const root = join(dir, 'policy-repo');
  await cp(templateDir, root, { recursive: true });
  return root;
}

/** Rewrite one member of a copied tree, through a reader and a writer, so a
 * test says WHAT it changed rather than pasting a whole file. */
async function editJson(
  root: string,
  member: string,
  edit: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const path = join(root, 'policy', member);
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(typeof value === 'object' && value !== null, `${member} is not an object`);
  await writeFile(path, JSON.stringify(edit({ ...value }), null, 2), 'utf8');
}

// ----------------------------------------------------------------- the groups

test('each action lands in the regime its verdict puts it in, and nothing else decides', async () => {
  const root = await freshCopy();
  try {
    const found = await explainPolicy(root, grading(TEMPLATE_VERDICTS, 'REFUSED\tTR-8\n  no'));
    const text = formatExplained(found);

    // RUNS ALONE: below floor-HIGH and nobody owed a notice.
    assert.match(text, /RUNS ALONE[\s\S]*?draft_purchase_order/);
    // TOLD: below floor-HIGH, irreversible, recipients named by the bundle.
    assert.match(text, /RUNS, AND SOMEBODY IS TOLD[\s\S]*?issue_refund/);
    assert.match(text, /told: finance_oncall, fraud_desk/);
    // HELD: risk=HIGH is the floor-HIGH path, so the quorum applies.
    assert.match(text, /HELD FOR APPROVAL[\s\S]*?wire_transfer/);
    assert.match(text, /2 distinct attesters must sign it, and never whoever proposed it/);
    assert.match(text, /needs a positive confirmation and silence refuses/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('a refused action is reported with the clause, in its own group', async () => {
  const root = await freshCopy();
  try {
    const text = formatExplained(
      await explainPolicy(
        root,
        grading({}, 'REFUSED\tTR-8\n  schema_id not bound to a registered adapter'),
      ),
    );
    assert.match(text, /REFUSED BEFORE IT RUNS/);
    assert.match(text, /TR-8 — schema_id not bound to a registered adapter/);
    assert.doesNotMatch(text, /RUNS ALONE/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('the regime is a rendering of the grade, so changing the grade moves the row', async () => {
  // The claim the whole tool rests on: nothing here reads risk_functions.json
  // to decide where a row goes. The SAME tree, graded two ways by the stub,
  // puts the same action in two different groups.
  const root = await freshCopy();
  try {
    const low = formatExplained(
      await explainPolicy(
        root,
        grading({}, passed('wire_transfer', 'LOW', 'REVERSIBLE', '<none owed>')),
      ),
    );
    assert.match(low, /RUNS ALONE/);
    assert.doesNotMatch(low, /HELD FOR APPROVAL/);

    const high = formatExplained(
      await explainPolicy(
        root,
        grading({}, passed('wire_transfer', 'HIGH', 'IRREVERSIBLE', '<none owed>')),
      ),
    );
    assert.match(high, /HELD FOR APPROVAL/);
    assert.doesNotMatch(high, /RUNS ALONE/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- the targets

test('a target the examples name and floors.json does not is moved to the highest tier', async () => {
  // THE DELIBERATE BREAK, as a test. `bank-api` is declared `T3` in the
  // shipped template and named by `examples/wire_transfer.json`; removing the
  // declaration must move it out of the declared list and into the group whose
  // heading says it is graded at the highest tier. A table that went on
  // reporting it as declared would be reading a cached answer.
  const root = await freshCopy();
  try {
    const before = formatExplained(await explainPolicy(root, grading(TEMPLATE_VERDICTS, 'REFUSED\tX\n  x')));
    assert.match(before, /bank-api {19}T3 {3}declared in floors\.json/);
    assert.doesNotMatch(before, /ABSENT FROM floors\.json/);

    await editJson(root, 'floors.json', (value) => {
      const floors = value['floors'];
      assert.ok(typeof floors === 'object' && floors !== null);
      const table: Record<string, unknown> = { ...floors };
      delete table['bank-api'];
      return { ...value, floors: table };
    });

    const after = formatExplained(await explainPolicy(root, grading(TEMPLATE_VERDICTS, 'REFUSED\tX\n  x')));
    assert.match(after, /ABSENT FROM floors\.json — graded at the highest tier/);
    assert.match(after, /bank-api {19}NOT CHECKED {3}named by an example, declared by nothing/);
    assert.doesNotMatch(after, /bank-api {19}T3/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('the tier column says NOT CHECKED because the grader was asked and named no tier', async () => {
  // The probe, and BOTH of its branches. A CLI that names no tier leaves the
  // column NOT CHECKED; one that names a tier makes the column say so. The
  // second branch is what stops this from being a permanent excuse: if the CLI
  // ever prints the tier, the report stops claiming it could not look.
  const root = await freshCopy();
  try {
    const silent = await explainPolicy(root, grading({}, passed('x', 'LOW', 'REVERSIBLE', '<none owed>')));
    assert.ok(silent.probe !== null, 'the probe did not run against a tree that has examples');
    assert.equal(silent.probe.tier, null);
    assert.match(formatExplained(silent), /the\s+CLI named no tier at all/);

    const loud = await explainPolicy(
      root,
      grading({}, passed('x', 'HIGH', 'IRREVERSIBLE', '<none owed>') + '\teffective_tier=T3'),
    );
    assert.ok(loud.probe !== null);
    assert.equal(loud.probe.tier, 'T3');
    assert.match(formatExplained(loud), /CLI named T3/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// --------------------------------------------------------------- the synthetic

test('an action with no example gets a labelled synthetic row, never a silent one', async () => {
  const root = await freshCopy();
  try {
    await editJson(root, 'risk_functions.json', (value) => {
      const functions = value['risk_functions'];
      assert.ok(Array.isArray(functions));
      return {
        ...value,
        risk_functions: [...functions, { applies_to: 'close_account', base: 'HIGH', raise_to: [] }],
      };
    });
    const found = await explainPolicy(root, grading(TEMPLATE_VERDICTS, passed('close_account', 'HIGH', 'IRREVERSIBLE', '<none owed>')));
    const row = found.rows.find((r) => r.action === 'close_account');
    assert.ok(row !== undefined, 'an action your rules name got no row at all');
    assert.equal(row.source.synthetic, true);
    const text = formatExplained(found);
    assert.match(text, /close_account\s+synthetic, shaped from examples\//);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- the absent

test('an absent binary is NOT CHECKED and never a clean report', async () => {
  const root = await freshCopy();
  try {
    const out = await explainPolicyTool(root, ABSENT);
    assert.equal(out.isError, false, 'a missing tool is not a bad request');
    assert.match(out.text, /NOT CHECKED/);
    assert.doesNotMatch(out.text, /RUNS ALONE/);
    assert.doesNotMatch(out.text, /HELD FOR APPROVAL/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('quorum_k is quoted, and an unreadable one is said rather than replaced', async () => {
  const root = await freshCopy();
  try {
    await editJson(root, join('attesters', 'registry.json'), (value) => {
      const out: Record<string, unknown> = { ...value };
      delete out['quorum_k'];
      return out;
    });
    const found = await explainPolicy(root, grading(TEMPLATE_VERDICTS, 'REFUSED\tX\n  x'));
    assert.equal(found.quorumK, null);
    assert.match(
      formatExplained(found),
      /attesters\/registry\.json declares no quorum_k this tool could read/,
    );
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('the tool refuses a path with no policy tree and reports everything else', async () => {
  const out = await explainPolicyTool('/no/such/tree');
  assert.equal(out.isError, true);
  assert.match(out.text, /^PolicyPathUnreadable: /);
});
