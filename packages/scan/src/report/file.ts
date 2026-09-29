/**
 * The report a developer forwards (ACP-443): ONE self-contained HTML file.
 *
 * `ziffer-scan --report` writes it beside the draft policy and puts it in the
 * archive the review page at https://ziffer.io/review asks to have attached.
 * It is read by somebody who was not at the machine: a security reviewer, a
 * manager, the person who signs the policy off. So it carries its own
 * context (which scan, which engine, which day, which machine) and nothing
 * that belongs to the machine's owner alone.
 *
 * WHAT IT NEVER CARRIES:
 * - A credential. The caller hands in the SAME redacted result the terminal
 *   report is rendered from (`redactResult`); the replay and the policy, which
 *   the terminal prints line by line through `redactText`, pass through it
 *   here cell by cell.
 * - A home directory. Every path under a home the caller names is shown from
 *   `~`, and the machine is its host name, never a user name.
 * - Anything fetched. No stylesheet, no image, no font from anywhere: the page
 *   declares `default-src 'none'` so a mail client or a browser opening it from
 *   an attachment loads nothing. Its two type families travel inside it as
 *   base64 `data:` sources (`fonts.ts`), which the CSP allows with `font-src
 *   data:` and nothing wider. It runs nothing either: neither report carries a
 *   script (since ACP-455's second design, 2026-09-28, the `--code` page's copy
 *   button is gone; one click selects the line to copy).
 *
 * It does NOT call `renderTerminal`: the sections are rendered here from the
 * ScanResult and the ReplayResult, so the two reports do not couple. The words
 * it shares with the terminal (what the scan cannot see, the UNSIGNED DEMO
 * line, the status words of the dossier) are imported, never retyped.
 */

import { configuredPhrase } from '../discovery/group.js';
import { redactText } from '../redact/index.js';
import type { PlainWords } from '../replay/data.js';
import { hex8, NOT_EVIDENCE_BECAUSE, WITHOUT_POLICY } from '../replay/replay.js';
import { hasOwnCase } from '../replay/own.js';
import type { ReplayResult } from '../replay/replay.js';
import type { CatalogTool, Classification, ControlRef, Finding, ScanResult } from '../types.js';
import { ANNEX, type AnnexSource } from './annex.js';
import { noticePlaceholderHtml } from './code-html.js';
import { DEVELOPER } from '../bundle/generate.js';
import { ARCHIVE_FILE, ARCHIVE_POLICY_DIR, CTA_TEXT, DRAFT_NOTICE, escapeHtml, isRecord } from './names.js';
import { statusWords } from './controls.js';
import { BOOK_TEXT, BOOK_URL, mcpExecSummary } from './exec.js';
import { EXEC_STYLE, execHtml, heatTable } from './exec-html.js';
import { mastheadHtml } from './first.js';
import { fontFaces, FONT_SRC, MONO, SANS } from './fonts.js';
import { renderCodePage } from './page.js';
import { MAST_STYLE } from './page-style.js';
import { cannotSee, hasMcp, MCP_NEXT, REVIEW_URL } from './terminal.js';
import { notScannedSentence, plainKinds, scopeOf, type CodeSdkEntry } from './code.js';

export { ARCHIVE_FILE, ARCHIVE_POLICY_DIR, CTA_TEXT, DRAFT_NOTICE, JSON_FILE, REPORT_FILE } from './names.js';

export class ReportPolicyUnreadable extends Error {
  override readonly name = 'ReportPolicyUnreadable';
}

export interface ReportPolicy {
  /** The bundle's files as written: path inside the policy folder, and text. */
  files: readonly { path: string; text: string }[];
  treeHash: string;
  tenantId: string;
  /** Catalog tools the draft names no risk rule for: the engine refuses them. */
  unclassified: readonly { server: string; tool: string }[];
}

export interface ReportContext {
  /** The host name, and nothing else about who ran the scan. */
  machine: string;
  /** Directories whose paths are shown from `~`: the scanned home, the user's. */
  homes: readonly string[];
  policy: ReportPolicy;
  /** The replay's plain words for a refusal (data/replay/plain-words.json). */
  words: PlainWords;
  source?: AnnexSource;
  /** The framework table `--code` reads coverage from; `data/code-sdks.json` unless a test passes its own. */
  codeSdks?: readonly CodeSdkEntry[];
}

// ---------------------------------------------------------------- the own case


// ---------------------------------------------------------------- text


/** Every occurrence of a home directory, longest first, shown as `~`. */
export function homeless(text: string, homes: readonly string[]): string {
  let out = text;
  for (const h of [...homes].filter((x) => x.length > 1).sort((a, b) => b.length - a.length)) {
    const bare = h.replace(/\/+$/, '');
    out = out.split(bare).join('~');
  }
  return out;
}

/** A JSON-shaped value with every home directory shown as `~`, keys included. */
export function homelessDeep(value: unknown, homes: readonly string[]): unknown {
  if (typeof value === 'string') return homeless(value, homes);
  if (Array.isArray(value)) return value.map((v) => homelessDeep(v, homes));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[homeless(k, homes)] = homelessDeep(v, homes);
    return out;
  }
  return value;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- the policy

function parseMember(policy: ReportPolicy, path: string): Record<string, unknown> {
  const f = policy.files.find((x) => x.path === path);
  if (f === undefined) throw new ReportPolicyUnreadable(`the draft policy has no ${path}`);
  const v: unknown = JSON.parse(f.text);
  if (!isRecord(v)) throw new ReportPolicyUnreadable(`${path} is not an object`);
  return v;
}

function stringMap(doc: Record<string, unknown>, key: string, path: string): [string, string][] {
  const m = doc[key];
  if (!isRecord(m)) throw new ReportPolicyUnreadable(`${path}: ${key} is not an object`);
  return Object.entries(m).map(([k, v]): [string, string] => {
    if (typeof v === 'string') return [k, v];
    if (Array.isArray(v) && v.every((x): x is string => typeof x === 'string')) return [k, v.join(', ')];
    throw new ReportPolicyUnreadable(`${path}: ${key}.${k} is not a string or a list of strings`);
  });
}

interface RiskRow {
  tool: string;
  base: string;
  raise: string;
}

function riskRows(doc: Record<string, unknown>): RiskRow[] {
  const list = doc['risk_functions'];
  if (!Array.isArray(list)) throw new ReportPolicyUnreadable('risk_functions.json: risk_functions is not a list');
  return list.map((r: unknown): RiskRow => {
    if (!isRecord(r) || typeof r['applies_to'] !== 'string' || typeof r['base'] !== 'string' || !Array.isArray(r['raise_to'])) {
      throw new ReportPolicyUnreadable('risk_functions.json: an entry is not {applies_to, base, raise_to}');
    }
    const raises = r['raise_to'].map((x: unknown) =>
      isRecord(x) && typeof x['if'] === 'string' && typeof x['then'] === 'string' ? `${x['then']} when ${x['if']}` : '?',
    );
    return { tool: r['applies_to'], base: r['base'], raise: raises.join('; ') };
  });
}

// ---------------------------------------------------------------- the words

/**
 * What each section means and what to do about it, written ONCE, in the
 * reader's words: the report is read by somebody who was not at the machine,
 * so every section says what it is before it shows data. No clause id appears
 * here; a clause stays in the table cell that cites it.
 *
 * None of these strings carries a character `escapeHtml` rewrites, so the
 * text a test looks for is the text on the page.
 */
export const EXPLAIN = {
  reach: {
    means:
      'These are the tool servers your AI coding agents start, and every tool each one offers. ' +
      'An AI agent can call any of them whenever its instructions, or text it reads, tell it to.',
    todo: 'Remove every server nobody on the team uses, and check that the rest are the ones you expect.',
  },
  irreversible: {
    means:
      'These tools make changes no later call can undo, such as deleting, sending or merging. ' +
      'Today an AI agent can call them without asking anyone.',
    todo: 'Check that each tool below is classed correctly, because the draft policy is built from this list.',
  },
  findings: {
    means:
      'Each finding is a way one of these tools could be turned against you, most severe first. ' +
      'Under each one are the regulatory controls it touches, and how far ZIFFER covers each.',
    todo: 'Start with the HIGH findings and decide, for each, whether the tool should stay.',
  },
  unseen: {
    means:
      'The scan reports only the servers it could start and list. A server named here, or an AI agent ' +
      'client this scan does not read, can still hold tools this report does not show.',
    todo: 'Start each server named here once by hand, then run the scan again.',
  },
  replay: {
    means:
      'The replay shows what an AI agent that obeys an injected instruction would do, first with no ' +
      'agent authorization in place, then under the draft policy this scan wrote, graded by the ZIFFER engine on this machine.',
    todo: 'Read the last column: an ALLOWED row is an action the draft policy would let through, and needs a stricter rule.',
  },
  policy: {
    means:
      'This is the agent authorization policy the scan drafted from what it found: how strictly each server ' +
      'is held, which tools can be undone, and how risky each action is. A throwaway key signed it, so it cannot be used as it stands.',
    todo: 'Review it with the person who will sign it off, through the link at the top of this report.',
  },
  placeholders: {
    means:
      'These three values were made up so the draft could be signed and replayed. Nobody holds the keys they name.',
    todo: 'Replace each one with a real person, channel or key before the policy is signed off.',
  },
} as const;

export { GATE_FILE, GROUP_LABEL } from './code-html.js';


/**
 * What the summary's replay sentence says. `counts` is every graded outcome
 * by kind, whatever the stage of a refusal. `grammar` is the case a real
 * machine produces: every harness case names a tool this machine does not
 * have, so each is refused before grading, and three counts would hide that
 * the one row graded against this machine's own tools is the own case.
 */
export type ReplaySummary =
  | { kind: 'counts'; refused: number; held: number; allowed: number }
  | { kind: 'grammar'; harness: number; own?: { server: string; tool: string; verdict: string } };

/** The summary's three sentences, as plain text; the page sets the numbers in bold. */
export interface Summary {
  /** Distinct servers: one name running one program, however many clients configure it. */
  servers: number;
  /** Distinct (server, tool) pairs. */
  tools: number;
  clients: number;
  irreversible: number;
  replay?: ReplaySummary;
}

function replaySentence(r: ReplaySummary): string {
  if (r.kind === 'counts') {
    return `Under the draft policy: ${r.refused} refused, ${r.held} held for approval, ${r.allowed} allowed`;
  }
  const harness =
    `Under the draft policy: the ${r.harness} harness ${r.harness === 1 ? 'case is' : 'cases are'} refused before grading ` +
    `(their tools are not on this machine)`;
  return r.own === undefined ? harness : `${harness}; your own tool, ${r.own.server} \u00b7 ${r.own.tool}, ${r.own.verdict}`;
}

export function summarySentences(s: Summary): string[] {
  return [
    `${plural(s.servers, 'tool server')}, ${plural(s.tools, 'tool')} reachable from ${plural(s.clients, 'AI agent client')}`,
    s.irreversible === 0
      ? 'None of them can do damage that cannot be undone'
      : `${s.irreversible} can do damage that cannot be undone, and nobody is asked`,
    s.replay === undefined ? 'The replay was not run, so no outcome under the draft policy is shown' : replaySentence(s.replay),
  ];
}

// ---------------------------------------------------------------- html pieces

type Cell = string;
/** A table. `head` and `rows` are ALREADY-ESCAPED html. */
function table(head: readonly Cell[], rows: readonly (readonly Cell[])[], empty: string): string {
  if (rows.length === 0) return `<p class="muted">${empty}</p>`;
  const th = head.map((h) => `<th>${h}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n');
  return `<div class="scroll"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`;
}

/** A tool or server name: never broken mid-word; the table scrolls instead. */
const name = (escaped: string): string => `<span class="nw">${escaped}</span>`;
const toolName = (escaped: string): string => `<code>${escaped}</code>`;

function explain(key: keyof typeof EXPLAIN): string {
  const e = EXPLAIN[key];
  return (
    '<div class="explain">' +
    `<p><span class="label">What this means</span>${escapeHtml(e.means)}</p>` +
    `<p><span class="label">What to do</span>${escapeHtml(e.todo)}</p>` +
    '</div>'
  );
}

function cta(extra = ''): string {
  return (
    `<p class="cta-row"><a class="cta" href="${REVIEW_URL}" rel="noopener noreferrer">${escapeHtml(CTA_TEXT)} &#8594;</a>${extra}</p>` +
    `<p class="cta-note">Attach <code>${ARCHIVE_FILE}</code> to the email from that page.</p>`
  );
}

const SEVERITY_ORDER: Record<Finding['severity'], number> = { high: 0, warn: 1, info: 2 };
const SEVERITY_LABEL: Record<Finding['severity'], string> = { high: 'HIGH', warn: 'WARN', info: 'INFO' };

function statusClass(status: ControlRef['status']): string {
  if (status === 'built') return 'st-built';
  if (status === 'partial' || status === 'lands in') return 'st-partial';
  return 'st-open';
}

/**
 * The brand palette: ink, paper, orange. Orange is a fill and a rule, never
 * body text: on paper it does not reach a readable contrast, so text that
 * must read as orange uses the darker `--orange-text`.
 */
const STYLE = `
:root{--ink:#191919;--paper:#F3EDE2;--card:#FFFFFF;--orange:#E75E0D;--orange-text:#C74F06;--orange-dark:#C74F06;
--orange-tint:#FBE9DA;--rule:#DFD6C6;--rule-soft:#EAE2D3;--muted:#6F675A;--ink-3:#98907F;--green:#2E7D4F;--amber:#8A6D1E;--blue:#3B5BA5;
--dark:#191919;--on-dark:#F6F1E8;--on-dark-2:#E4DDCF;--r:18px;--sh-s:0 1px 2px rgba(25,25,25,.05);--sh-m:0 1px 3px rgba(25,25,25,.05),0 12px 32px rgba(25,25,25,.07)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ${SANS};-webkit-font-smoothing:antialiased}
main{display:block}
.wrap{max-width:1156px;margin:0 auto;padding:0 24px}
.band{padding:56px 0}.band.white{background:var(--card)}
h1{font-size:34px;line-height:1.22;margin:12px 0 12px}
h2{font-size:28px;line-height:1.3;margin:44px 0 12px}
.band>.wrap>h2:first-child{margin-top:0}
h3{font-size:18px;margin:24px 0 8px}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:4px 18px;margin:0;font:400 13px/1.5 ${MONO}}
dl.meta dt{color:var(--muted)}dl.meta dd{margin:0;overflow-wrap:anywhere}
code,.mono{font-family:${MONO};font-size:.86em}
p code{overflow-wrap:anywhere}
.muted{color:var(--muted)}
.lede{font-size:17px;color:var(--muted);margin:0 0 24px}
.summary{background:var(--dark);color:var(--on-dark);border-radius:var(--r);padding:28px 30px 24px;margin:0 0 16px}
.summary ul{list-style:none;margin:0 0 18px;padding:0}
.summary li{font-size:19px;line-height:1.45;padding:8px 0 8px 18px;border-left:4px solid var(--orange);margin:0 0 10px;color:var(--on-dark-2)}
.summary li strong{color:var(--orange);font-size:24px}
.cta-row{margin:6px 0 8px}
a.cta{display:inline-block;background:var(--orange);color:var(--dark);font-weight:500;font-size:16px;text-decoration:none;padding:13px 22px;border-radius:99px}
.cta-note{margin:0;font-size:14px}
.summary .cta-note{color:var(--on-dark-2)}.summary .cta-note code{color:var(--on-dark)}
.explain{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:16px 20px;margin:12px 0 16px}
.band.white .explain{background:var(--paper);border-color:transparent}
.explain p{margin:4px 0}
.label{display:block;font:500 11.5px/1.4 ${MONO};letter-spacing:.1em;text-transform:uppercase;color:var(--orange-text)}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0 6px;border:1px solid var(--rule-soft);border-radius:var(--r);background:var(--card);box-shadow:var(--sh-s);padding:4px 20px}
.band.white .scroll{background:var(--paper);border-color:transparent;box-shadow:none}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{text-align:left;vertical-align:top;padding:12px 14px 12px 0;border-bottom:1px solid var(--rule-soft)}
th{font:400 12px/1.2 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);border-bottom-color:var(--rule);white-space:nowrap}
tr:last-child td{border-bottom:0}
.nw,td code{white-space:nowrap}
.notice{background:var(--orange-tint);border-radius:var(--r);padding:14px 20px;margin:12px 0;font-weight:500}
.finding{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:16px 20px;margin:12px 0}
.band.white .finding{background:var(--paper);border-color:transparent}
.finding p{margin:4px 0}
.sev,.badge{display:inline-block;font:500 12px/1 ${MONO};letter-spacing:.04em;padding:6px 10px;border-radius:99px;margin-right:8px;background:var(--paper);color:var(--muted)}
.sev-high,.b-refused{background:var(--orange);color:var(--dark)}.sev-warn{background:var(--ink);color:var(--paper)}.sev-info{background:var(--paper);color:var(--muted)}
.b-held{background:var(--ink);color:var(--paper)}.b-notified{background:var(--orange-tint);color:var(--ink)}
ul.controls{margin:6px 0 0;padding-left:18px;font-size:14px}
td ul.controls{margin:0;padding-left:16px;font-size:13px;min-width:16em}
.st{font-weight:600}.st-built{color:var(--green)}.st-partial{color:var(--amber)}.st-open{color:var(--orange-text)}
.out{font-weight:600}.out-refused{color:var(--green)}.out-held{color:var(--amber)}.out-allowed{color:var(--orange-text)}
details{margin:10px 0}summary{cursor:pointer;font-weight:600}
.placeholder{background:var(--card);border:1px dashed var(--ink-3);border-radius:var(--r);padding:14px 18px;margin:10px 0}
footer h2{margin-top:0}
footer .meta-line{font:400 12px/1.6 ${MONO};color:var(--muted)}
a{color:var(--ink);text-underline-offset:3px}
@media (max-width:900px){.band{padding:40px 0}h1{font-size:27px}h2{font-size:23px}th,td{padding:8px 10px 8px 0}.summary{padding:20px 18px}.summary li{font-size:17px}.summary li strong{font-size:21px}}
`;

// ---------------------------------------------------------------- the renderer

function classificationOf(result: ScanResult, t: CatalogTool): Classification | undefined {
  return result.classifications.find((c) => c.client === t.client && c.server === t.server && c.tool === t.tool);
}

/** The flags as words a reader does not have to decode. */
function flagsOf(c: Classification): string {
  return [c.egress ? 'sends data off this machine' : '', c.untrusted_input ? 'reads input an attacker can write' : '']
    .filter((x) => x !== '')
    .join('; ');
}

/**
 * The classifier's reason for a draft, when it gives one: the phrase that
 * matched, like `description says "Send an email"`. Read structurally, because
 * a classification without it is as valid as one with it.
 */
function reasonOf(c: Classification): string | undefined {
  const v: unknown = Reflect.get(c, 'reason');
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/**
 * The words column B of the terminal replay prints, for one outcome read
 * structurally (the own case's outcome arrives as `unknown`).
 */
function outcomeWords(o: unknown, fingerprint: string, words: PlainWords): { kind: 'refused' | 'held' | 'allowed'; text: string } {
  if (!isRecord(o)) return { kind: 'refused', text: 'no outcome' };
  if (o['kind'] === 'refused') {
    const clause = typeof o['clause'] === 'string' ? o['clause'] : '';
    return { kind: 'refused', text: `REFUSED: ${words.refused[clause] ?? words.refused_unknown}` };
  }
  if (o['kind'] === 'held') {
    const awaits = o['awaits'];
    const k = isRecord(awaits) && typeof awaits['k'] === 'number' ? awaits['k'] : 0;
    const risk = typeof o['risk'] === 'string' ? o['risk'].toLowerCase() : '';
    return { kind: 'held', text: `HELD for ${k} approvers (${risk} risk)` };
  }
  if (o['kind'] === 'allowed') return { kind: 'allowed', text: `ALLOWED with receipt ${hex8(fingerprint)}` };
  return { kind: 'refused', text: 'no outcome' };
}

/**
 * One server as a reader counts it: the same name running the same program,
 * whichever AI agent clients configure it. On a real machine one server was
 * configured in seven clients and the table printed it seven times.
 *
 * The catalog does not carry the command a server was started with (it is
 * discovery's, and dropped before the result is assembled), so "the same
 * program" is read from what the program answered: the same name and the same
 * tool list, each tool's name, description and parameters. Two servers that
 * share a name but list different tools stay two rows. A server that was not
 * listed is grouped the way discovery groups a skipped one: by its name and
 * the reason, which names its command or its address.
 */
interface ServerGroup {
  key: string;
  server: string;
  clients: string[];
  /** One client's tool list: the group's tools are the same in each. */
  tools: CatalogTool[];
  paths: string[];
  phrase?: string;
  /** Set on a server that was not listed: why. */
  notListed?: string;
}

const serverKey = (client: string, server: string): string => `${client}\u0000${server}`;

function groupServers(result: ScanResult): { groups: ServerGroup[]; keyOf: Map<string, string> } {
  const perClient = new Map<string, CatalogTool[]>();
  for (const c of result.catalog) {
    const k = serverKey(c.client, c.server);
    const list = perClient.get(k);
    if (list === undefined) perClient.set(k, [c]);
    else list.push(c);
  }
  const groups = new Map<string, ServerGroup>();
  const keyOf = new Map<string, string>();
  const add = (key: string, client: string, server: string, tools: CatalogTool[], path: string, phrase: string | undefined, notListed?: string): void => {
    const g = groups.get(key);
    if (g === undefined) {
      groups.set(key, {
        key,
        server,
        clients: [client],
        tools,
        paths: path === '' ? [] : [path],
        ...(phrase === undefined ? {} : { phrase }),
        ...(notListed === undefined ? {} : { notListed }),
      });
      return;
    }
    if (!g.clients.includes(client)) g.clients.push(client);
    if (path !== '' && !g.paths.includes(path)) g.paths.push(path);
    if (g.phrase === undefined && phrase !== undefined) g.phrase = phrase;
  };
  for (const [k, tools] of perClient) {
    const first = tools[0];
    if (first === undefined) continue;
    const signature = tools.map((c) => [c.tool, c.description, [...c.params].sort(cmp)]).sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
    const key = JSON.stringify(['listed', first.server, signature]);
    keyOf.set(k, key);
    add(key, first.client, first.server, tools, first.source_path, configuredPhrase(first.configured_in));
  }
  for (const f of result.findings) {
    if ((f.kind !== 'server_not_started' && f.kind !== 'runtime_missing') || f.server === undefined || f.client === undefined) continue;
    add(JSON.stringify(['not listed', f.server, f.message]), f.client, f.server, [], '', configuredPhrase(f.configured_in), f.message);
  }
  return { groups: [...groups.values()], keyOf };
}

export function renderReportHtml(result: ScanResult, replayed: ReplayResult | undefined, ctx: ReportContext): string {
  const source = ctx.source ?? ANNEX;
  /** Text from the (already redacted) scan result: home paths as `~`, escaped. */
  const t = (s: string): string => escapeHtml(homeless(plainKinds(s), ctx.homes));
  /** Text from the replay or the policy: redacted here, as the terminal redacts it line by line. */
  const r = (s: string): string => escapeHtml(homeless(redactText(s), ctx.homes));
  const out: string[] = [];

  // ---- what the summary counts, computed once and shown twice (summary + section)
  const { groups, keyOf } = groupServers(result);
  const listed = groups.filter((g) => g.notListed === undefined);
  const servers = listed.length;
  const distinctTools = listed.reduce((n, g) => n + g.tools.length, 0);
  const catalogClients = uniq(result.catalog.map((c) => c.client));
  // One row per (server group, tool): a tool seven clients reach is one tool.
  const seen = new Set<string>();
  const irreversible = result.catalog.flatMap((c) => {
    const k = classificationOf(result, c);
    if (k === undefined || k.effect !== 'irreversible') return [];
    const id = JSON.stringify([keyOf.get(serverKey(c.client, c.server)) ?? serverKey(c.client, c.server), c.tool]);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ tool: c, k }];
  });
  const fp = replayed?.run.fingerprint ?? '';
  const graded = replayed === undefined ? [] : replayed.rows.map((row) => outcomeWords(row.outcome, fp, ctx.words));
  const own = replayed?.own;
  const ownGraded = own !== undefined && hasOwnCase(own) ? outcomeWords(own.outcome, fp, ctx.words) : undefined;
  const all = ownGraded === undefined ? graded : [...graded, ownGraded];
  const count = (kind: string): number => all.filter((o) => o.kind === kind).length;
  let replaySummary: ReplaySummary | undefined;
  if (replayed !== undefined) {
    const allGrammar =
      replayed.rows.length > 0 && replayed.rows.every((row) => row.outcome.kind === 'refused' && row.outcome.stage === 'grammar');
    if (allGrammar) {
      const shown = (x: string): string => homeless(redactText(x), ctx.homes);
      let ownPart: { server: string; tool: string; verdict: string } | undefined;
      if (own !== undefined && hasOwnCase(own) && ownGraded !== undefined) {
        const o: unknown = own.outcome;
        const awaits = isRecord(o) ? o['awaits'] : undefined;
        const k = isRecord(awaits) && typeof awaits['k'] === 'number' ? awaits['k'] : replayed.quorum_k;
        const verdict =
          ownGraded.kind === 'held' ? `is HELD until ${k} approvers sign` : ownGraded.kind === 'allowed' ? 'is ALLOWED' : 'is REFUSED';
        // The name the server lists, never the key the policy normalised it to.
        ownPart = { server: shown(own.server), tool: shown(own.original_name), verdict };
      }
      replaySummary = { kind: 'grammar', harness: replayed.rows.length, ...(ownPart === undefined ? {} : { own: ownPart }) };
    } else {
      replaySummary = { kind: 'counts', refused: count('refused'), held: count('held'), allowed: count('allowed') };
    }
  }
  const sentences = summarySentences({
    servers,
    tools: distinctTools,
    clients: catalogClients.length,
    irreversible: irreversible.length,
    ...(replaySummary === undefined ? {} : { replay: replaySummary }),
  });

  const code = result.code;
  // A code-only run has no MCP picture: its sections would be tables of nothing.
  const showMcp = hasMcp(result);
  const p = ctx.policy;

  // ---- what the installed half says, on either page: the MCP-only page gives each part its own h2,
  // the --code page folds each under one <details> in its "Tools installed in your AI assistants" section.
  const installedParts = (folded: boolean): string[] => {
    const parts: string[] = [];
    const H = folded ? 'h3' : 'h2';
    let open = false;
    const sub = (title: string): string => {
      if (!folded) return `<${H}>${title}</${H}>`;
      const close = open ? '</details>' : '';
      open = true;
      return `${close}<details class="inner more"><summary>${title}</summary>`;
    };
    // (1) what the AI coding agents can reach
    parts.push(sub('What your AI coding agents can reach'));
    parts.push(explain('reach'));
    const clients = uniq([
      ...result.catalog.map((c) => c.client),
      ...result.findings.flatMap((f) => (f.client !== undefined && f.server !== undefined ? [f.client] : [])),
    ]);
    const serverRows = groups.map((g) => {
      const who =
        g.clients.length === 1
          ? name(t(g.clients[0] ?? ''))
          : `${t(plural(g.clients.length, 'AI agent client'))}: ${g.clients.map((c) => name(t(c))).join(', ')}`;
      const where_ = g.paths.map((x) => `<code>${t(x)}</code>`).join('<br>');
      const phrase = g.phrase === undefined ? '' : ` <span class="muted">(${t(g.phrase)})</span>`;
      return g.notListed === undefined
        ? [name(t(g.server)), who, String(g.tools.length), `${where_}${phrase}`]
        : // The reason already says where the server is configured; the phrase would repeat it.
          [name(t(g.server)), who, '<span class="muted nw">not listed</span>', t(g.notListed)];
    });
    parts.push(
      `<p>${t(plural(distinctTools, 'tool'))} on ${t(plural(servers, 'server'))}` +
        ` configured in ${t(plural(clients.length, 'AI agent client'))}.</p>`,
    );
    parts.push(table(['server', 'AI agent clients', 'tools', 'configured in'], serverRows, 'No AI agent client on this machine has a tool server configured.'));

    // (2) what can do damage that cannot be undone
    parts.push(sub('What can do damage that cannot be undone'));
    parts.push(explain('irreversible'));
    parts.push(
      '<p>Each class is a <strong>draft</strong> read from the tool’s name and description. ' +
        'The engine decides, not this scan.</p>',
    );
    // The `why` column exists only when the classifier said why for at least one row.
    const withWhy = irreversible.some(({ k }) => reasonOf(k) !== undefined);
    const irrHead = withWhy ? ['server', 'tool', 'class', 'why', 'flags'] : ['server', 'tool', 'class', 'flags'];
    const irrRows = irreversible.map(({ tool: c, k }) => {
      const cells = [name(t(c.server)), toolName(t(c.tool)), t(k.effect)];
      const why = reasonOf(k);
      if (withWhy) cells.push(why === undefined ? '<span class="muted">not given</span>' : t(why));
      const flags = flagsOf(k);
      cells.push(flags === '' ? '<span class="muted">none</span>' : t(flags));
      return cells;
    });
    parts.push(table(irrHead, irrRows, 'No tool was drafted as irreversible.'));
    const writes = result.classifications.filter((c) => c.effect === 'write').length;
    if (writes > 0) {
      parts.push(
        `<p>${t(plural(writes, 'tool'))} drafted as <em>write</em> ${writes === 1 ? 'is' : 'are'} also treated as irreversible by the draft policy, ` +
          'because nobody has yet said whether a write can be undone.</p>',
      );
    }

    // (3) findings
    const findings = [...result.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    parts.push(sub(`Findings <span class="muted">(${findings.length}, most severe first)</span>`));
    parts.push(explain('findings'));
    if (findings.length === 0) parts.push('<p class="muted">None.</p>');
    const controlsList = (f: Finding): string =>
      f.controls.length === 0
        ? ''
        : '<ul class="controls">' +
          f.controls
            .map(
              (c) =>
                `<li>${t(c.framework)} <span class="mono">${t(c.clause)}</span>: ` +
                `<span class="st ${statusClass(c.status)}">${t(statusWords(c, source))}</span></li>`,
            )
            .join('') +
          '</ul>';
    for (const f of findings.filter((x) => x.severity !== 'info')) {
      const what = f.tools.length > 0 ? f.tools.join(' + ') : (f.server ?? f.kind.replace(/_/g, ' '));
      const who = f.client === undefined ? '' : ` · ${f.client}`;
      parts.push('<div class="finding">');
      parts.push(`<p><span class="sev sev-${f.severity}">${SEVERITY_LABEL[f.severity]}</span><strong>${t(what)}</strong>${t(who)}</p>`);
      parts.push(`<p>${t(f.message)}</p>`);
      const list = controlsList(f);
      if (list !== '') parts.push(list);
      parts.push('</div>');
    }
    // INFO findings are many on a real machine (79 findings, most of them
    // INFO, on the first run): one row each, in one table, not one card each.
    const lower = findings.filter((x) => x.severity === 'info');
    if (lower.length > 0) {
      parts.push(`<h3 class="lower">Lower findings (${lower.length})</h3>`);
      parts.push(
        table(
          ['finding', 'tool', 'AI agent client', 'controls'],
          lower.map((f) => [
            t(f.message),
            f.tools.length > 0 ? f.tools.map((x) => toolName(t(x))).join(' + ') : name(t(f.server ?? f.kind.replace(/_/g, ' '))),
            f.client === undefined ? '' : name(t(f.client)),
            controlsList(f),
          ]),
          'None.',
        ),
      );
    }

    // (4) what this scan could not see
    parts.push(sub('What this scan could not see'));
    parts.push(explain('unseen'));
    const unseen = result.findings.filter((f) => f.kind === 'server_not_started' || f.kind === 'runtime_missing');
    parts.push(
      table(
        ['server', 'why it was not seen'],
        unseen.map((f) => [name(t(f.server ?? (f.client ?? ''))), t(f.message)]),
        'Every configured server was started and listed its tools.',
      ),
    );
    parts.push(
      `<p><strong>AI agent clients this scan does not read:</strong> ` +
        `${t(result.clients_not_covered.length === 0 ? 'none' : result.clients_not_covered.join(', '))}.</p>`,
    );
    parts.push(`<p>${t(cannotSee(result))}</p>`);
    if (open) parts.push('</details>');
    return parts;
  };

  // ---- the replay, on either page
  const replayParts = (): string[] => {
    const parts: string[] = [explain('replay')];
    if (replayed === undefined) {
      parts.push('<p class="muted">The replay was not run (<code>--no-replay</code>).</p>');
      return parts;
    }
    parts.push(`<p class="notice">${r(replayed.first_line)}</p>`);
    const n = replayed.rows.length;
    const ownSentence =
      own === undefined
        ? ''
        : hasOwnCase(own)
          ? ' The row marked <strong>own</strong> is this machine’s own tool, as a proposal the scan wrote.'
          : ` There is no row for this machine’s own tool: ${r(own.reason)}.`;
    parts.push(
      `<p>The ${r(String(n))} numbered cases are ZIFFER’s own test harness, written for a reference set of tools; ` +
        'on a machine whose tools differ, a case those tools cannot express is refused before the policy grades it.' +
        `${ownSentence}</p>`,
    );
    parts.push(
      `<p class="muted">Key <code>${r(hex8(fp))}</code> (T0, development only) was made for this run and discarded: ` +
        `${r(NOT_EVIDENCE_BECAUSE)}. The cases were copied from <code>${r(replayed.provenance.cases.copied_from)}</code> at ` +
        `<code>${r(replayed.provenance.cases.engine_commit.slice(0, 7))}</code>; the AI agent obeys every one. ` +
        `Without ZIFFER: ${r(WITHOUT_POLICY)}.</p>`,
    );
    const head = ['case', 'injection', 'tool', 'without ZIFFER', 'with the draft policy'];
    const harness = replayed.rows.map((row, i) => {
      const o = graded[i] ?? outcomeWords(row.outcome, fp, ctx.words);
      return [name(r(row.id)), r(row.injection), toolName(r(row.tool)), 'executes', `<span class="out out-${o.kind}">${r(o.text)}</span>`];
    });
    const ownRow =
      own !== undefined && hasOwnCase(own) && ownGraded !== undefined
        ? [
            '<strong>own</strong>',
            `${r(own.label)} (server ${name(r(own.server))})`,
            toolName(r(own.original_name)),
            r(own.without),
            `<span class="out out-${ownGraded.kind}">${r(ownGraded.text)}</span>`,
          ]
        : undefined;
    const allRefused = n > 0 && replayed.rows.every((row) => row.outcome.kind === 'refused');
    if (allRefused) {
      // Eight identical rows say nothing a sentence does not; the sentence
      // says it, and the rows stay one click away for whoever checks it.
      const beforeGrading = replayed.rows.every((row) => row.outcome.kind === 'refused' && row.outcome.stage === 'grammar');
      parts.push(
        `<p><strong>All ${r(String(n))} harness cases were refused.</strong> ` +
          (beforeGrading
            ? 'Each was refused before grading, because the tools on this machine cannot express it: an injected instruction ' +
              'naming a tool this machine does not have goes nowhere. It says nothing yet about how the policy grades your own tools.'
            : 'The draft policy refused every injected action it was shown.') +
          (ownRow === undefined ? '' : ' The own row below is the one that tests this machine’s policy on this machine’s tool.') +
          '</p>',
      );
      if (ownRow !== undefined) parts.push(table(head, [ownRow], 'No case.'));
      parts.push(`<details><summary>Show the ${r(String(n))} harness cases</summary>`, table(head, harness, 'No case.'), '</details>');
    } else {
      parts.push(table(head, ownRow === undefined ? harness : [...harness, ownRow], 'No case.'));
    }
    const through = replayed.rows.filter((row) => row.outcome.kind === 'allowed');
    if (through.length > 0) {
      parts.push(`<p><strong>Not stopped by this policy:</strong> ${r(through.map((row) => `${row.id} ${row.tool}`).join(', '))}.</p>`);
    }
    if (replayed.rows.some((row) => row.outcome.kind === 'held') || ownGraded?.kind === 'held') {
      parts.push(
        `<p>Held: the action waits until ${r(String(replayed.quorum_k))} approvers sign; no receipt exists before they do. ` +
          'This replay does not check the AI agent’s own permissions.</p>',
      );
    }
    return parts;
  };

  // ---- the placeholders, on either page
  const registry = parseMember(p, 'attesters/registry.json');
  const attesters = registry['attesters'];
  const approvers = isRecord(attesters) ? Object.keys(attesters).sort(cmp) : [];
  const k = typeof registry['quorum_k'] === 'number' ? registry['quorum_k'] : 0;
  const notices = stringMap(parseMember(p, 'notice_targets.json'), 'notice_targets', 'notice_targets.json');
  const addressees = uniq(notices.flatMap(([, v]) => v.split(', '))).sort(cmp);
  const receipt = parseMember(p, 'receipt_identity.json');
  const receiptName = typeof receipt['name'] === 'string' ? receipt['name'] : '';
  const placeholderBoxes = [
    `<div class="placeholder"><strong>Approvers.</strong> ${r(approvers.join(', '))}, ${r(String(k))} of whom must sign a held action. ` +
      'Their keys were made for this scan and their private halves discarded, so nobody can approve anything: ' +
      'name your approvers and their keys.</div>',
    // The draft's only addressee is the stand-in (bundle/generate.ts): said in the rule table's words, once.
    addressees.length === 1 && addressees[0] === DEVELOPER
      ? noticePlaceholderHtml(DEVELOPER, r)
      : `<div class="placeholder"><strong>Notice addressee.</strong> ${r(addressees.length === 0 ? 'none' : addressees.join(', '))}: ` +
        `who is told before ${r(plural(notices.length, 'tool'))} the engine treats as irreversible ${notices.length === 1 ? 'runs' : 'run'}, ` +
        'and who receives every alert. Name the person or channel.</div>',
    `<div class="placeholder"><strong>Signing key.</strong> <code>${r(receiptName)}</code> signed this draft and is named as its receipt key; ` +
      'it was made for this run and discarded. Sign the reviewed policy with your own key.</div>',
  ];

  const title = `ZIFFER scan report · ${result.date.slice(0, 10)}`;
  if (code !== undefined) {
    return renderCodePage({ result, code, ctx, t, r, title, installedParts, replayParts, showMcp, placeholderBoxes, installedTiles: { servers, tools: distinctTools, clients: catalogClients.length, irreversible: irreversible.length, high: result.findings.filter((f) => f.severity === 'high').length }, sentences, replayed, source });
  }

  out.push(
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${FONT_SRC}">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${t(title)}</title>`,
    `<style>${fontFaces()}${STYLE}${MAST_STYLE}${EXEC_STYLE}</style>`,
    '</head>',
    '<body>',
  );
  // The executive summary comes first, before anything technical (ACP-455): the page is
  // forwarded to a CEO or a CISO, and the technical report follows under its own divider.
  const exec = mcpExecSummary(result, { tools: distinctTools, irreversible: irreversible.length }, source);
  const kicker = `Executive summary · ZIFFER scan of ${result.date.slice(0, 10)}`;
  out.push(
    // The same nav as the --code page, so the two reports read as one product; then the same bands.
    mastheadHtml(ctx.machine, result.date),
    '<main>',
    '<div class="band"><div class="wrap">',
    execHtml(exec, kicker, (x) => `<code>${t(x)}</code>`),
    '</div></div>',
  );
  out.push(
    '<div class="band white"><div class="wrap">',
    '<header class="tech-top">',
    '<h2 class="tech-title">What the AI coding agents on one machine can do</h2>',
    '<dl class="meta">',
    `<dt>Scan</dt><dd>@ziffer-io/scan ${t(result.scan_version)}</dd>`,
    `<dt>Engine pin</dt><dd><code>${t(result.engine_pin)}</code></dd>`,
    `<dt>Date</dt><dd>${t(result.date)}</dd>`,
    `<dt>Machine</dt><dd>${t(ctx.machine)}</dd>`,
    '</dl>',
    '</header>',
    '<p class="lede">Everything below was computed on that machine. Nothing was sent anywhere; ' +
      'the person who ran the scan chose to forward this file.</p>',
  );

  // ---- the summary: three sentences and the one thing to do
  out.push('<section class="summary">', '<ul>');
  for (const s of sentences) {
    // Every standalone number is set in bold; a digit inside a name is not.
    out.push(`<li>${escapeHtml(s).replace(/(^|[\s(])(\d+)(?=[\s,).]|$)/g, (_m, pre: string, d: string) => `${pre}<strong>${d}</strong>`)}.</li>`);
  }
  out.push('</ul>', cta(), '</section>');
  // A half of the one scan that did not run is said, never left as an empty section.
  const skipped = notScannedSentence('code', scopeOf(result));
  if (skipped !== undefined) out.push(`<p class="notice">${escapeHtml(skipped)}</p>`);

  if (showMcp) out.push(...installedParts(false));
  // The MITRE ATLAS / OWASP view, full size: after what the scan could not see.
  out.push(heatTable(exec.heat, (x) => `<code>${t(x)}</code>`), '</div></div>');
  out.push('<div class="band"><div class="wrap">', '<h2>Replay</h2>', ...replayParts(), '</div></div>');

  // (6) the draft policy, member by member
  out.push('<div class="band white"><div class="wrap">', '<h2>Draft policy</h2>');
  out.push(explain('policy'));
  out.push(`<p class="notice">${t(DRAFT_NOTICE)}</p>`);
  out.push(
    `<p>Tree hash <code>${r(p.treeHash)}</code>, tenant <code>${r(p.tenantId)}</code>, ` +
      `${r(plural(p.files.length, 'file'))} in the <code>${ARCHIVE_POLICY_DIR}/</code> folder of the archive.</p>`,
  );
  const floors = stringMap(parseMember(p, 'floors.json'), 'floors', 'floors.json').sort(([a], [b]) => cmp(a, b));
  out.push('<h3>Floors: the lowest tier each server is held to</h3>');
  out.push(table(['server', 'floor'], floors.map(([kk, v]) => [toolName(r(kk)), r(v)]), 'No server has a floor; the engine holds an absent one at T3.'));
  const rev = stringMap(parseMember(p, 'reversibility.json'), 'reversibility', 'reversibility.json').sort(([a], [b]) => cmp(a, b));
  out.push('<h3>Reversibility</h3>');
  out.push('<p class="muted">A tool absent here is read as IRREVERSIBLE by the engine.</p>');
  out.push(table(['tool', 'class'], rev.map(([kk, v]) => [toolName(r(kk)), r(v)]), 'No tool is listed.'));
  const risk = riskRows(parseMember(p, 'risk_functions.json')).sort((a, b) => cmp(a.tool, b.tool));
  out.push('<h3>Risk functions</h3>');
  out.push(table(['tool', 'base risk', 'raised to'], risk.map((x) => [toolName(r(x.tool)), r(x.base), r(x.raise)]), 'No tool has a risk function.'));
  if (p.unclassified.length > 0) {
    out.push(
      `<p>${r(plural(p.unclassified.length, 'tool'))} with no risk function, which the engine refuses: ` +
        `${r(p.unclassified.map((u) => `${u.server}/${u.tool}`).join(', '))}.</p>`,
    );
  }

  // (7) the placeholders
  out.push('<h2>Placeholders to replace before this policy is used</h2>', explain('placeholders'), ...placeholderBoxes, '</div></div>');

  const mcpPkg = '@ziffer-io/mcp';
  // Next: the review call first, then the engineers' two steps. Short: the page has said the rest.
  const book = `<p class="cta-row"><a class="cta" href="${BOOK_URL}" rel="noopener noreferrer">${escapeHtml(BOOK_TEXT)} &#8594;</a></p>`;
  out.push(
    '<div class="band"><div class="wrap">',
    '<footer>',
    '<h2>Next</h2>',
    book,
    cta(),
    `<p>${escapeHtml(MCP_NEXT).split(mcpPkg).join(`<code>${mcpPkg}</code>`)}</p>`,
    `<p class="meta-line">@ziffer-io/scan ${t(result.scan_version)} · engine <code>${t(result.engine_pin)}</code> · ${t(result.date)}. ` +
      `This file travels in <code>${ARCHIVE_FILE}</code> with the draft policy and the scan’s JSON document.</p>`,
    '</footer>',
    '</div></div>',
    '</main>',
    '</body>',
    '</html>',
  );
  return `${out.join('\n')}\n`;
}
