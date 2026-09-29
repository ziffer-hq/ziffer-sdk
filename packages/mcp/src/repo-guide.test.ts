/**
 * That `get_policy_repo_guide` serves the real documents, and that the
 * documents still say the things ACP-389 requires them to say.
 *
 * Two different assertions and both are load-bearing. The first is
 * `guide.test.ts`'s, one artifact over: the served text is compared against the
 * files read off disk, so a stale embedded copy is named rather than served.
 * The second is the one that makes this tool's contract executable — the ticket
 * lists six steps, three provisioned files, four variables, four secrets and a
 * branch protection rule, and the answer to "is that what the tool returns" has
 * to be a test rather than a reading. The list lives in the README, so these
 * assertions are what stops a README edit quietly shortening what every agent
 * is told.
 *
 * Note what is deliberately NOT here: no expected text is pasted into this
 * file. An assertion against a copy would prove this file agrees with itself.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { policyRepoGuide, REPO_GUIDE, repoGuideSpan, RepoGuideError } from './repo-guide.js';
import { fileURLToPath } from 'node:url';

/** dist/repo-guide.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('the served documents are the documents on disk, not copies of them', () => {
  assert.ok(REPO_GUIDE.length > 0, 'no documents were embedded at all');
  for (const doc of REPO_GUIDE) {
    const onDisk = readFileSync(join(repoRoot, doc.path), 'utf8');
    assert.equal(
      doc.markdown,
      onDisk,
      `the embedded copy of ${doc.path} is not what that file says. Either it is stale ` +
        '(run `pnpm --filter @ziffer-io/mcp build`) or the embed step read a different file.',
    );
    assert.ok(policyRepoGuide().includes(onDisk.trim()), `${doc.path} is not in what the tool returns`);
  }
});

test('the answer names the file each half came from', () => {
  // An agent about to edit a customer's repository needs to know which file a
  // sentence came from. Without this line a model handed 15KB of markdown
  // invents a filename for it.
  const served = policyRepoGuide();
  for (const doc of REPO_GUIDE) {
    assert.ok(served.includes(`<!-- ${doc.path} -->`), `${doc.path} is served without attribution`);
  }
});

test('the guide carries the six steps', () => {
  const served = policyRepoGuide();
  for (const step of [1, 2, 3, 4, 5, 6]) {
    assert.match(
      served,
      new RegExp(`^## ${step}\\. `, 'm'),
      `the policy repository guide has no step ${step}. The template README's six steps are what ` +
        'this tool exists to serve; a renumbered or dropped heading is a step nobody is told about.',
    );
  }
});

test('the guide names the three files ZIFFER provisions', () => {
  const served = policyRepoGuide();
  for (const file of ['attesters/registry.json', 'door_identities.json', 'receipt_identity.json']) {
    assert.ok(served.includes(file), `${file} is not named in the guide`);
  }
});

test('the guide names the four repository variables', () => {
  const served = policyRepoGuide();
  for (const name of ['ZIFFER_CLI_URL', 'ZIFFER_CLI_VERSION', 'ZIFFER_CLI_SHA256', 'ZIFFER_PUBLISH_URL']) {
    assert.match(served, new RegExp(`\\b${name}\\b`), `${name} is not named in the guide`);
  }
});

test('the guide names the four secrets, by name and never by value', () => {
  const served = policyRepoGuide();
  for (const name of ['ZIFFER_CLIENT_CERT', 'ZIFFER_CLIENT_KEY', 'ZIFFER_CA', 'POLICY_SIGNING_KEY']) {
    assert.match(served, new RegExp(`\\b${name}\\b`), `${name} is not named in the guide`);
  }
  // The names are the whole content. A guide carrying a key would be a guide
  // that leaks one into every agent's context that ever reads it.
  assert.doesNotMatch(served, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});

test('the guide carries the branch protection rule as a sliceable span', () => {
  // check_policy_repo's RC-8 prints these settings and prints THESE ones: the
  // span is the single source, so this assertion covers both readers.
  const span = repoGuideSpan('branch-protection');
  assert.ok(span.length > 200, 'the branch-protection span is too short to be the rule');
  assert.ok(policyRepoGuide().includes(span), 'the span is not inside what the tool serves');
  for (const setting of [
    'Require a pull request before merging',
    'Require approvals',
    'Require status checks to pass before merging',
    'Do not allow bypassing the above settings',
  ]) {
    assert.ok(span.includes(setting), `the branch protection rule does not name "${setting}"`);
  }
  assert.ok(span.includes('policy-validate'), 'the rule does not say which status check to require');
});

test('an unknown span is refused by name rather than answered with nothing', () => {
  assert.throws(
    () => repoGuideSpan('no-such-span'),
    (error: unknown) => error instanceof RepoGuideError && error.name === 'GuideSectionMissing',
  );
});

test('the guide is substantial, so an empty document could not pass the comparison above', () => {
  // Without this, emptying both documents would satisfy every equality
  // assertion with empty strings on each side.
  assert.ok(policyRepoGuide().length > 8000, 'the policy repository guide is too short to be the two documents');
});
