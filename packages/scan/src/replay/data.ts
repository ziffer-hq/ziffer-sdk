/**
 * The replay's data: the eight `art_harness.py` cases and that file's bundle,
 * PORTED as JSON with their provenance (ACP-435), plus the plain words column B
 * prints for a refusal. This module reads and narrows them; it holds no case,
 * no floor and no rule of its own. The engine decides; these files only say
 * what it is asked.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isJson, json, num, rec, str, strs } from '../wasm/json.js';
import type { Json } from '../wasm/json.js';
import type { Policy } from '../wasm/ops.js';

export type JsonObject = { [key: string]: Json };

export interface Provenance {
  copied_from: string;
  engine_commit: string;
  copied_on: string;
  note: string;
}

/** The call the injected AI agent makes, exactly as the harness fixture states it. */
export interface IntendedCall {
  tool: string;
  resource: string;
  params: JsonObject;
}

/** One `AttackCase` (`art_harness.py` FIXTURES). */
export interface ReplayCase {
  id: string;
  subset: string;
  behaviour: string;
  injection: string;
  intended_call: IntendedCall;
}

/** `to_proposal`'s TOOLS and SCHEMA_HASHES: the adapter's closed grammar. Not a bundle member. */
export interface Grammar {
  schema_version: string;
  fidelity: string;
  /** The harness's tenant. The replay substitutes its own demo tenant (see `replay.ts`). */
  tenant_id: string;
  tools: Record<string, { schema_id: string; resource: string }>;
  schema_hashes: Record<string, string>;
}

export interface HarnessBundle {
  provenance: Provenance;
  /** The five member documents the fold reads, each with its `schema_version`. */
  policy: Policy;
  grammar: Grammar;
  /**
   * The verifier's copy of the rest of the bundle, as `wire_bundle()` wrote it:
   * epoch, quorum_k, min_suite, limits, attesters, doors, assurance. NO
   * `receipt_key` and NO `policy_bundle_hash`: the replay supplies both.
   */
  verifier: JsonObject;
  quorum_k: number;
  issuer: { context_snapshot_hash: string; required_roles: string[] };
}

export interface PlainWords {
  refused: Record<string, string>;
  refused_unknown: string;
}

/** One tool the generated policy names: its keys in the bundle and its names as the scan found them. */
export interface OwnTool {
  /** The tool's key in the bundle (`execute_sql_2`), which is the Proposal's `task_type`. */
  key: string;
  /** The server's key in the bundle, which is the Proposal's target and `schema_id`. */
  server_key: string;
  /** The server's name as the client config spells it. */
  server: string;
  /** The tool's name as the server lists it. */
  original_name: string;
  /**
   * The draft's `irreversible_class` for the tool (ACP-454): 3 runs or
   * destroys, 2 changes shared state, 1 sends or pays, 0 not irreversible.
   * The own case ranks by it after the floor tier.
   */
  effect_class: number;
}

/**
 * What the ninth case is built from (ACP-451): present only when the replay is
 * asked of a policy this scan generated, never of the harness's.
 */
export interface OwnSource {
  /** The directory the policy was written to; the case is written beside it. */
  out: string;
  scan_version: string;
  engine_pin: string;
  date: string;
  tools: OwnTool[];
}

export interface ReplayData {
  cases: ReplayCase[];
  caseProvenance: Provenance;
  operator: string;
  bundle: HarnessBundle;
  words: PlainWords;
  own?: OwnSource;
}

/** `<package>/data/replay`, from this file's own location (`dist/replay/data.js`). */
export function replayDataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'replay');
}

function object(v: unknown, where: string): JsonObject {
  const r = rec(v, where);
  const out: JsonObject = {};
  for (const k of Object.keys(r)) out[k] = json(r, k, where);
  return out;
}

function strMap(v: unknown, where: string): Record<string, string> {
  const r = rec(v, where);
  const out: Record<string, string> = {};
  for (const k of Object.keys(r)) out[k] = str(r, k, where);
  return out;
}

function provenance(v: unknown, where: string): Provenance {
  const r = rec(v, where);
  return {
    copied_from: str(r, 'copied_from', where),
    engine_commit: str(r, 'engine_commit', where),
    copied_on: str(r, 'copied_on', where),
    note: str(r, 'note', where),
  };
}

function readJson(path: string): unknown {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isJson(v)) throw new Error(`ReplayDataMalformed: ${path} is not JSON data`);
  return v;
}

export function parseCases(v: unknown): { cases: ReplayCase[]; provenance: Provenance; operator: string } {
  const r = rec(v, 'cases.json');
  const list = r['cases'];
  if (!Array.isArray(list)) throw new Error('ReplayDataMalformed: cases.json carries no "cases" array');
  const cases = list.map((c, i): ReplayCase => {
    const where = `cases.json.cases[${i}]`;
    const o = rec(c, where);
    const call = rec(o['intended_call'], `${where}.intended_call`);
    return {
      id: str(o, 'id', where),
      subset: str(o, 'subset', where),
      behaviour: str(o, 'behaviour', where),
      injection: str(o, 'injection', where),
      intended_call: {
        tool: str(call, 'tool', `${where}.intended_call`),
        resource: str(call, 'resource', `${where}.intended_call`),
        params: object(call['params'], `${where}.intended_call.params`),
      },
    };
  });
  return { cases, provenance: provenance(r['provenance'], 'cases.json.provenance'), operator: str(r, 'operator', 'cases.json') };
}

export function parseBundle(v: unknown): HarnessBundle {
  const r = rec(v, 'harness-bundle.json');
  const p = rec(r['policy'], 'harness-bundle.json.policy');
  const g = rec(r['grammar'], 'harness-bundle.json.grammar');
  const tools = rec(g['tools'], 'grammar.tools');
  const toolMap: Record<string, { schema_id: string; resource: string }> = {};
  for (const name of Object.keys(tools)) {
    const t = rec(tools[name], `grammar.tools.${name}`);
    toolMap[name] = { schema_id: str(t, 'schema_id', `grammar.tools.${name}`), resource: str(t, 'resource', `grammar.tools.${name}`) };
  }
  const verifier = object(r['verifier'], 'harness-bundle.json.verifier');
  for (const absent of ['receipt_key', 'policy_bundle_hash']) {
    if (absent in verifier) {
      throw new Error(`ReplayDataMalformed: the verifier copy carries ${absent}; the replay supplies it, and a second one would be read instead`);
    }
  }
  const issuer = rec(r['issuer'], 'harness-bundle.json.issuer');
  return {
    provenance: provenance(r['provenance'], 'harness-bundle.json.provenance'),
    policy: {
      floors: json(p, 'floors', 'policy'),
      risk_functions: json(p, 'risk_functions', 'policy'),
      reversibility: json(p, 'reversibility', 'policy'),
      notice_targets: json(p, 'notice_targets', 'policy'),
      adapters: json(p, 'adapters', 'policy'),
    },
    grammar: {
      schema_version: str(g, 'schema_version', 'grammar'),
      fidelity: str(g, 'fidelity', 'grammar'),
      tenant_id: str(g, 'tenant_id', 'grammar'),
      tools: toolMap,
      schema_hashes: strMap(g['schema_hashes'], 'grammar.schema_hashes'),
    },
    verifier,
    quorum_k: num(verifier, 'quorum_k', 'verifier'),
    issuer: {
      context_snapshot_hash: str(issuer, 'context_snapshot_hash', 'issuer'),
      required_roles: strs(issuer, 'required_roles', 'issuer'),
    },
  };
}

export function parseWords(v: unknown): PlainWords {
  const r = rec(v, 'plain-words.json');
  return { refused: strMap(r['refused'], 'plain-words.json.refused'), refused_unknown: str(r, 'refused_unknown', 'plain-words.json') };
}

export function loadReplayData(dir: string = replayDataDir()): ReplayData {
  const c = parseCases(readJson(join(dir, 'cases.json')));
  return {
    cases: c.cases,
    caseProvenance: c.provenance,
    operator: c.operator,
    bundle: parseBundle(readJson(join(dir, 'harness-bundle.json'))),
    words: parseWords(readJson(join(dir, 'plain-words.json'))),
  };
}

