/**
 * The shape of the dossier rows `scripts/embed-annex.mjs` reads out of the
 * engine at the pin (ACP-439). The rows themselves live only in the generated
 * `src/generated/annex-source.ts`; this file declares what they look like and
 * how to find one. It holds no row.
 */

import type { ControlRef } from '../types.js';
import { ANNEX_SOURCE } from '../generated/annex-source.js';

/** One row of Annex E, under a `## <framework>` heading. */
export interface AnnexRow {
  /** The heading's text before its em dash, e.g. "NIS2", "NIST SP 800-53 Rev. 5". */
  framework: string;
  heading: string;
  /** The framework's own citation, as the annex spells it. */
  clause: string;
  asks: string;
  answered_by: string;
  status: ControlRef['status'];
  /** Set only for "lands in M<n>": the milestone the annex names. */
  milestone: string | null;
  evidence: string;
  line: number;
}

/** One row of the MITRE chapter's ATLAS or OWASP table. */
export interface AtlasRow {
  framework: 'MITRE ATLAS' | 'OWASP LLM Top 10';
  id: string;
  name: string;
  /** The position cell's bold lead, verbatim; "Same." already resolved to the row above's. */
  position_label: string;
  position_inherited_from: string | null;
  position: string;
  mechanism: string;
  line: number;
}

export interface AnnexSource {
  rows: AnnexRow[];
  atlas: AtlasRow[];
  generated_from: { path: string; sha256: string; engine_pin: string }[];
}

export const ANNEX: AnnexSource = ANNEX_SOURCE;

export function findAnnexRow(source: AnnexSource, framework: string, clause: string): AnnexRow | undefined {
  return source.rows.find((r) => r.framework === framework && r.clause === clause);
}

export function findAtlasRow(source: AnnexSource, framework: string, id: string): AtlasRow | undefined {
  return source.atlas.find((r) => r.framework === framework && r.id === id);
}
