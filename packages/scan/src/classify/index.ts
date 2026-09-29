/**
 * The draft classifier: from a tool's name, description and parameter names,
 * a DRAFT of what it does, read through the heuristics in `data/`.
 *
 * This produces a draft the engine then grades. It is never the engine's
 * opinion: there is no risk level, no floor and no grade anywhere in this
 * module. Risk comes from the engine's own grading over the policy generated
 * from this draft, which is another module's job.
 *
 * A tool matching no effect keyword is drafted as a `write` (ACP-455), with a
 * reason saying so, and is ALSO reported as a finding of kind `unclassified`.
 * Until 0.3.0 it got no classification entry at all, so the draft gave it no
 * risk function and the engine refused it at 8.4-3: true of the draft, and
 * useless to the reader -- on a real application (the OpenAI Agents SDK's own
 * examples) 197 of 352 tools read "refused", and the proposed policy had no rule
 * for a person to confirm. `write` is the conservative draft (unknown is never
 * LOW, P-4): the engine still grades it, and the person confirms or corrects a
 * rule instead of discovering a hole. This is a DRAFT's default, not a second
 * fail-safe: the engine's own rules (absent from reversibility.json is
 * IRREVERSIBLE) are untouched and still apply when the policy is graded.
 *
 * This scans TOOL METADATA a server publishes, not model output. The
 * no-model-side-defences rule (ZIFFER-SPEC-001 §5.1a) is about model output and
 * is not touched here.
 *
 * Pure and synchronous: the only I/O is reading the three data files once, at
 * module load. Nothing leaves the machine.
 */

import { redactText } from '../redact/index.js';
import type { CatalogTool, Classification, Finding, InstructionHit } from '../types.js';
import {
  parseKeywords,
  parsePairs,
  parsePoisoned,
  readDataFile,
  type Effect,
  type Keyword,
  type KeywordData,
  type PairRule,
  type PairSide,
  type PoisonRule,
} from './data.js';
import { headPhrase, sentencePhrase } from './sentence.js';
import { cannotBeUndone, descriptionPhrases, inverseHints, secretNamed } from './undo.js';
import { matchesKeyword, words } from './words.js';

export { ClassifyDataInvalid } from './data.js';
import type { UndoHint } from '../code/types.js';

const KEYWORDS: KeywordData = parseKeywords(readDataFile('keywords.json'), words);
const PAIRS: PairRule[] = parsePairs(readDataFile('pairs.json'), words);
const POISONED: PoisonRule[] = parsePoisoned(readDataFile('poisoned.json'));

/** The rule ids shipped, so a test or a report can name them without re-reading the files. */
export const PAIR_IDS: readonly string[] = PAIRS.map((p) => p.id);
export const POISONED_IDS: readonly string[] = POISONED.map((p) => p.id);

export interface ClassifyOutput {
  /** One entry per catalog tool, in catalog order: a tool no keyword classified is drafted as a write. */
  classifications: Classification[];
  findings: Finding[];
}

interface Drafted {
  entry: CatalogTool;
  classification: Classification;
}

function toolText(t: CatalogTool): string[] {
  // An empty word between fields, so a two-word keyword never matches across
  // the end of the name and the start of a parameter.
  return [...words(t.tool), ...t.params.flatMap((p) => ['', ...words(p)]), '', ...words(t.description)];
}

/** A tool's own address: server and tool, which is what a person looks up. */
function address(t: CatalogTool): string {
  return `${t.server}/${t.tool}`;
}

/** A word some list knows as a verb: a read or neutral verb, or the first word of an effect keyword. */
function isVerb(w: string): boolean {
  const lists = [KEYWORDS.read_verbs, KEYWORDS.neutral_verbs, KEYWORDS.effect.irreversible, KEYWORDS.effect.write, KEYWORDS.effect.read];
  return lists.some((l) => l.some((k) => k.words[0] !== undefined && matchesKeyword([w], [k.words[0]], KEYWORDS.suffixes)));
}

/**
 * Where the name's action starts (ACP-455): its first word, unless the first one or
 * two words are a NAMESPACE -- words no list knows as a verb, followed by one that
 * is AND by the verb's object (`prospector_classify_reply` -> `classify`,
 * `acme_crm_get_contact` -> `get`). The object is required because the lists are not
 * a dictionary: `build_estimate` starts with a verb none of them holds, and read as a
 * namespace it would become a read of "estimate". A name with no verb keeps its first word.
 */
function nameHead(name: readonly string[]): number {
  const v = name.findIndex((w) => isVerb(w));
  return v >= 1 && v <= 2 && v < name.length - 1 ? v : 0;
}

function isOneOf(w: string | undefined, verbs: readonly Keyword[]): boolean {
  return w !== undefined && verbs.some((v) => matchesKeyword([w], v.words, KEYWORDS.suffixes));
}

/**
 * Whether `k` in the tool NAME names the tool's own action (ACP-454, ACP-455): the
 * keyword starts at the name's head -- its first word, or the first verb after a
 * namespace (`execute_sql`, `admin_delete_user`) -- or right after `and`/`then`
 * (`get_and_delete_branch`), or the head is not a read or neutral verb and the
 * keyword follows it. After a read verb the keyword is what is read
 * (`explain_publish_failure`); after a neutral verb it is what is processed
 * (`prospector_classify_reply` classifies a reply, it does not reply).
 */
function nameSays(t: CatalogTool, k: Keyword): boolean {
  const all = words(t.tool);
  const start = nameHead(all);
  const name = all.slice(start);
  // Heads: the first verb, and the word after "and"/"then", so `get_and_delete_branch`
  // still says "delete" as its own second action.
  const heads = [0, ...name.flatMap((w, i) => (w === 'and' || w === 'then' ? [i + 1] : []))];
  if (heads.some((h) => matchesKeyword(name.slice(h, h + k.words.length), k.words, KEYWORDS.suffixes))) return true;
  const head = name[0];
  if (head === undefined) return false;
  if (isOneOf(head, KEYWORDS.read_verbs) || isOneOf(head, KEYWORDS.neutral_verbs)) return false;
  return matchesKeyword(name, k.words, KEYWORDS.suffixes);
}

/** Whether the tool's NAME starts (after a namespace) with a read verb (`get_…`, `listConversations`, `acme_get_status`): it says it reads. */
function nameReads(t: CatalogTool): boolean {
  const name = words(t.tool);
  if (isOneOf(name[nameHead(name)], KEYWORDS.read_verbs)) return true;
  // A name that starts with its own server's name has that word as a namespace:
  // `stripe_analytics` on the `stripe` server reads analytics.
  const server = new Set(words(t.server));
  return name.length >= 2 && server.has(name[0] ?? '') && isOneOf(name[1], KEYWORDS.read_verbs);
}

/** Whether the tool's NAME starts (after a namespace) with a neutral verb: what follows, in the name or the description, is what it processes. */
function nameProcesses(t: CatalogTool): boolean {
  const name = words(t.tool);
  return isOneOf(name[nameHead(name)], KEYWORDS.neutral_verbs);
}

/** A parameter that names an identifier (`reply_id`, `webhook_ids`): it names an object, not an action. */
function namesAnId(p: string): boolean {
  const w = words(p);
  const last = w[w.length - 1];
  return w.length >= 2 && (last === 'id' || last === 'ids' || last === 'uuid');
}

/**
 * Where an egress keyword was found, in words a report can print; `null` when nowhere that counts.
 * A tool whose name says it reads or processes (ACP-455: a read or a neutral verb)
 * sends data off only when its name, a parameter, or the HEAD verb of its first sentence says so: "Get the photos, returns
 * each photo URL" returns a URL to the model, it sends nothing anywhere.
 */
function egressWhere(t: CatalogTool, k: Keyword): string | null {
  if (nameSays(t, k)) return `name says "${k.text}"`;
  for (const p of t.params) {
    if (!namesAnId(p) && matchesKeyword(words(p), k.words, KEYWORDS.suffixes)) return `parameter "${p}" says "${k.text}"`;
  }
  const phrase = nameReads(t) || nameProcesses(t) ? headPhrase(t.description, k.words, KEYWORDS.suffixes) : sentencePhrase(t.description, k.words, KEYWORDS.suffixes);
  return phrase === null ? null : `description says "${phrase}"`;
}

/**
 * Where an irreversible keyword names the tool's OWN action (ACP-454): its
 * name, or the head verb of a clause of the description's first sentence.
 * A parameter name or a later mention never does (`sentence.ts`).
 */
function irreversibleWhere(t: CatalogTool, k: Keyword): string | null {
  if (nameSays(t, k)) return `name says "${k.text}"`;
  const phrase = headPhrase(t.description, k.words, KEYWORDS.suffixes);
  return phrase === null ? null : `description says "${phrase}"`;
}

/** The reason a draft carries when no word classified the tool. */
export const UNCLASSIFIED_REASON = 'no word in its name or description tells the draft what it does: drafted as a write, confirm';

/** A tool's draft, and whether it is the default for a tool no keyword classified. */
function draft(t: CatalogTool): Classification {
  return draftOf(t).classification;
}

function draftOf(t: CatalogTool): { classification: Classification; unclassified: boolean } {
  const text = toolText(t);
  const matched: string[] = [];
  const reasons: string[] = [];
  const fired = (key: string, list: readonly Keyword[]): boolean => {
    let any = false;
    for (const k of list) {
      if (matchesKeyword(text, k.words, KEYWORDS.suffixes)) {
        matched.push(`${key}:${k.text}`);
        any = true;
      }
    }
    return any;
  };
  const firedWhere = (key: string, list: readonly Keyword[], where: (t: CatalogTool, k: Keyword) => string | null): boolean => {
    let first: string | null = null;
    for (const k of list) {
      const w = where(t, k);
      if (w === null) continue;
      matched.push(`${key}:${k.text}`);
      first ??= w;
    }
    if (first !== null && !reasons.includes(first)) reasons.push(first);
    return first !== null;
  };
  let effect: Effect | null = null;
  if (firedWhere('effect.irreversible', KEYWORDS.effect.irreversible, irreversibleWhere)) effect = 'irreversible';
  // A write keyword counts where an irreversible one does: the tool's own action (ACP-455).
  // Descriptions written as prompts are full of example phrases ("set a reminder", "reply
  // to the guest") that a read tool quotes; matched anywhere, they drafted 29 read tools of
  // the first customer's application as writes. The own-action write wins over read.
  const ownWrite = KEYWORDS.effect.write.filter((k) => irreversibleWhere(t, k) !== null);
  for (const k of ownWrite) matched.push(`effect.write:${k.text}`);
  const anyWrite = fired('effect.write', KEYWORDS.effect.write.filter((k) => !ownWrite.includes(k)));
  // A read keyword counts only as the tool's own action too (ACP-455, second pass): a tool
  // whose verb the draft does not know ("change", "extend", "report", "run") and whose
  // description happens to say "check" or "get" was drafted as a read, graded LOW and run
  // with nobody asked -- changeReservationRoom, extendOtaStay, runWorkflow in the first
  // customer's application. Unknown is never LOW (P-4): it falls through to a write.
  // For a read word only the HEAD counts: the name's first verb (nameReads) or the head verb of
  // the description's first sentence. Anywhere in a name is too loose for reads:
  // reportNoShowToOta contains "show" and reports a no-show.
  const ownRead = KEYWORDS.effect.read.filter((k) => headPhrase(t.description, k.words, KEYWORDS.suffixes) !== null);
  fired('effect.read', KEYWORDS.effect.read);
  if (effect === null && ownWrite.length > 0) effect = 'write';
  // A name that starts with a read verb reads, whatever its description quotes.
  if (effect === null && (nameReads(t) || ownRead.length > 0)) effect = 'read';
  // No read keyword at all and a write word somewhere: the draft stays on the side of a write.
  if (effect === null && anyWrite) effect = 'write';
  // The description says the tool cannot be undone (ACP-455): stricter only. The phrases that
  // say it CAN be undone, or only reads, are hints (`undoHints`) and never reach this draft.
  const cannot = cannotBeUndone(t.description, KEYWORDS);
  if (cannot !== undefined) {
    matched.push(`undo_phrases.cannot_be_undone:${cannot.keyword.text}`);
    if (effect !== 'irreversible') {
      effect = 'irreversible';
      reasons.push(`description says "${cannot.hint.evidence}"`);
    }
  }
  // A secret or an access value in the name or a parameter name (ACP-455): a write of one is
  // drafted irreversible (base HIGH); a tool no word classified is a write here, as it is below.
  // A READ of one stays a read (corrected 2026-09-28): it changes nothing, so there is nothing
  // to undo, and raising it put two tools that change nothing among the tools that cannot be
  // undone. The word is still recorded in `matched`; the grader reports it as
  // `sensitive_value`, and the report names such a reader as a source of data that could leave.
  const secret = secretNamed(t.tool, t.params, KEYWORDS);
  if (secret !== null) {
    matched.push(`sensitive_values:${secret.keyword.text}`);
    if (effect !== 'read' && effect !== 'irreversible') {
      effect = 'irreversible';
      if (!reasons.includes(secret.where)) reasons.push(secret.where);
    }
  }
  const egress = firedWhere('egress', KEYWORDS.egress, egressWhere);
  const untrusted = fired('untrusted_input', KEYWORDS.untrusted_input);
  const unclassified = effect === null;
  if (unclassified) reasons.push(UNCLASSIFIED_REASON);
  const c: Classification = { client: t.client, server: t.server, tool: t.tool, effect: effect ?? 'write', egress, untrusted_input: untrusted, matched, draft: true };
  if (reasons.length > 0) c.reason = reasons.join('; ');
  return { classification: c, unclassified };
}

/**
 * The replay's own-case rank of a drafted tool (ACP-454): the highest
 * `irreversible_class` among the irreversible keywords that fired, 0 when the
 * draft is not irreversible or there is no draft.
 */
export function effectClass(t: CatalogTool): number {
  const c = draft(t);
  if (c.effect !== 'irreversible') return 0;
  let best = 0;
  for (const m of c.matched) {
    if (!m.startsWith('effect.irreversible:')) continue;
    best = Math.max(best, KEYWORDS.irreversible_class[m.slice('effect.irreversible:'.length)] ?? 0);
  }
  return best;
}

/**
 * The keyword of `side` that matches the tool, `''` for a side with no keywords that matches by its
 * condition alone, undefined when the side does not match. One reading for both halves: the
 * installed tools' pair findings and the application's own pairs (`pairsAmong`).
 */
function sideKeyword(side: PairSide, d: Drafted): string | undefined {
  const w = side.when;
  if (w.effect !== undefined && !w.effect.includes(d.classification.effect)) return undefined;
  if (w.egress === true && !d.classification.egress) return undefined;
  if (w.untrusted_input === true && !d.classification.untrusted_input) return undefined;
  if (side.keywords.length === 0) return '';
  // Server and tool names only: parameter names and descriptions carry words
  // such as "token" (pagination) that would put every list tool on the secret
  // side of a pair.
  const name = [...words(d.entry.server), '', ...words(d.entry.tool)];
  return side.keywords.find((k) => matchesKeyword(name, k.words, KEYWORDS.suffixes))?.text;
}

/**
 * The word of `keywords.json`'s `counts_not_text` a tool's NAME carries, whole, after the camelCase
 * split (`getInboxStats` -> "stats"); undefined when it carries none. One list, read by the pairs of
 * both halves and by the report's outsider box.
 */
export function countsWord(name: string): string | undefined {
  return words(name).find((w) => KEYWORDS.counts_not_text.includes(w));
}

function sideMatches(side: PairSide, d: Drafted): boolean {
  return sideKeyword(side, d) !== undefined;
}

/** A rule's two sides over one AI agent's tools, each tool kept only when a DIFFERENT tool satisfies the other side. */
function ruleSides(rule: PairRule, tools: readonly Drafted[]): { as: Drafted[]; bs: Drafted[] } {
  // A tool whose name says it returns numbers about text is never the reader: a count carries no sentence anybody wrote.
  const as = tools.filter((d) => sideMatches(rule.a, d) && countsWord(d.entry.tool) === undefined);
  const bs = tools.filter((d) => sideMatches(rule.b, d));
  // Two DIFFERENT tools: one tool that satisfies both sides is not a pair.
  return {
    as: as.filter((a) => bs.some((b) => address(b.entry) !== address(a.entry))),
    bs: bs.filter((b) => as.some((a) => address(a.entry) !== address(b.entry))),
  };
}

function quoteList(names: readonly string[]): string {
  const q = names.map((n) => `"${n}"`);
  if (q.length <= 1) return q.join('');
  return `${q.slice(0, -1).join(', ')} or ${q[q.length - 1] ?? ''}`;
}

function pairFindings(drafted: readonly Drafted[]): Finding[] {
  const byClient = new Map<string, Drafted[]>();
  for (const d of drafted) {
    const list = byClient.get(d.entry.client) ?? [];
    list.push(d);
    byClient.set(d.entry.client, list);
  }
  const out: Finding[] = [];
  for (const [client, tools] of byClient) {
    for (const rule of PAIRS) {
      const { as: aUsed, bs: bUsed } = ruleSides(rule, tools);
      if (aUsed.length === 0 || bUsed.length === 0) continue;
      const aNames = [...new Set(aUsed.map((d) => d.entry.tool))].sort();
      const bNames = [...new Set(bUsed.map((d) => d.entry.tool))].sort();
      // `readers` (side a, what the AI agent reads) and `actors` (side b, what
      // it then does) beside the flat `tools` list, which the JSON's existing
      // consumers read: the terminal prints a pair as reader -> actor (ACP-454),
      // and a flat list of seven tool names says neither.
      const pair: Finding & { readers: string[]; actors: string[] } = {
        id: `pair:${rule.id}:${client}`,
        kind: 'pair',
        severity: rule.severity,
        tools: [...new Set([...aNames, ...bNames])],
        readers: aNames,
        actors: bNames,
        client,
        message:
          `By the draft classification, an AI agent in ${client} can use ${quoteList(aNames)} ` +
          `and then ${quoteList(bNames)}: ${rule.why}.`,
        controls: [],
      };
      out.push(pair);
    }
  }
  return out;
}

/** The patterns of `data/poisoned.json` that match `text`: the ONE matcher, for the installed tools' findings and for `instructionHits`. */
function poisonMatches(text: string, opts: { lengthRule: boolean }): { rule: PoisonRule; index: number; length: number }[] {
  const out: { rule: PoisonRule; index: number; length: number }[] = [];
  for (const rule of POISONED) {
    if (rule.kind === 'length') {
      if (opts.lengthRule && text.length > rule.max_length) out.push({ rule, index: 0, length: 0 });
      continue;
    }
    // Every occurrence, by a copy of the rule's own expression with `g` added: the stored
    // expression stays stateless (`parsePoisoned` refuses g and y for that reason).
    const all = new RegExp(rule.regex.source, `${rule.regex.flags}g`);
    for (const m of text.matchAll(all)) out.push({ rule, index: m.index, length: m[0].length });
  }
  return out;
}

function poisonFindings(t: CatalogTool): Finding[] {
  const out: Finding[] = [];
  const hit = new Set(poisonMatches(t.description, { lengthRule: true }).map((m) => m.rule.id));
  for (const rule of POISONED) {
    if (!hit.has(rule.id)) continue;
    out.push({
      id: `poisoned:${rule.id}:${t.client}:${address(t)}`,
      kind: 'poisoned',
      severity: rule.severity,
      tools: [t.tool],
      client: t.client,
      message: `The description of "${t.tool}" on server "${t.server}" carries ${rule.why}.`,
      controls: [],
    });
  }
  return out;
}

/** How far an excerpt reaches on each side of a match (`InstructionHit.excerpt`). */
export const EXCERPT_AROUND = 60;

/**
 * An excerpt a person can read: invisible code points written as `\u{...}` (the match may BE one,
 * and printed as itself it shows nothing), line breaks as spaces, and the result redacted like
 * every other string the scan prints.
 */
function excerptOf(text: string, index: number, length: number): string {
  const from = Math.max(0, index - EXCERPT_AROUND);
  const to = Math.min(text.length, index + length + EXCERPT_AROUND);
  const raw = text.slice(from, to);
  const shown = [...raw]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return INVISIBLE.test(ch) ? `\\u{${cp.toString(16).toUpperCase()}}` : ch;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return redactText(`${from > 0 ? '...' : ''}${shown}${to < text.length ? '...' : ''}`);
}

/** Code points no screen shows: the two invisible patterns' classes, so an excerpt names them. Written as escapes (see poisoned.json's note). */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;

/**
 * Instruction-like text in `text` by the patterns of `data/poisoned.json` (2026-09-28): the same
 * patterns and the same matcher as the installed tools' `poisoned` findings, applied to the
 * application's own tool descriptions and to skill and instruction files.
 *
 * `file: true` reads `text` as a FILE: each hit carries its 1-based line, and every occurrence is
 * one hit. The length rule is not applied to a file: it measures a tool DESCRIPTION, and an
 * instruction file is a document whose length is normal. For a description (`file: false`), one
 * hit per pattern, the first occurrence, as the installed half reports one finding per pattern.
 */
export function instructionHits(text: string, opts: { file: boolean }): InstructionHit[] {
  const matches = poisonMatches(text, { lengthRule: !opts.file });
  const out: InstructionHit[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (!opts.file) {
      if (seen.has(m.rule.id)) continue;
      seen.add(m.rule.id);
    }
    const excerpt = m.rule.kind === 'length' ? excerptOf(text, 0, 0) : excerptOf(text, m.index, m.length);
    const hit: InstructionHit = { pattern: m.rule.id, why: m.rule.why, severity: m.rule.severity, excerpt };
    if (opts.file) hit.line = text.slice(0, m.index).split('\n').length;
    out.push(hit);
  }
  return out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * A pattern's `why` as what a description DOES (2026-09-28): "text telling the AI agent to drop
 * its earlier instructions" becomes "tells the model to drop its earlier instructions"; a `why`
 * that names a thing rather than an act ("a pseudo-markup tag ...") becomes "carries a
 * pseudo-markup tag ...". The words are the data file's; only the grammar changes.
 */
export function instructionPhrase(why: string): string {
  const m = /^text (\w+)ing (.*)$/.exec(why);
  const said = m === null ? `carries ${why}` : `${m[1] ?? ''}s ${m[2] ?? ''}`;
  return said.replace(/\bthe AI agent\b/g, 'the model');
}

/**
 * One pair of the application's OWN tools that a rule of `data/pairs.json` names (2026-09-28):
 * `reader` satisfies side a by the keyword `reads`, `sender` side b. Built by the same side
 * matching as the installed tools' pair findings (`ruleSides`), one pair per (reader, sender).
 */
export interface ToolPair {
  rule: string;
  severity: 'info' | 'warn' | 'high';
  why: string;
  /** Whether the rule's side b asks for a tool that sends data out (`b_when.egress`): the pairs "Data that could leave" lists. */
  egress: boolean;
  reader: string;
  /** The side-a keyword the reader's name matched, as the data file writes it; '' when side a has no keywords. */
  reads: string;
  sender: string;
}

/**
 * Every pair a rule of `data/pairs.json` names among `catalog`, drafted as `classifications` (one
 * entry per row, same order), within each client: the installed half's pair logic, one pair per
 * two tools instead of one finding per rule.
 */
export function pairsAmong(catalog: readonly CatalogTool[], classifications: readonly Classification[]): ToolPair[] {
  const byClient = new Map<string, Drafted[]>();
  for (const [i, entry] of catalog.entries()) {
    const classification = classifications[i];
    if (classification === undefined) continue;
    const list = byClient.get(entry.client) ?? [];
    list.push({ entry, classification });
    byClient.set(entry.client, list);
  }
  const out: ToolPair[] = [];
  for (const tools of byClient.values()) {
    for (const rule of PAIRS) {
      const { as, bs } = ruleSides(rule, tools);
      for (const a of as) {
        for (const b of bs) {
          if (address(a.entry) === address(b.entry)) continue;
          out.push({
            rule: rule.id,
            severity: rule.severity,
            why: rule.why,
            egress: rule.b.when.egress === true,
            reader: a.entry.tool,
            reads: sideKeyword(rule.a, a) ?? '',
            sender: b.entry.tool,
          });
        }
      }
    }
  }
  return out;
}

/**
 * What each tool's description, and the other tools of the same catalog, say about undoing it
 * (ACP-455), parallel to `catalog`: description phrases first, in the order written, then the
 * inverse tools. EVIDENCE FOR A PERSON: only `cannot_be_undone` has any effect on a draft, and
 * that effect is taken in `draftOf`, not here.
 */
export function undoHints(catalog: readonly Pick<CatalogTool, 'tool' | 'description'>[]): UndoHint[][] {
  const inverse = inverseHints(
    catalog.map((t) => t.tool),
    KEYWORDS,
  );
  return catalog.map((t, i) => [...descriptionPhrases(t.description, KEYWORDS).map((p) => p.hint), ...(inverse[i] ?? [])]);
}

export function classify(catalog: readonly CatalogTool[]): ClassifyOutput {
  const classifications: Classification[] = [];
  const findings: Finding[] = [];
  const drafted: Drafted[] = [];
  const sev = KEYWORDS.finding_severity;
  for (const t of catalog) {
    findings.push(...poisonFindings(t));
    const { classification: c, unclassified } = draftOf(t);
    if (unclassified) {
      findings.push({
        id: `unclassified:${t.client}:${address(t)}`,
        kind: 'unclassified',
        severity: sev.unclassified,
        tools: [t.tool],
        client: t.client,
        message:
          `The draft cannot tell whether "${t.tool}" on server "${t.server}" reads, writes or cannot be undone, ` +
          `so it is drafted as a write for a person to confirm.`,
        controls: [],
      });
    }
    classifications.push(c);
    drafted.push({ entry: t, classification: c });
    if (c.effect === 'irreversible') {
      findings.push({
        id: `irreversible:${t.client}:${address(t)}`,
        kind: 'irreversible',
        severity: sev.irreversible,
        tools: [t.tool],
        client: t.client,
        message: `Draft: "${t.tool}" on server "${t.server}" looks like an action that cannot be undone.`,
        controls: [],
      });
    }
    if (c.egress) {
      findings.push({
        id: `egress:${t.client}:${address(t)}`,
        kind: 'egress',
        severity: sev.egress,
        tools: [t.tool],
        client: t.client,
        message: `Draft: "${t.tool}" on server "${t.server}" looks like it can send data off this machine.`,
        controls: [],
      });
    }
  }
  findings.push(...pairFindings(drafted));
  return { classifications, findings };
}
