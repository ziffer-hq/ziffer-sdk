/**
 * The one OWASP entry the report cites, in ONE place: every citation reads it, and
 * `owasp.test.ts` fails on an OWASP identifier written anywhere else in the scan's source, its
 * data or the MCP server's source, so the next edition of the list is one edit here.
 *
 * READ, NOT RECALLED (2026-09-28): the "OWASP Top 10 for LLM Applications 2026", v1.0, published
 * 2026-08-03 (the PDF from the URL below, page 26, sha256 ef87993a4e50ae9d83b41ff7a3d3e6320a82dfa8d4ec6bf98d0ce264b2e6108e;
 * the same text in GenAI-Security-Project/GenAI-LLM-Top10, 2026/final/LLM03_ExcessiveAgency.md,
 * commit 0c10802600 of 2026-07-16). Excessive Agency moved from 06 in the 2025 edition to 03; in
 * 2026 the number 06 names Unbounded Consumption. A published list is a fact that expires: the
 * page cites the edition with its date wherever it explains the identifier.
 *
 * The dossier's MITRE chapter (the generated annex source) keys the row by its 2025 number without
 * a year; `dossierId` is that key, used only to find the row, never printed.
 */
export const OWASP_EXCESSIVE_AGENCY = {
  dossierId: 'LLM06',
  id: 'LLM03:2026',
  title: 'Excessive Agency',
  list: 'OWASP Top 10 for LLM Applications 2026',
  published: '2026-08-03',
  url: 'https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/',
  previous: 'LLM06 in the 2025 edition',
  /** The nine prevention strategies' two a check before each tool call answers; the other seven are the customer's own work. */
  strategies: [
    { n: 6, title: 'Require user approval' },
    { n: 7, title: 'Complete mediation' },
  ],
  of: 9,
  /** The one phrase of strategy 7 the page quotes, attributed; nothing longer. */
  quote: 'an independent pre-execution policy decision point between the tool and the downstream system',
} as const;

/** The framework name the dossier's rows carry for this list. */
export const OWASP_FRAMEWORK = 'OWASP LLM Top 10' as const;

/**
 * The one sentence that explains the citation, printed under the threats table: the entry, the
 * edition and its date, the older number, the two strategies a check before each call answers,
 * and that the rest is the reader's own work. It claims no compliance: it answers two strategies
 * of one entry.
 */
export function owaspNote(): string {
  const o = OWASP_EXCESSIVE_AGENCY;
  const [a, b] = o.strategies;
  const word = (n: number): string => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
  return (
    `${o.title} is ${o.id} in the ${o.list}, published ${o.published} (${o.previous}); a check before each tool call answers ` +
    `two of its ${word(o.of)} prevention strategies, ${a.n} (${a.title}) and ${b.n} (${b.title}, which names “${o.quote}”), ` +
    `and the other ${word(o.of - 2)}, such as giving a model fewer tools and narrower permissions, remain your own work.`
  );
}
