/**
 * How `scan` asks the scan package for ONE run (ACP-455): the tools the
 * developer's OWN application gives a model, each graded by the engine, and,
 * once the developer has confirmed, the installed MCP servers too, all under
 * ONE draft policy.
 *
 * # One adapter, pointed at the scan's one entry point
 *
 * {@link scanOnce} is the only place in this package that knows HOW the scan
 * package is asked to scan. It runs the scan's own command line in process
 * (`run`, the entry point `npx @ziffer-io/scan` takes), whose default scan is
 * `oneScan`: the codebase and the installed tools in one run, one policy
 * folder, one `ziffer-tools.json`, one report, one archive. Until 0.3.0 this
 * package ran the codebase with `--code` into one folder and the installed
 * servers into another, so a confirmed call wrote TWO draft policies for one
 * application; `scan.test.ts` walks what a confirmed call wrote and fails on a
 * second one.
 *
 * The run is asked for exactly one of three shapes, never assembled here:
 *
 *   * `--code`: the codebase only. Reading code starts no tool server (Python is
 *     read by this machine's own Python on the package's reader), so this runs
 *     on the FIRST call and when `include_installed` is false;
 *   * the default scan with `--yes`: the codebase AND the installed servers.
 *     Only after the developer confirmed the listing (`scan.ts`);
 *   * `--no-code --yes`: the installed servers only, when there is no project
 *     to read.
 *
 * The result is read back from `ziffer-scan.json`, the file the run writes
 * beside its policy folder, and the paths from `outputPaths`, the scan's own
 * account of where a run writes: the one-screen report stays on stdout for the
 * agent, and the JSON is the same redacted document the terminal was drawn from.
 *
 * # The shape is the scan's, never a second declaration of it
 *
 * `CodeSection` is `ScanResult['code']`, the scan package's own type. The
 * JSON the run writes is narrowed into it by {@link isCodeSection}, a guard
 * rather than a cast, so a field the scan renames is a named refusal here
 * (`ScanCodeResultMalformed`) rather than an `undefined` shown to an agent as
 * a finding.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { outputPaths, refusalLine, run, type CliContext, type ScanResult } from '@ziffer-io/scan';

/** The codebase section, as the scan package declares it. */
export type CodeSection = NonNullable<ScanResult['code']>;
export type CodeToolVerdict = CodeSection['verdicts'][number];
/** Which half a run read, as the scan package declares it. */
export type ScanScope = NonNullable<ScanResult['scope']>;
/** One skill or instruction file the run read, as the scan package declares it. */
export type SkillRead = NonNullable<ScanResult['skills']>[number];

/** What one codebase scan produced, and where it wrote it. */
export interface CodebaseScan {
  /** The directory that was read, absolute. Every `file` in `section` is relative to it. */
  readonly root: string;
  readonly section: CodeSection;
  /** The draft policy folder: the run's ONE folder, the installed tools' too when they were scanned. */
  readonly policy: string;
  /** `ziffer-tools.json`: each tool's key and resource, read by the snippet at startup. */
  readonly tools_file: string;
  /** The HTML report and the review archive, when `report` was asked for. */
  readonly review?: { readonly report: string; readonly archive: string };
  /** The skills and instruction files read under the root; absent from a document made before them. */
  readonly skills?: readonly SkillRead[];
}

export interface ScanOnceOptions {
  /** The project to read, absolute. Absent: the codebase is not read (`--no-code`). */
  readonly root?: string | undefined;
  /** Also the installed MCP servers. ONLY after the developer confirmed the listing: this starts them. */
  readonly installed: boolean;
  /** Write the HTML report and the review archive beside the policy. */
  readonly report: boolean;
  /** The policy folder. It must not exist; nothing beside it may either. */
  readonly out: string;
  readonly timeoutSeconds?: number | undefined;
  /** The scan's context: environment, home, clock. Its `cwd` is where installed-server discovery looks. */
  readonly ctx: CliContext;
}

/** One run, read back. */
export interface OneRun {
  /** The policy folder. */
  readonly out: string;
  /** The one-screen report the run printed. */
  readonly report: string[];
  /** `ziffer-scan.json`, and its content: the run's redacted result. */
  readonly json: string;
  readonly document: Record<string, unknown>;
  /** Which half the run read. */
  readonly scope?: ScanScope;
  /** The codebase half, when the run read one. */
  readonly codebase?: CodebaseScan;
}

/** A named refusal from the scan run, carried to the agent verbatim. */
export class ScanCodeFailed extends Error {
  override readonly name = 'ScanCodeFailed';
}

/**
 * A fresh folder under the system temporary directory, never the project: a
 * draft policy dropped into a repository is policy committed on somebody's
 * behalf. Fresh per call, because the run refuses an occupied folder and an
 * occupied report path.
 */
export function freshOut(now: Date): string {
  return join(mkdtempSync(join(tmpdir(), 'ziffer-scan-')), `ziffer-policy-${now.toISOString().slice(0, 10)}`);
}

/** The argv of the one run: see the module comment for the three shapes. */
export function scanArgv(opts: Omit<ScanOnceOptions, 'ctx'>): string[] {
  const argv: string[] = [];
  if (!opts.installed) {
    if (opts.root === undefined) throw new ScanCodeFailed('ScanCwdRequired: a run that starts no server has only the codebase to read, and no project was named');
    argv.push('--code', '--cwd', resolve(opts.root));
  } else {
    argv.push(...(opts.root === undefined ? ['--no-code'] : ['--cwd', resolve(opts.root)]), '--yes');
    if (opts.timeoutSeconds !== undefined) argv.push('--timeout', String(opts.timeoutSeconds));
  }
  // An installed run always writes the report: ziffer-scan.json is where its
  // result is read back from, and without --report a run that read no code writes none.
  if (opts.report || opts.installed) argv.push('--report');
  argv.push('--out', opts.out);
  return argv;
}

/** Run ONE scan and read it back. THE ADAPTER: see the module comment. */
export async function scanOnce(opts: ScanOnceOptions): Promise<OneRun> {
  const out = resolve(opts.out);
  const argv = scanArgv({ ...opts, out });
  const printed: string[] = [];
  const errors: string[] = [];
  const code = await run(argv, { out: (l) => printed.push(l), err: (l) => errors.push(l) }, opts.ctx);
  if (code !== 0) {
    // Progress lines go to stderr too; the refusal is the last one.
    throw new ScanCodeFailed(errors.at(-1) ?? `ScanFailed: the scan exited ${code} and named nothing`);
  }
  const paths = outputPaths(out);
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(paths.review.json, 'utf8'));
  } catch (error) {
    throw new ScanCodeFailed(`ScanCodeResultMalformed: ${paths.review.json}: ${refusalLine(error)}`);
  }
  if (!isRecord(doc)) throw new ScanCodeFailed('ScanCodeResultMalformed: the document is not an object');
  const reported = argv.includes('--report');
  const codebase =
    opts.root === undefined || doc['code'] === undefined
      ? undefined
      : fromDocument(resolve(opts.root), doc, {
          policy: out,
          tools_file: paths.tools,
          ...(reported ? { review: { report: paths.review.report, archive: paths.review.archive } } : {}),
        });
  const scope = doc['scope'];
  return {
    out,
    report: printed,
    json: paths.review.json,
    document: doc,
    ...(isScope(scope) ? { scope } : {}),
    ...(codebase === undefined ? {} : { codebase }),
  };
}

/**
 * The run's document, narrowed to its codebase half. The paths are the ones
 * the run was given, not the document's: the file shows home paths from `~`.
 * Exported for the tests.
 */
export function fromDocument(root: string, doc: Record<string, unknown>, paths: Omit<CodebaseScan, 'root' | 'section'>): CodebaseScan {
  const section = doc['code'];
  if (!isCodeSection(section)) throw new ScanCodeFailed('ScanCodeResultMalformed: the document carries no code section of the shape the scan declares');
  if (typeof doc['tools_file'] !== 'string') throw new ScanCodeFailed('ScanCodeResultMalformed: the document names no tools file');
  const skills = doc['skills'];
  if (skills === undefined) return { root, section, ...paths };
  if (!isSkillList(skills)) throw new ScanCodeFailed('ScanCodeResultMalformed: the document carries skills not of the shape the scan declares');
  return { root, section, ...paths, skills };
}

/** The last scan's files, read back: what `explain_scan_finding` needs beyond the section. */
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isScope(v: unknown): v is ScanScope {
  return (
    isRecord(v) &&
    (v['code'] === 'read' || v['code'] === 'skipped-flag' || v['code'] === 'no-codebase') &&
    typeof v['installed'] === 'boolean'
  );
}

// ---------------------------------------------------------------------------
// The guard. Every field the scan declares is checked, not only the ones this
// package reads today: a type predicate that checks less than it claims is a
// cast with extra steps.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optional = (v: unknown, check: (x: unknown) => boolean): boolean => v === undefined || check(v);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isSourceRef(v: unknown): v is CodeSection['catalog']['tools'][number]['defined_at'] {
  return isRecord(v) && isString(v['file']) && isNumber(v['line']) && isNumber(v['col']);
}

/** `CodeTool.calls[]`: `tool` absent when the inner tool is chosen by a computed name. */
function isToolCall(v: unknown): boolean {
  return (
    isRecord(v) &&
    optional(v['tool'], isString) &&
    isSourceRef(v['at']) &&
    (v['via'] === 'direct' || v['via'] === 'lookup') &&
    isStringArray(v['through'])
  );
}

const listOf = (check: (x: unknown) => boolean) => (v: unknown): boolean => Array.isArray(v) && v.every(check);

function isCodeTool(v: unknown): v is CodeSection['catalog']['tools'][number] {
  return (
    isRecord(v) &&
    isString(v['name']) &&
    isString(v['description']) &&
    (v['schema_kind'] === 'json_schema' || v['schema_kind'] === 'zod' || v['schema_kind'] === 'unknown') &&
    isStringArray(v['params']) &&
    isString(v['sdk']) &&
    isString(v['via']) &&
    isSourceRef(v['defined_at']) &&
    optional(v['execute_at'], isSourceRef) &&
    optional(v['delegates_to'], isString) &&
    optional(v['calls'], listOf(isToolCall))
  );
}

/** `Dispatcher.caller_checks[]`: the check, when one was found, names where and what it reads. */
function isCallerCheck(v: unknown): boolean {
  if (!isRecord(v) || !isSourceRef(v['caller']) || !isString(v['in_function'])) return false;
  const check = v['check'];
  if (!optional(v['reaches'], isStringArray) || !optional(v['reaches_from'], isString)) return false;
  return check === undefined || (isRecord(check) && isSourceRef(check['at']) && isString(check['reads']));
}

/** `CodeToolVerdict.undo_hints[]`. */
function isUndoHint(v: unknown): boolean {
  return (
    isRecord(v) &&
    (v['says'] === 'can_be_undone' || v['says'] === 'cannot_be_undone' || v['says'] === 'reads_only') &&
    (v['source'] === 'description' || v['source'] === 'inverse_tool') &&
    isString(v['evidence'])
  );
}

const SEVERITIES: readonly unknown[] = ['info', 'warn', 'high'];

/** `InstructionHit`: a pattern of data/poisoned.json that matched, with its excerpt; `line` when the text is a file. */
function isInstructionHit(v: unknown): boolean {
  return (
    isRecord(v) &&
    isString(v['pattern']) &&
    isString(v['why']) &&
    SEVERITIES.includes(v['severity']) &&
    isString(v['excerpt']) &&
    optional(v['line'], isNumber)
  );
}

const CAPABILITIES: readonly unknown[] = ['shell', 'network', 'file_write', 'credentials'];

function isExercise(v: unknown): boolean {
  return isRecord(v) && CAPABILITIES.includes(v['capability']) && isString(v['file']) && isNumber(v['line']) && isString(v['evidence']);
}

/** A place in a file, as `SkillLoad` writes it: a file and a line, no column. */
function isFileLine(v: unknown): boolean {
  return isRecord(v) && isString(v['file']) && isNumber(v['line']);
}

/** `SkillLoad` (ACP-460): where the application's code loads a skill, and where its text goes when that was followed. */
function isSkillLoad(v: unknown): boolean {
  return (
    isRecord(v) &&
    isString(v['path']) &&
    (v['how'] === 'read' || v['how'] === 'embedded' || v['how'] === 'imported') &&
    isFileLine(v['at']) &&
    optional(v['reaches'], (r) => isRecord(r) && (r['kind'] === 'instructions' || r['kind'] === 'tool_result') && isFileLine(r['at']) && isString(r['via']))
  );
}

/** `SkillRead.declared_tools[]`: `held` only beside a name found in the code. */
function isDeclaredTool(v: unknown): boolean {
  return isRecord(v) && isString(v['name']) && typeof v['in_code'] === 'boolean' && optional(v['held'], (h) => typeof h === 'boolean');
}

const FOUND_BY: readonly unknown[] = ['name', 'shape', 'code'];

/** `SkillRead`: every field the scan declares, the four of ACP-460 included. */
function isSkillRead(v: unknown): v is SkillRead {
  return (
    isRecord(v) &&
    isString(v['path']) &&
    (v['kind'] === 'skill' || v['kind'] === 'instructions') &&
    isString(v['name']) &&
    optional(v['declares'], isStringArray) &&
    listOf(isExercise)(v['exercises']) &&
    listOf(isInstructionHit)(v['instruction_hits']) &&
    optional(v['home'], (h) => h === 'application' || h === 'assistant') &&
    optional(v['found_by'], listOf((f) => FOUND_BY.includes(f))) &&
    optional(v['loaded_by'], listOf(isSkillLoad)) &&
    optional(v['declared_tools'], listOf(isDeclaredTool))
  );
}

export function isSkillList(v: unknown): v is SkillRead[] {
  return Array.isArray(v) && v.every(isSkillRead);
}

/** `CodeCatalog.checks[]`: which checks ran, per language. */
function isCheckRun(v: unknown): boolean {
  return (
    isRecord(v) &&
    (v['language'] === 'typescript' || v['language'] === 'python') &&
    typeof v['tool_calls'] === 'boolean' &&
    typeof v['caller_checks'] === 'boolean'
  );
}

function isExposure(v: unknown): v is CodeSection['catalog']['exposures'][number] {
  return (
    isRecord(v) &&
    isSourceRef(v['at']) &&
    isString(v['via']) &&
    (v['kind'] === 'static' || v['kind'] === 'computed') &&
    isStringArray(v['tools']) &&
    isString(v['note'])
  );
}

function isDispatcher(v: unknown): v is CodeSection['catalog']['dispatchers'][number] {
  return (
    isRecord(v) &&
    isString(v['name']) &&
    isSourceRef(v['at']) &&
    isString(v['signature']) &&
    Array.isArray(v['callers']) &&
    v['callers'].every(isSourceRef) &&
    isNumber(v['tools_delegating']) &&
    optional(v['caller_checks'], listOf(isCallerCheck))
  );
}

function isGate(v: unknown): v is CodeSection['catalog']['gates'][number] {
  return isRecord(v) && isString(v['name']) && isSourceRef(v['at']) && isString(v['note']);
}

function isCatalog(v: unknown): v is CodeSection['catalog'] {
  if (!isRecord(v)) return false;
  const syntax = v['syntax_only'];
  const sdks = v['sdks'];
  return (
    isString(v['root']) &&
    optional(v['package_name'], isString) &&
    Array.isArray(sdks) &&
    sdks.every((s) => isRecord(s) && isString(s['name']) && isString(s['version'])) &&
    isNumber(v['files_read']) &&
    Array.isArray(v['tools']) &&
    v['tools'].every(isCodeTool) &&
    Array.isArray(v['exposures']) &&
    v['exposures'].every(isExposure) &&
    Array.isArray(v['dispatchers']) &&
    v['dispatchers'].every(isDispatcher) &&
    Array.isArray(v['gates']) &&
    v['gates'].every(isGate) &&
    isRecord(syntax) &&
    isNumber(syntax['found']) &&
    isNumber(syntax['missed']) &&
    isStringArray(v['not_seen']) &&
    optional(v['assistant_config'], isStringArray) &&
    optional(v['checks'], listOf(isCheckRun))
  );
}

const RISKS: readonly unknown[] = ['LOW', 'MEDIUM', 'HIGH'];
const REVERSIBILITIES: readonly unknown[] = ['REVERSIBLE', 'IRREVERSIBLE'];

function isVerdict(v: unknown): v is CodeToolVerdict['verdict'] {
  if (!isRecord(v)) return false;
  if (v['verdict'] === 'REFUSED') return isString(v['clause']) && isString(v['message']);
  return (
    (v['verdict'] === 'ALLOW' || v['verdict'] === 'ATTEST') &&
    RISKS.includes(v['risk']) &&
    REVERSIBILITIES.includes(v['reversibility']) &&
    isString(v['effective_tier']) &&
    isString(v['rule_id'])
  );
}

function isToolVerdict(v: unknown): v is CodeToolVerdict {
  return (
    isRecord(v) &&
    isCodeTool(v['tool']) &&
    isVerdict(v['verdict']) &&
    isString(v['what_ziffer_does']) &&
    optional(v['draft_reason'], isString) &&
    optional(v['key'], isString) &&
    optional(v['undo_hints'], listOf(isUndoHint)) &&
    optional(v['raised_by'], isString) &&
    optional(v['sensitive_value'], isString) &&
    optional(v['instruction_hits'], listOf(isInstructionHit))
  );
}

function isInsertion(v: unknown): v is CodeSection['insertion'] {
  return (
    isRecord(v) &&
    (v['dispatcher'] === null || isDispatcher(v['dispatcher'])) &&
    typeof v['per_tool'] === 'boolean' &&
    isString(v['sentence']) &&
    isString(v['snippet']) &&
    v['snippet_language'] === 'typescript' &&
    isString(v['call'])
  );
}

const COUNTS = ['tools', 'held', 'refused', 'notified', 'allowed', 'irreversible'] as const;

export function isCodeSection(v: unknown): v is CodeSection {
  if (!isRecord(v)) return false;
  const counts = v['counts'];
  return (
    isCatalog(v['catalog']) &&
    Array.isArray(v['verdicts']) &&
    v['verdicts'].every(isToolVerdict) &&
    isInsertion(v['insertion']) &&
    isRecord(counts) &&
    COUNTS.every((k) => isNumber(counts[k]))
  );
}
