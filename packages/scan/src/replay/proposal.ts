/**
 * `to_proposal`, ported from `reference/suites/art_harness.py` at engine commit
 * 96f4ec8518481380f0701a3b3a495e225b819cf9 (~line 250), copied 2026-09-25
 * (ACP-435). A COPY of the harness's adapter: the engine, not this file, grades
 * what it produces.
 *
 * The adapter stamps `schema_*`, `fidelity` and `tenant_id`; the AI agent
 * supplies the tool, the resource and the parameters and nothing else. A tool
 * the grammar does not name produces NO Proposal (`NotInGrammar`): there is
 * nothing to authorise, exactly as the harness reports `REFUSED_AT_INGRESS`.
 * `cidrs` is EMPTY, never absent: an absent member would give one action two
 * encodings.
 *
 * ONE DEPARTURE, and it is the tenant: the harness stamps `"t1"`; the replay
 * stamps its own demo tenant, because the receipt names that tenant and the
 * receipt check compares the two.
 */

import { createHash } from 'node:crypto';

import type { Json } from '../wasm/json.js';
import type { Grammar, IntendedCall, JsonObject } from './data.js';

export class NotInGrammar extends Error {
  override readonly name = 'NotInGrammar';
}

export function toProposal(call: IntendedCall, grammar: Grammar, operator: string, tenantId: string): JsonObject {
  const spec = grammar.tools[call.tool];
  if (spec === undefined) throw new NotInGrammar(call.tool);
  const schemaHash = grammar.schema_hashes[spec.schema_id];
  if (schemaHash === undefined) throw new Error(`ReplayDataMalformed: no schema hash for ${spec.schema_id}`);
  return {
    schema_id: spec.schema_id,
    schema_version: grammar.schema_version,
    schema_hash: schemaHash,
    fidelity: grammar.fidelity,
    tenant_id: tenantId,
    payload: {
      task_type: call.tool,
      operator,
      targets: [call.resource === '' ? spec.resource : call.resource],
      params: { ...call.params },
      cidrs: {},
    },
  };
}

/**
 * The Proposal's `proposal_hash` as the ISSUER states it on the receipt.
 *
 * This is the one digest the replay computes itself, because the module
 * exposes no op for it. It is safe to compute here for a reason worth stating:
 * the verifier RECOMPUTES it from the Proposal it is handed and refuses a
 * mismatch at the receipt check's proposal binding, so a divergence between
 * this function and the engine's can only make the replay's own receipt fail,
 * never make a wrong one pass. The replay test's round trip is what shows they
 * agree. Objects by sorted key (UTF-8 byte order), arrays in place, strings and
 * integers as JSON writes them; a non-integer number is refused rather than
 * spelled, because the engine's canonical form refuses floats too.
 */
export function canonText(v: Json): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`CanonicalFloat: ${v} is not an integer`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonText).join(',')}]`;
  const keys = Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonText(v[k] ?? null)}`).join(',')}}`;
}

export function proposalHash(proposal: Json): string {
  return `sha256:${createHash('sha256').update(canonText(proposal), 'utf8').digest('hex')}`;
}
