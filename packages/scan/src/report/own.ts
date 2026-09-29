/**
 * The shapes the one-screen report reads from its sibling modules (ACP-452),
 * checked structurally, never cast.
 *
 * `hasOwnCase` is the replay module's guard (ACP-451), re-exported: one shape,
 * one definition. `isOwnAbsent` and `ownOf` read the same field's other arm.
 * `hasReview`: the paths the `--report` flag wrote (ACP-443), set by the CLI on
 * the object it passes to `renderTerminal`.
 */

import type { OwnAbsent } from '../replay/own.js';

export { hasOwnCase } from '../replay/own.js';

function isObject(x: unknown): x is object {
  return typeof x === 'object' && x !== null;
}

function field(x: object, key: string): unknown {
  return Reflect.get(x, key);
}

export function isOwnAbsent(x: unknown): x is OwnAbsent {
  return isObject(x) && field(x, 'absent') === true && typeof field(x, 'reason') === 'string';
}

/** The `own` field of a replay result, whatever the result's declared type. */
export function ownOf(replay: unknown): unknown {
  return isObject(replay) ? field(replay, 'own') : undefined;
}

export function hasReview(x: unknown): x is { review: { archive: string; report: string } } {
  if (!isObject(x)) return false;
  const review = field(x, 'review');
  return isObject(review) && typeof field(review, 'archive') === 'string' && typeof field(review, 'report') === 'string';
}
