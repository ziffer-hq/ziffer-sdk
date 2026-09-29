/**
 * What `check_policy_repo` finds, against real trees on disk.
 *
 * Every test here builds its tree by COPYING `templates/policy-repo` into a
 * temporary directory and then breaking exactly one thing. That is deliberate
 * and it is the difference between a suite that tests the checker and one that
 * tests a fixture: a hand-made tree would agree with whatever the checker
 * happens to look for, and the shipped template is the artifact a customer
 * actually starts from.
 *
 * What is NOT asserted here is the shipped template's current state beyond the
 * properties that are true of it by construction — that it is the
 * demonstration tenant's, and that it carries no signing key. Pinning today's
 * gaps (an action with no example) would be a test that goes red when somebody
 * fixes the template, which is a test holding a defect in place. Those are
 * reported by running the tool, not asserted here.
 */

import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY_MEMBERS,
  PRIVATE_KEY_NAME,
  PROVISIONED_FILES,
  PUBLIC_KEY_NAME,
  TEMPLATE_FILES,
  TEMPLATE_ROOT,
  WORKFLOW_FILES,
} from './generated/template-source.js';
import {
  checkPolicyRepo,
  checkPolicyRepoTool,
  ciNow,
  ignoreMatches,
  type CheckResult,
  type CliOutcome,
  type CliRunner,
} from './repo-check.js';

/** dist/repo-check.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const templateDir = join(repoRoot, TEMPLATE_ROOT);
const WORKFLOW_DIR = '.github/workflows';
const SCAN_WORKFLOW = `${WORKFLOW_DIR}/policy-scan.yml`;

/** `ziffer` is not installed. The case every machine running this suite is in,
 * and the one that must never read as PASS. */
const ABSENT: CliRunner = async () => ({ ran: false, code: -1, output: '' });

/** A runner that records what it was asked to run. */
function recording(outcome: CliOutcome): { runner: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CliRunner = async (_cwd, argv) => {
    calls.push([...argv]);
    return outcome;
  };
  return { runner, calls };
}

async function freshCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'acp389-'));
  const root = join(dir, 'policy-repo');
  await cp(templateDir, root, { recursive: true });
  return root;
}

function find(results: readonly CheckResult[], id: string): CheckResult {
  const found = results.find((result) => result.id === id);
  assert.ok(found !== undefined, `${id} is not in the report`);
  return found;
}

// --------------------------------------------------------------- the instrument

test('the embedded template is the template on disk, not a stale copy of it', () => {
  for (const [relative, text] of Object.entries(TEMPLATE_FILES)) {
    const onDisk = readFileSync(join(templateDir, relative), 'utf8');
    assert.equal(
      text,
      onDisk,
      `the embedded copy of ${TEMPLATE_ROOT}/${relative} is not what that file says. Every byte ` +
        'comparison this checker makes is against these bytes, so a stale copy would report a ' +
        'correct clone as wrong and an outdated one as right.',
    );
  }
  assert.ok(POLICY_MEMBERS.length > 0, 'no bundle members were embedded, so RC-2 would pass vacuously');
  // ACP-480. The folder is read HERE, not counted: the list used to be typed,
  // this line pinned it to 2, and the template's third workflow went
  // uncompared from the day it was added. A number agrees with a stale list.
  const onDiskWorkflows = readdirSync(join(templateDir, WORKFLOW_DIR))
    .sort()
    .map((name) => `${WORKFLOW_DIR}/${name}`);
  assert.ok(onDiskWorkflows.length > 0, 'the template ships no workflow, so RC-1 would pass vacuously');
  assert.deepEqual(
    [...WORKFLOW_FILES].sort(),
    onDiskWorkflows,
    `RC-1 compares ${WORKFLOW_FILES.join(', ')} and ${TEMPLATE_ROOT}/${WORKFLOW_DIR} holds ` +
      `${onDiskWorkflows.join(', ')}. A workflow in the template that is not in the list is one ` +
      'a customer can change or delete without this checker saying so.',
  );
  assert.ok(PROVISIONED_FILES.length === 3, 'the three provisioned files are what RC-4 compares');
});

test('the CLI timestamp is the one the workflows pass, to the second and with no fraction', () => {
  // `date -u +%Y-%m-%dT%H:%M:%SZ`. toISOString() would add milliseconds, and
  // "the same invocation as CI" has to mean the same argument rather than one
  // that looks like it.
  assert.equal(ciNow(new Date('2026-09-23T11:22:33.456Z')), '2026-09-23T11:22:33Z');
});

// --------------------------------------------------------- a fresh template copy

test('a fresh copy of the template: the shape is right and the provisioned files are ours', async () => {
  const root = await freshCopy();
  try {
    const results = await checkPolicyRepo(root, ABSENT);
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'PASS');
    // Every workflow in the template's folder is NAMED as compared: a PASS
    // that lists fewer files than the folder holds skipped one in silence.
    for (const name of readdirSync(join(templateDir, WORKFLOW_DIR))) {
      const relative = `${WORKFLOW_DIR}/${name}`;
      assert.ok(
        workflows.detail.some((line) => line.startsWith(`${relative}: identical to `)),
        `${relative} is in the template and RC-1 did not say it compared it: ${workflows.detail.join(' | ')}`,
      );
    }
    assert.equal(find(results, 'RC-2').status, 'PASS');
    assert.equal(find(results, 'RC-7').status, 'PASS');

    // True of the template by construction and for ever: the three files in it
    // belong to the demonstration tenant, which is why the README says to
    // overwrite all three before the first publish.
    const provisioned = find(results, 'RC-4');
    assert.equal(provisioned.status, 'FAIL');
    for (const relative of PROVISIONED_FILES) {
      assert.ok(
        provisioned.detail.some((line) => line.startsWith(`${relative}: STILL`)),
        `${relative} was not reported as the demonstration tenant's`,
      );
    }
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('with ziffer absent RC-3 is NOT CHECKED, names the binary and never reads as PASS', async () => {
  const root = await freshCopy();
  try {
    const cli = find(await checkPolicyRepo(root, ABSENT), 'RC-3');
    assert.equal(cli.status, 'NOT CHECKED');
    assert.match(cli.detail.join('\n'), /ziffer is not on PATH/);
    assert.match(cli.fix, /the install guide, https:\/\/ziffer\.io\/docs\/onboarding\/install, section 1/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('branch protection is NOT CHECKED and prints the settings out of the README', async () => {
  const root = await freshCopy();
  try {
    const protection = find(await checkPolicyRepo(root, ABSENT), 'RC-8');
    assert.equal(protection.status, 'NOT CHECKED');
    const detail = protection.detail.join('\n');
    assert.match(detail, /no API call/);
    assert.match(detail, /Require a pull request before merging/);
    assert.match(detail, /policy-validate/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ one thing broken

test('RC-1: one byte changed in a workflow is a FAIL naming the file and the line', async () => {
  const root = await freshCopy();
  try {
    const relative = WORKFLOW_FILES[0] ?? '';
    const path = join(root, relative);
    const before = await readFile(path, 'utf8');
    const lines = before.split('\n');
    lines[3] = `${lines[3] ?? ''} `; // one trailing space, line 4
    await writeFile(path, lines.join('\n'), 'utf8');

    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some((line) => line.startsWith(`${relative}: DIFFERS`) && line.includes('line 4')),
      `the report did not name ${relative} and the line: ${workflows.detail.join(' | ')}`,
    );
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: a missing workflow is a FAIL and not a silent pass', async () => {
  const root = await freshCopy();
  try {
    await rm(join(root, WORKFLOW_FILES[1] ?? ''));
    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(workflows.detail.some((line) => line.startsWith(`${WORKFLOW_FILES[1] ?? ''}: absent`)));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: the scan workflow changed by one line is a FAIL naming it (ACP-480)', async () => {
  const root = await freshCopy();
  try {
    const path = join(root, SCAN_WORKFLOW);
    const before = await readFile(path, 'utf8');
    await writeFile(path, `${before}# one line more\n`, 'utf8');

    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some((line) => line.startsWith(`${SCAN_WORKFLOW}: DIFFERS`)),
      `the report did not name ${SCAN_WORKFLOW}: ${workflows.detail.join(' | ')}`,
    );
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: the scan workflow deleted is a FAIL naming it, never a silent pass (ACP-480)', async () => {
  const root = await freshCopy();
  try {
    await rm(join(root, SCAN_WORKFLOW));
    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some((line) => line.startsWith(`${SCAN_WORKFLOW}: absent`)),
      `the report did not name ${SCAN_WORKFLOW} as absent: ${workflows.detail.join(' | ')}`,
    );
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// ------------------------------------------- ACP-482: the one permitted edit

/** Rewrite each workflow's policy folder the way its header invites a
 * customer to: the POLICY_DIR value and, where there is one, the `paths:`
 * filter. Done on the TEXT, as a person would, and not through the slots the
 * embed derived: a fixture built with the instrument agrees with it. */
async function setFolder(
  root: string,
  folders: Readonly<Record<string, { dir: string; paths?: string }>>,
): Promise<void> {
  for (const [relative, want] of Object.entries(folders)) {
    const path = join(root, relative);
    const before = await readFile(path, 'utf8');
    assert.ok(before.includes('  POLICY_DIR: policy/\n'), `${relative} no longer sets POLICY_DIR: policy/`);
    let after = before.replace('  POLICY_DIR: policy/\n', `  POLICY_DIR: ${want.dir}\n`);
    if (want.paths !== undefined) {
      assert.ok(after.includes("paths: [ 'policy/**' ]"), `${relative} has no paths: filter to edit`);
      after = after.replace("paths: [ 'policy/**' ]", `paths: [ '${want.paths}' ]`);
    }
    await writeFile(path, after, 'utf8');
  }
}

const VALIDATE_WORKFLOW = `${WORKFLOW_DIR}/policy-validate.yml`;
const PUBLISH_WORKFLOW = `${WORKFLOW_DIR}/publish-policy.yml`;

/** The folder moved to `rules/` everywhere, as each header permits. The scan
 * workflow writes it without the trailing slash, which is the same folder. */
async function moveToRules(root: string): Promise<void> {
  await rename(join(root, 'policy'), join(root, 'rules'));
  await setFolder(root, {
    [SCAN_WORKFLOW]: { dir: 'rules' },
    [VALIDATE_WORKFLOW]: { dir: 'rules/', paths: 'rules/**' },
    [PUBLISH_WORKFLOW]: { dir: 'rules/', paths: 'rules/**' },
  });
}

test('RC-1: the untouched template says the shipped folder is unchanged', async () => {
  const root = await freshCopy();
  try {
    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.equal(workflows.status, 'PASS');
    assert.ok(workflows.detail.includes('policy folder: policy/, the shipped value, unchanged'), workflows.detail.join(' | '));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: the permitted edit passes, names the folder, and every later check reads it', async () => {
  const root = await freshCopy();
  try {
    await moveToRules(root);
    const { runner, calls } = recording({ ran: true, code: 0, output: '' });
    const results = await checkPolicyRepo(root, runner, new Date('2026-09-29T10:00:00Z'));
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'PASS', workflows.detail.join(' | '));
    assert.ok(
      workflows.detail.some((line) => line.startsWith('policy folder: rules/ (shipped as policy/)')),
      workflows.detail.join(' | '),
    );
    const members = find(results, 'RC-2');
    assert.equal(members.status, 'PASS', members.detail.join(' | '));
    assert.match(members.detail.join('\n'), /present under rules\//);
    assert.deepEqual(calls[0], ['ziffer', 'list', 'rules/']);
    assert.ok(calls.length > 1, 'no example was graded under rules/examples');
    for (const call of calls.slice(1)) {
      assert.equal(call[2], 'rules/');
      assert.match(call[7] ?? '', /^rules\/examples\/.*\.json$/);
    }
    const provisioned = find(results, 'RC-4');
    for (const relative of PROVISIONED_FILES) {
      const moved = relative.replace(/^policy\//, 'rules/');
      assert.ok(provisioned.detail.some((line) => line.startsWith(`${moved}: STILL`)), provisioned.detail.join(' | '));
    }
    assert.match(find(results, 'RC-5').detail.join('\n'), /with a proposal in rules\/examples\//);
    assert.equal(find(results, 'RC-7').status, 'PASS');
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: the permitted edit plus one other changed byte is still a FAIL', async () => {
  const root = await freshCopy();
  try {
    await moveToRules(root);
    const path = join(root, PUBLISH_WORKFLOW);
    const lines = (await readFile(path, 'utf8')).split('\n');
    lines[3] = `${lines[3] ?? ''} `;
    await writeFile(path, lines.join('\n'), 'utf8');
    const results = await checkPolicyRepo(root, ABSENT);
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some((line) => line.startsWith(`${PUBLISH_WORKFLOW}: DIFFERS`) && line.includes('line 4')),
      workflows.detail.join(' | '),
    );
    // The folder itself was named lawfully everywhere, so the later checks still read it.
    assert.match(find(results, 'RC-2').detail.join('\n'), /present under rules\//);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: a folder with a .. segment is refused by name, and nothing reads it', async () => {
  const root = await freshCopy();
  try {
    await setFolder(root, {
      [SCAN_WORKFLOW]: { dir: '../rules/' },
      [VALIDATE_WORKFLOW]: { dir: '../rules/', paths: '../rules/**' },
      [PUBLISH_WORKFLOW]: { dir: '../rules/', paths: '../rules/**' },
    });
    const results = await checkPolicyRepo(root, ABSENT);
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(workflows.detail.some((line) => line.includes('has a .. segment')), workflows.detail.join(' | '));
    assert.ok(workflows.detail[0]?.startsWith('policy folder: not established'), workflows.detail.join(' | '));
    for (const id of ['RC-2', 'RC-3', 'RC-4', 'RC-5', 'RC-7']) {
      const dependent = find(results, id);
      assert.equal(dependent.status, 'NOT CHECKED', `${id} did not say it could not look`);
      assert.match(dependent.detail.join('\n'), /RC-1 did not establish the policy folder/);
    }
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: POLICY_DIR and the paths: filter of one file naming two folders is a FAIL naming both', async () => {
  const root = await freshCopy();
  try {
    await setFolder(root, { [PUBLISH_WORKFLOW]: { dir: 'rules/' } });
    const results = await checkPolicyRepo(root, ABSENT);
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some(
        (line) =>
          line.startsWith(`${PUBLISH_WORKFLOW}: `) &&
          line.includes('names policy/') &&
          line.includes('names rules/') &&
          line.includes('must name the same folder'),
      ),
      workflows.detail.join(' | '),
    );
    assert.equal(find(results, 'RC-2').status, 'NOT CHECKED');
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-1: two workflows naming two folders is a FAIL naming both', async () => {
  const root = await freshCopy();
  try {
    await setFolder(root, { [SCAN_WORKFLOW]: { dir: 'rules/' } });
    const results = await checkPolicyRepo(root, ABSENT);
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some(
        (line) =>
          line.startsWith('the workflows name different policy folders') &&
          line.includes(`${SCAN_WORKFLOW} names rules/`) &&
          line.includes(`${PUBLISH_WORKFLOW} names policy/`),
      ),
      workflows.detail.join(' | '),
    );
    assert.equal(find(results, 'RC-5').status, 'NOT CHECKED');
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// ------------------------- ACP-482: NO_EXAMPLE_PROPOSALS, the second permitted value

/** Set NO_EXAMPLE_PROPOSALS in the validate workflow as its header invites, on the text. */
async function declareExamples(root: string, value: string): Promise<void> {
  const path = join(root, VALIDATE_WORKFLOW);
  const before = await readFile(path, 'utf8');
  assert.ok(before.includes("  NO_EXAMPLE_PROPOSALS: 'false'\n"), 'the validate workflow no longer ships NO_EXAMPLE_PROPOSALS: false');
  await writeFile(path, before.replace("  NO_EXAMPLE_PROPOSALS: 'false'\n", `  NO_EXAMPLE_PROPOSALS: ${value}\n`), 'utf8');
}

async function dropExamples(root: string): Promise<void> {
  await rm(join(root, 'policy', 'examples'), { recursive: true, force: true });
}

test('RC-1: NO_EXAMPLE_PROPOSALS as shipped is reported unchanged', async () => {
  const root = await freshCopy();
  try {
    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.ok(
      workflows.detail.some((line) => line.startsWith("example proposals: NO_EXAMPLE_PROPOSALS is 'false', the shipped value, unchanged")),
      workflows.detail.join(' | '),
    );
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("RC-1: NO_EXAMPLE_PROPOSALS 'true' is permitted and said in plain words; with no examples RC-3 and RC-5 are NOT CHECKED", async () => {
  const root = await freshCopy();
  try {
    await declareExamples(root, "'true'");
    await dropExamples(root);
    const { runner } = recording({ ran: true, code: 0, output: '' });
    const results = await checkPolicyRepo(root, runner);
    const workflows = find(results, 'RC-1');
    assert.equal(workflows.status, 'PASS', workflows.detail.join(' | '));
    assert.ok(
      workflows.detail.includes("example proposals: NO_EXAMPLE_PROPOSALS is 'true': this repository declares it has no example proposals"),
      workflows.detail.join(' | '),
    );
    const cli = find(results, 'RC-3');
    assert.equal(cli.status, 'NOT CHECKED', cli.detail.join(' | '));
    assert.match(cli.detail.join('\n'), /declares it has none/);
    const examples = find(results, 'RC-5');
    assert.equal(examples.status, 'NOT CHECKED', examples.detail.join(' | '));
    assert.match(examples.detail.join('\n'), /declares it has none/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("RC-3 and RC-5: with 'false' and no examples both FAIL as NoExampleProposals, as the workflow does", async () => {
  const root = await freshCopy();
  try {
    await dropExamples(root);
    const { runner } = recording({ ran: true, code: 0, output: '' });
    const results = await checkPolicyRepo(root, runner);
    assert.equal(find(results, 'RC-1').status, 'PASS');
    for (const id of ['RC-3', 'RC-5']) {
      const check = find(results, id);
      assert.equal(check.status, 'FAIL', `${id}: ${check.detail.join(' | ')}`);
      assert.match(check.detail.join('\n'), /NoExampleProposals/);
    }
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("RC-1: NO_EXAMPLE_PROPOSALS set to a value the workflow refuses is a FAIL naming it", async () => {
  const root = await freshCopy();
  try {
    await declareExamples(root, "'yes'");
    const workflows = find(await checkPolicyRepo(root, ABSENT), 'RC-1');
    assert.equal(workflows.status, 'FAIL');
    assert.ok(
      workflows.detail.some((line) => line.includes('NO_EXAMPLE_PROPOSALS is "\'yes\'", which the workflow refuses')),
      workflows.detail.join(' | '),
    );
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test("RC-1: 'true' with examples still present grades them", async () => {
  const root = await freshCopy();
  try {
    await declareExamples(root, "'true'");
    const { runner, calls } = recording({ ran: true, code: 0, output: '' });
    const results = await checkPolicyRepo(root, runner);
    assert.equal(find(results, 'RC-1').status, 'PASS');
    assert.equal(find(results, 'RC-3').status, 'PASS');
    assert.ok(calls.length > 1, 'the examples were not graded');
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-2: a deleted bundle member is named', async () => {
  const root = await freshCopy();
  try {
    const member = POLICY_MEMBERS.find((name) => name.endsWith('limits.json')) ?? POLICY_MEMBERS[0] ?? '';
    await rm(join(root, 'policy', member));
    const members = find(await checkPolicyRepo(root, ABSENT), 'RC-2');
    assert.equal(members.status, 'FAIL');
    assert.ok(members.detail.some((line) => line.includes(member)));
    // The advice names what the customer has, the template they received,
    // never a path of the repository that ships it.
    assert.match(members.fix, /the policy\/ folder of the policy repository template you received/);
    assert.doesNotMatch(members.fix, /templates\//);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-3: the CLI is run with exactly the invocations the workflows make', async () => {
  const root = await freshCopy();
  try {
    const { runner, calls } = recording({ ran: true, code: 0, output: '' });
    const at = new Date('2026-09-23T11:22:33Z');
    const cli = find(await checkPolicyRepo(root, runner, at), 'RC-3');
    assert.equal(cli.status, 'PASS');
    assert.deepEqual(calls[0], ['ziffer', 'list', 'policy/']);
    for (const call of calls.slice(1)) {
      assert.equal(call[0], 'ziffer');
      assert.equal(call[1], 'decide');
      assert.equal(call[2], 'policy/');
      assert.equal(call[3], '--unsigned');
      assert.equal(call[4], '--now');
      assert.equal(call[5], '2026-09-23T11:22:33Z');
      assert.equal(call[6], '--proposal');
      assert.match(call[7] ?? '', /^policy\/examples\/.*\.json$/);
    }
    assert.ok(calls.length > 1, 'no example was graded, so the decide invocation was never exercised');
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-3: a refusing CLI is a FAIL carrying what it said', async () => {
  const root = await freshCopy();
  try {
    const { runner } = recording({ ran: true, code: 3, output: 'refused: 8.4-3 no risk function\n' });
    const cli = find(await checkPolicyRepo(root, runner), 'RC-3');
    assert.equal(cli.status, 'FAIL');
    assert.ok(cli.detail.some((line) => line.includes('refused: 8.4-3')));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-4: overwriting the three provisioned files is what makes it PASS', async () => {
  const root = await freshCopy();
  try {
    // The smallest possible difference, on purpose. This check compares bytes
    // and nothing else -- it cannot tell a real enrolment from an edit, and its
    // own fix line says so. An earlier version of this test replaced the
    // demonstration tenant's name, and passed on two of the three files while
    // silently doing nothing to attesters/registry.json, which never mentions
    // it: the test that "proved" the PASS path was exercising two thirds of it.
    for (const relative of PROVISIONED_FILES) {
      await writeFile(join(root, relative), `${TEMPLATE_FILES[relative] ?? ''}\n`, 'utf8');
    }
    const provisioned = find(await checkPolicyRepo(root, ABSENT), 'RC-4');
    assert.equal(provisioned.status, 'PASS');
    assert.match(provisioned.fix, /cannot tell you the ones you have are the right ones/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-5: an action with no proposal is named, and covering it is what clears the check', async () => {
  const root = await freshCopy();
  try {
    // Build the tree this check is about rather than asserting today's
    // template: one example per action, then one removed.
    const risk: unknown = JSON.parse(await readFile(join(root, 'policy', 'risk_functions.json'), 'utf8'));
    assert.ok(typeof risk === 'object' && risk !== null);
    const riskRecord: Record<string, unknown> = { ...risk };
    const functions: unknown = riskRecord['risk_functions'];
    assert.ok(Array.isArray(functions));
    const actions: string[] = [];
    for (const entry of functions) {
      assert.ok(typeof entry === 'object' && entry !== null);
      const entryRecord: Record<string, unknown> = { ...entry };
      const applies: unknown = entryRecord['applies_to'];
      if (typeof applies === 'string') actions.push(applies);
    }
    assert.ok(actions.length > 1, 'the template grades fewer than two actions');

    await rm(join(root, 'policy', 'examples'), { recursive: true, force: true });
    await mkdir(join(root, 'policy', 'examples'), { recursive: true });
    for (const action of actions) {
      await writeFile(
        join(root, 'policy', 'examples', `${action}.json`),
        `${JSON.stringify({ schema_id: action, payload: { task_type: action } }, null, 2)}\n`,
        'utf8',
      );
    }
    assert.equal(find(await checkPolicyRepo(root, ABSENT), 'RC-5').status, 'PASS');

    const dropped = actions[0] ?? '';
    await rm(join(root, 'policy', 'examples', `${dropped}.json`));
    const examples = find(await checkPolicyRepo(root, ABSENT), 'RC-5');
    assert.equal(examples.status, 'FAIL');
    assert.ok(examples.detail.includes(`${dropped}: NO proposal`));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-5: a proposal no risk function grades is named with the clause that refuses it', async () => {
  const root = await freshCopy();
  try {
    await writeFile(
      join(root, 'policy', 'examples', 'unnamed.json'),
      `${JSON.stringify({ payload: { task_type: 'delete_everything' } })}\n`,
      'utf8',
    );
    const examples = find(await checkPolicyRepo(root, ABSENT), 'RC-5');
    assert.equal(examples.status, 'FAIL');
    assert.ok(examples.detail.some((line) => line.includes('delete_everything') && line.includes('8.4-3')));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-6: the committed public key and the ignored private one', async () => {
  const root = await freshCopy();
  try {
    // The template ships neither, by design, so this starts as a FAIL.
    assert.equal(find(await checkPolicyRepo(root, ABSENT), 'RC-6').status, 'FAIL');

    await writeFile(join(root, PUBLIC_KEY_NAME), '{"identity":{}}\n', 'utf8');
    assert.equal(find(await checkPolicyRepo(root, ABSENT), 'RC-6').status, 'PASS');

    // Dropping the pattern that covers the private key is the failure worth
    // catching: the file itself is absent either way, so nothing else would.
    const ignore = await readFile(join(root, '.gitignore'), 'utf8');
    await writeFile(join(root, '.gitignore'), ignore.replace('*.key\n', ''), 'utf8');
    const keys = find(await checkPolicyRepo(root, ABSENT), 'RC-6');
    assert.equal(keys.status, 'FAIL');
    assert.ok(keys.detail.some((line) => line.includes(`nothing in it excludes ${PRIVATE_KEY_NAME}`)));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-6: a private key sitting in the repository is reported outright', async () => {
  const root = await freshCopy();
  try {
    await writeFile(join(root, PUBLIC_KEY_NAME), '{}\n', 'utf8');
    await writeFile(join(root, PRIVATE_KEY_NAME), 'not a real key\n', 'utf8');
    const keys = find(await checkPolicyRepo(root, ABSENT), 'RC-6');
    assert.equal(keys.status, 'FAIL');
    assert.ok(keys.detail.some((line) => line.includes('PRESENT IN THE REPOSITORY')));
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('RC-7: one person as both author and reviewer is the refusal `ziffer sign` makes', async () => {
  const root = await freshCopy();
  try {
    const path = join(root, 'policy', 'manifest.json');
    const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(typeof manifest === 'object' && manifest !== null);
    const copy: Record<string, unknown> = { ...manifest };
    copy['reviewer'] = copy['author'];
    await writeFile(path, `${JSON.stringify(copy, null, 2)}\n`, 'utf8');

    const people = find(await checkPolicyRepo(root, ABSENT), 'RC-7');
    assert.equal(people.status, 'FAIL');
    assert.match(people.fix, /AuthorIsReviewer/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- the boundary

test('a path that is not a directory is the only thing this tool calls an error', async () => {
  const root = await freshCopy();
  try {
    const onFile = await checkPolicyRepoTool(join(root, 'README.md'), ABSENT);
    assert.equal(onFile.isError, true);
    assert.match(onFile.text, /^RepoPathNotADirectory: /);

    const missing = await checkPolicyRepoTool(join(root, 'no-such-directory'), ABSENT);
    assert.equal(missing.isError, true);
    assert.match(missing.text, /^RepoPathUnreadable: /);

    const empty = await checkPolicyRepoTool('   ', ABSENT);
    assert.equal(empty.isError, true);
    assert.match(empty.text, /^RepoPathUnnamed: /);

    // ...and a report full of FAILs is NOT an error: the tool was asked to look
    // and it looked. An agent taught otherwise routes around the check.
    const report = await checkPolicyRepoTool(root, ABSENT);
    assert.equal(report.isError, false);
    assert.match(report.text, /FAIL/);
    assert.match(report.text, /A FAIL is this tool having looked/);
  } finally {
    await rm(dirname(root), { recursive: true, force: true });
  }
});

test('the gitignore reader says what it cannot read rather than calling it a miss', () => {
  assert.equal(ignoreMatches('*.key', 'policy-signing.key'), true);
  assert.equal(ignoreMatches('policy-signing.key', 'policy-signing.key'), true);
  assert.equal(ignoreMatches('!policy-signing.key', 'policy-signing.key'), true);
  assert.equal(ignoreMatches('*.pem', 'policy-signing.key'), false);
  assert.equal(ignoreMatches('.ziffer/', 'policy-signing.key'), null);
  assert.equal(ignoreMatches('**/*.key', 'policy-signing.key'), null);
  assert.equal(ignoreMatches('policy-signing.[kK]ey', 'policy-signing.key'), null);
});
