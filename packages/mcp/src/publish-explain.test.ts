/**
 * That `explain_publish_failure`'s acknowledgement list covers every failure
 * `publish-policy.yml` can emit, and that the answer is the workflow's words.
 *
 * The assertion that carries the weight is {@link !"every failure the workflow
 * can emit has a row"}: it reads the workflow from `templates/policy-repo/`
 * — the file on disk, not the embedded copy — derives the failures from it, and
 * asserts the derived set EQUALS {@link FAILURE_KEYS}. Both directions, for the
 * reason `publish-explain.ts` states: a failure added to the workflow with no
 * row is a question this tool would answer with silence, and a row for a
 * failure that no longer exists is a claim nobody is checking.
 *
 * The derivation is written here as a call into the module under test rather
 * than repeated, which is the opposite of `guide.test.ts`'s choice and is the
 * right one here. There the expected value was a document and re-slicing it
 * independently was cheap; here the "expected value" IS the derivation, so a
 * second copy of it would only assert that two regular expressions agree. What
 * the test holds the module to is the hand-written list — the human half —
 * against the file on disk, which is where drift actually happens.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { TEMPLATE_ROOT } from './generated/template-source.js';
import {
  explainerNoise,
  explainPublishFailure,
  FAILURE_KEYS,
  PINNED_MARKERS,
  pinnedFailures,
  PUBLISH_WORKFLOW,
  PUBLISH_WORKFLOW_TEXT,
  workflowFailures,
  workflowSteps,
} from './publish-explain.js';

/** dist/publish-explain.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflowPath = join(repoRoot, TEMPLATE_ROOT, PUBLISH_WORKFLOW);
const onDisk = readFileSync(workflowPath, 'utf8');

test('the embedded workflow is the workflow on disk', () => {
  assert.equal(
    PUBLISH_WORKFLOW_TEXT,
    onDisk,
    `the embedded copy of ${PUBLISH_WORKFLOW} is stale; run \`pnpm --filter @ziffer-io/mcp build\`.`,
  );
});

test('the reading is not vacuous: the workflow parses into jobs, steps and two explainers', () => {
  // Every assertion below is derived from this reading, so a reading that
  // found nothing would make all of them pass by having nothing to compare.
  const steps = workflowSteps(onDisk);
  assert.ok(steps.length > 8, `only ${steps.length} steps were found in ${PUBLISH_WORKFLOW}`);
  assert.deepEqual([...new Set(steps.map((step) => step.job))].sort(), ['publish', 'renew']);
  const explainers = steps.filter((step) => step.explainer);
  assert.equal(explainers.length, 2, 'the two `if: failure()` steps are what the failure table is read from');
});

test('every failure the workflow can emit has a row, and every row is a failure it can emit', () => {
  const derived = workflowFailures(onDisk)
    .map((failure) => failure.key)
    .sort();
  assert.deepEqual(
    derived,
    [...FAILURE_KEYS].sort(),
    'FAILURE_KEYS and publish-policy.yml disagree. A key the workflow has and this list does not ' +
      'is a failure explain_publish_failure would answer with silence; a key this list has and the ' +
      'workflow does not is a row nothing can ever produce. Read the workflow, then edit the list.',
  );
});

test('no row is an empty answer', () => {
  // A key with no body would report the failure and say nothing about it,
  // which reads as an answer and is not one.
  for (const failure of [...workflowFailures(onDisk), ...pinnedFailures(onDisk)]) {
    assert.ok(failure.body.length > 0, `${failure.key} carries no text from the workflow`);
    assert.ok(failure.where.length > 0, `${failure.key} is not attributed to a step`);
  }
});

test('each pinned marker names exactly one step, and is not something the derivation could see', () => {
  const steps = workflowSteps(onDisk);
  const derived = new Set(workflowFailures(onDisk).map((failure) => failure.key));
  for (const marker of PINNED_MARKERS) {
    const owners = steps.filter((step) => step.lines.some((line) => line.includes(marker)));
    assert.equal(owners.length, 1, `${marker} is written by ${owners.length} steps, not one`);
    assert.equal(owners[0]?.explainer, false, `${marker} is in an explainer step, so it is not a pin`);
    assert.ok(!derived.has(marker), `${marker} is derivable now; take it out of PINNED_MARKERS`);
  }
  assert.equal(pinnedFailures(onDisk).length, PINNED_MARKERS.length, 'a pinned marker resolved to nothing');
});

test('the five failures ACP-389 names by hand are all reachable', () => {
  const keys = new Set([...workflowFailures(onDisk), ...pinnedFailures(onDisk)].map((failure) => failure.key));
  // epoch did not rise; the committed public key is not this key's; a CLI
  // checksum mismatch; a refused client certificate; an expired bundle.
  for (const key of [
    'EPOCH_ROLLBACK',
    'derived.pub.json',
    'REFUSED: the ziffer artifact does not match its pinned checksum.',
    'ClientCertExpired',
    'Expired',
  ]) {
    assert.ok(keys.has(key), `${key} is not among the failures this tool can explain`);
  }
});

test('a refusal in a log is reported with its step and the workflow\'s own words', () => {
  const out = explainPublishFailure(
    ['Run ziffer publish policy/ ...', 'error: EPOCH_ROLLBACK', '##[error]Process completed with exit code 1'].join(
      '\n',
    ),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /^1 of the \d+ failures/);
  assert.match(out.text, /EPOCH_ROLLBACK/);
  assert.match(out.text, /where: publish \//);
  assert.match(out.text, /bundle_epoch is not ABOVE the last epoch/);
});

test("the CLI's own REFUSED lines are matched on the literal prefix, interpolation and all", () => {
  const out = explainPublishFailure('REFUSED: these repository variables are not set: ZIFFER_CLI_URL');
  assert.equal(out.isError, false);
  assert.match(out.text, /REFUSED: these repository variables are not set:/);
  // The same refusal is reachable from three install steps; a reader told only
  // the first would go and look at the wrong job.
  assert.match(out.text, /where: .*;.*/);
});

test("the step that fails with no name of its own is explained by its own comment", () => {
  const out = explainPublishFailure(
    ['--- policy-signing.pub.json\t2026-09-23', '+++ /home/runner/work/_temp/derived.pub.json'].join('\n'),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /derived\.pub\.json/);
  assert.match(out.text, /the only job that holds both halves/);
});

test('a log carrying the workflow\'s own failure table does not match every failure at once', () => {
  // The failure this filter exists for. The table is printed BY a step that
  // runs on failure, so a pasted job log usually contains it; scanning that
  // for names matches all of them and answers "everything went wrong".
  const table = [...explainerNoise(onDisk)];
  assert.ok(table.length > 20, 'the noise filter found almost nothing, so this test proves nothing');
  const out = explainPublishFailure(table.join('\n'));
  assert.equal(out.isError, false);
  assert.match(out.text, /^NoFailureNamed: /);
  assert.match(out.text, /It does NOT mean the publish succeeded\./);
});

test('the real refusal is found in a log that also carries the table', () => {
  const log = [
    'Answer      : {"refusal":"TENANT_MISMATCH"}',
    ...explainerNoise(onDisk),
  ].join('\n');
  const out = explainPublishFailure(log);
  assert.equal(out.isError, false);
  assert.match(out.text, /^1 of the /);
  assert.match(out.text, /TENANT_MISMATCH/);
});

test('a bare word is matched on a word boundary, so prose is not a refusal', () => {
  // `Expired` is a row. Without boundaries every mention of `expires_at`
  // anywhere in a log would report it.
  const out = explainPublishFailure('manifest.json expires_at is 2027-03-01T00:00:00Z and the run was fine');
  assert.match(out.text, /^NoFailureNamed: /);
});

test('an empty log is refused rather than answered', () => {
  const out = explainPublishFailure('   \n  ');
  assert.equal(out.isError, true);
  assert.match(out.text, /^LogEmpty: /);
});

test('a failure added to the workflow with no row is visible to the derivation', () => {
  // The experiment that makes the completeness assertion above a control
  // rather than an intention: the same reading, over a MUTATED copy, finds a
  // key FAILURE_KEYS does not carry. Run against a copy in memory, so this
  // test changes no file and cannot leave a mutant behind.
  const mutated = onDisk.replace(
    '            echo "Nothing was downloaded and nothing was executed." >&2\n            exit 1',
    '            echo "REFUSED: the moon is in the wrong phase." >&2\n' +
      '            echo "Nothing was downloaded and nothing was executed." >&2\n            exit 1',
  );
  assert.notEqual(mutated, onDisk, 'the mutation matched nothing, so this test proves nothing');
  const derived = workflowFailures(mutated).map((failure) => failure.key);
  assert.ok(derived.includes('REFUSED: the moon is in the wrong phase.'), 'the new refusal was not derived');
  assert.ok(
    !FAILURE_KEYS.includes('REFUSED: the moon is in the wrong phase.'),
    'the acknowledgement list already carries the mutant, so it would not have gone red',
  );
});

test('an echoed line is reported as the runner prints it, not as the file spells it', () => {
  // `\"` in a double-quoted echo payload is a quote on standard output. Reading
  // the source spelling would put backslashes into the answer that no log
  // carries, and would make the noise filter miss the very line it removes.
  // The claim that `"` is the ONLY escape any payload uses is derived here
  // rather than assumed: another one appearing turns this red.
  const escapes = new Set<string>();
  for (const match of onDisk.matchAll(/^\s*echo "(.*)"\s*(?:>&2)?\s*$/gm)) {
    for (const escape of (match[1] ?? '').matchAll(/\\(.)/g)) escapes.add(escape[1] ?? '');
  }
  assert.deepEqual([...escapes].sort(), ['"'], 'publish-policy.yml echoes an escape `printed` does not handle');

  const bodies = [...workflowFailures(onDisk), ...pinnedFailures(onDisk)].flatMap((failure) => failure.body);
  assert.ok(bodies.some((line) => line.includes('"kind"')), 'the line this is about is no longer in the workflow');
  for (const line of bodies) assert.ok(!line.includes('\\"'), `a source escape reached the answer: ${line}`);
});
