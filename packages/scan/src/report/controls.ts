/**
 * Attach the dossier rows a finding cites (ACP-439).
 *
 * `data/finding-controls.json` names, per finding kind, the rows a security
 * reader would open, by the framework's own citation. It stores NO status: the
 * status word a person reads is the dossier's, carried verbatim from the rows
 * `scripts/embed-annex.mjs` read at the engine pin. A "not covered" row prints
 * as not covered; nothing here can round it up.
 */

import type { ControlRef, Finding, FindingKind } from '../types.js';
import { FINDING_CONTROLS_RAW } from '../generated/annex-source.js';
import { ANNEX, type AnnexSource, findAnnexRow, findAtlasRow } from './annex.js';

export interface Citation {
  framework: string;
  clause: string;
}

export interface FindingControls {
  kinds: Record<FindingKind, Citation[]>;
  /** Position phrase of the MITRE chapter -> the ControlRef status word, for --json. */
  mitre_position_status: Record<string, ControlRef['status']>;
}

const KINDS: readonly FindingKind[] = [
  'pair', 'poisoned', 'unclassified', 'irreversible', 'egress',
  'client_not_covered', 'server_not_started', 'runtime_missing',
];

const STATUSES: readonly ControlRef['status'][] = [
  'built', 'partial', 'not checked', 'lands in', 'customer obligation', 'not covered',
];

const MITRE_FRAMEWORKS: readonly string[] = ['MITRE ATLAS', 'OWASP LLM Top 10'];

export class FindingControlsInvalid extends Error {
  override readonly name = 'FindingControlsInvalid';
}

export class CitationUnresolved extends Error {
  override readonly name = 'CitationUnresolved';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is ControlRef['status'] {
  return STATUSES.some((s) => s === value);
}

function citation(value: unknown, where: string): Citation {
  if (!isRecord(value) || typeof value.framework !== 'string' || typeof value.clause !== 'string') {
    throw new FindingControlsInvalid(`${where}: a citation is {"framework": string, "clause": string}`);
  }
  return { framework: value.framework, clause: value.clause };
}

/** Validate the data file's shape. Every kind must be present, even as [],
 *  so a kind added to the contract and forgotten here is refused by name. */
export function parseFindingControls(raw: unknown): FindingControls {
  if (!isRecord(raw) || !isRecord(raw.kinds) || !isRecord(raw.mitre_position_status)) {
    throw new FindingControlsInvalid('finding-controls.json needs "kinds" and "mitre_position_status" objects');
  }
  const rawKinds = raw.kinds;
  const kinds: Partial<Record<FindingKind, Citation[]>> = {};
  for (const kind of KINDS) {
    const list = rawKinds[kind];
    if (!Array.isArray(list)) throw new FindingControlsInvalid(`kinds.${kind} is absent or not a list`);
    kinds[kind] = list.map((c, i) => citation(c, `kinds.${kind}[${i}]`));
  }
  for (const key of Object.keys(rawKinds)) {
    if (!KINDS.some((k) => k === key)) throw new FindingControlsInvalid(`kinds.${key} is not a finding kind`);
  }
  const positions: Record<string, ControlRef['status']> = {};
  for (const [phrase, status] of Object.entries(raw.mitre_position_status)) {
    if (phrase === '//') continue;
    if (!isStatus(status)) throw new FindingControlsInvalid(`mitre_position_status["${phrase}"] is not a status word`);
    positions[phrase] = status;
  }
  const complete: Record<FindingKind, Citation[]> = {
    pair: kinds.pair ?? [],
    poisoned: kinds.poisoned ?? [],
    unclassified: kinds.unclassified ?? [],
    irreversible: kinds.irreversible ?? [],
    egress: kinds.egress ?? [],
    client_not_covered: kinds.client_not_covered ?? [],
    server_not_started: kinds.server_not_started ?? [],
    runtime_missing: kinds.runtime_missing ?? [],
  };
  return { kinds: complete, mitre_position_status: positions };
}

export const FINDING_CONTROLS: FindingControls = parseFindingControls(FINDING_CONTROLS_RAW);

/**
 * Dossier rows this package never cites, by framework and clause, each with its reason. The
 * rows are generated from the dossier and are never hand-edited here; a row whose wording is
 * wrong for a reader of a scan report is left OUT instead, in every place a citation is
 * printed (the findings, the terminal, the executive block). `finding-controls.json` names
 * none of them either, and a test holds it to that.
 */
export const EXCLUDED_CITATIONS: readonly (Citation & { reason: string })[] = [
  {
    framework: 'EU AI Act',
    clause: 'Art. 14(5)',
    reason:
      'Art. 14(5) applies only to the remote biometric identification systems of Annex III point 1(a), not to high-risk systems in general; ' +
      'the row reads it as a rule for every high-risk system, so its wording is wrong at its source.',
  },
  {
    framework: 'DORA',
    clause: 'Art. 11(1)',
    reason: 'ICT business continuity and recovery plans are nothing a scan of tool calls measures, and the dossier marks the row not checked.',
  },
];

export function isExcludedCitation(c: Citation): boolean {
  return EXCLUDED_CITATIONS.some((x) => x.framework === c.framework && x.clause === c.clause);
}

/** A kind's citations, less the excluded rows. */
export function citationsOf(kind: FindingKind, mapping: FindingControls = FINDING_CONTROLS): Citation[] {
  return mapping.kinds[kind].filter((c) => !isExcludedCitation(c));
}

/** Resolve one citation to the ControlRef it stands for, or say why it cannot. */
export function resolveCitation(
  c: Citation,
  mapping: FindingControls = FINDING_CONTROLS,
  source: AnnexSource = ANNEX,
): ControlRef | string {
  if (MITRE_FRAMEWORKS.includes(c.framework)) {
    const row = findAtlasRow(source, c.framework, c.clause);
    if (row === undefined) return `${c.framework} ${c.clause}: no such row in the MITRE chapter at the pin`;
    const status = mapping.mitre_position_status[row.position_label];
    if (status === undefined) {
      return `${c.framework} ${c.clause}: position "${row.position_label}" has no entry in mitre_position_status`;
    }
    return { framework: c.framework, clause: c.clause, status, source: '02-THREAT-MODEL-MITRE.md' };
  }
  const row = findAnnexRow(source, c.framework, c.clause);
  if (row === undefined) return `${c.framework} ${c.clause}: no such row in Annex E at the pin`;
  return { framework: c.framework, clause: c.clause, status: row.status, source: 'E-control-mapping.md' };
}

/** Every citation in the mapping that does not resolve, named. Empty is the only green. */
export function unresolvedCitations(mapping: FindingControls = FINDING_CONTROLS, source: AnnexSource = ANNEX): string[] {
  const problems: string[] = [];
  for (const kind of KINDS) {
    for (const c of mapping.kinds[kind]) {
      const r = resolveCitation(c, mapping, source);
      if (typeof r === 'string') problems.push(`${kind}: ${r}`);
    }
  }
  return problems;
}

/** Fill each finding's `controls` from the mapping, statuses verbatim from the dossier. */
export function attachControls(
  findings: readonly Finding[],
  mapping: FindingControls = FINDING_CONTROLS,
  source: AnnexSource = ANNEX,
): Finding[] {
  return findings.map((f) => ({
    ...f,
    controls: citationsOf(f.kind, mapping).map((c) => {
      const r = resolveCitation(c, mapping, source);
      if (typeof r === 'string') throw new CitationUnresolved(r);
      return r;
    }),
  }));
}

/** The words printed after a citation in the terminal: the annex's status word
 *  (with its milestone for "lands in"), or the MITRE chapter's own position
 *  phrase. Never a word this package made up. */
export function statusWords(ref: ControlRef, source: AnnexSource = ANNEX): string {
  if (ref.source === '02-THREAT-MODEL-MITRE.md') {
    const row = findAtlasRow(source, ref.framework, ref.clause);
    return row === undefined ? ref.status : row.position_label.replace(/\.$/, '').toLowerCase();
  }
  if (ref.status === 'lands in') {
    const row = findAnnexRow(source, ref.framework, ref.clause);
    return row?.milestone ? `lands in ${row.milestone}` : 'lands in';
  }
  return ref.status;
}
