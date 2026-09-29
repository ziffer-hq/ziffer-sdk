/**
 * `--json` (ACP-439): the ScanResult verbatim, keys sorted at every depth, two
 * spaces. Sorted rather than in declaration order because the order must not
 * depend on which module built an object; clause ids and status words are here
 * in full, which is where a program reads them.
 */

import type { ScanResult } from '../types.js';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys(Reflect.get(value, key));
    }
    return out;
  }
  return value;
}

export function renderJson(result: ScanResult): string {
  return sortedJson(result);
}

/** Any value in `--json`'s form: keys sorted at every depth, two spaces, one trailing newline. */
export function sortedJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}
