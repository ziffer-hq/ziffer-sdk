/**
 * `scan` — the local scan of this machine, as a tool (ACP-446 step 2).
 *
 * `@ziffer-io/scan` is imported as a LIBRARY and nothing of it is restated
 * here: discovery, the confirmation listing, the redaction, the policy
 * generator, the replay and the report are all the package's own, so the tool
 * and `npx @ziffer-io/scan` cannot disagree about what a scan is.
 *
 * # Two calls, because the scan STARTS PROGRAMS
 *
 * Asking an MCP server for its tools means starting it, and starting it runs a
 * program from a configuration file this package did not write. On a terminal
 * the scan prints the exact list and asks `[y/N]`. A tool has no terminal, and
 * the one party that could answer `y` on the developer's behalf is the AI agent
 * calling the tool — which is the party the question exists to stop. So the
 * question becomes a second call:
 *
 *   * without `confirm: true` the tool runs discovery and the scan's own
 *     confirmation gate (`confirmSpawn`) with no terminal and no `--yes`. The
 *     gate prints the redacted list and then refuses `NotInteractive` BEFORE
 *     anything is started; the tool returns that list and the sentence to call
 *     again. No server starts, no engine runs, no file is written;
 *   * with `confirm: true` it runs the scan's `run` with `--yes`, exactly as a
 *     person who read the list and typed `y` would have.
 *
 * `scan.test.ts` asserts the first call starts nothing with a server that
 * writes a file the moment it starts, and asserts the same server DOES write
 * it under `confirm: true` — the check that the probe can see a start at all.
 *
 * # What it writes, and why that moved this package's boundary
 *
 * The draft policy folder, and beside it the forwardable report, the JSON
 * document and the review archive (`--report`). By default all of that goes
 * into a fresh directory under the system temporary directory, never into the
 * developer's project, because a policy dropped into a repository is policy
 * committed on somebody's behalf. `out` puts the folder where the caller says.
 *
 * # Why `--report` rather than two runs
 *
 * The tool returns the one-screen report AND the JSON result. Two runs of the
 * command (one `--json`, one plain) would start every server twice and write
 * two policy folders signed by two different discarded keys, so the text and
 * the JSON would describe different policies. `--report` makes ONE run print
 * the one screen and write the JSON document beside the folder, from the same
 * redacted result. Its JSON has home paths shown from `~`, which is the form
 * this answer should carry anyway.
 *
 * Nothing leaves the machine: the only processes started are the servers the
 * list names, the only request sent to them is the tool list, and no model is
 * asked anything.
 *
 * # The codebase half, and ONE scan (ACP-455)
 *
 * The same call also reads the project the agent works in (`root`: the `cwd`
 * argument, or the client's first root) through `scan-code.ts`'s one adapter.
 * Reading code starts no tool server (Python is read by this machine's own
 * Python on the package's reader), so before confirmation (and whenever
 * `include_installed` is false) the codebase is scanned alone with `--code`
 * and the first call already returns it. The CONFIRMED call is one run of the
 * scan's default command over both halves, exactly `npx @ziffer-io/scan`:
 * one draft policy, one `ziffer-tools.json`, one report, one archive. It does
 * not also run the codebase alone, which is how a confirmed call used to write
 * two draft policies for one application. `structured.scope` is the run's own
 * `ScanResult.scope`: which half it read, and which it did not.
 *
 * Both phases look for project-level MCP configurations in the SAME folder
 * (the project, else the directory this server started in), so the confirmed
 * run starts exactly the servers the first call listed. `scan-remedy.ts`
 * writes the fix the agent gives.
 */

import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import {
  confirmSpawn,
  DEFAULT_TIMEOUT_MS,
  discover,
  locateWasm,
  processContext,
  refusalLine,
  run,
  SpawnRefused,
  type CliContext,
  type Platform,
} from '@ziffer-io/scan';

import type { Env } from './config.js';
import { freshOut, scanOnce, type CodebaseScan, type OneRun, type ScanScope } from './scan-code.js';
import { codebaseText, codebaseView, HOW_TO_PRESENT, remediation } from './scan-remedy.js';
import type { ToolOutcome } from './tools.js';

/** The file `--report` writes beside the policy folder. The scan's own `HELP`
 * names it, and `scan.test.ts` asserts it still does, so a rename there is a
 * red suite here rather than a tool that points at a file nobody wrote. */
export const SCAN_JSON_FILE = 'ziffer-scan.json';

/** The scan's own default, in the unit the tool takes, so the description
 * cannot state a number the scan does not use. */
export const SCAN_DEFAULT_TIMEOUT_SECONDS = DEFAULT_TIMEOUT_MS / 1000;

/** What the tool is called with. */
export interface ScanArgs {
  readonly confirm?: boolean | undefined;
  readonly out?: string | undefined;
  readonly timeout_seconds?: number | undefined;
  /** The project to read, absolute: the `cwd` argument, else the MCP client's first root (`server.ts`). */
  readonly root?: string | undefined;
  /** Default true: also the installed MCP servers, behind the two-call confirmation. */
  readonly include_installed?: boolean | undefined;
  /** Default true: the codebase half also writes the HTML report and the review archive. */
  readonly report?: boolean | undefined;
}

/** A scan's answer: the text the agent reads first, the same result as data,
 * and the codebase scan kept for `explain_scan_finding`. */
export interface ScanOutcome extends ToolOutcome {
  readonly structured: Record<string, unknown>;
  readonly codebase?: CodebaseScan;
}

/**
 * Where the scan looks. Production reads this process: the developer's home
 * and the directory the AI agent client started this server in. A test points
 * `home` at a fixture home.
 */
export interface ScanSetup {
  readonly env: Env;
  readonly home?: string;
  readonly cwd?: string;
  readonly platform?: string;
  readonly now?: () => Date;
}

const PLATFORMS: readonly Platform[] = ['darwin', 'linux', 'win32'];

function isPlatform(value: string): value is Platform {
  return PLATFORMS.some((p) => p === value);
}

/**
 * The scan's context with no terminal: `isTTY` false and an empty stdin, so the
 * confirmation gate can never read an answer from the MCP transport (which IS
 * this process's stdin), and the listing it prints lands in `prompted` instead
 * of on stderr.
 */
function context(setup: ScanSetup, prompted: string[]): CliContext {
  const base = processContext();
  return {
    ...base,
    env: setup.env,
    platform: setup.platform ?? base.platform,
    home: setup.home ?? base.home,
    cwd: setup.cwd ?? base.cwd,
    stdin: Readable.from([]),
    isTTY: false,
    prompt: (text) => prompted.push(text),
    now: setup.now ?? base.now,
  };
}

const CALL_AGAIN =
  'Nothing was started. Show this list to the developer; if they agree, call scan again with ' +
  'confirm: true. That starts the servers above, asks each one for its list of tools and nothing ' +
  'else, and writes a draft agent authorization policy. Nothing leaves this machine.';


/** One half's answer: its text, and the same as data for structured content. */
interface Part extends ToolOutcome {
  readonly data: Record<string, unknown>;
}

const failed = (text: string): Part => ({ text, isError: true, data: { status: 'failed', refusal: text } });

/**
 * The folder whose project-level MCP configurations both phases read: the
 * project, else the directory this server started in. ONE function, so the
 * confirmed run cannot start a server the listing did not show.
 */
function lookIn(setup: ScanSetup, args: ScanArgs): ScanSetup {
  return args.root === undefined ? setup : { ...setup, cwd: args.root };
}

/** Phase one: discovery and the scan's own gate, and nothing past the gate. */
async function listing(setup: ScanSetup): Promise<Part> {
  const prompted: string[] = [];
  const ctx = context(setup, prompted);
  const platform = ctx.platform;
  if (!isPlatform(platform)) {
    return failed(`PlatformUnknown: this machine reports ${platform}; the scan reads darwin, linux or win32`);
  }
  try {
    // Refused here rather than after the developer said yes: a scan that
    // cannot generate or grade anything says so before it asks.
    locateWasm(ctx.env);
    const found = discover(platform, resolve(ctx.home), resolve(ctx.cwd), ctx.env);
    try {
      // The gate, with no terminal and no --yes: it writes the list, then
      // refuses NotInteractive before a single spawn. That refusal is the
      // expected answer here, and the only one.
      await confirmSpawn(found.servers, { yes: false, isTTY: false, input: ctx.stdin, write: (text) => prompted.push(text) });
    } catch (error) {
      if (!(error instanceof SpawnRefused && error.name === 'NotInteractive')) throw error;
    }
    const lines: string[] = ['scan: what the local scan would start. Nothing has been started yet.', ''];
    lines.push(`AI agent clients checked on this machine: ${found.clients_checked.join(', ') || 'none'}.`);
    if (found.not_covered.length > 0) lines.push(`Not covered by the scan: ${found.not_covered.join(', ')}.`);
    lines.push('');
    if (found.servers.length === 0) {
      lines.push('No tool server was found that the scan could start.');
      lines.push('Calling scan with confirm: true still writes a draft agent authorization policy, with no tools in it.');
    } else {
      lines.push(prompted.join('').trimEnd());
      lines.push('');
      lines.push(CALL_AGAIN);
    }
    const others = found.skipped.length + found.unreadable.length;
    if (others > 0) {
      lines.push('');
      lines.push(
        `${others} more configured server${others === 1 ? ' is' : 's are'} not started by the scan (remote, or ` +
          'not runnable here); the report after the scan names each one.',
      );
    }
    const text = lines.join('\n');
    return {
      text,
      isError: false,
      data: {
        status: found.servers.length === 0 ? 'nothing_to_start' : 'awaiting_confirmation',
        started: false,
        would_start: prompted.join('').trimEnd(),
        clients_checked: found.clients_checked,
        next: found.servers.length === 0 ? 'nothing to confirm' : CALL_AGAIN,
      },
    };
  } catch (error) {
    return failed(refusalLine(error));
  }
}

/** The installed half of a confirmed run: the one screen the scan printed, and its JSON. */
function installedPart(r: OneRun): Part {
  const json = JSON.stringify(r.document, null, 2);
  const text = [...r.report, '', `Policy folder: ${r.out}`, `JSON result: ${r.json}`, '', json].join('\n');
  return { text, isError: false, data: { status: 'scanned', started: true, report: r.report, policy: r.out, json: r.json, result: r.document } };
}

const NO_ROOT =
  'The codebase was not scanned: this MCP client offers no roots and the call named no cwd. Call scan again with ' +
  'cwd set to the project directory you are working in.';

/** Why a run that was asked for the codebase has no codebase section, in the scan's own terms. */
function notScanned(root: string | undefined, scope: ScanScope | undefined): Part {
  const reason =
    root === undefined
      ? NO_ROOT
      : scope?.code === 'no-codebase'
        ? `The codebase was not scanned: ${root} is a home directory or the filesystem root. Call scan again with cwd set to the project directory.`
        : `The codebase was not scanned: no TypeScript or Python source was found under ${root}.`;
  return { text: reason, isError: root === undefined, data: { status: 'not_scanned', reason } };
}

/** The codebase half of a run, when it read one. */
function codebaseOf(scan: CodebaseScan): Part {
  return { text: codebaseText(scan, remediation(scan)).join('\n'), isError: false, data: codebaseView(scan) };
}

interface Halves {
  readonly code: Part;
  readonly installed: Part;
  readonly scan?: CodebaseScan;
  readonly scope?: ScanScope;
}

/** The codebase alone, with `--code`: reading code starts no tool server, so it needs no confirmation. */
async function codeOnly(setup: ScanSetup, args: ScanArgs, installed: Part): Promise<Halves> {
  if (args.root === undefined) return { code: notScanned(undefined, undefined), installed };
  try {
    const ctx = context({ ...setup, cwd: args.root }, []);
    const r = await scanOnce({ root: args.root, installed: false, report: args.report !== false, out: freshOut(ctx.now()), ctx });
    const scope = r.scope === undefined ? {} : { scope: r.scope };
    if (r.codebase === undefined) return { code: notScanned(args.root, r.scope), installed, ...scope };
    return { code: codebaseOf(r.codebase), installed, scan: r.codebase, ...scope };
  } catch (error) {
    return { code: failed(refusalLine(error)), installed };
  }
}

/**
 * Phase two: ONE run, `--yes`, as the person who read the list and typed `y`:
 * the codebase (when there is a project) and the installed servers, one policy.
 */
async function oneRun(setup: ScanSetup, args: ScanArgs): Promise<Halves> {
  const base = context(setup, []);
  const ctx = context(lookIn(setup, args), []);
  try {
    const r = await scanOnce({
      root: args.root,
      installed: true,
      report: args.report !== false,
      // `out` is the caller's, relative to where this server started; the default
      // is a fresh folder under the system temporary directory.
      out: args.out === undefined ? freshOut(ctx.now()) : resolve(base.cwd, args.out),
      timeoutSeconds: args.timeout_seconds,
      ctx,
    });
    const installed = installedPart(r);
    const scope = r.scope === undefined ? {} : { scope: r.scope };
    if (r.codebase === undefined) return { code: notScanned(args.root, r.scope), installed, ...scope };
    return { code: codebaseOf(r.codebase), installed, scan: r.codebase, ...scope };
  } catch (error) {
    const f = failed(refusalLine(error));
    return { code: args.root === undefined ? notScanned(undefined, undefined) : f, installed: f };
  }
}

/**
 * `scan` — the codebase under `root` (no confirmation: it starts no tool server), and,
 * unless `include_installed` is false, the installed MCP servers: phase one
 * without `confirm: true`, the whole installed scan with it.
 */
export async function scanTool(setup: ScanSetup, args: ScanArgs): Promise<ScanOutcome> {
  const installedAsked = args.include_installed !== false;
  if (!installedAsked && args.root === undefined) {
    const text = `ScanCwdRequired: ${NO_ROOT}`;
    return { text, isError: true, structured: { codebase: { status: 'not_scanned', reason: text } } };
  }
  const confirmed = installedAsked && args.confirm === true;
  const halves: Halves = confirmed
    ? await oneRun(setup, args)
    : await codeOnly(
        setup,
        args,
        installedAsked ? await listing(lookIn(setup, args)) : { text: '', isError: false, data: { status: 'not_requested' } },
      );
  const { code, installed, scan } = halves;
  // Which half this call scanned, as the run itself states it (`ScanResult.scope`):
  // before confirmation the run is `--code`, so it says `installed: false`. No
  // run, no scope: each half's `status` then says why nothing was read.
  const scope = halves.scope;

  const structured: Record<string, unknown> = {
    phase: installedAsked && !confirmed ? 'listing' : 'complete',
    ...(scope === undefined ? {} : { scope }),
    ...(scan === undefined ? {} : { counts: scan.section.counts, remediation: remediation(scan), how_to_present: HOW_TO_PRESENT }),
    codebase: code.data,
    installed: installed.data,
  };
  const sections = [`CODEBASE\n${code.text}`];
  if (installedAsked) sections.push(`INSTALLED MCP SERVERS\n${installed.text}`);
  // An error only when every half that was asked for failed: a codebase
  // refusal beside a good installed listing is a finding to read, not a
  // malfunction to route around.
  const isError = code.isError && (!installedAsked || installed.isError);
  return {
    text: sections.join('\n\n'),
    isError,
    structured,
    ...(scan === undefined ? {} : { codebase: scan }),
  };
}
