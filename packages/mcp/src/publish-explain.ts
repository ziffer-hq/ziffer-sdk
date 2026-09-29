/**
 * `explain_publish_failure` — read a failed `publish-policy` run back to the
 * person who has to fix it (ACP-389).
 *
 * `explainReceipt` is the shape this mirrors: it holds no rules of its own and
 * it never invents a name. Every refusal this tool can report, and every word
 * it says about one, comes out of `templates/policy-repo/.github/workflows/
 * publish-policy.yml` — the file the customer is running. Nothing is
 * transcribed. The workflow already prints a table on failure; a second copy of
 * that table in TypeScript would be the one that goes stale, and the person on
 * the wrong side of the difference is the one whose publish is red.
 *
 * # So what is written here, and why anything is
 *
 * {@link FAILURE_KEYS} — a list of strings and nothing else. It is the
 * acknowledgement list: every failure the workflow can emit has to be in it, and
 * `publish-explain.test.ts` derives the same set by reading the workflow off
 * disk and asserts the two are EQUAL, both directions. A failure added to the
 * workflow without a row goes red; a row for a failure that no longer exists
 * goes red too. That second direction matters as much as the first — a pinned
 * item that has stopped firing is a claim nobody is checking any more
 * (ACP-299's rule, one repository over).
 *
 * The explanation, the step and the section come from the file at call time.
 *
 * # What the derivation CANNOT see, said here rather than discovered later
 *
 *   * a step that fails with no message of its own. `The committed public key
 *     is this key's` fails as a `diff` exiting non-zero and prints no name at
 *     all; it is in {@link PINNED_MARKERS}, matched on a filename only that
 *     step writes, and the test asserts that filename still appears in exactly
 *     one step;
 *   * the failure modes the workflow describes in prose rather than in its name
 *     column — the oversize body that is reset with no answer is named in the
 *     same paragraph as the TLS handshake and is reported with it;
 *   * anything the ZIFFER publisher answers that the workflow does not list.
 *     The workflow's table is the contract this tool reads. It is `services/
 *     publish`'s `denied` module one repository over that decides what can
 *     actually be answered, and the workflow says so in its own comment.
 */

import { TEMPLATE_FILES } from './generated/template-source.js';
import type { ToolOutcome } from './tools.js';

/** The workflow this tool reads, by the path it has in the template. */
export const PUBLISH_WORKFLOW = '.github/workflows/publish-policy.yml';

/** Its bytes, as shipped. */
export const PUBLISH_WORKFLOW_TEXT: string = TEMPLATE_FILES[PUBLISH_WORKFLOW] ?? '';

/**
 * Every failure `publish-policy.yml` can emit, acknowledged.
 *
 * Written out, sorted, and checked against the file. Do not edit it to make a
 * test pass: if the test names a key that is not here, the workflow grew a
 * failure and the question is whether an agent reading this tool's answer would
 * know what to do about it.
 */
export const FAILURE_KEYS: readonly string[] = [
  'AlertAudienceMissing',
  'AuthorIsReviewer',
  'BODY_MALFORMED',
  'BUNDLE_INCOMPLETE',
  'BUNDLE_NOT_A_TREE',
  'BUNDLE_REFUSED',
  'CLOCK_UNREADABLE',
  'ClientCertExpired',
  'DoorAbsent',
  'EPOCH_ROLLBACK',
  'Expired',
  'HASH_COLLISION',
  "HTTP 403 / 'Resource not accessible'",
  'LEDGER_UNAVAILABLE',
  'MEMBERS_MALFORMED',
  'Malformed',
  'QuorumInvalid',
  'REFUSED: ZIFFER_CLI_SHA256 is not 64 lowercase hexadecimal characters.',
  'REFUSED: ZIFFER_RENEW_SHA256 is not 64 lowercase hexadecimal characters.',
  'REFUSED: ZIFFER_RENEW_VERSION is not <crate version>-<7-character commit>.',
  'REFUSED: the ziffer artifact does not match its pinned checksum.',
  'REFUSED: the ziffer-renew artifact does not match its pinned checksum.',
  'REFUSED: these repository variables are not set:',
  'RegistryKeyWeak',
  'RegistryKeysNotDistinct',
  'SIGNATURE_DIFFERS',
  'SIGNATURE_MALFORMED',
  'STORE_PATH_INVALID',
  'STORE_TREE_MISMATCH',
  'STORE_UNAVAILABLE',
  'SignatureInvalid',
  'SuiteBelowFloor',
  'TENANT_MISMATCH',
  'TLS HANDSHAKE FAILURE',
  'TenantAbsent',
  'gh: command not found',
];

/**
 * Failures with no name to derive, matched on a string only their step writes.
 *
 * One entry, and the ticket named it: the publish job checks that the committed
 * public key is the signing key's by deriving the public half and running
 * `diff`. A `diff` that differs exits non-zero and prints a patch — there is no
 * refusal name anywhere in that step, so no reading of the workflow's failure
 * table could ever produce one. The marker is the filename the step writes the
 * derived key to, and the test asserts it still appears in exactly one step.
 */
export const PINNED_MARKERS: readonly string[] = ['derived.pub.json'];

// ---------------------------------------------------------------- the reading

/** One step of the workflow, with the job it belongs to. */
export interface WorkflowStep {
  readonly job: string;
  readonly name: string;
  readonly lines: readonly string[];
  /** Runs only when something already failed, so everything it prints is a
   * description of a failure rather than one. */
  readonly explainer: boolean;
}

/** What the workflow says about one failure. */
export interface WorkflowFailure {
  readonly key: string;
  /** Where it is written: `publish / Install the ziffer CLI...`. For an
   * explainer key this is the step that NAMES the failure, not the step that
   * failed — the section says which step that was. */
  readonly where: readonly string[];
  /** The explainer's own `--- ... ---` heading, when there is one. */
  readonly section: string;
  /** The workflow's own words, verbatim, dedented. */
  readonly body: readonly string[];
}

const STEP = /^ *- name: (.*)$/;
const ECHO = /^\s*echo "(.*)"\s*$/;
const ECHO_ERR = /^\s*echo "(.*)"\s*>&2\s*$/;

/** What one `echo` line actually PRINTS, from the line that writes it.
 *
 * The payload is a double-quoted shell string, so `\"` in the file is a quote
 * on the runner's standard output. Reading the source spelling would put
 * backslashes into the answer that never appear in a log — and, worse, would
 * make the noise filter miss the line it is trying to remove, because the log
 * carries the printed form. `"` is the only escape any echo payload in this
 * workflow uses, asserted by reading the file rather than assumed. */
function printed(payload: string): string {
  return payload.split('\\"').join('"');
}
const SECTION = /^\s*-{3,}\s*(.*?)\s*-{3,}\s*$/;
const NAMES = /^([A-Z][A-Za-z_]*(?:,[ ]*[A-Z][A-Za-z_]*)*),?([ ]+--(?:[ ].*)?|[ ]{2,}\S.*)?$/;
const BULLET_DASH = /^(.+?)[ ]+--(?:[ ]|$)/;
const COLUMN = /^(.*?\S)[ ]{2,}\S/;

/** Split the workflow into steps, each tagged with its job. */
export function workflowSteps(text: string): readonly WorkflowStep[] {
  const lines = text.split('\n');
  const jobsAt = lines.indexOf('jobs:');
  const steps: WorkflowStep[] = [];
  let job = '(before jobs:)';
  let current: { job: string; name: string; lines: string[] } | null = null;
  const flush = (): void => {
    if (current === null) return;
    steps.push({
      job: current.job,
      name: current.name,
      lines: current.lines,
      explainer: current.lines.some((line) => /^\s*if:\s*failure\(\)\s*$/.test(line)),
    });
    current = null;
  };
  lines.forEach((line, index) => {
    const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (header !== null && jobsAt !== -1 && index > jobsAt) {
      flush();
      job = header[1] ?? job;
      return;
    }
    const start = STEP.exec(line);
    if (start !== null) {
      flush();
      current = { job, name: (start[1] ?? '').trim(), lines: [line] };
      return;
    }
    if (current !== null) current.lines.push(line);
  });
  flush();
  return steps;
}

/** The leading `#` comment block of a step, dedented. */
function stepComment(step: WorkflowStep): readonly string[] {
  const out: string[] = [];
  for (const line of step.lines) {
    const comment = /^\s*# ?(.*)$/.exec(line);
    if (comment !== null) out.push(comment[1] ?? '');
    else if (out.length > 0 && line.trim() !== '') break;
  }
  return out;
}

/** The keys one echoed payload carries, and whether the line says anything
 * about them.
 *
 * `bare` is the line that is NOTHING but names — `AuthorIsReviewer,
 * TenantAbsent, DoorAbsent,` — which is how the workflow wraps a list of
 * refusals that share one explanation further down. It is the only case in
 * which a key line belongs to the same group as the key line after it; two
 * keys that each carry their own `-- what it means` are two groups, and
 * merging them would report `Expired` with `SuiteBelowFloor`'s sentence
 * attached. The rules are SHAPES in the workflow's own formatting rather than a
 * list of names, so a refusal added in that shape is found without editing
 * anything here. */
function keysIn(payload: string): { readonly keys: readonly string[]; readonly bare: boolean } {
  const none = { keys: [], bare: false };
  if (!/^ {2,}/.test(payload)) return none;
  const trimmed = payload.replace(/^ +/, '');
  const bullet = trimmed.startsWith('* ');
  const body = bullet ? trimmed.slice(2) : trimmed;
  const names = NAMES.exec(body);
  if (names !== null) {
    return {
      keys: (names[1] ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
      bare: names[2] === undefined,
    };
  }
  if (bullet) {
    const dash = BULLET_DASH.exec(body);
    if (dash !== null) return { keys: [(dash[1] ?? '').trim()], bare: false };
  }
  const column = COLUMN.exec(body);
  if (column !== null) return { keys: [(column[1] ?? '').trim()], bare: false };
  return none;
}

/** Every failure the workflow can emit, read out of it. */
export function workflowFailures(text: string): readonly WorkflowFailure[] {
  const found = new Map<string, { where: string[]; section: string; body: string[] }>();
  const add = (key: string, where: string, section: string, body: readonly string[]): void => {
    const already = found.get(key);
    if (already === undefined) {
      found.set(key, { where: [where], section, body: [...body] });
      return;
    }
    // The same refusal reachable from more than one step -- the three install
    // steps share their variable check. One entry, every step named: a reader
    // told only the first would go and look at the wrong job.
    if (!already.where.includes(where)) already.where.push(where);
  };

  for (const step of workflowSteps(text)) {
    const where = `${step.job} / ${step.name}`;

    if (step.explainer) {
      let section = '';
      // `open` is true while the group is still collecting KEYS -- see
      // keysIn's `bare`. Continuation lines are collected either way.
      let group: { keys: string[]; body: string[]; open: boolean } | null = null;
      const flush = (): void => {
        if (group === null) return;
        for (const key of group.keys) add(key, where, section, group.body);
        group = null;
      };
      for (const line of step.lines) {
        const echo = ECHO.exec(line);
        if (echo === null) continue;
        const payload = printed(echo[1] ?? '');
        const heading = SECTION.exec(payload);
        if (heading !== null) {
          flush();
          section = (heading[1] ?? '').trim();
          continue;
        }
        if (payload.trim() === '') {
          flush();
          continue;
        }
        const parsed = keysIn(payload);
        if (parsed.keys.length > 0) {
          if (group === null || !group.open) {
            flush();
            group = { keys: [...parsed.keys], body: [payload.trim()], open: parsed.bare };
          } else {
            group.keys.push(...parsed.keys);
            group.body.push(payload.trim());
            group.open = parsed.bare;
          }
          continue;
        }
        if (group !== null) {
          group.body.push(payload.trim());
          group.open = false;
        }
      }
      flush();
      continue;
    }

    // A step that refuses on its own terms: every `REFUSED:` line, with the
    // block of stderr the workflow prints beside it, up to its `exit 1`.
    let block: { key: string; body: string[] } | null = null;
    for (const line of step.lines) {
      const echo = ECHO_ERR.exec(line);
      if (echo !== null) {
        const payload = printed(echo[1] ?? '').trim();
        if (payload.startsWith('REFUSED:')) {
          if (block !== null) add(block.key, where, '', block.body);
          // Cut at the first shell interpolation: the literal prefix is what a
          // log carries and what this tool can match on.
          const key = (payload.split('$')[0] ?? payload).trim();
          block = { key, body: [payload] };
          continue;
        }
        if (block !== null) block.body.push(payload);
        continue;
      }
      if (block !== null && /^\s*exit 1\s*$/.test(line)) {
        add(block.key, where, '', block.body);
        block = null;
      }
    }
    if (block !== null) add(block.key, where, '', block.body);
  }

  return [...found.entries()].map(([key, value]) => ({
    key,
    where: value.where,
    section: value.section,
    body: value.body,
  }));
}

/** The pinned markers, resolved against the workflow: the step that writes
 * each, and that step's own comment as its explanation. */
export function pinnedFailures(text: string): readonly WorkflowFailure[] {
  const steps = workflowSteps(text);
  const out: WorkflowFailure[] = [];
  for (const marker of PINNED_MARKERS) {
    const owners = steps.filter((step) => step.lines.some((line) => line.includes(marker)));
    const first = owners[0];
    if (first === undefined) continue;
    out.push({
      key: marker,
      where: owners.map((step) => `${step.job} / ${step.name}`),
      section: 'a step that fails with no name of its own',
      body: stepComment(first),
    });
  }
  return out;
}

/** Everything an explainer step prints when it runs, as literal lines.
 *
 * A pasted log of a failed run usually CONTAINS the workflow's own table,
 * because the table is printed by a step that runs on failure. Scanning that
 * for refusal names matches every one of them and answers "all thirty of these
 * happened", which is worse than answering nothing. These lines are removed
 * before the log is read. They are derived from the same file, so a line the
 * workflow stops printing stops being filtered on the same build. */
export function explainerNoise(text: string): ReadonlySet<string> {
  const noise = new Set<string>();
  for (const step of workflowSteps(text)) {
    if (!step.explainer) continue;
    for (const line of step.lines) {
      const echo = ECHO.exec(line);
      if (echo === null) continue;
      const payload = printed(echo[1] ?? '');
      if (payload.includes('${')) continue; // interpolated: not a literal line
      const trimmed = payload.trim();
      if (trimmed !== '') noise.add(trimmed);
    }
  }
  return noise;
}

// ------------------------------------------------------------------- the tool

function mentions(haystack: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A bare word gets word boundaries, so `Expired` does not match `expires_at`
  // in a sentence; a key with punctuation or spaces is matched literally.
  const pattern = /^[A-Za-z_]+$/.test(key) ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern).test(haystack);
}

/**
 * Read a pasted run log and report the failures it carries.
 *
 * Reports every match rather than the first: a run can fail once, but a log
 * pasted from a re-run carries more than one, and choosing between them would
 * be this tool guessing.
 */
export function explainPublishFailure(log: string, workflow: string = PUBLISH_WORKFLOW_TEXT): ToolOutcome {
  if (log.trim() === '') {
    return {
      text:
        'LogEmpty: paste the failed run\'s log. The Actions tab -> the red run -> the failed step, ' +
        'or the whole job log; this tool reads either.',
      isError: true,
    };
  }
  const noise = explainerNoise(workflow);
  const signal = log
    .split('\n')
    .filter((line) => !noise.has(line.trim()))
    .join('\n');

  const known = [...workflowFailures(workflow), ...pinnedFailures(workflow)];
  const matched = known.filter((failure) => mentions(signal, failure.key));

  if (matched.length === 0) {
    return {
      text:
        `NoFailureNamed: nothing in this log matches any of the ${known.length} failures ` +
        `${PUBLISH_WORKFLOW} can emit.\n` +
        '  Two things this means and one it does not. It may be the wrong part of the log — the\n' +
        '  refusal is printed by the step that failed, and the table under "What the refusal\n' +
        '  means" is filtered out here because a log carrying it would otherwise match every\n' +
        '  name at once. It may be a failure that is not this workflow\'s: a runner that never\n' +
        '  started, a checkout that could not read the repository, a cancelled run.\n' +
        '  It does NOT mean the publish succeeded.',
      isError: false,
    };
  }

  const lines: string[] = [
    `${matched.length} of the ${known.length} failures ${PUBLISH_WORKFLOW} can emit are named in this log.`,
    '',
  ];
  for (const failure of matched) {
    lines.push(failure.key);
    lines.push(`  where: ${failure.where.join('; ')}`);
    if (failure.section !== '') lines.push(`  which: ${failure.section}`);
    lines.push('  the workflow\'s own words:');
    for (const line of failure.body) lines.push(`    ${line}`);
    lines.push('');
  }
  lines.push(
    'Every line above is quoted from the workflow you are running, not from a copy of it.',
    'The full table is docs/onboarding/policy-ci.md section 5.',
  );
  return { text: lines.join('\n'), isError: false };
}
