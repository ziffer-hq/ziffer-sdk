/**
 * Typed wrappers for the operations in the ACP-434 design record, §2,
 * transcribed from that table (and checked against `crates/acp-wasm/src/lib.rs`
 * on 2026-09-25, engine commit 51cd02a on the ACP-434 branch, not yet pinned).
 *
 * Each wrapper sends the request and narrows the result through the guards in
 * `json.ts`; none of them computes anything. Where the record says a field is
 * "a JSON value passed through" it is typed `Json` here and not re-described:
 * the policy members, the Proposal and the receipt body are the engine's
 * objects, and describing them again in TypeScript would be a second definition.
 *
 * NOT IN V1: `attestation_object`. The record's D11 amendment dropped it,
 * because `acp-decision` has no library builder of the §8.6 object to call. It
 * is absent here rather than stubbed; a wrapper for an op the module refuses as
 * unknown would be a function that exists and cannot succeed.
 */

import type { Engine, RefusalError, RequestError } from './loader.js';
import { bool, json, num, oneOf, rec, str, strs } from './json.js';
import type { Json } from './json.js';

export type Outcome<T> = { ok: true; result: T } | { ok: false; error: RefusalError | RequestError };

async function run<T>(
  engine: Engine,
  op: string,
  request: Record<string, unknown>,
  parse: (r: Record<string, unknown>, where: string) => T,
): Promise<Outcome<T>> {
  const response = await engine.call(op, request);
  if (!response.ok) return response;
  return { ok: true, result: parse(rec(response.result, op), op) };
}

/** Lowercase hex (D6). Bytes never cross as base64. */
export type Hex = string;
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';
const RISKS: readonly Risk[] = ['LOW', 'MEDIUM', 'HIGH'];
export type Reversibility = 'REVERSIBLE' | 'IRREVERSIBLE';
const REVERSIBILITIES: readonly Reversibility[] = ['REVERSIBLE', 'IRREVERSIBLE'];

/** Each member DOCUMENT as it sits in the bundle, with its `schema_version` (§2). */
export interface Policy {
  floors: Json;
  risk_functions: Json;
  reversibility: Json;
  notice_targets: Json;
  adapters: Json;
}

export interface GradeRequest {
  proposal: Json;
  policy: Policy;
}

export interface GradeResult {
  risk_floor_only: Risk;
  reversibility: Reversibility;
  notice_recipients: string[] | null;
  effective_tier: string;
  fidelity: string;
}

function parseGrade(r: Record<string, unknown>, where: string): GradeResult {
  return {
    risk_floor_only: oneOf(r, 'risk_floor_only', RISKS, where),
    reversibility: oneOf(r, 'reversibility', REVERSIBILITIES, where),
    notice_recipients: r['notice_recipients'] === null ? null : strs(r, 'notice_recipients', where),
    effective_tier: str(r, 'effective_tier', where),
    fidelity: str(r, 'fidelity', where),
  };
}

export interface DecideResult extends GradeResult {
  decision: 'ALLOW' | 'ATTEST';
  rule_id: string;
  rule_ids: string[];
}

export interface KeygenResult {
  handle: number;
  fingerprint: string;
  classical_pub_hex: Hex;
  pq_pub_hex: Hex;
  tier: 'T0';
  seeded: boolean;
}

/**
 * What `sign` and `bundle_sign` return: the WHOLE object is the bundle
 * `SIGNATURE` file's shape, `{suite, parts}`. A receipt's `sig` is NOT this
 * object: it is the `parts` map alone, `{classical, pq}`, because the suite is
 * the receipt body's own signed `alg` (see `replay.ts`'s `receiptText`).
 */
export interface Signature {
  suite: string;
  parts: { classical: Hex; pq: Hex };
}

function parseSignature(r: Record<string, unknown>, where: string): Signature {
  const parts = rec(r['parts'], `${where}.parts`);
  return {
    suite: str(r, 'suite', where),
    parts: { classical: str(parts, 'classical', `${where}.parts`), pq: str(parts, 'pq', `${where}.parts`) },
  };
}

/** Every `Issued` field (§2 `issue`). `now` is POSIX seconds (D4). */
export interface IssueRequest {
  tenant_id: string;
  operator: string;
  proposal_hash: string;
  schema_id: string;
  schema_version: string;
  schema_hash: string;
  fidelity: string;
  policy_bundle_hash: string;
  bundle_epoch: number;
  context_snapshot_hash: string;
  rule_id: string;
  risk_level_effective: Risk;
  risk_level_floor_only: Risk;
  attestation_digests: string[];
  alg: string;
  now: number;
  audit_id: string;
}

export interface IssueResult {
  body: Json;
  canonical_hex: Hex;
}

export interface VerifyResult {
  verdict: 'PASSED';
  risk: Risk;
  operator: string;
}

export interface DigestMember {
  path: string;
  sha256_hex: Hex;
}

export interface BytesMember {
  path: string;
  bytes_hex: Hex;
}

export interface BundleVerifyRequest {
  suite: string;
  members: BytesMember[];
  signature: Signature;
  pubkeys: { classical_pub_hex: Hex; pq_pub_hex: Hex };
  now: number;
}

/** The accessors `BundleHost::activate` exposes; their contents are the engine's objects. */
export interface BundleVerifyResult {
  tenant_id: Json;
  epoch: Json;
  receipt_identity: Json;
  doors: Json;
  limits: Json;
}

export function grade(engine: Engine, req: GradeRequest): Promise<Outcome<GradeResult>> {
  return run(engine, 'grade', { ...req }, parseGrade);
}

export function decide(engine: Engine, req: GradeRequest): Promise<Outcome<DecideResult>> {
  return run(engine, 'decide', { ...req }, (r, where) => ({
    ...parseGrade(r, where),
    decision: oneOf(r, 'decision', ['ALLOW', 'ATTEST'], where),
    rule_id: str(r, 'rule_id', where),
    rule_ids: strs(r, 'rule_ids', where),
  }));
}

/** D8: the key stays in the module's memory; only the handle and public halves cross. */
export function keygen(engine: Engine, seedHex?: Hex): Promise<Outcome<KeygenResult>> {
  return run(engine, 'keygen', seedHex === undefined ? {} : { seed_hex: seedHex }, (r, where) => ({
    handle: num(r, 'handle', where),
    fingerprint: str(r, 'fingerprint', where),
    classical_pub_hex: str(r, 'classical_pub_hex', where),
    pq_pub_hex: str(r, 'pq_pub_hex', where),
    tier: oneOf(r, 'tier', ['T0'], where),
    seeded: bool(r, 'seeded', where),
  }));
}

export function dropKey(engine: Engine, handle: number): Promise<Outcome<Record<string, never>>> {
  return run(engine, 'drop_key', { handle }, () => ({}));
}

/**
 * Sign `messageHex` with the key behind `handle`. The result is the
 * `SIGNATURE`-file shape `{suite, parts}`; to sign a receipt, splice
 * `result.parts` in as its `sig`, never the whole object (the design record's
 * `sign` row was corrected the same way).
 */
export function sign(engine: Engine, handle: number, messageHex: Hex): Promise<Outcome<Signature>> {
  return run(engine, 'sign', { handle, message_hex: messageHex }, parseSignature);
}

export function issue(engine: Engine, req: IssueRequest): Promise<Outcome<IssueResult>> {
  return run(engine, 'issue', { ...req }, (r, where) => ({
    body: json(r, 'body', where),
    canonical_hex: str(r, 'canonical_hex', where),
  }));
}

/**
 * D7: the request IS `decide_batch`'s case object, sent as TEXT so a signed
 * number's spelling survives (see `Engine.callRaw`).
 */
export async function verify(engine: Engine, caseText: string): Promise<Outcome<VerifyResult>> {
  const response = await engine.callRaw('verify', caseText);
  if (!response.ok) return response;
  const r = rec(response.result, 'verify');
  return {
    ok: true,
    result: {
      verdict: oneOf(r, 'verdict', ['PASSED'], 'verify'),
      risk: oneOf(r, 'risk', RISKS, 'verify'),
      operator: str(r, 'operator', 'verify'),
    },
  };
}

export function treeHash(engine: Engine, suite: string, members: DigestMember[]): Promise<Outcome<{ hash: string }>> {
  return run(engine, 'tree_hash', { suite, members }, (r, where) => ({ hash: str(r, 'hash', where) }));
}

export function bundleSign(
  engine: Engine,
  handle: number,
  suite: string,
  members: DigestMember[],
): Promise<Outcome<Signature>> {
  return run(engine, 'bundle_sign', { handle, suite, members }, parseSignature);
}

export function bundleVerify(engine: Engine, req: BundleVerifyRequest): Promise<Outcome<BundleVerifyResult>> {
  return run(engine, 'bundle_verify', { ...req }, (r, where) => ({
    tenant_id: json(r, 'tenant_id', where),
    epoch: json(r, 'epoch', where),
    receipt_identity: json(r, 'receipt_identity', where),
    doors: json(r, 'doors', where),
    limits: json(r, 'limits', where),
  }));
}
