/**
 * §9.3 step 7b -- the AT-* quorum and §8.6b's AB-*, run in the CUSTOMER's own
 * process against the CUSTOMER's own signed bundle.
 *
 * # Why this exists (ACP-406 gap 1)
 *
 * Until this module, a customer verifying a ZIFFER receipt checked the
 * signature and the bindings and **trusted us for the approvals**: the header
 * table in `verify.ts` said "7b -- NO, needs the attester registry". A
 * compromised receipt-signing substrate could therefore emit a floor-HIGH
 * receipt carrying fabricated `attestation_digests`, and every customer-side
 * verifier would accept it. The registry is in the customer's OWN signed
 * bundle -- the tree they already load for `policy_bundle_hash` -- so nothing
 * about that trust was necessary. This is the third implementation of the
 * step, after `reference/src/acp_executor.py::_verify_quorum` and
 * `crates/acp-decision/src/quorum.rs`, and the clause names are theirs.
 *
 * # AT-9 is TWO requirements and they fail closed on disjoint inputs
 *
 * 1. The threshold is **recomputed** from the signed bundle's `quorum_k`
 *    (PB-6) and never read from an attestation. Through v1.3.14 the reference
 *    read `entries[0].required_count` -- asking the party under verification
 *    how many signatures to demand -- and one compromised attester key signing
 *    one object carrying `required_count: 1` executed a floor-HIGH action.
 * 2. **Every** entry's `required_count` must equal `quorum_k`. That is a
 *    CONSENT check (AT-3), not a threshold one: two humans approving while both
 *    objects say `3` means they approved believing a third reviewer existed.
 *
 * Deleting (2) cannot lower a quorum; deleting (1) cannot detect an attester
 * who signed under a different stated threshold. Keeping only (1) satisfies
 * INV-1-HIGH while silently executing actions no attester agreed to.
 *
 * # What this CANNOT check customer-side, and why -- read before trusting a pass
 *
 * These are absences, not agreements. Each one is a step of §9.3 this package
 * does not run, and each is disclosed here rather than approximated:
 *
 * - **Whether a quorum was required at all.** §9.3 step 7 recomputes the
 *   floor-only risk from the bundle's `floors.json` and `risk_functions.json`;
 *   this package does not grade, so it cannot know that a receipt carrying an
 *   EMPTY attestation list should have carried a quorum. A receipt with no
 *   attestations passes 7b vacuously (AB-1's own note covers the legitimate
 *   LOW/MEDIUM case) and {@link verifyQuorum} returns `null` so the caller can
 *   see that nothing was verified. **Reading `risk_level_floor_only` off the
 *   receipt instead would be X1 -- the defect where a compromised issuer
 *   asserting `LOW` suppressed attestation entirely** -- so it is not read.
 * - **`obj.floor_only_risk` against the recomputed grade** (7b(iii), TR-8), for
 *   the same reason: there is no recomputed grade here to compare against.
 * - **Single-use of the recomputed `attestation_id`** (7b(v), CL-3). That needs
 *   a linearizable Consumption Ledger and this package holds none. Replay
 *   protection that forgets is not replay protection, so it is named rather
 *   than half-built.
 * - **HM-4 (f)'s stored signature counter** is `T` at this boundary: the caller
 *   hands in what it stored and MUST persist what {@link QuorumOutcome}
 *   returns. A caller passing an empty map every time has switched (f) off for
 *   a credential that has signed before.
 *
 * # One deliberate NARROWING beyond both engine implementations
 *
 * AT-1 says role membership "is resolved against the attester registry", and
 * neither engine implementation resolves it: `quorum.rs` records that
 * `AttesterRole` is generated and read by nothing, and the Python reference has
 * no role field at all. This one does, because the customer's registry carries
 * `role` and their bundle is the authority on who may approve: an entry counts
 * toward the quorum only if its attester's REGISTRY role is named in the
 * object's `required_roles`. An empty list means the rule demanded a quorum and
 * named no role, so any enrolled attester satisfies it (AT-1 as amended in
 * v1.3.32, ACP-308) -- which is byte-for-byte the engine's behaviour, and is the
 * case every ZIFFER deployment is in today except where the policy engine sets
 * `["approver"]`.
 *
 * This is a NARROWER acceptance, never a wider one, and it is stated because a
 * third implementation that refuses what the other two accept is a divergence
 * even when it is the safer side. Its strength is bounded and that is disclosed
 * too: `required_roles` is read from the OBJECT (class **B** -- signed by the
 * attester, evidence of what they were shown), because the bundle names no
 * per-rule role list for it to be recomputed from. A compromised issuer that
 * writes an empty list degrades this check to the engine's behaviour and no
 * further.
 *
 * # Suite 12 classification -- R / B / T for every control input read here
 *
 * | input | class | why |
 * | --- | :---: | --- |
 * | `quorumK` | **R** | from the signed bundle, never an attestation (AT-9) |
 * | attester keys and credentials | **R** | read out of the signed registry after the bundle's own signature checked; `rpId` above all, because HM-4 (c) compares the assertion's origin against THIS and an origin taken from the assertion would compare a value with itself |
 * | `floor` | **R** | the signed manifest's `min_suite` (CR-4) |
 * | `policyBundleHash`, `bundleEpoch` | **R** | the bundle the caller trusts; the object's copies are compared against them (7b(iii)) |
 * | the eleven AT-1 fields | **B** | the attester signature covers the derived id, which covers the whole object |
 * | `obj.proposal_hash` | **B** | and compared against the hash this verifier recomputed from the caller's own proposal bytes (Y1) |
 * | `obj.required_count` | **B** | and compared against `quorumK` (AT-9's consent half) |
 * | `obj.required_roles` | **B** | signed, and resolved against the registry; see the narrowing above for what it does NOT prove |
 * | `entry.attester` | **B** | a name SELECTS a key; the signature establishes identity (ACK-4) |
 * | `entry.attestation_id` | **R** | derived; a transmitted value is compared, never used (Y1b) |
 * | `attestation_digests` | **B** | inside the signed receipt body (AB-5), and each entry's digest is recomputed from the received bytes (AB-1) |
 * | `entry.kind` | **B** | bound by the entry digest under the receipt signature (AB-1). **NARROWED RESIDUAL, not closed**: the attester does not sign `kind`, so the ISSUER still chooses per entry whose signature counts as an approval |
 * | `webauthnCounters` | **T** | the caller's stored counters; this package holds no ledger and says so above |
 */

import { createHash } from 'node:crypto';

import { canon } from './canon.js';
import {
  CLAUSE_ASSURANCE,
  CLAUSE_ATTESTATION_SUITE,
  CLAUSE_ATTESTER_SIG,
  CLAUSE_ATT_NONCE_SIZE,
  CLAUSE_BINDING,
  CLAUSE_CARDINALITY,
  CLAUSE_CONSENT,
  CLAUSE_DERIVED_ID,
  CLAUSE_DIGEST_DUP,
  CLAUSE_DIGEST_ORDER,
  CLAUSE_MALFORMED,
  CLAUSE_MEMBERSHIP,
  CLAUSE_NO_ATTESTATIONS,
  CLAUSE_NO_OBJECT,
  CLAUSE_OBJECT_SCHEMA,
  CLAUSE_OPERATOR_DISAGREE,
  CLAUSE_OPERATOR_SELF,
  CLAUSE_POLICY_BASIS,
  CLAUSE_QUORUM,
  CLAUSE_WEBAUTHN_ALG,
  CLAUSE_WEBAUTHN_COUNTER,
  CLAUSE_WIRE_TYPE,
} from './clauses.js';
import { parseInstant } from './instant.js';
import { Refusal } from './refusal.js';
import { hex, parseSig, verifyUnderSuite } from './sig.js';
import { parseSuite, satisfiesFloor, type Suite } from './suite.js';
import {
  WEBAUTHN_ALGS,
  WEBAUTHN_PRIMITIVE,
  WebauthnRefusal,
  WEBAUTHN_AUTHENTICATOR_DATA,
  WEBAUTHN_CHALLENGE,
  WEBAUTHN_ORIGIN,
  WEBAUTHN_SIGNATURE,
  WEBAUTHN_TYPE,
  verifyWebauthn,
} from './webauthn.js';
import { b64Decode, isRecord, isWe4B64, NONCE128_BYTES, NONCE128_LEN, strField } from './wire.js';

/**
 * AT-8b: the Attestation Object schema is CLOSED. Exactly this field set, no
 * more and no less.
 *
 * An unknown field is refused rather than ignored and a missing one is never
 * defaulted (Z4). Normalising either would let an issuer add a field a future
 * verifier reads, or drop one this verifier checks, without invalidating a
 * signature that covers only what is present.
 */
export const AT1_FIELDS: readonly string[] = [
  'alg',
  'att_nonce',
  'bundle_epoch',
  'context_snapshot_hash',
  'expires_at',
  'floor_only_risk',
  'operator',
  'policy_bundle_hash',
  'proposal_hash',
  'required_count',
  'required_roles',
];

/** The four fields AB-1's preimage must carry, plus the one it may. */
const ENTRY_REQUIRED: readonly string[] = ['obj', 'kind', 'attester', 'sig'];
const ENTRY_ALLOWED: readonly string[] = [...ENTRY_REQUIRED, 'attestation_id'];

/** AT-10's ladder. Ranked, unlike suites, whose floor is containment (CR-4). */
const ASSURANCE_ORDER: readonly string[] = ['AS0', 'AS1', 'AS2'];

/** A machine attester's hybrid pair, decoded from the signed registry. */
export interface HybridAttester {
  readonly kind: 'hybrid';
  /** Ed25519 verification key, 32 raw bytes. */
  readonly classical: Uint8Array;
  /** ML-DSA-65 verification key, 1,952 raw bytes. */
  readonly pq: Uint8Array;
  /** The registry's `role`, or null where the entry declares none. */
  readonly role: string | null;
}

/**
 * HM-1 -- a human attester's enrolled credential, as the SIGNED registry
 * carries it.
 *
 * No private key is reachable from here: `publicKey` is the COSE_Key the
 * authenticator returned at registration and the private half is on the
 * person's phone or security key. That is the strongest custody statement in
 * this package, and the one a software key file could never make.
 */
export interface WebauthnAttester {
  readonly kind: 'webauthn';
  /** The approval origin's host. Signed policy (HM-4 (c), (d)). */
  readonly rpId: string;
  /** What the Consumption Ledger keys the signature counter by (HM-4 (f)). */
  readonly credentialId: string;
  /** The COSE_Key bytes, base64-decoded by the caller's bundle loader. */
  readonly publicKey: Uint8Array;
  /** `webauthn-es256` or `webauthn-ed25519` (HM-1). */
  readonly alg: string;
  /** The registry's `role`, or null where the entry declares none. */
  readonly role: string | null;
}

/**
 * One registry identity: a machine's hybrid pair or a person's WebAuthn
 * credential.
 *
 * A TAGGED union here because it is a tagged union in the signed document
 * (`attesters.schema.json`, v1.3.30). A kind guessed from which fields are
 * present is how a machine entry that lost its `pq` leg reads as a human.
 */
export type AttesterCredential = HybridAttester | WebauthnAttester;

/**
 * The quorum policy. **Every field comes from the customer's SIGNED bundle**,
 * and nothing here may be sourced from the receipt or from an Attestation
 * Object -- that is AT-9 for `quorumK`, PB-KEY for `attesters`, CR-4 for the
 * floor (taken from the {@link import('./verify.js').TrustAnchor}'s `minSuite`,
 * so the package has one definition of the floor and not two).
 */
export interface QuorumPolicy {
  /** PB-6. The number of DISTINCT approvals a floor-HIGH action requires. */
  readonly quorumK: number;
  /**
   * The attester registry: identity -> credential. PB-7 distinctness over the
   * keys is the BUNDLE LOADER's obligation and is assumed to have run; a second
   * copy here would be two definitions of one rule, so this module depends on
   * that check rather than restating it.
   */
  readonly attesters: ReadonlyMap<string, AttesterCredential>;
  /** AT-10: per-identity enrolled assurance, from the signed registry. */
  readonly assurances: ReadonlyMap<string, string>;
  /** AT-10: the registry's floor (`min_attester_assurance`). */
  readonly minAssurance: string;
  /** Step 4's trusted bundle hash, compared against each object's (7b(iii)). */
  readonly policyBundleHash: string;
  /** Step 4's trusted bundle epoch, compared against each object's (7b(iii)). */
  readonly bundleEpoch: number;
  /**
   * HM-4 (f): the signature counter this verifier has STORED per
   * `credential_id`. **T at this package's boundary** -- see the module header.
   * A credential absent from the map reads as 0, which is what a credential
   * that has never been seen has.
   */
  readonly webauthnCounters?: ReadonlyMap<string, number>;
}

/** What {@link verifyQuorum} concluded. */
export interface QuorumOutcome {
  /** The operator, from the VERIFIED objects (Y4) -- never the receipt body. */
  readonly operator: string;
  /** The distinct attesters whose approvals were counted, sorted. */
  readonly approvals: readonly string[];
  /**
   * HM-4 (f): the counter each credential's assertion carried, by
   * `credential_id`. **The caller MUST persist these**; a verifier that accepts
   * an assertion and does not advance the stored counter has accepted the same
   * assertion twice.
   */
  readonly webauthnCounters: ReadonlyMap<string, number>;
}

/** The values every attestation is checked against, established by the caller. */
export interface DecisionBasis {
  /** The hash this verifier recomputed from the caller's own proposal bytes. */
  readonly proposalHash: string;
  /** The receipt's `issued_at`, already parsed at step 5, epoch seconds. */
  readonly receiptIssuedAt: number;
  /** The CR-4 floor from the signed manifest, as a parsed suite. */
  readonly floor: Suite;
}

/**
 * AT-8a -- `sha256:` over the canonical bytes, the reference's `h()`.
 *
 * The canonical encoding is `canon.ts`'s, which is the engine's
 * `acp_executor.canon` / `receipt.rs::canon`. AT-8a names canonical CBOR and
 * both engine implementations use canonical JSON here; this package reproduces
 * what the engine actually signs, because a verifier that hashed a different
 * preimage would refuse every genuine attestation. The divergence is the
 * engine's and is recorded in `acp_executor.canon`'s own docstring.
 */
function digestOf(value: unknown): string {
  return `sha256:${hex(Uint8Array.from(createHash('sha256').update(canon(value)).digest()))}`;
}

/**
 * AT-8a -- derive an Attestation Object's id from its canonical bytes.
 * **Derived, never read**: the id names a binding, and a transmitted name for a
 * binding is not evidence of one (Y1b).
 */
export function attestationId(obj: unknown): string {
  return digestOf(obj);
}

/**
 * AB-1 -- the receipt's commitment to ONE attestation entry.
 *
 * ENTRY-SCOPED, NEVER OBJECT-SCOPED, and this is the whole trap.
 * {@link attestationId} already exists and is `h(obj)` -- reusing it here is the
 * obvious move and it is wrong. {@link AT1_FIELDS} is closed over the OBJECT: it
 * contains no `kind`, no `attester` and no `sig`. Quorum composition reads
 * `kind` and `attester` from the ENTRY and the attester signs neither, so an
 * object-scoped digest lets an attacker on the transport path flip `kind` from
 * `confirmation` to `approval` while every digest still matches.
 *
 * The two identifiers MUST NOT be merged: `attestation_id` is what a ledger
 * consumes for single-use under CL-3, because the same object replayed inside a
 * different entry is still a replay. This digest is what the receipt authorised,
 * byte for byte.
 */
export function entryDigest(entry: unknown): string {
  if (!isRecord(entry)) {
    throw new Refusal(CLAUSE_MEMBERSHIP, 'attestation entry is not a map');
  }
  const present = Object.keys(entry);
  const missing = ENTRY_REQUIRED.filter((k) => !present.includes(k));
  const extra = present.filter((k) => !ENTRY_ALLOWED.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Refusal(
      CLAUSE_MEMBERSHIP,
      `entry schema violation missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
    );
  }
  return digestOf(entry);
}

function intField(obj: Record<string, unknown>, name: string, clause: string): number {
  const raw = obj[name];
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Refusal(clause, `attestation object field ${name} is not an integer`);
  }
  return raw;
}

function requiredStr(obj: Record<string, unknown>, name: string, clause: string): string {
  const v = strField(obj, name);
  if (v === null) {
    throw new Refusal(clause, `attestation object field ${name} is not a string`);
  }
  return v;
}

/** The HM-4 step names that travel out as the refusal's clause. */
const HM4_STEPS: readonly string[] = [
  WEBAUTHN_TYPE,
  WEBAUTHN_CHALLENGE,
  WEBAUTHN_ORIGIN,
  WEBAUTHN_AUTHENTICATOR_DATA,
  WEBAUTHN_SIGNATURE,
];

/**
 * HM-3 and HM-4 (a)-(e) over one entry, returning the counter (f) compares.
 *
 * **HM-3 IS CHECKED BEFORE ANY BYTE OF THE ASSERTION IS EXAMINED.** `alg` is an
 * AT-1 field and therefore signature-covered (CR-5), but that only proves the
 * ISSUER chose it: the registry is what says which kind of key this identity
 * holds. Parsing attacker-supplied bytes under the wrong algorithm is work done
 * on the attacker's behalf.
 */
function verifyWebauthnEntry(
  cred: WebauthnAttester,
  objAlg: string,
  sig: unknown,
  messageId: string,
): number {
  if (objAlg !== cred.alg) {
    throw new Refusal(
      CLAUSE_WEBAUTHN_ALG,
      `HM-3: attestation alg ${objAlg} is not the registered alg ${cred.alg}`,
    );
  }
  // HM-3: EXACTLY the one primitive. A map carrying `webauthn` beside
  // `classical` would be a human leg with a machine leg stapled to it, which is
  // not a stronger signature -- it is two different claims about who decided,
  // and CR-3's conjunction has nothing to say about a pair that names two
  // holders.
  const keys = isRecord(sig) ? Object.keys(sig) : [];
  const encoded = isRecord(sig) ? sig[WEBAUTHN_PRIMITIVE] : undefined;
  if (keys.length !== 1 || keys[0] !== WEBAUTHN_PRIMITIVE || typeof encoded !== 'string') {
    throw new Refusal(
      CLAUSE_MALFORMED,
      'HM-3: a webauthn entry carries exactly the one primitive `webauthn`',
    );
  }
  // WE-4, and the `b64:` prefix is PART OF THE VALUE -- the same rule
  // `att_nonce` is held to, one field over.
  if (!isWe4B64(encoded)) {
    throw new Refusal(
      CLAUSE_MALFORMED,
      'HM-3/WE-4: the assertion is not `b64:` + RFC 4648 sec 4 base64 with padding',
    );
  }
  const raw = b64Decode(encoded.slice('b64:'.length));
  if (raw === null) {
    throw new Refusal(CLAUSE_MALFORMED, 'HM-3: assertion is not base64');
  }
  try {
    return verifyWebauthn(
      cred.alg,
      cred.publicKey,
      new TextEncoder().encode(messageId),
      cred.rpId,
      raw,
    );
  } catch (e: unknown) {
    if (!(e instanceof WebauthnRefusal)) throw e;
    // The step's NAME becomes the clause, and HM-4 travels in the message. One
    // clause for all six failures would give six distinguishable faults one
    // name, and the cross-implementation comparison is on exactly this field.
    //
    // `Malformed` and `RegistryKeyWeak` fold together into `Malformed`: the
    // assertion or the credential is not this shape at all. `RegistryKeyWeak`
    // should be unreachable here because the bundle loader refuses such a key at
    // enrolment -- it is folded in rather than left to fall through, because a
    // branch that produced no refusal would let the caller continue as though
    // the leg had verified.
    if (HM4_STEPS.includes(e.refusalName)) throw new Refusal(e.refusalName, e.detail);
    throw new Refusal(CLAUSE_MALFORMED, `${e.refusalName}: ${e.detail}`);
  }
}

/** The registry's `role` for an identity, or null. */
function roleOf(cred: AttesterCredential): string | null {
  return cred.role;
}

/**
 * §9.3 step 7b over the attestations travelling beside one receipt.
 *
 * @param policy   the customer's own signed-bundle quorum policy.
 * @param basis    the values recomputed by `verifyReceipt` before this runs.
 * @param entries  `receipt.attestations`, as parsed JSON.
 * @param digests  `receipt.attestation_digests`, as parsed JSON.
 * @returns the outcome, or `null` when no attestations travelled and none were
 *          committed to -- the vacuous LOW/MEDIUM case of AB-1's own note.
 *          `null` means "nothing was verified", never "a quorum held": see the
 *          module header on why this package cannot tell that a quorum was
 *          REQUIRED.
 * @throws  {@link Refusal} with the engine's clause names.
 */
export function verifyQuorum(
  policy: QuorumPolicy,
  basis: DecisionBasis,
  entries: unknown,
  digests: unknown,
): QuorumOutcome | null {
  // The shapes first, so a malformed carrier is named rather than iterated.
  // The engine tolerates a non-list `attestations` by falling back to `[]`
  // (`receipt.get("attestations") or []`); refusing it is a NARROWER
  // acceptance and is pinned by a test, because a truthy non-list there would
  // be iterated by the reference into per-character entries.
  if (entries !== undefined && entries !== null && !Array.isArray(entries)) {
    throw new Refusal(CLAUSE_MEMBERSHIP, 'attestations is not a list');
  }
  const list: unknown[] = Array.isArray(entries) ? entries : [];
  const digestsAbsent = digests === undefined || digests === null;

  // The vacuous case, and it is AB-1's own note: a LOW/MEDIUM receipt carries
  // no quorum and commits to none. Checked BEFORE the digest type check only
  // when the field is genuinely absent -- a field that is PRESENT and not a
  // list of strings is a malformed receipt whatever its length would have been.
  if (list.length === 0 && digestsAbsent) return null;

  let signed: string[];
  if (Array.isArray(digests) && digests.every((d) => typeof d === 'string')) {
    signed = digests.filter((d): d is string => typeof d === 'string');
  } else {
    // An absent list refuses under AB-1's TYPE check exactly as the reference's
    // `isinstance` does: `None` never short-circuits to "no digests to check".
    throw new Refusal(CLAUSE_MEMBERSHIP, 'attestation_digests is not a list of strings');
  }

  if (list.length === 0 && signed.length === 0) return null;
  if (list.length === 0) {
    // An empty entry list beside a populated digest list is a MISSING QUORUM,
    // not a cardinality mismatch, and the operator must be told which. The
    // engine puts this first for the same reason.
    throw new Refusal(CLAUSE_NO_ATTESTATIONS, 'receipt commits to attestations that did not arrive');
  }

  // AB-3: duplicates refused HERE and explicitly, BEFORE the ordering check --
  // the reference's order, which matters on an input wrong in both ways. In an
  // Executor holding a Consumption Ledger this check is masked by CL-3 and
  // kills no mutant (a positive-path obligation); this package has no ledger,
  // and here it is the only thing standing between a duplicated digest and a
  // quorum counted twice.
  const distinct = new Set(signed);
  if (distinct.size !== signed.length) {
    throw new Refusal(CLAUSE_DIGEST_DUP, 'duplicate attestation digests');
  }

  // AB-2: ONE canonical ordering, strictly ascending over the UTF-8 bytes of
  // the digest strings INCLUDING the `sha256:` prefix -- the prefix is part of
  // the value, never decoration. Without it the same quorum yields two
  // canonical encodings of one receipt, hence two receipt identities.
  for (let i = 1; i < signed.length; i += 1) {
    const prev = signed[i - 1];
    const cur = signed[i];
    if (prev === undefined || cur === undefined) continue; // unreachable; index in range
    if (!(prev < cur)) {
      throw new Refusal(CLAUSE_DIGEST_ORDER, 'attestation_digests is not sorted');
    }
  }

  // AB-4: cardinality in BOTH directions. Membership alone lets an attacker
  // WITHHOLD entries -- every digest they do send still matches, and the quorum
  // silently shrinks. Counting from the digest list instead would be reading
  // the size of the quorum off the receipt: AT-3's defect, one layer down.
  if (list.length !== signed.length) {
    throw new Refusal(
      CLAUSE_CARDINALITY,
      `${list.length} attestations received against ${signed.length} signed digests`,
    );
  }

  // HM-4 (f)'s working copy, seeded from what the caller stored and advanced as
  // entries are accepted, so two entries in ONE receipt made by one credential
  // are held to the same "strictly greater" rule that two receipts are. Without
  // the local copy the second would be compared against the stored value the
  // first already passed, and a replayed assertion beside its original would
  // count twice toward the quorum.
  const counters = new Map<string, number>(policy.webauthnCounters ?? new Map());
  const claimed = new Map<string, number>();
  const approvals = new Set<string>();
  const operators = new Set<string>();

  for (const raw of list) {
    // AB-1: membership, checked FIRST and recomputed from the received bytes
    // (§9.3 step 7b(0)). Before the signature, so an entry the receipt never
    // committed to is refused before the verifier spends work on
    // attacker-supplied material.
    const digest = entryDigest(raw);
    if (!distinct.has(digest)) {
      throw new Refusal(CLAUSE_MEMBERSHIP, "attestation is not in the receipt's signed digest list");
    }
    // `entryDigest` has already proved this is a record with the four fields.
    const entry: Record<string, unknown> = isRecord(raw) ? raw : {};
    const obj = entry['obj'];
    if (!isRecord(obj)) {
      throw new Refusal(CLAUSE_NO_OBJECT, 'attestation carries no object (v1.3.2 form)');
    }

    // AT-8b: CLOSED schema. Exact field set, never normalised.
    const presentFields = Object.keys(obj);
    const missing = AT1_FIELDS.filter((k) => !presentFields.includes(k));
    const extra = presentFields.filter((k) => !AT1_FIELDS.includes(k));
    if (missing.length > 0 || extra.length > 0) {
      throw new Refusal(
        CLAUSE_OBJECT_SCHEMA,
        `object schema violation missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
      );
    }

    // WE-4 then AT-1, in that order and never the other way round: an
    // `att_nonce` wrong in both ways must stop at the same rule in every
    // implementation. AT-8b above closes the field SET and says nothing about
    // the spelling of a value, so this sits one layer beneath it -- and the id
    // derived below is SHA-256 over the canonical bytes of the whole object, so
    // `b64:AAAA==` and `AAAA==` would be TWO IDS FOR ONE OBJECT.
    const nonce = strField(obj, 'att_nonce') ?? '';
    if (!isWe4B64(nonce)) {
      throw new Refusal(
        CLAUSE_WIRE_TYPE,
        `att_nonce ${JSON.stringify(obj['att_nonce'])} is not b64: + RFC 4648 sec 4 base64 with padding`,
      );
    }
    if (nonce.length !== NONCE128_LEN) {
      throw new Refusal(CLAUSE_ATT_NONCE_SIZE, `att_nonce is not ${NONCE128_BYTES * 8}-bit`);
    }

    // (i) The id is DERIVED from the canonical object, and it is also the
    // message the attester signed. Deriving it before the signature check is
    // what makes the signature cover the whole object rather than a digest
    // somebody else chose.
    const aid = attestationId(obj);

    // CR-5: `alg` is an AT-1 field, so the suite is signature-covered.
    const alg = requiredStr(obj, 'alg', CLAUSE_ATTESTATION_SUITE);
    const attester = strField(entry, 'attester') ?? '';
    const registered = policy.attesters.get(attester);

    // §8.6c: IS THIS LEG A PERSON'S? Answered from the registry entry OR from
    // the object's declared suite, and then the two are required to agree
    // (HM-3), because either one alone decides nothing. Taking it from the
    // object would let a compromised issuer route a machine's entry down the
    // human path; taking it from the registry would let an object claiming
    // `hybrid-ed25519-mldsa65` be verified as an assertion. The DISAGREEMENT is
    // the refusal.
    const human = registered?.kind === 'webauthn' || WEBAUTHN_ALGS.includes(alg);
    if (human) {
      if (registered === undefined || registered.kind !== 'webauthn') {
        throw new Refusal(
          CLAUSE_WEBAUTHN_ALG,
          `HM-3: ${attester} is not a registered human attester, but the object claims ${alg}`,
        );
      }
      // CR-8: NO SUITE FLOOR HERE, and its absence IS the clause rather than an
      // omission. `min_suite` is CR-4 containment over MACHINE suites, and no
      // authenticator in existence produces a post-quantum signature -- so
      // comparing a human leg against a hybrid floor would refuse every person
      // §8.6c exists to admit. What HM-6 says the classical leg costs is paid
      // elsewhere: AB-1 digests this whole entry, assertion bytes included, into
      // the receipt body a hybrid key signs, and §11 anchors that.
      const counter = verifyWebauthnEntry(registered, alg, entry['sig'], aid);

      // HM-4 (f). Strictly greater whenever EITHER is non-zero, so a credential
      // whose authenticator does not implement a counter (both zero, forever)
      // still verifies -- the WebAuthn specification permits that, and refusing
      // it would refuse a class of real hardware.
      const stored = counters.get(registered.credentialId) ?? 0;
      if ((stored !== 0 || counter !== 0) && counter <= stored) {
        throw new Refusal(
          CLAUSE_WEBAUTHN_COUNTER,
          `HM-4 (f): signature counter ${counter} for credential ${registered.credentialId.slice(0, 16)} did not advance past ${stored}: the credential is cloned, or the assertion is a replay`,
        );
      }
      counters.set(registered.credentialId, counter);
      claimed.set(registered.credentialId, counter);
    } else {
      // CR-4 by CONTAINMENT. An UNKNOWN suite refuses here under CR-4 rather
      // than CR-1, matching `Bundle.suite_ok`, which returns False for a name it
      // does not know; the receipt path spells the same condition CR-1 and the
      // comparison across implementations is on refusal NAMES, so the reference
      // wins.
      const suite = parseSuite(alg);
      if (suite === null || !satisfiesFloor(suite, basis.floor)) {
        throw new Refusal(CLAUSE_ATTESTATION_SUITE, `attestation suite ${alg} below bundle floor`);
      }
      if (registered === undefined || registered.kind !== 'hybrid') {
        // An identity absent from the signed registry is not an attester
        // (ACK-4): a name nobody enrolled must not be able to satisfy
        // INV-1-HIGH.
        throw new Refusal(CLAUSE_ATTESTER_SIG, 'attester signature invalid');
      }
      let bad = true;
      try {
        // The machine parse HERE and not earlier: the shape a signature must
        // have is the shape its SUITE requires, and the suite is only settled
        // once the branch above has established that this leg is a machine's.
        const parts = parseSig(entry['sig'], alg);
        bad = verifyUnderSuite(suite, registered, new TextEncoder().encode(aid), parts) !== null;
      } catch (e: unknown) {
        // A shape complaint from `parseSig` is a bad ATTESTER signature here,
        // not a bad receipt signature: the engine remaps the same way, and a
        // `9.3-1` escaping this loop would name the wrong artifact.
        if (!(e instanceof Refusal)) throw e;
        bad = true;
      }
      if (bad) throw new Refusal(CLAUSE_ATTESTER_SIG, 'attester signature invalid');
    }

    // (ii) THE BINDING. Y1: a genuine signature over an object bound to a
    // DIFFERENT proposal is a valid attestation to something else.
    if (requiredStr(obj, 'proposal_hash', CLAUSE_BINDING) !== basis.proposalHash) {
      throw new Refusal(CLAUSE_BINDING, 'attestation bound to a DIFFERENT proposal');
    }

    // (iii) The policy basis the attester was shown, against the bundle the
    // CALLER trusts. `floor_only_risk` is NOT compared -- see the module header:
    // there is no recomputed grade in this package to compare it against, and
    // comparing it against the receipt's own assertion would be X1.
    if (
      requiredStr(obj, 'policy_bundle_hash', CLAUSE_POLICY_BASIS) !== policy.policyBundleHash ||
      intField(obj, 'bundle_epoch', CLAUSE_POLICY_BASIS) !== policy.bundleEpoch
    ) {
      throw new Refusal(CLAUSE_POLICY_BASIS, 'attestation policy basis mismatch');
    }

    // (iii) AT-9's SECOND requirement: CONSENT, not threshold. This is not how
    // the quorum size is obtained -- that is `quorumK` below, and this field is
    // never consulted for it. A first pass at the engine's fix DELETED this
    // check, arguing the threshold is already bound transitively through
    // `policy_bundle_hash`. The argument was sound and the conclusion wrong: it
    // considered only attacks that LOWER the threshold, and raising the stated
    // count is an attack on consent, not on the invariant.
    const stated = intField(obj, 'required_count', CLAUSE_CONSENT);
    if (stated !== policy.quorumK) {
      throw new Refusal(
        CLAUSE_CONSENT,
        `attester signed for quorum ${stated}, bundle requires ${policy.quorumK}`,
      );
    }

    // (iii) Freshness of the object itself, against the receipt's issuance.
    // PARSED, never compared as strings: two RFC 3339 strings compare
    // lexicographically and would agree with this check for every canonical
    // value and then disagree on the first one that was not (ACP-167).
    const objExp = parseInstant(requiredStr(obj, 'expires_at', CLAUSE_POLICY_BASIS));
    if (objExp === null) {
      throw new Refusal(
        CLAUSE_POLICY_BASIS,
        'attestation object field expires_at is not an RFC 3339 UTC instant',
      );
    }
    if (objExp < basis.receiptIssuedAt) {
      throw new Refusal(CLAUSE_POLICY_BASIS, 'attestation expired before issuance');
    }

    // (iii-a) The operator comes from the VERIFIED object (Y4), never from the
    // receipt body -- a body/object disagreement must not be resolved in favour
    // of the body.
    operators.add(requiredStr(obj, 'operator', CLAUSE_POLICY_BASIS));

    // (v) Y1b: the derived id is authoritative. A transmitted id is permitted to
    // be absent and refused when it disagrees. Still load-bearing against a
    // COMPROMISED issuer, which chooses the digest list: a garbage
    // `attestation_id` inside a correctly-digested entry passes membership, and
    // only this recomputation catches it.
    const transmitted = entry['attestation_id'];
    if (transmitted !== undefined && transmitted !== aid) {
      throw new Refusal(CLAUSE_DERIVED_ID, 'transmitted attestation_id != derived id');
    }

    // (iv) AT-10: the key that signed is held the way approver keys must be
    // held -- both sides from the SIGNED BUNDLE, never from the entry. Every
    // check above this line verifies a signature, and a signature says only that
    // a key was used: a private key in a config file on a build host satisfied
    // all of them. Before any count, approvals and confirmations alike, matching
    // the engine's position exactly so a multi-defect entry refuses at the same
    // clause in every implementation.
    const level = policy.assurances.get(attester) ?? 'AS0';
    const have = ASSURANCE_ORDER.indexOf(level);
    const need = ASSURANCE_ORDER.indexOf(policy.minAssurance);
    if (have < 0 || need < 0) {
      // P-4 applied to the ladder itself, not only to its members: a level
      // outside the ladder has no rank, and ranking it anywhere would be
      // guessing on the permissive side half the time.
      throw new Refusal(
        CLAUSE_ASSURANCE,
        `assurance level outside the AS0..AS2 ladder: enrolled ${level}, floor ${policy.minAssurance}`,
      );
    }
    if (have < need) {
      throw new Refusal(
        CLAUSE_ASSURANCE,
        `attester ${attester} enrolled at ${level}, bundle floor is ${policy.minAssurance}`,
      );
    }

    // The `kind` routing disclosed in the module header. Distinct ATTESTERS,
    // not distinct entries: the set is what AT-3 counts.
    //
    // AT-1's role resolution is the narrowing the header states: an empty
    // `required_roles` means any enrolled attester satisfies it (v1.3.32), and a
    // non-empty one is resolved against the REGISTRY's role for this identity,
    // never against a role the entry supplies.
    if (entry['kind'] === 'approval') {
      const wanted = obj['required_roles'];
      if (!Array.isArray(wanted)) {
        throw new Refusal(
          CLAUSE_OBJECT_SCHEMA,
          'attestation object field required_roles is not a list',
        );
      }
      const role = roleOf(registered);
      if (wanted.length === 0 || (role !== null && wanted.includes(role))) {
        approvals.add(attester);
      }
    }
  }

  if (operators.size !== 1) {
    throw new Refusal(CLAUSE_OPERATOR_DISAGREE, 'attestations disagree on operator');
  }
  const operator = [...operators][0];
  if (operator === undefined) {
    throw new Refusal(CLAUSE_OPERATOR_DISAGREE, 'attestations disagree on operator');
  }

  // AT-9's FIRST requirement. Reading the threshold from the signed bundle
  // rather than from an entry raises nothing, so no mutant can score this line
  // -- it is DEFENCE IN DEPTH, and the engine records the same thing rather
  // than dressing it up as a control. The branch that CAN refuse is below.
  if (approvals.size < policy.quorumK) {
    throw new Refusal(CLAUSE_QUORUM, `quorum ${approvals.size} < ${policy.quorumK}`);
  }

  // AT-2 distinctness: the proposer never counts toward their own quorum.
  if (approvals.has(operator)) {
    throw new Refusal(CLAUSE_OPERATOR_SELF, 'operator counted toward own quorum');
  }

  return { operator, approvals: [...approvals].sort(), webauthnCounters: claimed };
}
