/**
 * What a tool's own words and its catalog say about undoing it, and whether its
 * name or parameters name a secret (ACP-455, 2026-09-28).
 *
 * THE RULE IS ASYMMETRIC, and every export here is shaped by it. Evidence that a
 * tool CANNOT be undone, or that it touches a secret, may make the draft
 * stricter (`index.ts` reads `cannotBeUndone` and `secretNamed`). Evidence that
 * a tool CAN be undone, or only reads, is returned as an `UndoHint` for a person
 * to confirm and is read by nothing that drafts: RV-1 reads an absent
 * reversibility entry as IRREVERSIBLE, and a guess must not relax it.
 *
 * Every phrase, verb pair and word is data (`data/keywords.json`), never a
 * literal here.
 */

import type { UndoHint } from '../code/types.js';
import type { Keyword, KeywordData, UndoSays } from './data.js';
import { matchesKeyword, words } from './words.js';

/** One description phrase found, with the data-file spelling that found it. */
export interface PhraseFound {
  hint: UndoHint;
  keyword: Keyword;
  at: number;
}

const SAYS: readonly UndoSays[] = ['cannot_be_undone', 'can_be_undone', 'reads_only'];

/**
 * A phrase's words, in order, as whole words: any run of spaces, hyphens or
 * apostrophes between them (`read-only`, `can't`), nothing alphanumeric
 * touching either end, so `permanent` is not found inside `permanently` and
 * `can be undone` is not found inside `cannot be undone`.
 */
function phraseRegex(k: Keyword): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${k.words.join("[\\s\\-'’]+")}(?![A-Za-z0-9])`, 'gi');
}

/** The word just before `at` in `text`, lowercase, apostrophes kept and curly ones straightened. */
function wordBefore(text: string, at: number): string {
  const m = /([A-Za-z'’]+)[^A-Za-z'’]*$/.exec(text.slice(0, at));
  return (m?.[1] ?? '').replace(/’/g, "'").toLowerCase();
}

/** Every undo phrase the description carries, in the order written; a negated phrase is not one. */
export function descriptionPhrases(description: string, data: KeywordData): PhraseFound[] {
  const found: PhraseFound[] = [];
  const seen = new Set<string>();
  for (const says of SAYS) {
    for (const keyword of data.undo_phrases.phrases[says]) {
      for (const m of description.matchAll(phraseRegex(keyword))) {
        const at = m.index;
        if (data.undo_phrases.negators.includes(wordBefore(description, at))) continue;
        const evidence = m[0];
        const id = `${says}\u0000${evidence}`;
        if (seen.has(id)) continue;
        seen.add(id);
        found.push({ hint: { says, source: 'description', evidence }, keyword, at });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** The first phrase saying the tool cannot be undone: the one reading that may make the draft stricter. */
export function cannotBeUndone(description: string, data: KeywordData): PhraseFound | undefined {
  return descriptionPhrases(description, data).find((p) => p.hint.says === 'cannot_be_undone');
}

/** A name's words with every `not_secret` phrase blanked out, so a word inside one never matches. */
function withoutNotSecret(w: readonly string[], data: KeywordData): string[] {
  const out = [...w];
  for (const k of data.sensitive_values.not_secret) {
    for (let i = 0; i + k.words.length <= out.length; i += 1) {
      if (matchesKeyword(out.slice(i, i + k.words.length), k.words, data.suffixes)) {
        for (let j = i; j < i + k.words.length; j += 1) out[j] = '';
      }
    }
  }
  return out;
}

/**
 * Where the tool's NAME or a PARAMETER name names a secret or an access value,
 * as a reason a report prints (`name says "password"`, `parameter "doorCode"
 * says "door code"`), with the data-file keyword; `null` when neither does.
 * Never the description: descriptions mention tokens of text and passwords the
 * tool does not touch.
 */
export function secretNamed(tool: string, params: readonly string[], data: KeywordData): { where: string; keyword: Keyword } | null {
  const name = withoutNotSecret(words(tool), data);
  for (const k of data.sensitive_values.words) {
    if (matchesKeyword(name, k.words, data.suffixes)) return { where: `name says "${k.text}"`, keyword: k };
  }
  for (const p of params) {
    const w = withoutNotSecret(words(p), data);
    for (const k of data.sensitive_values.words) {
      if (matchesKeyword(w, k.words, data.suffixes)) return { where: `parameter "${p}" says "${k.text}"`, keyword: k };
    }
  }
  return null;
}

/** The words after a name's verb, as the pairing compares them: connectives dropped, a trailing state word dropped, a trailing `s` ignored, noun variations read as one. */
function objectOf(rest: readonly string[], data: KeywordData): string[] {
  const iv = data.inverse_verbs;
  let w = rest.filter((x) => !iv.connectives.includes(x));
  const last = w[w.length - 1];
  if (last !== undefined && iv.state_words.includes(last)) w = w.slice(0, -1);
  return w.map((x) => {
    const one = x.length > 3 && x.endsWith('s') ? x.slice(0, -1) : x;
    const group = iv.same_nouns.find((g) => g.includes(one) || g.includes(x));
    return group?.[0] ?? one;
  });
}

/**
 * Within ONE catalog, the tools a named inverse undoes: for each tool, one
 * `can_be_undone` hint per tool whose name is the inverse verb over the same
 * object (`markConversationResolved` <- `reopenConversation`). Only the FIRST
 * verb of a pair gets one: deleting is not undone by creating. Parallel to `names`.
 */
export function inverseHints(names: readonly string[], data: KeywordData): UndoHint[][] {
  const split = names.map((n) => words(n));
  const out: UndoHint[][] = names.map(() => []);
  // At most two namespace words (`prospector_add_to_x` / `prospector_remove_from_x`), the same on both.
  const maxNamespace = 2;
  for (const [i, a] of split.entries()) {
    for (const [j, b] of split.entries()) {
      if (i === j) continue;
      for (let skip = 0; skip <= maxNamespace; skip += 1) {
        if (skip > 0 && a[skip - 1] !== b[skip - 1]) break;
        const va = a[skip];
        const vb = b[skip];
        if (va === undefined || vb === undefined) break;
        if (!data.inverse_verbs.pairs.some(([first, inverse]) => first === va && inverse === vb)) continue;
        const oa = objectOf(a.slice(skip + 1), data);
        const ob = objectOf(b.slice(skip + 1), data);
        if (oa.length === 0 || oa.join(' ') !== ob.join(' ')) continue;
        const evidence = names[j] ?? '';
        const list = out[i];
        if (list !== undefined && !list.some((h) => h.evidence === evidence)) list.push({ says: 'can_be_undone', source: 'inverse_tool', evidence });
        break;
      }
    }
  }
  return out;
}
