/**
 * §8.6c HM-1..HM-7 -- a human attester's WebAuthn assertion, verified in the
 * customer's own process.
 *
 * The third writing of `crates/acp-crypto/src/webauthn.rs` and
 * `reference/src/acp_crypto.py`, and the mirrored corpus
 * `fixtures/refused_webauthn.json` is what holds the three to one rule: 18
 * vectors, two ACCEPT and one refusal per HM-4 step, replayed by
 * `webauthn.test.ts` against this file.
 *
 * # What a human leg is NOT (HM-6, CR-8)
 *
 * **CLASSICAL, and this function must never be read as though it were more.**
 * No passkey, platform authenticator or security key in existence produces a
 * post-quantum signature, so a `webauthn` entry is never compared against the
 * bundle's `min_suite` (CR-8) -- the absence of a floor check here IS the
 * clause, not an omission. The post-quantum binding of a human's decision is
 * the receipt AB-1 digests the whole entry into and the §11 anchor over it.
 *
 * # The order is normative and the NAMES are the product (HM-4)
 *
 * HM-4 states six checks in order and says no step is skipped for a smaller one
 * that already failed. What the implementations must agree on is not "refused"
 * but WHICH step refused: `WebauthnOrigin` is a phishing finding and
 * `WebauthnChallenge` is a replay, and one name for both would make them one
 * event in an audit record. That is why this throws a named
 * {@link WebauthnRefusal} rather than returning a boolean.
 *
 * Step (f), the signature counter, is NOT here: comparing it needs the stored
 * value for the credential, which is Consumption Ledger state. What this
 * returns is the counter the assertion carried; `quorum.ts` compares it against
 * what the caller stored, and discloses that this package holds no ledger.
 */

import { createHash } from 'node:crypto';

import { p256 } from '@noble/curves/nist.js';

import { cborAsBytes, cborGetInt, cborGetText, cborIsMap, cborKeys, decodeCanonical, type Cbor } from './cbor.js';
import { ED25519_PK_LEN, ED25519_SIG_LEN, ed25519IsSmallOrder, verifyEd25519Strict } from './ed25519.js';

/**
 * HM-1 / CR-8: the two names an entry's `alg` may take.
 *
 * ATTESTATION-ENTRY SUITES ONLY. `suite.ts`'s table is the machine one and
 * these are deliberately absent from it, because CR-8 forbids either as a
 * bundle, receipt or door suite -- a name present in both tables is a name
 * whose meaning depends on where it was read.
 */
export const WEBAUTHN_ALGS: readonly string[] = ['webauthn-es256', 'webauthn-ed25519'];

/** The one primitive name a human entry's `sig` map carries (HM-3). */
export const WEBAUTHN_PRIMITIVE = 'webauthn';

/**
 * HM-3's three fields.
 *
 * **This is not their canonical ORDER**, and the difference looks like one.
 * RFC 8949 §4.2.1 sorts map keys by their ENCODED bytes and a text key's head
 * carries its length, so the wire order is by length first: `signature` (9),
 * `client_data_json` (16), `authenticator_data` (18). The decoder gets that
 * right by construction; a reader who assumed this array's order was the wire
 * order would write a decoder that refuses every real assertion.
 */
export const ASSERTION_FIELDS: readonly string[] = [
  'authenticator_data',
  'client_data_json',
  'signature',
];

/** The registry entry, the COSE_Key or the assertion is not the declared shape. */
export const MALFORMED = 'Malformed';
/** PB-9 / HM-5, at enrolment: an off-curve ES256 key or a small-order Ed25519 one. */
export const REGISTRY_KEY_WEAK = 'RegistryKeyWeak';
/** HM-4 (a). */
export const WEBAUTHN_TYPE = 'WebauthnType';
/** HM-4 (b). */
export const WEBAUTHN_CHALLENGE = 'WebauthnChallenge';
/** HM-4 (c). */
export const WEBAUTHN_ORIGIN = 'WebauthnOrigin';
/** HM-4 (d). */
export const WEBAUTHN_AUTHENTICATOR_DATA = 'WebauthnAuthenticatorData';
/** HM-4 (e). */
export const WEBAUTHN_SIGNATURE = 'WebauthnSignature';

/**
 * One HM-4 step refused, named.
 *
 * `name` is the STEP and is what the cross-implementation comparison is on; the
 * clause is HM-4 for all of them, and six failures under one clause id would be
 * one name for six objects. Deliberately NOT a {@link import('./refusal.js').Refusal}:
 * `quorum.ts` maps these to §9.3's vocabulary at its own boundary, and a type
 * that could travel straight out would let an unmapped name reach a caller.
 */
export class WebauthnRefusal extends Error {
  readonly refusalName: string;
  readonly detail: string;

  constructor(refusalName: string, detail: string) {
    super(`${refusalName}: ${detail}`);
    this.name = 'WebauthnRefusal';
    this.refusalName = refusalName;
    this.detail = detail;
  }
}

// COSE_Key labels (RFC 9052 §7). NAMED, because `1` and `-2` mean nothing at a
// call site and a transposed pair of integers is a defect no reader would see.
const COSE_KTY = 1n;
const COSE_CRV = -1n;
const COSE_X = -2n;
const COSE_Y = -3n;

/**
 * HM-4 (d): the flags byte of `authenticator_data`. UP is "a person touched the
 * authenticator", UV is "the authenticator verified WHO". Both required -- UP
 * alone is possession, and HM-1 says possession is not a person.
 */
const AD_FLAG_UP = 0x01;
const AD_FLAG_UV = 0x04;
/** 32 bytes rpIdHash + 1 flags + 4 counter. */
const AD_MIN_LEN = 37;

/** A credential's public key, decoded and already known to be a usable point. */
export type CredentialKey =
  | { readonly kind: 'es256'; readonly sec1: Uint8Array }
  | { readonly kind: 'ed25519'; readonly raw: Uint8Array };

interface CoseShape {
  readonly kty: bigint;
  readonly crv: bigint;
  readonly labels: readonly bigint[];
}

/**
 * The FIXED shape of a credential's public key, per `alg`.
 *
 * EXACTLY THESE LABELS AND NOTHING ELSE, which is stricter than "whatever the
 * authenticator returned" and is taken deliberately: an optional label gives one
 * key two canonical encodings, hence two `public_key` strings for one
 * credential, and PB-7's distinctness -- which HM-5 takes over exactly that
 * string -- is a comparison over it. Two spellings of one credential enrolled
 * under two names is one holder satisfying k=2 alone.
 *
 * What that costs, disclosed rather than buried: a real authenticator's
 * COSE_Key also carries label 3 (`alg`), so the enrolling service must drop it
 * before writing the registry entry. The registry's own `alg` field is the one
 * definition of which key type HM-4 (e) verifies under, and a second copy inside
 * the key bytes is a second definition CR-5 does not cover. The engine reports
 * this as a spec wording problem; this implementation inherits the reading
 * rather than taking a different one.
 */
const COSE_SHAPES: Readonly<Record<string, CoseShape>> = {
  'webauthn-es256': { kty: 2n, crv: 1n, labels: [COSE_KTY, COSE_CRV, COSE_X, COSE_Y] },
  'webauthn-ed25519': { kty: 1n, crv: 6n, labels: [COSE_KTY, COSE_CRV, COSE_X] },
};

function sortedLabelText(labels: readonly Cbor[]): string {
  return labels
    .map((l) => (typeof l === 'bigint' ? l.toString() : JSON.stringify(l)))
    .sort()
    .join(',');
}

/**
 * HM-1 / HM-5: decode a credential's COSE_Key.
 *
 * The decode is CANONICAL AND VALIDATING (AT-8a) because the registry entry is
 * signed policy: a key that decodes from two different byte strings is a
 * credential with two names.
 *
 * WEAKNESS IS REFUSED HERE, at enrolment, not left to the verifier: an ES256
 * point off the curve and an Ed25519 point of small order are both
 * `RegistryKeyWeak` (HM-5, PB-9). The curve-membership question is asked of
 * `p256`'s own construction -- the same one the verifier will use -- rather than
 * of a second copy of the curve equation, which would be a second definition of
 * the curve. {@link ed25519IsSmallOrder} is the predicate `verifyEd25519Strict`
 * already applies: one rule, two callers (ACP-109).
 */
export function coseKeyParse(alg: string, raw: Uint8Array): CredentialKey {
  const shape = COSE_SHAPES[alg];
  if (shape === undefined) {
    throw new WebauthnRefusal(MALFORMED, `no WebAuthn alg ${JSON.stringify(alg)}`);
  }
  let key: Cbor;
  try {
    key = decodeCanonical(raw);
  } catch (e: unknown) {
    const why = e instanceof Error ? e.message : 'not canonical CBOR';
    throw new WebauthnRefusal(MALFORMED, `COSE_Key: ${why}`);
  }
  if (!cborIsMap(key)) throw new WebauthnRefusal(MALFORMED, 'COSE_Key is not a map');
  // Compared as SETS. The decoder has already refused a duplicate key and a key
  // out of canonical order, so what is left is membership -- and an extra label
  // and a missing one are one refusal, because "this is not the key shape" is
  // one fact.
  const got = sortedLabelText(cborKeys(key));
  const want = sortedLabelText([...shape.labels]);
  if (got !== want) {
    throw new WebauthnRefusal(MALFORMED, `COSE_Key labels {${got}} are not {${want}}`);
  }
  if (cborGetInt(key, COSE_KTY) !== shape.kty || cborGetInt(key, COSE_CRV) !== shape.crv) {
    throw new WebauthnRefusal(
      MALFORMED,
      `COSE_Key kty/crv is not ${shape.kty}/${shape.crv} for ${alg}`,
    );
  }
  const coord = (label: bigint): Uint8Array => {
    const b = cborAsBytes(cborGetInt(key, label));
    if (b === null) throw new WebauthnRefusal(MALFORMED, 'COSE_Key coordinate is not bytes');
    // Fixed width, short encodings forbidden: COSE writes P-256 and Ed25519
    // coordinates at 32 bytes, and a short encoding is a second spelling of one
    // integer.
    if (b.length !== 32) {
      throw new WebauthnRefusal(MALFORMED, 'COSE_Key coordinate is not 32 bytes');
    }
    return b;
  };
  if (alg === 'webauthn-es256') {
    const x = coord(COSE_X);
    const y = coord(COSE_Y);
    // SEC1 uncompressed, which is what `p256` decodes and what the verifier
    // below hands it: one encoding of the point, built once.
    const sec1 = new Uint8Array(65);
    sec1[0] = 0x04;
    sec1.set(x, 1);
    sec1.set(y, 33);
    if (!p256.utils.isValidPublicKey(sec1, false)) {
      throw new WebauthnRefusal(REGISTRY_KEY_WEAK, 'ES256 public key is not a point on secp256r1');
    }
    return { kind: 'es256', sec1 };
  }
  const x = coord(COSE_X);
  if (x.length !== ED25519_PK_LEN || ed25519IsSmallOrder(x)) {
    // PB-9 / ACP-106, one clause over: under a small-order key the Ed25519
    // equation stops mentioning the message and ONE signature verifies every
    // message. Enrolled as a human approver, that identity is a forgery oracle
    // for anyone who has seen the public key.
    throw new WebauthnRefusal(REGISTRY_KEY_WEAK, 'Ed25519 credential key is of small order');
  }
  return { kind: 'ed25519', raw: x };
}

/** HM-3's three fields, decoded. */
export interface Assertion {
  readonly authenticatorData: Uint8Array;
  readonly clientDataJson: Uint8Array;
  readonly signature: Uint8Array;
}

/**
 * HM-3: the `webauthn` primitive's value, decoded under a FIXED SHAPE.
 *
 * A general CBOR decoder is the wrong tool and is deliberately not offered.
 * What arrives here is attacker-supplied on the transport path, so the decoder
 * must accept exactly one shape -- three text keys, each a byte string -- and
 * refuse everything else as `Malformed`. A tag, a float, a nested map, an extra
 * key and a missing key are all the same answer, because a decoder that reports
 * them differently is a parser an attacker can interrogate.
 */
export function decodeAssertion(raw: Uint8Array): Assertion {
  let obj: Cbor;
  try {
    obj = decodeCanonical(raw);
  } catch (e: unknown) {
    const why = e instanceof Error ? e.message : 'not canonical CBOR';
    throw new WebauthnRefusal(MALFORMED, `assertion: ${why}`);
  }
  if (!cborIsMap(obj) || sortedLabelText(cborKeys(obj)) !== sortedLabelText([...ASSERTION_FIELDS])) {
    throw new WebauthnRefusal(MALFORMED, 'assertion is not the HM-3 map');
  }
  const field = (name: string): Uint8Array => {
    const b = cborAsBytes(cborGetText(obj, name));
    if (b === null) {
      throw new WebauthnRefusal(MALFORMED, `assertion ${name} is not a byte string`);
    }
    return b;
  };
  return {
    authenticatorData: field('authenticator_data'),
    clientDataJson: field('client_data_json'),
    signature: field('signature'),
  };
}

/**
 * HM-2: the challenge is base64url WITHOUT padding of the message's bytes.
 *
 * ONE definition, so "the challenge encoding" cannot mean two things. Note what
 * the verifier does with it: it RECOMPUTES this from an id it derived itself and
 * compares (RES-8). It never decodes the challenge the assertion carries and
 * treats the result as an identifier -- a transmitted id is a name for a
 * binding, not evidence of one.
 */
export function webauthnChallenge(messageIdBytes: Uint8Array): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < messageIdBytes.length; i += 3) {
    const b0 = messageIdBytes[i] ?? 0;
    const b1 = messageIdBytes[i + 1];
    const b2 = messageIdBytes[i + 2];
    const v = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    s += A[(v >> 18) & 63];
    s += A[(v >> 12) & 63];
    if (b1 !== undefined) s += A[(v >> 6) & 63];
    if (b2 !== undefined) s += A[v & 63];
  }
  return s;
}

function sha256(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(bytes).digest());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function strProp(v: unknown, key: string): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const raw = Object.prototype.hasOwnProperty.call(v, key)
    ? Object.getOwnPropertyDescriptor(v, key)?.value
    : undefined;
  return typeof raw === 'string' ? raw : null;
}

/**
 * HM-4 (a)-(e), IN ORDER, returning the assertion's 32-bit signature counter.
 *
 * `messageIdBytes` is the UTF-8 bytes of a **recomputed** id -- the attestation
 * id at §9.3 step 7b(v). Never an id read off the message being verified
 * (HM-2, RES-8). `rpId` is the entry's SIGNED relying-party id: signed policy,
 * never a value the assertion supplies, which is the whole of HM-4 (c).
 *
 * NO STEP IS SKIPPED FOR AN EARLIER ONE, and the order is normative: an
 * assertion wrong in two ways must produce the same refusal name in every
 * implementation, or the corpus is comparing luck.
 */
export function verifyWebauthn(
  alg: string,
  coseKey: Uint8Array,
  messageIdBytes: Uint8Array,
  rpId: string,
  assertion: Uint8Array,
): number {
  const key = coseKeyParse(alg, coseKey);
  const a = decodeAssertion(assertion);

  // (a) A parse failure and a wrong `type` are ONE refusal, because the clause
  // states them as one condition: what it demands is a `webauthn.get`
  // assertion, and bytes that are not JSON are not one. A `webauthn.create`
  // document here is a REGISTRATION ceremony replayed as an approval -- the
  // person consented to enrolling a key, not to the action.
  let client: unknown;
  try {
    client = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(a.clientDataJson));
  } catch {
    throw new WebauthnRefusal(WEBAUTHN_TYPE, 'HM-4 (a): clientDataJSON is not JSON');
  }
  const type = strProp(client, 'type');
  if (type !== 'webauthn.get') {
    throw new WebauthnRefusal(
      WEBAUTHN_TYPE,
      `HM-4 (a): clientDataJSON type is ${JSON.stringify(type)}, not 'webauthn.get'`,
    );
  }

  // (b) HM-4 (b) / HM-2. RECOMPUTED and compared; never read as a value.
  if (strProp(client, 'challenge') !== webauthnChallenge(messageIdBytes)) {
    throw new WebauthnRefusal(
      WEBAUTHN_CHALLENGE,
      'HM-4 (b): the assertion answers a different challenge than the recomputed id',
    );
  }

  // (c) EXACTLY `https://` + the entry's signed `rp_id`, and nothing else -- no
  // port, no path, no scheme substitution. An assertion made for another origin
  // is an assertion made on another SITE, which is the entire phishing case
  // this binding exists to refuse: the person really did touch their key, on a
  // page an attacker served.
  const wantOrigin = `https://${rpId}`;
  const origin = strProp(client, 'origin');
  if (origin !== wantOrigin) {
    throw new WebauthnRefusal(
      WEBAUTHN_ORIGIN,
      `HM-4 (c): origin ${JSON.stringify(origin)} is not ${JSON.stringify(wantOrigin)}`,
    );
  }

  // (d) Length, rpIdHash and the two flags are one refusal name because they
  // are one question: is this authenticator data for this relying party,
  // produced with the person present and verified? UV is the half that makes
  // the level AT-10 records mean anything -- without it the entry is possession
  // of a device, and HM-1 says possession is not a person.
  if (a.authenticatorData.length < AD_MIN_LEN) {
    throw new WebauthnRefusal(
      WEBAUTHN_AUTHENTICATOR_DATA,
      `HM-4 (d): authenticator_data is ${a.authenticatorData.length} bytes, under the ${AD_MIN_LEN}-byte minimum`,
    );
  }
  if (!bytesEqual(a.authenticatorData.subarray(0, 32), sha256(new TextEncoder().encode(rpId)))) {
    throw new WebauthnRefusal(
      WEBAUTHN_AUTHENTICATOR_DATA,
      "HM-4 (d): rpIdHash is not SHA-256 of the entry's rp_id",
    );
  }
  const flags = a.authenticatorData[32] ?? 0;
  if ((flags & AD_FLAG_UP) === 0) {
    throw new WebauthnRefusal(
      WEBAUTHN_AUTHENTICATOR_DATA,
      'HM-4 (d): the user-present flag is clear',
    );
  }
  if ((flags & AD_FLAG_UV) === 0) {
    throw new WebauthnRefusal(
      WEBAUTHN_AUTHENTICATOR_DATA,
      'HM-4 (d): the user-verified flag is clear',
    );
  }

  // (e) The signed message is the authenticator's own bytes followed by the
  // hash of the client data -- NOT the challenge, and not the id. That is what
  // binds (a)-(d) to the signature: tamper with the origin and the client-data
  // hash moves, so an attacker who wants to pass (c) must re-sign, which needs
  // the credential.
  const signed = new Uint8Array(a.authenticatorData.length + 32);
  signed.set(a.authenticatorData, 0);
  signed.set(sha256(a.clientDataJson), a.authenticatorData.length);

  if (key.kind === 'es256') {
    let ok: boolean;
    try {
      // DER, as WebAuthn's ES256 is defined and as every authenticator emits.
      // The fixed-width form is a different encoding of the same pair and is
      // NOT accepted: two encodings of one signature is two entry digests for
      // one human decision (AB-1).
      //
      // `lowS: false` is a PIN, not a default left alone. noble refuses a
      // high-S signature unless told otherwise; neither engine side does --
      // RustCrypto's `VerifyingKey::verify` and `cryptography`'s
      // `ECDSA(SHA256())` both accept one -- so leaving noble's default in
      // place would make this verifier refuse an assertion the engine accepts.
      // A guard on one side only converts a closed defect into a divergence
      // (ACP-106's lesson, one primitive over), and malleability buys an
      // attacker nothing here: the receipt commits to the exact entry bytes
      // under AB-1, so a re-encoded signature is a different entry the receipt
      // never authorised.
      ok = p256.verify(a.signature, signed, key.sec1, {
        format: 'der',
        prehash: true,
        lowS: false,
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new WebauthnRefusal(
        WEBAUTHN_SIGNATURE,
        'HM-4 (e): ES256 assertion signature is not DER, or does not verify',
      );
    }
  } else {
    // ACP-106's strict rule, on the human leg. `coseKeyParse` has already
    // refused a small-order public key; `verifyEd25519Strict` refuses a
    // small-order `R` as well -- the half that lets a signer emit a signature a
    // non-strict verifier accepts over a message it never committed to. The two
    // halves are one rule, and a human leg verified with only half of it would
    // be the ACP-106 defect reopened for the one signature class where the
    // signer is a person.
    if (
      a.signature.length !== ED25519_SIG_LEN ||
      !verifyEd25519Strict(key.raw, signed, a.signature)
    ) {
      throw new WebauthnRefusal(
        WEBAUTHN_SIGNATURE,
        'HM-4 (e): Ed25519 assertion signature is malformed, non-canonical or does not verify',
      );
    }
  }

  // HM-4 (f)'s INPUT. Big-endian, bytes 33..37, per the WebAuthn
  // authenticator-data layout. The comparison against the stored value is the
  // caller's -- see the module header on why it is not here.
  const c = a.authenticatorData;
  return (
    ((c[33] ?? 0) << 24) | ((c[34] ?? 0) << 16) | ((c[35] ?? 0) << 8) | (c[36] ?? 0)
  ) >>> 0;
}
