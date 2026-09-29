/**
 * The replay's ninth case (ACP-451): the machine's own most dangerous tool, as
 * a Proposal this scan wrote. The eight harness cases show what an injected AI
 * agent would try on somebody else's tools; this one shows the developer their
 * own tool held (or refused, or allowed) by the policy the scan just wrote.
 *
 * NOTHING HERE GRADES. This file picks the tool, writes the Proposal, and
 * writes both beside the policy as data; the verdict is the engine's, reached
 * through the same path as the harness cases (`replay.ts`).
 *
 * THE PICK, and where each input comes from:
 *
 * - "irreversible" is the classifier's draft as the GENERATED bundle carries
 *   it: `reversibility.json` says IRREVERSIBLE for exactly the tools the
 *   classifier drafted irreversible (`bundle/generate.ts`: write tools are left
 *   absent, reads are REVERSIBLE). Reading it from the bundle rather than from
 *   the classifications means the case is built from the policy the engine
 *   grades, not from a second copy of it.
 * - the highest floor tier in `floors.json`, for the tool's server; then the
 *   effect class of the keyword that made the draft irreversible (ACP-454: 3
 *   runs or destroys, 2 changes shared state, 1 sends or pays; the classes are
 *   `irreversible_class` in `data/keywords.json`), because every generated
 *   floor is the same tier and the 0.2.3 run picked a pricing calculator's
 *   `add_service` over two production `execute_sql`; then a server whose name
 *   has the word `prod` or `production`; then the server's key, then the
 *   tool's key. A classified tool's server always
 *   has a floor, so a missing one is a bundle this package did not write, and
 *   is refused rather than ranked: ranking it would be a floor chosen here.
 *
 * THE PARAMETERS ARE EMPTY. The catalog carries each tool's parameter NAMES
 * only -- not their types and not which are required -- so there is no
 * required field this file could fill without inventing one. `{}` is the
 * minimal object; the engine's grade does not read `params`.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { words } from '../classify/words.js';
import type { Json } from '../wasm/json.js';
import { isRecord } from '../wasm/json.js';
import type { Policy } from '../wasm/ops.js';
import type { JsonObject, OwnSource, OwnTool } from './data.js';
import type { ReplayOutcome } from './replay.js';
import { GeneratedPolicyUnreadable } from './generated.js';

export const OWN_LABEL = 'a proposal this scan wrote, not one an AI agent made';
export const OWN_ABSENT_REASON = 'no tool on this machine is classified irreversible; no ninth case';
/** Beside the policy, never inside it: the twelve members and the sidecar are the signed set. */
export const OWN_FILE = 'ziffer-replay-own.json';

/** The ninth row: the verdict is the engine's, in the harness rows' own shape. */
export interface OwnCase {
  server: string;
  tool: string;
  original_name: string;
  without: 'executes';
  outcome: ReplayOutcome;
  label: typeof OWN_LABEL;
}

export interface OwnAbsent {
  absent: true;
  reason: string;
}

const TIERS: readonly string[] = ['T0', 'T1', 'T2', 'T3'];

function table(doc: Json, key: string, file: string): Record<string, unknown> {
  const t = isRecord(doc) ? doc[key] : undefined;
  if (!isRecord(t)) throw new GeneratedPolicyUnreadable(`${file} carries no ${key} table`);
  return t;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A server named for production: `prod` or `production` as a WORD, so `product-catalog` is not. */
function isProd(server: string): boolean {
  return words(server).some((w) => w === 'prod' || w === 'production');
}

/** True when `a` ranks above `b`: floor tier, effect class, production, then keys. */
function outranks(a: { tool: OwnTool; rank: number }, b: { tool: OwnTool; rank: number }): boolean {
  if (a.rank !== b.rank) return a.rank > b.rank;
  if (a.tool.effect_class !== b.tool.effect_class) return a.tool.effect_class > b.tool.effect_class;
  const ap = isProd(a.tool.server);
  const bp = isProd(b.tool.server);
  if (ap !== bp) return ap;
  const s = cmp(a.tool.server_key, b.tool.server_key);
  return s !== 0 ? s < 0 : cmp(a.tool.key, b.tool.key) < 0;
}

/** The irreversible tool on the highest floor, or `undefined` when no tool is irreversible. */
export function selectOwn(policy: Policy, tools: readonly OwnTool[]): { tool: OwnTool; floor: string } | undefined {
  const rev = table(policy.reversibility, 'reversibility', 'reversibility.json');
  const floors = table(policy.floors, 'floors', 'floors.json');
  let best: { tool: OwnTool; floor: string; rank: number } | undefined;
  for (const t of tools) {
    if (rev[t.key] !== 'IRREVERSIBLE') continue;
    const floor = floors[t.server_key];
    const rank = typeof floor === 'string' ? TIERS.indexOf(floor) : -1;
    if (typeof floor !== 'string' || rank < 0) {
      throw new GeneratedPolicyUnreadable(`floors.json has no tier for ${t.server_key}, the server of ${t.key}`);
    }
    const better = best === undefined || outranks({ tool: t, rank }, best);
    if (better) best = { tool: t, floor, rank };
  }
  return best === undefined ? undefined : { tool: best.tool, floor: best.floor };
}

/** The provenance every `ziffer-replay-own.json` carries, present case or absent. */
function provenance(src: OwnSource): JsonObject {
  return { scan_version: src.scan_version, engine_pin: src.engine_pin, date: src.date, policy: src.out };
}

/**
 * Write the case BESIDE the policy folder, never inside it: the engine's tree
 * hash is computed from every file on disk under the folder (`walk_bundle`),
 * so a file added there after signing makes the draft fail its own
 * verification. Found at the 0.2.2 merge, where `--report`'s test asserted
 * the folder holds exactly its signed members (ACP-443, ACP-451).
 */
export function writeOwnCase(
  src: OwnSource,
  own: { tool: OwnTool; floor: string; proposal: JsonObject; proposal_hash: string } | undefined,
): string {
  const path = join(dirname(src.out), OWN_FILE);
  const doc: JsonObject =
    own === undefined
      ? { absent: true, reason: OWN_ABSENT_REASON, provenance: provenance(src) }
      : {
          label: OWN_LABEL,
          provenance: {
            ...provenance(src),
            built_from: {
              server: own.tool.server,
              server_key: own.tool.server_key,
              tool: own.tool.key,
              original_name: own.tool.original_name,
              floor: own.floor,
              reversibility: 'IRREVERSIBLE',
            },
          },
          proposal: own.proposal,
          proposal_hash: own.proposal_hash,
        };
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return path;
}

const RISKS: readonly unknown[] = ['LOW', 'MEDIUM', 'HIGH'];
const REVS: readonly unknown[] = ['REVERSIBLE', 'IRREVERSIBLE'];
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === 'string');

function isOutcome(o: unknown): o is ReplayOutcome {
  if (!isRecord(o)) return false;
  switch (o['kind']) {
    case 'refused':
      return (
        (o['stage'] === 'grammar' || o['stage'] === 'engine') &&
        typeof o['clause'] === 'string' &&
        typeof o['message'] === 'string'
      );
    case 'held': {
      const a = o['awaits'];
      return (
        RISKS.includes(o['risk']) &&
        REVS.includes(o['reversibility']) &&
        typeof o['rule_id'] === 'string' &&
        strings(o['rule_ids']) &&
        isRecord(a) &&
        typeof a['k'] === 'number' &&
        strings(a['required_roles']) &&
        RISKS.includes(a['risk']) &&
        typeof a['proposal_hash'] === 'string' &&
        typeof a['policy_bundle_hash'] === 'string'
      );
    }
    case 'allowed': {
      const n = o['notice_recipients'];
      const v = o['verification'];
      return (
        RISKS.includes(o['risk']) &&
        REVS.includes(o['reversibility']) &&
        (n === null || strings(n)) &&
        typeof o['rule_id'] === 'string' &&
        isRecord(o['envelope']) &&
        typeof o['receipt_text'] === 'string' &&
        isRecord(v) &&
        v['verdict'] === 'PASSED'
      );
    }
    default:
      return false;
  }
}

/** The present shape of `ReplayResult.own`, checked field by field. */
export function hasOwnCase(x: unknown): x is OwnCase {
  return (
    isRecord(x) &&
    typeof x['server'] === 'string' &&
    typeof x['tool'] === 'string' &&
    typeof x['original_name'] === 'string' &&
    x['without'] === 'executes' &&
    x['label'] === OWN_LABEL &&
    isOutcome(x['outcome'])
  );
}
