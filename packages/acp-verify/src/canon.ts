/**
 * AT-8a -- the canonical bytes, the third writing of one encoding.
 *
 * The engine's two: `reference/src/acp_executor.py::canon` (json.dumps,
 * sort_keys, separators (",", ":"), ensure_ascii=False) and
 * `crates/acp-decision/src/receipt.rs::canon` (sorted keys at every depth,
 * scalars through serde's writer). `fixtures/canon_vectors.json` holds bytes
 * the ENGINE's own canon produced, and tools/check-verify-mirror.py re-derives
 * them against the engine at the pin -- so this file agreeing with the fixture
 * is this file agreeing with the engine, not with a transcription of it.
 *
 * # Key order is CODE-POINT order, sorted here, at every depth
 *
 * Python's `sort_keys=True` sorts str by code point; Rust sorts `&str` by
 * UTF-8 bytes, which is the same order. JavaScript's default string comparison
 * is by UTF-16 CODE UNIT, which disagrees for exactly one region: an astral
 * character (>= U+10000) encodes as a surrogate pair starting at 0xD800, so it
 * sorts BEFORE U+E000..U+FFFF instead of after. `compareCodePoints` below is
 * written out for that reason, and the fixture's
 * `astral_keys_sort_by_code_point_not_utf16_unit` case is red under a naive
 * `keys.sort()`. Sorting is done HERE, never by trusting object insertion
 * order -- the ACP-126 lesson (a map that is sorted "by construction" is
 * sorted in exactly one build configuration) applies to JS objects verbatim:
 * they preserve insertion order, and integer-like keys don't even do that.
 *
 * # Numbers: safe integers ONLY, and this is a disclosed divergence
 *
 * The engine accepts a float NESTED in a structure (top-level only is refused)
 * -- the ACP-75 bug-for-bug agreement between Python and Rust. This
 * implementation cannot join that agreement honestly: JSON.parse collapses
 * `1000.0` and `1000` into one value, and Python/serde render the first as
 * "1000.0" while JS would render "1000" -- silently different signed bytes for
 * bytes the engine accepted. Guessing would be a forgery of the preimage, so
 * a non-integer number is REFUSED here at any depth (AT-8a, fail closed).
 * No conforming wire receipt carries one: every temporal field is an RFC 3339
 * string since v1.3.28 (ACP-167). The same rule refuses integers outside
 * Number.MAX_SAFE_INTEGER, where JSON.parse has already lost the digits the
 * engine would have signed (the ACP-54 integer-domain family, reached from the
 * JS side). Both refusals are pinned by tests so the divergence cannot vanish
 * silently.
 */

import { CLAUSE_CANONICAL } from './clauses.js';
import { Refusal } from './refusal.js';

/** What a parsed JSON document can be. `unknown` is narrowed at the walk. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Code-point comparison -- Python's `sorted()` over str, Rust's `&str` `Ord`.
 *
 * Iterating a string with `for..of` yields whole code points (surrogate pairs
 * arrive as one unit), so comparing `codePointAt(0)` per step IS code-point
 * order; the loop exists because `<` on the full strings would be UTF-16 order.
 */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const na = ia.next();
    const nb = ib.next();
    if (na.done && nb.done) return 0;
    if (na.done) return -1;
    if (nb.done) return 1;
    const ca = na.value.codePointAt(0);
    const cb = nb.value.codePointAt(0);
    // codePointAt(0) on a non-empty string cannot be undefined; the guard is
    // for the type system, and refusing loudly beats a silent NaN comparison.
    if (ca === undefined || cb === undefined) {
      throw new Refusal(CLAUSE_CANONICAL, 'key is not a comparable string');
    }
    if (ca !== cb) return ca - cb;
  }
}

// A type predicate, not an `as` cast (the project rules forbid the cast, and
// here it would be load-bearing): null and arrays are handled before this is
// consulted, so what remains of `object` is a plain key-value record.
function isPlainObject(v: unknown): v is { [key: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function writeCanon(value: unknown, out: string[]): void {
  if (value === null || value === true || value === false) {
    out.push(String(value));
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      // Both halves of the disclosed divergence in the module doc: a float at
      // ANY depth (the engine refuses top-level only), and an integer beyond
      // 2^53-1 (JSON.parse already lost digits the engine would have signed).
      throw new Refusal(
        CLAUSE_CANONICAL,
        'number is not a safe integer: JS cannot reproduce the engine canon bytes for it',
      );
    }
    // A JSON `-0` parses to negative zero here and to integer zero in Python
    // and serde; String(-0) is "0", so all three emit the same byte. Noted so
    // nobody "fixes" this to preserve the sign JS kept and JSON did not.
    out.push(String(value));
    return;
  }
  if (typeof value === 'string') {
    // JSON.stringify escapes exactly what Python's ensure_ascii=False and
    // serde_json escape: the quote, the backslash, \b \t \n \f \r, and other
    // control chars as \u00xx -- everything else travels as raw UTF-8. The
    // fixture's control-char and astral cases hold all three to it.
    out.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      writeCanon(value[i], out);
    }
    out.push(']');
    return;
  }
  if (isPlainObject(value)) {
    const obj = value;
    const keys = Object.keys(obj).sort(compareCodePoints);
    out.push('{');
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key === undefined) continue; // unreachable; index is in range
      if (i > 0) out.push(',');
      out.push(JSON.stringify(key));
      out.push(':');
      writeCanon(obj[key], out);
    }
    out.push('}');
    return;
  }
  // undefined, functions, bigints, symbols: not JSON, not encodable.
  throw new Refusal(CLAUSE_CANONICAL, `type ${typeof value} is not canonically encodable`);
}

/**
 * The canonical UTF-8 bytes of a parsed JSON value.
 *
 * One encoding for BOTH signing preimages and id derivation, exactly as the
 * reference states it: sorted keys, no whitespace, no floats, raw UTF-8.
 */
export function canon(value: unknown): Uint8Array {
  const out: string[] = [];
  writeCanon(value, out);
  return new TextEncoder().encode(out.join(''));
}
