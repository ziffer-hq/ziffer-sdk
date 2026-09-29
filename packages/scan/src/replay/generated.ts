/**
 * The replay's data for the policy a scan JUST GENERATED (ACP-440): the eight
 * harness cases, unchanged, asked of the generated bundle instead of the
 * harness's.
 *
 * Nothing here decides anything. Every value is read from the generated bundle
 * or from what the engine answered when it activated it (`bundle_verify`):
 *
 * - policy: the five member documents, parsed from the exact text written.
 * - grammar: the adapter's closed list of tools. A tool is in it exactly when
 *   the generated policy names it -- its key in the bundle -- mapped to its
 *   server's key as the `schema_id` (the key `adapters.json` is keyed by). A
 *   case whose tool the policy does not name gets no Proposal at all and is
 *   refused at the grammar, which is the honest result: this policy has never
 *   heard of that tool. The case's own resource is kept as the AI agent named
 *   it; a resource this policy has no floor for is graded by the engine's own
 *   absent rule, not by a default here.
 * - verifier: the engine's reading of the bundle (tenant, epoch, doors,
 *   limits), and the approvers from `attesters/registry.json`, re-spelt from
 *   base64 into the hex the verifier's copy carries.
 *
 * ONE VALUE HAS NO SOURCE IN THE BUNDLE, and it is the schema hash a Proposal
 * carries. A scan never sees the servers' input schemas, only their parameter
 * names, so it states what it has: the sha256 of each server's tool list as
 * this scan read it (names and parameter names, canonical form). It is a name
 * for "the tools this scan saw", not a digest of any server's schema, and the
 * receipt check compares it only with the Proposal's own copy.
 */

import { createHash } from 'node:crypto';

import type { GeneratedBundle } from '../bundle/generate.js';
import { toolId } from '../bundle/names.js';
import { effectClass } from '../classify/index.js';
import { packageVersion } from '../package-info.js';
import type { CatalogTool } from '../types.js';
import type { Json } from '../wasm/json.js';
import { isJson, isRecord, json, num, rec, str } from '../wasm/json.js';
import type { JsonObject, OwnTool, ReplayData } from './data.js';
import { canonText } from './proposal.js';

/** The generated bundle is not a replay input: something the replay needs is not in it. */
export class GeneratedPolicyUnreadable extends Error {
  override readonly name = 'GeneratedPolicyUnreadable';
}

const MEMBERS = ['floors', 'risk_functions', 'reversibility', 'notice_targets', 'adapters'] as const;
/** The adapter grammar's stamps, shared with `ci/` (ACP-442) so a CI Proposal is spelt as the replay's. */
export const SCHEMA_VERSION = '1.0.0';
export const FIDELITY = 'F-HIGH';

function member(bundle: GeneratedBundle, path: string): Json {
  const f = bundle.files.find((x) => x.path === path);
  if (f === undefined) throw new GeneratedPolicyUnreadable(`the generated bundle has no ${path}`);
  const v: unknown = JSON.parse(f.text);
  if (!isJson(v)) throw new GeneratedPolicyUnreadable(`${path} is not JSON data`);
  return v;
}

const hex = (b64: string): string => Buffer.from(b64, 'base64').toString('hex');

function hybridHex(v: unknown, where: string): JsonObject {
  const r = rec(v, where);
  return { classical: hex(str(r, 'classical', where)), pq: hex(str(r, 'pq', where)) };
}

function attesters(registry: Json): { attesters: JsonObject; quorum_k: number; roles: string[] } {
  const r = rec(registry, 'attesters/registry.json');
  const table = rec(r['attesters'], 'attesters/registry.json.attesters');
  const out: JsonObject = {};
  const roles = new Set<string>();
  for (const [id, entry] of Object.entries(table)) {
    const e = rec(entry, `attesters.${id}`);
    out[id] = { kind: str(e, 'kind', `attesters.${id}`), ...hybridHex(e, `attesters.${id}`) };
    roles.add(str(e, 'role', `attesters.${id}`));
  }
  return { attesters: out, quorum_k: num(r, 'quorum_k', 'attesters/registry.json'), roles: [...roles].sort() };
}

/** sha256 over the canonical text of one server's tools as this scan read them. */
export function toolListHash(tools: readonly CatalogTool[]): string {
  const list: Json = tools
    .map((t): Json => ({ tool: t.tool, params: [...t.params].sort() }))
    .sort((a, b) => (canonText(a) < canonText(b) ? -1 : canonText(a) > canonText(b) ? 1 : 0));
  return `sha256:${createHash('sha256').update(canonText(list), 'utf8').digest('hex')}`;
}

export function generatedReplayData(
  base: ReplayData,
  bundle: GeneratedBundle,
  catalog: readonly CatalogTool[],
  where: { path: string; engine_pin: string; date: string },
): ReplayData {
  const policy = {
    floors: member(bundle, 'floors.json'),
    risk_functions: member(bundle, 'risk_functions.json'),
    reversibility: member(bundle, 'reversibility.json'),
    notice_targets: member(bundle, 'notice_targets.json'),
    adapters: member(bundle, 'adapters.json'),
  };
  for (const m of MEMBERS) if (!isRecord(policy[m])) throw new GeneratedPolicyUnreadable(`${m}.json is not an object`);

  // The grammar: every tool the policy names, by its key in the bundle.
  const tools: Record<string, { schema_id: string; resource: string }> = {};
  const hashes: Record<string, string> = {};
  const byServer = new Map<string, CatalogTool[]>();
  const own = new Map<string, OwnTool>();
  for (const t of catalog) {
    const serverKey = bundle.servers.map.get(t.server);
    const toolKey = bundle.tools.map.get(toolId(t.server, t.tool));
    if (serverKey === undefined || toolKey === undefined) {
      throw new GeneratedPolicyUnreadable(`the bundle assigned no key to "${t.tool}" on "${t.server}"`);
    }
    tools[toolKey] = { schema_id: serverKey, resource: serverKey };
    if (!own.has(toolKey)) own.set(toolKey, { key: toolKey, server_key: serverKey, server: t.server, original_name: t.tool, effect_class: effectClass(t) });
    const list = byServer.get(serverKey) ?? [];
    if (!list.some((x) => x.tool === t.tool)) list.push(t);
    byServer.set(serverKey, list);
  }
  for (const [serverKey, list] of byServer) hashes[serverKey] = toolListHash(list);

  const reg = attesters(member(bundle, 'attesters/registry.json'));
  const v = bundle.verified;
  const doors = rec(v.doors, 'bundle_verify.doors');
  const verifier: JsonObject = {
    epoch: v.epoch,
    tenant_id: bundle.tenantId,
    quorum_k: reg.quorum_k,
    min_suite: json(rec(member(bundle, 'manifest.json'), 'manifest.json'), 'min_suite', 'manifest.json'),
    limits: v.limits,
    attesters: reg.attesters,
    attester_assurance: {},
    min_attester_assurance: json(rec(member(bundle, 'attesters/registry.json'), 'registry'), 'min_attester_assurance', 'registry'),
    doors: {
      presentation: hybridHex(doors['presentation'], 'doors.presentation'),
      notification: hybridHex(doors['notification'], 'doors.notification'),
    },
  };

  return {
    ...base,
    bundle: {
      provenance: {
        copied_from: where.path,
        engine_commit: where.engine_pin,
        copied_on: where.date,
        note: 'generated by this scan from the tools it found; a draft to review, signed by a key made for the run',
      },
      policy,
      grammar: { schema_version: SCHEMA_VERSION, fidelity: FIDELITY, tenant_id: bundle.tenantId, tools, schema_hashes: hashes },
      verifier,
      quorum_k: reg.quorum_k,
      issuer: { context_snapshot_hash: base.bundle.issuer.context_snapshot_hash, required_roles: reg.roles },
    },
    own: {
      out: where.path,
      scan_version: packageVersion(),
      engine_pin: where.engine_pin,
      date: where.date,
      tools: [...own.values()],
    },
  };
}
