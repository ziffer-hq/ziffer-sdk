/**
 * The grader, reached exactly the way the customer's own pull request reaches
 * it (ACP-391): `ziffer decide --unsigned`, through `execFile` and never a
 * shell.
 *
 * # Why there is no grading in this file
 *
 * `repo-check.ts` states the rule and this module is the place it costs
 * something: it would be a short afternoon's work to read `risk_functions.json`
 * here, walk the `raise_to` clauses and print a risk level, and the result
 * would be a SECOND DEFINITION OF THE RULES — one the gateway does not run, one
 * the publish job does not check, and one whose first disagreement with the
 * engine is discovered by a customer whose agent was told the wrong answer. So
 * every verdict in this package comes out of the binary, and when the binary is
 * absent the answer is NOT CHECKED naming it. There is no fallback path, and a
 * fallback path is the thing to refuse when it is proposed.
 *
 * # What the CLI is handed, and what it is not
 *
 * `--unsigned`, always. A draft policy tree in a pull request has no current
 * signature — signing happens later, in the job that holds the key — so the
 * verified path would refuse before it graded anything. The CLI's own first
 * line says so on every run and this module carries that line through rather
 * than stripping it: an agent reading `PASSED` with the sentence removed would
 * read "this bundle verifies", which is not what was checked.
 *
 * `--now` is required by the CLI and is passed the same `ciNow` spelling both
 * customer workflows pass, from `repo-check.ts`, because "the same invocation"
 * has to mean the same argument vector and not one that looks like it. On the
 * unsigned path the instant is parsed and then read by nothing, which is the
 * CLI's own disclosure.
 *
 * # The one thing written to the machine
 *
 * A proposal has to be a FILE, because `--proposal` takes a path. It is written
 * into a fresh `mkdtemp` directory and that directory is removed in a `finally`.
 * Nothing else in this package writes anything, and nothing here ever writes
 * inside the tree it was pointed at: a tool that "helpfully" dropped an example
 * into a customer's `policy/examples/` would be committing policy on their
 * behalf.
 */

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLI, ciNow, execFileRunner, type CliRunner } from './repo-check.js';
import type { ToolOutcome } from './tools.js';

/** Where `ziffer` is installed, for the NOT CHECKED line. Spelled once here and
 * once in `repo-check.ts`, which is one copy too many — but exporting it from
 * there would make this module import a constant it also imports a runner from,
 * and the value is a chapter reference rather than a rule. */
const INSTALL_CHAPTER = 'docs/onboarding/install.md section 1';

/** The CLI's first line in unsigned mode, as it prints it. Matched rather than
 * retyped into the output: this module reproduces the CLI's text and never
 * paraphrases it, so a change to that sentence reaches an agent unedited. */
const UNSIGNED_PREFIX = 'UNSIGNED:';

/** What one `ziffer decide --unsigned` run said.
 *
 * Four cases and no fifth. `unreadable` is the honest one: the CLI ran, exited
 * non-zero and said something this reader does not recognise as a verdict — a
 * bundle that would not walk, a proposal that is not JSON. It is NOT folded
 * into `refused`, because "your rules refused this action" and "this tool could
 * not get a verdict" are different sentences and only one of them is about
 * policy. */
export type Graded =
  | {
      readonly kind: 'passed';
      readonly taskType: string;
      readonly risk: string;
      readonly reversibility: string;
      /** The recipients the CLI named, or empty for its `<none owed>`. */
      readonly notice: readonly string[];
      readonly output: string;
    }
  | { readonly kind: 'refused'; readonly clause: string; readonly message: string; readonly output: string }
  | { readonly kind: 'unreadable'; readonly output: string }
  | { readonly kind: 'absent' };

/** The CLI's `<none owed>`, matched rather than guessed at from an empty
 * string: the field is always present and the two spellings mean different
 * things, so a reader that treated a missing value as "nobody" would report a
 * parse failure as a policy fact. */
const NONE_OWED = '<none owed>';

/**
 * Read one run's output into a {@link Graded}.
 *
 * Exported for the tests, which drive every branch through a stub runner —
 * including the ones a machine without `ziffer` cannot produce.
 */
export function parseVerdict(output: string): Graded {
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('PASSED\t')) {
      const fields = new Map<string, string>();
      for (const field of line.split('\t').slice(1)) {
        const at = field.indexOf('=');
        if (at > 0) fields.set(field.slice(0, at), field.slice(at + 1));
      }
      const taskType = fields.get('task_type');
      const risk = fields.get('risk');
      const reversibility = fields.get('reversibility');
      const notice = fields.get('notice');
      if (
        taskType === undefined ||
        risk === undefined ||
        reversibility === undefined ||
        notice === undefined
      ) {
        // A PASSED line missing one of its four fields is a CLI this reader
        // does not know, not a verdict with a hole in it.
        return { kind: 'unreadable', output };
      }
      return {
        kind: 'passed',
        taskType,
        risk,
        reversibility,
        notice: notice === NONE_OWED ? [] : notice.split(',').filter((who) => who !== ''),
        output,
      };
    }
    if (line.startsWith('REFUSED\t')) {
      return {
        kind: 'refused',
        clause: line.slice('REFUSED\t'.length).trim(),
        message: (lines[i + 1] ?? '').trim(),
        output,
      };
    }
  }
  // Exit 0 with no verdict line is as unreadable as exit 1 with none, and
  // that is why the exit CODE is not a parameter here: the value this module
  // returns is the CLI's ANSWER, and an exit code is not one. A reader keyed on
  // the code would call a `REFUSED` line a failure and a silent success a
  // verdict.
  return { kind: 'unreadable', output };
}

/**
 * The CLI's own unsigned disclaimer out of one run's output, or `null`.
 *
 * SLICED rather than retyped, for `repo-check.ts`'s RC-8 reason one artifact
 * over: a report that carried its own copy of that sentence would be the copy
 * that stops matching the binary, and the person on the wrong side of the
 * difference is the one reading `PASSED` as "this bundle verifies". A caller
 * that gets `null` says nothing rather than inventing the sentence.
 */
export function unsignedLine(output: string): string | null {
  return output.split('\n').find((line) => line.startsWith(UNSIGNED_PREFIX)) ?? null;
}

/**
 * Grade one proposal against one bundle directory.
 *
 * `bundleDir` is passed to the CLI as given — absolute, from {@link resolveTree}
 * — so the `cwd` the runner is handed decides nothing.
 */
export async function gradeProposal(
  bundleDir: string,
  proposal: unknown,
  runner: CliRunner = execFileRunner,
  at: Date = new Date(),
): Promise<Graded> {
  // `unknown`, not `string`: `JSON.stringify` is TYPED as returning `string`
  // and returns `undefined` for `undefined` and for a function. Annotated as
  // the type says, the guard below does not compile and the case reaches
  // `writeFile` as the four letters `undefined`. Widening and then narrowing
  // with `typeof` is the honest version of that; an `as` here would be this
  // package asserting a shape it just found out is wrong.
  let body: unknown;
  try {
    body = JSON.stringify(proposal, null, 2);
  } catch (error) {
    return {
      kind: 'unreadable',
      output: `the proposal could not be written as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (typeof body !== 'string') {
    // `JSON.stringify(undefined)` is `undefined`, not `"undefined"`. Writing
    // that to a file would hand the CLI the four letters and get back a parse
    // error naming a column, which is a confusing way to say "you passed no
    // proposal".
    return { kind: 'unreadable', output: 'the proposal is undefined: there is nothing to grade' };
  }

  const dir = await mkdtemp(join(tmpdir(), 'ziffer-mcp-'));
  try {
    const path = join(dir, 'proposal.json');
    await writeFile(path, body, 'utf8');
    const outcome = await runner(dir, [
      CLI,
      'decide',
      bundleDir,
      '--unsigned',
      '--now',
      ciNow(at),
      '--proposal',
      path,
    ]);
    if (!outcome.ran) return { kind: 'absent' };
    return parseVerdict(outcome.output);
  } finally {
    // The one directory this package creates, removed whatever happened. A
    // temp directory left behind per call is a tool that fills a developer's
    // disk in the background.
    await rm(dir, { recursive: true, force: true });
  }
}

/** What {@link resolveTree} found. `bundleDir` is the directory the CLI is
 * handed — the one holding `risk_functions.json` — and `spelled` is how it was
 * reached, so the report can say which of the two shapes the caller's path was
 * without the caller having to guess. */
export interface Tree {
  readonly bundleDir: string;
  readonly spelled: string;
}

/** Why a path is not a policy tree. The name leads, as every refusal in this
 * package does, because it is what an agent branches on. */
export class TreeError extends Error {
  override readonly name: string;

  constructor(name: string, detail: string) {
    super(`${name}: ${detail}`);
    this.name = name;
  }
}

/** The file that makes a directory a bundle: it is the one every other file
 * here is about, and the one `check_policy_repo` already reads to find the
 * actions. */
const RISK_FUNCTIONS = 'risk_functions.json';

/**
 * Find the bundle directory under a path a person typed.
 *
 * TWO SHAPES ACCEPTED, and the reason is not politeness. The template lays a
 * customer's repository out as `<repo>/policy/`, its workflows pass
 * `POLICY_DIR=policy/`, and `check_policy_repo` takes the repository ROOT — so
 * a model that has just used that tool has the root in hand, while a person
 * reading their own tree names the `policy/` directory. Refusing one of the two
 * would make the argument a trick question. Anything else is refused by name
 * rather than searched for: walking upward looking for a bundle is how a tool
 * ends up grading a directory the caller did not mean.
 *
 * @throws TreeError `PolicyPathUnreadable`, `PolicyPathNotADirectory`,
 * `PolicyTreeNotFound`.
 */
export async function resolveTree(path: string): Promise<Tree> {
  const root = path.trim();
  if (root === '') {
    throw new TreeError(
      'PolicyPathUnnamed',
      'pass the path to your policy tree — the directory holding risk_functions.json, or the repository root holding policy/.',
    );
  }
  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      throw new TreeError('PolicyPathNotADirectory', `${root} is not a directory.`);
    }
  } catch (error) {
    if (error instanceof TreeError) throw error;
    throw new TreeError(
      'PolicyPathUnreadable',
      `${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const shapes: readonly (readonly [string, string])[] = [
    [root, root],
    [join(root, 'policy'), `${root}/policy`],
  ];
  for (const [dir, spelled] of shapes) {
    try {
      const info = await stat(join(dir, RISK_FUNCTIONS));
      if (info.isFile()) return { bundleDir: dir, spelled };
    } catch {
      // Not this shape; try the next one, and refuse by name if neither holds.
    }
  }
  throw new TreeError(
    'PolicyTreeNotFound',
    `neither ${root}/${RISK_FUNCTIONS} nor ${root}/policy/${RISK_FUNCTIONS} exists, so there is no bundle here to grade against.`,
  );
}

/** The sentence every answer from this module carries about what `--unsigned`
 * did not do. The CLI says it once per run in its own words; this says what it
 * MEANS for the reader of a tool result, and the two are not the same sentence
 * pretending to be one. */
export const UNSIGNED_NOTE =
  'The signature was NOT checked, and neither was anything a bundle only acquires when it is\n' +
  'activated: expiry, the epoch high-water mark, the attester registry, the doors, the receipt\n' +
  'identity. A tree can read clean here and be refused at load by every reader in the deployment.\n' +
  'This is the POLICY half of the decision — what your rules say about this action — and it is the\n' +
  'half a draft has an answer for.';

/** The NOT CHECKED text when the binary is not on PATH. One place, because both
 * tools in this slice say it and a second spelling would be the one that stops
 * naming the right chapter. */
export function cliAbsentText(): string {
  return (
    `NOT CHECKED: \`${CLI}\` is not on PATH, so nothing was graded.\n` +
    `This tool does not grade anything itself — the rules have one implementation and a second one\n` +
    `here would disagree with the gateway on the day it mattered. Install the CLI (${INSTALL_CHAPTER})\n` +
    `and ask again.`
  );
}

/**
 * `simulate_decision` — one proposal, one draft tree, the verdict and the
 * clause.
 *
 * It is the thinnest possible tool: resolve the tree, write the proposal into a
 * temp directory, run the CLI, print what it said. The value is not the
 * formatting — it is that the answer comes from the SAME binary the customer's
 * validate workflow runs and the same fold the gateway runs, so an agent
 * authoring a rule finds out here what it will find out in production.
 *
 * A REFUSED verdict is not a tool error. The tool was asked to grade a proposal
 * and it graded one; `isError` is set only when nothing could be graded —
 * an unreadable path, or output no verdict could be read out of.
 */
export async function simulateDecision(
  path: string,
  proposal: unknown,
  runner: CliRunner = execFileRunner,
  at: Date = new Date(),
): Promise<ToolOutcome> {
  let tree: Tree;
  try {
    tree = await resolveTree(path);
  } catch (error) {
    if (error instanceof TreeError) return { text: error.message, isError: true };
    throw error;
  }

  const graded = await gradeProposal(tree.bundleDir, proposal, runner, at);
  const head = [`simulate_decision ${tree.spelled}`, ''];

  if (graded.kind === 'absent') {
    return { text: [...head, cliAbsentText()].join('\n'), isError: false };
  }
  if (graded.kind === 'unreadable') {
    return {
      text: [
        ...head,
        `NO VERDICT: \`${CLI} decide --unsigned\` ran and this is what it said. It is not a refusal`,
        'of your proposal — it is the grader not having reached one.',
        '',
        indent(graded.output),
      ].join('\n'),
      isError: true,
    };
  }

  const lines = [...head];
  if (graded.kind === 'passed') {
    lines.push(
      `PASSED   ${graded.taskType}`,
      `  risk           ${graded.risk}`,
      `  reversibility  ${graded.reversibility}`,
      `  who is told    ${graded.notice.length === 0 ? '<none owed>' : graded.notice.join(', ')}`,
      '',
      'PASSED means the §8.4 fold found nothing. It is not permission to act: no receipt was',
      'checked, no quorum was counted and the deferred-release door did not run.',
    );
  } else {
    lines.push(
      `REFUSED  ${graded.clause}`,
      `  ${graded.message}`,
      '',
      'The clause is the same name the gateway would answer with. Fix what it names rather than',
      're-running: a refusal here is deterministic.',
    );
  }
  lines.push('', UNSIGNED_NOTE, '', `What \`${CLI}\` itself printed:`, '', indent(graded.output));
  return { text: lines.join('\n'), isError: false };
}

/** The CLI's own output, indented so it cannot be mistaken for this tool's
 * prose. Empty lines stay empty rather than becoming four spaces. */
export function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `    ${line}`))
    .join('\n')
    .replace(/\n+$/, '');
}
