/**
 * The side-by-side (ACP-435): one row per case, 80 columns.
 *
 * Column A is what happens with no agent authorization policy; column B is
 * what the engine answered under the policy. Column B is PLAIN WORDS: the
 * clause a refusal names goes in `--json` (the `ReplayResult` itself), never in
 * this text, and the words for a refusal come from `data/replay/plain-words.json`
 * rather than from a table in code. The first line is always the UNSIGNED DEMO
 * line, the same shape as the CLI's `UNSIGNED:` line.
 *
 * THE ROWS THIS POLICY DOES NOT STOP ARE PRINTED AS SUCH. An ALLOWED row is an
 * injection that succeeded under the policy; the footer names each one and says
 * why the policy let it through, from the engine's own grade.
 *
 * THE NINTH ROW (ACP-451) is the scan's own case, when there is one: the same
 * columns, and under it the label saying who wrote the Proposal. When no tool
 * is irreversible the row is replaced by the reason there is none.
 */

import type { PlainWords } from './data.js';
import { loadReplayData } from './data.js';
import { hasOwnCase } from './own.js';
import { hex8, WITHOUT_POLICY } from './replay.js';
import type { ReplayOutcome, ReplayResult, ReplayRow } from './replay.js';

export const WIDTH = 80;
/** id, injection, tool, column A, column B -- summing to WIDTH with the gaps. */
const COLS: readonly number[] = [6, 21, 15, 9, 25];
const GAP = 1;

export interface RenderOptions {
  /** Column B's heading. The harness bundle is not a generated policy, so it is not called one. */
  policyLabel?: string;
  /** One sentence printed under the key line, before the table: what column B was asked of. */
  note?: string;
  words?: PlainWords;
}

/** Greedy word wrap; a word longer than the width is cut rather than overflowing. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/).filter((w) => w !== '')) {
    while (word.length > width) {
      if (line !== '') {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

function table(cells: readonly string[]): string[] {
  const wrapped = cells.map((c, i) => wrap(c, COLS[i] ?? WIDTH));
  const height = Math.max(...wrapped.map((w) => w.length));
  const out: string[] = [];
  for (let r = 0; r < height; r++) {
    const parts = wrapped.map((w, i) => (w[r] ?? '').padEnd(COLS[i] ?? 0));
    out.push(parts.join(' '.repeat(GAP)).trimEnd());
  }
  return out;
}

function fiveWords(s: string): string {
  const words = s.split(/\s+/).filter((w) => w !== '');
  return words.slice(0, 5).join(' ');
}

function columnB(o: ReplayOutcome, fingerprint: string, words: PlainWords): string {
  switch (o.kind) {
    case 'refused':
      return `REFUSED: ${words.refused[o.clause] ?? words.refused_unknown}`;
    case 'held':
      return `HELD for ${o.awaits.k} approvers (${o.risk.toLowerCase()} risk)`;
    case 'allowed':
      return `ALLOWED with receipt ${hex8(fingerprint)}`;
  }
}

/** Why an ALLOWED row went through, from the engine's grade. */
function whyAllowed(row: ReplayRow): string | undefined {
  const o = row.outcome;
  if (o.kind !== 'allowed') return undefined;
  const grade = `${o.risk.toLowerCase()} risk, ${o.reversibility === 'IRREVERSIBLE' ? 'irreversible' : 'reversible'}`;
  const notice =
    o.notice_recipients === null || o.notice_recipients.length === 0
      ? 'nobody is asked or told'
      : `nobody is asked; a notice is owed to ${o.notice_recipients.join(', ')} before it runs`;
  return `${row.id} ${row.tool} on ${row.resource}: ${grade}; ${notice}.`;
}

export function renderReplay(result: ReplayResult, opts: RenderOptions = {}): string {
  const words = opts.words ?? loadReplayData().words;
  const label = opts.policyLabel ?? 'with the harness policy';
  const lines: string[] = [result.first_line];
  lines.push(
    ...wrap(
      `Key ${hex8(result.run.fingerprint)} (T0, development only) was made for this run and discarded. ` +
        `Cases: ${result.rows.length}, copied from ${result.provenance.cases.copied_from} ` +
        `at ${result.provenance.cases.engine_commit.slice(0, 7)}; the AI agent obeys every injection.`,
      WIDTH,
    ),
  );
  if (opts.note !== undefined) lines.push(...wrap(opts.note, WIDTH));
  lines.push(...wrap(`Column A, without ZIFFER: ${WITHOUT_POLICY}.`, WIDTH));
  lines.push('');
  lines.push(...table(['case', 'injection', 'tool', 'without ZIFFER', label]));
  lines.push('-'.repeat(WIDTH));
  for (const row of result.rows) {
    lines.push(...table([row.id, fiveWords(row.injection), row.tool, 'executes', columnB(row.outcome, result.run.fingerprint, words)]));
  }
  const own = result.own;
  if (hasOwnCase(own)) {
    // The tool's real name, never the bundle's key (ACP-454: three servers
    // exposing execute_sql made the key execute_sql_2, which no person wrote).
    lines.push(...table(['own', `your tool on ${own.server}`, own.original_name, own.without, columnB(own.outcome, result.run.fingerprint, words)]));
    lines.push(...wrap(own.label, WIDTH - 7).map((l) => `${' '.repeat(7)}${l}`));
  } else if (own !== undefined && 'absent' in own) {
    lines.push(...wrap(own.reason, WIDTH - 7).map((l) => `${' '.repeat(7)}${l}`));
  }
  lines.push('-'.repeat(WIDTH));
  const through = result.rows.map(whyAllowed).filter((s): s is string => s !== undefined);
  if (through.length > 0) {
    lines.push('Not stopped by this policy:');
    for (const s of through) lines.push(...wrap(s, WIDTH - 2).map((l) => `  ${l}`));
  }
  if (result.rows.some((r) => r.outcome.kind === 'held') || (hasOwnCase(own) && own.outcome.kind === 'held')) {
    lines.push(
      ...wrap(
        `Held: the action waits until ${result.quorum_k} approvers sign; no receipt exists before they do. ` +
          "This replay does not check the AI agent's own permissions.",
        WIDTH,
      ),
    );
  }
  return lines.join('\n');
}
