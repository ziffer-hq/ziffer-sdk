/**
 * Read the customer's OWN attester registry -- `attesters/registry.json` of
 * the policy folder they sign and publish -- into the approver half of a
 * {@link QuorumPolicy} (ACP-473).
 *
 * # Why this exists
 *
 * A receipt for an action that was held and approved carries the approvers'
 * signatures, and `verifyReceipt` refuses it (`AB-1`) unless the trust anchor
 * carries a quorum policy to check them against. The Python SDK has read this
 * file since ACP-406 (`AttesterRegistry.from_file`); no TypeScript package did,
 * so every TypeScript caller transcribed the registry into a `Map` by hand, and
 * a transcription of key material is where a slip turns into a signature that
 * does not verify, or worse, one that does.
 *
 * # The checks are the engine loader's, in the engine loader's ORDER
 *
 * This is the twin of `BundleHost._check_registry` (the reference,
 * `reference/src/acp_bundle.py`) and `check_registry` (`acp-bundle`,
 * `crates/acp-bundle/src/verify.rs`), both at the engine pin, which the Python
 * SDK calls directly. Same refusal NAMES, and the same order, because a
 * registry wrong in two ways must be named the same way in every language:
 *
 * 1. not JSON, or not an object -- `Malformed`
 * 2. `quorum_k` absent, not an integer, or below 1 -- `QuorumInvalid` (PB-6:
 *    never defaulted; the permissive default k=1 is single compromise)
 * 3. `attesters` not an object -- `Malformed`
 * 4. every entry's `kind` read FIRST; absent or unknown -- `Malformed` (HM-1: a
 *    kind guessed from which fields are present is how a machine entry that
 *    lost its `pq` leg reads as a person); a `webauthn` entry missing any of
 *    `role`, `rp_id`, `credential_id`, `public_key`, `alg`, or naming an alg
 *    outside HM-1's two -- `Malformed`
 * 5. PB-7 per LEG across `hybrid` entries: a leg absent -- `Malformed`; one
 *    leg shared by two identities -- `RegistryKeysNotDistinct` (ACP-53: one
 *    key holder enrolled under two names satisfies k=2 alone)
 * 6. HM-5, the same over `webauthn` entries' `public_key` --
 *    `RegistryKeysNotDistinct`
 * 7. PB-9: a `classical` leg of small order -- `RegistryKeyWeak`
 * 8. HM-5: a `public_key` the verifier's own COSE parser refuses -- its name,
 *    `Malformed` or `RegistryKeyWeak`
 * 9. HM-1's assurance rule: a `webauthn` entry not recorded at AS1 or AS2 --
 *    `HumanAssuranceAbsent`
 *
 * # Where this is NARROWER than the engine loader, and why that is disclosed
 *
 * The engine accepts a `hybrid` leg that is not base64 at all, or base64 of the
 * wrong length (ACP-52: nothing validates a bundle against its schema), and it
 * fails later, as a signature. The Python SDK refuses such a leg at load with
 * an unnamed error. This reader refuses it at load as `Malformed`, after every
 * engine check above has run, so on any registry the engine refuses the name
 * is the engine's. A narrower acceptance, never a wider one.
 *
 * `quorum_k: 2.0` is read by `JSON.parse` as the integer 2 and accepted; the
 * reference and `acp-bundle` see a float and refuse it `QuorumInvalid`. The
 * text is not re-parsed to tell the two apart. That is a WIDER acceptance on
 * one spelling of a value that means the same threshold, and it is disclosed
 * rather than hidden.
 *
 * # What an empty registry means (not refused, and why)
 *
 * `{"quorum_k": 1, "attesters": {}}` names no approver. Neither engine loader
 * refuses it, and neither does this one: it is not read permissively, because
 * a receipt that carries an approval is then refused at the quorum count (no
 * entry can verify against an identity that is not enrolled), and a receipt
 * that carries none needed no registry. Refusing it here would be a third
 * implementation refusing what the other two accept, under a name neither has.
 *
 * # What the registry does not carry
 *
 * The bundle's tree hash and epoch are not members of this file, so they are
 * not in {@link AttesterRegistry}; a {@link QuorumPolicy} needs both, from the
 * caller's own source (see `QuorumPolicy.policyBundleHash`).
 */

import { readFile } from 'node:fs/promises';

import { AnchorError } from './anchor.js';
import { ED25519_PK_LEN, ed25519IsSmallOrder } from './ed25519.js';
import type { AttesterCredential, QuorumPolicy } from './quorum.js';
import { MLDSA65_PK_LEN } from './sig.js';
import { MALFORMED, REGISTRY_KEY_WEAK, WEBAUTHN_ALGS, WebauthnRefusal, coseKeyParse } from './webauthn.js';
import { b64Decode, isRecord } from './wire.js';

/** PB-6. */
export const QUORUM_INVALID = 'QuorumInvalid';
/** PB-7 and HM-5. */
export const REGISTRY_KEYS_NOT_DISTINCT = 'RegistryKeysNotDistinct';
/** HM-1's assurance rule; the reference's own name for it. */
export const HUMAN_ASSURANCE_ABSENT = 'HumanAssuranceAbsent';
/** The file itself could not be read: a path problem, before any content. */
export const REGISTRY_UNREADABLE = 'RegistryUnreadable';

/**
 * The approver half of a {@link QuorumPolicy}: everything
 * `attesters/registry.json` holds, and nothing it does not.
 */
export type AttesterRegistry = Pick<QuorumPolicy, 'quorumK' | 'attesters' | 'assurances' | 'minAssurance'>;

/** The schema's encoding of a 32-byte Ed25519 key, the only one PB-9 examines. */
const ED25519_PUB_B64 = /^[A-Za-z0-9+/]{43}=$/;

const WEBAUTHN_FIELDS: readonly string[] = ['role', 'rp_id', 'credential_id', 'public_key', 'alg'];

/** One JSON value, spelled one way, for PB-7's comparison of legs as JSON values. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Parse the bytes of `attesters/registry.json`, or refuse by name.
 *
 * Bytes, not a parsed object, for the Python SDK's reason: the bundle signature
 * covers these bytes, and asking the caller to re-encode a signed member is the
 * second-encoding split with the signature still attached.
 *
 * @param path named in every refusal, and never the file's content.
 * @throws AnchorError named `Malformed`, `QuorumInvalid`,
 *         `RegistryKeysNotDistinct`, `RegistryKeyWeak` or `HumanAssuranceAbsent`.
 */
export function parseAttesterRegistry(bytes: Uint8Array, path: string): AttesterRegistry {
  const refuse = (name: string, detail: string): AnchorError => new AnchorError(name, path, detail);

  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw refuse(MALFORMED, 'attesters/registry.json is not JSON');
  }
  if (!isRecord(doc)) throw refuse(MALFORMED, 'attesters/registry.json is not a JSON object');

  // 2. PB-6, before anything else is read.
  const k = doc['quorum_k'];
  if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 1) {
    throw refuse(QUORUM_INVALID, 'quorum_k is absent, not an integer, or below 1; there is no default threshold');
  }

  // 3.
  const attesters = doc['attesters'];
  if (!isRecord(attesters)) throw refuse(MALFORMED, 'the registry has no attesters map');
  const entries: Array<[string, Record<string, unknown>]> = [];

  // 4. HM-1: kind first.
  for (const [name, entry] of Object.entries(attesters)) {
    if (!isRecord(entry)) throw refuse(MALFORMED, `attester ${JSON.stringify(name)} is not an object`);
    const kind = entry['kind'];
    if (kind !== 'hybrid' && kind !== 'webauthn') {
      throw refuse(MALFORMED, `attester ${JSON.stringify(name)} has no kind, or one other than hybrid and webauthn`);
    }
    if (kind === 'webauthn') {
      for (const f of WEBAUTHN_FIELDS) {
        if (!nonEmptyString(entry[f])) {
          throw refuse(MALFORMED, `webauthn attester ${JSON.stringify(name)} is missing ${f}`);
        }
      }
      if (!WEBAUTHN_ALGS.includes(String(entry['alg']))) {
        throw refuse(MALFORMED, `webauthn attester ${JSON.stringify(name)} has an unknown alg`);
      }
    }
    entries.push([name, entry]);
  }
  const hybrids = entries.filter(([, e]) => e['kind'] === 'hybrid');
  const humans = entries.filter(([, e]) => e['kind'] === 'webauthn');

  // 5. PB-7, per leg: either leg colliding is a collision.
  for (const leg of ['classical', 'pq']) {
    const seen: unknown[] = [];
    for (const [name, entry] of hybrids) {
      if (!(leg in entry)) throw refuse(MALFORMED, `hybrid attester ${JSON.stringify(name)} has no ${leg} key`);
      if (seen.some((s) => same(s, entry[leg]))) {
        throw refuse(REGISTRY_KEYS_NOT_DISTINCT, `two attesters share one ${leg} key, so they are one key holder`);
      }
      seen.push(entry[leg]);
    }
  }

  // 6. HM-5: the same over the human credentials.
  const seenCred: unknown[] = [];
  for (const [, entry] of humans) {
    if (seenCred.some((s) => same(s, entry['public_key']))) {
      throw refuse(REGISTRY_KEYS_NOT_DISTINCT, 'two attesters share one credential, so they are one key holder');
    }
    seenCred.push(entry['public_key']);
  }

  // 7. PB-9, on legs written in the schema's encoding (the engine's scope).
  for (const [name, entry] of hybrids) {
    const leg = entry['classical'];
    if (typeof leg !== 'string' || !ED25519_PUB_B64.test(leg)) continue;
    const raw = b64Decode(leg);
    if (raw !== null && ed25519IsSmallOrder(raw)) {
      throw refuse(REGISTRY_KEY_WEAK, `attester ${JSON.stringify(name)} has a small-order classical key, which verifies every message`);
    }
  }

  // 8. HM-5: the verifier's own COSE parser names the fault.
  const humanKeys = new Map<string, Uint8Array>();
  for (const [name, entry] of humans) {
    const raw = b64Decode(String(entry['public_key']));
    if (raw === null) throw refuse(MALFORMED, `webauthn attester ${JSON.stringify(name)}: public_key is not base64`);
    try {
      coseKeyParse(String(entry['alg']), raw);
    } catch (error) {
      if (error instanceof WebauthnRefusal) {
        throw refuse(error.refusalName, `webauthn attester ${JSON.stringify(name)}: ${error.detail}`);
      }
      throw error;
    }
    humanKeys.set(name, raw);
  }

  // 9. HM-1's assurance rule, last.
  const assuranceDoc = isRecord(doc['assurance']) ? doc['assurance'] : {};
  for (const [name] of humans) {
    const level = assuranceDoc[name];
    if (level !== 'AS1' && level !== 'AS2') {
      throw refuse(HUMAN_ASSURANCE_ABSENT, `webauthn attester ${JSON.stringify(name)} is not recorded at AS1 or AS2`);
    }
  }

  // The projection. Every engine check has run; what follows can only refuse
  // what the engine would have let through to fail later as a signature.
  const credentials = new Map<string, AttesterCredential>();
  for (const [name, entry] of entries) {
    // `role` is required of a person and optional for a machine; absent reads
    // as null, which satisfies an empty `required_roles` and nothing else.
    const role = typeof entry['role'] === 'string' ? entry['role'] : null;
    const key = humanKeys.get(name);
    if (key !== undefined) {
      credentials.set(name, {
        kind: 'webauthn',
        rpId: String(entry['rp_id']),
        credentialId: String(entry['credential_id']),
        publicKey: key,
        alg: String(entry['alg']),
        role,
      });
      continue;
    }
    const classical = typeof entry['classical'] === 'string' ? b64Decode(entry['classical']) : null;
    const pq = typeof entry['pq'] === 'string' ? b64Decode(entry['pq']) : null;
    if (classical === null || classical.length !== ED25519_PK_LEN) {
      throw refuse(MALFORMED, `hybrid attester ${JSON.stringify(name)}: classical is not a base64 Ed25519 public key`);
    }
    if (pq === null || pq.length !== MLDSA65_PK_LEN) {
      throw refuse(MALFORMED, `hybrid attester ${JSON.stringify(name)}: pq is not a base64 ML-DSA-65 public key`);
    }
    credentials.set(name, { kind: 'hybrid', classical, pq, role });
  }

  // A level that is not a string reads as absent, which is AS0, the weakest:
  // it can only cause a refusal, never an acceptance. The Python SDK reads it
  // the same way.
  const assurances = new Map<string, string>();
  for (const [name, level] of Object.entries(assuranceDoc)) {
    if (typeof level === 'string') assurances.set(name, level);
  }
  // Absent is the document's own default, AS0. Present and not a string is
  // refused rather than read as AS0: that would be the weakest floor chosen
  // for a value somebody did write.
  const floor = doc['min_attester_assurance'] ?? 'AS0';
  if (typeof floor !== 'string') throw refuse(MALFORMED, 'min_attester_assurance is not a string');

  return {
    quorumK: k,
    attesters: credentials,
    assurances,
    minAssurance: floor,
  };
}

/**
 * Read `attesters/registry.json` from a checked-out policy folder: the bytes on
 * disk, unparsed and un-normalised, handed to {@link parseAttesterRegistry}.
 *
 * @throws AnchorError `RegistryUnreadable` when the file cannot be read, and
 *         every name {@link parseAttesterRegistry} refuses under.
 */
export async function loadAttesterRegistry(path: string): Promise<AttesterRegistry> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new AnchorError(REGISTRY_UNREADABLE, path, error instanceof Error ? error.message : 'could not be read.');
  }
  return parseAttesterRegistry(bytes, path);
}
