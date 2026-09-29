/**
 * The command line of `ziffer-scan` (ACP-440; one scan since ACP-455, 0.3.0).
 *
 * `scan` (the default): read the codebase under --cwd for the tools its code
 * gives a model (it reads files and starts nothing), then find the MCP servers
 * the AI agent clients on this machine are configured to start, show the list
 * and ask before starting any of them, ask each for its tools; draft ONE
 * signed policy over every tool found into `--out`, grade the code tools with
 * the engine against it, print the report, then replay the eight injected
 * cases against that same policy. `--code`: the codebase only. `--no-code`:
 * the installed tools only. `replay`: the eight cases against the harness's
 * own policy, and nothing else. `--ci <policy-dir>` (ACP-442): the MCP servers
 * configured in this repository, each tool graded by the engine against the
 * draft policy in the tree; see `ci/ci.ts`.
 *
 * Nothing leaves the machine: the only processes started are the servers the
 * person approved, and the only request sent to them is the tool list.
 *
 * Exit codes: 0 the run finished (for `--ci`: and the engine refused no tool);
 * 1 under `--ci`, the engine refused at least one tool; 2 a refusal, printed as ONE line
 * `<Name>: <what>` on stderr (a usage error, a declined or impossible
 * confirmation, an absent engine module, an occupied output directory, an
 * engine refusal of the generated bundle, ...); 1 an error nobody named, still
 * one line and never a stack trace, because a person reading a stack trace
 * learns only that the tool broke.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { renderCi, renderCiJson, runCiScan } from './ci/ci.js';
import { scanCode } from './code/index.js';
import { mergeCatalogs } from './code/merge.js';
import { scanPython } from './code/py/index.js';
import { assertOutputsFree, writeScan } from './code/run.js';
import type { CodeCatalog } from './code/types.js';
import {
  configuredPhrase,
  discover,
  distinct,
  groupBySignature,
  skippedSignature,
  type DiscoveredServer,
  type Platform,
  type SkippedServer,
  type StartGroup,
} from './discovery/index.js';
import { DEFAULT_TIMEOUT_MS, type ListOutcome, listServerTools, type ServerEntry } from './mcp/client.js';
import { confirmSpawn } from './mcp/confirm.js';
import { packageVersion } from './package-info.js';
import { redactResult, redactText } from './redact/index.js';
import { OWN_FILE, renderReplay, replay } from './replay/index.js';
import { POLICY_PATH_TOKEN, renderPreamble, renderTerminal, sortedJson } from './report/index.js';
import { notInPicture, PREAMBLE_NO_CODEBASE, wrap } from './report/terminal.js';
import { type InstalledHalf, oneScan } from './scan/one.js';
import { readSkills } from './skills/index.js';
import { joinDeclared } from './skills/join.js';
import type { CatalogTool, Finding, Reach } from './types.js';
import { type Engine, loadEngine } from './wasm/loader.js';
import { locateWasm } from './wasm/locate.js';

export { packageVersion } from './package-info.js';

export interface CliIo {
  /** One line of the report (stdout). */
  out: (line: string) => void;
  /** One line of diagnostics or a refusal (stderr). */
  err: (line: string) => void;
}

/** What the run reads from the process, passed in so a test can supply its own. */
export interface CliContext {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  home: string;
  cwd: string;
  stdin: NodeJS.ReadableStream;
  isTTY: boolean;
  /** Raw stderr, for the confirmation question (which has no trailing newline). */
  prompt: (text: string) => void;
  now: () => Date;
  /** stdout is a terminal: colour by default, and its width (ACP-454). Absent: not a terminal. */
  stdoutTTY?: boolean;
  /** stdout's columns when it is a terminal. */
  columns?: number;
  /** stderr is a terminal: the start progress rewrites one line in place. */
  stderrTTY?: boolean;
}

export function processContext(): CliContext {
  return {
    env: process.env,
    platform: process.platform,
    home: homedir(),
    cwd: process.cwd(),
    stdin: process.stdin,
    isTTY: process.stdin.isTTY === true,
    prompt: (text) => process.stderr.write(text),
    now: () => new Date(),
    stdoutTTY: process.stdout.isTTY === true,
    ...(process.stdout.columns === undefined ? {} : { columns: process.stdout.columns }),
    stderrTTY: process.stderr.isTTY === true,
  };
}

export type Command = 'scan' | 'replay';

export interface ParsedArgs {
  command: Command;
  /** `--full`: the complete report and the replay table after the one screen (ACP-452). */
  full: boolean;
  json: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
  replay: boolean;
  home?: string;
  cwd?: string;
  platform?: Platform;
  out?: string;
  /** Seconds each server has to start and list its tools. */
  timeout?: number;
  /** Write the forwardable report, the JSON document and the review archive (ACP-443). */
  report?: true;
  /** `--ci <policy-dir>` (ACP-442): grade this repository's tools against the policy tree there. */
  ci?: string;
  /** `--code` (ACP-455): the codebase under --cwd only; the installed AI tools are not read. */
  code?: true;
  /** `--no-code` (ACP-455, 0.3.0): the installed AI tools only; the codebase is not read (the default before 0.3.0). */
  noCode?: true;
  /** `--color` (true) or `--no-color` (false); absent: colour when stdout is a terminal and NO_COLOR is unset. */
  color?: boolean;
}

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const COMMANDS: readonly Command[] = ['scan', 'replay'];
const PLATFORMS: readonly Platform[] = ['darwin', 'linux', 'win32'];
const VALUE_FLAGS = ['--home', '--cwd', '--platform', '--out', '--timeout', '--ci'] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

function isCommand(value: string): value is Command {
  return COMMANDS.some((c) => c === value);
}
function isPlatform(value: string): value is Platform {
  return PLATFORMS.some((p) => p === value);
}
function isValueFlag(value: string): value is ValueFlag {
  return VALUE_FLAGS.some((f) => f === value);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: 'scan', full: false, json: false, yes: false, help: false, version: false, replay: true };
  let commandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--full') parsed.full = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--yes') parsed.yes = true;
    else if (arg === '--no-replay') parsed.replay = false;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--version') parsed.version = true;
    else if (arg === '--report') parsed.report = true;
    else if (arg === '--code') parsed.code = true;
    else if (arg === '--no-code') parsed.noCode = true;
    else if (arg === '--color') parsed.color = true;
    else if (arg === '--no-color') parsed.color = false;
    else if (isValueFlag(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError(`MissingValue: ${arg} needs a value`);
      i += 1;
      if (arg === '--platform') {
        if (!isPlatform(value)) throw new UsageError(`PlatformUnknown: ${value} (darwin, linux or win32)`);
        parsed.platform = value;
      } else if (arg === '--timeout') {
        if (!/^[1-9][0-9]{0,4}$/.test(value)) throw new UsageError(`TimeoutInvalid: ${value} (whole seconds, 1 or more)`);
        parsed.timeout = Number(value);
      } else if (arg === '--ci') parsed.ci = policyDirName(value);
      else if (arg === '--home') parsed.home = value;
      else if (arg === '--cwd') parsed.cwd = value;
      else parsed.out = value;
    } else if (!arg.startsWith('-') && !commandSeen && isCommand(arg)) {
      parsed.command = arg;
      commandSeen = true;
    } else {
      throw new UsageError(`UnknownArgument: ${arg}`);
    }
  }
  if (parsed.code === true) {
    // --code reads source files, starts nothing and reads no home directory.
    const conflicts = [
      commandSeen ? parsed.command : undefined,
      parsed.noCode === true ? '--no-code' : undefined,
      parsed.ci === undefined ? undefined : '--ci',
      parsed.home === undefined ? undefined : '--home',
      parsed.yes ? '--yes' : undefined,
      parsed.timeout === undefined ? undefined : '--timeout',
      parsed.replay ? undefined : '--no-replay',
    ].filter((c) => c !== undefined);
    if (conflicts.length > 0) throw new UsageError(`CodeFlagConflict: --code does not take ${conflicts.join(', ')}`);
  }
  if (parsed.noCode === true && commandSeen && parsed.command === 'replay') throw new UsageError('CodeFlagConflict: replay does not take --no-code');
  if (parsed.ci !== undefined) {
    // --ci writes nothing and reads no home directory: the flags that do either
    // are refused rather than ignored, so nobody believes one took effect.
    const conflicts = [
      commandSeen ? parsed.command : undefined,
      parsed.out === undefined ? undefined : '--out',
      parsed.report === true ? '--report' : undefined,
      parsed.home === undefined ? undefined : '--home',
      parsed.full ? '--full' : undefined,
      parsed.replay ? undefined : '--no-replay',
      parsed.noCode === true ? '--no-code' : undefined,
    ].filter((c) => c !== undefined);
    if (conflicts.length > 0) throw new UsageError(`CiFlagConflict: --ci does not take ${conflicts.join(', ')}`);
  }
  return parsed;
}

/**
 * One folder for everything a run writes (ACP-454): the policy folder inside
 * `./ziffer-scan/`, and beside it the replay's own case and what `--report`
 * writes. The first real run dropped four items into the git repository it was
 * run from, beside the person's own files.
 */
export const DEFAULT_OUT = 'ziffer-scan/ziffer-policy';
/** The terminal widths the report wraps to: 80 at least, 120 at most (ACP-454). */
export const MIN_WIDTH = 80;
export const MAX_WIDTH = 120;

export const HELP = `Usage: ziffer-scan [scan|replay] [options]
       ziffer-scan --code [--cwd <dir>] [--report] [--json] [--out <dir>]
       ziffer-scan --ci <policy-dir> [--json] [--cwd <dir>] [--timeout <s>]

  scan      Read your codebase (--cwd, default the current folder) for the
            tools its code gives a model, then the AI tools installed on
            this machine for the tools they can call; write ONE draft agent
            authorization policy over all of them, grade every tool with
            ZIFFER's engine against it, and replay eight injected
            instructions (default).
  replay    Replay the eight injected instructions against the test
            harness's own policy.

  --code             Your codebase only: skip the installed AI tools. Starts
                     no tool server; to read Python, runs this machine's own
                     Python on the reader shipped in the package. Ends with
                     the one place to put ZIFFER in your code and the code to
                     paste there.
  --no-code          The installed AI tools only: skip the codebase.
  --cwd <dir>        The codebase to read, and the project whose AI tool
                     configuration is read (default: the current folder).
                     Run from your home folder or /, the codebase is not
                     read: pass --cwd, or run from your project folder.
  --full             The complete report and the replay table after the
                     one-screen summary.
  --json             Machine-readable output on stdout: one document, both
                     halves.
  --yes              Start the tool servers found without asking first.
  --out <dir>        Where the draft policy is written (default ./${DEFAULT_OUT}).
                     Everything else the run writes goes beside it, in
                     ./${dirname(DEFAULT_OUT)}/ by default.
  --no-replay        Scan and write the policy; skip the replay.
  --timeout <s>      Seconds each tool server has to start and list its
                     tools (default ${DEFAULT_TIMEOUT_MS / 1000}). A server fetched by npx or uvx
                     can need longer the first time.
  --home <dir>       Read the AI tool configuration under this home directory.
  --platform <p>     darwin, linux or win32 (default: this machine's).
  --color            Colour even when stdout is not a terminal.
  --no-color         No colour (also: the NO_COLOR environment variable).
  --help             This text.
  --version          The version of this package.
  --ci <policy-dir>  For a pull request in your policy repository: start the
                     tool servers this repository configures, and grade each
                     tool against the draft policy in <policy-dir>, unsigned.
                     Exit 1 if any tool is refused, with the line to add.
                     Implies --yes. Reads no codebase.
  --report           Also write ziffer-scan-report.html, ziffer-scan.json and
                     ziffer-review.tar.gz beside the policy folder (in
                     ./${dirname(DEFAULT_OUT)}/ by default): open the report in a
                     browser; the archive is what the review email asks you
                     to attach.

Nothing leaves this machine.`;

/** One line for a refusal: `Name: message`, the name never repeated. */
export function refusalLine(error: unknown): string {
  if (!(error instanceof Error)) return `Error: ${String(error)}`;
  const first = error.message.split('\n')[0] ?? '';
  return first.startsWith(`${error.name}:`) ? first : `${error.name}: ${first}`;
}

/**
 * The refusals a person can meet and act on, by name. Anything else that
 * reaches the top is an error nobody named, and exits 1.
 */
const NAMED_REFUSALS: ReadonlySet<string> = new Set([
  'UsageError',
  'NotInteractive',
  'SpawnDeclined',
  'EngineWasmAbsent',
  'EngineAbiMismatch',
  'EngineExportMissing',
  'EngineImportUnexpected',
  'BundleDirectoryOccupied',
  'BundleVerifyRefused',
  'BundleEngineFailed',
  'BundleMemberInvalid',
  'BundleMemberAltered',
  'BundleSchemaAbsent',
  'ReplayBroken',
  'KeyNotDiscarded',
  'GeneratedPolicyUnreadable',
  'ClientsDataInvalid',
  'ClassifyDataInvalid',
  'CitationUnresolved',
  'FindingControlsInvalid',
  'RedactDataInvalid',
  'ReviewFileOccupied',
  'PolicyTreeUnreadable',
  'CiEngineFailed',
  'CodeEngineFailed',
  'NoCodebase',
]);

function platformOf(value: string): Platform {
  if (isPlatform(value)) return value;
  throw new UsageError(`PlatformUnknown: this machine reports ${value}; pass --platform darwin, linux or win32`);
}

async function engineFrom(ctx: CliContext): Promise<Engine> {
  return loadEngine(readFileSync(locateWasm(ctx.env)));
}

/**
 * Servers started at once (ACP-450). The first real run started 29 together;
 * every `npx -y` and `uvx` server among them fetched its package at the same
 * moment and none answered in time.
 */
export const START_CONCURRENCY = 4;

/** `fn` over `items`, at most `limit` at a time, results in the order of `items`. */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** RFC 3339 UTC to the second. */
const instant = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Findings for every configured server this run did not look at, and why, each with its start signature. */
function notScanned(
  skipped: readonly SkippedServer[],
  unreadable: readonly { path: string; reason: string }[],
): { signature: string; finding: Finding }[] {
  return [
    ...skipped.map((s) => {
      const where = configuredPhrase(s.configured_in);
      const f: Finding = {
        id: `server_not_started:${s.client}/${s.name}`,
        kind: 'server_not_started',
        severity: 'info',
        tools: [],
        client: s.client,
        server: s.name,
        message: `The server "${s.name}" was not scanned: ${s.reason}.${where === undefined ? '' : ` It is ${where}.`}`,
        controls: [],
      };
      if (s.configured_in !== undefined) f.configured_in = s.configured_in;
      return { signature: skippedSignature(s), finding: f };
    }),
    ...unreadable.map((u) => {
      const f: Finding = {
        id: `server_not_started:${u.path}`,
        kind: 'server_not_started',
        severity: 'warn',
        tools: [],
        message: `The configuration file ${u.path} could not be read, so no server in it was scanned (${u.reason}).`,
        controls: [],
      };
      return { signature: JSON.stringify(['unreadable', u.path]), finding: f };
    }),
  ];
}

/**
 * The first entry's tool list, as every entry sharing its signature presents
 * it (ACP-454): the catalog stays one row per client, server and tool, because
 * a pair finding is per client, but the list was fetched once.
 */
function toolsFor(tools: readonly CatalogTool[], e: ServerEntry): CatalogTool[] {
  return tools.map((t) => {
    const out: CatalogTool = { client: e.client, server: e.name, tool: t.tool, description: t.description, params: t.params, source_path: e.source_path };
    if (e.configured_in !== undefined) out.configured_in = e.configured_in;
    return out;
  });
}

/**
 * The first entry's failure, said of another entry sharing its signature: its
 * client, its name and its places. The sentence is `mcp/client.ts`'s; only the
 * quoted name and the trailing "It is configured in ..." are the entry's own.
 */
function findingFor(f: Finding, first: ServerEntry, e: ServerEntry): Finding {
  if (e === first) return f;
  const firstWhere = configuredPhrase(first.configured_in);
  const tail = firstWhere === undefined ? '' : ` It is ${firstWhere}.`;
  const body = tail !== '' && f.message.endsWith(tail) ? f.message.slice(0, -tail.length) : f.message;
  const where = configuredPhrase(e.configured_in);
  const out: Finding = {
    ...f,
    id: `${f.kind}:${e.client}/${e.name}`,
    client: e.client,
    server: e.name,
    message: `${body.replace(`"${first.name}"`, `"${e.name}"`)}${where === undefined ? '' : ` It is ${where}.`}`,
  };
  delete out.configured_in;
  if (e.configured_in !== undefined) out.configured_in = e.configured_in;
  return out;
}

/**
 * The catalog, the findings and the counts from one start per signature
 * (ACP-454). `listed[i]` is the outcome of starting `groups[i].first`.
 */
export function fanOut(
  groups: readonly StartGroup<DiscoveredServer>[],
  listed: readonly ListOutcome[],
  notSeen: readonly { signature: string; finding: Finding }[],
): { catalog: CatalogTool[]; findings: Finding[]; reach: Reach } {
  const catalog: CatalogTool[] = [];
  const findings: Finding[] = notSeen.map((n) => n.finding);
  const missing = new Map<string, Finding>(notSeen.map((n) => [n.signature, n.finding]));
  let servers = 0;
  let tools = 0;
  const clients: string[] = [];
  groups.forEach((g, i) => {
    const r = listed[i];
    if (r === undefined) return;
    if (r.ok) {
      servers += 1;
      tools += distinct(r.tools.map((t) => t.tool)).length;
      for (const e of g.entries) {
        catalog.push(...toolsFor(r.tools, e));
        clients.push(e.client);
      }
    } else {
      if (!missing.has(g.signature)) missing.set(g.signature, r.finding);
      for (const e of g.entries) findings.push(findingFor(r.finding, g.first, e));
    }
  });
  const not_started = { remote: 0, timed_out: 0, other: 0 };
  for (const f of missing.values()) not_started[notInPicture(f)] += 1;
  return { catalog, findings, reach: { servers, tools, clients: distinct(clients).length, not_started } };
}

/** `--color` / `--no-color` when given; otherwise on for a terminal with NO_COLOR unset (no-color.org: set and non-empty). */
export function colourOn(args: Pick<ParsedArgs, 'color'>, ctx: Pick<CliContext, 'env' | 'stdoutTTY'>): boolean {
  if (args.color !== undefined) return args.color;
  const noColor = ctx.env['NO_COLOR'];
  return ctx.stdoutTTY === true && (noColor === undefined || noColor === '');
}

/** The terminal's columns clamped to [80, 120]; 80 for anything that is not a terminal. */
export function widthOf(ctx: Pick<CliContext, 'stdoutTTY' | 'columns'>): number {
  if (ctx.stdoutTTY !== true || ctx.columns === undefined || !Number.isFinite(ctx.columns)) return MIN_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(ctx.columns)));
}

/** A folder as a person types it from `cwd`: `./ziffer-scan/`, or the whole path when it is elsewhere. */
export function folderShown(dir: string, cwd: string): string {
  const base = resolve(cwd);
  const d = resolve(dir);
  if (d === base) return `.${sep}`;
  return d.startsWith(`${base}${sep}`) ? `.${sep}${d.slice(base.length + 1)}${sep}` : `${d}${sep}`;
}

/** Whether `dir` is inside a git work tree: a `.git` in it or above it. No git command is run. */
export function inGitWorkTree(dir: string): boolean {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.git'))) return true;
    const up = dirname(d);
    if (up === d) return false;
    d = up;
  }
}

/**
 * Start every server, START_CONCURRENCY at a time, and say so on stderr
 * (ACP-454: the first real run sat silent for minutes). One line before, a
 * count per batch (rewritten in place on a terminal), one line after. stdout is
 * untouched, so `--json` stays one document.
 */
async function startAll(servers: readonly Parameters<typeof listServerTools>[0][], timeoutMs: number, ctx: CliContext) {
  const n = servers.length;
  if (n === 0) return [];
  const at = Math.min(START_CONCURRENCY, n);
  ctx.prompt(`starting ${n} server${n === 1 ? '' : 's'}, ${at} at a time, ${Math.round(timeoutMs / 1000)} s each…\n`);
  let answered = 0;
  let failed = 0;
  const counts = (): string => `${answered} answered · ${failed} did not start`;
  const listed = await mapBounded(servers, START_CONCURRENCY, async (s) => {
    const r = await listServerTools(s, timeoutMs);
    if (r.ok) answered += 1;
    else failed += 1;
    const done = answered + failed;
    if (ctx.stderrTTY === true) ctx.prompt(`\r\u001b[K  ${done} of ${n} · ${counts()}`);
    else if (done < n && done % START_CONCURRENCY === 0) ctx.prompt(`  ${done} of ${n} · ${counts()}\n`);
    return r;
  });
  ctx.prompt(`${ctx.stderrTTY === true ? '\r\u001b[K' : ''}${counts()}\n\n`);
  return listed;
}

/**
 * The policy folder `--ci` was given, in the one spelling the result prints.
 * The template's workflow passes `$POLICY_DIR`, which it ships as `policy/`, and
 * a person types `policy` or `./policy`: all three are one folder, and the JSON
 * field `policy_dir`, the `Policy:` line and the fix line each printed the
 * spelling they were handed. A leading `./` and one trailing `/` are dropped;
 * nothing else is rewritten, so `..` and symbolic links keep their meaning, and
 * `/` and `.` stay as they are.
 */
export function policyDirName(value: string): string {
  let name = value;
  while (name.startsWith('./') && name.length > 2) name = name.slice(2);
  if (name.length > 1 && name.endsWith('/')) name = name.slice(0, -1);
  return name;
}

async function runCi(policyDir: string, args: ParsedArgs, io: CliIo, ctx: CliContext): Promise<number> {
  const engine = await engineFrom(ctx);
  const result = await runCiScan(engine, {
    policyDir,
    base: ctx.cwd,
    cwd: args.cwd ?? '.',
    platform: args.platform ?? platformOf(ctx.platform),
    env: ctx.env,
    ...(args.timeout === undefined ? {} : { timeoutMs: args.timeout * 1000 }),
    write: ctx.prompt,
    stdin: ctx.stdin,
    isTTY: ctx.isTTY,
  });
  if (args.json) io.out(renderCiJson(result));
  else for (const line of renderCi(result)) io.out(line);
  return result.exit_code;
}

async function runReplayOnly(args: ParsedArgs, io: CliIo, ctx: CliContext): Promise<number> {
  const engine = await engineFrom(ctx);
  const result = await replay(engine, { now: Math.floor(ctx.now().getTime() / 1000) });
  if (args.json) io.out(sortedJson(result).trimEnd());
  else for (const line of renderReplay(result).split('\n')) io.out(line);
  return 0;
}

/** `--code` from a folder that is not a codebase: the only thing asked for cannot be read. */
export class NoCodebase extends Error {
  override readonly name = 'NoCodebase';
}

/** The line printed when the codebase half is skipped because the folder is the home directory or `/`: the preamble's own. */
export const NO_CODEBASE_LINE = PREAMBLE_NO_CODEBASE;

/**
 * Whether `dir` is a folder no codebase scan should walk: the filesystem root,
 * or a home directory (the user's, or the one `--home` names). Walking either
 * reads every project the person has, and every dependency tree under them.
 */
export function notACodebase(dir: string, homes: readonly string[]): boolean {
  const d = resolve(dir);
  return dirname(d) === d || homes.some((h) => resolve(h) === d);
}

/** The codebase half: both front ends over `root`, merged. Progress on stderr; the front ends' own log lines only under `--code`. */
async function readCodebase(root: string, args: ParsedArgs, io: CliIo, ctx: CliContext): Promise<CodeCatalog> {
  const log = args.code === true ? (line: string): void => io.err(redactText(`  ${line}`)) : (): void => undefined;
  const t0 = performance.now();
  const [ts, py] = await Promise.all([scanCode(root, { log }), scanPython(root, { log })]);
  const catalog = mergeCatalogs(ts, py);
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  ctx.prompt(`Found ${catalog.tools.length} tool${catalog.tools.length === 1 ? '' : 's'} in ${catalog.files_read} file${catalog.files_read === 1 ? '' : 's'} of your code (${s} s).\n\n`);
  return catalog;
}

/** The installed-tools half: discovery, the confirmation, one start per program, the catalog and its findings. */
async function readInstalled(args: ParsedArgs, ctx: CliContext, cwd: string, home: string): Promise<InstalledHalf> {
  const platform = args.platform ?? platformOf(ctx.platform);
  const found = discover(platform, home, cwd, ctx.env);
  // One start per program, however many clients configure it (ACP-454): the
  // listing, the start and the counts all read these groups.
  const groups = groupBySignature(found.servers);
  await confirmSpawn(groups, { yes: args.yes, isTTY: ctx.isTTY, input: ctx.stdin, write: ctx.prompt });
  const timeoutMs = args.timeout === undefined ? DEFAULT_TIMEOUT_MS : args.timeout * 1000;
  const listed = await startAll(
    groups.map((g) => g.first),
    timeoutMs,
    ctx,
  );
  const { catalog, findings, reach } = fanOut(groups, listed, notScanned(found.skipped, found.unreadable));
  return { clients_scanned: found.clients_checked, clients_not_covered: found.not_covered, catalog, findings, reach };
}

/**
 * ONE scan (ACP-455, 0.3.0): the codebase under --cwd, then the AI tools
 * installed on this machine, ONE draft policy over every tool found, the code
 * tools graded by the engine against it, the replay against it, one result.
 * `--code` skips the installed tools; `--no-code` skips the codebase, and so
 * does a run from the home directory or `/`, with one line saying so.
 */
async function runScan(args: ParsedArgs, io: CliIo, ctx: CliContext): Promise<number> {
  const now = ctx.now();
  const home = resolve(args.home ?? ctx.home);
  const cwd = resolve(args.cwd ?? ctx.cwd);
  const out = resolve(ctx.cwd, args.out ?? DEFAULT_OUT);
  const installedOn = args.code !== true;
  const skipCodebase = args.noCode !== true && notACodebase(cwd, [ctx.home, home]);
  if (skipCodebase && args.code === true) throw new NoCodebase(`${cwd} is a home directory or the filesystem root; pass --cwd <your project folder>`);
  const codeRoot = args.noCode === true || skipCodebase ? undefined : cwd;

  // --report's paths are refused before anything is read or started.
  if (args.report === true) assertOutputsFree(out, { code: false, report: true });

  // The engine first: a run that cannot generate or grade anything must refuse
  // before it reads a file or starts a single server.
  const engine = await engineFrom(ctx);

  const color = colourOn(args, ctx);
  const width = widthOf(ctx);
  // What the scan is and does, before anything (ACP-454), on stderr.
  ctx.prompt(
    `${renderPreamble({ color, width, yes: args.yes, reads: { ...(codeRoot === undefined ? {} : { code: codeRoot }), installed: installedOn, noCodebase: skipCodebase } }).join('\n')}\n`,
  );

  // The codebase first: it reads files and starts nothing.
  let code = codeRoot === undefined ? undefined : await readCodebase(codeRoot, args, io, ctx);
  if (code !== undefined && installedOn && code.files_read === 0 && code.tools.length === 0) {
    // A folder with no source in it is not a codebase: no empty application section.
    ctx.prompt(`No TypeScript or Python source under ${codeRoot ?? cwd}; only the installed AI tools are graded.\n\n`);
    code = undefined;
  }
  // Every output path is refused before a server starts: the codebase half
  // only read files, and whether it writes ziffer-tools.json is known now.
  assertOutputsFree(out, { code: code !== undefined, report: args.report === true });
  const installed = installedOn ? await readInstalled(args, ctx, cwd, home) : undefined;

  const codeSkipped = code !== undefined ? undefined : skipCodebase ? 'no-codebase' : 'skipped-flag';
  // The skills and instruction files, read as text under the same root, only when the code half ran;
  // the code's own loads of them (ACP-460) find the ones no name or shape gives away.
  const skills = code === undefined || codeRoot === undefined ? undefined : readSkills(codeRoot, code.skill_loads);
  const one = await oneScan(
    {
      ...(code === undefined ? {} : { code }),
      ...(installed === undefined ? {} : { installed }),
      ...(codeSkipped === undefined ? {} : { codeSkipped }),
      ...(skills === undefined ? {} : { skills }),
    },
    engine,
    { now, out },
  );
  // The cross-check needs the verdicts, which exist only now: each tool a skill declares, against the code's tools (ACP-460).
  if (one.result.skills !== undefined && one.result.code !== undefined) one.result.skills = joinDeclared(one.result.skills, one.result.code);
  const homes = [home, ctx.home];
  const written = await writeScan(one, {
    engine,
    out,
    now,
    ...(args.report === true ? { report: true } : {}),
    // --code has no replay: the eight cases are injected into an AI tool's session, and --code read none.
    replay: args.replay && installedOn,
    homes,
  });
  const replayed = written.replayed;
  const review = written.report;

  if (args.json) {
    io.out(sortedJson(review === undefined ? written.document : { ...(isObject(written.document) ? written.document : {}), review }).trimEnd());
    return 0;
  }

  const policyLines = [
    `  Draft policy: ${out} (${one.bundle.files.length} files).`,
    '  Signed by a key made for this run and discarded: a draft to review, not a policy to deploy.',
    ...(written.tools === undefined
      ? []
      : [`  The snippet reads the tool keys from ${written.tools}; deploy that file with your application, or set ZIFFER_TOOLS_FILE.`]),
    '  Review and sign it off:',
  ];
  const wroteDir = dirname(out);
  const wroteItems = [
    out,
    ...(replayed === undefined ? [] : [join(wroteDir, OWN_FILE)]),
    written.tools ?? '',
    written.json ?? '',
    ...(review === undefined ? [] : [review.report, review.archive]),
  ].filter((p) => p !== '' && existsSync(p)).length;
  const shown = {
    full: args.full,
    color,
    width,
    cwd: ctx.cwd,
    open: ctx.platform === 'darwin',
    policy: { path: out, files: one.bundle.files.length },
    wrote: { dir: folderShown(wroteDir, ctx.cwd), items: wroteItems, gitWorkTree: inGitWorkTree(wroteDir) },
  };
  // Everything printed passes the redaction (ACP-449): the report from a
  // redacted copy of the result so its wrapping is measured on what is printed.
  const shownResult = redactResult(one.result);
  const shownWithReview = review === undefined ? shownResult : { ...shownResult, review };
  const report = renderTerminal(shownWithReview, replayed === undefined ? shown : { ...shown, replay: replayed })
    .trimEnd()
    .split('\n');
  for (const line of report) {
    if (line === POLICY_PATH_TOKEN) for (const p of policyLines) io.out(p);
    else io.out(line);
  }
  // The replay table is --full's: the one screen carries its two-line summary (ACP-452).
  if (replayed !== undefined && args.full) {
    io.out('');
    const note =
      `The ${replayed.rows.length} cases are the injected instructions from ZIFFER's test harness; the policy in ` +
      'column B is the one this scan just generated. A case whose tool that policy does not name is refused before anything is graded.';
    for (const line of renderReplay(replayed, { policyLabel: 'with the generated policy', note }).split('\n')) io.out(redactText(line));
  }
  return 0;
}

export async function run(argv: readonly string[], io: CliIo, ctx: CliContext = processContext()): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err(HELP);
      return 2;
    }
    throw error;
  }
  if (args.help) {
    io.out(HELP);
    return 0;
  }
  if (args.version) {
    io.out(packageVersion());
    return 0;
  }
  try {
    if (args.ci !== undefined) return await runCi(args.ci, args, io, ctx);
    return args.command === 'replay' ? await runReplayOnly(args, io, ctx) : await runScan(args, io, ctx);
  } catch (error) {
    const line = redactText(refusalLine(error));
    io.err(line);
    const name = line.slice(0, line.indexOf(':'));
    return NAMED_REFUSALS.has(name) || (error instanceof Error && NAMED_REFUSALS.has(error.name)) ? 2 : 1;
  }
}
