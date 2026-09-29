/**
 * AT-8a canonical CBOR (RFC 8949 §4.2) -- the ONE primitive this package did
 * not already have, added for §8.6c and for nothing else.
 *
 * # Why a new module rather than a reused one
 *
 * `canon.ts` is the canonical JSON encoding, and it is the right preimage for
 * every hash this verifier takes: the engine's `attestation_id` and AB-1 entry
 * digest are `sha256:` over `acp_executor.canon` / `receipt.rs::canon`, both
 * JSON, and this package reproduces those bytes. What CBOR is needed for is
 * narrower and unavoidable: HM-3 says a human attester's assertion is canonical
 * CBOR of `{authenticator_data, client_data_json, signature}`, and HM-1 says the
 * credential's `public_key` is a COSE_Key, which is CBOR by RFC 9052. Those two
 * byte strings arrive from the wire and must be DECODED; no JSON encoder can
 * read them. So this is a decoder for two fixed shapes, not a general codec.
 *
 * The engine's twins are `crates/acp-crypto/src/cbor.rs` and
 * `reference/src/acp_crypto.py`'s `_enc` / `_dec` / `decode_canonical`, and the
 * rule this file takes from them verbatim is the last one:
 *
 * # Canonicity is proved by RE-ENCODING, not by a list of sub-rules
 *
 * {@link decodeCanonical} parses, re-encodes what it parsed, and refuses the
 * input unless the two byte strings are identical. That single comparison
 * carries every §4.2 requirement at once -- shortest-form arguments, definite
 * lengths, map keys sorted by their ENCODED bytes, no duplicate keys -- and it
 * cannot drift from the encoder the way a hand-written checklist of those rules
 * can. The decoder still refuses the coarse violations itself (indefinite
 * lengths, non-shortest arguments, reserved additional information) because a
 * decoder that accepted them would have to invent a canonical form to compare
 * against, and inventing one is normalising.
 *
 * Refused, never normalised (AT-8a): the AB-1 entry digest is taken over the
 * bytes that arrived, so a second encoding of one assertion is a second digest
 * for one human decision, and accepting both would put two receipt identities
 * behind one approval -- the Z4 encoding split, reached through the assertion.
 *
 * # Floats and tags are absent on purpose
 *
 * Neither is encodable, so neither is decodable: a float has several
 * representations of one value and no deterministic ordering story (WE-1), and
 * a tag is a type this verifier has no shape for. They refuse as
 * {@link CborError} rather than being skipped, because a decoder that silently
 * ignores what it does not understand is a parser an attacker can steer.
 */

/** The input is not canonical CBOR, or is not CBOR at all. */
export class CborError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CborError';
  }
}

/**
 * What this decoder can produce. Deliberately NOT a general CBOR value type:
 * a map key is an integer (COSE labels, RFC 9052 §7) or text (HM-3's three
 * fields), and nothing here needs more.
 */
export type Cbor = boolean | null | bigint | Uint8Array | string | Cbor[] | CborMap;

/**
 * A CBOR map, kept as ordered entries rather than a JS object.
 *
 * An object would key everything by string and collapse the integer label `1`
 * and the text key `"1"` into one entry -- two distinct CBOR values, and in
 * COSE_Key the integer form is the only legal one. The order is the order the
 * bytes carried, which the re-encode check has already proved canonical.
 */
export interface CborMap {
  readonly entries: readonly (readonly [Cbor, Cbor])[];
}

function isCborMap(v: Cbor): v is CborMap {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

/** Whether a decoded value is a map -- the narrowing the callers need. */
export function cborIsMap(v: Cbor): v is CborMap {
  return isCborMap(v);
}

/** A map's keys, in the (canonical) order the bytes carried. */
export function cborKeys(m: CborMap): Cbor[] {
  return m.entries.map(([k]) => k);
}

/** The value at an integer label, or undefined. COSE_Key's accessor. */
export function cborGetInt(m: CborMap, label: bigint): Cbor | undefined {
  for (const [k, v] of m.entries) if (typeof k === 'bigint' && k === label) return v;
  return undefined;
}

/** The value at a text key, or undefined. The assertion map's accessor. */
export function cborGetText(m: CborMap, key: string): Cbor | undefined {
  for (const [k, v] of m.entries) if (typeof k === 'string' && k === key) return v;
  return undefined;
}

/** A decoded value as bytes, or null if it is not a byte string. */
export function cborAsBytes(v: Cbor | undefined): Uint8Array | null {
  return v instanceof Uint8Array ? v : null;
}

const MAJOR_UINT = 0;
const MAJOR_NINT = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_SIMPLE = 7;

/**
 * RFC 8949 §4.2.1: the argument MUST use the shortest form that holds it.
 *
 * `bigint` throughout rather than `number`, because a CBOR argument is a full
 * 64-bit unsigned integer and `number` loses digits past 2^53-1 -- the same
 * defect `canon.ts` refuses on the JSON side, and here it would mean re-encoding
 * a length to different bytes than arrived and calling the input non-canonical
 * for the decoder's own reason.
 */
function encodeHead(major: number, value: bigint, out: number[]): void {
  const head = major << 5;
  if (value < 24n) {
    out.push(head | Number(value));
    return;
  }
  let width: number;
  if (value < 0x100n) {
    out.push(head | 24);
    width = 1;
  } else if (value < 0x10000n) {
    out.push(head | 25);
    width = 2;
  } else if (value < 0x100000000n) {
    out.push(head | 26);
    width = 4;
  } else if (value < 0x10000000000000000n) {
    out.push(head | 27);
    width = 8;
  } else {
    throw new CborError('integer exceeds the 64-bit CBOR argument');
  }
  for (let i = width - 1; i >= 0; i -= 1) {
    out.push(Number((value >> BigInt(i * 8)) & 0xffn));
  }
}

function encodeInto(value: Cbor, out: number[]): void {
  if (value === true) {
    out.push(0xf5);
    return;
  }
  if (value === false) {
    out.push(0xf4);
    return;
  }
  if (value === null) {
    out.push(0xf6);
    return;
  }
  if (typeof value === 'bigint') {
    if (value >= 0n) encodeHead(MAJOR_UINT, value, out);
    else encodeHead(MAJOR_NINT, -value - 1n, out);
    return;
  }
  if (value instanceof Uint8Array) {
    encodeHead(MAJOR_BYTES, BigInt(value.length), out);
    for (const b of value) out.push(b);
    return;
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    encodeHead(MAJOR_TEXT, BigInt(bytes.length), out);
    for (const b of bytes) out.push(b);
    return;
  }
  if (Array.isArray(value)) {
    encodeHead(MAJOR_ARRAY, BigInt(value.length), out);
    for (const item of value) encodeInto(item, out);
    return;
  }
  if (isCborMap(value)) {
    // §4.2.1: keys sorted by their ENCODED bytes, bytewise lexicographic.
    // Sorting by the decoded value would put the integer label -2 and the text
    // key "x" in an order that depends on the comparison chosen rather than on
    // the bytes, and the encoded order is the one the rule names.
    const keyed = value.entries.map(([k, v]) => {
      const kb: number[] = [];
      encodeInto(k, kb);
      return { kb, v };
    });
    keyed.sort((a, b) => compareBytes(a.kb, b.kb));
    for (let i = 1; i < keyed.length; i += 1) {
      const prev = keyed[i - 1];
      const cur = keyed[i];
      if (prev === undefined || cur === undefined) continue; // unreachable; index in range
      if (compareBytes(prev.kb, cur.kb) === 0) throw new CborError('duplicate map key');
    }
    encodeHead(MAJOR_MAP, BigInt(keyed.length), out);
    for (const { kb, v } of keyed) {
      for (const b of kb) out.push(b);
      encodeInto(v, out);
    }
    return;
  }
  throw new CborError('value is not canonically encodable');
}

function compareBytes(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) continue; // unreachable; index in range
    if (x !== y) return x - y;
  }
  return a.length - b.length;
}

/** The canonical CBOR bytes of a value. Used by {@link decodeCanonical}'s proof. */
export function cborEncode(value: Cbor): Uint8Array {
  const out: number[] = [];
  encodeInto(value, out);
  return Uint8Array.from(out);
}

interface Decoded {
  readonly value: Cbor;
  readonly next: number;
}

function decodeAt(buf: Uint8Array, start: number): Decoded {
  if (start >= buf.length) throw new CborError('truncated');
  const ib = buf[start];
  if (ib === undefined) throw new CborError('truncated'); // unreachable; bound checked
  const major = ib >> 5;
  const ai = ib & 0x1f;
  let i = start + 1;
  let value: bigint;
  if (ai < 24) {
    value = BigInt(ai);
  } else if (ai <= 27) {
    const width = 1 << (ai - 24);
    if (i + width > buf.length) throw new CborError('truncated argument');
    value = 0n;
    for (let k = 0; k < width; k += 1) {
      const b = buf[i + k];
      if (b === undefined) throw new CborError('truncated argument'); // unreachable
      value = (value << 8n) | BigInt(b);
    }
    i += width;
    // Shortest form (§4.2.1). Refused here as well as by the re-encode proof,
    // because the value that re-encodes shorter would otherwise be decoded
    // first and any shape check above would run on attacker-chosen bytes.
    const floor = ai === 24 ? 24n : 1n << BigInt((width / 2) * 8);
    if (value < floor) throw new CborError('non-shortest argument');
  } else if (ai === 31) {
    throw new CborError('indefinite length forbidden in canonical CBOR');
  } else {
    throw new CborError(`reserved additional information ${ai}`);
  }

  switch (major) {
    case MAJOR_UINT:
      return { value, next: i };
    case MAJOR_NINT:
      return { value: -value - 1n, next: i };
    case MAJOR_BYTES:
    case MAJOR_TEXT: {
      const len = Number(value);
      if (!Number.isSafeInteger(len) || i + len > buf.length) {
        throw new CborError('truncated string');
      }
      const slice = buf.subarray(i, i + len);
      if (major === MAJOR_BYTES) return { value: Uint8Array.from(slice), next: i + len };
      // fatal: true -- invalid UTF-8 is a refusal, not a run of U+FFFD. A
      // replacement character would make two distinct byte strings decode to
      // one text value, which the re-encode proof would then report as
      // non-canonical for the wrong reason.
      return { value: new TextDecoder('utf-8', { fatal: true }).decode(slice), next: i + len };
    }
    case MAJOR_ARRAY: {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n > buf.length - i) throw new CborError('truncated array');
      const items: Cbor[] = [];
      for (let k = 0; k < n; k += 1) {
        const d = decodeAt(buf, i);
        items.push(d.value);
        i = d.next;
      }
      return { value: items, next: i };
    }
    case MAJOR_MAP: {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n > buf.length - i) throw new CborError('truncated map');
      const entries: (readonly [Cbor, Cbor])[] = [];
      for (let k = 0; k < n; k += 1) {
        const key = decodeAt(buf, i);
        const val = decodeAt(buf, key.next);
        entries.push([key.value, val.value]);
        i = val.next;
      }
      return { value: { entries }, next: i };
    }
    case MAJOR_SIMPLE:
      if (value === 20n) return { value: false, next: i };
      if (value === 21n) return { value: true, next: i };
      if (value === 22n) return { value: null, next: i };
      throw new CborError('float or unsupported simple value');
    default:
      throw new CborError(`unsupported major type ${major}`);
  }
}

/**
 * AT-8a: parse AND prove canonicity. Any input that is not byte-identical to
 * the canonical encoding of what it decodes to is REFUSED, never normalised.
 *
 * The engine's `decode_canonical` in one sentence, and the same sentence is the
 * whole specification of this function.
 */
export function decodeCanonical(buf: Uint8Array): Cbor {
  const { value, next } = decodeAt(buf, 0);
  if (next !== buf.length) throw new CborError('trailing bytes');
  const re = cborEncode(value);
  if (re.length !== buf.length || !re.every((b, i) => b === buf[i])) {
    throw new CborError('input is not the canonical encoding of its value');
  }
  return value;
}
