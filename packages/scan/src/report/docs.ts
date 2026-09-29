/**
 * The ZIFFER words the `--code` report uses, each with one plain line and the
 * page of https://ziffer.io/docs that defines it (ACP-455).
 *
 * The report is read by somebody who has never heard of ZIFFER. So every term
 * it uses is in the "How to read this report" legend, and its first use on the
 * page links to the definition. A clause id (`8.4-3`, `DR-13`) is never shown
 * bare: a plain sentence first, then the id as a small linked tag.
 *
 * Every URL here was fetched on 2026-09-26 and answered 200, and every anchor
 * was found in that page's HTML as an `id` (the list is in the ACP-455 commit
 * that added this file). The words follow the site's glossary and concepts
 * pages (www/content/docs/glossary.mdx, concepts.mdx): "held" for ATTEST,
 * "refused" for an action outside policy, "receipt" for the signed record of a
 * grant.
 */

import { escapeHtml } from './names.js';

const SITE = 'https://ziffer.io';
const BY_EXAMPLE = `${SITE}/docs/policy/by-example`;
const CONCEPTS = `${SITE}/docs/concepts`;

/** Every documentation link the report may carry. A test holds the page to this list. */
export const DOC = {
  concepts: CONCEPTS,
  proposal: `${CONCEPTS}#proposal`,
  grant: `${CONCEPTS}#grant`,
  quorum: `${CONCEPTS}#quorum`,
  receipt: `${CONCEPTS}#receipt`,
  policyBundle: `${CONCEPTS}#policy-bundle`,
  glossary: `${SITE}/docs/glossary`,
  missing: `${BY_EXAMPLE}#3-three-kinds-of-missing`,
  floors: `${BY_EXAMPLE}#5-floorsjson`,
  risk: `${BY_EXAMPLE}#6-risk_functionsjson`,
  reversibility: `${BY_EXAMPLE}#7-reversibilityjson`,
  notice: `${BY_EXAMPLE}#8-notice_targetsjson`,
  sdk: `${SITE}/docs/developers/sdk`,
  sdkShape: `${SITE}/docs/developers/sdk#4-the-shape-of-the-change`,
  refusals: `${SITE}/docs/refusals`,
  quickstart: `${SITE}/docs/quickstart`,
} as const;

/** The draft policy member a rule is read from, and the section that explains it. */
export const MEMBER_DOC: Record<string, string> = {
  'floors.json': DOC.floors,
  'risk_functions.json': DOC.risk,
  'reversibility.json': DOC.reversibility,
  'notice_targets.json': DOC.notice,
};

export type TermId =
  | 'engine'
  | 'draft'
  | 'held'
  | 'notice'
  | 'refused'
  | 'receipt'
  | 'risk'
  | 'reversibility'
  | 'tier'
  | 'proposal';

export interface Term {
  id: TermId;
  /** The word as the page uses it. */
  word: string;
  /** One plain line: what it means for the reader's tool. */
  plain: string;
  /** The API's or the specification's own name, when it differs. */
  spec?: string;
  href: string;
}

/** The legend, in the order a reader meets the words. */
export const TERMS: readonly Term[] = [
  {
    id: 'engine',
    word: 'engine',
    plain: 'The ZIFFER program that decides each tool call against the signed policy. The scan ran the real engine on this machine; nothing was sent.',
    href: DOC.grant,
  },
  {
    id: 'held',
    word: 'held for a person',
    plain: 'The call waits until a named person approves it, then runs. Nothing happens before that.',
    spec: 'ATTEST',
    href: DOC.quorum,
  },
  {
    id: 'notice',
    word: 'run after a notice',
    plain: 'Under the policy the call runs after a notice, with no approval; the people the policy names are told first. It detects, it does not prevent.',
    spec: 'notice_targets',
    href: DOC.notice,
  },
  {
    id: 'refused',
    word: 'refused',
    plain: 'The policy has no rule for the tool, so the engine will not let it run. Unknown is never treated as safe.',
    spec: 'DENY',
    href: DOC.risk,
  },
  {
    id: 'receipt',
    word: 'signed receipt',
    plain: 'The signed record of every call ZIFFER lets run: what was asked, how it was graded, who approved, when.',
    href: DOC.receipt,
  },
  {
    id: 'risk',
    word: 'risk',
    plain: 'How dangerous one call is, graded by the risk function the policy names for the tool: LOW, MEDIUM or HIGH. HIGH is held for a person.',
    spec: 'risk_functions',
    href: DOC.risk,
  },
  {
    id: 'reversibility',
    word: 'cannot be undone',
    plain: 'Whether a later call can undo the action. A tool the policy does not list is treated as one that cannot be undone.',
    spec: 'IRREVERSIBLE',
    href: DOC.reversibility,
  },
  {
    id: 'tier',
    word: 'tier',
    plain: 'How sensitive the system a tool touches is: T0 public or sandbox, T1 internal, T2 production, T3 privileged. A tool not listed is T3.',
    spec: 'floor',
    href: DOC.floors,
  },
  {
    id: 'draft',
    word: 'draft policy',
    plain: 'The rules this scan wrote from what it found, signed by a throwaway key: a draft to review and sign, not a policy to deploy.',
    spec: 'policy bundle',
    href: DOC.policyBundle,
  },
  {
    id: 'proposal',
    word: 'proposal',
    plain: 'What your code sends ZIFFER before a tool runs: which tool, with which input. It asks; it grants nothing.',
    href: DOC.proposal,
  },
];

/** What each risk level and tier means for a tool, for the legend's two small tables. */
export const RISK_LEGEND: readonly [string, string][] = [
  ['LOW', 'runs, with a signed receipt'],
  ['MEDIUM', 'runs, with a signed receipt; if it cannot be undone, the policy’s contacts are told first'],
  ['HIGH', 'held for a person before it runs'],
];
export const TIER_LEGEND: readonly [string, string][] = [
  ['T0', 'public or sandbox'],
  ['T1', 'internal'],
  ['T2', 'production'],
  ['T3', 'privileged, and every system the policy does not list'],
];

export function termOf(id: TermId): Term {
  const t = TERMS.find((x) => x.id === id);
  if (t === undefined) throw new Error(`no legend entry for ${id}`);
  return t;
}

/**
 * A linker for one page: the first use of a term links to its definition, a
 * later use is marked but not linked, so the page reads as prose and every
 * term it uses can still be checked against the legend.
 */
export function termLinker(): (id: TermId, text?: string) => string {
  const seen = new Set<TermId>();
  return (id, text) => {
    const term = termOf(id);
    const shown = escapeHtml(text ?? term.word);
    if (seen.has(id)) return `<span class="term" data-term="${id}">${shown}</span>`;
    seen.add(id);
    return `<a class="term" data-term="${id}" href="${term.href}" rel="noopener noreferrer">${shown}</a>`;
  };
}

/** Where a clause id is explained: the section of the policy page that states it, or the refusals page. */
export function clauseHref(clause: string): string {
  if (clause === '8.4-3') return DOC.risk;
  if (clause === 'DR-13') return DOC.notice;
  return DOC.refusals;
}

/** A clause id as a small linked tag, after the plain sentence that says what it means. */
export function clauseTag(clause: string): string {
  return `<a class="clause" href="${clauseHref(clause)}" rel="noopener noreferrer" title="the rule in the ZIFFER specification">${escapeHtml(clause)}</a>`;
}

/** A policy member's file name, linked to the section that explains it. */
export function memberLink(member: string): string {
  const href = MEMBER_DOC[member];
  const name = `<code>${escapeHtml(member)}</code>`;
  return href === undefined ? name : `<a class="member" href="${href}" rel="noopener noreferrer">${name}</a>`;
}
