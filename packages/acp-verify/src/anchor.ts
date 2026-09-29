/**
 * Read a {@link TrustAnchor} off disk, from the document the engine's own tool
 * writes (ACP-197, section 6b point 3).
 *
 * # Why it lives in the verifier (ACP-479)
 *
 * It was private to the MCP server, so every customer wrote their own reader
 * of the same file and the module `ziffer-scan --code` writes could not verify
 * a receipt at all. One reader, here, beside the function that consumes what
 * it returns; the client package re-exports it and the MCP server imports it.
 * `node:fs` is imported by this file only: the package already needs Node for
 * `node:crypto` (`verify.ts`), so no browser bundle loses anything by it.
 *
 * # The format is not ours to choose
 *
 * `ZIFFER_TRUST_ANCHOR` names the output of `ziffer pubkey --key <file>`,
 * at engine pin fed43d1, `crates/acp-bundle-cli/src/main.rs::cmd_pubkey` (the
 * same four keys in the same order it wrote at 356ef8e, where this comment was
 * first written; re-read at the v1.3.32 pin rather than assumed). That
 * document exists precisely so an operator stops transcribing a key between
 * three encodings by hand, and its doc comment says why a slip matters: **a
 * transcription slip does not surface as a transcription slip** -- it surfaces
 * as a signature that does not verify, wearing the face of a compromise. A
 * second file format here would put that slip back, one layer up.
 *
 * The fields read are the two the engine's own `load_public_key` reads, because
 * the top level of that document IS the `--pubkey` file:
 *
 * ```json
 * {
 *   "ed25519_pk_hex": "<64 hex chars>",
 *   "fingerprint": "sha256:<hex>",
 *   "identity": { "classical": "<base64>", "pq": "<base64>" },
 *   "mldsa65_pk_hex": "<3904 hex chars>"
 * }
 * ```
 *
 * `identity` and `fingerprint` are other encodings of the same two keys and are
 * deliberately NOT read: reading a key twice from one file is two answers to
 * "which identity is this", and the one nobody exercises is the wrong one.
 *
 * # Why the suite floor is not in this file
 *
 * {@link TrustAnchor} needs a third value, `minSuite`, and this document does
 * not carry it -- by construction. `cmd_pubkey` refuses to emit an `alg` field
 * and states the rule: a suite name is a WIRE field (CR-1), never a member of
 * an identity, and putting one beside a key would invent a shape no schema in
 * the engine declares. So the floor is separate configuration, in
 * `ZIFFER_SUITE_FLOOR`, with no default -- which is also the shape the Executor
 * already ships (`ZIFFER_POLICY_SIGNING_KEY` names the key file and
 * `ZIFFER_EXECUTOR_SUITE_FLOOR` names the floor beside it,
 * `docs/onboarding/executor.md` section 4: "an unknown suite is refused, never
 * defaulted").
 */

import { readFile } from 'node:fs/promises';

import type { TrustAnchor } from './verify.js';

/** Ed25519 verification key: 32 bytes, so 64 hex characters. */
const ED25519_PK_HEX_LEN = 64;
/** ML-DSA-65 verification key: 1,952 bytes, so 3,904 hex characters. */
const MLDSA65_PK_HEX_LEN = 3904;

/**
 * The secret-half field names `ziffer` writes into a KEY file.
 *
 * Checked for by name because the mistake this catches is a plausible one: the
 * operator has two JSON files with similar names, and points
 * `ZIFFER_TRUST_ANCHOR` at the signing key instead of the public document. That
 * file has no `ed25519_pk_hex`, so without this check the refusal would be
 * `TrustAnchorMalformed: missing ed25519_pk_hex` -- true, unhelpful, and it
 * would send the developer to inspect a file holding a live private key while
 * wondering what field to add to it. `cmd_pubkey` guards the same confusion
 * from the other direction with `refuse_if_secret_present`.
 */
const SECRET_FIELDS = ['ed25519_sk_hex', 'mldsa65_sk_hex'] as const;

/**
 * A trust anchor file that is missing, unreadable, or not what it claims to be.
 *
 * Named, and not a bare Error, because whoever reads it needs to act, and "the
 * file you named is a signing key" and "the file you named does not exist" are
 * different actions. The attester registry reader (`registry.ts`) refuses under
 * the same class, with the engine's own refusal names, for the same reason.
 *
 * NOT a {@link import('./refusal.js').Refusal}: a file that will not load is a
 * defect in the verifier's OWN configuration, not a verdict about any receipt,
 * and the clause vocabulary `Refusal.clause` carries is the receipt-verdict
 * vocabulary -- the Python SDK draws the same line with its `AnchorError`.
 *
 * `detail` never carries file CONTENT. A malformed anchor is quoted back into
 * an agent's context, and if the file turned out to be a secret key, echoing
 * the bytes that made it malformed is how the key gets there.
 */
export class AnchorError extends Error {
  override readonly name: string;
  /** The path that was read, which is safe to name and is what identifies it. */
  readonly path: string;

  constructor(name: string, path: string, detail: string) {
    super(`${name}: ${path}: ${detail}`);
    this.name = name;
    this.path = path;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Decode a lowercase-hex field of an exact length.
 *
 * The length is checked before the decode and is exact rather than a minimum,
 * because a key of the wrong length is not a weak key, it is a different
 * object: 31 bytes of an Ed25519 key is not an Ed25519 key at all, and
 * `verifyReceipt` would refuse every signature under it with a clause that
 * blames the receipt for a defect in the anchor.
 */
function hexField(doc: Record<string, unknown>, key: string, expected: number, path: string): Uint8Array {
  const raw = doc[key];
  if (typeof raw !== 'string') {
    throw new AnchorError(
      'TrustAnchorMalformed',
      path,
      `${key} is ${raw === undefined ? 'absent' : 'not a string'}; this is not a \`ziffer pubkey\` document.`,
    );
  }
  if (raw.length !== expected) {
    throw new AnchorError(
      'TrustAnchorMalformed',
      path,
      `${key} is ${raw.length} hex characters, expected exactly ${expected}.`,
    );
  }
  if (!/^[0-9a-f]+$/.test(raw)) {
    // Lowercase only, matching what `cmd_pubkey` writes. Accepting uppercase
    // would mean two spellings of one anchor file compare unequal while
    // decoding to the same key, and an operator diffing a rotated key against
    // the previous one could not tell which changed.
    throw new AnchorError(
      'TrustAnchorMalformed',
      path,
      `${key} is not lowercase hexadecimal.`,
    );
  }
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Read and parse the anchor document at `path`, or refuse by name.
 *
 * @param minSuite the CR-4 floor from `ZIFFER_SUITE_FLOOR`, passed through
 *                 unvalidated: `verifyReceipt` is the one place that knows
 *                 which suite names exist, and it refuses an unknown floor
 *                 under `CLAUSE_UNKNOWN_SUITE`. A second table of suite names
 *                 here would be a second answer to what a suite is.
 * @throws AnchorError `TrustAnchorUnreadable`, `TrustAnchorNotJson`,
 *         `TrustAnchorHoldsSecret` or `TrustAnchorMalformed`.
 */
export async function loadTrustAnchor(path: string, minSuite: string): Promise<TrustAnchor> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    // The cause's message is included because "no such file" and "permission
    // denied" are different developer actions and both are safe to say: it is
    // errno text about a path, not content from inside the file.
    throw new AnchorError(
      'TrustAnchorUnreadable',
      path,
      error instanceof Error ? error.message : 'could not be read.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AnchorError(
      'TrustAnchorNotJson',
      path,
      'the file is not JSON; expected the output of `ziffer pubkey --key <file>`.',
    );
  }
  if (!isRecord(parsed)) {
    throw new AnchorError('TrustAnchorNotJson', path, 'the file is JSON but not an object.');
  }

  for (const secret of SECRET_FIELDS) {
    if (secret in parsed) {
      throw new AnchorError(
        'TrustAnchorHoldsSecret',
        path,
        `this file carries ${secret}, so it is a SIGNING KEY, not a public trust anchor. Nothing was read from it. Run \`ziffer pubkey --key <this file> --out <anchor file>\` and point ZIFFER_TRUST_ANCHOR at the output.`,
      );
    }
  }

  return {
    classical: hexField(parsed, 'ed25519_pk_hex', ED25519_PK_HEX_LEN, path),
    pq: hexField(parsed, 'mldsa65_pk_hex', MLDSA65_PK_HEX_LEN, path),
    minSuite,
  };
}
