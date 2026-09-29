/**
 * The replay (ACP-435): each of `art_harness.py`'s eight cases, twice.
 *
 * 1. WITHOUT POLICY. The AI agent obeys the injection completely (the
 *    harness's `CompliantModel`), and with no agent authorization policy
 *    nothing grades what it proposes. There is no engine call to make, so none
 *    is made: the row says the proposal executes as written.
 * 2. UNDER THE HARNESS BUNDLE. The engine's `decide` grades it. Three honest
 *    outcomes, and nothing here decides between them:
 *    - REFUSED, with the clause the engine names (or the adapter's grammar,
 *      before any engine call). No receipt: the engine signs nothing it refuses.
 *    - HELD: `decision: "ATTEST"`. The action waits for k approvers. What they
 *      would sign is DESCRIBED (k, the roles, the risk); no receipt exists until
 *      they sign it, so none is shown.
 *    - ALLOWED: `issue` the receipt body, `sign` it with the run key, and
 *      `verify` it through the engine's receipt check. A receipt the engine
 *      refuses is a BROKEN RUN, thrown rather than printed: the harness calls a
 *      refusal of its own honest artifact BROKEN, and so does this.
 *
 * THE RECEIPTS ARE DEMONSTRATIONS. The key is T0, made by `keygen` with no seed
 * once per run, and dropped in a `finally` whatever happens. `key_discarded:
 * true` is written into each envelope before the drop, and it is backed because
 * the result is returned only AFTER the drop succeeded: a drop the module
 * refused throws `KeyNotDiscarded` instead of returning envelopes that say
 * otherwise.
 *
 * THE NINTH CASE (ACP-451). When the replay is asked of a policy this scan
 * generated, one more Proposal goes through the same `grade`: the machine's own
 * irreversible tool on the highest floor, written by the scan (`own.ts`) and
 * saved beside the policy folder as `ziffer-replay-own.json`. Its verdict is the engine's,
 * like the eight; nothing here grades it a second way.
 *
 * A SIGNED OBJECT ENTERS THE MODULE AS THE BYTES IT WAS ISSUED AS. The receipt
 * handed to `verify` is the engine's own `canonical_hex`, decoded, with `sig`
 * spliced in; it is never parsed and re-serialised on the way (JavaScript
 * would turn a `1000.0` into `1000` and break the signature).
 */

import { createHash } from 'node:crypto';

import type { Engine } from '../wasm/loader.js';
import type { Json } from '../wasm/json.js';
import { isJson, num, rec, str } from '../wasm/json.js';
import { decide, dropKey, issue, keygen, sign, treeHash, verify } from '../wasm/ops.js';
import type { Outcome, Policy, Risk, Reversibility, Signature, VerifyResult } from '../wasm/ops.js';
import { loadReplayData } from './data.js';
import type { HarnessBundle, JsonObject, ReplayData } from './data.js';
import { NotInGrammar, proposalHash, toProposal } from './proposal.js';
import { OWN_ABSENT_REASON, OWN_LABEL, selectOwn, writeOwnCase } from './own.js';
import type { OwnAbsent, OwnCase } from './own.js';

export const UNSIGNED_DEMO_LINE =
  'UNSIGNED DEMO: the receipts below are signed by a throwaway key made for this run; they are a demonstration, not evidence';
export const WITHOUT_POLICY = 'no agent authorization policy: the proposal executes as written';
export const NOT_EVIDENCE_BECAUSE =
  'signed by a key generated for this run and discarded; no production bundle names it (PB-12)';

/** The suite every T0 key `keygen` makes signs under, and the tree hash's. */
const SUITE = 'hybrid-ed25519-mldsa65';

export class ReplayBroken extends Error {
  override readonly name = 'ReplayBroken';
}

export class KeyNotDiscarded extends Error {
  override readonly name = 'KeyNotDiscarded';
}

export interface DemoEnvelope {
  demo: true;
  receipt: Json;
  signed_under: { fingerprint: string; tier: 'T0'; environment: 'Development' };
  key_discarded: true;
  not_evidence_because: string;
}

export type ReplayOutcome =
  | {
      kind: 'refused';
      /** "grammar": no Proposal exists; "engine": the engine refused the Proposal. */
      stage: 'grammar' | 'engine';
      clause: string;
      message: string;
    }
  | {
      kind: 'held';
      risk: Risk;
      reversibility: Reversibility;
      rule_id: string;
      rule_ids: string[];
      /** What the approvers would sign, described. Not an object anyone signed. */
      awaits: { k: number; required_roles: string[]; risk: Risk; proposal_hash: string; policy_bundle_hash: string };
    }
  | {
      kind: 'allowed';
      risk: Risk;
      reversibility: Reversibility;
      notice_recipients: string[] | null;
      rule_id: string;
      envelope: DemoEnvelope;
      /** The receipt exactly as it was verified. */
      receipt_text: string;
      verification: VerifyResult;
    };

export interface ReplayRow {
  id: string;
  subset: string;
  behaviour: string;
  injection: string;
  tool: string;
  resource: string;
  without_policy: typeof WITHOUT_POLICY;
  /** `null` exactly when the tool is outside the grammar: no Proposal exists. */
  proposal: JsonObject | null;
  outcome: ReplayOutcome;
}

export interface ReplayRun {
  fingerprint: string;
  tenant_id: string;
  policy_bundle_hash: string;
  now: number;
  /** PUBLIC halves only: what a reader needs to check a receipt below. */
  receipt_key: { classical: string; pq: string };
}

export interface ReplayResult {
  first_line: typeof UNSIGNED_DEMO_LINE;
  run: ReplayRun;
  provenance: { cases: ReplayData['caseProvenance']; bundle: ReplayData['bundle']['provenance'] };
  quorum_k: number;
  rows: ReplayRow[];
  /**
   * The ninth case (ACP-451), present only when the replay was asked of a
   * policy this scan generated: the machine's own most dangerous tool, as a
   * Proposal the scan wrote, graded by the engine like the other eight.
   */
  own?: OwnCase | OwnAbsent;
}

export interface ReplayOptions {
  /** POSIX seconds. Default: now. The module has no clock (D4); this is it. */
  now?: number;
  data?: ReplayData;
}

function must<T>(what: string, r: Outcome<T>): T {
  if (r.ok) return r.result;
  const e = r.error;
  throw new ReplayBroken(`${what}: ${e.kind === 'refusal' ? `refused at ${e.clause}: ` : ''}${e.message}`);
}

/** Eight hex characters of the key fingerprint, whatever prefix it is spelled with. */
export function hex8(fingerprint: string): string {
  const hex = fingerprint.toLowerCase().replace(/^[a-z0-9-]*:/, '').replace(/[^0-9a-f]/g, '');
  if (hex.length < 8) throw new ReplayBroken(`the key fingerprint ${fingerprint} carries fewer than 8 hex digits`);
  return hex.slice(0, 8);
}

/** `decide_batch`'s case object (D7) as TEXT, the receipt spliced in unparsed. */
export function verifyCaseText(
  name: string,
  now: number,
  receiptText: string,
  proposal: JsonObject,
  bundle: JsonObject,
): string {
  return `{"name":${JSON.stringify(name)},"now":${JSON.stringify(now)},"receipt":${receiptText},"proposal":${JSON.stringify(proposal)},"bundle":${JSON.stringify(bundle)},"door":null}`;
}

/**
 * The receipt text: the engine's canonical body bytes with `sig` spliced in
 * before the closing brace.
 *
 * The receipt's `sig` is the PER-PRIMITIVE map, `{classical, pq}` -- the
 * `parts` of what `sign` returns, not the whole `{suite, parts}` object. The
 * suite is the body's own `alg`, inside the signature; the receipt check
 * refuses any `sig` whose keys are not exactly the suite's primitives. (The
 * design record's `sign` row calls its result "the receipt's `sig`"; the
 * engine's receipt check reads only the `parts` shape, found on the first run.)
 */
export function receiptText(canonicalHex: string, sig: Signature): string {
  const body = Buffer.from(canonicalHex, 'hex').toString('utf8');
  if (!body.startsWith('{') || !body.endsWith('}')) throw new ReplayBroken('the issued body is not a JSON object');
  return `${body.slice(0, -1)}${body === '{}' ? '' : ','}"sig":${JSON.stringify(sig.parts)}}`;
}

function parseReceipt(text: string): Json {
  const v: unknown = JSON.parse(text);
  if (!isJson(v)) throw new ReplayBroken('the receipt is not JSON data');
  return v;
}

/**
 * The verifier's copy of the bundle, as `decide_batch`'s case carries it: the
 * harness's verifier fields, the five member documents, and the two values
 * this run supplies -- the demo tenant and the run key's PUBLIC halves as the
 * receipt signing identity. `adapters` is the plain table, not the document.
 */
export function verifierBundle(b: HarnessBundle, run: ReplayRun): JsonObject {
  const adapters = rec(b.policy.adapters, 'policy.adapters')['adapters'];
  if (adapters === undefined || !isJson(adapters)) throw new ReplayBroken('policy.adapters carries no adapters table');
  return {
    ...b.verifier,
    tenant_id: run.tenant_id,
    policy_bundle_hash: run.policy_bundle_hash,
    floors: b.policy.floors,
    risk_functions: b.policy.risk_functions,
    reversibility: b.policy.reversibility,
    notice_targets: b.policy.notice_targets,
    adapters,
    receipt_key: run.receipt_key,
  };
}

const MEMBER_FILES: readonly (keyof Policy)[] = ['floors', 'risk_functions', 'reversibility', 'notice_targets', 'adapters'];

export async function replay(engine: Engine, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const data = opts.data ?? loadReplayData();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const b = data.bundle;
  const key = must('keygen', await keygen(engine));
  let result: ReplayResult | undefined;
  let failure: unknown;
  try {
    const tenant = `ten_demo_${hex8(key.fingerprint)}`;
    // The policy basis, hashed BY THE ENGINE over the member documents this run
    // sends -- not the harness's `Bundle.hash()`, which digests a different
    // object (its KMS receipt key, its tenant).
    const members = MEMBER_FILES.map((m) => ({
      path: `${m}.json`,
      sha256_hex: createHash('sha256').update(JSON.stringify(b.policy[m]), 'utf8').digest('hex'),
    }));
    const bundleHash = must('tree_hash', await treeHash(engine, SUITE, members)).hash;
    const run: ReplayRun = {
      fingerprint: key.fingerprint,
      tenant_id: tenant,
      policy_bundle_hash: bundleHash,
      now,
      receipt_key: { classical: key.classical_pub_hex, pq: key.pq_pub_hex },
    };
    const verifier = verifierBundle(b, run);

    /**
     * One Proposal through the engine: refused, held, or allowed with a demo
     * receipt the engine verified. The eight harness cases and the ninth case
     * share it, so no case is graded by a second path.
     */
    const grade = async (id: string, proposal: JsonObject, pHash: string): Promise<ReplayOutcome> => {
      const d = await decide(engine, { proposal, policy: b.policy });
      if (!d.ok) {
        if (d.error.kind !== 'refusal') throw new ReplayBroken(`${id}: decide: ${d.error.message}`);
        return { kind: 'refused', stage: 'engine', clause: d.error.clause, message: d.error.message };
      }
      const g = d.result;
      if (g.decision === 'ATTEST') {
        return {
          kind: 'held',
          risk: g.risk_floor_only,
          reversibility: g.reversibility,
          rule_id: g.rule_id,
          rule_ids: g.rule_ids,
          awaits: {
            k: b.quorum_k,
            required_roles: b.issuer.required_roles,
            risk: g.risk_floor_only,
            proposal_hash: pHash,
            policy_bundle_hash: bundleHash,
          },
        };
      }
      const issued = must(
        `${id}: issue`,
        await issue(engine, {
          tenant_id: tenant,
          operator: data.operator,
          proposal_hash: pHash,
          schema_id: str(proposal, 'schema_id', 'proposal'),
          schema_version: str(proposal, 'schema_version', 'proposal'),
          schema_hash: str(proposal, 'schema_hash', 'proposal'),
          fidelity: g.fidelity,
          policy_bundle_hash: bundleHash,
          bundle_epoch: num(b.verifier, 'epoch', 'verifier'),
          context_snapshot_hash: b.issuer.context_snapshot_hash,
          rule_id: g.rule_id,
          // Floor-only: a replay has no Context Store, so the effective grade IS
          // the floor-only grade (the module's `decide` says the same).
          risk_level_effective: g.risk_floor_only,
          risk_level_floor_only: g.risk_floor_only,
          attestation_digests: [],
          alg: SUITE,
          now,
          audit_id: `demo_${hex8(key.fingerprint)}_${id}`,
        }),
      );
      const sig = must(`${id}: sign`, await sign(engine, key.handle, issued.canonical_hex));
      const text = receiptText(issued.canonical_hex, sig);
      const v = await verify(engine, verifyCaseText(id, now, text, proposal, verifier));
      if (!v.ok) {
        const where = v.error.kind === 'refusal' ? ` at ${v.error.clause}` : '';
        throw new ReplayBroken(`${id}: the engine refused the receipt this run issued${where}: ${v.error.message}`);
      }
      return {
        kind: 'allowed',
        risk: g.risk_floor_only,
        reversibility: g.reversibility,
        notice_recipients: g.notice_recipients,
        rule_id: g.rule_id,
        envelope: {
          demo: true,
          receipt: parseReceipt(text),
          signed_under: { fingerprint: key.fingerprint, tier: 'T0', environment: 'Development' },
          key_discarded: true,
          not_evidence_because: NOT_EVIDENCE_BECAUSE,
        },
        receipt_text: text,
        verification: v.result,
      };
    };

    const rows: ReplayRow[] = [];
    for (const c of data.cases) {
      const base: Omit<ReplayRow, 'proposal' | 'outcome'> = {
        id: c.id,
        subset: c.subset,
        behaviour: c.behaviour,
        injection: c.injection,
        tool: c.intended_call.tool,
        resource: c.intended_call.resource,
        without_policy: WITHOUT_POLICY,
      };
      let proposal: JsonObject;
      try {
        proposal = toProposal(c.intended_call, b.grammar, data.operator, tenant);
      } catch (e) {
        if (!(e instanceof NotInGrammar)) throw e;
        rows.push({
          ...base,
          proposal: null,
          outcome: { kind: 'refused', stage: 'grammar', clause: 'V-11', message: `no such verb: ${e.message}` },
        });
        continue;
      }
      rows.push({ ...base, proposal, outcome: await grade(c.id, proposal, proposalHash(proposal)) });
    }

    // The ninth case (ACP-451): only when the policy is one this scan generated.
    let own: ReplayResult['own'];
    if (data.own !== undefined) {
      const pick = selectOwn(b.policy, data.own.tools);
      if (pick === undefined) {
        writeOwnCase(data.own, undefined);
        own = { absent: true, reason: OWN_ABSENT_REASON };
      } else {
        const proposal = toProposal(
          { tool: pick.tool.key, resource: pick.tool.server_key, params: {} },
          b.grammar,
          data.operator,
          tenant,
        );
        // Computed ONCE: the same value is written to the file and carried by the row.
        const pHash = proposalHash(proposal);
        writeOwnCase(data.own, { ...pick, proposal, proposal_hash: pHash });
        own = {
          server: pick.tool.server,
          tool: pick.tool.key,
          original_name: pick.tool.original_name,
          without: 'executes',
          outcome: await grade('own', proposal, pHash),
          label: OWN_LABEL,
        };
      }
    }
    result = {
      first_line: UNSIGNED_DEMO_LINE,
      run,
      provenance: { cases: data.caseProvenance, bundle: b.provenance },
      quorum_k: b.quorum_k,
      rows,
      ...(own === undefined ? {} : { own }),
    };
  } catch (e) {
    failure = e;
  } finally {
    let dropped = false;
    try {
      dropped = (await dropKey(engine, key.handle)).ok;
    } catch {
      dropped = false;
    }
    if (failure === undefined && !dropped) {
      failure = new KeyNotDiscarded(`the module did not drop key ${key.handle}; no envelope may say it was discarded`);
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new ReplayBroken('the replay produced no result');
  return result;
}
