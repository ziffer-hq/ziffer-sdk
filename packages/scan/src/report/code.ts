/**
 * What both reports read from a `CodeSection` (ACP-455 `--code`): the words
 * and the order, written once so the terminal and the HTML cannot disagree.
 *
 * NOTHING HERE GRADES. The verdict of each tool is `decide`'s, carried in
 * `CodeToolVerdict.verdict`; the counts are `CodeSection.counts`, printed
 * without recounting. This module only orders rows and turns fields into
 * sentences. The one thing it derives is which declared framework the scan
 * covers, and it derives it from `data/code-sdks.json`, the one list of what
 * the front ends read, never from a list typed here.
 */

import type { CiVerdict } from '../ci/ci.js';
import { loadCodeSdks, type CodeSdkEntry } from '../code/sdks.js';
import { packageMatches } from '../code/ts/util.js';
import { NO_REVERSIBILITY_ENTRY, NOTICE_ONLY_UNLISTED, whatZifferDoes } from '../code/grade.js';
import { parseKeywords, readDataFile, type KeywordData } from '../classify/data.js';
import { words as splitWords } from '../classify/words.js';
import type { CodeSection, CodeToolVerdict, Interception, SourceRef } from '../code/types.js';

/** `file:line`, as an editor opens it. */
export function where(ref: SourceRef): string {
  return `${ref.file}:${ref.line}`;
}

/** The application as the reports name it: its package name, or the directory scanned. */
export function appName(code: CodeSection): string {
  const n = code.catalog.package_name;
  return n === undefined || n === '' ? code.catalog.root : n;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** A tool a human sees before it runs: the engine says ATTEST. */
export function isHeld(v: CodeToolVerdict): boolean {
  return v.verdict.verdict === 'ATTEST';
}

/**
 * A tool the engine lets run after a notice, with nobody asked: ALLOW, but
 * IRREVERSIBLE (below HIGH, DR-13). Never read as harmless: it is its own
 * group, between held and refused, never folded into "run, recorded".
 */
export function isNotified(v: CodeToolVerdict): boolean {
  const r = v.verdict;
  return r.verdict === 'ALLOW' && r.reversibility === 'IRREVERSIBLE';
}

/** The four groups a reader acts on, in order. */
export type VerdictGroup = 'held' | 'notified' | 'refused' | 'allowed';
export function groupOf(v: CodeToolVerdict): VerdictGroup {
  if (v.verdict.verdict === 'REFUSED') return 'refused';
  if (isHeld(v)) return 'held';
  return isNotified(v) ? 'notified' : 'allowed';
}

function rank(v: CodeToolVerdict): number {
  const r = v.verdict;
  if (r.verdict === 'REFUSED') return 3;
  if (r.verdict === 'ATTEST') return r.reversibility === 'IRREVERSIBLE' ? 0 : 1;
  return r.reversibility === 'IRREVERSIBLE' ? 2 : 4;
}

/**
 * Held (irreversible ones first), then run after a notice, then refused, then
 * allowed; by name within each. The order a reader acts in: what a person will
 * be asked about, what cannot be undone and asks nobody, what the draft has no
 * rule for, what runs.
 */
export function sortedVerdicts(code: CodeSection): CodeToolVerdict[] {
  return [...code.verdicts].sort((a, b) => rank(a) - rank(b) || (a.tool.name < b.tool.name ? -1 : a.tool.name > b.tool.name ? 1 : 0));
}

/** The engine's verdict in short words: "ATTEST · HIGH risk · IRREVERSIBLE", "REFUSED". */
export function verdictWords(r: CiVerdict): string {
  if (r.verdict === 'REFUSED') return 'REFUSED';
  return `${r.verdict} · ${r.risk} risk · ${r.reversibility}`;
}

/** The one-word class a report colours a verdict by. */
export function verdictKind(r: CiVerdict): 'held' | 'refused' | 'allowed' {
  if (r.verdict === 'REFUSED') return 'refused';
  return r.verdict === 'ATTEST' ? 'held' : 'allowed';
}

/**
 * The distinct `via` phrases the tools were found through: what "defined for a
 * model" means in this tree, in the front end's own reader words.
 */
export function definedVia(code: CodeSection): string[] {
  return [...new Set([...code.catalog.tools, ...code.verdicts.map((v) => v.tool)].map((t) => t.via))];
}

/** "example-platform defines 88 tools for a model in 412 files, through defineTool() (...)." */
export function numbersSentence(code: CodeSection): string {
  const via = definedVia(code);
  const through = via.length === 0 ? '' : `, through ${andList(via)}`;
  return (
    `${appName(code)} defines ${plural(code.counts.tools, 'tool', 'tools')} for a model in ` +
    `${plural(code.catalog.files_read, 'file', 'files')}${through}.`
  );
}

/**
 * `counts.notified` (contract a765a13), read structurally: a result made
 * before the field carries none, and then nothing was counted as notified.
 */
export function notifiedCount(code: CodeSection): number {
  const v: unknown = Reflect.get(code.counts, 'notified');
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * "4 tools run after a notice under the draft policy": the notified row's words. What the DRAFT
 * does; whether the application asks anyone is the per-entry table's reading, never this line's.
 */
export function notifiedPhrase(n: number): string {
  return n === 1 ? '1 tool runs after a notice under the draft policy' : `${n} tools run after a notice under the draft policy`;
}

/** "31 would be held for a human before running, 19 are irreversible, 4 tools run after a notice under the draft policy, 12 are refused by the engine, 41 run recorded." */
export function countsSentence(code: CodeSection): string {
  const c = code.counts;
  const be = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const notified = notifiedCount(code);
  const stubs = code.verdicts.filter(isStub).length;
  return (
    `${c.held} would be held for a human before running, ` +
    `${be(c.irreversible, 'is treated as irreversible', 'are treated as irreversible')}, ` +
    (notified > 0 ? `${notifiedPhrase(notified)}, ` : '') +
    `${be(c.refused, 'is refused by the engine', 'are refused by the engine')}, ` +
    `${be(c.allowed, 'runs', 'run')} recorded.` +
    // The engine's counts keep the stubs the headline and the grade leave out: said, so one number never means two things.
    (stubs > 0 ? ` These are the engine's counts over all ${c.tools} tools, the ${be(stubs, 'stub', 'stubs')} included.` : '')
  );
}

/**
 * When the table lists fewer tools than the count: say so, in numbers, rather
 * than let a table of eight read as the whole of eighty-eight.
 */
export function listedSentence(code: CodeSection): string | undefined {
  const n = code.verdicts.length;
  const total = code.counts.tools;
  return n === total ? undefined : `The engine's verdict is listed here for ${n} of the ${total} tools.`;
}

/**
 * The sentence an exposure prints: where tools reach a model, and for a
 * computed one, who decides at runtime (the record's §2.2 sentence).
 */
export function exposureSentences(code: CodeSection): string[] {
  const gates = code.catalog.gates;
  return code.catalog.exposures.map((e) => {
    const at = `${e.via} at ${where(e.at)}`;
    if (e.kind === 'computed' && gates.length > 0) {
      const by = andList(gates.map((g) => `${g.name} (${where(g.at)})`));
      return `${at}: exposure is decided at runtime by ${by}; the scan lists what can be exposed.`;
    }
    return `${at}: ${e.note.replace(/\.$/, '')}.`;
  });
}

/**
 * The ONE line to paste at the top of the dispatcher (`Insertion.call`), read
 * structurally: a result made before the field was added carries none, and
 * then the snippet is the whole paste.
 */
export function insertionCall(ins: object): string | undefined {
  const v: unknown = Reflect.get(ins, 'call');
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** The measured difference between reading types and reading syntax, as a sentence. */
export function syntaxOnlySentence(code: CodeSection): string {
  const s = code.catalog.syntax_only;
  return (
    `A syntax-only reading of the same files finds ${plural(s.found, 'tool', 'tools')} and misses ${s.missed}; ` +
    'this scan follows types, which is how it finds tools an application defines through its own factory.'
  );
}

// ---------------------------------------------------------------- frameworks

/**
 * The data file has ONE reader, the front end's (`code/sdks.ts`); this module
 * re-exports it so the reports and their tests build against the same entry
 * shape. A second parser here read the file as a bare list while the front end
 * wrote `{ frameworks: [...] }`, and the two agreed until the day they were merged.
 */
export { loadCodeSdks, type CodeSdkEntry } from '../code/sdks.js';

export interface FrameworkRow {
  name: string;
  version: string;
  covered: boolean;
  /** The framework's name from the data file, when the package is one it lists. */
  framework?: string;
}

/**
 * Each declared framework, covered or not. Covered: its entry in the data file
 * says this release reads it, or a tool in the verdicts was found through it
 * (then it was read, whatever the file says).
 */
export function frameworkRows(code: CodeSection, table: readonly CodeSdkEntry[] = loadCodeSdks()): FrameworkRow[] {
  const found = new Set<string>(code.verdicts.map((v) => v.tool.sdk));
  // One row per package: a monorepo declares one package at several ranges (zod four times
  // in the first customer's tree), and four rows read as four frameworks.
  const versions = new Map<string, string[]>();
  for (const s of code.catalog.sdks) versions.set(s.name, [...(versions.get(s.name) ?? []), s.version]);
  return [...versions.entries()].map(([name, vs]) => {
    const entry = table.find((e) => packageMatches(name, e.packages));
    const covered = entry !== undefined && (entry.covered === 'milestone-1' || found.has(entry.id));
    return { name, version: [...new Set(vs)].join(', '), covered, ...(entry === undefined ? {} : { framework: entry.framework }) };
  });
}

/**
 * Where a check can stand before the tools handed over at one place run (`Exposure.interception`),
 * in plain words: the page never shows the record's kind codes. Undefined when the scan read none.
 */
export function interceptionSentence(i: Interception | undefined): string | undefined {
  if (i === undefined) return undefined;
  switch (i.kind) {
    case 'K1':
      return `The framework has its own step that runs before a tool and can refuse it (${i.name}), and this code ${i.present ? 'uses it' : 'does not use it'}.`;
    case 'K2':
      return `The framework can stop and wait for an approval before a tool runs (${i.name}), and this code ${i.present ? 'uses it' : 'does not use it'}.`;
    case 'K3':
      return 'The framework runs these tools itself and has no step that can refuse one: a check stands at the top of each tool’s own function.';
    case 'K4':
      return 'The SDK runs nothing: your own code runs each tool the model asks for, and a check stands there.';
    case 'K5':
      return 'The provider runs these tools on its own servers: nothing in your code can stop one call, only whether the tool is offered at all.';
  }
}

/**
 * The scan's notes and `via` phrases name the record's interception kinds in its own shorthand
 * ("an interception point already present (K1)", "(K3: wrap the function)"): kept in the JSON,
 * where they are data, and taken off the page, where they are internal words. Only those
 * phrasings are touched, so a customer's own text that happens to hold "K1" is left as written.
 */
export function plainKinds(s: string): string {
  return s
    .replace(/\s*\(K[1-5](?:-shaped)?\)/g, '')
    .replace(/,\s*K[1-5](?:-shaped)?\)/g, ')')
    .replace(/\bK[1-5]-shaped\b\s*/g, '')
    .replace(/\bK[1-5]: /g, '')
    .replace(/\bK[1-5] would be\b/g, 'the place would be');
}

/**
 * Every framework the scan reads, by the language it is written in, from `data/code-sdks.json`:
 * the list is about the SCANNER, where the tile above it is about this application. `unread`
 * names the frameworks listed but not read yet; empty when every one is read.
 */
const SCANNER_LANGUAGES: readonly (readonly [string, string])[] = [
  ['TS', 'TypeScript and JavaScript'],
  ['Py', 'Python'],
  ['JSON', 'Configuration files'],
];

export function scannerFrameworks(table: readonly CodeSdkEntry[] = loadCodeSdks()): { groups: { language: string; names: string[] }[]; unread: string[] } {
  const fws = table.filter((f) => f.kind === 'framework');
  const read = fws.filter((f) => f.covered === 'milestone-1');
  const groups = SCANNER_LANGUAGES.map(([k, language]) => ({ language, names: read.filter((f) => f.language.includes(k)).map((f) => f.framework) }));
  return { groups: groups.filter((g) => g.names.length > 0), unread: fws.filter((f) => f.covered !== 'milestone-1').map((f) => f.framework) };
}

/** The words a reader sees for a framework's coverage. */
export const COVERED = 'covered in this scan';
export const NOT_READ_YET = 'declared, not read yet';

// ---------------------------------------------------------------- stubs

/**
 * A tool whose own description says it is a stub ("Stub for Phase 72, wired in Phase 74"):
 * declared, not wired. The scanner's reading (`CodeTool.declared_stub`, the whole word, any
 * case) is the ONE source: the report reads the field and nothing else, so the report and the
 * scan cannot disagree about which tools are stubs. Such a tool is left out of the headline and
 * the grade, and the number left out is said, because counting a declared-but-unwired tool as
 * something a model can do today overstates what the application does.
 */
export function isStub(v: CodeToolVerdict): boolean {
  return v.tool.declared_stub === true;
}

/** The label a stub carries in the tables. */
export const STUB_LABEL = 'declared, not wired (its description says stub)';

/** "16 tools whose description says they are stubs are left out of these numbers.", or undefined when none is. */
export function stubsSentence(n: number): string | undefined {
  if (n <= 0) return undefined;
  return n === 1
    ? '1 tool whose description says it is a stub is left out of these numbers.'
    : `${n} tools whose description says they are stubs are left out of these numbers.`;
}

// ---------------------------------------------------------------- the work

/**
 * The tools that do not run through the chosen dispatcher, so the one call there does not
 * cover them: each needs its own call. `count` is the section's own numbers
 * (`counts.tools - tools_delegating`); `names` are those the verdicts list.
 */
export function outsideDispatcher(code: CodeSection): { count: number; names: string[] } {
  const d = code.insertion.dispatcher;
  if (d === null) return { count: 0, names: [] };
  return {
    count: Math.max(0, code.counts.tools - d.tools_delegating),
    names: code.verdicts.filter((v) => v.tool.delegates_to !== d.name).map((v) => v.tool.name),
  };
}

/**
 * The real work ZIFFER asks, from the scan's own numbers: the call in the dispatcher (named),
 * the gate module the report provides, the policy files to review and sign, the approvers to
 * name, and a call of its own for each tool the dispatcher does not run.
 */
export function workSentence(code: CodeSection): string {
  const d = code.insertion.dispatcher;
  const rest = 'the gate module this report provides, the draft policy files to review and sign, and the approvers to name.';
  if (d === null) return `The work: one call at the top of each tool’s execute, ${rest}`;
  const out = outsideDispatcher(code);
  const tail =
    out.count === 0
      ? ` All ${code.counts.tools} tools go through ${d.name}.`
      : ` ${d.tools_delegating} of the ${code.counts.tools} tools go through ${d.name}; ` +
        (out.names.length === out.count
          ? `${andList(out.names)} ${out.count === 1 ? 'does' : 'do'} not, and ${out.count === 1 ? 'needs its' : 'each needs its'} own call.`
          : `the other ${out.count} do not, and each needs its own call.`);
  // A place a tool runs another tool without passing the dispatcher is work too: the call there does not see it.
  const sites = code.catalog.tools.reduce((n, t) => n + (t.calls ?? []).length, 0);
  const inner =
    sites === 0
      ? ''
      : ` ${sites === 1 ? 'The 1 place where a tool runs another tool' : `The ${sites} places where a tool runs another tool`} without passing ${d.name} ${sites === 1 ? 'needs' : 'need'} the same call, or to be routed through it.`;
  return `The work: one call at the top of ${d.name}, ${rest}${tail}${inner}`;
}

// ---------------------------------------------------------------- replies

/**
 * A tool whose purpose is to carry the model's reply to the person talking to it: named
 * `respond` (or `reply`, `answer`, `final_answer`), or described as delivering the model's
 * answer ("Send your response to the guest", "deliver your final answer"). A reading of the
 * name and description. Held for approval, such a tool makes every reply wait for a person,
 * which a reader must decide on before signing.
 */
export function isReplyTool(v: CodeToolVerdict): boolean {
  if (/^(respond|reply|answer|final_?answer)$/i.test(v.tool.name.replace(/[-\s]/g, '_'))) return true;
  return /\b(?:deliver|send|return)s?\s+(?:your|its|the model['\u2019]s)\s+(?:final\s+)?(?:answer|response|reply)\b/i.test(v.tool.description);
}

/** "As drafted, respond is held for approval, so replies would wait for a person. …", or undefined when no held tool carries replies. */
export function heldReplyWarning(held: readonly CodeToolVerdict[]): string | undefined {
  const names = held.filter(isReplyTool).map((v) => v.tool.name);
  if (names.length === 0) return undefined;
  return `As drafted, ${andList(names)} ${names.length === 1 ? 'is' : 'are'} held for approval, so replies would wait for a person. Decide what ${names.length === 1 ? 'this carries' : 'these carry'} before you sign.`;
}

// ---------------------------------------------------------------- the grade

export type GradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * The grade as a RANGE. The engine treats a tool the draft has no reversibility entry for
 * as impossible to undo (RV-1's fail-safe), which is right for the engine and wrong as a
 * statement about the application: nothing says those tools cannot be undone either. So the
 * worst case counts them and the best case does not, and the two letters are printed apart.
 * Tools whose description says they are stubs are counted in neither.
 */
export interface ExposureGrade {
  /** Counts only the tools marked impossible to undo by their name or description, and the refused ones. */
  best: GradeLetter;
  /** Also counts every tool that changes data and says nothing about undoing it. */
  worst: GradeLetter;
  /** `counts.tools`, less the stubs. */
  tools: number;
  /** Graded irreversible because the draft LISTS them so and their own name or description says so. */
  known: number;
  /** Listed irreversible because they run another tool unseen, or write an access value: not their own words about undoing. `runsAnother + accessValue`. */
  derived: number;
  /** Of `derived`: listed irreversible because they run another tool unseen. */
  runsAnother: number;
  /** Of `derived`: listed irreversible because they WRITE a secret or an access value (a tool that only reads one stays a read). */
  accessValue: number;
  /** Graded irreversible only because the draft has no reversibility entry for them. */
  unlisted: number;
  /** Refused by the engine: the draft has no rule for them. */
  refused: number;
  /** The rest: the draft reads them as reads. */
  reads: number;
  /** Left out: their description says they are stubs. */
  stubs: number;
  /** The share behind `best` and `worst`, as a whole percent rounded down ("under 1" never shown as 0). */
  bestPercent: string;
  worstPercent: string;
  /** Files whose imports the type checker could not resolve (the limits section's own line); the grade is provisional when this is above 0. */
  unresolvedFiles: number;
}

/**
 * The one sentence that defines the grade, printed beside it. It reads the ENGINE's counts
 * and the draft's listing, nothing else.
 */
export const GRADE_DEFINITION =
  'The grade is the share of the tools a model can call that do something marked as impossible to undo, or that the ZIFFER engine refused because no rule covers them: ' +
  'A none, B under 10%, C under 25%, D under 50%, F half or more. ' +
  'The best case counts only the tools whose own name or description marks them as impossible to undo; the worst case also counts every tool that changes data and says nothing about undoing it.';

/**
 * The limits line `code/index.ts` writes when imports could not be resolved: the one place
 * the count is printed, read back here so the grade and the limits section cannot disagree.
 */
const UNRESOLVED_LINE = /^(\d+) file\(s\) import packages the type checker could not resolve/;

export function unresolvedFiles(code: CodeSection): number {
  for (const line of code.catalog.not_seen) {
    const m = UNRESOLVED_LINE.exec(line);
    if (m !== null) return Number(m[1]);
  }
  return 0;
}

// ---------------------------------------------------------------- why a tool is graded impossible to undo

/**
 * Why the draft LISTS a tool as impossible to undo, read from what the grader recorded:
 * `marked`, its own name or description says so (an irreversible keyword, `irreversible_class`,
 * or a `cannot_be_undone` hint); `access_value`, its name or a parameter names a secret or an
 * access value (the classifier's `name says "<word>"` / `parameter "<p>" says "<word>"`, the word
 * one of `data/keywords.json`'s `sensitive_values`); `runs_another`, it runs another tool unseen
 * (`raised_by`). Never re-read from the tool's own name: the grader's recorded reason is the one source.
 */
export type IrreversibleBasis = 'marked' | 'access_value' | 'runs_another';

let keywordData: KeywordData | undefined;
function sensitiveTexts(): Set<string> {
  keywordData ??= parseKeywords(readDataFile('keywords.json'), splitWords);
  return new Set(keywordData.sensitive_values.words.map((k) => k.text));
}

const SAYS = /^(?:name|parameter "[^"]*") says "([^"]+)"$/;

/** The reason segments the classifier recorded for a secret or access value: `name says "access info"`. */
export function accessSegments(v: Pick<CodeToolVerdict, 'draft_reason'>): string[] {
  const secret = sensitiveTexts();
  return (v.draft_reason ?? '').split('; ').filter((seg) => secret.has(SAYS.exec(seg)?.[1] ?? '\u0000'));
}

/** The basis of a tool the draft lists as impossible to undo; undefined for any other tool (unlisted, refused, reversible). */
export function irreversibleBasis(v: CodeToolVerdict): IrreversibleBasis | undefined {
  if (v.verdict.verdict === 'REFUSED' || v.verdict.reversibility !== 'IRREVERSIBLE' || isUnlisted(v)) return undefined;
  const access = new Set(accessSegments(v));
  const own = (v.draft_reason ?? '')
    .split('; ')
    .filter((seg) => /^(?:name|description) says "/.test(seg) && !access.has(seg));
  if (v.irreversible_class !== undefined || (v.undo_hints ?? []).some((h) => h.says === 'cannot_be_undone') || own.length > 0) return 'marked';
  if (access.size > 0) return 'access_value';
  if (v.raised_by !== undefined) return 'runs_another';
  return 'marked';
}

/** Whether the engine treats this tool as irreversible only because the draft has no reversibility entry for it. */
export function isUnlisted(v: CodeToolVerdict): boolean {
  return v.what_ziffer_does === NO_REVERSIBILITY_ENTRY || v.what_ziffer_does === NOTICE_ONLY_UNLISTED;
}

function letterOf(exposed: number, tools: number): GradeLetter {
  const share = tools <= 0 ? 0 : exposed / tools;
  return exposed === 0 ? 'A' : share < 0.1 ? 'B' : share < 0.25 ? 'C' : share < 0.5 ? 'D' : 'F';
}

function percentOf(exposed: number, tools: number): string {
  const whole = tools <= 0 ? 0 : Math.floor((exposed / tools) * 100);
  return exposed > 0 && whole === 0 ? 'under 1' : String(whole);
}

/** The grade from `counts`, less the stubs the verdicts carry; undefined when the application defines no tool. */
export function exposureGrade(code: CodeSection): ExposureGrade | undefined {
  const c = code.counts;
  if (c.tools <= 0) return undefined;
  const stubs = code.verdicts.filter(isStub);
  const irreversibleOf = (v: CodeToolVerdict): boolean => v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE';
  const tools = Math.max(0, c.tools - stubs.length);
  const irreversible = Math.max(0, c.irreversible - stubs.filter(irreversibleOf).length);
  const refused = Math.max(0, c.refused - stubs.filter((v) => v.verdict.verdict === 'REFUSED').length);
  const unlisted = Math.min(irreversible, code.verdicts.filter((v) => !isStub(v) && isUnlisted(v)).length);
  const basisCount = (basis: IrreversibleBasis): number => code.verdicts.filter((v) => !isStub(v) && irreversibleBasis(v) === basis).length;
  const runsAnother = basisCount('runs_another');
  const accessValue = basisCount('access_value');
  const derived = Math.min(irreversible - unlisted, runsAnother + accessValue);
  const known = irreversible - unlisted - derived;
  const reads = Math.max(0, tools - irreversible - refused);
  const best = known + derived + refused;
  const worst = best + unlisted;
  return {
    best: letterOf(best, tools),
    worst: letterOf(worst, tools),
    tools,
    known,
    derived,
    runsAnother,
    accessValue,
    unlisted,
    refused,
    reads,
    stubs: stubs.length,
    bestPercent: percentOf(best, tools),
    worstPercent: percentOf(worst, tools),
    unresolvedFiles: unresolvedFiles(code),
  };
}

/**
 * The grade if a person marked the named tools as ones that can be undone (the proposed undo
 * entries): each leaves the count it is in, known or unlisted, and becomes a read. Stubs and
 * refused tools move nothing. Undefined when the application defines no tool.
 */
export function gradeIfReversible(code: CodeSection, names: ReadonlySet<string>): { grade: ExposureGrade; moved: number } | undefined {
  const g = exposureGrade(code);
  if (g === undefined) return undefined;
  const moved = code.verdicts.filter(
    (v) => names.has(v.tool.name) && !isStub(v) && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE',
  );
  const unlisted = Math.max(0, g.unlisted - moved.filter(isUnlisted).length);
  const isDerived = (v: CodeToolVerdict): boolean => irreversibleBasis(v) === 'access_value' || irreversibleBasis(v) === 'runs_another';
  const derived = Math.max(0, g.derived - moved.filter(isDerived).length);
  const runsAnother = Math.max(0, g.runsAnother - moved.filter((v) => irreversibleBasis(v) === 'runs_another').length);
  const accessValue = Math.max(0, g.accessValue - moved.filter((v) => irreversibleBasis(v) === 'access_value').length);
  const known = Math.max(0, g.known - moved.filter((v) => !isUnlisted(v) && !isDerived(v)).length);
  const best = known + derived + g.refused;
  const worst = best + unlisted;
  return {
    moved: moved.length,
    grade: {
      ...g,
      known,
      derived,
      runsAnother,
      accessValue,
      unlisted,
      reads: g.tools - known - derived - unlisted - g.refused,
      best: letterOf(best, g.tools),
      worst: letterOf(worst, g.tools),
      bestPercent: percentOf(best, g.tools),
      worstPercent: percentOf(worst, g.tools),
    },
  };
}

/**
 * "2 are treated as impossible to undo because they run another tool", "1 because it writes an
 * access value": the grade's detailed split of `derived`, each reason counted apart. Empty when
 * `derived` is 0. The headline says the same total in one clause (`report/exec.ts`).
 */
export function derivedPhrases(g: Pick<ExposureGrade, 'runsAnother' | 'accessValue'>): string[] {
  const out: string[] = [];
  if (g.runsAnother > 0) {
    out.push(g.runsAnother === 1 ? '1 is treated as impossible to undo because it runs another tool' : `${g.runsAnother} are treated as impossible to undo because they run another tool`);
  }
  if (g.accessValue > 0) {
    const lead = out.length === 0 ? (g.accessValue === 1 ? '1 is treated as impossible to undo' : `${g.accessValue} are treated as impossible to undo`) : `${g.accessValue}`;
    out.push(`${lead} because ${g.accessValue === 1 ? 'it writes' : 'they write'} an access value`);
  }
  return out;
}

/**
 * The grade TODAY and the grade within reach (ACP-464 item 8): ONE grade is shown, never a range. Today
 * is the worst case, by the product's own rule: a tool with no reversibility entry is treated as one
 * that cannot be undone (unknown is never low), so the tools that do not say whether they can be undone
 * count against the grade until someone classifies them. `reachable` is the best case, present only
 * when it differs: what the grade becomes if every one of those tools can be undone.
 *
 * THE ONE FUNCTION. Every surface that prints the grade (the page's card, the terminal, the JSON, the
 * page without `--code`) reads it here; none restates the rule.
 */
export interface GradeNow {
  today: GradeLetter;
  reachable?: GradeLetter;
  /** The tools that change data and do not say whether that can be undone: what separates the two. */
  unclassified: number;
  /** Files whose imports could not be resolved: the grade is provisional when this is above 0. */
  provisionalFiles: number;
}

export function gradeNow(g: ExposureGrade): GradeNow {
  return { today: g.worst, ...(g.best === g.worst ? {} : { reachable: g.best }), unclassified: g.unlisted, provisionalFiles: g.unresolvedFiles };
}

/**
 * "F today. 23 tools change data and do not say whether that can be undone, so they count as not
 * undoable. If all 23 can be undone, the grade is C." Undefined when nothing is within reach: the
 * letter is then the whole of it.
 */
export function gradeNowSentence(g: ExposureGrade): string | undefined {
  const n = gradeNow(g);
  if (n.reachable === undefined) return undefined;
  const u = n.unclassified;
  const why =
    u === 1
      ? '1 tool changes data and does not say whether that can be undone, so it counts as not undoable.'
      : `${u} tools change data and do not say whether that can be undone, so they count as not undoable.`;
  return `${n.today} today. ${why} If ${u === 1 ? 'it' : `all ${u}`} can be undone, the grade is ${n.reachable}.`;
}

/** "provisional: 347 files import packages the scan could not resolve", or undefined when nothing makes the grade provisional. */
export function provisionalReason(g: ExposureGrade): string | undefined {
  const n = gradeNow(g).provisionalFiles;
  if (n <= 0) return undefined;
  return `provisional: ${n} ${n === 1 ? 'file imports' : 'files import'} packages the scan could not resolve`;
}

/** The grade as the JSON carries it (`CodeSection.grade`): `gradeNow`'s reading, and both cases. Undefined when no tool is defined. */
export function gradeRecord(code: CodeSection): NonNullable<CodeSection['grade']> | undefined {
  const g = exposureGrade(code);
  if (g === undefined) return undefined;
  const n = gradeNow(g);
  return { today: n.today, ...(n.reachable === undefined ? {} : { reachable: n.reachable }), best: g.best, worst: g.worst, unclassified: n.unclassified, provisional_files: n.provisionalFiles };
}

/** The grade as a label: today's letter, one letter always (`gradeNow`). */
export function gradeLabel(g: ExposureGrade): string {
  return gradeNow(g).today;
}

/** "Exposure grade C to F (provisional)". */
export function gradeTitle(g: ExposureGrade): string {
  return `Exposure grade ${gradeLabel(g)}${g.unresolvedFiles > 0 ? ' (provisional)' : ''}`;
}

/**
 * The grade in the one screen's room: the range and what moves it in one sentence, then the
 * stubs and the provisional notes. The report prints `gradeSentence`, which says each case apart.
 */
export function gradeShort(g: ExposureGrade): string {
  const now = gradeNowSentence(g);
  // One grade, today's, and what gets to the one within reach (ACP-464); the counts when nothing is within reach.
  if (now === undefined) return gradeSentence(g);
  return [now, ...gradeNotes(g)].join(' ');
}

/** What the grade leaves out (the stubs) and why it is provisional (unresolved imports), a sentence each. */
function gradeNotes(g: ExposureGrade): string[] {
  const out: string[] = [];
  const stubs = stubsSentence(g.stubs);
  if (stubs !== undefined) out.push(stubs);
  if (g.unresolvedFiles > 0) {
    out.push(`Provisional: ${g.unresolvedFiles} ${g.unresolvedFiles === 1 ? 'file imports' : 'files import'} packages the scan could not resolve, so tools defined there may be missing.`);
  }
  return out;
}

/**
 * The grade's finding, what moves it, and what it leaves out: "Best case C: 9 of the 67 tools
 * (13%) are marked as impossible to undo by their name or description; confirm. Worst case F: …".
 */
export function gradeSentence(g: ExposureGrade): string {
  const n = g.known + g.derived + g.refused;
  const marked = g.known === 1 ? '1 is marked as impossible to undo by its name or description' : `${g.known} are marked as impossible to undo by their name or description`;
  const parts = [
    ...(g.known > 0 ? [marked] : []),
    ...derivedPhrases(g),
    ...(g.refused > 0 ? [`${g.refused} ${g.refused === 1 ? 'has' : 'have'} no rule in the draft policy`] : []),
  ];
  const confirm = g.known + g.derived > 0 ? '; confirm each reading' : '';
  const found =
    n === 0
      ? `none of the ${g.tools} tools is marked as impossible to undo by its name or description${g.unlisted > 0 ? '' : ', and every one has a rule'}`
      : parts.length === 1
        ? `${n} of the ${g.tools} tools (${g.bestPercent}%) ${(parts[0] ?? '').replace(/^\d+ /, '')}${confirm}`
        : `${n} of the ${g.tools} tools (${g.bestPercent}%) count: ${andList(parts)}${confirm}`;
  const sentences =
    g.unlisted === 0
      ? [`${found.charAt(0).toUpperCase()}${found.slice(1)}.`]
      : [
          `Best case ${g.best}: ${found}.`,
          `Worst case ${g.worst}: ${n + g.unlisted} of the ${g.tools} (${g.worstPercent}%), also counting the ${g.unlisted} that change data and say nothing about undoing it.`,
          `Classifying those ${g.unlisted} in reversibility.json moves the grade within this range.`,
        ];
  return [...sentences, ...gradeNotes(g)].join(' ');
}

// ---------------------------------------------------------------- plain words

/** The framework a package belongs to, by the data file's name for it. */
function frameworkOfPackage(pkg: string, table: readonly CodeSdkEntry[]): string | undefined {
  return table.find((e) => packageMatches(pkg, e.packages))?.framework;
}

/** A framework's short name: its data-file name up to the first parenthesis. */
function shortFramework(name: string): string {
  return name.replace(/\s*\(.*$/, '').trim();
}

/**
 * A `via` phrase in a reader's words, for the terminal and the page's first
 * lines: `defineTool() (app-local factory, returns ToolModule with input_schema
 * typed Tool.InputSchema from "@anthropic-ai/sdk")` reads "its own defineTool()
 * helper (Anthropic Messages API tool format)". The technical phrase stays in
 * the HTML table, where a developer checks it.
 */
export function plainVia(via: string, table: readonly CodeSdkEntry[] = loadCodeSdks()): string {
  const pkg = /"([^"]+)"/.exec(via)?.[1];
  const framework = pkg === undefined ? undefined : frameworkOfPackage(pkg, table);
  const local = /^(\S+?\(\))\s*\(app-local factory/.exec(via);
  if (local !== null) return `its own ${local[1] ?? ''} helper${framework === undefined ? '' : ` (${shortFramework(framework)} tool format)`}`;
  if (framework === undefined) return via;
  const head = via.replace(/\s+(typed )?from\s+"[^"]+".*$/, '').trim();
  // "Tool object" is a noun phrase in the sentence "… through X and Y": it takes an article.
  return `${/^[A-Z][a-z]+ object$/.test(head) ? 'a ' : ''}${head} from the ${shortFramework(framework)}`;
}

/** The distinct routes, in plain words. */
export function plainVias(code: CodeSection, table: readonly CodeSdkEntry[] = loadCodeSdks()): string[] {
  return [...new Set(definedVia(code).map((v) => plainVia(v, table)))];
}

/** `numbersSentence`, with the routes in plain words: the terminal's first line and the page's. */
export function plainNumbersSentence(code: CodeSection, table: readonly CodeSdkEntry[] = loadCodeSdks(), subject?: string): string {
  const via = plainVias(code, table);
  const through = via.length === 0 ? '' : `, through ${andList(via)}`;
  return (
    `${subject ?? appName(code)} defines ${plural(code.counts.tools, 'tool', 'tools')} for a model in ` +
    `${plural(code.catalog.files_read, 'file', 'files')}${through}.`
  );
}

// ---------------------------------------------------------------- groups

/**
 * What a group's tools have in common, said once: the sentence most of them
 * carry (`what_ziffer_does`) is the group's lead, and each other sentence is
 * a note naming the tools it applies to. A sentence is never printed once per
 * tool: 29 copies of one sentence were the terminal's first-run defect.
 */
export interface GroupWords {
  lead: string;
  notes: { sentence: string; tools: string[] }[];
}

export function groupWords(verdicts: readonly CodeToolVerdict[]): GroupWords | undefined {
  const by = new Map<string, string[]>();
  for (const v of verdicts) by.set(v.what_ziffer_does, [...(by.get(v.what_ziffer_does) ?? []), v.tool.name]);
  const ranked = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  const first = ranked[0];
  if (first === undefined) return undefined;
  return { lead: first[0], notes: ranked.slice(1).map(([sentence, tools]) => ({ sentence, tools })) };
}

/** The group a verdict belongs to, with its label words for a reader. */
export const GROUP_WORDS: Record<VerdictGroup, string> = {
  held: 'held for a person',
  notified: 'run after a notice under the draft',
  refused: 'refused: no rule',
  allowed: 'run, recorded',
};

// ---------------------------------------------------------------- the codebase

/** The directory a file is in, `.` for the root. */
export function folderOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '.' : file.slice(0, i);
}

/** Tools per folder they are defined in, most first, then by name. */
export function toolFolders(code: CodeSection): { folder: string; tools: number }[] {
  const n = new Map<string, number>();
  for (const v of code.verdicts) n.set(folderOf(v.tool.defined_at.file), (n.get(folderOf(v.tool.defined_at.file)) ?? 0) + 1);
  return [...n.entries()].map(([folder, tools]) => ({ folder, tools })).sort((a, b) => b.tools - a.tools || (a.folder < b.folder ? -1 : 1));
}

/** Tools per definition route (`via`), with the framework the route belongs to, most first. */
export function toolRoutes(code: CodeSection, table: readonly CodeSdkEntry[] = loadCodeSdks()): { via: string; plain: string; framework: string; tools: number }[] {
  const n = new Map<string, { sdk: string; tools: number }>();
  for (const v of code.verdicts) {
    const prior = n.get(v.tool.via);
    n.set(v.tool.via, { sdk: v.tool.sdk, tools: (prior?.tools ?? 0) + 1 });
  }
  return [...n.entries()]
    .map(([via, { sdk, tools }]) => {
      const pkg = /"([^"]+)"/.exec(via)?.[1];
      const named = pkg === undefined ? undefined : frameworkOfPackage(pkg, table);
      const own = table.find((e) => e.id === sdk)?.framework;
      return { via, plain: plainVia(via, table), framework: shortFramework(named ?? own ?? sdk), tools };
    })
    .sort((a, b) => b.tools - a.tools);
}

// ---------------------------------------------------------------- what ran

/**
 * Which halves of one scan ran (`ScanResult.scope`, added by the one-scan
 * CLI): read structurally, so a result made before the field renders as it
 * did. `code`: 'read', 'skipped-flag' (--no-code), 'no-codebase'; `installed`:
 * whether the installed tools were read.
 */
export interface ScanScope {
  code?: string;
  installed?: boolean;
}

export function scopeOf(result: object): ScanScope | undefined {
  const s: unknown = Reflect.get(result, 'scope');
  if (typeof s !== 'object' || s === null) return undefined;
  const code: unknown = Reflect.get(s, 'code');
  const installed: unknown = Reflect.get(s, 'installed');
  return { ...(typeof code === 'string' ? { code } : {}), ...(typeof installed === 'boolean' ? { installed } : {}) };
}

/** The sentence a report prints in place of a half that did not run, or undefined when it ran. */
export function notScannedSentence(half: 'code' | 'installed', scope: ScanScope | undefined): string | undefined {
  if (scope === undefined) return undefined;
  if (half === 'installed') {
    return scope.installed === false
      ? 'Not scanned: this report covers your code only. Run npx @ziffer-io/scan in this folder to add the tools installed in your AI assistants.'
      : undefined;
  }
  if (scope.code === 'skipped-flag') return 'Your application’s code was not scanned: this report covers only the tools installed in your AI assistants. Run npx @ziffer-io/scan in your project folder to add your code.';
  if (scope.code === 'no-codebase') return 'No codebase was found in the folder scanned, so only the tools installed in your AI assistants are here.';
  return undefined;
}

/**
 * A group's shared sentence in a reader's words. The grader's sentences are
 * written for one tool ("the draft has no reversibility entry for it, so the
 * engine treats it as irreversible; add one …"); said once for a group they
 * read badly, so the two the first customer's run printed are said for the
 * group here. Any other sentence is kept as the grader wrote it.
 */
export function plainLead(sentence: string): string {
  if (sentence === whatZifferDoes({ verdict: 'REFUSED', clause: '8.4-3', message: '' })) {
    return 'The draft has no rule for them, so the engine will not let them run until one is written.';
  }
  if (sentence === NOTICE_ONLY_UNLISTED) {
    return 'These run after a notice under the draft; it does not know whether they can be undone. ' +
      'Mark the reversible ones in reversibility.json, or raise the others to HIGH so a person approves them.';
  }
  return sentence;
}

/** A note naming the tools a different sentence applies to, in the group's words. */
export function plainNote(sentence: string, tools: readonly string[]): string {
  const one = tools.length === 1;
  if (sentence === NO_REVERSIBILITY_ENTRY) {
    return `${tools.length} of them only because the draft does not know whether ${one ? 'it' : 'they'} can be undone: ${andList(tools)} ` +
      `(add ${one ? 'it' : 'them'} to reversibility.json if ${one ? 'it' : 'they'} can).`;
  }
  return `${tools.length} of them: ${sentence.replace(/\.$/, '')}: ${andList(tools)}.`;
}
