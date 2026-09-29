/**
 * A named refusal, mirroring the engine's `acp_decision::Refusal` and the
 * reference's `FailClosed(clause, msg)`.
 *
 * Thrown, not returned: the Python SDK's `verify()` raises `RefusedError` and
 * this package's `verifyReceipt` is its TS sibling. A refusal carries two
 * identifiers and they answer two different readers:
 *
 * - `name` (`ReceiptNotBoundToProposal`) is what a developer reads first: what
 *   is wrong with the receipt, from their side. It is also the error's `name`,
 *   so `String(refusal)` and an uncaught stack both lead with it.
 * - `clause` (`9.3-3`) is the specification's rule, spelled exactly as the
 *   engine's Rust constants spell it. It is the value the three
 *   implementations are compared on, and it has not changed: code that reads
 *   `clause` reads what it always read.
 *
 * The printed line is `Name: meaning (clause)`, identical to the Python SDK's
 * for the same refusal (`fixtures/refusal-lines.json` holds both to it).
 * `detail` is the check's own account of the input, for a person debugging;
 * it is never part of the contract.
 *
 * Both tables come from ONE list, `refusals.json`, through the generated
 * `refusal-names.ts`; a clause this build has no name for (a newer engine's)
 * is still a refusal, and says so by name: `UnnamedRefusal`.
 */

import { REFUSALS, UNNAMED_REFUSAL, type RefusalName } from './refusal-names.js';

export { REFUSALS, UNNAMED_REFUSAL, type RefusalEntry, type RefusalName } from './refusal-names.js';

/** What a refusal resolves to: its name, what it means, and what to do. */
export interface RefusalText {
  readonly name: string;
  readonly meaning: string;
  readonly action: string;
}

/**
 * The name, meaning and action for a clause. `name` is honoured only when it
 * belongs to the clause: a clause with several names (9.3-5) is named at the
 * site that raises it, and a name from another clause never relabels one.
 * With no name, a clause resolves to its first entry. An unknown clause
 * resolves to `UnnamedRefusal`, never to `undefined` and never to a throw.
 */
export function refusalText(clause: string, name?: string): RefusalText {
  const own = REFUSALS.filter((entry) => entry.clause === clause);
  const chosen = own.find((entry) => entry.name === name) ?? own[0];
  return chosen ?? UNNAMED_REFUSAL;
}

/** True for a string that is one of the list's names: narrows it for the constructor. */
export function isRefusalName(name: string): name is RefusalName {
  return REFUSALS.some((entry) => entry.name === name);
}

/** Every entry carrying a clause, in list order. Empty for an unknown clause. */
export function refusalsForClause(clause: string): readonly RefusalText[] {
  return REFUSALS.filter((entry) => entry.clause === clause);
}

/** The printed line, `Name: meaning (clause)`: the one form both SDKs print. */
export function refusalLine(clause: string, name?: string): string {
  const text = refusalText(clause, name);
  return `${text.name}: ${sentenceBody(text.meaning)} (${clause})`;
}

/** A meaning sentence as it reads after `Name: `: first letter lowered, final stop dropped. */
function sentenceBody(meaning: string): string {
  const body = meaning.endsWith('.') ? meaning.slice(0, -1) : meaning;
  return body.slice(0, 1).toLowerCase() + body.slice(1);
}

export class Refusal extends Error {
  /** The clause id, spelled exactly as the engine's Rust constants spell it. */
  readonly clause: string;
  /** One sentence: what the refusal means. */
  readonly meaning: string;
  /** What the developer does about it. */
  readonly action: string;
  /** The failing check's own account of the input. Not part of the contract. */
  readonly detail: string;

  constructor(clause: string, detail: string, name?: RefusalName) {
    const text = refusalText(clause, name);
    super(`${sentenceBody(text.meaning)} (${clause})`);
    this.name = text.name;
    this.clause = clause;
    this.meaning = text.meaning;
    this.action = text.action;
    this.detail = detail;
  }

  /** `Name: meaning (clause)`, the line both SDKs print for this refusal. */
  get line(): string {
    return `${this.name}: ${this.message}`;
  }
}
