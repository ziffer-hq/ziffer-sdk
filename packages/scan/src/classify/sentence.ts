/**
 * Where a description names the tool's OWN action (ACP-454).
 *
 * A tool's description talks about many things: what it returns, what it
 * refuses, what some other tool does, what the reader should not confuse it
 * with. Matching an irreversible verb anywhere in it graded `whoami` as able to
 * revoke ("... covers expired, revoked and never-minted alike") and a pricing
 * lookup as able to remove. The tool's own action is stated in two places
 * only, and this module reads the second:
 *
 *  1. its NAME (`execute_sql`, `send_email`), read in `index.ts`;
 *  2. the verb at the head of a clause of the description's FIRST SENTENCE,
 *     in the imperative or third person ("Send an email", "Deletes the
 *     record", "Permanently removes"), whose subject is the tool.
 *
 * The first sentence is the text up to the first `.`, `!`, `?` or newline,
 * after leading whitespace (some servers open their description with a
 * newline). A clause starts the sentence, or follows `, and`, `; `, ` or ` or
 * `, then`. The head is the clause's first word, or its second when the first
 * is an adverb ending in `ly` ("Permanently removes").
 *
 * A keyword's first word must sit at the head. Its later words ("run command",
 * "force push") must follow in order in the same clause, at most two words
 * apart, so "Run a shell command" matches "run command". The suffix rule of
 * `words.ts` applies to the head verb as well as to the keyword's last word,
 * because a third-person head ("Runs a shell command") conjugates the FIRST
 * word of a two-word keyword.
 */

import { words } from './words.js';

/** One word of the first sentence, with the whitespace-separated chunk it came from. */
interface Token {
  word: string;
  chunk: number;
}

interface Clause {
  tokens: Token[];
  chunks: string[];
}

/** The description's first sentence: up to the first `.`, `!`, `?` or newline. */
export function firstSentence(description: string): string {
  const s = description.trimStart();
  const at = s.search(/[.!?\n]/);
  return at < 0 ? s : s.slice(0, at);
}

const CLAUSE_BREAK = /,\s*and\s+|;\s+|\s+or\s+|,\s*then\s+/i;

function clauses(sentence: string): Clause[] {
  return sentence.split(CLAUSE_BREAK).map((text) => {
    const chunks = text.split(/\s+/).filter((c) => c.length > 0);
    const tokens: Token[] = [];
    chunks.forEach((c, chunk) => {
      for (const word of words(c)) tokens.push({ word, chunk });
    });
    return { tokens, chunks };
  });
}

function same(got: string | undefined, want: string, suffixes: readonly string[], conjugated: boolean): boolean {
  if (got === undefined) return false;
  return got === want || (conjugated && suffixes.some((s) => got === want + s));
}

/** The original text a match spans, stretched to three chunks so it reads as a phrase ("Send an email"). */
function quote(c: Clause, from: number, to: number): string {
  const end = Math.min(c.chunks.length - 1, Math.max(to, from + 2));
  return c.chunks
    .slice(from, end + 1)
    .join(' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

const MAX_GAP = 2;

/**
 * The phrase of the first sentence where `keyword` is the head verb of a
 * clause, or `null` when it is not.
 */
export function headPhrase(description: string, keyword: readonly string[], suffixes: readonly string[]): string | null {
  const first = keyword[0];
  if (first === undefined) return null;
  const last = keyword.length - 1;
  for (const c of clauses(firstSentence(description))) {
    const heads = [0];
    const w0 = c.tokens[0]?.word;
    if (w0 !== undefined && w0.length > 2 && w0.endsWith('ly')) heads.push(1);
    for (const h of heads) {
      if (!same(c.tokens[h]?.word, first, suffixes, true)) continue;
      let at = h;
      let ok = true;
      for (let j = 1; j <= last && ok; j += 1) {
        const want = keyword[j];
        ok = false;
        if (want === undefined) break;
        for (let i = at + 1; i <= at + 1 + MAX_GAP && i < c.tokens.length; i += 1) {
          if (same(c.tokens[i]?.word, want, suffixes, j === last)) {
            at = i;
            ok = true;
            break;
          }
        }
      }
      if (!ok) continue;
      const fromChunk = c.tokens[0]?.chunk ?? 0;
      const toChunk = c.tokens[at]?.chunk ?? fromChunk;
      return quote(c, fromChunk, toChunk);
    }
  }
  return null;
}

/** The original text of the first sentence from an egress keyword found anywhere in it, stretched as `quote` does. */
export function sentencePhrase(description: string, keyword: readonly string[], suffixes: readonly string[]): string | null {
  const last = keyword.length - 1;
  for (const c of clauses(firstSentence(description))) {
    for (let i = 0; i + keyword.length <= c.tokens.length; i += 1) {
      let all = true;
      for (let j = 0; j <= last && all; j += 1) {
        const want = keyword[j];
        all = want !== undefined && same(c.tokens[i + j]?.word, want, suffixes, j === last);
      }
      if (!all) continue;
      const from = c.tokens[i]?.chunk ?? 0;
      return quote(c, from, c.tokens[i + last]?.chunk ?? from);
    }
  }
  return null;
}
