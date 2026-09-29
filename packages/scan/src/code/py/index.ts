/**
 * `ziffer-scan --code`, the Python front end (ACP-455): runs `py/ziffer_scan_code.py`
 * under the machine's own Python and folds its output into a `CodeCatalog`.
 *
 * The parser is Python's `ast`, not a reimplementation of Python's grammar in
 * TypeScript: a grammar written here would drift from the language on every release,
 * and the one in the interpreter cannot. The cost is a dependency on an interpreter
 * being present -- when none is, the catalog says so in `not_seen` and reports no
 * tools, rather than reporting "no tools" as if the Python had been read.
 *
 * Nothing crosses from the subprocess into a typed value without being rebuilt field
 * by field from `unknown` (`parsePyScanOutput`); a document that does not match is
 * refused by name, `PythonScanFailed`.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SkillLoad } from '../../types.js';
import type { CallerCheck, CodeCatalog, CodeTool, Dispatcher, Exposure, Interception, InterceptionKind, RuntimeGate, SourceRef, ToolCall } from '../types.js';
import { countPythonFiles, readPythonManifests } from './manifests.js';
import { ownSourceLine, ownSourceReader, partitionOwnSource, sdkEntry } from '../sdks.js';
import { computedNameLines } from '../ts/common.js';

/** The walker, shipped in the package (`files: ["py"]`); three levels up from both `src/code/py` and `dist/code/py`. */
export const PY_SCRIPT = fileURLToPath(new URL('../../../py/ziffer_scan_code.py', import.meta.url));

/** The oldest Python the walker is written for (and was run under: 3.9.6). */
const MIN_MINOR = 9;
const INTERPRETERS = ['python3', 'python'];
const MAX_OUTPUT = 256 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;

export class PythonScanFailed extends Error {
  override readonly name = 'PythonScanFailed';
}

/** What the walker prints: the `CodeCatalog` fields a source reader can fill, plus its own counts. */
export interface PyScanOutput {
  python_files: number;
  /** Jupyter notebooks read (their code cells, as one module each); 0 from a walker that predates them. */
  notebooks: number;
  /** Directories left unread because they are a nested git worktree or submodule checkout. */
  nested_checkouts: number;
  /** Python files of test code walked past (a tests directory, test_*.py, *_test.py, conftest.py). */
  test_files: number;
  files_read: number;
  syntax_errors: number;
  tools: CodeTool[];
  exposures: Exposure[];
  dispatchers: Dispatcher[];
  gates: RuntimeGate[];
  not_seen: string[];
  /** Which of the 2026-09-28 checks the walker ran; all false from a walker that predates them. */
  checks: { tool_calls: boolean; caller_checks: boolean; skill_loads: boolean };
  /** Where the code loads a skill or instruction file (ACP-460); empty from a walker that predates the check (then `checks.skill_loads` is false). */
  skill_loads: SkillLoad[];
  /** Structured-output schemas recognised and not counted (`CodeCatalog.structured_output`); absent from a walker that predates them. */
  structured_output?: { name: string; at: SourceRef }[];
  /** Tool names for the model the walker could not resolve (`given_name`); empty from a walker that predates them. */
  computed_names: { sdk: string; listed?: string; at: SourceRef; expr: string }[];
}

// ---- the guard: every value rebuilt from `unknown`, nothing asserted -----------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function strings(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return null;
    out.push(x);
  }
  return out;
}

function list<T>(v: unknown, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const r = read(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function readRef(v: unknown): SourceRef | null {
  if (!isRecord(v)) return null;
  const file = str(v['file']);
  const line = int(v['line']);
  const col = int(v['col']);
  if (file === null || line === null || col === null || line < 1 || col < 1) return null;
  return { file, line, col };
}

function isKind(v: unknown): v is InterceptionKind {
  return v === 'K1' || v === 'K2' || v === 'K3' || v === 'K4' || v === 'K5';
}

/** `Interception`, rebuilt: kind in the closed set, a name, a boolean, and `at` only as a place. */
function readInterception(v: unknown): Interception | null {
  if (!isRecord(v)) return null;
  const kind = v['kind'];
  const name = str(v['name']);
  const present = v['present'];
  if (!isKind(kind) || name === null || typeof present !== 'boolean') return null;
  const out: Interception = { kind, name, present };
  if (v['at'] !== undefined) {
    const at = readRef(v['at']);
    if (at === null) return null;
    out.at = at;
  }
  return out;
}

function readStructured(v: unknown): { name: string; at: SourceRef } | null {
  if (!isRecord(v)) return null;
  const name = str(v['name']);
  const at = readRef(v['at']);
  return name === null || at === null ? null : { name, at };
}

function readComputed(v: unknown): PyScanOutput['computed_names'][number] | null {
  if (!isRecord(v)) return null;
  const sdk = str(v['sdk']);
  const at = readRef(v['at']);
  const expr = str(v['expr']);
  if (sdk === null || at === null || expr === null) return null;
  if (v['listed'] === undefined) return { sdk, at, expr };
  const listed = str(v['listed']);
  return listed === null ? null : { sdk, listed, at, expr };
}

function readToolCall(v: unknown): ToolCall | null {
  if (!isRecord(v)) return null;
  const at = readRef(v['at']);
  const via = v['via'];
  const through = strings(v['through']);
  if (at === null || through === null) return null;
  if (via !== 'direct' && via !== 'lookup') return null;
  const call: ToolCall = { at, via, through };
  if (v['tool'] !== undefined) {
    const tool = str(v['tool']);
    if (tool === null) return null;
    call.tool = tool;
  }
  return call;
}

function readClaim(v: unknown): { name: string; value: string } | null {
  if (!isRecord(v)) return null;
  const name = str(v['name']);
  const value = str(v['value']);
  if (name === null || value === null) return null;
  return { name, value };
}

function readCallerCheck(v: unknown): CallerCheck | null {
  if (!isRecord(v)) return null;
  const caller = readRef(v['caller']);
  const inFunction = str(v['in_function']);
  if (caller === null || inFunction === null) return null;
  const out: CallerCheck = { caller, in_function: inFunction };
  if (v['check'] !== undefined) {
    const c = v['check'];
    if (!isRecord(c)) return null;
    const at = readRef(c['at']);
    const reads = str(c['reads']);
    if (at === null || reads === null) return null;
    out.check = { at, reads };
  }
  return out;
}

/** The walker's `checks`; each false when absent (a walker that predates it), null when malformed. */
function readChecks(v: unknown): PyScanOutput['checks'] | null {
  if (v === undefined) return { tool_calls: false, caller_checks: false, skill_loads: false };
  if (!isRecord(v)) return null;
  const toolCalls = v['tool_calls'];
  const callerChecks = v['caller_checks'];
  const skillLoads = v['skill_loads'] === undefined ? false : v['skill_loads'];
  if (typeof toolCalls !== 'boolean' || typeof callerChecks !== 'boolean' || typeof skillLoads !== 'boolean') return null;
  return { tool_calls: toolCalls, caller_checks: callerChecks, skill_loads: skillLoads };
}

/** `{file, line}` with a 1-based line: the place a `SkillLoad` names. */
function readPlace(v: unknown): { file: string; line: number } | null {
  if (!isRecord(v)) return null;
  const file = str(v['file']);
  const line = int(v['line']);
  if (file === null || line === null || line < 1) return null;
  return { file, line };
}

function readSkillLoad(v: unknown): SkillLoad | null {
  if (!isRecord(v)) return null;
  const path = str(v['path']);
  const how = v['how'];
  const at = readPlace(v['at']);
  if (path === null || at === null) return null;
  if (how !== 'read' && how !== 'embedded' && how !== 'imported') return null;
  const load: SkillLoad = { path, how, at };
  if (v['reaches'] !== undefined) {
    const r = v['reaches'];
    if (!isRecord(r)) return null;
    const kind = r['kind'];
    const rAt = readPlace(r['at']);
    const via = str(r['via']);
    if (rAt === null || via === null) return null;
    if (kind !== 'instructions' && kind !== 'tool_result') return null;
    load.reaches = { kind, at: rAt, via };
  }
  return load;
}

function readTool(v: unknown): CodeTool | null {
  if (!isRecord(v)) return null;
  const name = str(v['name']);
  const description = str(v['description']);
  const kind = v['schema_kind'];
  const params = strings(v['params']);
  const sdk = str(v['sdk']);
  const via = str(v['via']);
  const definedAt = readRef(v['defined_at']);
  if (name === null || description === null || params === null || sdk === null || via === null || definedAt === null) return null;
  if (kind !== 'json_schema' && kind !== 'zod' && kind !== 'unknown') return null;
  const tool: CodeTool = { name, description, schema_kind: kind, params, sdk, via, defined_at: definedAt };
  if (v['execute_at'] !== undefined) {
    const at = readRef(v['execute_at']);
    if (at === null) return null;
    tool.execute_at = at;
  }
  if (v['delegates_to'] !== undefined) {
    const d = str(v['delegates_to']);
    if (d === null) return null;
    tool.delegates_to = d;
  }
  if (v['calls'] !== undefined) {
    const calls = list(v['calls'], readToolCall);
    if (calls === null) return null;
    tool.calls = calls;
  }
  if (v['authority_claims'] !== undefined) {
    const claims = list(v['authority_claims'], readClaim);
    if (claims === null) return null;
    tool.authority_claims = claims;
  }
  if (v['declared_stub'] !== undefined) {
    const stub = v['declared_stub'];
    if (typeof stub !== 'boolean') return null;
    tool.declared_stub = stub;
  }
  if (v['interception'] !== undefined) {
    const i = readInterception(v['interception']);
    if (i === null) return null;
    tool.interception = i;
  }
  if (v['model_name'] !== undefined) {
    const mn = str(v['model_name']);
    if (mn === null || mn === name) return null;
    tool.model_name = mn;
  }
  return tool;
}

function readExposure(v: unknown): Exposure | null {
  if (!isRecord(v)) return null;
  const at = readRef(v['at']);
  const via = str(v['via']);
  const kind = v['kind'];
  const tools = strings(v['tools']);
  const note = str(v['note']);
  if (at === null || via === null || tools === null || note === null) return null;
  if (kind !== 'static' && kind !== 'computed') return null;
  const e: Exposure = { at, via, kind, tools, note };
  if (v['interception'] !== undefined) {
    const i = readInterception(v['interception']);
    if (i === null) return null;
    e.interception = i;
  }
  return e;
}

function readDispatcher(v: unknown): Dispatcher | null {
  if (!isRecord(v)) return null;
  const name = str(v['name']);
  const at = readRef(v['at']);
  const signature = str(v['signature']);
  const callers = list(v['callers'], readRef);
  const delegating = int(v['tools_delegating']);
  if (name === null || at === null || signature === null || callers === null || delegating === null) return null;
  const d: Dispatcher = { name, at, signature, callers, tools_delegating: delegating };
  if (v['caller_checks'] !== undefined) {
    const checks = list(v['caller_checks'], readCallerCheck);
    // One entry per caller, same order, or the document is not the contract.
    if (checks === null || checks.length !== callers.length) return null;
    for (let i = 0; i < checks.length; i++) {
      const a = checks[i]?.caller;
      const b = callers[i];
      if (a === undefined || b === undefined || a.file !== b.file || a.line !== b.line || a.col !== b.col) return null;
    }
    d.caller_checks = checks;
  }
  return d;
}

function readGate(v: unknown): RuntimeGate | null {
  if (!isRecord(v)) return null;
  const name = str(v['name']);
  const at = readRef(v['at']);
  const note = str(v['note']);
  if (name === null || at === null || note === null) return null;
  return { name, at, note };
}

/** The walker's document, rebuilt; null when any field is missing or of the wrong type. */
export function parsePyScanOutput(v: unknown): PyScanOutput | null {
  if (!isRecord(v)) return null;
  const pythonFiles = int(v['python_files']);
  const filesRead = int(v['files_read']);
  const syntaxErrors = int(v['syntax_errors']);
  const tools = list(v['tools'], readTool);
  const exposures = list(v['exposures'], readExposure);
  const dispatchers = list(v['dispatchers'], readDispatcher);
  const gates = list(v['gates'], readGate);
  const notSeen = strings(v['not_seen']);
  const notebooks = v['notebooks'] === undefined ? 0 : int(v['notebooks']);
  const nested = v['nested_checkouts'] === undefined ? 0 : int(v['nested_checkouts']);
  const testFiles = v['test_files'] === undefined ? 0 : int(v['test_files']);
  const checks = readChecks(v['checks']);
  const skillLoads = v['skill_loads'] === undefined ? [] : list(v['skill_loads'], readSkillLoad);
  const structured = v['structured_output'] === undefined ? undefined : list(v['structured_output'], readStructured);
  const computed = v['computed_names'] === undefined ? [] : list(v['computed_names'], readComputed);
  if (
    checks === null || skillLoads === null || structured === null || computed === null ||
    notebooks === null || nested === null || testFiles === null ||
    pythonFiles === null || filesRead === null || syntaxErrors === null || tools === null ||
    exposures === null || dispatchers === null || gates === null || notSeen === null
  ) {
    return null;
  }
  return {
    python_files: pythonFiles,
    notebooks,
    nested_checkouts: nested,
    test_files: testFiles,
    files_read: filesRead,
    syntax_errors: syntaxErrors,
    tools,
    exposures,
    dispatchers,
    gates,
    not_seen: notSeen,
    checks,
    skill_loads: skillLoads,
    computed_names: computed,
    ...(structured === undefined ? {} : { structured_output: structured }),
  };
}

export function isPyScanOutput(v: unknown): v is PyScanOutput {
  return parsePyScanOutput(v) !== null;
}

// ---- the interpreter ---------------------------------------------------------------

function run(file: string, args: string[], maxBuffer: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer, timeout: TIMEOUT_MS, windowsHide: true, env: process.env }, (err, stdout, stderr) => {
      if (err !== null) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

/** The first of `python3`, `python` on PATH that is Python 3.9 or later; null when none is. */
export async function findPython(log?: (line: string) => void): Promise<{ command: string; version: string } | null> {
  for (const command of INTERPRETERS) {
    let text: string;
    try {
      const r = await run(command, ['--version'], 1024 * 1024);
      text = `${r.stdout}${r.stderr}`;
    } catch {
      continue;
    }
    const m = /Python (\d+)\.(\d+)(\.\d+)?/.exec(text);
    if (m === null) continue;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const version = `${m[1]}.${m[2]}${m[3] ?? ''}`;
    if (major === 3 && minor >= MIN_MINOR) return { command, version };
    log?.(`python: ${command} is ${version}, older than 3.${MIN_MINOR}; not used`);
  }
  return null;
}

/** Run the walker over `root` with `command` and return its document, validated. */
export async function runPythonWalker(command: string, root: string): Promise<PyScanOutput> {
  if (!existsSync(PY_SCRIPT)) throw new PythonScanFailed(`the Python walker is missing from the package: ${PY_SCRIPT}`);
  let stdout: string;
  try {
    stdout = (await run(command, [PY_SCRIPT, root], MAX_OUTPUT)).stdout;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PythonScanFailed(`the Python walker failed under ${command}: ${detail.slice(0, 2000)}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    throw new PythonScanFailed(`the Python walker printed something that is not JSON (${stdout.length} bytes)`);
  }
  const out = parsePyScanOutput(doc);
  if (out === null) throw new PythonScanFailed('the Python walker printed a document that is not the shape this package reads');
  return out;
}

/**
 * The Python half of `ziffer-scan --code` over `root`: a complete `CodeCatalog`, to be
 * merged with the TypeScript half by the caller (same `root`; tools, exposures,
 * dispatchers and gates concatenated; `sdks` unioned; `files_read` summed).
 */
/** What one Python run read and left out, for a caller that tabulates runs (the corpus script). */
export interface PyScanStats {
  pythonFiles: number;
  notebooks: number;
  filesRead: number;
  syntaxErrors: number;
  nestedCheckouts: number;
  testFiles: number;
  ownSource: { pkg: string; tools: number }[];
}

const NOT_LOOKED_FOR: NonNullable<CodeCatalog['checks']> = [{ language: 'python', tool_calls: false, caller_checks: false }];

export async function scanPython(root: string, opts: { log?: (line: string) => void; onStats?: (s: PyScanStats) => void } = {}): Promise<CodeCatalog> {
  const manifests = readPythonManifests(root);
  const base = {
    root,
    ...(manifests.package_name === undefined ? {} : { package_name: manifests.package_name }),
    sdks: manifests.sdks,
  };
  const python = await findPython(opts.log);
  if (python === null) {
    const n = countPythonFiles(root);
    opts.log?.('python: no python3 or python 3.9+ on PATH');
    return {
      ...base,
      files_read: 0,
      tools: [],
      exposures: [],
      dispatchers: [],
      gates: [],
      syntax_only: { found: 0, missed: 0 },
      not_seen: n === 0 ? [] : [`${n} Python files present, not read: no python3 on PATH`],
      // Nothing was read, so nothing was looked for: "none found" would be a false reading.
      ...(n === 0 ? {} : { checks: NOT_LOOKED_FOR }),
    };
  }
  opts.log?.(`python: ${python.command} ${python.version}`);
  const out = await runPythonWalker(python.command, root);
  // The framework's own source (its package, its tests) is not an application: the
  // same rule, and the same reader, as the TypeScript half (`ownSourceReader`).
  // A notebook's reference names its cell (`nb.ipynb#cell-3`); the file is before `#`.
  const own = ownSourceReader(resolve(root));
  const ownOf = (file: string): ReturnType<typeof own> => own(file.split('#')[0] ?? file);
  const tools = partitionOwnSource(out.tools, (t) => t.defined_at, ownOf);
  const line = ownSourceLine(tools.dropped);
  // A name for the model the walker could not resolve, said per framework in the TypeScript front end's words.
  const computed = computedNameLines(out.computed_names.filter((n) => ownOf(n.at.file) === undefined), (id) => (sdkEntry(id)?.framework ?? id).split(' (')[0] ?? id);
  opts.log?.(`python: ${out.files_read} file(s) read (${out.notebooks} notebook(s)), ${tools.kept.length} tool(s), ${[...tools.dropped.values()].reduce((a, b) => a + b, 0)} more in a framework's own source`);
  opts.onStats?.({
    pythonFiles: out.python_files,
    notebooks: out.notebooks,
    filesRead: out.files_read,
    syntaxErrors: out.syntax_errors,
    nestedCheckouts: out.nested_checkouts,
    testFiles: out.test_files,
    ownSource: [...tools.dropped.entries()].map(([pkg, n]) => ({ pkg, tools: n })),
  });
  return {
    ...base,
    files_read: out.files_read,
    tools: tools.kept,
    exposures: partitionOwnSource(out.exposures, (e) => e.at, ownOf).kept,
    dispatchers: partitionOwnSource(out.dispatchers, (d) => d.at, ownOf).kept,
    gates: partitionOwnSource(out.gates, (g) => g.at, ownOf).kept,
    // Python has no type-checker pass in milestone 1: every tool is found by syntax, and
    // `missed` is 0 by construction, not by measurement.
    syntax_only: { found: tools.kept.length, missed: 0 },
    not_seen: [...out.not_seen, ...computed, ...(line === undefined ? [] : [line])],
    checks: [{ language: 'python', tool_calls: out.checks.tool_calls, caller_checks: out.checks.caller_checks, skill_loads: out.checks.skill_loads }],
    // Absent when the walker did not look (`CodeCatalog.skill_loads`); a load written in a
    // framework's own source is the framework's, by the same rule as its tools.
    ...(out.checks.skill_loads
      ? { skill_loads: partitionOwnSource(out.skill_loads, (l) => ({ file: l.at.file, line: l.at.line, col: 1 }), ownOf).kept }
      : {}),
    ...(out.structured_output === undefined ? {} : { structured_output: partitionOwnSource(out.structured_output, (x) => x.at, ownOf).kept }),
  };
}
