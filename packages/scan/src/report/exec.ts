/**
 * The executive summary (ACP-455, 0.3.0): the report's first section, written
 * for a CEO or a CISO who has never heard of ZIFFER and has two minutes.
 *
 * EVERY SENTENCE HERE IS BUILT FROM A FIELD. The numbers are `CodeSection.counts`
 * and the grade `report/code.ts` already derives from them; every tool named is
 * a `CodeToolVerdict` whose engine verdict is the one the sentence implies (a
 * tool said to run "with nobody asking" is ALLOW, a tool said to wait for a
 * person is ATTEST); the outsider path is named only from the draft's
 * `untrusted_input` marks, as a PATH, never as an attack that happened; the
 * regulation lines and their status words are the dossier's rows, verbatim,
 * through `report/controls.ts`, never upgraded. "Can", never "will"; no
 * adjective the data does not carry, no statistic from outside this scan.
 *
 * The one thing this module chooses is ORDER: which of a group's tools it
 * names first. Ranking changes which true sentence is printed, never what a
 * sentence claims.
 */

import { OWASP_EXCESSIVE_AGENCY, OWASP_FRAMEWORK } from './owasp.js';
import { basename } from 'node:path';

import type { CodeSection, CodeToolVerdict } from '../code/types.js';
import { parseKeywords, readDataFile, type KeywordData } from '../classify/data.js';
import { countsWord } from '../classify/index.js';
import { words as splitWords } from '../classify/words.js';
import type { Classification, ControlRef, Finding, ScanResult } from '../types.js';
import { ANNEX, type AnnexSource, type AtlasRow, findAnnexRow, findAtlasRow } from './annex.js';
import { accessSegments, andList, where, heldReplyWarning, derivedPhrases, exposureGrade, irreversibleBasis, isStub, notifiedCount, workSentence, type ExposureGrade } from './code.js';
import { citationsOf, FINDING_CONTROLS, resolveCitation, type FindingControls } from './controls.js';
import { bypassSummary, confirmationSentence, uncheckedSummary } from './paths.js';

// ---------------------------------------------------------------- links

/** The first call to action: a person at ZIFFER walks through this report with the reader. */
export const BOOK_URL = 'https://cal.com/ziffer/30min';
export const BOOK_TEXT = 'Book a 30-minute review of this report';
/** The second: the same scan, run from the reader’s coding agent. Its anchor is held to the guide's heading by docs-links.test.ts (ACP-464: it pointed at #9 after the guide was renumbered). */
export const MCP_URL = 'https://ziffer.io/docs/developers/sdk#10-the-mcp-assisted-path';
export const MCP_TEXT = 'Scan again from your coding agent with the ZIFFER MCP';
export const TECH_TEXT = 'For your engineers: the technical report below';

/**
 * What ZIFFER changes, in three facts of the product. Each is true once the call is in
 * place and the policy signed, and the first says so: before that, nothing goes through
 * ZIFFER, and the scan does not see whether the application asks anyone today.
 */
export const WHAT_CHANGES = [
  'Once ZIFFER is in place, every tool call that goes through it is checked before it runs.',
  'From then on, actions your signed policy holds wait for a named person to approve them.',
  'From then on, every call ZIFFER lets run gets a signed receipt your auditor can verify.',
] as const;

/**
 * The same three facts as the page's three tiles (ACP-455, third design): a title and one sentence
 * each. The condition is the section's heading ("Once the calls below are in place"), said once
 * above the tiles, so the tiles do not repeat it; `WHAT_CHANGES` keeps it in every sentence for the
 * surfaces that print the facts on their own (the terminal, the page without `--code`).
 */
export const WHAT_CHANGES_TILES = [
  { title: 'Checked before it runs', text: 'Every tool call that passes the door is decided by your signed policy first.' },
  { title: 'A named person approves', text: 'Actions your policy holds wait for that person. Not a click inside the application.' },
  { title: 'A signed receipt', text: 'Every call that runs leaves a record your auditor can verify.' },
] as const;
/** The condition the tiles hold under: the second half of the section's heading. */
export const WHAT_CHANGES_WHEN = 'Once the calls below are in place.';

/**
 * "In plain words", the first block: its heading's second half. The title says TODAY, so the
 * subtitle speaks of today first (these run now with no person in between) and then of what the
 * draft would do (ACP-464). When a row is tagged as something the draft does NOT hold (notice only,
 * no rule), the sentence says the tag is the exception, so it never claims a hold the draft lacks.
 */
export const TODAY_LEDE = 'These actions run today with no person in between; the draft policy would hold each one.';
export const TODAY_LEDE_TAGGED = 'These actions run today with no person in between; the draft policy would hold each one, except where its tag says otherwise.';
export function todayLede(kinds: readonly BulletKind[]): string {
  return kinds.every((k) => k === 'held') ? TODAY_LEDE : TODAY_LEDE_TAGGED;
}

/** The outsider path's three steps, as the three cards name them. */
export const STEER_STEPS = ['1 · someone outside writes', '2 · the model reads it', '3 · the model acts'] as const;
/** The outsider path's lead: the steering sentence's two facts, without the tool names the cards carry. */
export const STEER_LEAD = 'Your model reads text people outside your company can write. Anyone who can write that text can try to steer what the model does next.';
/** Said beside every outsider path: what it is, and what it is not. */
export const STEER_HONEST = 'A path your code allows, read from the tools’ own names and descriptions; not a record that anyone has used it.';

/** The first card: what kind of text, from the words the readers' own names and parameters matched. */
export function steerWrites(words: readonly string[]): string {
  if (words.length === 0) return 'Text people outside your company can write.';
  const a = (w: string): string => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
  return `Text people outside your company can write, such as ${orList(words.map(a))}.`;
}

/** The third card's words around its one example: "Any tool it was given that changes something, such as X." */
export const STEER_ACTS = 'Any tool it was given that changes something';

/** The condition under the cards: which tools one model is given is decided at run time, by the gate the scan found when it found one. */
export function steerCondition(gates: readonly { name: string; at: string }[]): { lead: string; gates: readonly { name: string; at: string }[] } {
  return {
    lead: gates.length === 0 ? 'Whether one model has both depends on the tools your application gives it at run time.' : 'Whether one model has both depends on the tools your application gives it at run time, decided by data in',
    gates,
  };
}

/**
 * Words a sentence in this summary must never carry: a promise ("will",
 * "guaranteed"), an event ("breach", "hacked"), an adversary asserted as
 * present ("attackers are"). The test reads every summary it builds against
 * this list; a percent sign is allowed only in the grade's own sentence.
 */
export const BANNED = ['will', 'breach', 'hacked', 'attackers are', 'guaranteed'] as const;

// ---------------------------------------------------------------- tool names in words

let keywordData: KeywordData | undefined;
function keywords(): KeywordData {
  keywordData ??= parseKeywords(readDataFile('keywords.json'), splitWords);
  return keywordData;
}

/** Every verb the classifier's data knows: a tool name's first known verb is where its action starts. */
function knownVerbs(): Set<string> {
  const k = keywords();
  const all = [...k.effect.irreversible, ...k.effect.write, ...k.effect.read, ...k.read_verbs, ...k.neutral_verbs];
  return new Set(all.filter((w) => w.words.length === 1).map((w) => w.words[0] ?? ''));
}

/** Short words a tool name spells as a word, never an acronym. */
const SHORT_WORDS = new Set(['to', 'my', 'no', 'in', 'on', 'of', 'for', 'add', 'get', 'set', 'run', 'new', 'out', 'off', 'per', 'day', 'and', 'the', 'all', 'by', 'at', 'up', 'id', 'use', 'pay', 'fee', 'tax', 'bed', 'map']);
/** Nouns a tool name uses without an article. */
const UNCOUNTED = new Set(['info', 'data', 'media', 'access', 'wifi', 'content', 'feedback', 'knowledge', 'metadata', 'status', 'history', 'information', 'money', 'availability', 'occupancy']);
const DETERMINERS = new Set(['a', 'an', 'the', 'my', 'no', 'all', 'any', 'this', 'each', 'every', 'one', 'our', 'your']);
const PREPOSITIONS = new Set(['to', 'from', 'on', 'in', 'for', 'by', 'with', 'into', 'of', 'at', 'as']);

/** The name's words: camelCase, snake_case and kebab-case split, as the source spelt them. */
function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '');
}

const isAcronym = (w: string): boolean => /^[a-z]{2,3}$/i.test(w) && !SHORT_WORDS.has(w.toLowerCase());

/**
 * A tool's name as the action it names, in lower-case words: `cancelReservation`
 * reads "cancel a reservation", `deleteGbpPost` "delete a GBP post",
 * `prospector_send_email` "send an email (prospector)". Built from the name
 * alone: it names the tool the reader's own code defines, it claims nothing
 * about what the tool does beyond its name.
 */
export function toolWords(name: string): string {
  const raw = nameTokens(name);
  if (raw.length === 0) return name;
  const verbs = knownVerbs();
  const lower = raw.map((w) => w.toLowerCase());
  // A namespace before the verb (`prospector_send_email`) goes after the action, in parentheses.
  // Only a one-word prefix directly before a known verb: `prospector_bulk_enrich` keeps its order.
  const start = lower.length > 2 && !verbs.has(lower[0] ?? '') && verbs.has(lower[1] ?? '') ? 1 : 0;
  const prefix = raw.slice(0, start);
  const toks = raw.slice(start).map((w) => (isAcronym(w) ? w.toUpperCase() : w.toLowerCase()));
  // An article before the object when the object is one countable thing: "cancel a reservation",
  // "update room prices" (plural), "update access info" (uncounted), "send a message to guest".
  const out = [toks[0] ?? ''];
  const rest = toks.slice(1);
  const objEnd = rest.findIndex((w) => PREPOSITIONS.has(w.toLowerCase()));
  const obj = objEnd < 0 ? rest : rest.slice(0, objEnd);
  const head = obj.at(-1);
  const first = obj[0];
  if (
    verbs.has((toks[0] ?? '').toLowerCase()) &&
    head !== undefined && first !== undefined &&
    !DETERMINERS.has(first.toLowerCase()) &&
    !UNCOUNTED.has(head.toLowerCase()) &&
    !(/[^s]s$/.test(head) && head === head.toLowerCase()) &&
    !/^\d/.test(first)
  ) {
    const an = first === first.toUpperCase() && /^[A-Z]/.test(first) ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/.test(first);
    out.push(an ? 'an' : 'a');
  }
  out.push(...rest);
  const words = out.join(' ');
  return prefix.length === 0 ? words : `${words} (${prefix.map((w) => w.toLowerCase()).join(' ')})`;
}

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1) ?? ''}`;
}

const capital = (s: string): string => (s === '' ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`);

// ---------------------------------------------------------------- the summary's shape

/** Which verdict a bullet's tools carry: the test holds every named tool to it. */
export type BulletKind = 'held' | 'notified' | 'refused';

export interface ExecBullet {
  kind: BulletKind;
  /** The tools the bullet names, by the name the model sees. */
  tools: string[];
  /** The bullet's lead: the actions, in words. */
  lead: string;
  /** What that means today and with ZIFFER. */
  text: string;
  /** The number the bullet prints (`counts.notified` for the notified bullet), when it prints one. */
  count?: number;
  /** How many tools the group holds; `tools` names the first NAMED_PER_BULLET of them. */
  size: number;
}

/** One cell of the MITRE ATLAS / OWASP view: a dossier row and what this scan saw of it. */
export interface HeatCell {
  framework: AtlasRow['framework'];
  id: string;
  name: string;
  /** How many tools this scan counts as evidence for it; undefined when the scan has no rule for it. */
  count: number | undefined;
  /** What was counted, in a reader's words; the reason when not measured. */
  evidence: string;
  /** The tools counted (names), at most all of them; empty when not measured. */
  tools: string[];
  /** 'high': some tool counted cannot be undone or has no rule; 'low': all counted can be undone; 'none': counted zero; 'unmeasured': never coloured. */
  level: 'high' | 'low' | 'none' | 'unmeasured';
  /** The MITRE chapter's own position phrase, verbatim, trailing full stop dropped. */
  position: string;
  /** The chapter's mechanism cell, verbatim (may be empty). */
  mechanism: string;
}

/** A regulation line: one dossier row a finding cites, with its status word verbatim. */
export interface MattersRow {
  framework: string;
  clause: string;
  asks: string;
  status: ControlRef['status'];
  /** `lands in M<n>` when the annex names the milestone, else the status word. */
  status_words: string;
}

export interface ExecSummary {
  /** The one sentence a reader keeps. */
  headline: string;
  /** What the headline's numbers are made of, in one or two sentences. */
  subline: string;
  bullets: ExecBullet[];
  /**
   * What one ZIFFER call at the dispatcher would not see, and the entries with no confirmation
   * check found (ACP-455, 2026-09-28): one line each, present only when the scan found one.
   */
  unseen?: { kind: 'bypass' | 'unchecked'; text: string }[];
  /** The technical part's reply warning, said once here too: present iff the draft holds a tool that carries the model's replies. */
  reply?: string;
  /** Present iff some tool is marked as reading text outsiders can write. `gates` are the run-time gates, each as its name and `file:line`. */
  steering?: { readers: string[]; words: string[]; targets: string[]; gates: { name: string; at: string }[]; text: string };
  /**
   * Present iff a tool that only READS names an access value (`sensitive_value`) and another tool
   * sends data out (`egress`): the pair a manipulated model could chain, named as a path that
   * depends on which tools the model is given, never as a chain that exists.
   */
  leak?: { readers: { tool: string; word: string }[]; senders: string[]; senderCount: number; line: string; text: string };
  matters: MattersRow[];
  heat: HeatCell[];
  /** The line of work ZIFFER asks: "Your team adds one line of code; …". */
  work: string;
  grade?: ExposureGrade;
}

// ---------------------------------------------------------------- the code half

/** The application as a person names it: the package name, else the folder's name. */
export function execName(code: CodeSection): string {
  const n = code.catalog.package_name;
  if (n !== undefined && n !== '') return n;
  const b = basename(code.catalog.root.replace(/[\\/]+$/, ''));
  return b === '' || b === '.' || b === '~' ? 'your application' : b;
}

/**
 * Ranking only (which true example is named first), never grading: a tool whose
 * name says money moves is named before one that does not. The words are the
 * `irreversible_class` 1 keywords of `data/keywords.json` ("sends or pays") and
 * the price words a booking or billing name carries.
 */
const MONEY = ['price', 'discount', 'charge', 'refund', 'pay', 'payment', 'rate', 'invoice', 'balance', 'fee', 'transfer', 'withdraw', 'credit', 'promo'];
function moneyRank(v: CodeToolVerdict): number {
  const w = nameTokens(v.tool.name).map((x) => x.toLowerCase());
  return w.some((x) => MONEY.includes(x) || MONEY.includes(x.replace(/s$/, ''))) ? 0 : 1;
}

const byName = (a: CodeToolVerdict, b: CodeToolVerdict): number => (a.tool.name < b.tool.name ? -1 : a.tool.name > b.tool.name ? 1 : 0);
const rankWithin = (a: CodeToolVerdict, b: CodeToolVerdict): number =>
  moneyRank(a) - moneyRank(b) || (a.egress === b.egress ? 0 : a.egress ? -1 : 1) || byName(a, b);

/** Is the draft's reversibility for this tool a listed IRREVERSIBLE (known), not RV-1's fail-safe for an absent entry (assumed)? */
function knownIrreversible(v: CodeToolVerdict): boolean {
  return irreversibleBasis(v) === 'marked';
}

/** Listed impossible to undo for a reason other than the tool's own words: it runs another tool, or names an access value. */
function derivedIrreversible(v: CodeToolVerdict): boolean {
  const b = irreversibleBasis(v);
  return b === 'runs_another' || b === 'access_value';
}

/** Said once above the bullets: what the scan can and cannot say about today, before any verdict. */
export const TODAY_INTRO = 'Today each of these runs when the model calls it, unless a check in your application asks a person first.';
/** Said after it when a bullet is a held one: what the badge means. */
export const HELD_INTRO = 'Once ZIFFER is in place, under the draft policy, a named person approves each one marked ZIFFER HOLDS before it runs.';

/** The intro a summary prints above its bullets. */
export function todayIntro(s: Pick<ExecSummary, 'bullets'>): string {
  return s.bullets.some((b) => b.kind === 'held') ? `${TODAY_INTRO} ${HELD_INTRO}` : TODAY_INTRO;
}

/** How many tools a bullet names; the rest are "among others". */
export const NAMED_PER_BULLET = 3;
export const MAX_BULLETS = 5;

function named(list: readonly CodeToolVerdict[]): { tools: string[]; lead: string; size: number } {
  const shown = list.slice(0, NAMED_PER_BULLET);
  const more = list.length > shown.length ? ', among others' : '';
  return { tools: shown.map((v) => v.tool.name), lead: `${capital(orList(shown.map((v) => toolWords(v.tool.name))))}${more}`, size: list.length };
}

/**
 * The bullets, in the order a reader should fear them: held tools the draft
 * knows cannot be undone (runs or destroys, then changes shared state, then
 * sends or pays), held tools nothing says can be undone, tools that run after
 * a notice with nobody asked, tools the draft has no rule for, the other held
 * tools. At most MAX_BULLETS; a group with no tool prints nothing.
 */
/** "Held because each runs another tool: closeProperty runs createGbpPost; runWorkflow runs a tool chosen at run time." */
function runsAnotherText(list: readonly CodeToolVerdict[]): string {
  const shown = list.slice(0, NAMED_PER_BULLET);
  const each = shown.map((v) => `${v.tool.name} runs ${v.raised_by === '*' ? 'a tool chosen at run time' : (v.raised_by ?? '')}`);
  return `Held because ${shown.length === 1 ? 'it runs another tool' : 'each runs another tool'}, and the draft grades ${shown.length === 1 ? 'it' : 'each'} as strictly as the tool it runs: ${each.join('; ')}.`;
}

/** "Held because its name or parameters name an access value or a secret (name says "access info")." */
function accessText(list: readonly CodeToolVerdict[]): string {
  const shown = list.slice(0, NAMED_PER_BULLET);
  const said = [...new Set(shown.flatMap((v) => accessSegments(v)))];
  return `Held because ${shown.length === 1 ? 'its' : 'their'} name or parameters name an access value or a secret (${said.join('; ')}).`;
}

/**
 * A bullet's fact for tools the draft lists as irreversible. The basis is a word in the tool's
 * name or description, so the sentence says so and asks for a check: the table says "check
 * the reading", and the summary must not be more certain than the table.
 */
export const MARKED_IRREVERSIBLE = 'Marked as impossible to undo by their name or description; confirm.';

export function codeBullets(code: CodeSection): ExecBullet[] {
  // A tool whose description says it is a stub is declared, not wired: never named as something a model can do.
  const v = code.verdicts.filter((x) => !isStub(x));
  const attest = v.filter((x) => x.verdict.verdict === 'ATTEST');
  const known = attest.filter(knownIrreversible);
  const cls = (n: number): CodeToolVerdict[] => known.filter((x) => (x.irreversible_class ?? 0) === n).sort(rankWithin);
  const out: ExecBullet[] = [];
  const held = (list: CodeToolVerdict[], fact: string): void => {
    if (list.length === 0) return;
    out.push({ kind: 'held', ...named(list), text: fact });
  };
  held(cls(3), MARKED_IRREVERSIBLE);
  held(cls(2), MARKED_IRREVERSIBLE);
  held(cls(1), MARKED_IRREVERSIBLE);
  held(cls(0), MARKED_IRREVERSIBLE);
  // Held for a reason other than their own words about undoing: each bullet says which reason, from the data.
  const runs = attest.filter((x) => irreversibleBasis(x) === 'runs_another').sort(rankWithin);
  held(runs, runsAnotherText(runs));
  const access = attest.filter((x) => irreversibleBasis(x) === 'access_value').sort(rankWithin);
  held(access, accessText(access));
  held(
    attest.filter((x) => x.verdict.verdict !== 'REFUSED' && x.verdict.reversibility === 'IRREVERSIBLE' && !knownIrreversible(x) && !derivedIrreversible(x)).sort(rankWithin),
    'Nothing in their name or description says these can be undone.',
  );

  const notified = v.filter((x) => x.verdict.verdict === 'ALLOW' && x.verdict.reversibility === 'IRREVERSIBLE').sort(rankWithin);
  if (notified.length > 0) {
    const n = named(notified);
    // The draft's count, less the stubs: what the draft policy does, never a claim about the application today.
    const count = Math.max(notified.length, notifiedCount(code) - code.verdicts.filter((x) => isStub(x) && x.verdict.verdict === 'ALLOW' && x.verdict.reversibility === 'IRREVERSIBLE').length);
    out.push({
      kind: 'notified',
      ...n,
      count,
      text:
        `Under the draft policy, ${count === 1 ? '1 action the engine treats as impossible to undo runs' : `${count} actions the engine treats as impossible to undo run`} after a notice, ` +
        'with no ZIFFER approval, until their rules are raised.',
    });
  }
  const refused = v.filter((x) => x.verdict.verdict === 'REFUSED').sort(rankWithin);
  if (refused.length > 0) {
    out.push({
      kind: 'refused',
      ...named(refused),
      text: 'The draft policy has no rule for these yet; under ZIFFER they cannot run until one is written.',
    });
  }
  held(attest.filter((x) => x.verdict.verdict === 'ATTEST' && x.verdict.reversibility !== 'IRREVERSIBLE').sort(rankWithin), 'The engine grades these HIGH risk.');
  return out.slice(0, MAX_BULLETS);
}

/** The irreversible tools a steering sentence names as where an outsider could push the model: the bullets' own order. */
function steerTargets(code: CodeSection): string[] {
  return codeBullets(code)
    .filter((b) => b.kind === 'held' || b.kind === 'notified')
    .flatMap((b) => b.tools)
    .filter((name) => code.verdicts.some((x) => x.tool.name === name && x.verdict.verdict !== 'REFUSED' && x.verdict.reversibility === 'IRREVERSIBLE'))
    .slice(0, NAMED_PER_BULLET);
}

/**
 * A description that says the tool returns ONLY counts or statistics. Narrow on purpose: a
 * description that lists counts beside message previews ("Returns conversation IDs, contact
 * names, last-message previews, unread counts") still returns outsiders' text.
 */
const COUNT_DESCRIPTION = /\b(?:gets?|returns?)\s+only\s+(?:the\s+)?(?:counts?|statistics|totals|numbers)\b/i;

/** Whether the tool's name or description says it returns only numbers about text (counts, statistics). */
export function returnsOnlyCounts(v: CodeToolVerdict): boolean {
  // The name words are `keywords.json`'s `counts_not_text`, the one list the pairs read too.
  return countsWord(v.tool.name) !== undefined || COUNT_DESCRIPTION.test(v.tool.description);
}

/**
 * Name words of a tool that returns the text itself, written by people outside the company:
 * a conversation thread, reviews, messages. Such a tool is named first in the steering box.
 */
const TEXT_WORDS = new Set(['thread', 'threads', 'review', 'reviews', 'message', 'messages', 'comment', 'comments', 'reply', 'replies', 'email', 'emails']);
function returnsOutsiderText(v: CodeToolVerdict): boolean {
  return nameTokens(v.tool.name).some((w) => TEXT_WORDS.has(w.toLowerCase()));
}

/**
 * A tool counted as reading outsider text: the engine graded it a read, the word is in its
 * own NAME or a PARAMETER name, and it does not return only counts. A mention in a description
 * is not evidence (a tool that SENDS a message mentions one): the first count was 20 tools on
 * the first customer's application, most of them senders and writers.
 */
export function readsOutsiderText(v: CodeToolVerdict): boolean {
  if (!v.untrusted_input || v.verdict.verdict === 'REFUSED' || v.verdict.reversibility !== 'REVERSIBLE') return false;
  if (returnsOnlyCounts(v)) return false;
  const own = [v.tool.name, ...v.tool.params].join(' ').toLowerCase();
  return (v.untrusted_words ?? []).some((w) => own.includes(w.toLowerCase()));
}

/**
 * The outsider path, iff some verdict reads outsider text. Tools whose name says they return
 * the text itself come first (a thread, reviews, messages), then the rest, most keywords
 * first. It names a PATH: whether the model that reads the text can also call a tool that
 * changes something depends on which tools the application gives it, and the sentence says
 * that rather than claiming the chain.
 */
export function codeSteering(code: CodeSection): ExecSummary['steering'] {
  const marked = code.verdicts.filter((v) => !isStub(v) && readsOutsiderText(v));
  if (marked.length === 0) return undefined;
  const text = (v: CodeToolVerdict): number => (returnsOutsiderText(v) ? 0 : 1);
  const readers = [...marked]
    .sort((a, b) => text(a) - text(b) || (b.untrusted_words?.length ?? 0) - (a.untrusted_words?.length ?? 0) || byName(a, b))
    .slice(0, NAMED_PER_BULLET);
  // Only the words the named tools' own names or parameters carry: "web" and "email" came from
  // descriptions and named nothing the sentence shows.
  const own = (v: CodeToolVerdict): string => [v.tool.name, ...v.tool.params].join(' ').toLowerCase();
  const words = [...new Set(readers.flatMap((v) => (v.untrusted_words ?? []).filter((w) => own(v).includes(w.toLowerCase()))))];
  const targets = steerTargets(code).filter((t) => !readers.some((r) => r.tool.name === t));
  const through = andList(readers.map((v) => v.tool.name));
  const gates = gateNames(code);
  const reach = orList(targets.map(toolWords));
  const chain =
    targets.length === 0
      ? ''
      : gates.length > 0
        ? ` Whether the same model can also call a tool that changes something, such as ${reach}, depends on which tools your application gives it at run time, ` +
          `which the scan found is decided by data in ${andList(gates)}. If both are given to the same model, that text could push it toward them.`
        : ` If the same model can also call ${reach}, that text could push it toward them.`;
  return {
    readers: readers.map((v) => v.tool.name),
    words,
    targets,
    gates: code.catalog.gates.map((g) => ({ name: g.name, at: `${basename(g.at.file)}:${g.at.line}` })),
    text:
      `Your model reads text people outside your company can write${words.length === 0 ? '' : ` (${words.join(', ')})`} through ${through}. ` +
      `Anyone who can write that text can try to steer what the model does next.${chain}`,
  };
}

/** The run-time gates as a sentence names them: `getToolsForLocation (api/src/tool-registry.ts:102)`. */
function gateNames(code: CodeSection): string[] {
  return code.catalog.gates.map((g) => `${g.name} (${where(g.at)})`);
}

/** A live tool the draft reads as a read (listed as one that can be undone) whose name or parameters name an access value. */
function readsAccessValue(v: CodeToolVerdict): boolean {
  return v.sensitive_value !== undefined && !isStub(v) && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'REVERSIBLE';
}

/**
 * The data-leaving path (ACP-455, second review): "getAccessInfo returns access info;
 * sendEmail sends data out. If both are given to the same model, a manipulated model can send
 * one through the other." From `sensitive_value` on a READ and `egress` on another tool; the
 * run-time gates, when the scan found one, are named as what decides whether both are given.
 */
export function codeLeak(code: CodeSection): ExecSummary['leak'] {
  const readers = code.verdicts.filter(readsAccessValue).sort(byName);
  const senders = code.verdicts.filter((v) => v.egress && !isStub(v) && !readers.includes(v)).sort(rankWithin);
  if (readers.length === 0 || senders.length === 0) return undefined;
  const shownReaders = readers.slice(0, NAMED_PER_BULLET);
  const shownSenders = senders.slice(0, NAMED_PER_BULLET);
  const r = shownReaders.map((v) => `${v.tool.name} returns ${v.sensitive_value ?? ''}`);
  const others = readers.length - shownReaders.length;
  const senderNames = andList(shownSenders.map((v) => v.tool.name));
  const sends =
    senders.length > shownSenders.length
      ? `${senders.length} tools send data out, among them ${senderNames}`
      : `${senderNames} ${senders.length === 1 ? 'sends' : 'send'} data out`;
  const gates = gateNames(code);
  const decided = gates.length === 0 ? '' : ` Which tools a model is given is decided at run time by ${andList(gates)}.`;
  const line = `${andList(r)}${others > 0 ? `, and ${others} more ${others === 1 ? 'tool returns' : 'tools return'} an access value` : ''}; ${sends}.`;
  return {
    readers: shownReaders.map((v) => ({ tool: v.tool.name, word: v.sensitive_value ?? '' })),
    senders: shownSenders.map((v) => v.tool.name),
    senderCount: senders.length,
    line,
    text: `${line}${decided} If both are given to the same model, a manipulated model can send one through the other.`,
  };
}

// ---------------------------------------------------------------- why it matters

/** The frameworks an auditor of a European company asks about first, in the order printed. */
export const MATTERS_FRAMEWORKS = ['EU AI Act', 'NIS2', 'DORA'] as const;

/** Said first in the block: the rows are what could apply, and which do is the reader's sector's question. */
export const MATTERS_INTRO = 'Which of these bind you depends on your sector and, for the EU AI Act, on what your system is used for.';

/**
 * The statuses the executive block shows: what ZIFFER has built or partly built. A row the
 * dossier marks "not checked", "not covered", "lands in" or a customer obligation is left out
 * of the executive block (the technical findings still print every status, verbatim).
 */
export const MATTERS_STATUSES: readonly ControlRef['status'][] = ['built', 'partial'];

/** The dossier rows the present finding kinds cite, for the frameworks above, statuses verbatim, built or partial only, excluded rows left out. */
export function mattersRows(kinds: readonly Finding['kind'][], mapping: FindingControls = FINDING_CONTROLS, source: AnnexSource = ANNEX): MattersRow[] {
  const out: MattersRow[] = [];
  const seen = new Set<string>();
  for (const f of MATTERS_FRAMEWORKS) {
    for (const kind of kinds) {
      for (const c of citationsOf(kind, mapping)) {
        if (c.framework !== f || seen.has(`${c.framework}\u0000${c.clause}`)) continue;
        const ref = resolveCitation(c, mapping, source);
        const row = findAnnexRow(source, c.framework, c.clause);
        if (typeof ref === 'string' || row === undefined || !MATTERS_STATUSES.includes(ref.status)) continue;
        seen.add(`${c.framework}\u0000${c.clause}`);
        out.push({
          framework: c.framework,
          clause: c.clause,
          asks: row.asks.replace(/\*\*/g, ''),
          status: ref.status,
          status_words: ref.status === 'lands in' && row.milestone !== null ? `lands in ${row.milestone}` : ref.status,
        });
      }
    }
  }
  return out;
}

/** The finding kinds a code section carries evidence for, by the same words the MCP findings use. */
export function codeKinds(code: CodeSection): Finding['kind'][] {
  const v = code.verdicts;
  const kinds: Finding['kind'][] = [];
  if (code.counts.irreversible > 0) kinds.push('irreversible');
  if (v.some((x) => x.untrusted_input) && code.counts.irreversible > 0) kinds.push('pair');
  if (v.some((x) => x.egress)) kinds.push('egress');
  if (code.counts.refused > 0 || v.some((x) => x.draft_reason?.includes('drafted as a write, confirm') === true)) kinds.push('unclassified');
  return kinds;
}

// ---------------------------------------------------------------- the ATLAS view

/**
 * The techniques shown: those about a model that calls tools, and only those.
 * Each is looked up in the dossier's MITRE chapter by id; one the chapter does
 * not carry is dropped, never typed here. The whole matrix is never drawn: a
 * grid of mostly grey cells reads as "mostly fine".
 *
 * OWASP: only Excessive Agency, whose id, title and edition are `owasp.ts`'s. The dossier also
 * carries a "Tool autonomy" row under an OWASP number; no edition of the list has that entry (in
 * the 2026 edition the number names Hidden Context Exposure), so it is not shown, and no row is
 * added from another list.
 */
export const HEAT_TECHNIQUES: readonly { framework: AtlasRow['framework']; id: string }[] = [
  { framework: 'MITRE ATLAS', id: 'AML.T0051.001' },
  { framework: OWASP_FRAMEWORK, id: OWASP_EXCESSIVE_AGENCY.dossierId },
  { framework: 'MITRE ATLAS', id: 'AML.T0086' },
  { framework: 'MITRE ATLAS', id: 'AML.T0110' },
  { framework: 'MITRE ATLAS', id: 'AML.T0051' },
];

/** What the scan counts for each technique; undefined: no evidence rule, the cell says so and stays grey. */
export interface HeatEvidence {
  /** Tools counted and whether each one is "high" (cannot be undone, or no rule); `count` overrides the list's length when a field carries it. */
  [id: string]: { count: number; tools: { name: string; high: boolean }[]; evidence: string } | { unmeasured: string };
}

function heatCells(evidence: HeatEvidence, source: AnnexSource): HeatCell[] {
  const out: HeatCell[] = [];
  for (const t of HEAT_TECHNIQUES) {
    const row = findAtlasRow(source, t.framework, t.id);
    if (row === undefined) continue;
    const e = evidence[t.id];
    const base = { framework: row.framework, id: row.id, name: row.name, position: row.position_label.replace(/\.$/, ''), mechanism: row.mechanism };
    if (e === undefined || 'unmeasured' in e) {
      out.push({ ...base, count: undefined, evidence: e === undefined ? 'the scan has no evidence rule for it' : e.unmeasured, tools: [], level: 'unmeasured' });
      continue;
    }
    const level = e.count === 0 ? 'none' : e.tools.some((x) => x.high) ? 'high' : 'low';
    out.push({ ...base, count: e.count, evidence: e.evidence, tools: e.tools.map((x) => x.name), level });
  }
  return out;
}

const highVerdict = (v: CodeToolVerdict): boolean => v.verdict.verdict === 'REFUSED' || v.verdict.reversibility === 'IRREVERSIBLE';

/** The code half's evidence per technique, from the verdicts and the counts only. */
export function codeEvidence(code: CodeSection, installed: ScanResult | undefined): HeatEvidence {
  const v = code.verdicts;
  const list = (xs: readonly CodeToolVerdict[]): { name: string; high: boolean }[] => xs.map((x) => ({ name: x.tool.name, high: highVerdict(x) }));
  // Stubs left out, as the headline, the grade and the steering box leave them out: one count per thing.
  const untrusted = v.filter((x) => !isStub(x) && readsOutsiderText(x));
  const egress = v.filter((x) => !isStub(x) && x.egress);
  const irreversible = v.filter((x) => !isStub(x) && x.verdict.verdict !== 'REFUSED' && x.verdict.reversibility === 'IRREVERSIBLE');
  const leakReaders = egress.length > 0 ? v.filter(readsAccessValue) : [];
  const g = exposureGrade(code);
  return {
    'AML.T0051.001': { count: untrusted.length, tools: list(untrusted), evidence: 'tools that read, and whose own name or parameters say the text comes from outside' },
    [OWASP_EXCESSIVE_AGENCY.dossierId]: {
      count: g === undefined ? 0 : g.known + g.derived + g.unlisted,
      tools: list(irreversible),
      evidence:
        g === undefined
          ? 'tools the engine treats as impossible to undo'
          : `tools the engine treats as impossible to undo: ${g.known} marked so by their own name or description, ` +
            `${derivedPhrases(g).map((p) => `${p.replace(/^(\d+) (?:is|are) treated as impossible to undo /, '$1 ')}, `).join('')}${g.unlisted} because nothing says they can be undone` +
            `${g.stubs > 0 ? `; the ${g.stubs} whose description says stub are left out` : ''}`,
    },
    'AML.T0086': {
      count: egress.length,
      tools: list(egress),
      evidence:
        'tools the draft marks as sending data out of the application' +
        (leakReaders.length === 0 ? '' : `; ${andList(leakReaders.map((x) => x.tool.name))} ${leakReaders.length === 1 ? 'returns' : 'return'} an access value one of them could send`),
    },
    'AML.T0110': installed === undefined
      ? { unmeasured: 'your own code defines these tools; the installed-tools half reads third-party tool descriptions' }
      : poisonedEvidence(installed),
    'AML.T0051': { unmeasured: 'who can type to the model is decided outside the code it reads' },
  };
}

function poisonedEvidence(result: ScanResult): HeatEvidence[string] {
  const tools = [...new Set(result.findings.filter((f) => f.kind === 'poisoned').flatMap((f) => f.tools))];
  return { count: tools.length, tools: tools.map((name) => ({ name, high: true })), evidence: 'installed tools whose description carries instructions to the model' };
}

// ---------------------------------------------------------------- assembly: code

/**
 * The headline (ACP-455, second review 2026-09-28), one builder for the page, the terminal and
 * the MCP server: "A model in X can call 67 live tools (16 more are stubs). 13 cannot be undone,
 * by their own name or description or by what they run. 25 write and say nothing about undoing
 * it. 29 only read." Every number is a grade field, and the clauses add up to the live tools:
 * `known + derived` + `unlisted` + `reads` (+ `refused`, said only when there is one) = `tools`.
 * The grade box says the same totals with the reasons apart (`gradeSentence`).
 */
export function codeHeadline(name: string, g: ExposureGrade): string {
  return codeHeadlineSentences(name, g).join(' ');
}

/**
 * The first screen's headline (ACP-455 presentation, 2026-09-28): the builder's first two
 * sentences, verbatim, so the large type says at most two things. The rest of the builder's
 * sentences are printed under "What a model can do today"; nothing is reworded.
 */
export function codeHeadlineLead(code: CodeSection): string {
  const g = exposureGrade(code);
  return g === undefined ? `The scan found no tool that ${execName(code)} gives a model.` : codeHeadlineSentences(execName(code), g).slice(0, 2).join(' ');
}

/** The builder's sentences after the first two; empty when there are none. */
export function codeHeadlineRest(code: CodeSection): string {
  const g = exposureGrade(code);
  return g === undefined ? '' : codeHeadlineSentences(execName(code), g).slice(2).join(' ');
}

/**
 * The first screen's headline in the approved design's shape (ACP-455 presentation, second design,
 * 2026-09-28): two short sentences in large type, the second the one to act on ("13 of them cannot
 * be undone."), and the builder's qualifiers in the lede right under them, in the builder's words:
 * how the 13 were read, the other clauses verbatim, and the stubs left out. The same numbers as
 * `codeHeadlineSentences`, from the same grade fields; nothing is counted here.
 */
export function codeHeadlineScreen(code: CodeSection): { lead: string; act: string; rest: string[] } {
  const g = exposureGrade(code);
  const name = execName(code);
  if (g === undefined) return { lead: `The scan found no tool that ${name} gives a model.`, act: '', rest: [] };
  const lead = `A model in ${name} can call ${g.tools} live ${g.tools === 1 ? 'tool' : 'tools'}.`;
  const cannot = g.known + g.derived;
  const all = codeHeadlineSentences(name, g).slice(1);
  // Worded so it cannot be read as the door's held count (ACP-464): these are further tools, outside the live count.
  const stubs = g.stubs > 0 ? [`${g.stubs} further ${g.stubs === 1 ? 'tool is' : 'tools are'} declared and not wired yet; ${g.stubs === 1 ? 'it is' : 'they are'} not among the ${g.tools}.`] : [];
  if (cannot === 0) {
    const [act = '', ...rest] = all;
    return { lead, act, rest: [...rest, ...stubs] };
  }
  const own = cannot === 1 ? 'its own name or description' : 'their own name or description';
  const by = [
    ...(g.known > 0 ? [`by ${own}`] : []),
    ...(g.runsAnother > 0 ? [`by what ${cannot === 1 ? 'it runs' : 'they run'}`] : []),
    ...(g.accessValue > 0 ? [`because ${cannot === 1 ? 'it writes' : 'they write'} an access value`] : []),
  ];
  const how = `Marked so ${by.length <= 1 ? by.join('') : `${by.slice(0, -1).join(', ')}, or ${by.at(-1) ?? ''}`}.`;
  return { lead, act: `${cannot} of them cannot be undone.`, rest: [how, ...all.slice(1), ...stubs] };
}

/** The headline, sentence by sentence. */
export function codeHeadlineSentences(name: string, g: ExposureGrade): string[] {
  const one = (n: number, singular: string, many: string): string => `${n} ${n === 1 ? singular : many}`;
  const live = `A model in ${name} can call ${g.tools} live ${g.tools === 1 ? 'tool' : 'tools'}` +
    (g.stubs > 0 ? ` (${g.stubs} more ${g.stubs === 1 ? 'is a stub' : 'are stubs'}).` : '.');
  const cannot = g.known + g.derived;
  const own = cannot === 1 ? 'its own name or description' : 'their own name or description';
  const by = [
    ...(g.known > 0 ? [`by ${own}`] : []),
    ...(g.runsAnother > 0 ? [`by what ${cannot === 1 ? 'it runs' : 'they run'}`] : []),
    ...(g.accessValue > 0 ? [`because ${cannot === 1 ? 'it writes' : 'they write'} an access value`] : []),
  ];
  const sentences = [
    ...(cannot > 0 ? [`${cannot} cannot be undone, ${by.length <= 1 ? by.join('') : `${by.slice(0, -1).join(', ')}, or ${by.at(-1) ?? ''}`}.`] : []),
    ...(g.unlisted > 0 ? [`${one(g.unlisted, 'writes and says', 'write and say')} nothing about undoing it.`] : []),
    ...(g.refused > 0 ? [`${one(g.refused, 'has', 'have')} no rule in the draft policy, so the engine refuses ${g.refused === 1 ? 'it' : 'them'}.`] : []),
    ...(g.reads > 0 ? [`${one(g.reads, 'only reads', 'only read')}.`] : []),
  ];
  return [live, ...sentences];
}

/** The headline of a code section, or the sentence for an application that defines no tool: what every surface prints. */
export function codeHeadlineOf(code: CodeSection): string {
  const g = exposureGrade(code);
  return g === undefined ? `The scan found no tool that ${execName(code)} gives a model.` : codeHeadline(execName(code), g);
}

export function codeExecSummary(code: CodeSection, result: ScanResult, source: AnnexSource = ANNEX): ExecSummary {
  const c = code.counts;
  const g = exposureGrade(code);
  const name = execName(code);
  let headline: string;
  let subline: string;
  if (g === undefined) {
    headline = `The scan found no tool that ${name} gives a model.`;
    subline = 'Nothing below is about your own code; the numbers come from what the scan could read.';
  } else {
    headline = codeHeadline(name, g);
    // What the scan read about asking a person (the confirmation checks before each call to the
    // dispatcher, counted from `caller_checks`), and what it cannot read: whether anyone answered.
    subline = confirmationSentence(code);
  }
  const steering = codeSteering(code);
  const leak = codeLeak(code);
  const reply = heldReplyWarning(code.verdicts.filter((x) => !isStub(x) && x.verdict.verdict === 'ATTEST'));
  const bypass = bypassSummary(code);
  const unchecked = uncheckedSummary(code);
  const unseen = [
    ...(bypass === undefined ? [] : [{ kind: 'bypass' as const, text: bypass }]),
    ...(unchecked === undefined ? [] : [{ kind: 'unchecked' as const, text: unchecked }]),
  ];
  const installed = result.scope?.installed === true || (result.catalog.length > 0) ? result : undefined;
  return {
    headline,
    subline,
    bullets: codeBullets(code),
    ...(unseen.length === 0 ? {} : { unseen }),
    ...(reply === undefined ? {} : { reply }),
    ...(steering === undefined ? {} : { steering }),
    ...(leak === undefined ? {} : { leak }),
    matters: mattersRows(codeKinds(code), FINDING_CONTROLS, source),
    heat: heatCells(codeEvidence(code, installed), source),
    work: workSentence(code),
    ...(g === undefined ? {} : { grade: g }),
  };
}

// ---------------------------------------------------------------- assembly: installed tools only

/** An installed tool's class from the draft's matched irreversible keywords (`irreversible_class`). */
function draftClass(c: Classification): number {
  if (c.effect !== 'irreversible') return 0;
  const table = keywords().irreversible_class;
  let best = 0;
  for (const m of c.matched) if (m.startsWith('effect.irreversible:')) best = Math.max(best, table[m.slice('effect.irreversible:'.length)] ?? 0);
  return best;
}

/** A pair finding's reading side and acting side (`readers`/`actors`, read structurally), else split by the drafts. */
function pairSides(f: Finding, result: ScanResult): { readers: string[]; actors: string[] } {
  const r: unknown = Reflect.get(f, 'readers');
  const a: unknown = Reflect.get(f, 'actors');
  const strings = (x: unknown): string[] | undefined => (Array.isArray(x) && x.every((y): y is string => typeof y === 'string') ? x : undefined);
  const readers = strings(r);
  const actors = strings(a);
  if (readers !== undefined && actors !== undefined) return { readers, actors };
  const reads = (t: string): boolean => result.classifications.some((c) => c.tool === t && c.untrusted_input && (f.client === undefined || c.client === f.client));
  return { readers: f.tools.filter(reads), actors: f.tools.filter((t) => !reads(t)) };
}

/**
 * The same summary for a run that read only the tools installed in the AI
 * assistants: no engine verdict per tool, so every sentence says "the draft",
 * and the steering path is the pair findings' own reader and actor sides.
 */
export function mcpExecSummary(result: ScanResult, n: { tools: number; irreversible: number }, source: AnnexSource = ANNEX): ExecSummary {
  const seen = new Set<string>();
  const irr = result.classifications
    .filter((c) => c.effect === 'irreversible')
    .filter((c) => {
      const k = `${c.server}\u0000${c.tool}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => draftClass(b) - draftClass(a) || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
  const headline =
    n.tools === 0
      ? 'The scan found no tool the AI assistants on this machine can call.'
      : n.irreversible > 0
        ? `The AI assistants on this machine can call ${n.tools} ${n.tools === 1 ? 'tool' : 'tools'}; ${n.irreversible} of them ${n.irreversible === 1 ? 'is' : 'are'} marked as impossible to undo by ${n.irreversible === 1 ? 'its' : 'their'} name or description; confirm.`
        : `The AI assistants on this machine can call ${n.tools} ${n.tools === 1 ? 'tool' : 'tools'}; the draft reads none of them as impossible to undo.`;
  const bullets: ExecBullet[] = [];
  for (const cls of [3, 2, 1, 0]) {
    const list = irr.filter((c) => draftClass(c) === cls);
    if (list.length === 0) continue;
    const shown = list.slice(0, NAMED_PER_BULLET);
    bullets.push({
      kind: 'held',
      tools: shown.map((c) => c.tool),
      lead: `${capital(orList(shown.map((c) => toolWords(c.tool))))}${list.length > shown.length ? ', among others' : ''}`,
      size: list.length,
      text: 'The draft reads these as impossible to undo.',
    });
  }
  const pairs = result.findings.filter((f) => f.kind === 'pair');
  let steering: ExecSummary['steering'];
  if (pairs.length > 0) {
    const readers = [...new Set(pairs.flatMap((f) => pairSides(f, result).readers))].slice(0, NAMED_PER_BULLET);
    const targets = [...new Set(pairs.flatMap((f) => pairSides(f, result).actors))].slice(0, NAMED_PER_BULLET);
    steering = {
      readers,
      words: [],
      targets,
      gates: [],
      text:
        `Your AI assistants read text people outside your company can write through ${andList(readers)}. ` +
        `Anyone who can write that text can try to steer an assistant to ${orList(targets.map(toolWords))}.`,
    };
  }
  const kinds = [...new Set(result.findings.map((f) => f.kind))];
  const ev = (xs: readonly Classification[]): { name: string; high: boolean }[] => {
    const s = new Set<string>();
    return xs.filter((c) => (s.has(`${c.server}\u0000${c.tool}`) ? false : (s.add(`${c.server}\u0000${c.tool}`), true))).map((c) => ({ name: c.tool, high: c.effect === 'irreversible' }));
  };
  const untrusted = ev(result.classifications.filter((c) => c.untrusted_input));
  const egress = ev(result.classifications.filter((c) => c.egress));
  const evidence: HeatEvidence = {
    'AML.T0051.001': { count: untrusted.length, tools: untrusted, evidence: 'installed tools the draft marks as reading text outsiders can write' },
    [OWASP_EXCESSIVE_AGENCY.dossierId]: { count: n.irreversible, tools: irr.map((c) => ({ name: c.tool, high: true })), evidence: 'installed tools the draft reads as impossible to undo from their name or description' },
    'AML.T0086': { count: egress.length, tools: egress, evidence: 'installed tools the draft marks as sending data out' },
    'AML.T0110': poisonedEvidence(result),
    'AML.T0051': { unmeasured: 'who can type to the assistant is decided outside what it reads' },
  };
  return {
    headline,
    subline: 'Read from the tools configured in the AI assistants on this machine; each class is a draft from the tool’s name and description.',
    bullets: bullets.slice(0, MAX_BULLETS),
    ...(steering === undefined ? {} : { steering }),
    matters: mattersRows(kinds, FINDING_CONTROLS, source),
    heat: heatCells(evidence, source),
    work: 'Your team adds the ZIFFER MCP server to the assistants; the policy is drafted from this scan.',
  };
}

// ---------------------------------------------------------------- the whole text, for the truth test

/** Every sentence a summary prints, in order: what the banned-word test reads. */
export function execSentences(s: ExecSummary): string[] {
  return [
    s.headline,
    s.subline,
    ...(s.bullets.length > 0 ? [todayIntro(s)] : []),
    ...s.bullets.flatMap((b) => [b.lead, b.text]),
    ...(s.unseen ?? []).map((u) => u.text),
    ...(s.reply === undefined ? [] : [s.reply]),
    ...(s.steering === undefined ? [] : [s.steering.text]),
    ...(s.leak === undefined ? [] : [s.leak.text]),
    ...s.matters.map((m) => `${m.framework} ${m.clause}: ${m.asks} (${m.status_words})`),
    ...s.heat.map((h) => `${h.id} ${h.name}: ${h.evidence}`),
    ...WHAT_CHANGES,
    s.work,
    BOOK_TEXT,
    MCP_TEXT,
    TECH_TEXT,
  ];
}
