/**
 * Wire-value predicates shared by the receipt gate and the §9.3 step 7b quorum.
 *
 * They live here rather than in `verify.ts` for one reason: `quorum.ts` needs
 * every one of them, `verify.ts` imports `quorum.ts`, and a second copy in the
 * quorum would be two definitions of WE-4 in one package -- the encoding-split
 * defect at the source level, in the exact rule whose whole point is that one
 * nonce has one spelling. `verify.ts` re-exports these so the published surface
 * is unchanged.
 */

/** The one wire nonce size, 128-bit (`Nonce128`, cited by AT-1 and L-17). */
export const NONCE128_BYTES = 16;

/**
 * `"b64:"` plus base64 of 16 bytes: 4 + 24.
 *
 * Counted, never decoded -- a rule whose behaviour on bad input is "throw" is
 * not a refusal, and the reference learned that the hard way (its first
 * spelling decoded the body, which raises on the URL-safe alphabet).
 */
export const NONCE128_LEN = 4 + Math.ceil(NONCE128_BYTES / 3) * 4;

/**
 * WE-4: is this the ASCII string `b64:` followed by RFC 4648 §4 base64, WITH
 * padding? Ported from `quorum.rs::is_we4_b64` -- the body is whole
 * four-character groups, the alphabet is §4's (`+` and `/`, never §5's `-` and
 * `_`), and `=` appears only as one or two characters at the very end.
 *
 * Rejected, never normalised: normalising would make this verifier accept two
 * spellings of one value, which is how one nonce comes to hold two ledger slots
 * (ACP-87) and how one attestation comes to hold two ids.
 */
export function isWe4B64(s: string): boolean {
  if (!s.startsWith('b64:')) return false;
  const body = s.slice(4);
  if (body.length % 4 !== 0) return false;
  let pad = 0;
  for (let i = body.length - 1; i >= 0 && body[i] === '='; i -= 1) pad += 1;
  if (pad > 2) return false;
  for (let i = 0; i < body.length - pad; i += 1) {
    const c = body.charCodeAt(i);
    const alnum =
      (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (!alnum && c !== 0x2b /* + */ && c !== 0x2f /* / */) return false;
  }
  return true;
}

/** A parsed JSON object, narrowed by a predicate rather than an `as` cast. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string field of a parsed object, or null -- never a coerced value. */
export function strField(v: Record<string, unknown>, key: string): string | null {
  const raw = v[key];
  return typeof raw === 'string' ? raw : null;
}

/**
 * RFC 4648 §4 base64 with padding, decoded. The carrier WE-4 declares.
 *
 * Returns null rather than throwing, and is called only after
 * {@link isWe4B64} has accepted the string: the type check is the refusal, and
 * this is the decode that follows it.
 */
export function b64Decode(s: string): Uint8Array | null {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (s.length === 0 || s.length % 4 !== 0) return null;
  let pad = 0;
  while (pad < 2 && s[s.length - 1 - pad] === '=') pad += 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length - pad; i += 1) {
    const v = A.indexOf(s[i] ?? '');
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}
