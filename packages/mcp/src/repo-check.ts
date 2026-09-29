/**
 * `check_policy_repo` — read a clone of the policy repository and say what is
 * not yet true about it (ACP-389).
 *
 * # This is the first tool in this package with a hand on the machine
 *
 * `tools.ts` said the server "has no hands on the developer's machine"; since
 * ACP-394 it scopes that to its own handlers, for which it holds. This one reads files
 * under a path the caller names and runs one binary. Both are new, both are
 * narrower than they sound, and saying so is better than letting a reader
 * discover it:
 *
 *   * it OPENS files and never writes one. There is no code path here that
 *     creates, edits, moves or deletes anything, and the checks are all
 *     comparisons;
 *   * it runs `ziffer` with an argument vector, through `execFile` and never a
 *     shell, so nothing in the path it is handed is ever interpreted as a
 *     command. The two subcommands it runs are the two the customer's own
 *     pull-request workflow runs, `list` and `decide --unsigned`, and neither
 *     holds a key, opens a connection or writes a file;
 *   * it still approves nothing and verifies no signature. A green line here is
 *     "this looks like the repository we shipped", never "this bundle is valid".
 *
 * # Why the CLI and not a validator written here
 *
 * Because the alternative is a second definition of the rules. The gateway
 * grades a bundle with the engine's own code; `ziffer` is that code as a
 * binary; a TypeScript re-implementation of "the ten policy files are
 * parseable" would be a third opinion whose disagreements with the other two
 * are discovered by a customer on their first publish. So when `ziffer` is not
 * on PATH this check reports NOT CHECKED and names the binary and the chapter
 * that installs it. It never reports PASS: a check that answers "fine" because
 * it could not look is the worst line in any of these reports.
 *
 * # Why FAIL is not a tool error
 *
 * `ToolOutcome.isError` is set for a refusal — the tool could not do what it
 * was asked. A FAIL here is the tool doing exactly what it was asked and
 * finding something, which is `tools.ts`'s own reasoning about a `DENY`: an
 * agent taught that "the check found something" is a malfunction will route
 * around the check. `isError` is set only when the path is not a readable
 * directory, because then nothing was checked at all.
 */

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  POLICY_MEMBERS,
  PRIVATE_KEY_NAME,
  PRIVATE_KEY_PATH,
  PROVISIONED_FILES,
  PUBLIC_KEY_NAME,
  SHIPPED_POLICY_FOLDER,
  TEMPLATE_FILES,
  WORKFLOW_FILES,
  NO_EXAMPLES_SLOT,
  WORKFLOW_POLICY_SLOTS,
  type PolicyDirSlot,
} from './generated/template-source.js';
import { repoGuideSpan } from './repo-guide.js';
import type { ToolOutcome } from './tools.js';

/** PASS, FAIL, or NOT CHECKED — and there is no fourth. An earlier draft had a
 * NOT APPLICABLE for the author-vs-reviewer check, in case `manifest.json` had
 * no such fields; it has both, every publish refuses `AuthorIsReviewer` on
 * them, so the status would have been a value nothing could ever produce. An
 * unreachable status in a report is a promise about a case that does not
 * exist. */
export type CheckStatus = 'PASS' | 'FAIL' | 'NOT CHECKED';

/** One line of the report. `detail` is the evidence and `fix` is the single
 * action, because a check that reports a problem without the next move is a
 * check that gets ignored. */
export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly detail: readonly string[];
  readonly fix: string;
}

/** What running `ziffer` produced. `ran` is false only when the binary could
 * not be started at all, which is the case that must not read as a failing
 * check. */
export interface CliOutcome {
  readonly ran: boolean;
  readonly code: number;
  readonly output: string;
}

/** How this module runs the CLI. Injected so the tests drive the absent
 * binary, the refusing binary and the accepting one without needing any of the
 * three on the machine running them. */
export type CliRunner = (cwd: string, argv: readonly string[]) => Promise<CliOutcome>;

/** The binary the customer's own workflows install and run. */
export const CLI = 'ziffer';

/** Where a reader is sent when it is not there. */
// What the customer has: the published guide, never this repository's path to its source.
const INSTALL_CHAPTER = 'the install guide, https://ziffer.io/docs/onboarding/install, section 1';

/** The private key's path as a person writes it. The value is derived from
 * `bin/new-signing-key.sh`, where it is a shell assignment and so spells the
 * home directory `${HOME}`; the template's README tells the customer `~`. This
 * renders the one derived value the way the document they are reading does,
 * which is not a second copy of it. */
const PRIVATE_KEY_HOME = PRIVATE_KEY_PATH.replace(/^\$\{HOME\}/, '~');

/** The proposals the validate workflow grades: `${POLICY_DIR%/}/examples`, as
 * its own step spells them, under whatever folder RC-1 found. */
function examplesDir(folder: string): string {
  return `${folder}/examples`;
}

/** The production runner: `execFile`, never `exec`, so the argument vector is
 * an argument vector and the path the model handed us is never a command. */
export const execFileRunner: CliRunner = (cwd, argv) =>
  new Promise((resolve) => {
    const [command, ...rest] = argv;
    if (command === undefined) {
      resolve({ ran: false, code: -1, output: 'no command' });
      return;
    }
    execFile(command, rest, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (error === null) {
        resolve({ ran: true, code: 0, output });
        return;
      }
      // ENOENT is "there is no such binary", which is NOT CHECKED. Everything
      // else is the binary having run and said no, which is a finding.
      const code: unknown = 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') {
        resolve({ ran: false, code: -1, output });
        return;
      }
      resolve({ ran: true, code: typeof code === 'number' ? code : 1, output });
    });
  });

/** The timestamp the validate and publish workflows pass: `date -u +%Y-%m-%dT%H:%M:%SZ`, second
 * resolution, no fraction. Spelled the same way here because `--now` is parsed
 * under WE-5's grammar and "the same invocation" has to mean the same
 * argument, not one that looks like it. */
export function ciNow(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

// --------------------------------------------------------------- reading JSON

/** One field of a value that may not be an object at all. Narrowed with
 * `typeof`, never a cast: the input is a customer's file. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const record: Record<string, unknown> = { ...value };
  return record[key];
}

function stringField(value: unknown, key: string): string | null {
  const found = field(value, key);
  return typeof found === 'string' ? found : null;
}

async function readBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null> {
  const bytes = await readBytes(path);
  return bytes === null ? null : bytes.toString('utf8');
}

async function readJson(path: string): Promise<{ value: unknown } | { error: string }> {
  const text = await readText(path);
  if (text === null) return { error: 'not found' };
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// ------------------------------------------------------------------ .gitignore

/** The patterns of a `.gitignore`, comments and blank lines dropped. */
function ignorePatterns(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Does one `.gitignore` pattern match this basename?
 *
 * Deliberately tiny, and it refuses rather than guesses. `*` is the only
 * wildcard it knows, because that is the only one the template uses (`*.key`),
 * and a pattern using anything else returns `null` — "this reader cannot say" —
 * so the check can report what it could not read instead of silently treating
 * an unreadable pattern as a miss. A full gitignore matcher here would be a
 * second implementation of git's rules, which is the defect this whole package
 * argues against one artifact over.
 */
export function ignoreMatches(pattern: string, basename: string): boolean | null {
  const bare = pattern.startsWith('!') ? pattern.slice(1) : pattern;
  if (/[?\[\]]/.test(bare) || bare.includes('**') || bare.includes('/')) return null;
  const escaped = bare.replace(/[.+^${}()|\\]/g, '\\$&').split('*').join('[^/]*');
  return new RegExp(`^${escaped}$`).test(basename);
}

// ----------------------------------------------------------------- the checks

// ------------------------------------------------- RC-1 and the policy folder

/**
 * ACP-482. Each workflow's header names ONE value the customer may edit: the
 * policy folder, POLICY_DIR, which validate and publish also spell in their
 * `paths:` filter because GitHub reads `on:` before any `env:` exists. RC-1
 * used to compare byte for byte, so a customer who made exactly that edit got a
 * FAIL on all three workflows, and every other check then read a typed
 * `policy/` that was no longer there.
 *
 * Now a workflow is the shipped bytes everywhere except the slots the embed
 * READ from the template (`WORKFLOW_POLICY_SLOTS`: the text before and after the
 * folder on its line). Every other byte still has to match. The folders found
 * are normalised (a `/**` suffix and one trailing `/` dropped), must be lawful,
 * must agree inside each file and across the three, and the one folder that
 * results is what every later check reads. When there is no such folder the
 * later checks say NOT CHECKED and why; none of them passes on a guess.
 */

/** The normal form two spellings of one folder are compared in. */
export function normalFolder(value: string): string {
  let folder = value;
  if (folder.endsWith('/**')) folder = folder.slice(0, -3);
  if (folder.endsWith('/')) folder = folder.slice(0, -1);
  return folder;
}

/** Why a folder cannot be the policy folder, or null when it can. The value is
 * pasted into shell steps and handed to `ziffer` as a path, so it is held to a
 * relative path of plain characters inside the repository. */
export function unlawfulFolder(folder: string): string | null {
  if (folder === '') return 'it is empty';
  if (folder.startsWith('/')) return 'it starts with /, so it is not a path inside the repository';
  if (/\s/.test(folder)) return 'it contains whitespace';
  if (folder.split('/').includes('..')) return 'it has a .. segment, so it can name a folder outside the repository';
  const odd = /[^A-Za-z0-9._/-]/.exec(folder);
  if (odd !== null) {
    return `it contains ${JSON.stringify(odd[0])}; a policy folder is letters, digits, '.', '_', '-' and '/' only, because the workflows pass it to the shell`;
  }
  return null;
}

/** POLICY_DIR may be written quoted in YAML; the quotes are not the folder. */
function unquote(value: string): string {
  const quoted = /^'(.*)'$/.exec(value) ?? /^"(.*)"$/.exec(value);
  return quoted === null ? value : (quoted[1] ?? '');
}

/** What one workflow says about the policy folder, beside how it compares. */
interface WorkflowReading {
  readonly detail: readonly string[];
  readonly bad: boolean;
  /** The folder this file names; null when it names none this check can trust. */
  readonly folder: string | null;
  /** Why `folder` is null, for the dependent checks' NOT CHECKED line. */
  readonly why: string | null;
  /** NO_EXAMPLE_PROPOSALS as this file sets it, when this is the file that
   * sets it and the value is one the workflow accepts; null otherwise. */
  readonly declared: string | null;
}

/** The plain words for NO_EXAMPLE_PROPOSALS' value. */
function declaredWords(value: string): string {
  return value === NO_EXAMPLES_SLOT.none
    ? 'this repository declares it has no example proposals'
    : 'this repository has example proposals to grade';
}

function slotName(slot: PolicyDirSlot): string {
  return slot.kind === 'POLICY_DIR' ? 'POLICY_DIR' : 'the paths: filter';
}

function readWorkflow(relative: string, mine: string, shipped: string): WorkflowReading {
  const slots = WORKFLOW_POLICY_SLOTS[relative] ?? [];
  const byLine = new Map<number, PolicyDirSlot>();
  for (const slot of slots) byLine.set(slot.line, slot);
  const a = mine.split('\n');
  const b = shipped.split('\n');
  const limit = Math.max(a.length, b.length);
  const detail: string[] = [];
  let firstOther: number | null = null;
  let why: string | null = null;
  const found: { slot: PolicyDirSlot; folder: string }[] = [];

  if (slots.length === 0) {
    detail.push(`${relative}: the embedded template names no POLICY_DIR in it, so no folder can be read`);
    return { detail, bad: true, folder: null, why: `${relative} names no POLICY_DIR this check can find`, declared: null };
  }
  // ACP-482's second permitted value, in the one workflow that sets it.
  const declaration = NO_EXAMPLES_SLOT.file === relative ? NO_EXAMPLES_SLOT : null;
  let declared: string | null = null;
  let badDeclaration = false;
  for (let i = 0; i < limit; i += 1) {
    const here = a[i];
    const slot = byLine.get(i + 1);
    if (declaration !== null && declaration.line === i + 1) {
      const fits =
        here !== undefined &&
        here.length >= declaration.prefix.length + declaration.suffix.length &&
        here.startsWith(declaration.prefix) &&
        here.endsWith(declaration.suffix);
      if (here === undefined || !fits) {
        detail.push(
          `${relative} line ${i + 1}: NO_EXAMPLE_PROPOSALS is changed beyond its value ` +
            `(shipped: ${JSON.stringify(b[i] ?? '')})`,
        );
        badDeclaration = true;
        continue;
      }
      const raw = here.slice(declaration.prefix.length, here.length - declaration.suffix.length);
      const value = unquote(raw);
      if (!declaration.values.includes(value)) {
        detail.push(
          `${relative} line ${i + 1}: NO_EXAMPLE_PROPOSALS is ${JSON.stringify(raw)}, which the workflow refuses: ` +
            `it accepts ${declaration.values.map((v) => `'${v}'`).join(' or ')}`,
        );
        badDeclaration = true;
        continue;
      }
      declared = value;
      continue;
    }
    if (slot !== undefined && here === undefined) {
      firstOther ??= i + 1;
      why ??= `${relative} ends before line ${i + 1}, where ${slotName(slot)} names the folder`;
      continue;
    }
    if (slot !== undefined && here !== undefined) {
      const fits =
        here.length >= slot.prefix.length + slot.suffix.length &&
        here.startsWith(slot.prefix) &&
        here.endsWith(slot.suffix);
      if (!fits) {
        detail.push(
          `${relative} line ${i + 1}: ${slotName(slot)} is changed beyond its folder ` +
            `(shipped: ${JSON.stringify(b[i] ?? '')})`,
        );
        why ??= `${relative} line ${i + 1} is not ${slotName(slot)} with a folder in it`;
        continue;
      }
      const raw = here.slice(slot.prefix.length, here.length - slot.suffix.length);
      const folder = normalFolder(slot.kind === 'POLICY_DIR' ? unquote(raw) : raw);
      const unlawful = unlawfulFolder(folder);
      if (unlawful !== null) {
        detail.push(`${relative} line ${i + 1}: ${slotName(slot)} names ${JSON.stringify(raw)}, which is refused: ${unlawful}`);
        why ??= `${relative} line ${i + 1} names a folder that is refused`;
        continue;
      }
      found.push({ slot, folder });
      continue;
    }
    if (here !== b[i]) firstOther ??= i + 1;
  }

  let bad = why !== null || badDeclaration;
  if (firstOther !== null) {
    detail.push(
      `${relative}: DIFFERS from the policy repository template's ${relative}, first at line ${firstOther} ` +
        `(${Buffer.byteLength(mine, 'utf8')} bytes here, ${Buffer.byteLength(shipped, 'utf8')} shipped)`,
    );
    bad = true;
  }
  const names = [...new Set(found.map((entry) => entry.folder))];
  if (why === null && names.length > 1) {
    const where = found.map((entry) => `${slotName(entry.slot)} (line ${entry.slot.line}) names ${entry.folder}/`);
    detail.push(`${relative}: ${where.join(' and ')}; they must name the same folder`);
    why = `${relative} names two different folders`;
    bad = true;
  }
  const folder = why === null ? (names[0] ?? null) : null;
  if (!bad) {
    const except: string[] = [];
    if (folder !== SHIPPED_POLICY_FOLDER) {
      except.push(
        `its policy folder, ${folder ?? ''}/ (${found.map((entry) => `line ${entry.slot.line}`).join(', ')})`,
      );
    }
    if (declaration !== null && declared !== null && declared !== declaration.shipped) {
      except.push(`NO_EXAMPLE_PROPOSALS, '${declared}' (line ${declaration.line})`);
    }
    detail.push(
      except.length === 0
        ? `${relative}: identical to the policy repository template's ${relative}`
        : `${relative}: identical to the policy repository template's ${relative} except ${except.join(' and ')}`,
    );
  }
  return { detail, bad, folder, why, declared };
}

/** RC-1, and the folder every later check reads (null when none was established). */
async function checkWorkflows(
  root: string,
): Promise<{ result: CheckResult; folder: string | null; why: string; declaresNone: boolean }> {
  const detail: string[] = [];
  let bad = 0;
  // The embed script halts on an empty workflow folder, so this is unreachable
  // from a build. It is here because the list is data, and RC-1 over an empty
  // list would report PASS having compared nothing.
  if (WORKFLOW_FILES.length === 0) {
    detail.push('no workflow is embedded, so nothing was compared');
    bad += 1;
  }
  const folders: { relative: string; folder: string }[] = [];
  let why: string | null = null;
  let declared: string | null = null;
  for (const relative of WORKFLOW_FILES) {
    const expected = TEMPLATE_FILES[relative];
    if (expected === undefined) {
      detail.push(`${relative}: not embedded, so nothing to compare against`);
      bad += 1;
      continue;
    }
    const bytes = await readBytes(join(root, relative));
    if (bytes === null) {
      detail.push(`${relative}: absent — the policy repository template ships it and this repository does not have it`);
      bad += 1;
      continue;
    }
    const reading = readWorkflow(relative, bytes.toString('utf8'), expected);
    detail.push(...reading.detail);
    if (reading.bad) bad += 1;
    if (reading.declared !== null) declared = reading.declared;
    if (reading.folder !== null) folders.push({ relative, folder: reading.folder });
    else why ??= reading.why ?? `${relative} names no policy folder`;
  }
  const distinct = [...new Set(folders.map((entry) => entry.folder))];
  if (why === null && distinct.length > 1) {
    detail.push(
      `the workflows name different policy folders: ` +
        `${folders.map((entry) => `${entry.relative} names ${entry.folder}/`).join(', ')}. ` +
        'All three must name the same one.',
    );
    why = 'the workflows name different policy folders';
    bad += 1;
  }
  if (why === null && distinct.length === 0) why = 'no workflow was there to name the policy folder';
  const folder = why === null ? (distinct[0] ?? null) : null;
  detail.unshift(
    folder === null
      ? `policy folder: not established, because ${why ?? 'no workflow named one'}`
      : folder === SHIPPED_POLICY_FOLDER
        ? `policy folder: ${folder}/, the shipped value, unchanged`
        : `policy folder: ${folder}/ (shipped as ${SHIPPED_POLICY_FOLDER}/), named the same way in every workflow`,
    declared === null
      ? `example proposals: NO_EXAMPLE_PROPOSALS in ${NO_EXAMPLES_SLOT.file} was not read, so examples are ` +
          `graded as the workflow grades them when it is '${NO_EXAMPLES_SLOT.shipped}'`
      : declared === NO_EXAMPLES_SLOT.shipped
        ? `example proposals: NO_EXAMPLE_PROPOSALS is '${declared}', the shipped value, unchanged (${declaredWords(declared)})`
        : `example proposals: NO_EXAMPLE_PROPOSALS is '${declared}': ${declaredWords(declared)}`,
  );
  return {
    result: {
      id: 'RC-1',
      title: 'the workflows are the ones ZIFFER shipped, byte for byte except the values their headers let you set',
      status: bad === 0 ? 'PASS' : 'FAIL',
      detail,
      fix:
        'Copy each file named above back from the template, then set again the values the headers let ' +
        'you edit: the policy folder (POLICY_DIR, and in policy-validate.yml and publish-policy.yml the ' +
        'paths: filter beside it, all naming the same folder) and, in policy-validate.yml, ' +
        "NO_EXAMPLE_PROPOSALS ('true' only if you have no example proposals).",
    },
    folder,
    why: why ?? '',
    declaresNone: declared === NO_EXAMPLES_SLOT.none,
  };
}

/** What a check that needs the policy folder says when RC-1 found none. */
function withoutFolder(id: string, title: string, why: string): CheckResult {
  return {
    id,
    title,
    status: 'NOT CHECKED',
    detail: [`RC-1 did not establish the policy folder (${why}), so there is no folder to read.`],
    fix: 'Fix what RC-1 names first, then run this check again.',
  };
}

const MEMBERS_TITLE = 'every member the bundle is signed over is present';

async function checkMembers(root: string, folder: string): Promise<CheckResult> {
  const missing: string[] = [];
  for (const member of POLICY_MEMBERS) {
    const bytes = await readBytes(join(root, folder, member));
    if (bytes === null) missing.push(member);
  }
  const detail = [
    `${POLICY_MEMBERS.length - missing.length} of ${POLICY_MEMBERS.length} bundle members present under ${folder}/`,
  ];
  if (missing.length > 0) detail.push(`missing: ${missing.join(', ')}`);
  return {
    id: 'RC-2',
    title: MEMBERS_TITLE,
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail,
    fix:
      `Restore each missing file from the ${SHIPPED_POLICY_FOLDER}/ folder of the policy repository template you received ` +
      `into ${folder}/ and put your own rules in it.`,
  };
}

const CLI_TITLE = 'the bundle and every example are read by the CLI that grades them';

async function checkCli(
  root: string,
  folder: string,
  runner: CliRunner,
  now: string,
  declaresNone: boolean,
): Promise<CheckResult> {
  const examples = await listExamples(root, folder);
  const policyDir = `${folder}/`;
  const argvs: readonly (readonly string[])[] = [
    [CLI, 'list', policyDir],
    ...examples.map((example) => [CLI, 'decide', policyDir, '--unsigned', '--now', now, '--proposal', example]),
  ];

  const detail: string[] = [];
  let failed = 0;
  for (const argv of argvs) {
    const outcome = await runner(root, argv);
    if (!outcome.ran) {
      return {
        id: 'RC-3',
        title: CLI_TITLE,
        status: 'NOT CHECKED',
        detail: [
          `${CLI} is not on PATH, so nothing here was parsed or graded.`,
          'This check runs the two commands your own pull-request workflow runs — ' +
            `\`${CLI} list ${policyDir}\` and \`${CLI} decide ${policyDir} --unsigned --now <RFC3339> ` +
            '--proposal <file>` — because the rules have one implementation and this tool is not ' +
            'going to be a second one.',
        ],
        fix: `Install the CLI (${INSTALL_CHAPTER}) and run this check again.`,
      };
    }
    const label = argv.slice(1).join(' ');
    if (outcome.code === 0) {
      detail.push(`${CLI} ${label}: ok`);
    } else {
      failed += 1;
      detail.push(`${CLI} ${label}: exit ${outcome.code} — ${firstLine(outcome.output)}`);
    }
  }
  // No examples: what the validate workflow does, and nothing kinder. It
  // FAILS as NoExampleProposals unless the repository declares it has none,
  // and then it passes with a NOT CHECKED line; a PASS here would read as
  // "graded" about a job that graded nothing.
  let status: CheckStatus = failed === 0 ? 'PASS' : 'FAIL';
  if (examples.length === 0) {
    if (declaresNone) {
      detail.push(
        `${examplesDir(folder)}/ holds no proposals and this repository declares it has none ` +
          `(NO_EXAMPLE_PROPOSALS: '${NO_EXAMPLES_SLOT.none}'), so nothing was graded.`,
      );
      if (status === 'PASS') status = 'NOT CHECKED';
    } else {
      detail.push(
        `NoExampleProposals: ${examplesDir(folder)}/ holds no *.json proposal, so your validate workflow ` +
          'fails and nothing was graded.',
      );
      status = 'FAIL';
    }
  }
  return {
    id: 'RC-3',
    title: CLI_TITLE,
    status,
    detail,
    fix:
      'Read the clause the CLI named; it is the same one the gateway would answer with. ' +
      'The policy-by-example guide, https://ziffer.io/docs/policy/by-example, walks every file line by line.',
  };
}

function firstLine(output: string): string {
  const line = output.split('\n').find((candidate) => candidate.trim() !== '');
  return line === undefined ? '(no output)' : line.trim();
}

async function listExamples(root: string, folder: string): Promise<readonly string[]> {
  const dir = examplesDir(folder);
  try {
    const entries = await readdir(join(root, dir));
    return entries
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
}

const PROVISIONED_TITLE = "the three files we provision are no longer the demonstration tenant's";

/** A provisioned file's path in the customer's repository: the template's
 * path, with the shipped policy folder replaced by the one RC-1 found. */
function inFolder(relative: string, folder: string): string {
  const shipped = `${SHIPPED_POLICY_FOLDER}/`;
  return relative.startsWith(shipped) ? `${folder}/${relative.slice(shipped.length)}` : relative;
}

async function checkProvisioned(root: string, folder: string): Promise<CheckResult> {
  const detail: string[] = [];
  let stale = 0;
  let absent = 0;
  for (const relative of PROVISIONED_FILES) {
    const expected = TEMPLATE_FILES[relative];
    const here = inFolder(relative, folder);
    if (expected === undefined) {
      detail.push(`${here}: not embedded, so nothing to compare against`);
      continue;
    }
    const bytes = await readBytes(join(root, here));
    if (bytes === null) {
      detail.push(`${here}: absent — the bundle is signed over it`);
      absent += 1;
      continue;
    }
    if (bytes.equals(Buffer.from(expected, 'utf8'))) {
      detail.push(`${here}: STILL the demonstration tenant's copy, byte for byte`);
      stale += 1;
    } else {
      detail.push(`${here}: yours (it differs from the template's copy)`);
    }
  }
  return {
    id: 'RC-4',
    title: PROVISIONED_TITLE,
    status: stale + absent === 0 ? 'PASS' : 'FAIL',
    detail,
    fix:
      'Overwrite all three with the files on your onboarding sheet. A bundle still carrying ' +
      'the demonstration copies is refused by name (BundleReceiptIdentityMismatch). This check ' +
      'compares bytes: it cannot tell you the ones you have are the right ones, only that they ' +
      'are not ours.',
  };
}

const EXAMPLES_TITLE = 'one proposal in examples/ for every action your rules grade';

async function checkExamples(root: string, folder: string, declaresNone: boolean): Promise<CheckResult> {
  const riskPath = `${folder}/risk_functions.json`;
  const risk = await readJson(join(root, riskPath));
  if (!('value' in risk)) {
    return {
      id: 'RC-5',
      title: EXAMPLES_TITLE,
      status: 'FAIL',
      detail: [`${riskPath}: ${risk.error}`],
      fix: `Restore ${riskPath}; it is the file that names the actions.`,
    };
  }
  const functions = field(risk.value, 'risk_functions');
  if (!Array.isArray(functions)) {
    return {
      id: 'RC-5',
      title: EXAMPLES_TITLE,
      status: 'FAIL',
      detail: [`${riskPath} has no risk_functions array`],
      fix: `Restore ${riskPath}; it is the file that names the actions.`,
    };
  }
  const actions: string[] = [];
  for (const entry of functions) {
    const name = stringField(entry, 'applies_to');
    if (name !== null && !actions.includes(name)) actions.push(name);
  }

  const examples = await listExamples(root, folder);
  if (examples.length === 0) {
    return declaresNone
      ? {
          id: 'RC-5',
          title: EXAMPLES_TITLE,
          status: 'NOT CHECKED',
          detail: [
            `${examplesDir(folder)}/ holds no proposals, and this repository declares it has none ` +
              `(NO_EXAMPLE_PROPOSALS: '${NO_EXAMPLES_SLOT.none}'). None of the ${actions.length} actions in ` +
              'risk_functions.json is graded before a merge.',
          ],
          fix:
            `Add one proposal per action to ${examplesDir(folder)}/ and set NO_EXAMPLE_PROPOSALS back to ` +
            `'${NO_EXAMPLES_SLOT.shipped}': until then a rule change is reviewed without seeing what it decides.`,
        }
      : {
          id: 'RC-5',
          title: EXAMPLES_TITLE,
          status: 'FAIL',
          detail: [
            `NoExampleProposals: ${examplesDir(folder)}/ holds no *.json proposal, so your validate workflow ` +
              `fails; ${actions.length} actions in risk_functions.json have none.`,
          ],
          fix:
            `Add one proposal per action to ${examplesDir(folder)}/. If you genuinely have none, set ` +
            `NO_EXAMPLE_PROPOSALS: '${NO_EXAMPLES_SLOT.none}' in ${NO_EXAMPLES_SLOT.file}'s env: block.`,
        };
  }
  const covered = new Map<string, string>();
  const ungraded: string[] = [];
  for (const example of examples) {
    const parsed = await readJson(join(root, example));
    if (!('value' in parsed)) {
      ungraded.push(`${example}: ${parsed.error}`);
      continue;
    }
    const task = stringField(field(parsed.value, 'payload'), 'task_type');
    if (task === null) {
      ungraded.push(`${example}: payload.task_type is not a string`);
      continue;
    }
    if (!actions.includes(task)) {
      ungraded.push(`${example}: task_type ${JSON.stringify(task)} has no risk function (refused at 8.4-3)`);
      continue;
    }
    if (!covered.has(task)) covered.set(task, example);
  }

  const uncovered = actions.filter((action) => !covered.has(action));
  const detail = [
    `${actions.length} actions in risk_functions.json, ${covered.size} of them with a proposal in ${examplesDir(folder)}/`,
  ];
  for (const [action, example] of covered) detail.push(`${action}: ${example}`);
  for (const action of uncovered) detail.push(`${action}: NO proposal`);
  for (const problem of ungraded) detail.push(problem);

  return {
    id: 'RC-5',
    title: EXAMPLES_TITLE,
    status: uncovered.length === 0 && ungraded.length === 0 ? 'PASS' : 'FAIL',
    detail,
    fix:
      `Add one proposal per uncovered action to ${examplesDir(folder)}/. Your validate workflow grades ` +
      'every file there against the rules in the pull request, so an action with no example is ' +
      'an action whose grading changes without review.',
  };
}

async function checkSigningKey(root: string): Promise<CheckResult> {
  const detail: string[] = [];
  let bad = 0;

  const pub = await readBytes(join(root, PUBLIC_KEY_NAME));
  if (pub === null) {
    detail.push(`${PUBLIC_KEY_NAME}: absent — the publish job diffs it against the key it signs with`);
    bad += 1;
  } else {
    detail.push(`${PUBLIC_KEY_NAME}: committed`);
  }

  const ignoreText = await readText(join(root, '.gitignore'));
  if (ignoreText === null) {
    detail.push('.gitignore: absent, so nothing stops the private key being committed');
    bad += 1;
  } else {
    const mine = ignorePatterns(ignoreText);
    const template = ignorePatterns(TEMPLATE_FILES['.gitignore'] ?? '');
    const dropped = template.filter((pattern) => !mine.includes(pattern));
    if (dropped.length > 0) {
      detail.push(`.gitignore: dropped the template's patterns ${dropped.join(', ')}`);
      bad += 1;
    }
    const unreadable: string[] = [];
    const ignoring: string[] = [];
    const unignoring: string[] = [];
    for (const pattern of mine) {
      const matched = ignoreMatches(pattern, PRIVATE_KEY_NAME);
      if (matched === null) unreadable.push(pattern);
      else if (matched && pattern.startsWith('!')) unignoring.push(pattern);
      else if (matched) ignoring.push(pattern);
    }
    if (ignoring.length === 0 || unignoring.length > 0) {
      detail.push(
        `.gitignore: nothing in it excludes ${PRIVATE_KEY_NAME}` +
          (unignoring.length > 0 ? `, and ${unignoring.join(', ')} un-excludes it` : ''),
      );
      bad += 1;
    } else {
      detail.push(`.gitignore: ${ignoring.join(', ')} excludes ${PRIVATE_KEY_NAME}`);
    }
    if (unreadable.length > 0) {
      detail.push(`.gitignore: not read by this check (only * is understood here): ${unreadable.join(', ')}`);
    }
  }

  const leaked = await readBytes(join(root, PRIVATE_KEY_NAME));
  if (leaked !== null) {
    detail.push(`${PRIVATE_KEY_NAME}: PRESENT IN THE REPOSITORY. It belongs at ${PRIVATE_KEY_HOME} and nowhere else.`);
    bad += 1;
  }

  return {
    id: 'RC-6',
    title: 'the public half is committed and the private half cannot be',
    status: bad === 0 ? 'PASS' : 'FAIL',
    detail,
    fix:
      `Run bin/new-signing-key.sh — it writes the private key to ${PRIVATE_KEY_HOME} and ` +
      `${PUBLIC_KEY_NAME} here — then commit ${PUBLIC_KEY_NAME} and put the private key's text ` +
      'into the repository secret POLICY_SIGNING_KEY.',
  };
}

const PEOPLE_TITLE = 'manifest.json names two different people';

async function checkAuthorReviewer(root: string, folder: string): Promise<CheckResult> {
  const manifestPath = `${folder}/manifest.json`;
  const parsed = await readJson(join(root, manifestPath));
  if (!('value' in parsed)) {
    return {
      id: 'RC-7',
      title: PEOPLE_TITLE,
      status: 'FAIL',
      detail: [`${manifestPath}: ${parsed.error}`],
      fix: `Restore ${manifestPath} from the template and put your own tenant and people in it.`,
    };
  }
  const author = stringField(field(parsed.value, 'author'), 'id');
  const reviewer = stringField(field(parsed.value, 'reviewer'), 'id');
  if (author === null || reviewer === null) {
    return {
      id: 'RC-7',
      title: PEOPLE_TITLE,
      status: 'FAIL',
      detail: [
        `author.id is ${author === null ? 'absent or not a string' : JSON.stringify(author)}, ` +
          `reviewer.id is ${reviewer === null ? 'absent or not a string' : JSON.stringify(reviewer)}`,
      ],
      fix: 'Give manifest.json an author.id and a reviewer.id; `ziffer sign` refuses before it signs without them.',
    };
  }
  const same = author === reviewer;
  return {
    id: 'RC-7',
    title: PEOPLE_TITLE,
    status: same ? 'FAIL' : 'PASS',
    detail: [`author.id ${JSON.stringify(author)}, reviewer.id ${JSON.stringify(reviewer)}`],
    fix: same
      ? 'Two-person review of policy is a rule here, not a convention: `ziffer sign` refuses ' +
        'AuthorIsReviewer before it writes anything. Put the person who reviewed the pull request in reviewer.id.'
      : 'Nothing to do. Note what this cannot see: that the two identifiers belong to two people.',
  };
}

function checkBranchProtection(): CheckResult {
  // NOT CHECKED by construction and not by accident. Reading a branch
  // protection rule needs a GitHub token with repository administration, and
  // this server holds no credential and opens no connection. The honest thing
  // is to print the settings and say who has to look.
  //
  // The settings themselves are SLICED out of the template's own README rather
  // than listed here. The customer reads that file in their own repository; a
  // second list in this package would be the copy that goes stale, and the
  // person on the wrong side of the difference is the one whose main branch
  // takes a direct push.
  return {
    id: 'RC-8',
    title: 'branch protection on main — you confirm this one',
    status: 'NOT CHECKED',
    detail: [
      'No token, no API call, no network: this tool cannot see a branch protection rule and will not pretend to.',
      '',
      repoGuideSpan('branch-protection'),
    ],
    fix: 'Open Settings -> Branches in your repository and confirm each row above.',
  };
}

// ------------------------------------------------------------------- the tool

/** Every check, in report order. */
export async function checkPolicyRepo(
  root: string,
  runner: CliRunner = execFileRunner,
  at: Date = new Date(),
): Promise<readonly CheckResult[]> {
  const { result: workflows, folder, why, declaresNone } = await checkWorkflows(root);
  // Every check below that reads the bundle reads the folder RC-1 FOUND, never
  // a typed `policy/`; without one they say so rather than guess.
  return [
    workflows,
    folder === null ? withoutFolder('RC-2', MEMBERS_TITLE, why) : await checkMembers(root, folder),
    folder === null ? withoutFolder('RC-3', CLI_TITLE, why) : await checkCli(root, folder, runner, ciNow(at), declaresNone),
    folder === null ? withoutFolder('RC-4', PROVISIONED_TITLE, why) : await checkProvisioned(root, folder),
    folder === null ? withoutFolder('RC-5', EXAMPLES_TITLE, why) : await checkExamples(root, folder, declaresNone),
    await checkSigningKey(root),
    folder === null ? withoutFolder('RC-7', PEOPLE_TITLE, why) : await checkAuthorReviewer(root, folder),
    checkBranchProtection(),
  ];
}

/** The report, as an agent reads it. */
export function formatChecks(root: string, results: readonly CheckResult[]): string {
  const lines: string[] = [`check_policy_repo ${root}`, ''];
  for (const result of results) {
    lines.push(`${result.status.padEnd(11)} ${result.id}  ${result.title}`);
    // Split on embedded newlines: RC-8's detail is a whole slice of the
    // README, and indenting only its first line would leave the rest sitting
    // at column zero looking like a new check.
    for (const detail of result.detail) {
      for (const line of detail.split('\n')) lines.push(line.trim() === '' ? '' : `    ${line}`);
    }
    lines.push(`    fix: ${result.fix}`);
    lines.push('');
  }
  const count = (status: CheckStatus): number => results.filter((r) => r.status === status).length;
  lines.push(
    `${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('NOT CHECKED')} NOT CHECKED.`,
    'A FAIL is this tool having looked and found something, not a tool error. NOT CHECKED is',
    'this tool saying it could not look, and it never means the same thing as PASS.',
  );
  return lines.join('\n');
}

/**
 * `check_policy_repo`, as `server.ts` calls it.
 *
 * The only refusal is a path that is not a readable directory, because that is
 * the only case in which nothing was checked. Every other outcome is a report.
 */
export async function checkPolicyRepoTool(
  root: string,
  runner: CliRunner = execFileRunner,
  at: Date = new Date(),
): Promise<ToolOutcome> {
  const path = root.trim();
  if (path === '') {
    return {
      text: 'RepoPathUnnamed: pass the path to a clone of your policy repository; this tool reads it where it is.',
      isError: true,
    };
  }
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return { text: `RepoPathNotADirectory: ${path} is not a directory.`, isError: true };
    }
  } catch (error) {
    return {
      text: `RepoPathUnreadable: ${path}: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
  return { text: formatChecks(path, await checkPolicyRepo(path, runner, at)), isError: false };
}
