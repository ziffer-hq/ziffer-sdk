/**
 * The activatable bundle a scan hands the developer: twelve members generated
 * from the classified catalog, validated against the engine's schemas, signed
 * by the run key, and activated by the engine before a byte is written.
 *
 * EVERYTHING HERE IS A DRAFT, AND SAYS SO. The classifications it reads are the
 * classifier's drafts (`draft: true`), and the policy it writes is the policy
 * those drafts imply under the rules below -- a starting point for a person to
 * review, never the engine's opinion of the tools. The engine's opinion comes
 * when the bundle is used: it grades, refuses and holds; this module decides
 * nothing about any action.
 *
 * THE RULES, and what each one leaves to the engine:
 *
 * - floors: one per RESOURCE, the MCP server's normalised name. Any tool on the
 *   server irreversible => T3; else any egress => T2; else any write => T1; else
 *   T0. A server with no classified tool gets NO floor: RK-1 answers T3 for an
 *   absent resource, and padding the table would write a value nobody chose.
 * - risk_functions: one per CLASSIFIED tool, base LOW / MEDIUM / HIGH for read /
 *   write / irreversible, raised to HIGH at effective tier >= T2 for egress and
 *   write tools. An UNCLASSIFIED tool gets no risk function, so the engine
 *   refuses it (8.4-3). It is not graded HIGH here: that would route an action
 *   nobody considered into a human quorum, which the schema's own absent rule
 *   names as worse than refusing it. `unclassified` lists them for the report.
 * - reversibility: IRREVERSIBLE for irreversible tools, REVERSIBLE for reads.
 *   WRITE TOOLS ARE NOT LISTED. The classifier cannot know whether a write can
 *   be undone, and RV-1 reads an absent entry as IRREVERSIBLE; leaving them out
 *   is the honest draft, and writing REVERSIBLE would be the permissive guess
 *   RV-1 exists to refuse.
 * - notice_targets: every tool the engine will treat as IRREVERSIBLE -- the
 *   irreversible ones AND the write tools left absent above -- addressed to the
 *   placeholder "developer". DR-13 refuses an IRREVERSIBLE action below
 *   floor-HIGH with no addressee, so omitting the write tools here would make
 *   every one of them refused for a reason the draft created. "developer" is
 *   the only person present at a scan; the report tells the customer to
 *   replace it.
 * - adapters: one per server, keyed by its normalised name, F-HIGH (an MCP
 *   tool call is typed by the server's input schema; F-LOW is for free text).
 *   The key is the Proposal's `schema_id`, whose grammar `^[a-z0-9_-]{1,32}$`
 *   has no `.`; the version travels in the Proposal's own `schema_version`.
 * - attesters: k = 2, two hybrid approvers whose private halves are dropped as
 *   soon as their public halves are read. The demo has no approvers, which is
 *   exactly why a held action stays held.
 * - door_identities, receipt_identity, alert_targets, limits, manifest: see
 *   each builder below.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { packageVersion } from '../package-info.js';
import { ALERT_CLASSES } from '../generated/schema-source.js';
import type { CatalogTool, Classification } from '../types.js';
import type { Engine } from '../wasm/loader.js';
import { bundleSign, bundleVerify, dropKey, keygen, treeHash } from '../wasm/ops.js';
import type { BundleVerifyResult, KeygenResult, Outcome } from '../wasm/ops.js';
import { assignNames, plain, toolId } from './names.js';
import type { NameMap } from './names.js';
import { limitsDefaults, MEMBER_SCHEMAS, validateMember } from './schemas.js';

export const SUITE = 'hybrid-ed25519-mldsa65';
/** The one human present at a scan. Every addressee in the draft is this placeholder. */
export const DEVELOPER = 'developer';
export const SIDECAR = 'tool-names.json';
const RAISE_AT_T2 = 'resource.effective_tier >= T2';
const LIFETIME_DAYS = 30;

/** The engine refused the generated bundle. `message` is its refusal name, verbatim. */
export class BundleVerifyRefused extends Error {
  override readonly name = 'BundleVerifyRefused';
}

/** An engine call failed for a reason other than a refusal of the bundle. */
export class BundleEngineFailed extends Error {
  override readonly name = 'BundleEngineFailed';
}

export class BundleDirectoryOccupied extends Error {
  override readonly name = 'BundleDirectoryOccupied';
}

/** A file handed to `writeBundle` is not the one that was signed. */
export class BundleMemberAltered extends Error {
  override readonly name = 'BundleMemberAltered';
}

export interface BundleFile {
  /** Path inside the bundle directory. */
  readonly path: string;
  /** The exact text written, and (for every file but SIGNATURE) the text signed. */
  readonly text: string;
}

export interface GeneratedBundle {
  /** The twelve members, then the sidecar. */
  readonly files: readonly BundleFile[];
  /** sha256 hex of each signed file's text, by path (every file but SIGNATURE). */
  readonly digests: ReadonlyMap<string, string>;
  /** The tree hash in the spelling a receipt's `policy_bundle_hash` carries. */
  readonly treeHash: string;
  readonly tenantId: string;
  /** What `bundle_verify` answered, verbatim. */
  readonly verified: BundleVerifyResult;
  readonly tools: NameMap;
  readonly servers: NameMap;
  /** Catalog tools with no classification, hence no risk function: the engine refuses them. */
  readonly unclassified: readonly ToolRef[];
}

export interface GenerateOptions {
  /** The run key: signs the bundle, is named as the receipt identity. The caller owns and drops it. */
  runKey: KeygenResult;
  now?: Date;
  scanVersion?: string;
}

function unwrap<T>(what: string, o: Outcome<T>): T {
  if (o.ok) return o.result;
  const e = o.error;
  throw new BundleEngineFailed(`${what}: ${e.kind === 'refusal' ? `${e.clause} ${e.message}` : e.message}`);
}

const b64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** RFC 3339 UTC to the second, the spelling WE-5 reads. */
const instant = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const text = (doc: unknown): string => `${JSON.stringify(doc, null, 2)}\n`;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortedRecord<V>(entries: Iterable<[string, V]>): Record<string, V> {
  return Object.fromEntries([...entries].sort(([a], [b]) => cmp(a, b)));
}

type Tier = 'T0' | 'T1' | 'T2' | 'T3';
/** Ascending, for "the highest floor any tool on the server implies". */
const TIERS: readonly Tier[] = ['T0', 'T1', 'T2', 'T3'];

function floorOf(c: Classification): Tier {
  if (c.effect === 'irreversible') return 'T3';
  if (c.egress) return 'T2';
  if (c.effect === 'write') return 'T1';
  return 'T0';
}

function hybrid(k: KeygenResult): { classical: string; pq: string } {
  return { classical: b64(k.classical_pub_hex), pq: b64(k.pq_pub_hex) };
}

const EFFECT_ORDER: readonly Classification['effect'][] = ['read', 'write', 'irreversible'];

/**
 * One draft per tool. The same server configured in two clients is one
 * resource with one set of tools, and the classifier may have drafted each
 * copy. If the drafts disagree the more severe reading is kept (the higher
 * effect; egress if either says so), because the bundle can hold one policy
 * per tool and the permissive reading is the one a draft must not pick.
 */
function draftsByTool(classifications: readonly Classification[]): Map<string, Classification> {
  const out = new Map<string, Classification>();
  for (const c of classifications) {
    const id = toolId(c.server, c.tool);
    const prior = out.get(id);
    if (prior === undefined) {
      out.set(id, c);
      continue;
    }
    const effect = EFFECT_ORDER.indexOf(c.effect) > EFFECT_ORDER.indexOf(prior.effect) ? c.effect : prior.effect;
    out.set(id, { ...prior, effect, egress: prior.egress || c.egress });
  }
  return out;
}

export interface ToolRef {
  server: string;
  tool: string;
}

/** The policy members, from the catalog and the drafts. Pure. */
export function policyMembers(
  catalog: readonly CatalogTool[],
  classifications: readonly Classification[],
): {
  members: Map<string, unknown>;
  tools: NameMap;
  servers: NameMap;
  unclassified: ToolRef[];
} {
  const tools = assignNames(catalog.map((t) => ({ id: toolId(t.server, t.tool), name: t.tool })));
  const servers = assignNames(catalog.map((t) => plain(t.server)));
  const drafts = draftsByTool(classifications);
  const key = (m: NameMap, id: string): string => {
    const k = m.map.get(id);
    if (k === undefined) throw new Error(`BundleNameUnassigned: ${id}`);
    return k;
  };

  const floors = new Map<string, Tier>();
  const risk = new Map<string, unknown>();
  const reversibility = new Map<string, string>();
  const notice = new Map<string, string[]>();
  const adapters = new Map<string, string>();
  const unclassified = new Map<string, ToolRef>();

  for (const t of catalog) {
    const id = toolId(t.server, t.tool);
    const server = key(servers, t.server);
    adapters.set(server, 'F-HIGH');
    const c = drafts.get(id);
    if (c === undefined) {
      unclassified.set(id, { server: t.server, tool: t.tool });
      continue;
    }
    const floor = floorOf(c);
    const prior = floors.get(server);
    if (prior === undefined || TIERS.indexOf(floor) > TIERS.indexOf(prior)) floors.set(server, floor);

    const name = key(tools, id);
    const base = c.effect === 'irreversible' ? 'HIGH' : c.effect === 'write' ? 'MEDIUM' : 'LOW';
    const raise = c.egress || c.effect === 'write' ? [{ if: RAISE_AT_T2, then: 'HIGH' }] : [];
    risk.set(name, { applies_to: name, base, raise_to: raise });
    if (c.effect === 'irreversible') reversibility.set(name, 'IRREVERSIBLE');
    if (c.effect === 'read') reversibility.set(name, 'REVERSIBLE');
    if (c.effect !== 'read') notice.set(name, [DEVELOPER]);
  }

  const members = new Map<string, unknown>([
    ['floors.json', { schema_version: '1', floors: sortedRecord(floors) }],
    ['risk_functions.json', { schema_version: '1', risk_functions: Object.values(sortedRecord(risk)) }],
    ['reversibility.json', { schema_version: '1', reversibility: sortedRecord(reversibility) }],
    ['notice_targets.json', { schema_version: '1', notice_targets: sortedRecord(notice) }],
    ['adapters.json', { schema_version: '1', adapters: sortedRecord(adapters) }],
  ]);
  return { members, tools, servers, unclassified: Object.values(sortedRecord(unclassified)) };
}

/** `JSON.stringify([server, tool])` back into its parts, for the sidecar. */
function toolRef(id: string): ToolRef {
  const v: unknown = JSON.parse(id);
  if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return { server: v[0], tool: v[1] };
  throw new Error(`BundleNameUnassigned: ${id} is not a tool identity`);
}

function sidecar(tools: NameMap, servers: NameMap): unknown {
  return {
    note:
      'Original names as the MCP servers spell them, and the key this bundle uses for each. ' +
      'A collision is two different tools (or servers) that normalised to one key; each was given its own key.',
    tools: [...tools.map].map(([id, key]) => ({ ...toolRef(id), key })).sort((a, b) => cmp(a.key, b.key)),
    servers: sortedRecord(servers.map),
    collisions: [
      ...tools.collisions.map((c) => ({
        kind: 'tool',
        normalised: c.normalised,
        originals: c.originals.map((o) => ({ ...toolRef(o.id), assigned: o.assigned })),
      })),
      ...servers.collisions.map((c) => ({
        kind: 'server',
        normalised: c.normalised,
        originals: c.originals.map((o) => ({ server: o.original, assigned: o.assigned })),
      })),
    ],
  };
}

/** Validate every member that has a schema. Throws `BundleMemberInvalid` on the first failure. */
export function validateMembers(members: ReadonlyMap<string, unknown>): void {
  for (const [path, doc] of members) {
    if (MEMBER_SCHEMAS.has(path)) validateMember(path, doc);
  }
}

export async function generateBundle(
  catalog: readonly CatalogTool[],
  classifications: readonly Classification[],
  engine: Engine,
  opts: GenerateOptions,
): Promise<GeneratedBundle> {
  const now = opts.now ?? new Date();
  const version = opts.scanVersion ?? packageVersion();
  const run = opts.runKey;
  const fp = /^sha256:([0-9a-f]{8})/.exec(run.fingerprint);
  if (fp === null) throw new BundleEngineFailed(`the run key's fingerprint ${run.fingerprint} is not sha256:<hex>`);
  const tenantId = `ten_demo_${fp[1]}`;

  const { members, tools, servers, unclassified } = policyMembers(catalog, classifications);

  // Four identities whose private halves this scan never uses: two approvers
  // and the two doors. Each is dropped in `finally`, whatever happens after.
  const handles: number[] = [];
  const fresh = async (): Promise<KeygenResult> => {
    const k = unwrap('keygen', await keygen(engine));
    handles.push(k.handle);
    return k;
  };
  try {
    const approver1 = await fresh();
    const approver2 = await fresh();
    const presentation = await fresh();
    const notification = await fresh();
    for (let h = handles[0]; h !== undefined; h = handles[0]) {
      unwrap('drop_key', await dropKey(engine, h));
      handles.shift();
    }

    members.set('attesters/registry.json', {
      schema_version: '1',
      quorum_k: 2,
      attesters: {
        'approver-1': { kind: 'hybrid', role: 'approver', ...hybrid(approver1) },
        'approver-2': { kind: 'hybrid', role: 'approver', ...hybrid(approver2) },
      },
      min_attester_assurance: 'AS0',
    });
    members.set('door_identities.json', {
      schema_version: '1',
      presentation: { name: 'scan-demo-presentation', ...hybrid(presentation) },
      notification: { name: 'scan-demo-notification', ...hybrid(notification) },
    });
  } finally {
    // Only reached with handles left when something above threw; the throw is
    // the error worth reporting, so a failed drop here does not replace it.
    for (const h of handles) await dropKey(engine, h).catch(() => undefined);
  }

  members.set('receipt_identity.json', { schema_version: '1', name: 'scan-demo-receipt-key', ...hybrid(run) });
  members.set('alert_targets.json', {
    schema_version: '1',
    alert_targets: Object.fromEntries(ALERT_CLASSES.map((c) => [c, [DEVELOPER]])),
  });
  members.set('limits.json', limitsDefaults());
  const expires = new Date(now.getTime() + LIFETIME_DAYS * 86_400_000);
  const leg = { tier: 'T0', mechanism: 'generated for this scan inside the engine module; never written to disk' };
  members.set('manifest.json', {
    schema_version: '1',
    tenant_id: tenantId,
    bundle_epoch: 1,
    created_at: instant(now),
    expires_at: instant(expires),
    author: { id: `@ziffer-io/scan ${version}`, display_name: `ZIFFER scan ${version}` },
    reviewer: { id: DEVELOPER, display_name: 'the developer who ran the scan' },
    min_suite: SUITE,
    custody: { tier: 'T0', classical: leg, pq: leg },
  });

  validateMembers(members);

  const signed: BundleFile[] = [...members].map(([path, doc]) => ({ path, text: text(doc) }));
  signed.push({ path: SIDECAR, text: text(sidecar(tools, servers)) });
  const digests = new Map(signed.map((f) => [f.path, sha256(f.text)]));
  const digestMembers = signed.map((f) => ({ path: f.path, sha256_hex: sha256(f.text) }));

  const hash = unwrap('tree_hash', await treeHash(engine, SUITE, digestMembers)).hash;
  const signature = unwrap('bundle_sign', await bundleSign(engine, run.handle, SUITE, digestMembers));
  validateMember('SIGNATURE', signature);

  const verdict = await bundleVerify(engine, {
    suite: SUITE,
    members: signed.map((f) => ({ path: f.path, bytes_hex: Buffer.from(f.text, 'utf8').toString('hex') })),
    signature,
    pubkeys: { classical_pub_hex: run.classical_pub_hex, pq_pub_hex: run.pq_pub_hex },
    now: Math.floor(now.getTime() / 1000),
  });
  if (!verdict.ok) {
    const e = verdict.error;
    if (e.kind === 'refusal') throw new BundleVerifyRefused(e.clause);
    throw new BundleEngineFailed(`bundle_verify: ${e.message}`);
  }

  const files = [...signed.slice(0, -1), { path: 'SIGNATURE', text: text(signature) }, ...signed.slice(-1)];
  return { files, digests, treeHash: hash, tenantId, verified: verdict.result, tools, servers, unclassified };
}

/**
 * Write the bundle into `dir`. Every member is validated again and every signed
 * file is checked against the digest it was signed under BEFORE the first write,
 * so a refusal leaves the directory as it was. A directory already holding a
 * `manifest.json` is someone's bundle and is never written into.
 */
export function writeBundle(bundle: GeneratedBundle, dir: string): void {
  if (existsSync(join(dir, 'manifest.json'))) {
    throw new BundleDirectoryOccupied(`${dir} already holds a manifest.json`);
  }
  for (const f of bundle.files) {
    if (MEMBER_SCHEMAS.has(f.path)) validateMember(f.path, JSON.parse(f.text));
    if (f.path === 'SIGNATURE') continue;
    const want = bundle.digests.get(f.path);
    if (want === undefined || want !== sha256(f.text)) {
      throw new BundleMemberAltered(`${f.path} is not the file that was signed`);
    }
  }
  const paths = new Set(bundle.files.map((f) => f.path));
  for (const p of bundle.digests.keys()) {
    if (!paths.has(p)) throw new BundleMemberAltered(`${p} was signed and is missing`);
  }
  mkdirSync(dir, { recursive: true });
  for (const f of bundle.files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.text, { flag: 'wx' });
  }
}

/** Files under `dir`, relative, for tests and the report. */
export function listBundle(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...listBundle(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}
