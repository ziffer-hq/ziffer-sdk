/**
 * The HTML report's `--code` technical part (ACP-455 presentation, second design, 2026-09-28): the
 * sections under "Technical report", each in the prototype's two-column layout (a 260px heading
 * column, the number and the title and one line of what the section is; then the content column).
 *
 * NOTHING HERE GRADES. The grade reads the engine's counts (`CodeSection.counts`); each tool's group
 * is the engine's verdict; each rule is a value read from a policy member the run wrote (`rules.ts`);
 * the pairs are `CodeSection.pairs`. Every ZIFFER word links to https://ziffer.io/docs on first use
 * (`docs.ts`), and the words are in the glossary at the end.
 *
 * A section returns `Sec`; the page numbers the sections it prints, in order, so a section that is
 * absent leaves no hole. Code is never in a narrow box: the gate module and the one line are the
 * full width of the content column. It renders nothing that loads and nothing that runs: a long
 * module folds under a `<details>`, which needs no script.
 */

import { basename } from 'node:path';

import type { CodeSection, CodeToolVerdict } from '../code/types.js';
import type { CatalogTool, SkillRead } from '../types.js';
import {
  APP_SKILLS_LEAD,
  APP_SKILLS_NOT_COVERED,
  APP_SKILLS_SAY,
  APP_SKILLS_TITLE,
  applicationSkills,
  ASSISTANT_SKILLS_LEAD,
  ASSISTANT_SKILLS_SAY,
  ASSISTANT_SKILLS_TITLE,
  assistantSkills,
  capabilityText,
  DECLARES_NOTHING,
  emptyColumnsSentence,
  NAMED_NOT_IN_CODE,
  skillLoadLines,
  SKILL_LIMITS,
  SKILLS_LEAD_GROUPED,
  skillsCountSentence,
  skillsGrouped,
  PAIRS_CONDITION,
  PAIRS_SHOWN,
  pairRows,
  SKILL_HITS_READ,
  SKILLS_LEAD,
  SKILLS_NONE,
  SKILLS_TITLE,
  skillInstructionSentence,
  toolInstructions,
  toolInstructionSentence,
  type PairRow,
} from './instructions.js';
import { UNCLASSIFIED_REASON } from '../classify/index.js';
import { DEVELOPER } from '../bundle/generate.js';
import {
  andList,
  COVERED,
  interceptionSentence,
  scannerFrameworks,
  exposureGrade,
  gradeIfReversible,
  gradeLabel,
  gradeNow,
  GRADE_DEFINITION,
  gradeTitle,
  heldReplyWarning,
  isStub,
  irreversibleBasis,
  isUnlisted as isUnlistedVerdict,
  STUB_LABEL,
  frameworkRows,
  GROUP_WORDS,
  groupOf,
  groupWords,
  plainLead,
  plainNote,
  insertionCall,
  listedSentence,
  loadCodeSdks,
  NOT_READ_YET,
  notifiedCount,
  outsideDispatcher,
  plainNumbersSentence,
  sortedVerdicts,
  syntaxOnlySentence,
  toolFolders,
  toolRoutes,
  unresolvedFiles,
  where,
  type CodeSdkEntry,
  type ExposureGrade,
  type VerdictGroup,
} from './code.js';
import { DOC, memberLink, RISK_LEGEND, TERMS, termLinker, TIER_LEGEND, type TermId } from './docs.js';
import { ARCHIVE_FILE, CTA_TEXT, escapeHtml } from './names.js';
import { REVIEW_URL } from './terminal.js';
import { codeLeak, MATTERS_INTRO, type HeatCell, type MattersRow } from './exec.js';
import { shownId, shownName, withZiffer } from './exec-html.js';
import { OWASP_FRAMEWORK, owaspNote } from './owasp.js';
import { doorBar } from './first.js';
import { codeRules, mcpRules, riskWords, type CodeRule, type DraftRule, type McpRule, type PolicyFile } from './rules.js';
import { applicationId, contextParameter, OPERATOR_OF } from '../code/grade.js';
import {
  BYPASS_TITLE,
  bypassFix,
  bypassPaths,
  bypassSentence,
  callerChecks,
  cannotUndoReason,
  checkLines,
  checkRan,
  CHECK_FOUND_MEANS,
  CHECK_NOT_FOUND_MEANS,
  claimsSentence,
  CONFIRM_VS_APPROVAL,
  enrolNote,
  entryFinding,
  entryFunction,
  ENTRIES_TITLE,
  entryVerb,
  proposedTools,
  raisedCell,
  raisedSentence,
  pathSentence,
  UNDO_CONSERVATIVE,
  UNDO_NEVER_ON_OWN_WORD,
  undoEvidence,
  UNDO_TITLE,
  undoRows,
} from './paths.js';

const e = escapeHtml;

/** The label row above each group of the tools table. */
export const GROUP_LABEL: Record<VerdictGroup, string> = {
  held: 'Held for a human before they run',
  notified: 'Treated as irreversible, run after a notice under the draft policy',
  refused: 'Refused by the engine',
  allowed: 'Run, recorded',
};

/**
 * The grade's box on the page without `--code`: ONE letter, today's (`gradeNow`, ACP-464), labelled
 * with the whole title for a screen reader. The grade within reach is said in the sentence beside it.
 */
export function gradeBox(g: ExposureGrade): string {
  const today = gradeNow(g).today;
  return `<div class="grade grade-${today}" role="img" aria-label="${e(gradeTitle(g))}"><span>${today}</span></div>`;
}

/** The file name the insertion steps tell a reader to save the module under. */
export const GATE_FILE = 'ziffer-gate.ts';

/** How many lines of the gate module show before "Show all N lines". */
export const GATE_LINES_SHOWN = 12;

/** The id of the folded "Placeholders to replace" under the policy: step 4's link opens it (the page script sets `open`). */
export const PLACEHOLDERS_ID = 'placeholders';

/** The "Who is asked" table's second column: what the model can reach from the entry, bounded or not. */
export const ENTRIES_REACH_HEAD = 'What the model can reach';

/** How many rows of a checklist group show before "N more in this group". */
export const CHECKLIST_ROWS_SHOWN = 4;

/** How many skills and instruction files show before the rest fold, in a result made before ACP-460 (one list). */
export const SKILLS_SHOWN = 10;
/** How many of the application's skills show before "+ N more" (ACP-460): the group the reader cares about gets more room. */
export const APP_SKILLS_SHOWN = 8;
/** How many of the coding assistants' files show before "+ N more" (ACP-460). */
export const ASSISTANT_SKILLS_SHOWN = 4;

/** One column of a skills table: its heading, and the id its `<th>` class and the empty-column rule read. */
interface SkillColumn {
  id: 'name' | 'found' | 'tools' | 'file' | 'declares' | 'can' | 'hits';
  label: string;
}
const APP_HEAD: readonly SkillColumn[] = [
  { id: 'name', label: 'Skill' },
  { id: 'found', label: 'How it was found' },
  { id: 'tools', label: 'Tools it names' },
  { id: 'can', label: 'What it can do' },
  { id: 'hits', label: 'Instruction hits' },
];
const ASSISTANT_HEAD: readonly SkillColumn[] = [
  { id: 'file', label: 'File' },
  { id: 'declares', label: 'What it declares' },
  { id: 'can', label: 'What it can do' },
  { id: 'hits', label: 'Instruction hits' },
];
const hasHigh = (s: SkillRead): boolean => s.instruction_hits.some((h) => h.severity === 'high');
/** Files with a HIGH hit first, so the folded rows never hide one. */
const highFirst = (list: readonly SkillRead[]): SkillRead[] => [...list.filter(hasHigh), ...list.filter((s) => !hasHigh(s))];
/** The application's skills: a HIGH hit first, then those the scan saw loaded, then the rest, each in the order given. */
const appOrder = (list: readonly SkillRead[]): SkillRead[] => {
  const rank = (s: SkillRead): number => (hasHigh(s) ? 0 : (s.loaded_by ?? []).length > 0 ? 1 : 2);
  return list.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
};

/** What happens after the paste, in three sentences, each a fact of the product. */
export const AFTER_PASTE = [
  'Each tool call that goes through the call becomes a proposal to ZIFFER before it runs, on the model path and on every other caller alike.',
  'A call the policy holds waits for a named person to approve it; a call it refuses never runs.',
  'Every call that runs gets a signed receipt you can verify later.',
] as const;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** An escaped sentence with its `names` set as code: the shared sentences quote a property or a check by backticks. */
const ticks = (escaped: string): string => escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

/** One section of the technical part: its anchor, its title, one line of what it is (html), and its content (html). */
export interface Sec {
  id: string;
  title: string;
  lede: string;
  body: string;
}

/** A lede's first sentence (the grey half of the heading) and the rest (the lead under it). */
export function splitLede(lede: string): { first: string; rest: string } {
  const m = /^([^]*?[.?!])\s+(?=[A-Z<])([^]*)$/.exec(lede);
  return m === null ? { first: lede, rest: '' } : { first: m[1] ?? '', rest: m[2] ?? '' };
}

/**
 * A technical section as a band (ACP-455, third design): full width, its tone set by the page so
 * that consecutive sections alternate; the heading in two tones, the title in ink and the lede's
 * first sentence in grey; the rest of the lede as the lead under it. No number.
 */
export function secHtml(s: Sec, tone: 'paper' | 'white'): string {
  const { first, rest } = splitLede(s.lede);
  return (
    `<div class="band${tone === 'white' ? ' white' : ''}"><div class="wrap"><section class="sec" id="${s.id}">` +
    `<header class="head"><h2>${e(s.title)}.${first === '' ? '' : ` <span>${first}</span>`}</h2>${rest === '' ? '' : `<p class="lead">${rest}</p>`}</header>` +
    `<div>${s.body}</div></section></div></div>`
  );
}

/** A table in its card, read row by row on a narrow screen: each cell after the first carries its column's name in `data-l`. */
function rtable(cls: string, head: readonly string[], rows: readonly (readonly string[])[], labels: readonly string[] = head, caption?: string): string {
  return (
    `<div class="card"><table class="r ${cls}">${caption === undefined ? '' : `<caption class="sr">${caption}</caption>`}<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c, i) => `<td${dataL(labels[i], i)}>${c}</td>`).join('')}</tr>`).join('') +
    '</tbody></table></div>'
  );
}

/** The `data-l` attribute of a cell: its column's name, on every cell but the first. */
export function dataL(label: string | undefined, i: number): string {
  return i === 0 || label === undefined || label === '' ? '' : ` data-l="${e(label)}"`;
}

/** Words the dark card sets in the keyword colour, outside strings and comments. Nothing else is highlighted: no parser. */
const KEYWORDS = /\b(import|from|export|const|let|function|async|await|return|new|type|interface|throw|if|else|def|raise|class|try|catch)\b/g;
const STRINGS = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`)/;

/** One line of quoted code for the dark card: a comment line dimmed, keywords outside strings in the keyword colour, the rest as written. */
export function codeLine(line: string, t: (s: string) => string): string {
  if (/^\s*(\/\/|#|\*|\/\*)/.test(line)) return `<span class="c">${t(line)}</span>`;
  return line
    .split(STRINGS)
    .map((part, i) => (i % 2 === 1 ? t(part) : t(part).replace(KEYWORDS, '<span class="k">$1</span>')))
    .join('');
}

const codeText = (text: string, t: (s: string) => string): string => text.split('\n').map((l) => codeLine(l, t)).join('\n');

/** A dialog: its heading, a Close button, and its body; `cls` sets `code` for the dark one. */
export function dialogHtml(id: string, title: string, small: string, body: string, extra = '', cls = ''): string {
  return (
    `<dialog id="${id}"${cls === '' ? '' : ` class="${cls}"`} aria-label="${e(title.replace(/<[^>]+>/g, ''))}"><div class="dh"><span><b>${title}</b>${small === '' ? '' : `<small>${small}</small>`}</span>` +
    `<span>${extra}<button class="x" type="button" data-close>Close</button></span></div><div class="db">${body}</div></dialog>`
  );
}

/** A block of code in the dark card with its Copy button: a long one shows its first `GATE_LINES_SHOWN` lines and opens whole in a dialog. */
function codeBlock(id: string, bar: string, text: string, t: (s: string) => string): string {
  const lines = text.split('\n');
  const copy = `<button class="copy" type="button" data-copy-from="${id}">Copy</button>`;
  const head = `<div class="code"><div class="bar"><span>${bar}</span>${copy}</div>`;
  if (lines.length <= GATE_LINES_SHOWN + 2) {
    return `${head}<pre><code id="${id}">${codeText(text, t)}</code></pre></div>`;
  }
  return (
    head +
    `<pre class="head" aria-hidden="true"><code>${codeText(lines.slice(0, GATE_LINES_SHOWN).join('\n'), t)}</code></pre>` +
    `<button class="more" type="button" data-open="m-${id}">Show all ${lines.length} lines</button></div>` +
    dialogHtml(`m-${id}`, bar.replace(/ · .*$/, ''), `${lines.length} lines`, `<pre><code id="${id}">${codeText(text, t)}</code></pre>`, `${copy} `, 'code')
  );
}


/**
 * Whether one path puts a reader and a sender in front of the same model: read from the lists the
 * entries install (`offered`, `reaches`), and only when every entry has one. When any entry's list
 * is not readable from the source, the answer is the run time's, and the cell says so.
 */
export function bothOnOnePath(code: CodeSection, reader: string, senders: readonly string[]): string {
  const checks = code.insertion.dispatcher?.caller_checks ?? [];
  const lists = checks.map((c) => ({ c, list: c.offered ?? c.reaches }));
  if (lists.length === 0 || lists.some((x) => x.list === undefined)) return 'Decided at run time';
  const both = lists.filter((x) => (x.list ?? []).includes(reader) && senders.some((s) => (x.list ?? []).includes(s)));
  return both.length === 0 ? 'No entry lists both' : `Yes, from ${andList(both.map((x) => entryFunction(x.c)))}`;
}

/** Whether the limits section says what the ways of finding a skill do not see: a result that says who loads each file, or one that found none. */
export function skillLimitsApply(skills: readonly SkillRead[] | undefined): boolean {
  return skills !== undefined && (skills.length === 0 || skillsGrouped(skills));
}

/** The headings the limits' notes are grouped under, in the order printed. */
export type LimitGroup = 'runtime' | 'unread' | 'how' | 'other';
export const LIMIT_GROUPS: readonly { id: LimitGroup; title: string }[] = [
  { id: 'runtime', title: 'Decided at run time' },
  { id: 'unread', title: 'Not read' },
  { id: 'how', title: 'How the code was read' },
  { id: 'other', title: 'Other' },
];

/**
 * Where one of the catalog's own notes goes (`not_seen`, written by `code/notseen.ts`, `code/index.ts`
 * and the Python front end): what only the running application decides, what was left unread, how
 * the reading was made. Read from the note's own words; a note none of them fits goes under "Other",
 * never forced into a heading it does not answer.
 */
export function limitGroup(note: string): LimitGroup {
  if (/\bat runtime\b|\bat run time\b|by a computed name|provider-executed|provider-defined/i.test(note)) return 'runtime';
  if (/\bnot read\b|not yet read|were not walked|could not be read|not parsed|does not read them/i.test(note)) return 'unread';
  if (/calls deep|could not resolve/i.test(note)) return 'how';
  return 'other';
}

/**
 * The limits "What was read, and what was not" leads with (ACP-464): at most `HEADLINE_LIMITS_SHOWN`,
 * chosen by rule from the data and shown only when their figure is not zero; everything else is in
 * the one folded block under them, where every note stays whole. The order is the order of
 * consequence, and it is data: a limit earlier in this list changes more of what the page's numbers
 * mean than one after it.
 *
 * 1. `runtime-set`: which tools a model gets is decided at run time and could not be resolved, so
 *    every number on the page counts what CAN be exposed.
 * 2. `unresolved-imports`: files import packages the type checker could not resolve; the grade is
 *    provisional.
 * 3. `nested-checkouts`: source files skipped as a nested worktree or submodule checkout.
 * 4. `frameworks-unread`: declared tool-calling frameworks this scan does not read; their tools are
 *    not in the numbers.
 * 5. `mcp-runtime`: tools fetched at run time from an MCP server are not listed.
 * 6. `computed-imports`: files load code by a computed name, which import resolution cannot follow.
 * 7. `python-unread`: Python files present and not read.
 *
 * The figures of 2, 3, 5, 6 and 7 are read back from the catalog's own lines (`not_seen`), as
 * `unresolvedFiles` reads the grade's, so the headline and the note under it cannot disagree.
 */
export type HeadlineLimitId = 'runtime-set' | 'unresolved-imports' | 'nested-checkouts' | 'frameworks-unread' | 'mcp-runtime' | 'computed-imports' | 'python-unread';
export const HEADLINE_LIMIT_ORDER: readonly HeadlineLimitId[] = ['runtime-set', 'unresolved-imports', 'nested-checkouts', 'frameworks-unread', 'mcp-runtime', 'computed-imports', 'python-unread'];
export const HEADLINE_LIMITS_SHOWN = 3;
/** The folded block that holds every other note of the section, in plain words. */
export const LIMITS_FOLD_TITLE = 'Every other limit, and how the code was read';

const NESTED_LINE = /(\d+) source file\(s\) in a nested git worktree or submodule checkout/;
const MCP_RUNTIME_LINE = /^tools fetched at runtime from an MCP server are not listed(?: \((\d+) client attach point)?/i;
const COMPUTED_IMPORT_LINE = /^(\d+) file\(s\) load code by a computed name/;
const PY_UNREAD_LINE = /^(\d+) Python file(?:s|\(s\)) (?:are )?present/;

/** The first number a line of `not_seen` carries for a pattern, summed over every line it matches; 0 when none does. */
function figureOf(code: CodeSection, re: RegExp, absentNumber = 0): number {
  let n = 0;
  for (const line of code.catalog.not_seen) {
    const m = re.exec(line);
    if (m !== null) n += m[1] === undefined ? absentNumber : Number(m[1]);
  }
  return n;
}

export interface HeadlineLimit {
  id: HeadlineLimitId;
  n: number;
  /** Escaped html, the figure in bold. */
  html: string;
}

/** Every headline limit whose figure is not zero, in `HEADLINE_LIMIT_ORDER`; the page shows the first `HEADLINE_LIMITS_SHOWN`. */
export function headlineLimits(code: CodeSection, unreadFrameworks: readonly string[], t: (s: string) => string): HeadlineLimit[] {
  const b = (n: number): string => `<b>${n.toLocaleString('en-US')}</b>`;
  const gates = code.catalog.gates;
  const unnamed = code.catalog.exposures.filter((x) => x.kind === 'computed' && x.tools.length === 0).length;
  const by = gates.length === 0 ? '' : ` by ${andList(gates.map((g) => `<code>${t(g.name)}</code>`))}`;
  const all: Record<HeadlineLimitId, () => HeadlineLimit> = {
    'runtime-set': () => ({
      id: 'runtime-set',
      n: gates.length + unnamed,
      html:
        `The set of tools a model is given is decided at run time${by}, and the scan could not resolve it from the code` +
        `${unnamed > 0 ? ` (${b(unnamed)} ${unnamed === 1 ? 'tool set' : 'tool sets'} could not be named)` : ''}: every number here counts the tools that CAN be exposed.`,
    }),
    'unresolved-imports': () => {
      const n = unresolvedFiles(code);
      return { id: 'unresolved-imports', n, html: `${b(n)} ${n === 1 ? 'file imports' : 'files import'} packages that could not be resolved, so the grade is provisional.` };
    },
    'nested-checkouts': () => {
      const n = figureOf(code, NESTED_LINE);
      return { id: 'nested-checkouts', n, html: `${b(n)} source ${n === 1 ? 'file was' : 'files were'} skipped as a nested worktree or submodule checkout.` };
    },
    'frameworks-unread': () => {
      const n = unreadFrameworks.length;
      return { id: 'frameworks-unread', n, html: `${b(n)} declared tool-calling ${n === 1 ? 'framework is' : 'frameworks are'} not read by this scan: a tool defined through ${n === 1 ? 'it' : 'them'} is not in the numbers.` };
    },
    'mcp-runtime': () => {
      const n = figureOf(code, MCP_RUNTIME_LINE, 1);
      return { id: 'mcp-runtime', n, html: `Tools fetched at run time from an MCP server are not listed: ${b(n)} ${n === 1 ? 'place attaches' : 'places attach'} one.` };
    },
    'computed-imports': () => {
      const n = figureOf(code, COMPUTED_IMPORT_LINE);
      return { id: 'computed-imports', n, html: `${b(n)} ${n === 1 ? 'file loads' : 'files load'} code by a computed name, which the scan cannot follow.` };
    },
    'python-unread': () => {
      const n = figureOf(code, PY_UNREAD_LINE);
      return { id: 'python-unread', n, html: `${b(n)} Python ${n === 1 ? 'file was' : 'files were'} not read.` };
    },
  };
  return HEADLINE_LIMIT_ORDER.map((id) => all[id]()).filter((x) => x.n > 0);
}

/** The catalog's notes whose kind is a coding assistant configured in the repository (`CodeCatalog.assistant_config`). */
export function assistantNotes(code: CodeSection): ReadonlySet<string> {
  return new Set(code.catalog.assistant_config ?? []);
}

/** The sub-heading the coding-assistant notes sit under in "Tools installed in your AI assistants". */
export const ASSISTANT_CONFIG_TITLE = 'Found in this repository’s coding-assistant configuration';

/**
 * The notes about a developer's coding assistant configured in this repository (hook registrations,
 * permission rules, MCP servers configured for the assistant), placed by their KIND, never by the
 * file name they quote (ACP-464). They are about the assistant, not the application. Empty when none.
 */
export function assistantConfigHtml(code: CodeSection, t: (s: string) => string): string {
  const notes = code.catalog.not_seen.filter((l) => assistantNotes(code).has(l));
  if (notes.length === 0) return '';
  return `<div class="cols assistant-config"><div class="col" data-group="assistant-config"><h3>${e(ASSISTANT_CONFIG_TITLE)}</h3><ul>${notes.map((n) => `<li>${t(n)}</li>`).join('')}</ul></div></div>`;
}

/** One page's renderer: the term linker is shared so a term links on its first use only. */
export class CodeHtml {
  readonly link = termLinker();

  constructor(private readonly input: CodeHtmlInput) {}

  private get code(): CodeSection {
    return this.input.code;
  }

  private t(s: string): string {
    return this.input.t(s);
  }

  private sdks(): readonly CodeSdkEntry[] {
    return this.input.codeSdks ?? loadCodeSdks();
  }

  // ------------------------------------------------------------ 01 what was read, and what was not

  limits(): Sec {
    const code = this.code;
    const t = (s: string): string => this.t(s);
    const frameworks = frameworkRows(code, this.sdks());
    const unread = frameworks.filter((f) => !f.covered);
    const g = exposureGrade(code);
    const s = code.catalog.syntax_only;
    const unresolved = g?.unresolvedFiles ?? 0;
    const tile = (b: string, span: string): string => `<div><b>${b}</b><span>${span}</span></div>`;
    const tiles = [
      tile(t(code.catalog.files_read.toLocaleString('en-US')), `${code.catalog.files_read === 1 ? 'source file' : 'source files'} read, as text. None of your code was run.`),
      tile(String(code.counts.tools), `${code.counts.tools === 1 ? 'tool' : 'tools'} found${s.missed > 0 ? `, ${s.missed} of them by following types` : ''}`),
      unresolved > 0
        ? tile(t(unresolved.toLocaleString('en-US')), `${unresolved === 1 ? 'file imports' : 'files import'} packages that are not installed: the grade is provisional`)
        : tile('0', 'files with imports the scan could not resolve'),
      tile(`${frameworks.length - unread.length} of ${frameworks.length}`, `tool-calling ${frameworks.length === 1 ? 'framework' : 'frameworks'} declared in this application’s dependencies ${frameworks.length - unread.length === 1 ? 'is' : 'are'} read by this scan`),
    ];
    // Every note, grouped under the heading it answers; none dropped, none reworded. The ones built
    // here are placed by construction; the catalog's own (`not_seen`) by `limitGroup`.
    const note = (group: LimitGroup, text: string): { group: LimitGroup; text: string } => ({ group, text });
    const notes: { group: LimitGroup; text: string }[] = [
      { group: 'how', text: `Read: ${plural(code.catalog.files_read, 'file')} of your code, where the scan found ${plural(code.counts.tools, 'tool')} a model is given.` },
      { group: 'how', text: syntaxOnlySentence(code) },
      // The grade's own counts are said beside the grade on the first screen (ACP-464): only what each letter means is said here.
      ...(g === undefined ? [] : [note('other', GRADE_DEFINITION)]),
      ...(unread.length === 0
        ? []
        : [
            note(
              'unread',
              `${plural(unread.length, 'declared framework')} ${unread.length === 1 ? 'is' : 'are'} not read by this scan yet: ${andList(unread.map((f) => f.name))}. A tool defined through ${unread.length === 1 ? 'it' : 'them'} is not in the numbers on this page.`,
            ),
          ]),
      // A note whose kind is a coding assistant's configuration is said with the assistants, not here (ACP-464).
      ...code.catalog.not_seen.filter((text) => !assistantNotes(code).has(text)).map((text) => ({ group: limitGroup(text), text })),
      ...checkLines(code).map((text) => note('how', text)),
      // What the three ways of finding a skill do not see (ACP-460): said when the result carries them, or found none.
      ...(skillLimitsApply(this.input.skills) ? SKILL_LIMITS.map((x) => note(x.group, x.text)) : []),
    ];
    const cols = LIMIT_GROUPS.map((gr) => ({ gr, list: notes.filter((n) => n.group === gr.id) }))
      .filter((x) => x.list.length > 0)
      .map((x) => `<div class="col" data-group="${x.gr.id}"><h3>${e(x.gr.title)}</h3><ul>${x.list.map((n) => `<li>${t(n.text)}</li>`).join('')}</ul></div>`);
    const heads = headlineLimits(code, unread.map((f) => f.name), t).slice(0, HEADLINE_LIMITS_SHOWN);
    const body = [
      `<div class="limits">${tiles.join('')}</div>`,
      heads.length === 0
        ? ''
        : `<div class="cols headline"><div class="col" data-group="headline"><h3>What limits this reading most</h3><ul>${heads.map((h) => `<li data-limit="${h.id}">${h.html}</li>`).join('')}</ul></div></div>`,
      `<details class="inner limits-fold"><summary>${e(LIMITS_FOLD_TITLE)}</summary>`,
      `<div class="cols">${cols.join('')}</div>`,
      '</details>',
      '<details class="inner"><summary>Frameworks found in your dependencies</summary>',
      frameworks.length === 0
        ? '<p class="muted">No tool-calling framework is declared in this application’s dependency files.</p>'
        : rtable(
            'fw',
            ['Package', 'Version', 'Framework', 'Read by this scan'],
            frameworks.map((f) => [
              `<code>${t(f.name)}</code>`,
              t(f.version),
              f.framework === undefined ? '<span class="muted">not one the scan knows</span>' : t(f.framework),
              f.covered ? e(COVERED) : `<span class="warn">${e(NOT_READ_YET)}</span>`,
            ]),
          ),
      this.scannerList(),
      '</details>',
      this.application(),
    ];
    return { id: 'limits', title: 'What was read, and what was not', lede: 'Everything below is true of the files the scan read, and of nothing else.', body: body.join('\n') };
  }

  /** Every framework the scanner reads, by language, from the data file: about the scanner, not this application. */
  private scannerList(): string {
    const { groups, unread } = scannerFrameworks(this.sdks());
    return (
      `<p>${e('The table above is this application. The scan itself reads these frameworks, by the language they are written in:')}</p>` +
      `<ul>${groups.map((g) => `<li><b>${e(g.language)}</b>: ${e(g.names.join(', '))}.</li>`).join('')}</ul>` +
      (unread.length === 0 ? '' : `<p>${e(`Listed, and not read by this scan yet: ${unread.join(', ')}.`)}</p>`)
    );
  }

  /** How THEIR code hands tools to a model: the call sites, the definitions, the one function, the folders. A block of section 01. */
  private application(): string {
    const code = this.code;
    const t = (s: string): string => this.t(s);
    const rows: string[][] = [];
    for (const x of code.catalog.exposures) {
      const check = interceptionSentence(x.interception);
      rows.push(['Hands tools to a model', `<code>${t(x.via)}</code>${x.tools.length > 0 ? `<small>${t(plural(x.tools.length, 'tool'))} joined back</small>` : ''}${check === undefined ? '' : `<small>${t(check)}</small>`}`, `<code>${t(where(x.at))}</code>`]);
    }
    if (code.catalog.exposures.length === 0) rows.push(['Hands tools to a model', '<span class="muted">The scan found no place these tools are handed to a model.</span>', '']);
    for (const r of toolRoutes(code, this.sdks())) {
      rows.push(['Defines the tools', `<b>${r.tools}</b> ${t(r.plain)}`, r.plain.includes(r.framework) ? `<code>${t(r.via)}</code>` : t(r.framework)]);
    }
    const d = code.insertion.dispatcher;
    const call = insertionCall(code.insertion);
    if (d === null) {
      rows.push(['Runs every tool', '<span class="muted">No single function runs every tool: ZIFFER goes in each tool’s execute, one call at the top of each.</span>', '']);
    } else {
      rows.push([
        'Runs every tool',
        `<code>${t(d.name)}${t(d.signature)}</code><small>${t(`${plural(d.tools_delegating, 'tool')} of ${code.counts.tools} run through it, called from ${plural(d.callers.length, 'place')}`)}</small>${call === undefined ? '' : `<small>ZIFFER goes at its top: <code>${t(call)}</code></small>`}`,
        `<code>${t(where(d.at))}</code>`,
      ]);
    }
    const folders = toolFolders(code);
    const shown = folders.slice(0, 8);
    rows.push([
      'Keeps the tools in',
      shown.map((f) => `<code>${t(f.folder)}/</code> <span class="muted">${f.tools}</span>`).join('<br>') + (folders.length > shown.length ? `<small>and ${folders.length - shown.length} more folders</small>` : ''),
      t(plural(folders.length, 'folder')),
    ]);
    const listed = listedSentence(code);
    const gates = code.catalog.gates;
    return (
      '<div id="application">' +
      '<h3>How your code gives tools to a model</h3>' +
      `<p>${t(plainNumbersSentence(code, this.sdks()))}${listed === undefined ? '' : ` ${t(listed)}`}</p>` +
      rtable('app', ['Step', 'In your code', 'Where'], rows.map((r) => [e(r[0] ?? ''), r[1] ?? '', r[2] ?? ''])) +
      (gates.length === 0
        ? ''
        : `<p class="say">Which tools a call gets is decided at runtime by ${andList(gates.map((g) => `<code>${t(g.name)}</code> (<code>${t(where(g.at))}</code>)`))}; the scan lists every tool that can be exposed.</p>`) +
      `<p class="say">Your tools live in ${t(plural(folders.length, 'folder'))}. Every tool, with its description and definition, is in <a href="#appendix">the appendix</a>.</p>` +
      '</div>'
    );
  }

  // ------------------------------------------------------------ 02 who is asked, per entry

  entries(): Sec | undefined {
    const code = this.code;
    const t = (s: string): string => this.t(s);
    const d = code.insertion.dispatcher;
    if (d === null) return undefined;
    const checks = callerChecks(code);
    const claims = claimsSentence(code);
    const body: string[] = [];
    if (checks === undefined) {
      body.push(`<p class="muted">What the code tests before each call to <code>${t(d.name)}</code>: not looked for in this scan.</p>`);
    } else {
      // What the model can reach from this entry is the row's key fact (ACP-464): the second column, in
      // the ink and weight of the row's headline, never grey, also when the source does not bound it.
      const reach = (c: (typeof checks)[number]): string => {
        if (c.offered !== undefined && c.offered.length > 0) {
          const stubs = c.offered.filter((n) => code.verdicts.some((v) => v.tool.name === n && isStub(v))).length;
          const live = c.offered.filter((n) => !code.verdicts.some((v) => v.tool.name === n && isStub(v)));
          const said =
            stubs === 0
              ? andList(c.offered.slice(0, 4).map((n) => `<code>${t(n)}</code>`)) + (c.offered.length > 4 ? ` and ${c.offered.length - 4} more` : '')
              : `${stubs} declared and not wired yet${live.length === 0 ? '' : `, and ${andList(live.slice(0, 3).map((n) => `<code>${t(n)}</code>`))}${live.length > 3 ? ` and ${live.length - 3} more` : ''}`}`;
          return `<span class="reach">${c.offered.length}: ${said}</span>${c.offered_from === undefined ? '' : `<small>${t(c.offered_from)}</small>`}`;
        }
        if (c.reaches !== undefined) return `<span class="reach">can reach ${c.reaches.length}</span>${c.reaches_from === undefined ? '' : `<small>${t(c.reaches_from)}</small>`}`;
        return '<span class="reach">not bounded by the source: any tool the dispatcher knows</span>';
      };
      const head = ['Entry', ENTRIES_REACH_HEAD, 'Before the call'];
      const rows = checks.map((c) => {
        const cells = [
          `<b class="m">${t(entryFunction(c))}</b><small>${t(where(c.caller))}</small>`,
          reach(c),
          `${c.check === undefined ? '<span class="tag no">NO CHECK FOUND</span>' : '<span class="tag">check found</span>'}<small>${ticks(t(entryFinding(c)))}</small>`,
        ];
        return `<tr class="entry${c.check === undefined ? ' entry-none' : ''}">${cells.map((x, i) => `<td${dataL(head[i], i)}>${x}</td>`).join('')}</tr>`;
      });
      body.push(`<div class="card"><table class="r entries"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      for (const c of checks.filter((x) => x.check === undefined)) body.push(`<p class="say"><b>${t(entryFunction(c))}.</b> ${ticks(t(pathSentence(code, c)))}</p>`);
      body.push(`<p class="say">${e(CHECK_FOUND_MEANS)} ${e(CHECK_NOT_FOUND_MEANS)}</p>`);
    }
    if (claims !== undefined) body.push(`<p class="say">${ticks(t(claims))}</p>`);
    body.push(`<p class="say">${e(CONFIRM_VS_APPROVAL)}</p>`);
    return { id: 'entries', title: ENTRIES_TITLE, lede: t(`Every call to ${d.name} the scan found, and what the source shows before it.`), body: body.join('\n') };
  }

  // ------------------------------------------------------------ 03 put ZIFFER in place

  insertion(): Sec {
    const code = this.code;
    const t = (s: string): string => this.t(s);
    const ins = code.insertion;
    const d = ins.dispatcher;
    const call = insertionCall(ins);
    const lang = ins.snippet_language === 'typescript' ? 'TypeScript' : ins.snippet_language;
    const steps: string[] = [];
    let notLooked = '';
    // A step with a card (its code or its table) is a row: its badge, heading and sentences on the left, the card on the right.
    // A step with no card is one compact full-width row: badge and heading on one line, the sentence under them, its
    // action at the right end; a two-column row with nothing on the right would be an empty half-page.
    const step = (title: string, left: string, side: { card: string } | { action: string }, id?: string): void => {
      const n = `<span class="badge">Step ${steps.length + 1}</span>`;
      const at = id === undefined ? '' : ` id="${id}"`;
      steps.push(
        'card' in side
          ? `<li class="step"${at}><div>${n}<h3>${title}</h3>${left}</div><div class="side">${side.card}</div></li>`
          : `<li class="step compact"${at}><div><div class="st">${n}<h3>${title}</h3></div>${left}</div><div class="end">${side.action}</div></li>`,
      );
    };
    if (call === undefined) {
      step(
        d === null ? 'Paste this at the top of each tool’s execute' : `Paste this at the top of ${t(d.name)}`,
        d === null ? '' : `<p>At <code>${t(where(d.at))}</code>.</p>`,
        { card: codeBlock('ziffer-snippet', `<b>${e(lang)}</b> · ${ins.snippet.split('\n').length} lines`, ins.snippet, t) },
      );
    } else {
      const beside = d === null ? 'in your application' : `beside <code>${t(basename(d.at.file))}</code>`;
      step(
        'Save the gate module',
        `<p>As <code>${GATE_FILE}</code> ${beside}. It builds the ${this.link('proposal')} and waits for the decision.</p>`,
        { card: codeBlock('ziffer-snippet', `<b>${GATE_FILE}</b> · ${e(lang)} · ${ins.snippet.split('\n').length} lines`, ins.snippet, t) },
      );
      const target = d === null ? 'each tool’s execute' : t(d.name);
      const bar = doorBar(code);
      const barSentence =
        d === null
          ? ''
          : `<p>Of the ${bar.total} ${bar.total === 1 ? 'tool' : 'tools'} that pass ${t(d.name)}, the draft ${andList(bar.groups.map((g) => `${g.group === 'held' ? 'holds' : g.group === 'notified' ? 'runs after a notice' : g.group === 'allowed' ? 'runs with a record' : 'refuses'} <b>${g.n}</b>`))}.</p>`;
      step(
        `Add one line at the top of ${target}`,
        barSentence,
        {
          card:
            codeBlock('ziffer-call', `<b>${d === null ? 'each tool' : t(`${basename(d.at.file)}:${d.at.line}`)}</b> · one line`, call, t) +
            (d === null
            ? ''
            : `<p class="say">At the top of <code>${t(d.name)}${t(d.signature)}</code> (<code>${t(where(d.at))}</code>). Its ${t(plural(d.callers.length, 'caller'))}, whichever path the call comes from: ${d.callers.map((c) => `<code>${t(where(c))}</code>`).join(', ')}.</p>`) +
            `<p class="operator say">${t(operatorSentence(code))}</p>`,
        },
      );
      const outside = outsideDispatcher(code);
      const paths = bypassPaths(code);
      const places = outside.count + paths.length;
      if (places > 0 && d !== null) {
        const rows: string[][] = [];
        for (const p of paths) {
          rows.push([
            // The file name and line here; the whole path is in the sentence beside it.
            `<code>${t(`${basename(p.call.at.file)}:${p.call.at.line}`)}</code>`,
            `<code>${t(p.outer)}</code> runs ${p.call.tool === undefined ? 'a tool chosen at run time' : `<code>${t(p.call.tool)}</code>`}<small>${t(bypassSentence(code, p))}</small>`,
            t(bypassFix(code, p)),
          ]);
        }
        const listed = code.verdicts.filter((v) => outside.names.includes(v.tool.name));
        for (const v of listed) {
          rows.push([
            `<code>${t(`${basename((v.tool.execute_at ?? v.tool.defined_at).file)}:${(v.tool.execute_at ?? v.tool.defined_at).line}`)}</code>`,
            `<code>${t(v.tool.name)}</code> does not pass the door<small>${t(where(v.tool.execute_at ?? v.tool.defined_at))}</small>`,
            `Add the same call at the top of ${t(v.tool.name)}.`,
          ]);
        }
        const unlisted = outside.count - listed.length;
        const lead =
          (paths.length === 0
            ? ''
            : t(`${plural(paths.length, 'place')} where a tool runs another tool without passing ${d.name}. One ZIFFER call at ${d.name} would decide the outer tool and would not see the inner one. `)) +
          (outside.count === 0
            ? ''
            : t(`Add the same call at the top of the ${outside.count === 1 ? 'tool' : `${outside.count} tools`} that ${outside.count === 1 ? 'does' : 'do'} not go through ${d.name}${unlisted > 0 ? `, ${unlisted} of which the scan did not list by name` : ''}.`));
        const raised = raisedSentence(code);
        step(
          `Cover the ${places === 1 ? 'place' : `${places} places`} the door does not see`,
          `<p>${lead}</p>`,
          { card: `${rtable('cover', ['Where', 'What runs there', 'Do'], rows, undefined, e(BYPASS_TITLE))}${raised === undefined ? '' : `<p class="say">${t(raised)}</p>`}` },
          'bypass',
        );
      } else if (!checkRan(code, 'tool_calls') && d !== null) {
        notLooked = `<p class="say" id="bypass">Tools that run another tool without passing ${t(d.name)}: not looked for in this scan.</p>`;
      }
    }
    step('Name your approvers and the person told first', '<p>The draft names stand-ins only: see the placeholders under the policy.</p>', {
      action: `<a class="textbtn" href="#${PLACEHOLDERS_ID}">See the placeholders</a>`,
    });
    step(
      'Review and sign the draft policy',
      `<p>The scan wrote it beside this report. Attach <code>${ARCHIVE_FILE}</code> to the email from the review page.</p>`,
      { action: `<a class="cta" href="${REVIEW_URL}" rel="noopener noreferrer">${e(CTA_TEXT)} &#8594;</a>` },
    );
    const after =
      '<div class="after"><h3>What happens after you paste it</h3>' +
      `<ol>${AFTER_PASTE.map((x) => `<li>${e(x)}</li>`).join('')}</ol>` +
      `<p class="say">How the call is built and what a refusal means: <a href="${DOC.sdkShape}" rel="noopener noreferrer">the SDK guide</a>; ` +
      `every refusal by name: <a href="${DOC.refusals}" rel="noopener noreferrer">refusals</a>; ` +
      `a first call end to end: <a href="${DOC.quickstart}" rel="noopener noreferrer">quickstart</a>.</p></div>`;
    const lede =
      d === null
        ? 'One call at the top of each tool, and one module beside them.'
        : `One call at the door, one module beside it${outsideDispatcher(code).count + bypassPaths(code).length > 0 ? ', and one call for each place the door does not see' : ''}.`;
    return {
      id: 'insertion',
      title: d === null ? 'Put ZIFFER in each tool' : 'Put ZIFFER in place',
      lede: e(lede),
      body: `<p class="intro lead">${t(ins.sentence)}</p><ol class="steps">${steps.join('')}</ol>${notLooked}${after}`,
    };
  }

  // ------------------------------------------------------------ 04 the draft policy, as a checklist

  policy(tail = ''): Sec {
    const code = this.code;
    const L = this.link;
    const rules = codeRules(code, this.input.policy, sortedVerdicts(code));
    const confirmations = rules.filter((r) => confirmKind(r) !== undefined).length;
    const c = code.counts;
    const body: string[] = [];
    const n = notifiedCount(code);
    if (c.irreversible > 0) {
      // Known and assumed said apart: the engine treats both as impossible to undo, but only the
      // first is a reading of the tool's own name or description (and a reading to confirm).
      const unlisted = code.verdicts.filter((v) => isUnlistedVerdict(v)).length;
      const runs = code.verdicts.filter((v) => irreversibleBasis(v) === 'runs_another').length;
      const access = code.verdicts.filter((v) => irreversibleBasis(v) === 'access_value').length;
      const known = Math.max(0, c.irreversible - unlisted - runs - access);
      const stubsIrreversible = code.verdicts.filter((v) => isStub(v) && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE').length;
      body.push(
        `<div class="box-note${n > 0 ? ' no' : ''} gap"><p>The ${L('engine')} treats <b>${c.irreversible}</b> tools as ${L('reversibility', 'impossible to undo')}: ` +
          `${known} because their name or description says so (confirm each reading)` +
          `${runs > 0 ? `, ${runs} because ${runs === 1 ? 'it runs' : 'they run'} another tool` : ''}` +
          `${access > 0 ? `, ${access} because ${access === 1 ? 'it writes' : 'they write'} an access value` : ''}` +
          `${unlisted > 0 ? `, ${unlisted} because nothing says they can be undone` : ''}` +
          `${stubsIrreversible > 0 ? ` (these counts include ${plural(stubsIrreversible, 'tool')} whose description says ${stubsIrreversible === 1 ? 'it is a stub' : 'they are stubs'}, which the grade leaves out)` : ''}` +
          `. With this draft, <b>${c.held}</b> wait for a person` +
          `${n > 0 ? ` and <b>${n}</b> run after a notice under the draft policy, with no approval: confirming their rules is what closes that gap` : ''}.</p></div>`,
      );
    }
    const held = rules.filter((r) => r.group === 'held');
    const reply = heldReplyWarning(held.map((r) => r.verdict));
    if (reply !== undefined) body.push(`<p class="reply-warn box-note no">${this.t(reply)}</p>`);
    if (held.length > 0) body.push(`<p class="enrol say">${this.t(enrolNote(code))}</p>`);
    const row = (r: CodeRule): RuleRow => {
      const raised = raisedCell(r.verdict);
      const cannot = cannotUndoReason(r.verdict);
      const undo = undoEvidence(r.verdict);
      return {
        tool: r.verdict.tool.name,
        rule: r,
        kind: confirmKind(r),
        reason: r.verdict.draft_reason,
        group: r.group,
        stub: isStub(r.verdict),
        ...(raised === undefined ? {} : { raised }),
        ...(cannot === undefined ? {} : { cannot }),
        ...(undo.length === 0 ? {} : { undo }),
      };
    };
    for (const kind of ASK_ORDER) {
      const list = rules.filter((r) => confirmKind(r) === kind);
      if (list.length === 0) continue;
      body.push(
        `<div class="q ask-${kind}" id="ask-${kind}">` +
          `<div class="q-h"><h3 class="ask-q">${e(ASK_QUESTION[kind])}</h3><span class="c count" data-count="${list.length}">${plural(list.length, 'row')}</span></div>` +
          `<p class="q-note">${confirmNote(kind).replace(/^./, (x) => x.toUpperCase())}</p>` +
          this.ruleRows(list.map(row), `m-ask-${kind}`, ASK_QUESTION[kind]) +
          '</div>',
      );
    }
    const settled = rules.filter((r) => confirmKind(r) === undefined);
    if (settled.length > 0) {
      body.push(
        `<details class="inner ask-none" id="ask-none"><summary><span class="ask-q">${e(ASK_NONE)}</span> <span class="count" data-count="${settled.length}">${plural(settled.length, 'row')}</span></summary>` +
          `<div class="card">${this.ruleTable(settled.map(row))}</div>` +
          '</details>',
      );
    }
    body.push(membersNote());
    body.push(this.undoTable(rules));
    if (this.input.catalog.length > 0) body.push(this.mcpPolicy());
    if (tail !== '') body.push(tail);
    // Said once, in the heading column, when a row shows what its source says about undoing it.
    const conservative = rules.some((r) => undoEvidence(r.verdict).length > 0) ? ` <span class="undo-conservative">${e(UNDO_CONSERVATIVE)}</span>` : '';
    const lede =
      `${confirmations === 0 ? 'No row asks a decision.' : `<b>${confirmations}</b> ${confirmations === 1 ? 'row' : 'rows'} to confirm, grouped by the question asked.`} ` +
      `The scan wrote a ${L('draft', 'draft policy')}: one rule per tool.${conservative}`;
    return { id: 'policy', title: 'The draft policy, as a checklist', lede, body: body.join('\n') };
  }

  /** A group's rows: the first `CHECKLIST_ROWS_SHOWN` in view; "+ N more in this group" opens the whole group, every row, in a dialog. */
  private ruleRows(rows: readonly RuleRow[], id: string, title: string): string {
    const shown = rows.slice(0, CHECKLIST_ROWS_SHOWN);
    const rest = rows.length - shown.length;
    if (rest === 0) return `<div class="card">${this.ruleTable(shown)}</div>`;
    return (
      `<div class="card">${this.ruleTable(shown)}<button class="morebtn" type="button" data-open="${id}">+ ${rest} more in this group</button></div>` +
      dialogHtml(id, e(title), plural(rows.length, 'row'), `<div class="rows-all">${this.ruleTable(rows)}</div>`)
    );
  }

  /** Who a held tool waits for under the draft: the quorum and the approvers, "not named yet" while they are the draft's stand-ins. */
  private approversCell(): string {
    const reg = this.input.policy.find((f) => f.path === 'attesters/registry.json');
    let k = 0;
    let names: string[] = [];
    if (reg !== undefined) {
      const doc: unknown = JSON.parse(reg.text);
      if (typeof doc === 'object' && doc !== null) {
        const q: unknown = Reflect.get(doc, 'quorum_k');
        const a: unknown = Reflect.get(doc, 'attesters');
        k = typeof q === 'number' ? q : 0;
        names = typeof a === 'object' && a !== null ? Object.keys(a) : [];
      }
    }
    if (names.length === 0) return '<span class="warn">nobody named</span>';
    const standIns = names.every((n) => STAND_IN_APPROVER.test(n));
    return `${k} of ${plural(names.length, 'approver')}${standIns ? `, <span class="warn">${e(TOLD_PLACEHOLDER)}</span>` : `: ${names.map((n) => this.t(n)).join(', ')}`}`;
  }

  /**
   * "Proposed undo entries": the tools whose own words or tool list say they can be undone or only
   * read, the evidence in the source's words, what the draft does now, and the exact entry to add
   * if a person confirms; then what the grade becomes if every one is confirmed, computed. Empty
   * when no tool carries such a hint.
   */
  private undoTable(rules: readonly CodeRule[]): string {
    const t = (s: string): string => this.t(s);
    const rows = undoRows(rules);
    if (rows.length === 0) return '';
    const byTool = new Map(rules.map((r) => [r.verdict.tool.name, r]));
    const head = ['Tool', 'What the source says', 'What the draft does now', 'Entry to add if a person confirms'];
    const body = rows.map((row) => {
      const rule = byTool.get(row.tool);
      const entry =
        row.entry === undefined
          ? `<span class="${row.ambiguous ? 'warn' : 'muted'}">${t(row.none ?? '')}</span>`
          : `${rule === undefined ? 'add' : t(entryVerb(rule))} <code>${t(row.entry)}</code>`;
      const cells = [`<b class="m">${t(row.tool)}</b>`, `<span class="ev">${row.evidence.map((x) => t(x)).join('<br>')}</span>`, t(row.draft), entry];
      return `<tr class="undo${row.ambiguous ? ' undo-ambiguous' : ''}" data-tool="${t(row.tool)}">${cells.map((c, i) => `<td${dataL(head[i], i)}>${c}</td>`).join('')}</tr>`;
    });
    const out: string[] = [`<div class="undo-box" id="undo"><h3>${e(UNDO_TITLE)}</h3>`, `<p class="say">${e(UNDO_NEVER_ON_OWN_WORD)} The entries go in ${memberLink('reversibility.json')}.</p>`];
    out.push(`<div class="card"><table class="r undotable"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`);
    const now = exposureGrade(this.code);
    const after = gradeIfReversible(this.code, proposedTools(rows));
    if (now !== undefined && after !== undefined) {
      const was = gradeLabel(now);
      const becomes = gradeLabel(after.grade);
      out.push(
        `<p class="undo-grade">${t(
          after.moved === 0
            ? `Confirming these entries would not move the grade, ${was}: none of them is a tool the grade counts.`
            : `If a person confirms every entry proposed here, ${plural(after.moved, 'tool')} ${after.moved === 1 ? 'leaves' : 'leave'} the grade's count and the grade becomes ${becomes}` +
                // One grade, today's (ACP-464 item 8); the one within reach is said as such, never as a "best case".
                `${becomes === was ? ', as it is now' : `, from ${was} today`}${gradeNow(after.grade).reachable === undefined ? '' : `; if the rest can be undone too, it is ${gradeNow(after.grade).reachable ?? ''}`}.`,
        )}</p>`,
      );
    }
    out.push('</div>');
    return out.join('\n');
  }

  /**
   * One checklist row per tool: a box to tick, the tool, the decision asked with the evidence in
   * the source's words, then the draft's four values in reader words. The member files the values
   * are read from are named once, under the checklist (`membersNote`).
   */
  private ruleTable(rows: readonly RuleRow[], withHead = true): string {
    // A held tool waits for its approvers; any other is told after it runs. The two are never one
    // column: rows of both kinds are two tables, the held first, each with its own column name.
    const held = rows.filter((r) => r.group === 'held');
    const other = rows.filter((r) => r.group !== 'held');
    if (held.length > 0 && other.length > 0) return this.ruleTable(held, withHead) + this.ruleTable(other, withHead);
    const approves = held.length > 0;
    const who = approves ? 'Who approves' : 'Who is notified';
    const t = (s: string): string => this.t(s);
    const head = ['', 'Tool', 'To confirm', 'Can it be undone?', 'Risk', 'Tier', who];
    const L = this.link;
    const shownHead = ['<span class="sr">Done</span>', 'Tool', 'To confirm', L('reversibility', 'Can it be undone?'), L('risk', 'Risk'), L('tier', 'Tier'), who];
    const approvers = approves ? this.approversCell() : '';
    const body = rows.map(({ tool, rule: r, kind, reason, group, stub, raised, cannot, undo: saysUndo }) => {
      const undo =
        (r.reversibility === undefined ? '<span class="warn">no entry</span> <span class="muted">(read as no)</span>' : r.reversibility === 'IRREVERSIBLE' ? '<span class="irrev">no</span>' : 'yes') +
        // A tool's own words that it cannot be undone made the draft stricter: the reason is shown where it did.
        (cannot === undefined ? '' : `<small>${t(cannot)}</small>`);
      const risk = r.risk === undefined ? '<span class="warn">none</span>' : t(riskWords(r.risk));
      const tier = r.floor === undefined ? '<span class="muted">not listed: T3</span>' : t(r.floor);
      // The draft addresses every notice to the stand-in id "developer" (bundle/generate.ts): the cell says nobody is named yet.
      const told = approves
        ? approvers
        : r.notice === undefined
          ? '<span class="muted">nobody</span>'
          : r.notice.map((x) => (x === DEVELOPER ? `<span class="warn">${t(TOLD_PLACEHOLDER)}</span>` : t(x))).join(', ');
      // The raise is said once, by its own line: the draft's reason carries the same words, so they are dropped from it.
      const shown = reason === undefined ? undefined : reason.split('; ').filter((seg) => seg !== raised).join('; ');
      const reading = kind === 'reason' && (shown === undefined || shown === '') ? undefined : kind;
      const lines = [
        ...(reading === undefined ? [] : [`<span class="ck">${e(CONFIRM_CELL[reading])}</span>${reading === 'reason' && shown !== undefined ? `<br><span class="ev">${t(shown)}</span>` : ''}`]),
        // Graded as strictly as a tool it runs unseen: said in the row, the insertion steps say why.
        ...(raised === undefined ? [] : [`<span class="ck raised"><a href="#bypass">${t(raised)}</a></span>`]),
        // What the source says about undoing it, in its own words: evidence for the person, never read by the draft.
        ...(saysUndo === undefined ? [] : [`<span class="ev undo-says">${saysUndo.map((x) => t(x)).join('; ')}</span>`]),
      ];
      const toolCell =
        `<b class="m tn">${t(tool)}</b>` +
        `${group === undefined ? '' : `<small class="grp">${L(GROUP_TERM[group], GROUP_WORDS[group])}</small>`}` +
        `${stub === true ? `<small class="stub">${e(STUB_LABEL)}</small>` : ''}`;
      const cells = ['<span class="box" aria-hidden="true"></span>', toolCell, lines.join('<br>'), undo, risk, tier, told];
      return `<tr class="rule" data-tool="${t(tool)}">${cells.map((cell, i) => `<td${dataL(head[i], i)}>${cell}</td>`).join('')}</tr>`;
    });
    return `<table class="r chk ruletable">${withHead ? `<thead><tr>${shownHead.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.join('')}</tbody></table>`;
  }

  /** The installed tools' half of the draft: the same values, by server, no verdict (the engine grades them when they are called). */
  private mcpPolicy(): string {
    const t = (s: string): string => this.t(s);
    const rules = mcpRules(this.input.catalog, this.input.policy);
    const servers = [...new Set(rules.map((r) => r.server))];
    const out: string[] = ['<h3 id="policy-installed">Tools installed in your AI assistants</h3>'];
    out.push(
      `<p>The same draft covers ${t(plural(rules.length, 'installed tool'))} on ${t(plural(servers.length, 'server'))}. The engine decides each when your AI assistant calls it through ZIFFER; these are the rules it will read.</p>`,
    );
    const unknown = this.input.unknown ?? new Set<string>();
    const kinds = rules.map((r) => mcpConfirmKind(r, unknown));
    out.push(this.confirmNotes(kinds));
    for (const s of servers) {
      const list = rules.filter((r) => r.server === s);
      const noRule = list.filter((r) => r.risk === undefined).length;
      out.push(
        `<details class="inner rules-mcp"><summary><code>${t(s)}</code> <span class="count">${plural(list.length, 'tool')}</span>${noRule > 0 ? ` <span class="tag no">${noRule} without a rule</span>` : ''}</summary>` +
          `<div class="card">${this.ruleTable(list.map((r: McpRule): RuleRow => ({ tool: r.tool, rule: r, kind: mcpConfirmKind(r, unknown), reason: undefined })))}</div>` +
          '</details>',
      );
    }
    return out.join('\n');
  }

  /** What to confirm in a group, each kind said once with how many rules it marks. */
  private confirmNotes(kinds: readonly (ConfirmKind | undefined)[]): string {
    const counts = new Map<ConfirmKind, number>();
    for (const k of kinds) if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
    if (counts.size === 0) return '';
    const items = [...counts.entries()].map(([k, n]) => `<li><b>${n}</b> · <span class="ck">${e(CONFIRM_CELL[k])}</span>: ${confirmNote(k)}</li>`);
    return `<ul class="notes confirm-notes">${items.join('')}</ul>`;
  }

  // ------------------------------------------------------------ 05 data that could leave

  leak(): Sec | undefined {
    const code = this.code;
    const t = (s: string): string => this.t(s);
    const leak = codeLeak(code);
    const pairs = pairRows(code);
    if (leak === undefined && pairs.length === 0) return undefined;
    const place = (name: string): string => {
      const v = code.verdicts.find((x) => x.tool.name === name);
      return `<b class="m tn">${t(name)}</b>${v === undefined ? '' : `<small>${t(where(v.tool.defined_at))}</small>`}`;
    };
    const body: string[] = [];
    if (leak !== undefined) {
      body.push(`<p>${t(leak.text)}</p>`);
      const more = leak.senderCount - leak.senders.length;
      const sends = `${leak.senders.map((x) => `<b class="m tn">${t(x)}</b>`).join(', ')}${more > 0 ? `<small>+ ${plural(more, 'more tool')} that send data out</small>` : ''}`;
      body.push(
        rtable(
          'leaktable',
          ['Reads', 'Sends', 'Both on one path?'],
          leak.readers.map((r) => [`${place(r.tool)}<small>returns ${t(r.word)}</small>`, sends, bothOnOnePath(code, r.tool, leak.senders)]),
        ),
      );
    }
    if (pairs.length > 0) {
      const shown = pairs.slice(0, PAIRS_SHOWN);
      const more = pairs.length - shown.length;
      body.push(
        `<h3 id="pairs">Pairs of your tools: one reads, the other sends data out (${pairs.length})</h3>`,
        `<p>${e(PAIRS_CONDITION)} The pairs whose sender the engine holds for a person are listed first.</p>`,
        this.pairList(shown),
        ...(more > 0 ? [`<p class="say">And ${more} more: <a href="#pairs-all">every pair is in the appendix</a>.</p>`] : []),
      );
    }
    body.push('<p class="say">A pair the draft reads from the tools’ names, parameters and descriptions; whether one model is given both is decided where your code builds its tool list.</p>');
    return { id: 'leak', title: 'Data that could leave', lede: 'What a manipulated model could send out of your application, read from your tools’ own names and parameters.', body: body.join('\n') };
  }

  private pairList(rows: readonly PairRow[]): string {
    const t = (s: string): string => this.t(s);
    return rtable(
      'pairs',
      ['Reads', 'Sends data out', 'Why the pair'],
      rows.map((r) => [
        `<span data-pair="${t(r.pair.id)}"><b class="m">${t(r.pair.reader)}</b></span><small>reads ${t(r.what)}; its ${t(r.pair.basis)}</small>`,
        `<b class="m">${t(r.pair.sender)}</b>`,
        `${t(r.pair.why)}${r.path === undefined ? '' : `<small>${t(r.path)}</small>`}`,
      ]),
    );
  }

  // ------------------------------------------------------------ 06 instructions inside tool descriptions

  instructions(): Sec | undefined {
    const t = (s: string): string => this.t(s);
    const all = toolInstructions(this.code);
    if (all.length === 0) return undefined;
    const high = all.filter((x) => x.hit.severity === 'high');
    const rest = all.length - high.length;
    const body: string[] = [];
    if (high.length > 0) {
      body.push(
        '<div class="card"><ul class="plain instr">' +
          high
            .map((x) => `<li data-pattern="${t(x.hit.pattern)}"><span class="tag no">HIGH</span> ${t(toolInstructionSentence(x))} <code>${t(x.at)}</code><br><span class="excerpt">“${t(x.hit.excerpt)}”</span></li>`)
            .join('') +
          '</ul></div>',
      );
    }
    if (rest > 0) body.push(`<p class="say">${rest === 1 ? 'One lower-severity pattern is' : `${rest} lower-severity patterns are`} listed in the tool’s row of the appendix.</p>`);
    body.push('<p class="say">Read by the same patterns as the installed tools’ descriptions. The place is where the tool is defined; the excerpt is the matched text with what surrounds it.</p>');
    const lede =
      high.length === 0
        ? 'No description carries text of high severity; the lower-severity matches are in the appendix.'
        : `${high.length === 1 ? 'One of your descriptions speaks' : `${high.length} of your descriptions speak`} to the model rather than describing the tool. A model reads a description as part of its instructions.`;
    return { id: 'instructions', title: 'Instructions inside tool descriptions', lede: e(lede), body: body.join('\n') };
  }

  // ------------------------------------------------------------ 07 skills and instruction files

  skills(): Sec | undefined {
    const skills = this.input.skills;
    if (skills === undefined) return undefined;
    if (skills.length === 0) return { id: 'skills', title: SKILLS_TITLE, lede: '', body: `<p>${e(SKILLS_NONE)} ${e(APP_SKILLS_NOT_COVERED)}</p>` };
    const high = skills.filter(hasHigh).length;
    const tagHigh = `<span class="tag ${high > 0 ? 'no' : 'held'} count" data-count="${high}">${high} high</span>`;
    const say = `<p class="say">${e(SKILL_HITS_READ)} What it can do is read from its code blocks, its inline commands and the scripts in its folder, never from its prose.</p>`;
    if (!skillsGrouped(skills)) {
      // A result made before ACP-460 says nothing of who loads a file: one list, as it was.
      const nSkills = skills.filter((x) => x.kind === 'skill').length;
      const nFiles = skills.length - nSkills;
      const read = [...(nSkills > 0 ? [plural(nSkills, 'skill')] : []), ...(nFiles > 0 ? [plural(nFiles, 'instruction file')] : [])].join(' and ');
      const body = [
        `<div class="okline">${tagHigh}<span><b>${e(read)}</b> ${skills.length === 1 ? 'was' : 'were'} read.</span></div>`,
        this.skillFold('m-skills', SKILLS_TITLE, ASSISTANT_HEAD, highFirst(skills), SKILLS_SHOWN, (s) => this.assistantRow(s)),
        say,
      ];
      return { id: 'skills', title: SKILLS_TITLE, lede: e(SKILLS_LEAD), body: body.join('\n') };
    }
    const app = applicationSkills(skills);
    const asst = assistantSkills(skills);
    const group = (id: string, title: string, lead: string, sentence: string, fold: string): string =>
      `<div class="skgroup" id="${id}"><h3>${e(title)}. <span>${e(lead)}</span></h3><p class="say">${e(sentence)}</p>${fold}</div>`;
    const body = [
      `<div class="okline">${tagHigh}<span>${e(skillsCountSentence(skills))}</span></div>`,
      ...(app.length === 0
        ? []
        : [group('skills-app', APP_SKILLS_TITLE, APP_SKILLS_LEAD, APP_SKILLS_SAY, this.skillFold('m-skills-app', APP_SKILLS_TITLE, APP_HEAD, appOrder(app), APP_SKILLS_SHOWN, (s) => this.appRow(s), { cls: 'app', quiet: true }))]),
      ...(asst.length === 0
        ? []
        : [group('skills-assistant', ASSISTANT_SKILLS_TITLE, ASSISTANT_SKILLS_LEAD, ASSISTANT_SKILLS_SAY, this.skillFold('m-skills-assistant', ASSISTANT_SKILLS_TITLE, ASSISTANT_HEAD, highFirst(asst), ASSISTANT_SKILLS_SHOWN, (s) => this.assistantRow(s), { quiet: true }))]),
      say,
    ];
    return { id: 'skills', title: SKILLS_TITLE, lede: e(SKILLS_LEAD_GROUPED), body: body.join('\n') };
  }

  /**
   * A group's table in its card: the first `shown` rows, then "+ N more" opening the whole table in a
   * dialog (shown in place with no script and in print). With `quiet`, "What it can do" and
   * "Instruction hits" are left out when every row of the GROUP holds its empty value, and one
   * sentence under the table says it for all of them; the dialog's table follows the same rule, so
   * the two never disagree. A result made before ACP-460 keeps every column.
   */
  private skillFold(
    dialogId: string,
    title: string,
    head: readonly SkillColumn[],
    list: readonly SkillRead[],
    shown: number,
    cellsOf: (s: SkillRead) => string[],
    opts: { cls?: string; quiet?: boolean } = {},
  ): string {
    const quiet = opts.quiet === true;
    const noCan = quiet && list.every((s) => capabilityText(s) === '');
    const noHits = quiet && list.every((s) => s.instruction_hits.length === 0);
    const keep = head.map((h) => !((h.id === 'can' && noCan) || (h.id === 'hits' && noHits)));
    const cls = `r skills${opts.cls === undefined ? '' : ` ${opts.cls}`}${keep.every((k) => k) ? '' : ' slim'}`;
    const row = (x: SkillRead): string => `<tr>${cellsOf(x).map((c, i) => (keep[i] === true ? `<td${dataL(head[i]?.label, i)}>${c}</td>` : '')).join('')}</tr>`;
    const table = (rows: readonly SkillRead[]): string =>
      `<table class="${cls}"><thead><tr>${head.map((h, i) => (keep[i] === true ? `<th scope="col"${quiet ? ` class="c-${h.id}"` : ''}>${h.label}</th>` : '')).join('')}</tr></thead><tbody>${rows.map(row).join('\n')}</tbody></table>`;
    const noun = list.every((x) => x.kind === 'skill') ? 'skills' : 'files';
    const said = emptyColumnsSentence(noun, noCan, noHits);
    const note = said === undefined ? '' : `<p class="say empty-cols">${e(said)}</p>`;
    const rest = list.length - shown;
    if (rest <= 0) return `<div class="card">${table(list)}</div>${note}`;
    return (
      `<div class="card">${table(list.slice(0, shown))}<button class="morebtn" type="button" data-open="${dialogId}">+ ${rest} more</button></div>` +
      dialogHtml(dialogId, e(title), plural(list.length, 'file'), `${table(list)}${note}`) +
      note
    );
  }

  /** The two cells every row ends with: what the text can do, with where; the instruction hits. */
  private skillTail(s: SkillRead): string[] {
    const t = (x: string): string => this.t(x);
    const can = capabilityText(s);
    const hits = s.instruction_hits;
    const high = hits.filter((h) => h.severity === 'high');
    const hitCell =
      hits.length === 0
        ? '<span class="muted">none</span>'
        : [
            ...high.map((h) => `<span class="tag no">HIGH</span> ${t(skillInstructionSentence(s, h))}<br><span class="excerpt">“${t(h.excerpt)}”</span>`),
            ...(hits.length > high.length ? [`<span class="muted">${hits.length - high.length} of lower severity (${t([...new Set(hits.filter((h) => h.severity !== 'high').map((h) => h.pattern))].join(', '))})</span>`] : []),
          ].join('<br>');
    const evidence =
      s.exercises.length === 0
        ? ''
        : `<details class="inner"><summary>Where</summary><ul class="plain evidence">${s.exercises.map((x) => `<li>${t(x.capability.replace('_', ' '))}: <code>${t(`${x.file}:${x.line}`)}</code> <code>${t(x.evidence)}</code></li>`).join('')}</ul></details>`;
    return [`${can === '' ? '<span class="muted">nothing the scan looks for</span>' : t(can)}${evidence}`, hitCell];
  }

  /** A coding assistant's file, or any file of a result made before ACP-460: today's columns. */
  private assistantRow(s: SkillRead): string[] {
    const t = (x: string): string => this.t(x);
    const declares = s.declares === undefined ? `<span class="muted">${e(DECLARES_NOTHING)}</span>` : s.declares.map((d) => `<code>${t(d)}</code>`).join(', ');
    return [`<code>${t(s.path)}</code><small>${s.kind === 'skill' ? 'skill' : 'instruction file'} · ${t(s.name)}</small>`, declares, ...this.skillTail(s)];
  }

  /** A skill the application gives its model: its name and path, how it was found, the tools it names against the code, then the common tail. */
  private appRow(s: SkillRead): string[] {
    const t = (x: string): string => this.t(x);
    const said = skillLoadLines(s.loaded_by ?? [], {
      place: (p) => `<code title="${e(`${p.file}:${p.line}`)}">${t(`${basename(p.file)}:${p.line}`)}</code>`,
      code: (x) => `<code>${t(x)}</code>`,
      text: e,
    });
    const found = [...said.lines.map((l) => `<span class="load">${l}</span>`), ...said.muted.map((l) => `<span class="load muted">${l}</span>`)].join('');
    const declared = s.declared_tools;
    let tools: string;
    if (declared === undefined || declared.length === 0) {
      tools = s.declares === undefined ? `<span class="muted">${e(DECLARES_NOTHING)}</span>` : s.declares.map((d) => `<code>${t(d)}</code>`).join(', ');
    } else {
      const held = declared.filter((d) => d.in_code && d.held === true);
      const other = declared.filter((d) => d.in_code && d.held !== true);
      const absent = declared.filter((d) => !d.in_code);
      tools = [
        ...(held.length === 0 ? [] : [`<small class="n">${held.length} held for a person</small><span class="pills">${held.map((d) => `<span class="tag act">${t(d.name)}</span>`).join('')}</span>`]),
        ...(other.length === 0 ? [] : [`<span class="names">${other.map((d) => `<code>${t(d.name)}</code>`).join(', ')}</span>`]),
        ...(absent.length === 0 ? [] : [`<small class="absent">${e(NAMED_NOT_IN_CODE)} ${absent.map((d) => `<code>${t(d.name)}</code>`).join(', ')}</small>`]),
      ].join('');
    }
    return [`<b>${t(s.name)}</b><small><code>${t(s.path)}</code></small>`, found, tools, ...this.skillTail(s)];
  }

  // ------------------------------------------------------------ 08 threats and frameworks

  threats(heat: readonly HeatCell[]): Sec | undefined {
    const t = (s: string): string => this.t(s);
    const cells = heat.filter((h) => withZiffer(h.id) !== undefined);
    if (cells.length === 0) return undefined;
    const measured = (h: HeatCell): string => {
      const said = h.count === undefined ? 'not measured by this scan' : h.count === 0 ? 'none found' : `${h.count} ${h.count === 1 ? 'tool' : 'tools'}`;
      const tools =
        h.tools.length === 0
          ? ''
          : h.tools.length <= 6
            ? `<small>${h.tools.map((x) => t(x)).join(', ')}</small>`
            : `<details class="inner"><summary>the ${h.tools.length} tools</summary><small>${h.tools.map((x) => t(x)).join(', ')}</small></details>`;
      return `<b>${e(said)}</b><small>${t(h.evidence)}</small>${tools}`;
    };
    const rows = cells.map((h) => [`<b>${e(shownName(h))}</b><small>${e(h.framework)} ${e(shownId(h))}</small>`, measured(h), e(withZiffer(h.id) ?? '')]);
    return {
      id: 'atlas',
      title: 'Threats and frameworks',
      lede: 'What the scan measured for each, and what ZIFFER does about it. The MITRE ATLAS techniques and the OWASP entry about a model that calls tools.',
      body:
        rtable('atlas', ['Technique', 'Measured in your code', 'With ZIFFER'], rows) +
        '<p class="say">Only the techniques about a model that calls tools are shown; the rest of the matrix is not about this scan.</p>' +
        (cells.some((h) => h.framework === OWASP_FRAMEWORK) ? `<p class="say">${e(owaspNote())}</p>` : ''),
    };
  }

  // ------------------------------------------------------------ 09 why it matters

  matters(rows: readonly MattersRow[]): Sec | undefined {
    if (rows.length === 0) return undefined;
    const table = rtable(
      'matters',
      ['Rule', 'What it asks', 'ZIFFER'],
      rows.map((m) => [`<b>${e(m.framework)}</b><small>${e(m.clause)}</small>`, e(m.asks), `<span class="tag held">${e(m.status_words)}</span>`]),
    );
    return {
      id: 'matters',
      title: 'Why it matters',
      // Its opening sentence is the grey half of the heading; what the rows are, the lead under it.
      lede: `${e(MATTERS_INTRO)} The regulation articles this scan’s findings touch, and how far ZIFFER answers each.`,
      body: `${table}<p class="say">Each status is the one ZIFFER’s own control mapping gives its answer to that article, word for word.</p>`,
    };
  }

  // ------------------------------------------------------------ the appendix

  /** The appendix, folded: every tool with its full description and definition, then every pair when the section showed only some. */
  appendix(): string {
    const pairs = pairRows(this.code);
    const code = this.code;
    const verdicts = sortedVerdicts(code);
    const listed = verdicts.length >= code.counts.tools ? `all ${verdicts.length} tools` : `${verdicts.length} of the ${code.counts.tools} tools`;
    const out = [
      `<button class="appx" type="button" id="appendix" data-open="m-appendix">Appendix: ${listed} with their definitions <span>Open</span></button>`,
      dialogHtml('m-appendix', `Appendix: ${listed}`, 'with their definitions', `<div id="tools">${this.toolsTable()}</div>`),
    ];
    if (pairs.length > PAIRS_SHOWN) {
      out.push(
        `<button class="appx" type="button" id="pairs-all" data-open="m-pairs-all">All ${pairs.length} pairs where one tool reads and the other sends data out <span>Open</span></button>`,
        dialogHtml('m-pairs-all', `All ${pairs.length} pairs`, 'one tool reads, the other sends data out', `<p>${e(PAIRS_CONDITION)}</p>${this.pairList(pairs)}`),
      );
    }
    return out.join('\n');
  }

  /** "How to read this report": every term the page uses, plain line first, then its link. Folded at the end. */
  legend(): string {
    const dl = TERMS.map(
      (x) =>
        `<div class="term-row" id="term-${x.id}"><dt>${e(x.word)}${x.spec === undefined ? '' : ` <span class="spec">${e(x.spec)}</span>`}</dt>` +
        `<dd>${e(x.plain)} <a href="${x.href}" rel="noopener noreferrer">Read more</a></dd></div>`,
    ).join('');
    const small = (caption: string, rows: readonly [string, string][]): string =>
      `<table class="mini"><caption>${caption}</caption><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${e(v)}</td></tr>`).join('')}</tbody></table>`;
    return (
      '<details class="app howto" id="legend">' +
      '<summary><span id="how-to-read">How to read this report: the words it uses</span> <span class="o">Open</span><span class="c">Close</span></summary><div class="in">' +
      `<p>Each word below is the one this page uses; the link goes to the ZIFFER documentation, the <a href="${DOC.glossary}" rel="noopener noreferrer">glossary</a> has the rest.</p>` +
      `<dl class="terms">${dl}</dl>` +
      '<div class="minis">' +
      small(`Risk: what each level means for a tool (<a href="${DOC.risk}" rel="noopener noreferrer">risk functions</a>)`, RISK_LEGEND) +
      small(`Tier: how sensitive the system is (<a href="${DOC.floors}" rel="noopener noreferrer">floors</a>)`, TIER_LEGEND) +
      '</div></div>' +
      '</details>'
    );
  }

  /** Every tool, in the four groups, each group's shared sentence said once in its label row. */
  toolsTable(): string {
    const code = this.code;
    const t = (s: string): string => this.t(s);
    const verdicts = sortedVerdicts(code);
    if (verdicts.length === 0) return '<p class="muted">The scan found no tool this application defines for a model.</p>';
    const byGroup = new Map<VerdictGroup, CodeToolVerdict[]>();
    for (const v of verdicts) byGroup.set(groupOf(v), [...(byGroup.get(groupOf(v)) ?? []), v]);
    const vias = new Set(verdicts.map((v) => v.tool.via));
    const out: string[] = ['<p>Grouped by what ZIFFER would do under the draft policy.</p>'];
    if (vias.size === 1) out.push(`<p>Every tool below is defined through <code>${t([...vias][0] ?? '')}</code>.</p>`);
    const reply = heldReplyWarning(byGroup.get('held') ?? []);
    if (reply !== undefined) out.push(`<p class="reply-warn box-note no">${t(reply)}</p>`);
    const head = ['Tool and where it is defined', 'What ZIFFER would do under the draft', 'Why the draft says so'];
    const body: string[] = [];
    for (const g of GROUPS) {
      const rows = byGroup.get(g);
      if (rows === undefined) continue;
      const words = groupWords(rows);
      const notes = (words?.notes ?? []).map((n) => `<br><span class="gnote">${t(plainNote(n.sentence, n.tools))}</span>`).join('');
      body.push(
        `<tr class="group group-${g}" id="tools-${g}"><td colspan="${head.length}"><b>${e(GROUP_LABEL[g])} (${rows.length})</b>` +
          `${words === undefined ? '' : `<br><span class="glead">${t(plainLead(words.lead))}</span>`}${notes}</td></tr>`,
      );
      for (const v of rows) {
        const r = v.verdict;
        const engine =
          r.verdict === 'REFUSED'
            ? `<span class="tag no">REFUSED</span> ${t(plainRefusal(r.message))}`
            : `<span class="tag">${BADGE[g]}</span> risk ${t(r.risk)} · ${r.reversibility === 'IRREVERSIBLE' ? 'cannot be undone' : 'can be undone'} · tier ${t(r.effective_tier)}`;
        const own = words !== undefined && v.what_ziffer_does !== words.lead && !words.notes.some((n) => n.sentence === v.what_ziffer_does) ? `<br>${t(v.what_ziffer_does)}` : '';
        const desc = v.tool.description.trim();
        // The appendix is folded as a whole, so each description is shown in full, not folded again.
        const more =
          '<div class="desc">' +
          `${desc === '' ? '<p class="muted">No literal description.</p>' : `<p>${t(desc)}</p>`}` +
          `<p class="muted">${vias.size === 1 ? '' : `Defined through <code>${t(v.tool.via)}</code>. `}${v.tool.params.length > 0 ? `Parameters ${v.tool.params.map((p) => `<code>${t(p)}</code>`).join(', ')}.` : 'No parameters.'}</p>` +
          (v.instruction_hits ?? []).map((h) => `<p class="instr-row" data-pattern="${t(h.pattern)}">${h.severity === 'high' ? '<span class="tag no">HIGH</span> ' : ''}${t(toolInstructionSentence({ tool: v.tool.name, hit: h }))} <span class="excerpt">“${t(h.excerpt)}”</span></p>`).join('') +
          '</div>';
        body.push(
          '<tr>' +
            `<td><code class="tn">${t(v.tool.name)}</code>${isStub(v) ? `<br><span class="stub">${e(STUB_LABEL)}</span>` : ''}<br><code class="path">${t(where(v.tool.defined_at))}</code>${more}</td>` +
            `<td data-l="What ZIFFER would do under the draft">${engine}${own}</td>` +
            `<td data-l="Why">${v.draft_reason === undefined ? `<span class="muted">${g === 'notified' ? 'it changes data, and the draft does not know whether that can be undone' : g === 'allowed' ? 'it reads, so it runs with a receipt' : 'graded by the engine under the draft'}</span>` : t(v.draft_reason)}</td>` +
            '</tr>',
        );
      }
    }
    out.push(`<table class="r tools">\n<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>\n<tbody>\n${body.join('\n')}\n</tbody>\n</table>`);
    return out.join('\n');
  }
}

/** The four groups as the appendix shows them: a word beside the tool, never a colour alone. */
const BADGE: Record<VerdictGroup, string> = { held: 'HELD', notified: 'NOTICE ONLY', refused: 'REFUSED', allowed: 'RUNS' };
const GROUPS: readonly VerdictGroup[] = ['held', 'notified', 'refused', 'allowed'];

/** An engine refusal's message without the clause id it may open with: the page says rules in plain words. */
export function plainRefusal(message: string): string {
  return message.replace(/^\s*(?:§\s*)?[A-Z]{0,4}-?\d+(?:\.\d+)*(?:-\d+)?[a-z]?\s*[:\-]\s*/, '');
}

export interface CodeHtmlInput {
  code: CodeSection;
  /** The bundle's files as written (`ReportPolicy.files`). */
  policy: readonly PolicyFile[];
  /** Installed MCP tools, for the proposed policy's second half; empty on a code-only run. */
  catalog: readonly CatalogTool[];
  /** Installed tools (`server\u0000tool`) the classifier found no word to read by: drafted as writes, to confirm. */
  unknown?: ReadonlySet<string>;
  codeSdks?: readonly CodeSdkEntry[];
  /** The renderer's escape for scan-result text: home paths as `~`, HTML escaped. */
  t: (s: string) => string;
  /** The skills and instruction files the run read (`ScanResult.skills`); absent from a result made before them. */
  skills?: readonly SkillRead[];
}

/**
 * Who the proposals name as their operator, from the dispatcher's own parameters: the context
 * object when there is one (the engineer picks the field), else the application's name, said.
 */
export function operatorSentence(code: CodeSection): string {
  const d = code.insertion.dispatcher;
  const ctx = d === null ? null : contextParameter(d);
  const app = applicationId(code.catalog);
  const what = 'An operator is the person on whose behalf the model acts.';
  if (d === null || ctx === null) {
    const whose = d === null ? 'The tools have no one dispatcher to read a context from' : `${d.name} has no context parameter`;
    return `${whose}, so every proposal will name the application, ${app}, as its operator, not a person. ${what}`;
  }
  return (
    `The call passes ${d.name}'s ${ctx} to ${OPERATOR_OF} in the module. ${what} Which field of ${ctx} identifies the signed-in person is yours to choose there; ` +
    `until you choose, every proposal names the application, ${app}, not a person.`
  );
}

/** One checklist row as the rule table reads it. */
interface RuleRow {
  tool: string;
  rule: DraftRule;
  kind: ConfirmKind | undefined;
  reason: string | undefined;
  /** What ZIFFER does with the tool under the draft, said small under its name; absent for an installed tool (no verdict). */
  group?: VerdictGroup;
  stub?: boolean;
  raised?: string;
  cannot?: string;
  undo?: string[];
}

/**
 * The checklist's groups, most urgent first: actions that run after a notice with nobody asked,
 * then tools the draft cannot read, then tools with no rule, then held tools with no entry, then
 * readings to check. A decision on the installed tools' rules is asked in their own half.
 */
export const ASK_ORDER: readonly ConfirmKind[] = ['notified-no-entry', 'notified-entry', 'unknown', 'refused', 'held-no-entry', 'reason'];

/** Each group's question, in a reader's words. */
export const ASK_QUESTION: Record<ConfirmKind, string> = {
  'notified-no-entry': 'Can it be undone? If not, should a person approve it first?',
  'notified-entry': 'Should a person approve it before it runs?',
  unknown: 'What does it do?',
  refused: 'What rule should it have?',
  'held-no-entry': 'Can it be undone?',
  reason: 'Is the scan’s reading right?',
  'mcp-no-entry': 'Can it be undone?',
};

/** The term each group's words link to, on its first use. */
const GROUP_TERM: Record<VerdictGroup, TermId> = { held: 'held', notified: 'notice', refused: 'refused', allowed: 'receipt' };

/** The last group, folded: rules that ask nothing. */
export const ASK_NONE = 'Nothing to decide: the draft’s reading stands';

/** Where the checklist's values are read from, once, under it. */
function membersNote(): string {
  return (
    `<p class="members small">Each value is read from the policy folder: can it be undone from ${memberLink('reversibility.json')}, ` +
    `risk from ${memberLink('risk_functions.json')}, tier from ${memberLink('floors.json')}, who approves a held tool from ${memberLink('attesters/registry.json')}, who is notified from ${memberLink('notice_targets.json')}.</p>`
  );
}

/**
 * What a person should decide about a rule. Each kind reads the draft's own
 * values or the engine's group, never a guess: a tool the classifier matched
 * on a word, a missing reversibility entry, a notice where a hold may belong,
 * a tool with no rule.
 */
export type ConfirmKind = 'unknown' | 'reason' | 'held-no-entry' | 'notified-no-entry' | 'notified-entry' | 'refused' | 'mcp-no-entry';

/** How the placeholder addressee reads in the "Told first" column, and in the Placeholders box. */
export const TOLD_PLACEHOLDER = 'not named yet';
/** The draft's stand-in approvers (`bundle/generate.ts` writes `approver-1`, `approver-2`, their private halves dropped): nobody real until the reader names them. */
export const STAND_IN_APPROVER = /^approver-\d+$/;

/** The Placeholders box's notice line, in the column's words: one wording, used in both places. */
export function noticePlaceholderHtml(standIn: string, t: (s: string) => string): string {
  return (
    `<div class="placeholder"><strong>Notice addressee:</strong> ${t(TOLD_PLACEHOLDER)}. The draft uses the stand-in <code>${t(standIn)}</code>. ` +
    'Name the person or channel who is told before these tools run.</div>'
  );
}

/** The short words in a table cell; the full sentence is said once per group (`confirmNote`). */
export const CONFIRM_CELL: Record<ConfirmKind, string> = {
  unknown: 'what does it do?',
  reason: 'check the reading',
  'held-no-entry': 'can it be undone?',
  'notified-no-entry': 'can it be undone? if not, raise to HIGH',
  'notified-entry': 'raise to HIGH?',
  refused: 'write a rule',
  'mcp-no-entry': 'can it be undone?',
};

function confirmNote(k: ConfirmKind): string {
  const rev = memberLink('reversibility.json');
  const risk = memberLink('risk_functions.json');
  switch (k) {
    case 'unknown':
      return `no word in the tool’s name or description says what it does, so the draft treats it as a write that cannot be undone; say what it does: add it to ${rev} as REVERSIBLE if it can be undone, and raise its risk in ${risk} if it can do harm.`;
    case 'reason':
      return 'the scan read these from a word in the tool’s name or description (shown under the cell); check that the reading is right.';
    case 'held-no-entry':
      return `the draft has no reversibility entry, so each is held as if it cannot be undone; if one can, add it to ${rev} as REVERSIBLE.`;
    case 'notified-no-entry':
      return `if it can be undone, add it to ${rev} as REVERSIBLE; if it cannot, raise its risk to HIGH in ${risk} so a person approves it.`;
    case 'notified-entry':
      return `raise its risk to HIGH in ${risk} so a person approves it, or keep the notice.`;
    case 'refused':
      return `write a risk function for it in ${risk}, or leave it refused.`;
    case 'mcp-no-entry':
      return `the draft has no reversibility entry, so the engine treats it as one that cannot be undone; if it can, add it to ${rev} as REVERSIBLE.`;
  }
}

/** Whether the classifier found no word to read the tool by (`classify`'s UNCLASSIFIED_REASON is in its reason). */
export function isUnknown(reason: string | undefined): boolean {
  return reason !== undefined && reason.includes(UNCLASSIFIED_REASON);
}

export function confirmKind(r: CodeRule): ConfirmKind | undefined {
  if (r.group === 'refused') return 'refused';
  if (isUnknown(r.verdict.draft_reason)) return 'unknown';
  if (r.group === 'notified') return r.reversibility === undefined ? 'notified-no-entry' : 'notified-entry';
  if (r.group === 'held' && r.reversibility === undefined) return 'held-no-entry';
  return r.verdict.draft_reason === undefined ? undefined : 'reason';
}

function mcpConfirmKind(r: McpRule, unknown: ReadonlySet<string>): ConfirmKind | undefined {
  if (r.risk === undefined) return 'refused';
  if (unknown.has(`${r.server}\u0000${r.tool}`)) return 'unknown';
  return r.reversibility === undefined ? 'mcp-no-entry' : undefined;
}

/** The terms a page uses, as `data-term` marks it: the legend test's input. */
export function termsUsed(html: string): TermId[] {
  const ids = [...html.matchAll(/data-term="([a-z]+)"/g)].map((m) => m[1] ?? '');
  return [...new Set(ids)].filter((x): x is TermId => TERMS.some((term) => term.id === x));
}

