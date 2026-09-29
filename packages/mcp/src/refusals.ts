/**
 * `explain_refusal` — a refusal name in, what it means and what to do out
 * (ACP-392 item 2).
 *
 * `docs/onboarding/support.md` section 4 already holds that table, one row
 * per refusal: what it means, who fixes it, what to do now. This module is a
 * reader over that table and holds none of its own. Nothing here paraphrases
 * a row, and no row is written here — `tools/check-support-doc.py` holds the
 * table to the four sources that publish its names, two onboarding documents
 * and the two Rust surfaces below, and a second copy in TypeScript would be
 * the copy that stops agreeing with all of them.
 *
 * # What this slice found, and what closed it
 *
 * ACP-392 asked for "a test asserts every refusal name the gateway can emit
 * has a row". Deriving that set from the source that emits it —
 * `services/gateway/src/gateway.rs`'s `error_name`, the Policy Engine's
 * `clause` module and its attestation refusals — and comparing it against the
 * table gave an intersection of **nothing at all**: 35 names, no rows. The
 * table's 31 rows were the refusals a customer's OWN code raises, what
 * `verify` refuses on (`sdk.md` section 5) and what the Executor alerts about
 * (`executor.md` section 6), and every name that comes out of OUR side of the
 * wire — the 400 for a malformed body, the 403 for a tenant mismatch, the
 * `8.4-3` in a refused decision's `clause` — had none.
 *
 * That gap was REPORTED rather than closed in code, because closing it meant
 * writing what an admin should do about thirty-five refusals and that advice
 * is a person's to write. ACP-393 is that person's work: the 35 rows are in
 * `support.md` section 4, and `tools/check-support-doc.py` now reads the same
 * three Rust files this module's emitters come from, so the table is held to
 * the CODE both ways rather than to a list somebody transcribed.
 *
 * {@link UNTABLED} is therefore EMPTY, and it stays. It is asserted EQUAL to
 * the set `refusals.test.ts` derives itself — both directions, ACP-299's rule
 * — so a refusal name added to an emitter and to no table goes red naming it,
 * and a name pinned here that stopped needing a pin goes red too. The empty
 * array is the claim that there is nothing left to pin, made in the one place
 * a test can read it.
 *
 * # An unknown name is refused, never guessed at
 *
 * There is no fuzzy match and no "did you mean". A model that asked about
 * `TenantMismatched` and was handed `TenantMismatch`'s row would act on the
 * answer to a question it did not ask, and this tool exists precisely for the
 * moment when a developer is trying to understand why something was refused.
 */

import { refusalsForClause } from '@ziffer-io/verify';

import {
  ONBOARDING_DOCS,
  REFUSAL_EMITTERS,
  REFUSAL_TABLE_MARKER,
  SUPPORT_DOC_PATH,
  type RefusalEmitter,
} from './generated/docs-source.js';
import { attribution, rank } from './docs.js';
import { FAILURE_KEYS, PUBLISH_WORKFLOW } from './publish-explain.js';
import type { ToolOutcome } from './tools.js';

/** Where a customer reads the support table: the published guide, never a path of ours. */
export const SUPPORT_GUIDE = 'the support guide, https://ziffer.io/docs/support';

/** One row of `support.md` section 4. */
export interface RefusalRow {
  /** The refusal name, as the table backticks it. */
  readonly name: string;
  /** Which document publishes it: the table's `documented in` cell. */
  readonly documentedIn: string;
  readonly meaning: string;
  /** One of `you`, `us`, `you and us` — the table's closed domain. */
  readonly whoFixes: string;
  readonly whatToDo: string;
  /** The specification rule it is refused under, as the table's `Rule` cell
   * links it (`9.3-3`), or `undefined` for a row that names no rule. */
  readonly rule: string | undefined;
  /** The link to that rule's section of the specification. */
  readonly ruleUrl: string | undefined;
}

/** A table that could not be read at all. Distinct from "no row for that
 * name": one is a question with no answer, the other is this package having
 * shipped without the document it serves. */
export class RefusalTableError extends Error {
  override readonly name: string;

  constructor(name: string, detail: string) {
    super(`${name}: ${detail}`);
    this.name = name;
  }
}

const BACKTICKED = /`([^`]+)`/;
/** A `Rule` cell: `[9.3-3](https://…#section)`. `—` for a row naming no rule. */
const RULE_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

/**
 * Section 4's table, parsed out of the embedded `support.md`.
 *
 * Located by {@link REFUSAL_TABLE_MARKER} and not by a heading, which is
 * `check-support-doc.py`'s choice and its reason: a heading is prose and gets
 * reworded, and the marker is the document saying "this is the table" in its
 * own bytes. The build refuses a `support.md` that lost the marker, so the
 * throw below is unreachable through a build and is kept for a test that
 * hands this reader a document the build script never saw.
 *
 * @throws RefusalTableError when the marker or the table is gone.
 */
export function refusalTable(): readonly RefusalRow[] {
  const doc = ONBOARDING_DOCS.find((candidate) => candidate.path === SUPPORT_DOC_PATH);
  if (doc === undefined) {
    throw new RefusalTableError(
      'SupportDocAbsent',
      `${SUPPORT_DOC_PATH} is not among the embedded documents.`,
    );
  }
  const at = doc.markdown.indexOf(REFUSAL_TABLE_MARKER);
  if (at === -1) {
    throw new RefusalTableError(
      'RefusalTableUnmarked',
      `${SUPPORT_DOC_PATH} carries no ${REFUSAL_TABLE_MARKER}.`,
    );
  }
  const rows: RefusalRow[] = [];
  for (const line of doc.markdown.slice(at).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      // The table ends at the first line that is not a row. Everything after
      // it in that document is section 5 and beyond.
      if (rows.length > 0) break;
      continue;
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length !== 6) continue;
    if (cells.every((cell) => /^[-: ]*$/.test(cell))) continue; // the separator
    const named = BACKTICKED.exec(cells[0] ?? '');
    if (named === null) continue; // the header row
    const rule = RULE_LINK.exec(cells[5] ?? '');
    rows.push({
      name: named[1] ?? '',
      meaning: cells[1] ?? '',
      whatToDo: cells[2] ?? '',
      whoFixes: cells[3] ?? '',
      documentedIn: cells[4] ?? '',
      rule: rule === null ? undefined : rule[1],
      ruleUrl: rule === null ? undefined : rule[2],
    });
  }
  if (rows.length === 0) {
    throw new RefusalTableError(
      'RefusalTableEmpty',
      `${SUPPORT_DOC_PATH}'s marked table has no rows; a lookup over it would answer nothing.`,
    );
  }
  return rows;
}

/** The sources that mint a refusal name, read out of the Rust at build time.
 * Re-exported so the test can compare them against its own reading of the
 * same files. */
export const EMITTERS: readonly RefusalEmitter[] = REFUSAL_EMITTERS;

/** Every name any emitter can produce, distinct and sorted. */
export function emittedNames(): readonly string[] {
  return [...new Set(EMITTERS.flatMap((emitter) => emitter.names))].sort();
}

/**
 * The refusal names this deployment can emit that `support.md` section 4 has
 * NO row for.
 *
 * **EMPTY since ACP-393, and that is the finding it was written to make
 * visible.** It was every one of the 35 names we emit; the rows are written
 * now, so the pin names nothing.
 *
 * Asserted EQUAL to the derived set in both directions by `refusals.test.ts`.
 * Do not edit it to make a test pass: a name appearing here that was not here
 * before means an emitter grew a refusal and the question is whether a
 * customer handed it would know what to do. A name that has to be REMOVED
 * means somebody wrote the row, which is the outcome this pin exists to make
 * visible — and removing it is what proved the fix the one time it happened.
 */
export const UNTABLED: readonly string[] = [];

/** The one sentence a caller is told about that gap, written once.
 *
 * Unreachable while {@link UNTABLED} is empty, which is the state ACP-393 put
 * the table in and the completeness test holds it in. It is kept because the
 * branch it belongs to is what the NEXT refusal added to an emitter must land
 * on: falling through to `RefusalUnknown` instead would tell a developer the
 * name they were handed does not exist. */
const UNTABLED_DISCLOSURE =
  `The support table (${SUPPORT_GUIDE}, section 4) carries no row for it. Nothing is wrong ` +
  'with your call: send_feedback or hello@ziffer.io gets you the answer.';

/** One row's cells as the tool prints them: meaning, owner, action, and the rule. */
function rowLines(row: RefusalRow): string[] {
  return [
    ...(row.rule === undefined ? [] : [`${row.name} (rule ${row.rule}: ${row.ruleUrl ?? ''})`]),
    `what it means: ${row.meaning}`,
    `who fixes it:  ${row.whoFixes}`,
    `what to do now: ${row.whatToDo}`,
  ];
}

/** The row for one name, or `undefined`. Exact, never fuzzy. */
export function rowFor(name: string): RefusalRow | undefined {
  return refusalTable().find((row) => row.name === name);
}

/** The emitters that mint one name. */
function emittersOf(name: string): readonly RefusalEmitter[] {
  return EMITTERS.filter((emitter) => emitter.names.includes(name));
}

/** Up to `limit` documentation sections that literally contain the name.
 *
 * NOT a guess about what the name means: it is where the string appears in
 * our documentation, cited so the caller can read it. `rank` is the same
 * reader `search_docs` uses, so a section it finds here is a section that
 * tool would return. */
function documented(name: string, limit: number): readonly string[] {
  return rank(name)
    .slice(0, limit)
    .map((entry) => attribution(entry.section));
}

/**
 * Explain one refusal name.
 *
 * Three answers and each is named on its first line, so a model can branch
 * without reading prose:
 *
 *   * the table has a row — it is served, plus where it is documented;
 *   * we emit the name and the table has no row — `RefusalUndocumented`,
 *     naming the source that mints it and the sections that mention it. Not
 *     an error: the tool looked, the name is real, and what is missing is
 *     ours. Nothing reaches this branch today ({@link UNTABLED} is empty) and
 *     it is kept for the next emitter name that arrives before its row;
 *   * nothing knows the name — `RefusalUnknown`, and that IS an error,
 *     because the argument was wrong. No nearest match is offered: a model
 *     handed the row for a name it did not ask about would act on it.
 */
export function explainRefusal(name: string): ToolOutcome {
  const wanted = name.trim();
  if (wanted === '') {
    return {
      text:
        'RefusalNameEmpty: give the refusal name exactly as you were handed it — the `refusal_category` ' +
        'member of a decision, the `error` member of a 4xx body, or the clause id in an ' +
        'Executor alert.',
      isError: true,
    };
  }

  let table: readonly RefusalRow[];
  try {
    table = refusalTable();
  } catch (error) {
    // Unreachable through a build (the embed step refuses the same
    // condition). Reported rather than thrown: an agent gets tool results,
    // not stack traces.
    return {
      text: error instanceof RefusalTableError ? error.message : String(error),
      isError: true,
    };
  }

  const row = table.find((candidate) => candidate.name === wanted);
  // A rule the receipt verifier raises, asked for by its number (`9.3-3`):
  // answered with every name the verifier raises under it. A rule that is
  // ALSO a row of its own (`AB-1`, which the Policy Engine raises too) gets
  // that row first and the verifier's names after it.
  const named = refusalsForClause(wanted)
    .map((entry) => table.find((candidate) => candidate.name === entry.name))
    .filter((candidate): candidate is RefusalRow => candidate !== undefined);
  if (row === undefined && named.length > 0) {
    return {
      text: [
        `${wanted} — the rule the receipt verifier raises as ${named.map((r) => r.name).join(', ')}`,
        ...named.flatMap((r) => ['', ...rowLines(r)]),
        '',
        'The verifier\'s error prints the name first and the rule last, in brackets.',
        'A refusal is deterministic on the same input: fix what it names rather than retrying.',
      ].join('\n'),
      isError: false,
    };
  }
  if (row !== undefined) {
    return {
      text: [
        `${row.name} — ${row.documentedIn}`,
        '',
        ...rowLines(row),
        ...(named.length > 0
          ? [
              '',
              `The receipt verifier raises the same rule as ${named.map((r) => r.name).join(', ')}:`,
              ...named.flatMap((r) => ['', ...rowLines(r)]),
            ]
          : []),
        '',
        `Every word above is row "${row.name}" of section 4 of ${SUPPORT_GUIDE}, verbatim.`,
        'A refusal is deterministic on the same input: fix what it names rather than retrying.',
        'Where that is not true the row says so — a few answers in that table are this',
        'deployment failing to answer rather than refusing, and they name the wait.',
      ].join('\n'),
      isError: false,
    };
  }

  const sources = emittersOf(wanted);
  if (sources.length > 0) {
    const where = documented(wanted, 3);
    return {
      text: [
        `RefusalUndocumented: ${wanted} is a refusal this deployment can emit.`,
        '',
        ...sources.map((source) => `  answered by: ${source.origin} — ${source.what}`),
        '',
        `  ${UNTABLED_DISCLOSURE}`,
        '',
        ...(where.length > 0
          ? [
              '  The name does appear in our documentation. These sections carry it, and',
              '  search_docs will return them whole:',
              ...where.map((line) => `    ${line}`),
            ]
          : [
              '  No onboarding document mentions it at all, which is worse than no row.',
            ]),
        '',
        '  If you need the answer today, send_feedback puts the question in front of an',
        '  operator, and hello@ziffer.io reaches the same people.',
      ].join('\n'),
      isError: false,
    };
  }

  if (FAILURE_KEYS.includes(wanted)) {
    return {
      text: [
        `RefusalNotHere: ${wanted} is a failure of the POLICY PUBLISH pipeline, not a refusal`,
        'of the decision API, so it has no row in the support table.',
        '',
        `  explain_publish_failure is the tool for it: paste the failed run's log and it quotes`,
        `  ${PUBLISH_WORKFLOW} on what the step was and what to do.`,
      ].join('\n'),
      isError: false,
    };
  }

  return {
    text: [
      `RefusalUnknown: ${JSON.stringify(wanted)} is not a refusal name this package knows.`,
      '',
      `  It is not one of the ${table.length} rows in section 4 of ${SUPPORT_GUIDE}, and it is`,
      `  not one of the ${emittedNames().length} names our gateway and Policy Engine mint.`,
      '',
      '  No nearest match is offered on purpose: handing you the row for a name you did not',
      '  ask about would be an answer to a different question, and you are reading this',
      '  because something was refused.',
      '',
      '  Check the spelling against what you were handed — the `refusal_category` member of a decision,',
      '  the `error` member of a 4xx body, the clause id in an alert. search_docs will find',
      '  the name if we use it anywhere; send_feedback will tell us if we do not.',
    ].join('\n'),
    isError: true,
  };
}
