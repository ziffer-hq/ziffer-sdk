/**
 * The audit chain export verifier (ACP-428) -- the TypeScript reader of the
 * file the console's "Download the audit chain for this window" link gives.
 *
 * The link said the file was verifiable offline and nothing a customer held
 * verified it. The Python SDK's `verify_chain` and this function are that
 * verifier, and they are held to ONE verdict per file by the shared corpus in
 * `fixtures/chain-export/` -- the same refusal name at the same record, the
 * same recomputed last hash, the same report of what the anchors cover. The
 * check order below is the Python reader's, step for step, because on a file
 * with two defects the order decides which one is named.
 *
 * # What is recomputed, and what is only reported
 *
 * Every `chain_hash` is RECOMPUTED -- `sha256:` over the canonical bytes of the
 * record (the first record of the chain) or of `{prev, record}` (every later
 * one), the audit service's own link -- and the file's value is compared,
 * never used. Every `previous_hash` after the first row is compared against
 * the hash just recomputed. The first row's `previous_hash`, in a file that
 * starts after the beginning of the chain, is the one link this file cannot
 * recompute; it is reported as `startsAfter`, and it is checked only when an
 * anchor names exactly that position.
 *
 * # The anchor key never comes from the file
 *
 * Every anchor entry carries an `anchor_identity` beside it. Reading the key
 * from there would accept any file whose author signed their own anchors and
 * wrote their own key next to them -- the party under verification supplying
 * the value it is verified with. So the key is a parameter, from a file the
 * customer holds, and with no key every anchor is reported `unchecked`: never
 * passed, and never dropped from the report.
 *
 * # Numbers: the file's TEXT is read, not only its parsed values
 *
 * `JSON.parse` reads `1.0` as the integer 1. The record the writer hashed said
 * `1.0`, so hashing `1` would compare bytes nobody wrote and name the wrong
 * defect. The parser's reviver sees each number's source text (Node 22 and
 * later), and a number written with a fraction or an exponent becomes a value
 * the canonical encoder refuses -- `RecordNotCanonical` inside a record,
 * `ExportMalformed` in the file's own fields, exactly where the Python reader
 * says so. On a runtime whose parser does not hand the reviver the source
 * text, that one case would be named `ChainHashMismatch` instead; the file is
 * refused either way.
 */

import { createHash } from 'node:crypto';

import { canon } from './canon.js';
import { ed25519IsSmallOrder } from './ed25519.js';
import { MLDSA65_PK_LEN, verifyUnderSuite, type SignaturePart } from './sig.js';
import { isRecord } from './wire.js';

/** The one suite an audit anchor is signed under here, and the only one an anchor key may name. */
export const ANCHOR_SUITE = 'hybrid-ed25519-mldsa65';
const ANCHOR_VERSION = 1;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ED25519_PK_BYTES = 32;

/** A refusal of an export, by name, at the first record or anchor that broke. */
export class ChainRefusal extends Error {
  /** The refusal name, identical to the Python reader's `ChainRefused.name`. */
  readonly refusal: string;
  readonly seq: number | null;
  readonly anchor: number | null;

  constructor(refusal: string, detail: string, where: { seq?: number; anchor?: number } = {}) {
    super(`${refusal}: ${detail}`);
    this.name = 'ChainRefusal';
    this.refusal = refusal;
    this.seq = where.seq ?? null;
    this.anchor = where.anchor ?? null;
  }
}

/** An anchor key file that cannot be used, by name. A defect in the caller's own file, not a verdict. */
export class AnchorKeyRefusal extends Error {
  readonly refusal: string;

  constructor(refusal: string, detail: string) {
    super(`${refusal}: ${detail}`);
    this.name = 'AnchorKeyRefusal';
    this.refusal = refusal;
  }
}

/** The audit anchor identity's public halves, from the file the customer holds. */
export interface AnchorKey {
  readonly alg: typeof ANCHOR_SUITE;
  readonly classical: Uint8Array;
  readonly pq: Uint8Array;
  readonly fingerprint: string;
}

export interface AnchorResult {
  readonly index: number;
  readonly status: 'verified' | 'unchecked';
  readonly placement: 'in_file' | 'window_floor' | 'before_file' | 'after_file' | 'no_head';
  readonly headSeq: number | null;
  readonly periodEnd: number;
}

export interface ChainVerified {
  readonly tenant: string;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly records: number;
  /** RECOMPUTED, never the file's. */
  readonly lastChainHash: string;
  readonly startsAfter: string | null;
  readonly anchorsChecked: boolean;
  readonly anchors: readonly AnchorResult[];
  readonly anchoredThrough: number | null;
  readonly unanchoredFrom: number | null;
  readonly unanchoredCount: number;
}

/** The verdict as the shared corpus writes it -- snake_case, the Python reader's keys. */
export type ChainVerdict =
  | {
      readonly verdict: 'verified';
      readonly tenant: string;
      readonly first_seq: number;
      readonly last_seq: number;
      readonly records: number;
      readonly last_chain_hash: string;
      readonly starts_after: string | null;
      readonly anchors_checked: boolean;
      readonly anchors: readonly {
        readonly index: number;
        readonly status: string;
        readonly placement: string;
        readonly head_seq: number | null;
        readonly period_end: number;
      }[];
      readonly anchored_through: number | null;
      readonly unanchored_from: number | null;
      readonly unanchored_count: number;
    }
  | {
      readonly verdict: 'refused';
      readonly refusal: string;
      readonly seq: number | null;
      readonly anchor: number | null;
    };

// A number the source spelled with a fraction or an exponent. A symbol, so the
// canonical encoder refuses it wherever it lands and no field check mistakes it
// for an integer.
const NOT_AN_INTEGER = Symbol('a number written with a fraction or an exponent');

function reviver(this: unknown, _key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value === 'number' && typeof context?.source === 'string' && /[.eE]/.test(context.source)) {
    return NOT_AN_INTEGER;
  }
  return value;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

// Half of a UTF-16 surrogate pair on its own: the Python reader cannot encode
// one at all, and JSON.stringify would escape it into bytes nobody wrote.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function canonicalValue(v: unknown): boolean {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isSafeInteger(v);
  if (typeof v === 'string') return !LONE_SURROGATE.test(v);
  if (Array.isArray(v)) return v.every(canonicalValue);
  if (isRecord(v)) return Object.entries(v).every(([k, x]) => !LONE_SURROGATE.test(k) && canonicalValue(x));
  return false;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The audit service's link: `sha256:` over the canonical bytes. */
function link(value: unknown): string {
  return `sha256:${sha256Hex(canon(value))}`;
}

/**
 * RFC 4648 section 4 base64 with padding, in its one spelling: a value that
 * does not re-encode to itself is refused, so two spellings of one signature
 * are not two accepted signatures.
 */
function b64Strict(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const raw = Uint8Array.from(Buffer.from(value, 'base64'));
  return Buffer.from(raw).toString('base64') === value ? raw : null;
}

function parseText(file: string | Uint8Array): unknown {
  let text: string;
  if (typeof file === 'string') {
    text = file;
  } else {
    try {
      // ignoreBOM keeps a byte-order mark in the text, where JSON.parse refuses
      // it -- as the Python reader's parser does.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file);
    } catch {
      throw new ChainRefusal('ExportMalformed', 'the file is not UTF-8');
    }
  }
  try {
    const parsed: unknown = JSON.parse(text, reviver);
    return parsed;
  } catch {
    throw new ChainRefusal('ExportMalformed', 'the file is not JSON');
  }
}

/**
 * Read the audit anchor identity's public document -- `{alg, classical, pq,
 * fingerprint}`, the halves in base64 -- checking every redundant field: the
 * fingerprint is recomputed over both halves and compared, and a small-order
 * Ed25519 half is refused, because under one a single signature verifies every
 * message.
 */
export function parseAnchorKey(file: string | Uint8Array): AnchorKey {
  let doc: unknown;
  try {
    doc = JSON.parse(typeof file === 'string' ? file : new TextDecoder('utf-8', { fatal: true }).decode(file));
  } catch {
    throw new AnchorKeyRefusal('AnchorKeyMalformed', 'the anchor key file is not JSON');
  }
  if (!isRecord(doc)) {
    throw new AnchorKeyRefusal('AnchorKeyMalformed', 'the anchor key document is not a JSON object');
  }
  if ('ed25519_pk_hex' in doc || 'identity' in doc) {
    throw new AnchorKeyRefusal(
      'AnchorKeyMalformed',
      'this is a receipt trust anchor (the document `ziffer pubkey` writes), not the audit anchor identity',
    );
  }
  if (doc['alg'] !== ANCHOR_SUITE) {
    throw new AnchorKeyRefusal('AnchorKeyUnsupported', `audit anchors are verified under ${ANCHOR_SUITE} only`);
  }
  const classical = b64Strict(doc['classical']);
  const pq = b64Strict(doc['pq']);
  if (classical === null || classical.length !== ED25519_PK_BYTES || pq === null || pq.length !== MLDSA65_PK_LEN) {
    throw new AnchorKeyRefusal(
      'AnchorKeyMalformed',
      '`classical` must be 32 bytes and `pq` 1952 bytes, each in padded base64',
    );
  }
  if (ed25519IsSmallOrder(classical)) {
    throw new AnchorKeyRefusal('AnchorKeyMalformed', 'the Ed25519 half is a small-order point');
  }
  const both = new Uint8Array(classical.length + pq.length);
  both.set(classical, 0);
  both.set(pq, classical.length);
  const fingerprint = `sha256:${sha256Hex(both)}`;
  if (doc['fingerprint'] !== fingerprint) {
    throw new AnchorKeyRefusal(
      'AnchorKeyMalformed',
      'the fingerprint is not the fingerprint of the document’s own keys; it was edited after it was written',
    );
  }
  return { alg: ANCHOR_SUITE, classical, pq, fingerprint };
}

/**
 * Both halves of the hybrid signature over the bytes the audit service signed:
 * the canonical encoding of the anchor's `alg`, `heads`, `period_end` and `v`.
 * Conjunctive, over exactly {classical, pq}.
 */
function anchorSignatureOk(key: AnchorKey, signed: Record<string, unknown>): boolean {
  const sig = signed['sig'];
  if (!isRecord(sig)) return false;
  const names = Object.keys(sig).sort();
  if (names.length !== 2 || names[0] !== 'classical' || names[1] !== 'pq') return false;
  const classical = b64Strict(sig['classical']);
  const pq = b64Strict(sig['pq']);
  if (classical === null || pq === null) return false;
  const body = canon({
    alg: signed['alg'],
    heads: signed['heads'],
    period_end: signed['period_end'],
    v: signed['v'],
  });
  const parts: SignaturePart[] = [
    { primitive: 'classical', bytes: classical },
    { primitive: 'pq', bytes: pq },
  ];
  return verifyUnderSuite(ANCHOR_SUITE, key, body, parts) === null;
}

function isHead(h: unknown): h is [string, number, string] {
  return (
    Array.isArray(h) && h.length === 3 && typeof h[0] === 'string' && isInt(h[1]) && typeof h[2] === 'string'
  );
}

/**
 * Verify an audit chain export, from the file's bytes or text.
 *
 * Throws {@link ChainRefusal} at the first break: `ExportMalformed`,
 * `ExportEmpty`, `ChainSeqGap`, `RecordOutOfPlace`, `ChainLinkBroken`,
 * `RecordNotCanonical`, `ChainHashMismatch`, `AnchorMalformed`,
 * `AnchorSuiteNotEnrolled`, `AnchorSignatureInvalid`, `AnchorHeadMismatch`.
 *
 * NOT checked, on purpose, as in the Python reader: whether each record's
 * fields are the set its kind of event carries, the transparency-log entry and
 * timestamp stored beside each anchor, and whether the file holds EVERY record
 * of its window -- a file cut short at the end verifies, and `unanchoredFrom`
 * says how much of it nothing yet commits to.
 */
export function verifyChain(file: string | Uint8Array, anchorKey?: AnchorKey): ChainVerified {
  const doc = parseText(file);
  if (!isRecord(doc)) throw new ChainRefusal('ExportMalformed', 'the file is not a JSON object');
  const tenant = doc['tenant'];
  const chain = doc['chain'];
  const anchors = doc['anchors'];
  if (typeof tenant !== 'string' || !Array.isArray(chain) || !Array.isArray(anchors)) {
    throw new ChainRefusal('ExportMalformed', 'the file carries no `tenant`, `chain` and `anchors`');
  }
  if (chain.length === 0) throw new ChainRefusal('ExportEmpty', 'the file holds no records');

  // ---- the chain: every link recomputed, in order -------------------------
  const recomputed: string[] = [];
  let firstSeq = 0;
  let startsAfter: string | null = null;
  for (let i = 0; i < chain.length; i += 1) {
    const row: unknown = chain[i];
    if (
      !isRecord(row) ||
      !isInt(row['seq']) ||
      typeof row['chain_hash'] !== 'string' ||
      !('previous_hash' in row) ||
      !(row['previous_hash'] === null || typeof row['previous_hash'] === 'string') ||
      !isRecord(row['record'])
    ) {
      throw new ChainRefusal('ExportMalformed', `row ${i} is not {seq, previous_hash, chain_hash, record}`);
    }
    const seq = row['seq'];
    const record = row['record'];
    const previous = row['previous_hash'];
    if (i === 0) {
      firstSeq = seq;
    } else if (seq !== firstSeq + i) {
      throw new ChainRefusal('ChainSeqGap', `follows record ${firstSeq + i - 1}; a chain has no gaps`, { seq });
    }
    const recordSeq = record['seq'];
    if (record['tenant_id'] !== tenant || (seq > 0 && !(isInt(recordSeq) && recordSeq === seq))) {
      throw new ChainRefusal('RecordOutOfPlace', 'the record names another tenant or another position', { seq });
    }
    let prev: string | null;
    if (i === 0) {
      if (seq === 0 && previous !== null) {
        throw new ChainRefusal('ChainLinkBroken', 'the first record of a chain has no predecessor', { seq });
      }
      if (seq > 0) {
        if (typeof previous !== 'string' || !HASH_PATTERN.test(previous)) {
          throw new ChainRefusal(
            'ChainLinkBroken',
            'the file starts after the chain’s beginning and does not say which hash it continues from',
            { seq },
          );
        }
        startsAfter = previous;
      }
      prev = typeof previous === 'string' ? previous : null;
    } else {
      const before = recomputed[i - 1] ?? null;
      if (previous !== before) {
        throw new ChainRefusal('ChainLinkBroken', 'does not continue from the record before it', { seq });
      }
      prev = before;
    }
    if (!canonicalValue(record)) {
      throw new ChainRefusal(
        'RecordNotCanonical',
        'the record holds a fraction or an integer too large to encode one way',
        { seq },
      );
    }
    const hash = seq === 0 ? link(record) : link({ prev, record });
    if (hash !== row['chain_hash']) {
      throw new ChainRefusal('ChainHashMismatch', `the record hashes to ${hash}`, { seq });
    }
    recomputed.push(hash);
  }
  const lastSeq = firstSeq + chain.length - 1;

  // ---- the anchors: each signature under YOUR key, each head against the chain
  const results: AnchorResult[] = [];
  let anchoredThrough: number | null = null;
  for (let j = 0; j < anchors.length; j += 1) {
    const entry: unknown = anchors[j];
    const signed = isRecord(entry) ? entry['anchor'] : undefined;
    if (
      !isRecord(signed) ||
      typeof signed['alg'] !== 'string' ||
      !isInt(signed['v']) ||
      signed['v'] !== ANCHOR_VERSION ||
      !isInt(signed['period_end']) ||
      !Array.isArray(signed['heads']) ||
      !signed['heads'].every(isHead) ||
      !('sig' in signed)
    ) {
      throw new ChainRefusal('AnchorMalformed', 'not {alg, heads, period_end, sig, v} with three-part heads', {
        anchor: j,
      });
    }
    const periodEnd = signed['period_end'];
    const heads: unknown[] = signed['heads'];
    const mine = heads.filter(isHead).filter((h) => h[0] === tenant);
    if (mine.length > 1) {
      throw new ChainRefusal('AnchorMalformed', `names this tenant ${mine.length} times`, { anchor: j });
    }
    let status: AnchorResult['status'] = 'unchecked';
    if (anchorKey !== undefined) {
      if (signed['alg'] !== anchorKey.alg) {
        throw new ChainRefusal('AnchorSuiteNotEnrolled', 'signed under a suite your anchor key is not', {
          anchor: j,
        });
      }
      if (!anchorSignatureOk(anchorKey, signed)) {
        throw new ChainRefusal(
          'AnchorSignatureInvalid',
          'the anchor’s signature does not verify under your anchor key -- both halves must',
          { anchor: j },
        );
      }
      status = 'verified';
    }
    let placement: AnchorResult['placement'] = 'no_head';
    let headSeq: number | null = null;
    const head = mine[0];
    if (head !== undefined) {
      const [, hSeq, hHash] = head;
      headSeq = hSeq;
      let expected: string | null = null;
      if (firstSeq <= hSeq && hSeq <= lastSeq) {
        placement = 'in_file';
        expected = recomputed[hSeq - firstSeq] ?? null;
      } else if (hSeq === firstSeq - 1 && startsAfter !== null) {
        placement = 'window_floor';
        expected = startsAfter;
      } else {
        placement = hSeq < firstSeq ? 'before_file' : 'after_file';
      }
      // Compared with or without a key, as in the Python reader: a file whose
      // anchors disagree with its own recomputed chain is refused either way.
      if (expected !== null && hHash !== expected) {
        throw new ChainRefusal('AnchorHeadMismatch', `the chain recomputes to ${expected} at this position`, {
          seq: hSeq,
          anchor: j,
        });
      }
      if (status === 'verified' && (placement === 'in_file' || placement === 'window_floor')) {
        anchoredThrough = anchoredThrough === null ? hSeq : Math.max(anchoredThrough, hSeq);
      }
    }
    results.push({ index: j, status, placement, headSeq, periodEnd });
  }

  let unanchoredFrom: number | null;
  if (anchoredThrough === null) unanchoredFrom = firstSeq;
  else if (anchoredThrough < lastSeq) unanchoredFrom = anchoredThrough + 1;
  else unanchoredFrom = null;
  const lastChainHash = recomputed[recomputed.length - 1];
  if (lastChainHash === undefined) throw new ChainRefusal('ExportEmpty', 'the file holds no records');
  return {
    tenant,
    firstSeq,
    lastSeq,
    records: chain.length,
    lastChainHash,
    startsAfter,
    anchorsChecked: anchorKey !== undefined,
    anchors: results,
    anchoredThrough,
    unanchoredFrom,
    unanchoredCount: unanchoredFrom === null ? 0 : lastSeq - unanchoredFrom + 1,
  };
}

/** {@link verifyChain}'s answer, or its refusal, as one corpus-shaped object. */
export function chainVerdict(file: string | Uint8Array, anchorKey?: AnchorKey): ChainVerdict {
  let v: ChainVerified;
  try {
    v = verifyChain(file, anchorKey);
  } catch (e) {
    if (e instanceof ChainRefusal) {
      return { verdict: 'refused', refusal: e.refusal, seq: e.seq, anchor: e.anchor };
    }
    throw e;
  }
  return {
    verdict: 'verified',
    tenant: v.tenant,
    first_seq: v.firstSeq,
    last_seq: v.lastSeq,
    records: v.records,
    last_chain_hash: v.lastChainHash,
    starts_after: v.startsAfter,
    anchors_checked: v.anchorsChecked,
    anchors: v.anchors.map((a) => ({
      index: a.index,
      status: a.status,
      placement: a.placement,
      head_seq: a.headSeq,
      period_end: a.periodEnd,
    })),
    anchored_through: v.anchoredThrough,
    unanchored_from: v.unanchoredFrom,
    unanchored_count: v.unanchoredCount,
  };
}
