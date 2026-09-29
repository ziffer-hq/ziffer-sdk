/**
 * `search_docs` — find the section of our documentation that answers a
 * question (ACP-392 item 1).
 *
 * `guide.ts` and `repo-guide.ts` serve documents an agent already knows to
 * ask for. This one is for the question those two do not cover, and its shape
 * follows from one rule they share: **nothing here paraphrases, summarises or
 * reformats.** A section is returned whole, under the path and heading it has
 * in the repository, so an agent's answer and a human reader's answer are the
 * same bytes and a correction to the document is a correction to both.
 *
 * # There is no index, and that is deliberate
 *
 * The sections are cut and ranked at CALL TIME out of the embedded markdown.
 * A pre-built index would be a second artifact derived from the documents,
 * and the whole argument of this package is that there is one artifact: the
 * document. An index also has to be rebuilt, which is one more thing that can
 * be stale in a published tarball while every equality test beside it passes,
 * because the test would compare the documents and not the index.
 *
 * The ranking is a plain term match. It is not clever and it does not try to
 * be: a relevance model inside a published package is a second opinion about
 * what our own documentation says, tuned by nobody, that a customer cannot
 * inspect. What this does is find the sections that literally contain the
 * words and order them by how many and how often — and then SAY how many it
 * did not show, so the answer is never silently one section short.
 *
 * # Sections, not documents and not lines
 *
 * A heading is the unit a human would quote, and it is the unit the documents
 * are written in: `support.md section 4`, `sdk.md section 5`, `executor.md
 * section 6` are how every other document cites them. Returning whole
 * documents would put 47 KB of `executor.md` into an agent's context to
 * answer one question; returning lines would return a table row with no
 * table header and a sentence with no subject.
 *
 * Headings inside fenced code blocks are NOT headings. `install.md` is full of
 * shell with `# a comment` in it, and a splitter that did not know the
 * difference would cut a command in half and serve the halves as two answers.
 */

import { ONBOARDING_DOCS, type OnboardingDoc } from './generated/docs-source.js';
import type { ToolOutcome } from './tools.js';

/** How many sections one answer shows unless the caller says otherwise. */
export const DEFAULT_LIMIT = 3;

/** The most any one call will show. A bound on what reaches a model's
 * context, not a judgement about the query: everything over it is COUNTED in
 * the answer, so the caller is never told less than it matched. */
export const MAX_LIMIT = 10;

/**
 * The most characters of document text one answer carries.
 *
 * A bound with NO truncation of any section: sections are added whole until
 * the next one would cross this, and the rest are counted as matched but not
 * shown. Truncating a served section would break this package's one rule —
 * the text a tool serves is the text the file carries — for the sake of a
 * number, and the caller can always ask a narrower question.
 *
 * `policy-ci.md`'s longest section is 23 KB by itself, so one section may
 * exceed this on its own; the first match is always shown, because an answer
 * that showed nothing and said "1 matched" would be useless.
 */
export const MAX_ANSWER_CHARS = 24_000;

/** One heading's worth of a document. */
export interface DocSection {
  /** The document's repository path, e.g. `docs/onboarding/sdk.md`. */
  readonly path: string;
  /** The heading text, without its `#`s. Empty for text before the first
   * heading, which every document here has none of — each opens with its
   * title — but which a new document could. */
  readonly heading: string;
  /** How deep the heading is: 1 for `#`, 2 for `##`. */
  readonly level: number;
  /** The heading line and everything under it, verbatim and trimmed of
   * trailing blank lines. */
  readonly text: string;
}

/** Split one document into its sections, at call time. */
export function sectionsOf(doc: OnboardingDoc): readonly DocSection[] {
  const out: DocSection[] = [];
  let heading = '';
  let level = 0;
  let body: string[] = [];
  let fenced = false;
  const flush = (): void => {
    const text = [...body].join('\n').replace(/\s+$/, '');
    if (text.trim() === '') return;
    out.push({ path: doc.path, heading, level, text });
  };
  for (const line of doc.markdown.split('\n')) {
    // ``` or ~~~ at the start of a line opens and closes a fence. Inside one,
    // `# ...` is a shell comment and not a heading — `install.md` is full of
    // them and a splitter that cut there would serve half a command.
    if (/^(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      body.push(line);
      continue;
    }
    const start = fenced ? null : /^(#{1,6}) +(.*\S)\s*$/.exec(line);
    if (start === null) {
      body.push(line);
      continue;
    }
    flush();
    heading = start[2] ?? '';
    level = (start[1] ?? '').length;
    body = [line];
  }
  flush();
  return out;
}

/** Every section of every served document, in document order. */
export function allSections(): readonly DocSection[] {
  return ONBOARDING_DOCS.flatMap((doc) => sectionsOf(doc));
}

/**
 * The terms one query is matched on.
 *
 * Split on everything that is not a word character, a dot or a hyphen, so
 * `8.4-3`, `DR-13`, `ZIFFER_API_KEY` and `receipt_identity.json` each stay ONE
 * term. A tokeniser that broke on the hyphen would look for `dr` and `13`
 * separately and rank a paragraph about drivers above the clause.
 *
 * A one-character term is dropped: it matches half the corpus and contributes
 * only noise to the ranking. A query that is nothing BUT one-character terms
 * yields no terms at all, and {@link searchDocs} refuses it by name rather
 * than answering with the whole corpus.
 */
export function terms(query: string): readonly string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9._-]+/)) {
    const term = raw.replace(/^[.-]+|[.-]+$/g, '');
    if (term.length >= 2) seen.add(term);
  }
  return [...seen];
}

/** One section and why it ranked where it did. */
export interface Ranked {
  readonly section: DocSection;
  /** How many of the query's terms appear at all. The primary sort. */
  readonly matched: number;
  /** How many times they appear in total. The tie-break. */
  readonly hits: number;
  /** How many appear in the HEADING, which is what a human would have
   * scanned for. The second tie-break. */
  readonly inHeading: number;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * Rank every section against a query. Sections matching nothing are dropped.
 *
 * The order is (terms matched, then occurrences, then heading matches), and
 * then the corpus's own order — so the same query always returns the same
 * sections in the same order. An unstable ranking in a tool a model calls
 * twice is a tool that appears to change its mind.
 */
export function rank(query: string): readonly Ranked[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const out: Ranked[] = [];
  for (const section of allSections()) {
    const haystack = section.text.toLowerCase();
    const headingText = section.heading.toLowerCase();
    let matched = 0;
    let hits = 0;
    let inHeading = 0;
    for (const term of wanted) {
      const count = occurrences(haystack, term);
      if (count === 0) continue;
      matched += 1;
      hits += count;
      if (headingText.includes(term)) inHeading += 1;
    }
    if (matched === 0) continue;
    out.push({ section, matched, hits, inHeading });
  }
  // `out` is in corpus order, so the index paired in below is the fallback
  // that makes the sort total and the answer the same on every call.
  return out
    .map((ranked, index) => ({ ranked, index }))
    .sort((a, b) => {
      if (a.ranked.matched !== b.ranked.matched) return b.ranked.matched - a.ranked.matched;
      if (a.ranked.inHeading !== b.ranked.inHeading) return b.ranked.inHeading - a.ranked.inHeading;
      if (a.ranked.hits !== b.ranked.hits) return b.ranked.hits - a.ranked.hits;
      return a.index - b.index;
    })
    .map((entry) => entry.ranked);
}

/** How one section is headed in an answer. The path and the heading, because
 * an agent that is going to quote this needs to be able to cite it, and a
 * model handed unattributed markdown invents a filename for it
 * (`repo-guide.ts`'s line, one tool over). */
export function attribution(section: DocSection): string {
  return section.heading === ''
    ? `--- ${section.path} ---`
    : `--- ${section.path} § ${section.heading} ---`;
}

/**
 * Search the onboarding documentation and return the matching sections.
 *
 * Not finding anything is NOT a tool error: the tool was asked to look and it
 * looked. It is named, though — `NoSectionMatched` — so a model can branch on
 * it, and the text says the two things that are actually true (try other
 * words; the answer may genuinely not be written down) plus the one thing to
 * do about the second, which is `send_feedback`.
 */
export function searchDocs(query: string, limit: number = DEFAULT_LIMIT): ToolOutcome {
  if (terms(query).length === 0) {
    return {
      text:
        `SearchQueryEmpty: ${JSON.stringify(query)} carries no term of two characters or more, ` +
        'so every section would match it. Ask for the words you expect to appear in the ' +
        'documentation — a refusal name, a variable, a file name, a command.',
      isError: true,
    };
  }
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
  const ranked = rank(query);
  if (ranked.length === 0) {
    return {
      text:
        `NoSectionMatched: nothing in the ${ONBOARDING_DOCS.length} onboarding documents ` +
        `contains the terms in ${JSON.stringify(query)}.\n` +
        '  Two things this means. The words may not be ours — try the name we use: a refusal\n' +
        '  name, an environment variable, a file in the policy repository, a CLI subcommand.\n' +
        '  Or it may genuinely not be written down, which is worth telling us: send_feedback\n' +
        '  takes the question and stores it where an operator reads it.',
      isError: false,
    };
  }

  const shown: Ranked[] = [];
  let chars = 0;
  for (const candidate of ranked) {
    if (shown.length >= bounded) break;
    // The first match is always shown, however long: an answer that showed
    // nothing and reported a count would be worse than a long one.
    if (shown.length > 0 && chars + candidate.section.text.length > MAX_ANSWER_CHARS) break;
    shown.push(candidate);
    chars += candidate.section.text.length;
  }

  const lines: string[] = [
    `search_docs ${JSON.stringify(query)}: ${ranked.length} section(s) matched, ` +
      `showing ${shown.length}.`,
    '',
  ];
  for (const entry of shown) {
    lines.push(attribution(entry.section));
    lines.push('');
    lines.push(entry.section.text);
    lines.push('');
  }
  const more = ranked.length - shown.length;
  if (more > 0) {
    lines.push(
      `${more} more section(s) matched and are not shown. They are, in rank order:`,
      ...ranked.slice(shown.length).map((entry) => `  ${attribution(entry.section)}`),
      '',
      `Ask a narrower question, or raise limit (the most this tool shows is ${MAX_LIMIT}).`,
    );
  }
  lines.push(
    'Every line above is the document itself, under the path and heading it has in the ' +
      'repository. Nothing here is a summary.',
  );
  return { text: lines.join('\n'), isError: false };
}
