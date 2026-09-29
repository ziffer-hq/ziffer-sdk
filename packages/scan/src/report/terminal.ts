/**
 * The terminal report of `ziffer-scan` (ACP-439).
 *
 * Six sections, in the order a stranger needs them: which AI agent clients were
 * read and which were NOT, the tool servers, the tools with their DRAFT
 * classification, the findings with the dossier rows they cite, a count table,
 * and what to do next. Every word it prints is either data the scan gathered,
 * a status word the dossier states (see `controls.ts`), or copy in this file
 * that says only what the code can back. There is no score: the blast-radius
 * table is counts, because a score would be a grading rule, and the only
 * grading rules live in the engine.
 *
 * Clause ids appear only on the `Controls:` lines (and in `--json`). A sentence
 * a person reads never carries one; `terminal.test.ts` asserts it.
 */

import type { CatalogTool, Classification, ControlRef, Finding, ScanResult, SkillRead } from '../types.js';
import { highInstructions, pairsLine, skillsSummary } from './instructions.js';
import { configuredPhrase } from '../discovery/group.js';
import { ANNEX, type AnnexSource } from './annex.js';
import { statusWords } from './controls.js';
import type { ReplayOutcome } from '../replay/replay.js';
import { hasOwnCase, hasReview, isOwnAbsent, ownOf } from './own.js';
import { loadReplayData, type PlainWords } from '../replay/data.js';
import { UNSIGNED_DEMO_LINE } from '../replay/replay.js';
import type { CodeSection, CodeToolVerdict } from '../code/types.js';
import { whatZifferDoes } from '../code/grade.js';
import { BOOK_TEXT, BOOK_URL, codeExecSummary, MARKED_IRREVERSIBLE, mcpExecSummary, type ExecBullet, type ExecSummary } from './exec.js';
import {
  andList,
  appName,
  countsSentence,
  exposureGrade,
  exposureSentences,
  gradeSentence,
  gradeShort,
  gradeTitle,
  groupOf,
  groupWords,
  plainLead,
  plainNote,
  frameworkRows,
  insertionCall,
  isHeld,
  isNotified,
  notifiedCount,
  notifiedPhrase,
  listedSentence,
  loadCodeSdks,
  NOT_READ_YET,
  numbersSentence,
  plainNumbersSentence,
  sortedVerdicts,
  where,
  type CodeSdkEntry,
} from './code.js';
import { bypassPaths, callerChecks, entryFunction, uncheckedCallers } from './paths.js';

export interface TerminalOptions {
  /**
   * ANSI colour. The CLI turns it on for a terminal (ACP-454: the first real run
   * printed one grey screen); off here unless asked for. Colour never changes the
   * text: stripped of its escapes, a coloured rendering equals the plain one.
   */
  color?: boolean;
  /** Columns to wrap at. 80 unless given; the CLI passes the terminal's, clamped to [80, 120]. */
  width?: number;
  /** The dossier rows the status words are read from; the generated data unless a test passes its own. */
  source?: AnnexSource;
  /** `--full`: the complete report after the one screen (ACP-452). */
  full?: boolean;
  /** The replay this run made, summarised in two lines on the one screen. Absent under `--no-replay`. */
  replay?: ReplaySummary;
  /** The plain words for a refusal; `data/replay/plain-words.json` unless a test passes its own. */
  words?: PlainWords;
  /** The draft policy this run wrote, for the one screen's NEXT. Absent: the one screen prints POLICY_PATH_TOKEN, as the full report does. */
  policy?: { path: string; files: number };
  /** The folder this run wrote into and how many items it put there (ACP-454), for the line after the header. */
  wrote?: { dir: string; items: number; gitWorkTree: boolean };
  /** The directory the scan ran from: a path under it is shown relative, as a person types it. */
  cwd?: string;
  /** Prefix the report's path with `open` (macOS), so the NEXT line is a command. */
  open?: boolean;
  /** The framework table `--code` reads coverage from; `data/code-sdks.json` unless a test passes its own. */
  codeSdks?: readonly CodeSdkEntry[];
}

/**
 * What the one screen reads of a replay: the outcome of each case, the quorum,
 * and the own case. Structural, so the replay module's `ReplayResult` is
 * assignable to it without this file restating that type.
 */
export interface ReplaySummary {
  rows: readonly { outcome: { kind: 'refused' | 'held' | 'allowed'; stage?: 'grammar' | 'engine' } }[];
  quorum_k: number;
}

/** Filled by the replay/bundle modules with the path of the draft policy they write. */
export const POLICY_PATH_TOKEN = '{policy_path}';
/** The sign-off review page. PROVISIONAL: the session confirms the URL before release. */
export const REVIEW_URL = 'https://ziffer.io/review';
/** What comes after the review (ACP-446): the MCP server, which is how the AI
 * agent a developer codes with integrates the policy once it is signed off. */
export const MCP_NEXT = 'Then add the ZIFFER MCP server, @ziffer-io/mcp, to the AI agent you code with.';

export const CANNOT_SEE =
  'This scan reads only the MCP configuration files on this machine. It does not yet read the ' +
  'tools your own application defines for a model in its code. It cannot see change management, ' +
  'incident reporting, who holds your signing keys, what a model was trained on, or any tool an ' +
  'AI agent reaches some other way.';
/** What the scan cannot see when `--code` read the application too: the first sentence no longer holds, the rest does. */
export const CANNOT_SEE_WITH_CODE =
  'This scan reads the MCP configuration files on this machine and the code of the application it was pointed at. ' +
  'It cannot see change management, incident reporting, who holds your signing keys, what a model was trained on, ' +
  'or any tool an AI agent reaches some other way.';
/** The standing limits, for a result with or without the application's code. */
export function cannotSee(result: ScanResult): string {
  return result.code === undefined ? CANNOT_SEE : CANNOT_SEE_WITH_CODE;
}
/** The one screen's blind-spot line for the application's own tools, when `--code` did not run. */
export const APP_TOOLS_NOT_YET =
  'Tools your own application defines for a model in its code are not in this picture yet';

/** Where a Controls line's continuation starts, so a reader's eye and the test can both find it. */
export const CONTROLS_LABEL = 'Controls: ';
const FINDING_INDENT = '        ';
export const CONTROLS_CONTINUATION = FINDING_INDENT + ' '.repeat(CONTROLS_LABEL.length);

/** "  No configuration found:  " -- the longest CLIENTS label and two spaces. */
const CLIENT_LABEL_WIDTH = 27;
/** Where a SERVERS row's path starts: four spaces, the name (18), the tool count (10). */
const SERVER_PATH_COLUMN = 32;
/** Where TOOLS' `because` column starts: the row (4 + 24 + 14 + 25 + "draft") and two spaces. */
const BECAUSE_COLUMN = 74;

const SEVERITY_ORDER: Record<Finding['severity'], number> = { high: 0, warn: 1, info: 2 };
const SEVERITY_LABEL: Record<Finding['severity'], string> = { high: 'HIGH', warn: 'WARN', info: 'INFO' };

/**
 * The palette (ACP-454). ZIFFER orange is #E8531E, ANSI 256 colour 202, for the
 * wordmark and the headings; red for HIGH and what cannot be undone; amber for
 * WARN and HELD; green for what the policy refused or allowed; dim for paths
 * and the engine line.
 */
export const COLOUR = {
  brand: '1;38;5;202',
  heading: '1;38;5;202',
  high: '31',
  warn: '33',
  info: '36',
  ok: '32',
  dim: '2',
  bold: '1',
} as const;
const SEVERITY_COLOUR: Record<Finding['severity'], string> = { high: COLOUR.high, warn: COLOUR.warn, info: COLOUR.info };

type Paint = (code: string, text: string) => string;
function painter(color: boolean): Paint {
  return (code, text) => (color && text !== '' ? `\u001b[${code}m${text}\u001b[0m` : text);
}

/** `text` without its ANSI escapes: what a coloured rendering reads as. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Wrap `text` to `width`, first line prefixed by `first`, the rest by `rest`.
 * Words are never split, and "AI" is never left at a line's end: "AI agent"
 * is one term in this copy, and a break inside it prints a bare "agent"
 * (ACP-454: "from 7 AI agent clients" broke there at 80 columns).
 */
export function wrap(text: string, width: number, first: string, rest: string): string[] {
  const words: string[] = [];
  for (const w of text.split(/\s+/).filter((x) => x !== '')) {
    const last = words.length - 1;
    if (last >= 0 && words[last] === 'AI') words[last] = `AI ${w}`;
    else words.push(w);
  }
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const word of words) {
    const candidate = empty ? line + word : `${line} ${word}`;
    if (!empty && candidate.length > width) {
      lines.push(line);
      line = rest + word;
    } else {
      line = candidate;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

/** Join items with " · ", breaking between items only. */
function wrapItems(items: string[], width: number, first: string, rest: string): string[] {
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const item of items) {
    const candidate = empty ? line + item : `${line} · ${item}`;
    if (!empty && candidate.length > width) {
      lines.push(`${line} ·`);
      line = rest + item;
    } else {
      line = candidate;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

function pad(text: string, n: number): string {
  return text.length >= n ? `${text} ` : text + ' '.repeat(n - text.length);
}

function padStart(text: string, n: number): string {
  return text.length >= n ? text : ' '.repeat(n - text.length) + text;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function controlsLine(controls: readonly ControlRef[], source: AnnexSource = ANNEX): string[] {
  return controls.map((c) => `${c.framework} ${c.clause} — ${statusWords(c, source)}`);
}

/** The classification for one catalog entry, keyed on client + server + tool:
 *  two servers can expose one tool name, and each gets its own draft. */
function classificationOf(result: ScanResult, t: CatalogTool): Classification | undefined {
  return result.classifications.find((c) => c.client === t.client && c.server === t.server && c.tool === t.tool);
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
}

/** Every client looked for, those with a configured server, and those with no configuration here. */
function clientSplit(result: ScanResult): { looked: string[]; clients: string[]; absent: string[] } {
  const looked = clientsInOrder(result);
  const clients = looked.filter(
    (c) => result.catalog.some((t) => t.client === c) || result.findings.some((f) => f.client === c && f.server !== undefined),
  );
  return { looked, clients, absent: looked.filter((c) => !clients.includes(c)) };
}

function clientsInOrder(result: ScanResult): string[] {
  return uniq([
    ...result.clients_scanned,
    ...result.catalog.map((t) => t.client),
    ...result.findings.flatMap((f) => (f.client === undefined || result.clients_not_covered.includes(f.client) ? [] : [f.client])),
  ]);
}

/** The complete report: every section, as `--full` prints it after the one screen. */
function renderFull(result: ScanResult, opts: TerminalOptions): string {
  const width = opts.width ?? 80;
  const source = opts.source ?? ANNEX;
  const paint = painter(opts.color ?? false);
  const heading = (text: string): string => paint(COLOUR.heading, text);
  const out: string[] = [];

  out.push(`${paint(COLOUR.brand, 'ZIFFER')} scan ${result.scan_version} · ${paint(COLOUR.dim, `engine ${result.engine_pin.slice(0, 8)} · ${result.date}`)}`);
  out.push(...wrap('Everything below was computed on this machine. Nothing was sent anywhere.', width, '', ''));
  out.push('');

  // (0) the application's own tools, every verdict listed (ACP-455 `--code`)
  if (result.code !== undefined) out.push(...codeToolsFull(result.code, width, paint));

  // A code-only run has no MCP catalog: its sections would be tables of nothing.
  if (hasMcp(result)) {
    // Only clients with at least one configured server get a block in SERVERS (and
    // a row in the blast radius); the rest are counted in one line there.
    const { looked, clients, absent } = clientSplit(result);
    const others = looked.length - clients.length;

    // (1) clients: every client looked for, split the way SERVERS splits them
    // (ACP-450: "Scanned:" listed twelve clients, four with no configuration on
    // the machine, which read as twelve clients scanned).
    out.push(heading('CLIENTS'));
    const label = (text: string): string => pad(`  ${text}`, CLIENT_LABEL_WIDTH);
    const indent = ' '.repeat(CLIENT_LABEL_WIDTH);
    out.push(...wrap(clients.length === 0 ? 'none' : clients.join(', '), width, label('Configured:'), indent));
    out.push(...wrap(absent.length === 0 ? 'none' : absent.join(', '), width, label('No configuration found:'), indent));
    const notCovered = result.clients_not_covered.length === 0 ? 'none' : result.clients_not_covered.join(', ');
    out.push(...wrap(notCovered, width, label('Not covered:'), indent));
    if (result.clients_not_covered.length > 0) {
      out.push(...wrap('This scan does not read the configuration of a client that is not covered.', width, indent, indent));
    }
    out.push('');

    // (2) servers, with the servers that could not be read inline under their client.
    out.push(heading('SERVERS'));
    for (const client of clients) {
      out.push(`  ${client}`);
      const tools = result.catalog.filter((t) => t.client === client);
      const servers = uniq(tools.map((t) => `${t.server}\u0000${t.source_path}`));
      for (const key of servers) {
        const [server = '', path = ''] = key.split('\u0000');
        const n = tools.filter((t) => t.server === server && t.source_path === path).length;
        const line = `    ${pad(server, 18)}${pad(`${n} tool${n === 1 ? '' : 's'}`, 10)}${path}`;
        const fits = line.length <= width;
        if (fits) out.push(line.slice(0, SERVER_PATH_COLUMN) + paint(COLOUR.dim, line.slice(SERVER_PATH_COLUMN)));
        else out.push(`    ${pad(server, 18)}${n} tool${n === 1 ? '' : 's'}`, `      ${paint(COLOUR.dim, path)}`);
        // One row however many places configure it (ACP-450), the count under its path.
        const where = configuredPhrase(tools.find((t) => t.server === server && t.source_path === path)?.configured_in);
        if (where !== undefined) out.push(`${' '.repeat(fits ? SERVER_PATH_COLUMN : 6)}${where}`);
      }
      const unreadable = result.findings.filter(
        (f) => f.client === client && (f.kind === 'server_not_started' || f.kind === 'runtime_missing'),
      );
      for (const f of unreadable) {
        const label = f.kind === 'runtime_missing' ? 'runtime missing' : 'not started';
        out.push(...wrap(`${label}: ${f.message}`, width, `    ${pad(f.server ?? '', 18)}`, `    ${' '.repeat(18)}`));
      }
    }
    if (clients.length === 0) out.push('  No client has a tool server configured.');
    else if (others > 0) out.push(`  ${others} other client${others === 1 ? ' has' : 's have'} no tool servers configured.`);
    out.push('');

    // (3) the catalog, every classification marked draft
    out.push(heading('TOOLS'));
    out.push(...wrap('Each classification is a draft read from the tool\'s name and description. The engine decides, not this scan.', width, '  ', '  '));
    const groups = uniq(result.catalog.map((t) => `${t.client}\u0000${t.server}`));
    for (const key of groups) {
      const [client = '', server = ''] = key.split('\u0000');
      out.push(`  ${client} · ${server}`);
      const tools: CatalogTool[] = result.catalog.filter((t) => t.client === client && t.server === server);
      for (const t of tools) {
        const c = classificationOf(result, t);
        if (c === undefined) {
          out.push(`    ${pad(t.tool, 24)}${pad('unclassified', 14)}`.trimEnd());
          continue;
        }
        const flags = [c.egress ? 'egress' : '', c.untrusted_input ? 'untrusted input' : ''].filter((x) => x !== '');
        const row = `    ${pad(t.tool, 24)}${pad(c.effect, 14)}${pad(flags.join(', '), 25)}draft`;
        // The phrase the classifier matched, when it says (ACP-454): a column
        // beside the row where the width leaves room for one, under it otherwise.
        const because = reasonOf(c);
        if (because === undefined) out.push(row);
        else if (width - BECAUSE_COLUMN >= 30) out.push(...wrap(`because ${because}`, width, pad(row, BECAUSE_COLUMN), ' '.repeat(BECAUSE_COLUMN)));
        else out.push(row, ...wrap(`because ${because}`, width, '      ', '        '));
      }
    }
    if (groups.length === 0) out.push('  no tools listed');
    out.push('');

    // (4) findings, most severe first
    const findings = sortFindings(result.findings);
    out.push(heading(`FINDINGS (${findings.length}, most severe first)`));
    for (const f of findings) {
      const who = f.client === undefined ? '' : ` · ${f.client}`;
      const what = f.tools.length > 0 ? f.tools.join(' + ') : (f.server ?? f.kind.replace(/_/g, ' '));
      // Wrapped, never cut (ACP-454): a pair or a long client name runs past any width.
      const label = SEVERITY_LABEL[f.severity];
      out.push(
        ...wrap(`${what}${who}`, width, `  ${label}  `, FINDING_INDENT).map((l, i) =>
          i === 0 ? `  ${paint(SEVERITY_COLOUR[f.severity], label)}${l.slice(2 + label.length)}` : l,
        ),
      );
      out.push(...wrap(f.message, width, FINDING_INDENT, FINDING_INDENT));
      if (f.controls.length > 0) {
        out.push(...wrapItems(controlsLine(f.controls, source), width, FINDING_INDENT + CONTROLS_LABEL, CONTROLS_CONTINUATION));
      }
    }
    if (findings.length === 0) out.push('  none');
    out.push('');

    // (5) blast radius: counts per client, never a score
    out.push(heading('BLAST RADIUS (counts, not a score)'));
    const nameWidth = Math.max(16, ...clients.map((c) => c.length + 2));
    out.push(`  ${pad('client', nameWidth)}${padStart('tools', 6)}${padStart('irreversible', 14)}${padStart('egress', 8)}${padStart('pairs', 7)}`);
    for (const client of clients) {
      const tools = result.catalog.filter((t) => t.client === client);
      const classes = tools.map((t) => classificationOf(result, t));
      const irreversible = classes.filter((c) => c?.effect === 'irreversible').length;
      const egress = classes.filter((c) => c?.egress === true).length;
      const pairs = result.findings.filter((f) => f.kind === 'pair' && f.client === client).length;
      out.push(
        `  ${pad(client, nameWidth)}${padStart(String(tools.length), 6)}${padStart(String(irreversible), 14)}` +
          `${padStart(String(egress), 8)}${padStart(String(pairs), 7)}`,
      );
    }
    out.push('');
  }

  // what the scan cannot see, then (6) the last lines
  out.push(heading('WHAT THIS SCAN CANNOT SEE'));
  out.push(...wrap(cannotSee(result), width, '  ', '  '));
  out.push('');
  out.push(heading('NEXT'));
  // No CI line: `ziffer-scan --ci <policy-dir>` stood here while no code
  // implemented `--ci`, and a command the tool prints must be one it runs
  // (ACP-440). It comes back with the flag.
  out.push(POLICY_PATH_TOKEN);
  out.push(REVIEW_URL);
  out.push(MCP_NEXT);
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// The one screen (ACP-452, rebuilt by ACP-454): what a person reads top-down
// before anything else. The header and what this run wrote, what can do damage
// that cannot be undone (a table, with what that means), every other finding
// one per line (wrapped, never cut), what this scan could not see (counts), the
// replay in two lines, NEXT with the report first, where the rest is, and a
// last line that is a verb. The complete report above is `--full`.
//
// NOTHING ON THIS SCREEN IS TRUNCATED (ACP-454). The first real run cut HIGH
// findings with "+..." and hid thirty behind "and 30 more (--full)": a finding
// a person cannot read is a finding the scan did not report. The screen keeps
// its shape by grouping and short phrases instead, and every line wraps.
// ---------------------------------------------------------------------------

/** The pointer to the rest of the output, just before the last line. */
export const FULL_DETAIL = 'Full detail: ziffer-scan --full · JSON: ziffer-scan --json';
/** The last line when `--report` wrote the report: a verb, the one thing to do next. */
export const NEXT_OPEN = 'Next: open the report.';
/** The last line when it did not. */
export const NEXT_RUN = 'Next: run ziffer-scan --report.';
/** Under the irreversible table: what the table means. */
export const IRREVERSIBLE_CONSEQUENCE = 'A prompt-injected AI agent can call any of these. Nothing asks a person first.';
/** Under the findings, when one of them is a pair: what a pair means. */
export const PAIR_CONSEQUENCE = 'Each pair is one AI agent reading something an attacker can write, then acting on it.';
/** The three lines printed before the server listing, on stderr (ACP-454). */
export const PREAMBLE_WHAT =
  'Reads the MCP configuration of your AI coding tools, starts each server once to list its tools, sends nothing anywhere.';
export const PREAMBLE_ASK = 'Nothing starts before you say yes.';
export const PREAMBLE_YES = '--yes was given: the servers listed below start without a question.';

/** The finding kinds the one screen lists one per line, beside the irreversible table. */
const OTHER_KINDS: readonly Finding['kind'][] = ['pair', 'poisoned', 'egress'];
/** A server the MCP client stopped waiting for; the sentence is `mcp/client.ts`'s. */
const TIMED_OUT = /took longer than (\d+) s to start/;
/** A server discovery skipped because it is remote; the sentence is `discovery/shapes.ts`'s. */
const REMOTE = /: a remote server\b/;
/**
 * Which count of NOT IN THIS PICTURE a not-started finding belongs to: the one
 * classification, which `cli.ts` applies once per start signature to fill
 * `ScanResult.reach.not_started` (ACP-454) and this module applies per finding
 * when a result carries no `reach`.
 */
export function notInPicture(f: Finding): 'timed_out' | 'remote' | 'other' {
  if (TIMED_OUT.test(f.message)) return 'timed_out';
  return REMOTE.test(f.message) ? 'remote' : 'other';
}

/** Where a wrapped finding continues: under the text after the severity label. */
const FINDING_WRAP = '        ';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * What an irreversible tool can do, as a short verb phrase: "delete",
 * "execute SQL", "send off this machine". Read from the irreversible keyword
 * the draft matched; the grouping into a table only holds if the phrase stays
 * short, so the keyword is the phrase and the description is not.
 */
export function whatItCanDo(c: Classification): string {
  const key = c.matched.find((m) => m.startsWith('effect.irreversible:')) ?? c.matched[0];
  const word = key === undefined ? '' : key.slice(key.lastIndexOf(':') + 1);
  const sql = /sql/i.test(c.tool);
  const verb =
    word === ''
      ? 'act'
      : word === 'exec' || word === 'execute'
        ? sql ? 'execute SQL' : 'execute'
        : word === 'shell' || word === 'bash' || word === 'run command'
          ? 'run commands'
          : word === 'run script'
            ? 'run scripts'
            : word;
  return c.egress ? `${verb} off this machine` : verb;
}

/** The matched phrase the classifier adds as `reason` (ACP-454), read structurally: absent is fine. */
export function reasonOf(c: Classification): string | undefined {
  const r: unknown = Reflect.get(c, 'reason');
  return typeof r === 'string' && r !== '' ? r : undefined;
}

/** A string list field of a finding, read structurally: absent or malformed is undefined. */
function namesOf(f: Finding, key: string): string[] | undefined {
  const v: unknown = Reflect.get(f, key);
  return Array.isArray(v) && v.length > 0 && v.every((x): x is string => typeof x === 'string') ? v : undefined;
}

/** "a", "a or b", "a, b or c". */
function orList(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`;
}

/**
 * A pair as a person reads it (ACP-454): reader -> actor, from the finding's
 * `readers` and `actors` when the classifier gave them. Without them, the flat
 * tool list and the gloss, as before.
 */
function pairText(f: Finding, who: string): string | undefined {
  const readers = namesOf(f, 'readers');
  const actors = namesOf(f, 'actors');
  if (readers === undefined || actors === undefined) return undefined;
  const lead = who === '' ? 'An AI agent' : `${who}: an AI agent`;
  return `${lead} that reads ${orList(readers)} can then run ${orList(actors)}`;
}

/**
 * The one screen's single line for every INFO finding that says a tool can
 * send data out (ACP-454): a real machine has one per tool, eighteen on the
 * first real run, and one line each buried the HIGH ones. --full and the
 * report keep every one.
 */
function infoEgressLine(group: readonly Finding[], result: ScanResult): string {
  const n = group.length;
  const untrusted = group.filter((f) =>
    result.classifications.some((c) => c.client === f.client && f.tools.includes(c.tool) && c.untrusted_input),
  ).length;
  const after =
    untrusted === 0 ? '' : n === 1 ? ', after reading untrusted input' : `, ${untrusted} of them after reading untrusted input`;
  return `${plural(n, 'tool', 'tools')} can send data off this machine${after}: --full and the report list ${n === 1 ? 'it' : 'them'}`;
}

/** One gloss per kind the one screen lists: what the finding means, in a clause. */
function gloss(f: Finding, result: ScanResult): string {
  if (f.kind === 'pair') return 'one AI agent can chain them';
  if (f.kind === 'poisoned') return 'its description speaks to the AI agent';
  const untrusted = result.classifications.some((c) => c.client === f.client && f.tools.includes(c.tool) && c.untrusted_input);
  return untrusted ? 'reads untrusted input, can send data out' : 'can send data out';
}

function outcomeWords(o: ReplayOutcome, words: () => PlainWords): string {
  switch (o.kind) {
    case 'held':
      return `HELD until ${o.awaits.k} approvers sign`;
    case 'refused': {
      // Plain words, never the clause: a sentence a person reads carries no
      // clause id (the clause is in --json), as the replay table's column B.
      const w = words();
      return `REFUSED: ${w.refused[o.clause] ?? w.refused_unknown}`;
    }
    case 'allowed':
      return 'ALLOWED';
  }
}

/**
 * The harness summary in one sentence. When every case is refused at the
 * grammar -- the usual result on a real machine, whose tools are not the
 * harness's -- it says why, so "8 are refused" does not read as eight saves.
 */
function replaySummary(replay: ReplaySummary, ownFollows: boolean): string {
  const rows = replay.rows.map((r) => r.outcome);
  const n = rows.length;
  const count = (p: (o: (typeof rows)[number]) => boolean): number => rows.filter(p).length;
  const before = count((o) => o.kind === 'refused' && o.stage === 'grammar');
  const graded = count((o) => o.kind === 'refused' && o.stage !== 'grammar');
  const held = count((o) => o.kind === 'held');
  const allowed = count((o) => o.kind === 'allowed');
  const verb = (k: number): string => (k === 1 ? 'is' : 'are');
  const all = n === 1 ? 'the 1 injected action executes' : `all ${n} injected actions execute`;
  if (n > 0 && before === n) {
    const why = `the harness's ${numberWord(n)} ${n === 1 ? 'tool is' : 'tools are'} not on this machine.`;
    return `Without ZIFFER, ${all}; under the draft policy, ${n} ${verb(n)} refused before grading: ${why}${ownFollows ? ' Your own tool is:' : ''}`;
  }
  const parts = [
    before > 0 ? `${before} ${verb(before)} refused before grading` : '',
    graded > 0 ? `${graded} ${verb(graded)} refused when graded` : '',
    held > 0 ? `${held} ${verb(held)} held until ${replay.quorum_k} approvers sign` : '',
    allowed > 0 ? `${allowed} ${verb(allowed)} allowed` : '',
  ].filter((p) => p !== '');
  return `Without ZIFFER, ${all}; under the draft policy, ${parts.join(', ')}.`;
}

/** `path` as a person types it from `cwd`: relative when it is under `cwd`, whole otherwise. */
export function shownPath(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** The first line of the one screen and of the preamble. */
function wordmark(version: string | undefined, paint: Paint): string {
  return `${paint(COLOUR.brand, 'ZIFFER')} scan${version === undefined ? '' : ` ${version}`}`;
}

/**
 * The three lines before the server listing (ACP-454): what the scan is, what
 * it does, and that nothing starts before the person says so. The CLI prints
 * them on stderr, with the listing, so `--json` stdout stays one document.
 */
/** What one scan reads (ACP-455): the codebase under a folder, the installed tools, or both. */
export interface PreambleReads {
  /** The folder whose code is read; absent when the codebase half is skipped. */
  code?: string;
  /** Whether the installed tools are read (their servers started once each). */
  installed: boolean;
  /** The codebase half was skipped because the folder is a home directory or `/`. */
  noCodebase?: boolean;
}

/** The line printed when the codebase half is skipped because the folder is the home directory or `/`. */
export const PREAMBLE_NO_CODEBASE = 'No codebase given: run it from your project folder or pass --cwd.';

/** The preamble's first line, as the run will do it: what it reads, in order. */
export function preambleReads(reads: PreambleReads): string {
  if (reads.code !== undefined && reads.installed) {
    return `Reads your code under ${reads.code}, then the MCP configuration of your AI tools, starting each server once to list its tools; sends nothing anywhere.`;
  }
  // Not "starts nothing" (ACP-464): reading Python runs this machine's own Python on the reader the package ships.
  if (reads.code !== undefined) return `Reads your code under ${reads.code}; starts no tool server, runs this machine's Python to read Python, sends nothing anywhere.`;
  return PREAMBLE_WHAT;
}

/**
 * The preamble. Without `reads` it is the installed-tools run's, byte for byte
 * as before; with it, the one scan's: what it reads, the no-codebase line when
 * that half was skipped, and the question only when a server will start.
 */
export function renderPreamble(opts: { color?: boolean; width?: number; yes?: boolean; reads?: PreambleReads } = {}): string[] {
  const paint = painter(opts.color ?? false);
  const width = opts.width ?? 80;
  const reads = opts.reads;
  const starts = reads === undefined || reads.installed;
  return [
    wordmark(undefined, paint),
    ...wrap(reads === undefined ? PREAMBLE_WHAT : preambleReads(reads), width, '', ''),
    ...(reads?.noCodebase === true ? [PREAMBLE_NO_CODEBASE] : []),
    ...(starts ? [opts.yes === true ? PREAMBLE_YES : PREAMBLE_ASK] : []),
    '',
  ];
}

function renderOneScreen(result: ScanResult, opts: TerminalOptions): string[] {
  const width = opts.width ?? 80;
  const paint = painter(opts.color ?? false);
  const heading = (text: string): string => paint(COLOUR.heading, text);
  const out: string[] = [];

  // (1) header, then what this run wrote and that it is the person's (ACP-454:
  // the first real run left four files in a git repository and said nothing).
  out.push(`${wordmark(result.scan_version, paint)} · this machine · nothing was sent anywhere`);
  out.push(paint(COLOUR.dim, `engine ${result.engine_pin.slice(0, 8)} · ${result.date}`));
  if (opts.wrote !== undefined) {
    const dir = opts.wrote.dir;
    out.push(...wrap(`Wrote ${dir} (${plural(opts.wrote.items, 'item', 'items')}). It is yours to delete; nothing was sent.`, width, '', ''));
    if (opts.wrote.gitWorkTree) {
      const name = dir.replace(/^\.\//, '');
      out.push(...wrap(`Add ${name} to .gitignore, or run with --out elsewhere.`, width, '', '').map((l) => paint(COLOUR.warn, l)));
    }
  }
  out.push('');

  // (1a) the executive summary, 6 to 10 lines, before anything technical (ACP-455).
  out.push(...execLines(execOf(result), width, paint));
  out.push('');

  // (1b) the application's own tools, first (ACP-455 `--code`): what it defines
  // for a model, what the engine decided, and the ONE place to put ZIFFER.
  if (result.code !== undefined) out.push(...codeBlock(result, result.code, opts, width, paint));

  // (2) what can do damage that cannot be undone, as a table with aligned
  // columns. "The AI agents you code with", never "AI coding agents": the
  // report's own check reads "agent" preceded by anything but "AI " as bare.
  // Each program once, however many clients configure it (ACP-454), when the
  // result says; a result made before `reach` counts catalog rows as it did.
  const servers = result.reach?.servers ?? uniq(result.catalog.map((t) => `${t.client}\u0000${t.server}\u0000${t.source_path}`)).length;
  const tools = result.reach?.tools ?? result.catalog.length;
  const fromClients = result.reach === undefined ? '' : `, from ${plural(result.reach.clients, 'AI agent client', 'AI agent clients')}`;
  const irreversible = uniqBy(
    result.classifications.filter((c) => c.effect === 'irreversible'),
    (c) => `${c.server}\u0000${c.tool}`,
  );
  const reach = `The AI agents you code with can reach ${plural(servers, 'tool server', 'tool servers')} with ${plural(tools, 'tool', 'tools')}${fromClients}.`;
  if (!hasMcp(result)) {
    // A code-only run: no MCP catalog, so no reach sentence and no empty table.
  } else if (irreversible.length === 0) {
    out.push(...wrap(`${reach} None of them is classified as irreversible by this scan's draft rules.`, width, '', ''));
  } else {
    out.push(...wrap(`${reach} ${irreversible.length} of them can do damage that cannot be undone:`, width, '', ''));
    const sw = Math.max('server'.length, ...irreversible.map((c) => c.server.length)) + 2;
    const tw = Math.max('tool'.length, ...irreversible.map((c) => c.tool.length)) + 2;
    const column = 2 + sw + tw;
    // A phrase column narrower than this wraps under the row instead of beside it.
    const narrow = width - column < 20;
    const rest = narrow ? '      ' : ' '.repeat(column);
    out.push(paint(COLOUR.dim, `  ${pad('server', sw)}${pad('tool', tw)}what it can do`));
    for (const c of irreversible) {
      const lead = `  ${pad(c.server, sw)}${pad(c.tool, tw)}`;
      const lines = narrow ? [lead.trimEnd(), ...wrap(whatItCanDo(c), width, rest, rest)] : wrap(whatItCanDo(c), width, lead, rest);
      out.push(...lines.map((l, i) => (i > 0 ? paint(COLOUR.high, l) : narrow ? l : l.slice(0, column) + paint(COLOUR.high, l.slice(column)))));
    }
    out.push(...wrap(IRREVERSIBLE_CONSEQUENCE, width, '  ', '  '));
  }
  if (hasMcp(result)) out.push('');

  // (3) every other finding, most severe first, one per line, wrapped: all of
  // them, never "+..." and never "and N more".
  const irreversibleTool = (f: Finding): boolean =>
    result.classifications.some((c) => c.client === f.client && f.tools.includes(c.tool) && c.effect === 'irreversible');
  const others = sortFindings(result.findings).filter(
    (f) => OTHER_KINDS.includes(f.kind) && !(f.kind === 'egress' && irreversibleTool(f)),
  );
  if (others.length > 0) {
    const infoEgress = others.filter((f) => f.severity === 'info' && f.kind === 'egress');
    const line = (severity: Finding['severity'], text: string): void => {
      const label = SEVERITY_LABEL[severity];
      const lines = wrap(text, width, `  ${label}  `, FINDING_WRAP);
      out.push(...lines.map((l, i) => (i === 0 ? `  ${paint(SEVERITY_COLOUR[severity], label)}${l.slice(2 + label.length)}` : l)));
    };
    let grouped = false;
    for (const f of others) {
      if (infoEgress.includes(f)) {
        // One line for the whole group, where its first member would stand.
        if (!grouped) line('info', infoEgressLine(infoEgress, result));
        grouped = true;
        continue;
      }
      const pair = f.kind === 'pair' ? pairText(f, f.client ?? '') : undefined;
      const who = f.client === undefined ? '' : ` · ${f.client}`;
      line(f.severity, pair ?? `${f.tools.join(' + ')}${who}: ${gloss(f, result)}`);
    }
    if (others.some((f) => f.kind === 'pair')) out.push(...wrap(PAIR_CONSEQUENCE, width, '  ', '  '));
    out.push('');
  }

  // (4) what this scan could not see: counts, not lists
  const notStarted = result.findings.filter((f) => f.kind === 'server_not_started' || f.kind === 'runtime_missing');
  const timedOutFindings = notStarted.filter((f) => notInPicture(f) === 'timed_out');
  // Each program once (ACP-454): one server configured in seven clients that
  // did not start is one server not in this picture, not seven.
  const counted = result.reach?.not_started;
  const timedOut = counted?.timed_out ?? timedOutFindings.length;
  const remote = counted?.remote ?? notStarted.filter((f) => notInPicture(f) === 'remote').length;
  const otherUnread = counted?.other ?? notStarted.filter((f) => notInPicture(f) === 'other').length;
  const seconds = Number(TIMED_OUT.exec(timedOutFindings[0]?.message ?? '')?.[1] ?? '0');
  const unclassified = result.findings.filter((f) => f.kind === 'unclassified').length;
  const { absent } = clientSplit(result);
  const blind = [
    timedOut > 0
      ? `${plural(timedOut, 'server', 'servers')} took longer than ${seconds} s to start and ` +
        `${timedOut === 1 ? 'is' : 'are'} not in this picture (rerun with --timeout ${seconds * 2})`
      : '',
    remote > 0
      ? `${plural(remote, 'remote server is', 'remote servers are')} not started by this scan`
      : '',
    otherUnread > 0
      ? `${plural(otherUnread, 'other server', 'other servers')} could not be started or read and ` +
        `${otherUnread === 1 ? 'is' : 'are'} not in this picture`
      : '',
    unclassified > 0
      ? `${plural(unclassified, 'tool', 'tools')} could not be read from ${unclassified === 1 ? 'its' : 'their'} name or description; ` +
        `the draft treats ${unclassified === 1 ? 'it' : 'them'} as ${unclassified === 1 ? 'a write' : 'writes'} for a person to confirm`
      : '',
    absent.length > 0
      ? `${plural(absent.length, 'client has', 'clients have')} no configuration on this machine`
      : '',
    ...result.clients_not_covered.map((c) => `${c} is not covered`),
    // `--code` read the application: this line would now be false (its block replaces it).
    result.code === undefined ? APP_TOOLS_NOT_YET : '',
  ].filter((l) => l !== '');
  if (blind.length > 0) {
    out.push(heading('NOT IN THIS PICTURE'));
    for (const l of blind) out.push(...wrap(l, width, '  ', '    '));
    out.push('');
  }

  // (5) the replay, two lines, the UNSIGNED DEMO line where it begins
  if (opts.replay !== undefined) {
    let words: PlainWords | undefined = opts.words;
    const plainWords = (): PlainWords => {
      words ??= loadReplayData().words;
      return words;
    };
    out.push(heading('REPLAY'));
    out.push(...wrap(UNSIGNED_DEMO_LINE, width, '', '').map((l) => paint(COLOUR.warn, l)));
    const own = ownOf(opts.replay);
    const present = hasOwnCase(own);
    const summary = replaySummary(opts.replay, present);
    const lead = summary.endsWith('Your own tool is:');
    out.push(...wrap(summary, width, '  ', '  ').map((l) => tintOutcomes(l, paint)));
    if (present) {
      // The tool's real name, never `tool`, which is the bundle's normalised
      // key (ACP-454: a real run printed execute_sql_2).
      const name = `${lead ? '' : 'Your '}${own.server} · ${own.original_name}`;
      out.push(
        ...wrap(`${name}: without ZIFFER executes; under the draft policy ${outcomeWords(own.outcome, plainWords)}`, width, '  ', '  ').map(
          (l) => tintOutcomes(l, paint),
        ),
      );
      out.push(...wrap(`(${own.label})`, width, '  ', '  '));
    } else if (isOwnAbsent(own)) {
      out.push(...wrap(own.reason, width, '  ', '  '));
    }
    out.push('');
  }

  // (6) NEXT: the report first when --report wrote it, otherwise how to get it;
  // then the review, the draft policy, the MCP line.
  out.push(heading('NEXT'));
  const reviewed = hasReview(result) ? result.review : undefined;
  if (result.code !== undefined) {
    out.push(...codeNext(result, result.code, opts, width, paint));
    out.push('');
    out.push(paint(COLOUR.dim, FULL_DETAIL));
    out.push(paint(COLOUR.brand, reviewed !== undefined ? NEXT_OPEN : NEXT_RUN));
    return out;
  }
  // A command is one unit a person copies: never split between `open` and its
  // path. When it does not fit beside its label it goes whole on the next line.
  const cta = (label: string, value: string, lw: number): string[] =>
    2 + lw + value.length <= width
      ? [`  ${pad(label, lw)}${paint(COLOUR.bold, value)}`]
      : [`  ${label}`, `    ${paint(COLOUR.bold, value)}`];
  if (reviewed !== undefined) {
    const report = shownPath(reviewed.report, opts.cwd);
    const lw = 'Review and sign off:  '.length;
    out.push(...cta('Open the report:', opts.open === true ? `open ${report}` : report, lw));
    out.push(...cta('Review and sign off:', REVIEW_URL, lw));
    out.push(...wrap(`Attach ${shownPath(reviewed.archive, opts.cwd)} to the email that page sends you.`, width, ' '.repeat(2 + lw), ' '.repeat(2 + lw)));
  } else {
    const lw = 'Get the shareable report:  '.length;
    out.push(...cta('Get the shareable report:', 'ziffer-scan --report', lw));
    if (opts.wrote !== undefined) {
      out.push(...wrap(`Move or delete ${opts.wrote.dir} first: a new run does not overwrite it.`, width, ' '.repeat(2 + lw), ' '.repeat(2 + lw)));
    }
    out.push(...cta('Review and sign off:', REVIEW_URL, lw));
  }
  if (opts.policy === undefined) out.push(POLICY_PATH_TOKEN);
  else {
    const files = plural(opts.policy.files, 'file', 'files');
    out.push(
      ...wrap(
        `The draft policy is ${shownPath(opts.policy.path, opts.cwd)} (${files}), signed by a key made for this run and discarded: ` +
          'a draft to review, not a policy to deploy.',
        width,
        '  ',
        '  ',
      ),
    );
  }
  out.push(...wrap(MCP_NEXT, width, '  ', '  '));
  out.push('');

  // (7) where the rest is, and last, the one thing to do next
  out.push(paint(COLOUR.dim, FULL_DETAIL));
  out.push(paint(COLOUR.brand, reviewed !== undefined ? NEXT_OPEN : NEXT_RUN));
  return out;
}

/** The summary the one screen and the report share: the code half's when it ran, else the installed tools'. */
export function execOf(result: ScanResult): ExecSummary {
  if (result.code !== undefined) return codeExecSummary(result.code, result);
  const tools = result.reach?.tools ?? result.catalog.length;
  const irreversible = uniqBy(result.classifications.filter((c) => c.effect === 'irreversible'), (c) => `${c.server}\u0000${c.tool}`).length;
  return mcpExecSummary(result, { tools, irreversible });
}

/** The heading the one screen gives the summary. */
export const EXEC_HEADING = 'IN SHORT, FOR LEADERSHIP';

/** How many bullets the one screen prints: the summary's first, and the "nobody asking" one when there is one. */
export const EXEC_TERMINAL_BULLETS = 2;

/** A bullet in one line or two: its actions and the short fact, never the tool list the report carries. */
function execBulletLine(b: ExecBullet): string {
  const fact =
    b.kind === 'notified'
      ? `${b.count ?? b.tools.length} like these run after a notice under the draft policy.`
      : b.kind === 'refused'
        ? 'no rule in the draft policy yet.'
        : b.text === MARKED_IRREVERSIBLE
          ? 'held for a person; name or description marks them irreversible.'
          : `${b.text.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}; ZIFFER holds each for a person.`;
  return `${b.lead.replace(/, among others$/, '')}: ${fact}`;
}

/** The one screen's summary, 6 to 10 lines: the headline, two bullets, the outsider path in one sentence, the review link. */
export function execLines(s: ExecSummary, width: number, paint: Paint): string[] {
  const out: string[] = [paint(COLOUR.heading, EXEC_HEADING)];
  out.push(...wrap(s.headline, width, '', '').map((l) => paint(COLOUR.bold, l)));
  const first = s.bullets.slice(0, EXEC_TERMINAL_BULLETS - 1);
  const notified = s.bullets.find((b) => b.kind === 'notified');
  const rest = s.bullets.slice(EXEC_TERMINAL_BULLETS - 1);
  const shown = [...first, ...(notified !== undefined && !first.includes(notified) ? [notified] : rest.slice(0, 1))];
  for (const b of shown) out.push(...wrap(execBulletLine(b), width, '  • ', '    '));
  if (s.steering !== undefined) {
    out.push(...wrap(`Outsiders can try to steer the model through text in ${andList(s.steering.readers.slice(0, 2))}.`, width, '  ', '  '));
  }
  out.push(...wrap(`${BOOK_TEXT}: ${BOOK_URL}`, width, '', '').map((l) => paint(COLOUR.brand, l)));
  return out;
}

/** The replay's outcome words in their colours; the text is unchanged. */
function tintOutcomes(line: string, paint: Paint): string {
  return line
    .replace(/\b\d+ (?:is|are) refused (?:before grading|when graded)/g, (m) => paint(COLOUR.ok, m))
    .replace(/\bREFUSED\b/g, (m) => paint(COLOUR.ok, m))
    .replace(/\b(?:\d+ (?:is|are) held|HELD)\b/g, (m) => paint(COLOUR.warn, m))
    .replace(/\b(?:\d+ (?:is|are) allowed|ALLOWED)\b/g, (m) => paint(COLOUR.ok, m));
}

function uniqBy<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The application's own tools (ACP-455 `--code`). The report a CTO forwards
// states how many tools the application defines for a model and where, what
// the ENGINE decided for each, the ONE place to put ZIFFER, and what the scan
// could not see, in numbers. Nothing here grades: the verdicts and the counts
// arrive filled, and this renders them.
// ---------------------------------------------------------------------------

/** The call to action's title, on the box's top edge. */
export const CODE_CTA_TITLE = 'PUT ZIFFER HERE';
/** Under the insertion sentence: the snippet is not printed on a terminal, where it would be copied with its wrapping. */
export const CODE_IN_REPORT = 'The code to paste is in the report:';
/** With a `call` line: the module it imports is in the report. */
export const CODE_MODULE_IN_REPORT = 'The module it imports (ziffer-gate.ts) is in the report:';

/**
 * Whether the result carries an MCP picture to render. Always true without
 * `--code`, so a result made without it renders byte for byte as before.
 */
export function hasMcp(result: ScanResult): boolean {
  return result.code === undefined || result.catalog.length > 0 || result.findings.length > 0;
}

/** `text` padded with spaces to `n` columns; never cut. */
function padEnd(text: string, n: number): string {
  return text.length >= n ? text : text + ' '.repeat(n - text.length);
}

/**
 * A box as wide as the screen: the title on the top edge, each paragraph
 * wrapped inside it. Only the border is painted, and the first paragraph is
 * bold, so the text a person copies out of it is the text.
 */
function box(title: string, paragraphs: readonly string[][], width: number, paint: Paint): string[] {
  const inner = width - 4;
  const top = `┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 5))}┐`;
  const out = [paint(COLOUR.brand, top)];
  paragraphs.forEach((lines, i) => {
    if (i > 0) out.push(`${paint(COLOUR.brand, '│')}${' '.repeat(width - 2)}${paint(COLOUR.brand, '│')}`);
    for (const l of lines) {
      const text = i === 0 ? paint(COLOUR.bold, padEnd(l, inner)) : padEnd(l, inner);
      out.push(`${paint(COLOUR.brand, '│')} ${text} ${paint(COLOUR.brand, '│')}`);
    }
  });
  out.push(paint(COLOUR.brand, `└${'─'.repeat(width - 2)}┘`));
  return out;
}

/** Where the report is, as the NEXT block names it: the path `--report` wrote, or how to get one. */
function reportPointer(result: ScanResult, opts: TerminalOptions): string {
  if (!hasReview(result)) return 'ziffer-scan --report writes it.';
  const report = shownPath(result.review.report, opts.cwd);
  return opts.open === true ? `open ${report}` : report;
}

/** The declared frameworks this scan did not read, as "name version" items. */
function notReadYet(code: CodeSection, opts: TerminalOptions): string[] {
  return frameworkRows(code, opts.codeSdks ?? loadCodeSdks())
    .filter((f) => !f.covered)
    .map((f) => `${f.name} ${f.version}`);
}

/**
 * The one screen's two lines on the 2026-09-28 readings: how many places a tool runs another tool
 * without passing the dispatcher, and how many calls to it have no confirmation check found. Each
 * is absent when the scan found none; the report says what each means.
 */
export function unseenLines(code: CodeSection): string[] {
  const d = code.insertion.dispatcher;
  const door = d?.name ?? 'the dispatcher';
  const paths = bypassPaths(code);
  const outer = [...new Set(paths.map((p) => p.outer))];
  const none = uncheckedCallers(code);
  const checks = callerChecks(code) ?? [];
  return [
    ...(paths.length === 0 ? [] : [`Paths that pass ${door} unseen: ${paths.length} (${andList(outer)}).`]),
    ...(none.length === 0 ? [] : [`Calls to ${door} with no check found: ${none.length} of ${checks.length} (${andList(none.map(entryFunction))}).`]),
  ];
}

/**
 * The one terminal line for instruction-like text and skills (2026-09-28): the HIGH hits, in the
 * application's descriptions and in skill or instruction files, named; else how many skills and
 * instruction files were read. Undefined when there is nothing to say.
 */
export function instructionLine(code: CodeSection, skills: readonly SkillRead[] | undefined): { text: string; high: boolean } | undefined {
  const high = highInstructions(code, skills);
  if (high.length > 0) {
    return { text: `Text that speaks to the model, high severity: ${high.length} (${andList([...new Set(high.map((h) => h.subject))])}). The report quotes each one.`, high: true };
  }
  if (skills === undefined || skills.length === 0) return undefined;
  return { text: skillsSummary(skills), high: false };
}

/** The grader's sentence for a held tool, which the group's header "Held for a human before they run" already says. */
const HELD_SENTENCE = whatZifferDoes({ verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: '' });

/** How many tools of each group the one screen names; --full and the report name every one. */
export const ONE_SCREEN_PER_GROUP = 2;
/** How many of the code limits the one screen prints. */
export const NOT_SEEN_ON_SCREEN = 1;

const FULL_GROUP_LABEL = {
  held: 'Held for a human before they run',
  notified: 'Treated as irreversible, run after a notice under the draft policy',
  refused: 'Refused by the engine',
  allowed: 'Run, recorded',
} as const;

const capital = (s: string): string => (s === '' ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`);

/**
 * One group's lines: the sentence its tools share, once; each other sentence
 * once, with the tools it applies to; then one line per tool, name, where it
 * is defined and the draft's reason, never the shared sentence again. With a
 * `cap`, the first `cap` tools and a line saying how many more there are.
 */
function groupLines(list: readonly CodeToolVerdict[], width: number, paint: Paint, colour: string, cap?: number, indent = ''): string[] {
  const out: string[] = [];
  const words = groupWords(list);
  if (words !== undefined) {
    // The held group's header already says what its usual sentence says; print it only when it adds something.
    if (words.lead !== HELD_SENTENCE) out.push(...wrap(capital(plainLead(words.lead)), width, `${indent}  `, `${indent}  `));
    for (const n of words.notes) out.push(...wrap(plainNote(n.sentence, n.tools), width, `${indent}  `, `${indent}  `));
  }
  const shown = cap === undefined ? list : list.slice(0, cap);
  for (const v of shown) {
    const why = v.draft_reason === undefined ? '' : ` · ${v.draft_reason}`;
    // The name and its place never part: a line break falls after them, never between them.
    const place = where(v.tool.defined_at);
    const glue = indent.length + 2 + v.tool.name.length + 3 + place.length <= width ? '\u0001' : ' ';
    const lines = wrap(`${v.tool.name}${glue}·${glue}${place}${why}`, width, `${indent}  `, `${indent}      `).map((l) => l.replace(/\u0001/g, ' '));
    out.push(...lines.map((l, i) => (i === 0 ? `${indent}  ${paint(colour, v.tool.name)}${paint(COLOUR.dim, l.slice(indent.length + 2 + v.tool.name.length))}` : paint(COLOUR.dim, l))));
  }
  if (shown.length < list.length) out.push(...wrap(`+ ${list.length - shown.length} more: the report and ziffer-scan --full list every one.`, width, `${indent}  `, `${indent}  `).map((l) => paint(COLOUR.dim, l)));
  return out;
}

function codeBlock(result: ScanResult, code: CodeSection, opts: TerminalOptions, width: number, paint: Paint): string[] {
  const heading = (text: string): string => paint(COLOUR.heading, text);
  const out: string[] = [];
  const sdks = opts.codeSdks ?? loadCodeSdks();
  out.push(heading(`YOUR APPLICATION · ${appName(code)}`));
  // The route in a reader's words; the type-system phrase is in the report's table.
  // The heading names the application; the sentence does not repeat a long path.
  out.push(...wrap(plainNumbersSentence(code, sdks, 'It'), width, '', ''));
  const grade = exposureGrade(code);
  if (grade !== undefined) {
    const title = gradeTitle(grade);
    const lines = wrap(`${title}: ${gradeShort(grade)}`, width, '', '');
    const colour = grade.worst === 'A' || grade.worst === 'B' ? COLOUR.ok : COLOUR.high;
    out.push(...lines.map((l, i) => (i === 0 && l.startsWith(title) ? `${paint(colour, title)}${l.slice(title.length)}` : l)));
  }
  out.push(...wrap(countsSentence(code), width, '', ''));
  const listed = listedSentence(code);
  if (listed !== undefined) out.push(...wrap(listed, width, '', '').map((l) => paint(COLOUR.dim, l)));
  // At most two lines on what one call at the dispatcher does not see, each only when the scan found it.
  for (const l of unseenLines(code)) out.push(...wrap(l, width, '', '').map((x) => paint(COLOUR.high, x)));
  // At most one line on what the descriptions and the skills say to the model: the HIGH hits when any, else the inventory's count.
  const said = instructionLine(code, result.skills);
  if (said !== undefined) out.push(...wrap(said.text, width, '', '').map((x) => paint(said.high ? COLOUR.high : COLOUR.dim, x)));
  // The data-leaving pairs the result carries (`CodeSection.pairs`): one line, never recomputed here.
  const pairs = code.pairs === undefined ? undefined : pairsLine(code);
  if (pairs !== undefined) out.push(...wrap(pairs, width, '', ''));

  // Each group: its label, what its tools share said ONCE, then one line per
  // tool (name, where, why). The one screen shows the first few of each;
  // --full and the report list every one.
  const sorted = sortedVerdicts(code);
  const held = sorted.filter(isHeld);
  if (held.length > 0) {
    out.push('');
    out.push(...wrap(`Held for a human before they run (${held.length}):`, width, '', ''));
    out.push(...groupLines(held, width, paint, COLOUR.warn, ONE_SCREEN_PER_GROUP));
  }
  const notified = sorted.filter(isNotified);
  if (notified.length > 0 || notifiedCount(code) > 0) {
    out.push('');
    // The count is the section's, listed tools are the ones the verdicts carry.
    out.push(...wrap(`${notifiedPhrase(notifiedCount(code) > 0 ? notifiedCount(code) : notified.length)}:`, width, '', ''));
    out.push(...groupLines(notified, width, paint, COLOUR.high, ONE_SCREEN_PER_GROUP));
  }
  const refused = sorted.filter((v) => v.verdict.verdict === 'REFUSED');
  if (refused.length > 0) {
    out.push('');
    // One line: their names, and what they share (the draft has no rule for them), said once.
    const words = groupWords(refused);
    const lead = words === undefined ? '' : ` ${capital(plainLead(words.lead).replace(/^refused: /, ''))}`;
    out.push(...wrap(`Refused by the engine (${refused.length}): ${andList(refused.map((v) => v.tool.name))}.${lead}`, width, '', ''));
  }
  out.push('');

  // THE call to action: one place, in a box; the code itself is in the report.
  const call = insertionCall(code.insertion);
  const d = code.insertion.dispatcher;
  const paste =
    call === undefined
      ? []
      : [[`Add at the top of ${d === null ? 'each tool' : d.name}:`, ...wrap(call, width - 4, '  ', '    ')]];
  const pointer = call === undefined ? CODE_IN_REPORT : CODE_MODULE_IN_REPORT;
  out.push(
    ...box(
      CODE_CTA_TITLE,
      [wrap(code.insertion.sentence, width - 4, '', ''), ...paste, wrap(`${pointer} ${reportPointer(result, opts)}`, width - 4, '', '')],
      width,
      paint,
    ),
  );

  // What it did not read, and what it could not see: numbers and sentences, never nothing.
  const unread = notReadYet(code, opts);
  const blind = [
    ...(unread.length === 0 ? [] : [`${andList(unread)}: ${NOT_READ_YET}.`]),
    ...code.catalog.not_seen,
  ];
  if (blind.length > 0) {
    // The first limits here; every one is in the report and in --full.
    out.push(...wrap('Not seen in the code:', width, '', ''));
    // The frameworks it did not read always; of the other limits, the first.
    const shown = blind.length - code.catalog.not_seen.length + Math.min(NOT_SEEN_ON_SCREEN, code.catalog.not_seen.length);
    for (const l of blind.slice(0, shown)) out.push(...wrap(l, width, '  ', '    '));
    if (blind.length > shown) {
      out.push(...wrap(`+ ${blind.length - shown} more: the report and ziffer-scan --full list every one.`, width, '  ', '    ').map((l) => paint(COLOUR.dim, l)));
    }
  }
  out.push('');
  return out;
}

/**
 * NEXT when `--code` ran: four numbered steps, the report first, then the one
 * paste, the draft policy, the archive. The policy line keeps the
 * POLICY_PATH_TOKEN mechanism: without a policy path the CLI fills the token.
 */
function codeNext(result: ScanResult, code: CodeSection, opts: TerminalOptions, width: number, paint: Paint): string[] {
  const out: string[] = [];
  const lw = '2. Paste the ZIFFER call:  '.length;
  const step = (label: string, value: string): string[] =>
    2 + lw + value.length <= width ? [`  ${pad(label, lw)}${paint(COLOUR.bold, value)}`] : [`  ${label}`, `     ${paint(COLOUR.bold, value)}`];
  const note = (text: string): string[] => wrap(text, width, ' '.repeat(2 + lw), ' '.repeat(2 + lw));
  const reviewed = hasReview(result) ? result.review : undefined;

  if (reviewed !== undefined) out.push(...step('1. Open the report:', reportPointer(result, opts)));
  else out.push(...step('1. Get the report:', 'ziffer-scan --report'));

  const d = code.insertion.dispatcher;
  if (d !== null) {
    out.push(...step('2. Paste the ZIFFER call:', where(d.at)));
    out.push(...note(`at the top of ${d.name}; the code is in the report.`));
  } else {
    out.push(...step('2. Paste the ZIFFER call:', 'in each tool\'s execute'));
    out.push(...note('no one function runs every tool; the code is in the report.'));
  }

  if (opts.policy === undefined) {
    out.push('  3. Review and sign the draft policy:');
    out.push(POLICY_PATH_TOKEN);
  } else {
    out.push(...step('3. Review and sign:', shownPath(opts.policy.path, opts.cwd)));
    out.push(
      ...note(
        `the draft policy (${plural(opts.policy.files, 'file', 'files')}), signed by a key made for this run and discarded: ` +
          'a draft to review, not a policy to deploy.',
      ),
    );
  }

  if (reviewed !== undefined) {
    out.push(...step('4. Attach to the review:', shownPath(reviewed.archive, opts.cwd)));
    out.push(...note(`at ${REVIEW_URL}, in the email that page sends you.`));
  } else {
    out.push(...step('4. Send it for review:', REVIEW_URL));
    out.push(...note('with the archive ziffer-scan --report writes.'));
  }
  if (hasMcp(result) && result.catalog.length > 0) out.push(...wrap(MCP_NEXT, width, '  ', '  '));
  return out;
}

/** `--full`: every verdict the engine gave, by group, each group's shared sentence said once. */
function codeToolsFull(code: CodeSection, width: number, paint: Paint): string[] {
  const out: string[] = [paint(COLOUR.heading, `APPLICATION TOOLS · ${appName(code)}`)];
  out.push(...wrap(numbersSentence(code), width, '  ', '  '));
  out.push(...wrap(countsSentence(code), width, '  ', '  '));
  const listed = listedSentence(code);
  if (listed !== undefined) out.push(...wrap(listed, width, '  ', '  '));
  const exposures = exposureSentences(code);
  if (exposures.length > 0) {
    out.push('  Where they reach a model:');
    for (const e of exposures) out.push(...wrap(e, width, '    ', '      '));
  }
  const sorted = sortedVerdicts(code);
  for (const group of ['held', 'notified', 'refused', 'allowed'] as const) {
    const list = sorted.filter((v) => groupOf(v) === group);
    if (list.length === 0) continue;
    out.push('');
    out.push(`  ${FULL_GROUP_LABEL[group]} (${list.length}):`);
    out.push(...groupLines(list, width, paint, group === 'notified' ? COLOUR.high : group === 'held' ? COLOUR.warn : COLOUR.dim, undefined, '  '));
  }
  if (code.catalog.not_seen.length > 0) {
    out.push('');
    out.push('  Not seen in the code:');
    for (const l of code.catalog.not_seen) out.push(...wrap(l, width, '    ', '      '));
  }
  out.push('');
  return out;
}

/**
 * The terminal report: the one screen, and with `full` the complete report
 * after it, unchanged (ACP-452). The one entry: the CLI calls nothing else.
 */
export function renderTerminal(result: ScanResult, opts: TerminalOptions = {}): string {
  const screen = `${renderOneScreen(result, opts).join('\n')}\n`;
  return opts.full === true ? `${screen}\n${renderFull(result, opts)}` : screen;
}
