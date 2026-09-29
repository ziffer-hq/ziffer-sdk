/**
 * `explain_policy` — read a policy tree and say, in a sentence per action, what
 * it actually does (ACP-391).
 *
 * # Every verdict here is the grader's, and that is the whole design
 *
 * The obvious implementation of this tool is a reader over `risk_functions.json`
 * that prints the `base` beside each `applies_to`. It would be shorter, it would
 * need no binary, and it would be WRONG the first time a `raise_to` clause
 * fired — because the grade a deployment applies is the §8.4 fold over the
 * proposal, the floors and the expression language, not the base in the file.
 * Worse than wrong: it would be a second definition of the rules, and the first
 * disagreement between it and the engine is found by a customer whose agent was
 * told the wrong answer.
 *
 * So this module runs `ziffer decide --unsigned` once per row and reads the
 * verdict line. What it reads out of the tree's JSON itself is deliberately
 * limited to things that are NOT verdicts:
 *
 *   * the ACTION NAMES, out of `risk_functions.json`'s `applies_to` — the same
 *     read `check_policy_repo`'s RC-5 already makes, and a name is not a grade;
 *   * the TARGET NAMES `floors.json` declares, and the target names the tree's
 *     own examples mention, for the name diff below;
 *   * `quorum_k` out of `attesters/registry.json`, quoted as the declared
 *     number it is.
 *
 * # The tier column, and why it says NOT CHECKED
 *
 * "Which targets are missing from `floors.json` and are therefore graded at the
 * highest tier" is two claims. The first is a name diff and this tool makes it.
 * The second is the document's fail-safe rule — an unclassified resource reads
 * `T3` — and the honest position is that this tool did not see it happen: the
 * CLI prints `task_type`, `risk`, `reversibility` and `notice`, and no tier. So
 * the tool ASKS, once, with a proposal naming a target nothing declares, and
 * reports what came back. If a future CLI names the tier, the probe finds it and
 * the column stops saying NOT CHECKED; until then the column says it, because
 * NOT CHECKED never means the same thing as "confirmed".
 *
 * # Synthetic rows are labelled
 *
 * An action your rules name but `examples/` has no proposal for still gets a
 * row, graded from a proposal built out of one of your own examples with
 * `payload.task_type` swapped. Its targets and parameters are that example's —
 * so its grade can differ from the grade the same action gets on a proposal you
 * would really send, and every such row says `synthetic` and names the file it
 * came from. A row that quietly mixed the two would be the worst line in the
 * report.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  cliAbsentText,
  gradeProposal,
  indent,
  resolveTree,
  TreeError,
  unsignedLine,
  UNSIGNED_NOTE,
  type Graded,
  type Tree,
} from './decide.js';
import { CLI, execFileRunner, type CliRunner } from './repo-check.js';
import type { ToolOutcome } from './tools.js';

// ------------------------------------------------------------- reading names

/** One field of a value that may not be an object at all, narrowed with
 * `typeof` and never a cast: the input is a customer's file
 * (`repo-check.ts::field`, the same reader for the same reason). */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const record: Record<string, unknown> = { ...value };
  return record[key];
}

async function readJson(path: string): Promise<unknown> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return value;
  } catch {
    return undefined;
  }
}

/** The action names, in the order the file declares them. Duplicates collapse:
 * two risk functions for one action is a bundle defect, and this tool's job is
 * to report what the grader says rather than to grade the file. */
function actionNames(risk: unknown): readonly string[] {
  const functions = field(risk, 'risk_functions');
  if (!Array.isArray(functions)) return [];
  const out: string[] = [];
  for (const entry of functions) {
    const name = field(entry, 'applies_to');
    if (typeof name === 'string' && name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The targets `floors.json` declares, as `name -> declared tier`. The tier is
 * QUOTED, never computed: it is a value the customer wrote down, and printing
 * it back is not a second reading of the rules. */
function declaredFloors(floors: unknown): ReadonlyMap<string, string> {
  const table = field(floors, 'floors');
  const out = new Map<string, string>();
  if (typeof table !== 'object' || table === null) return out;
  const record: Record<string, unknown> = { ...table };
  for (const [name, tier] of Object.entries(record)) {
    if (typeof tier === 'string') out.set(name, tier);
  }
  return out;
}

/** The targets one proposal names, or none. */
function targetsOf(proposal: unknown): readonly string[] {
  const targets = field(field(proposal, 'payload'), 'targets');
  if (!Array.isArray(targets)) return [];
  return targets.filter((name): name is string => typeof name === 'string');
}

function taskTypeOf(proposal: unknown): string | null {
  const task = field(field(proposal, 'payload'), 'task_type');
  return typeof task === 'string' ? task : null;
}

/** `quorum_k`, or `null` when the registry does not declare one this reader can
 * read. `null` is printed as "not declared" rather than replaced by a number
 * this tool chose: a quorum invented in a report is the one number a reader
 * must never get from here. */
function quorumOf(registry: unknown): number | null {
  const k = field(registry, 'quorum_k');
  return typeof k === 'number' && Number.isInteger(k) ? k : null;
}

// ------------------------------------------------------------------- the rows

/** Where a graded row's proposal came from. */
interface Source {
  /** The path as the report prints it, relative to the tree. */
  readonly label: string;
  /** True when the proposal was built here rather than read from the tree. */
  readonly synthetic: boolean;
  /** For a synthetic row, the example its shape came from. */
  readonly from?: string;
}

interface Row {
  readonly action: string;
  readonly source: Source;
  readonly graded: Graded;
}

/** The four regimes, in the order the report prints them. `refused` first
 * would bury the working half of a tree under its broken half, and `held` last
 * would put the rows a reader most needs where they stop reading. */
type Regime = 'alone' | 'notice' | 'held' | 'refused' | 'unknown';

/**
 * Which regime a row is in, decided ONLY by what the CLI printed.
 *
 * `risk=HIGH` is the floor-HIGH path — the grader's own `notice_recipients`
 * returns nothing for it precisely because a floor-HIGH action goes to the
 * quorum and the door instead of to a notice. Below floor-HIGH the CLI's
 * `notice` field is the whole distinction: present means an irreversible action
 * whose recipients your bundle names, absent means nothing is owed. No file is
 * re-read to decide this and no rule is re-evaluated; it is a rendering of two
 * fields the grader printed.
 */
function regimeOf(graded: Graded): Regime {
  if (graded.kind === 'refused') return 'refused';
  if (graded.kind !== 'passed') return 'unknown';
  if (graded.risk === 'HIGH') return 'held';
  return graded.notice.length > 0 ? 'notice' : 'alone';
}

// -------------------------------------------------------------- the probe

/** A tier as the CLI would spell one, anywhere in its output. The column below
 * is NOT CHECKED unless this matches, and it is written as a search rather than
 * as a field name on purpose: the point is to find out whether the grader ever
 * says a tier out loud, not to parse a format it does not have. */
const TIER = /(?:^|[^A-Za-z0-9_])(T[0-3])(?:[^A-Za-z0-9_]|$)/;

/** The name the probe proposal targets. It must be one nothing declares, and it
 * says so in the report, so a reader who finds it in their own `floors.json`
 * knows exactly which row to distrust. */
const PROBE_TARGET = 'ziffer-mcp-probe-target-that-no-bundle-declares';

interface Probe {
  /** The tier the CLI named for a target nothing declares, if it named one. */
  readonly tier: string | null;
  /** What the CLI said, for the report's evidence line. */
  readonly said: string;
}

// ----------------------------------------------------------------- the report

/** Column widths, so the rows line up without a table library. A name longer
 * than the column pushes its row out rather than being truncated: a truncated
 * action name is a name an agent cannot grep for. */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function sourceLabel(source: Source): string {
  return source.synthetic ? `synthetic, shaped from ${source.from ?? '(unknown)'}` : source.label;
}

/**
 * Every example proposal in the tree, sorted, as `(label, parsed)`.
 *
 * `examples/` is where the validate workflow's glob points, so it is where a
 * customer's real proposals are and it is what this tool grades first.
 */
async function readExamples(bundleDir: string): Promise<readonly { label: string; value: unknown }[]> {
  let names: string[];
  try {
    names = await readdir(join(bundleDir, 'examples'));
  } catch {
    return [];
  }
  const out: { label: string; value: unknown }[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    out.push({ label: `examples/${name}`, value: await readJson(join(bundleDir, 'examples', name)) });
  }
  return out;
}

/** Build one synthetic proposal: the shape of a real example, with the action
 * swapped and nothing else touched. `schema_id` is deliberately left alone — it
 * names the FRONT DOOR that produces proposals, not the action, and inventing
 * one would be this tool registering an adapter the customer did not. */
function synthesise(shape: unknown, action: string): unknown {
  if (typeof shape !== 'object' || shape === null) return undefined;
  const root: Record<string, unknown> = { ...shape };
  const payload = root['payload'];
  if (typeof payload !== 'object' || payload === null) return undefined;
  const swapped: Record<string, unknown> = { ...payload, task_type: action };
  return { ...root, payload: swapped };
}

/** The probe proposal: the same shape, aimed at a target nothing declares. */
function probeProposal(shape: unknown, action: string): unknown {
  const built = synthesise(shape, action);
  if (typeof built !== 'object' || built === null) return undefined;
  const root: Record<string, unknown> = { ...built };
  const payload = root['payload'];
  if (typeof payload !== 'object' || payload === null) return undefined;
  const aimed: Record<string, unknown> = { ...payload, targets: [PROBE_TARGET] };
  return { ...root, payload: aimed };
}

/** What `explainPolicy` produced, so the tests can assert the STRUCTURE rather
 * than a regular expression over the prose. */
export interface Explained {
  readonly tree: Tree;
  readonly rows: readonly Row[];
  readonly declared: ReadonlyMap<string, string>;
  /** Targets named by the tree's own examples that `floors.json` does not
   * declare. */
  readonly undeclared: readonly string[];
  readonly quorumK: number | null;
  readonly probe: Probe | null;
  /** True when `ziffer` could not be started, so nothing was graded. */
  readonly cliAbsent: boolean;
}

/**
 * Grade every action, diff every target, probe the tier once.
 *
 * Exported beside the tool for `repo-check.ts`'s reason: the report's text is
 * one function over this value, so a test can assert what was FOUND without
 * asserting how it is spelled.
 */
export async function explainPolicy(
  path: string,
  runner: CliRunner = execFileRunner,
  at: Date = new Date(),
): Promise<Explained> {
  const tree = await resolveTree(path);
  const risk = await readJson(join(tree.bundleDir, 'risk_functions.json'));
  const actions = actionNames(risk);
  const declared = declaredFloors(await readJson(join(tree.bundleDir, 'floors.json')));
  const quorumK = quorumOf(await readJson(join(tree.bundleDir, 'attesters', 'registry.json')));
  const examples = await readExamples(tree.bundleDir);

  const rows: Row[] = [];
  let cliAbsent = false;
  const covered = new Set<string>();
  for (const example of examples) {
    const action = taskTypeOf(example.value);
    const graded = await gradeProposal(tree.bundleDir, example.value, runner, at);
    if (graded.kind === 'absent') cliAbsent = true;
    if (action !== null) covered.add(action);
    rows.push({
      action: action ?? example.label,
      source: { label: example.label, synthetic: false },
      graded,
    });
  }

  // The shape a synthetic row borrows: the first example, sorted, so two runs
  // of this tool over one tree pick the same one. A tree with no examples gets
  // no synthetic rows at all and the report says why — inventing a whole
  // proposal here would be this tool deciding what a customer's front door
  // sends.
  const shape = examples[0]?.value;
  for (const action of actions) {
    if (covered.has(action)) continue;
    const built = shape === undefined ? undefined : synthesise(shape, action);
    if (built === undefined) {
      rows.push({
        action,
        source: { label: '(no proposal)', synthetic: true },
        graded: { kind: 'unreadable', output: 'no example in this tree to shape a proposal from' },
      });
      continue;
    }
    const graded = await gradeProposal(tree.bundleDir, built, runner, at);
    if (graded.kind === 'absent') cliAbsent = true;
    rows.push({
      action,
      source: { label: '(synthetic)', synthetic: true, from: examples[0]?.label ?? '(unknown)' },
      graded,
    });
  }

  const named = new Set<string>();
  for (const example of examples) for (const target of targetsOf(example.value)) named.add(target);
  const undeclared = [...named].filter((target) => !declared.has(target)).sort();

  let probe: Probe | null = null;
  const probeAction = actions[0];
  if (shape !== undefined && probeAction !== undefined && !cliAbsent) {
    const built = probeProposal(shape, probeAction);
    if (built !== undefined) {
      const graded = await gradeProposal(tree.bundleDir, built, runner, at);
      if (graded.kind === 'absent') {
        cliAbsent = true;
      } else {
        const found = TIER.exec(graded.output);
        probe = { tier: found === null ? null : (found[1] ?? null), said: graded.output };
      }
    }
  }

  return { tree, rows, declared, undeclared, quorumK, probe, cliAbsent };
}

const HEADINGS: Readonly<Record<Regime, string>> = {
  alone: 'RUNS ALONE — nothing is held and nobody is told',
  notice: 'RUNS, AND SOMEBODY IS TOLD — irreversible below floor-HIGH, so a notice is owed',
  held: 'HELD FOR APPROVAL — floor-HIGH, so it waits for a quorum before it may release',
  refused: 'REFUSED BEFORE IT RUNS — your rules answer no, and name the clause',
  unknown: 'NO VERDICT — the grader did not reach one for these',
};

const ORDER: readonly Regime[] = ['alone', 'notice', 'held', 'refused', 'unknown'];

/** One row's line, under its regime heading. */
function rowLines(row: Row, quorumK: number | null): readonly string[] {
  const head = `  ${pad(row.action, 26)} ${sourceLabel(row.source)}`;
  const graded = row.graded;
  if (graded.kind === 'passed') {
    const out = [
      head,
      `      risk ${graded.risk}, ${graded.reversibility}` +
        (graded.notice.length > 0 ? `, told: ${graded.notice.join(', ')}` : ''),
    ];
    if (graded.risk === 'HIGH') {
      out.push(
        `      ${
          quorumK === null
            ? 'attesters/registry.json declares no quorum_k this tool could read'
            : `${quorumK} distinct attesters must sign it, and never whoever proposed it`
        }` +
          (graded.reversibility === 'IRREVERSIBLE'
            ? '; it is irreversible, so releasing it needs a positive confirmation and silence refuses'
            : ''),
      );
    }
    return out;
  }
  if (graded.kind === 'refused') {
    return [head, `      ${graded.clause} — ${graded.message}`];
  }
  if (graded.kind === 'unreadable') {
    return [head, `      ${graded.output.split('\n').filter((l) => l.trim() !== '').pop() ?? '(no output)'}`];
  }
  return [head, '      NOT CHECKED: the CLI could not be started'];
}

/** The report, as an agent reads it. */
export function formatExplained(found: Explained): string {
  const lines: string[] = [`explain_policy ${found.tree.spelled}`, ''];

  if (found.cliAbsent) {
    lines.push(cliAbsentText(), '');
  }

  const said = found.rows
    .map((row) => (row.graded.kind === 'absent' ? null : unsignedLine(row.graded.output)))
    .find((line): line is string => line !== null);
  lines.push(
    `Every verdict below came out of one \`${CLI} decide --unsigned\` run. Nothing here re-reads`,
    'your risk functions to work out a grade: a second reading of the rules would be a second',
    'definition of them.',
  );
  if (said !== undefined) lines.push('', `The CLI said, on every run: ${said}`);
  lines.push('');

  for (const regime of ORDER) {
    const rows = found.rows.filter((row) => regimeOf(row.graded) === regime);
    if (rows.length === 0) continue;
    lines.push(HEADINGS[regime]);
    for (const row of rows) lines.push(...rowLines(row, found.quorumK));
    lines.push('');
  }

  lines.push('TARGETS');
  const declaredNames = [...found.declared.keys()].sort();
  if (declaredNames.length === 0) {
    lines.push('  floors.json declares no targets this tool could read.');
  }
  for (const name of declaredNames) {
    lines.push(`  ${pad(name, 26)} ${found.declared.get(name) ?? ''}   declared in floors.json`);
  }
  if (found.undeclared.length === 0) {
    lines.push('', '  Every target your examples name is declared.');
  } else {
    lines.push(
      '',
      '  ABSENT FROM floors.json — graded at the highest tier',
    );
    for (const name of found.undeclared) {
      lines.push(`  ${pad(name, 26)} NOT CHECKED   named by an example, declared by nothing`);
    }
    lines.push(
      '',
      '  An unclassified resource reads as the highest tier, which is the fail-safe direction and',
      '  raises anything your rules grade on the tier. This tool did not watch that happen, and',
      '  says NOT CHECKED rather than printing a tier it worked out for itself.',
    );
  }

  lines.push('');
  if (found.probe === null) {
    lines.push(
      `  The tier probe did not run: it needs \`${CLI}\`, one action and one example to shape a`,
      '  proposal from.',
    );
  } else if (found.probe.tier === null) {
    lines.push(
      `  Asked directly — one proposal aimed at "${PROBE_TARGET}", which nothing declares — the`,
      '  CLI named no tier at all. That is why an absent target\'s tier is reported as NOT CHECKED',
      '  rather than as the highest one: the grader prints the risk, the reversibility and the',
      '  notice, and never the tier it used.',
      '  It answered:',
      '',
      indent(found.probe.said),
    );
  } else {
    lines.push(
      `  Asked directly — one proposal aimed at "${PROBE_TARGET}", which nothing declares — the`,
      `  CLI named ${found.probe.tier}. It answered:`,
      '',
      indent(found.probe.said),
    );
  }

  lines.push('', UNSIGNED_NOTE);
  return lines.join('\n');
}

/**
 * `explain_policy`, as `server.ts` calls it.
 *
 * The only refusal is a path that is not a policy tree, because that is the
 * only case in which nothing was read. Everything else is a report — including
 * a tree every one of whose examples is refused, which is this tool having
 * looked and found something rather than a tool error (`repo-check.ts`'s rule,
 * and `tools.ts`'s about a `DENY`).
 */
export async function explainPolicyTool(
  path: string,
  runner: CliRunner = execFileRunner,
  at: Date = new Date(),
): Promise<ToolOutcome> {
  try {
    return { text: formatExplained(await explainPolicy(path, runner, at)), isError: false };
  } catch (error) {
    if (error instanceof TreeError) return { text: error.message, isError: true };
    throw error;
  }
}
