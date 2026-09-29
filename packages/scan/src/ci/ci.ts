/**
 * `ziffer-scan --ci <policy-dir>` (ACP-442): the scan, run in the customer's
 * policy repository on every pull request, with no network and no account.
 *
 * 1. DISCOVER the MCP servers configured IN THE REPOSITORY -- the project-scoped
 *    entries of `data/clients.json` (`.mcp.json`, `.cursor/mcp.json`,
 *    `.vscode/mcp.json`, `.codex/config.toml`, ...) under `--cwd`, and nothing
 *    in any home directory: a CI runner's home is not the customer's. List their
 *    tools exactly as the scan does. CI is non-interactive, so `--ci` implies
 *    `--yes`; the list of what is started is still printed, redacted, first.
 * 2. GRADE each tool's would-be Proposal against the policy tree at
 *    `<policy-dir>` through the engine's own `decide`, the same wasm module the
 *    scan embeds. The tree is a pull request's draft and is read unsigned
 *    (`policy-tree.ts`, and the first line printed says so).
 * 3. REPORT the engine's verdict per tool, verbatim. NOTHING HERE GRADES: a
 *    tool with no risk function is refused at `8.4-3` because the ENGINE refuses
 *    it; an action absent from `reversibility.json` reads IRREVERSIBLE because
 *    the engine says so; a resource absent from `floors.json` is at T3 because
 *    the engine's `effective_tier` is. A second reading of those rules here
 *    would be the second definition `packages/mcp/src/decide.ts` refuses, and
 *    its first disagreement with the engine would be found by a customer.
 *
 * The Proposal is the replay's (`replay/proposal.ts`'s `toProposal`), with the
 * scan's key for the tool and its server (the ones the scan writes into a
 * policy it generates, or the tree's own `tool-names.json` when present), the
 * adapter stamps `replay/generated.ts` uses, and no parameters: a scan sees a
 * tool, not a call.
 *
 * THE FIX LINES come from the scan's bundle generator (`policyMembers`), never
 * from a format written here: for a tool refused at `8.4-3`, the risk-function
 * entry a scan would have drafted for it; at `DR-13` its notice entry; at
 * `TR-8` its server's adapter entry. They are drafts, like everything the
 * generator writes.
 *
 * EXIT CODES. 0: every tool listed was graded and none was refused. 1: the
 * engine refused at least one tool. 2: a named refusal of the run itself (an
 * absent or malformed policy member, an absent engine module), as the scan.
 */

import { resolve } from 'node:path';

import { policyMembers } from '../bundle/generate.js';
import { toolId } from '../bundle/names.js';
import { classify } from '../classify/index.js';
import { configuredPhrase, discover, loadClientsData, type ClientsData, type Platform } from '../discovery/index.js';
import { DEFAULT_TIMEOUT_MS, listServerTools } from '../mcp/client.js';
import { confirmSpawn } from '../mcp/confirm.js';
import { packageEnginePin, packageVersion } from '../package-info.js';
import { redactDeep, redactText } from '../redact/index.js';
import { loadReplayData } from '../replay/data.js';
import { FIDELITY, SCHEMA_VERSION, toolListHash } from '../replay/generated.js';
import { toProposal } from '../replay/proposal.js';
import { attachControls } from '../report/controls.js';
import { sortedJson } from '../report/json.js';
import type { CatalogTool, ControlRef, Finding, FindingKind } from '../types.js';
import { isRecord } from '../wasm/json.js';
import type { Engine } from '../wasm/loader.js';
import { decide, type Reversibility, type Risk } from '../wasm/ops.js';
import { loadPolicyTreeUnsigned, type UnsignedPolicyTree } from './policy-tree.js';

/** An engine call failed for a reason other than a refusal of the Proposal. */
export class CiEngineFailed extends Error {
  override readonly name = 'CiEngineFailed';
}

export const UNSIGNED_CI_LINE =
  'UNSIGNED: the policy was read without checking a signature, because a pull request carries a draft; ' +
  'this checks what the rules decide, not that the bundle verifies.';

/** One tool's verdict, exactly the engine's. */
export type CiVerdict =
  | {
      verdict: 'ALLOW' | 'ATTEST';
      risk: Risk;
      reversibility: Reversibility;
      effective_tier: string;
      rule_id: string;
    }
  | { verdict: 'REFUSED'; clause: string; message: string };

export interface CiFix {
  /** The member file the line belongs in. */
  file: string;
  /** The line, as the scan's generator writes it; absent when it has no draft for this tool. */
  line?: string;
  note?: string;
}

export interface CiTool {
  client: string;
  server: string;
  tool: string;
  /** The key the Proposal's `task_type` carries. */
  key: string;
  /** The server's key: the Proposal's `schema_id` and its one target. */
  resource: string;
  result: CiVerdict;
  controls: ControlRef[];
  fix?: CiFix;
}

export interface CiNotChecked {
  client?: string;
  server?: string;
  message: string;
}

export interface CiResult {
  mode: 'ci';
  unsigned: typeof UNSIGNED_CI_LINE;
  policy_dir: string;
  scan_version: string;
  engine_pin: string;
  configs_read: string[];
  tools: CiTool[];
  not_checked: CiNotChecked[];
  summary: { tools: number; allowed: number; held: number; refused: number; not_checked: number };
  exit_code: 0 | 1;
}

/** The discovery table with its project-scoped entries only: a repository's own configuration. */
export function projectScoped(data: ClientsData): ClientsData {
  return {
    ...data,
    clients: data.clients.map((c) => ({ ...c, mcp_config_paths: c.mcp_config_paths.filter((l) => l.scope === 'project') })),
  };
}

/**
 * THE EXIT CODE: 1 exactly when the engine refused a tool. Kept on its own so
 * the test that deletes it (the hand-break) has one place to break.
 */
export function ciExitCode(tools: readonly CiTool[]): 0 | 1 {
  return tools.some((t) => t.result.verdict === 'REFUSED') ? 1 : 0;
}

/**
 * The finding kinds whose Annex E rows a verdict cites, through the scan's
 * `finding-controls.json`. A refusal for want of a risk function is the scan's
 * `unclassified` finding as the engine meets it; an IRREVERSIBLE grade, or a
 * `DR-13` refusal of an IRREVERSIBLE action with no one to tell, is its
 * `irreversible` one. Any other verdict cites nothing rather than a row chosen here.
 */
function kindsOf(r: CiVerdict): FindingKind[] {
  if (r.verdict === 'REFUSED') {
    if (r.clause === '8.4-3') return ['unclassified'];
    if (r.clause === 'DR-13') return ['irreversible'];
    return [];
  }
  return r.reversibility === 'IRREVERSIBLE' ? ['irreversible'] : [];
}

function controlsOf(r: CiVerdict, tool: string): ControlRef[] {
  const findings: Finding[] = kindsOf(r).map((kind) => ({
    id: `ci:${kind}:${tool}`,
    kind,
    severity: 'info',
    tools: [tool],
    message: '',
    controls: [],
  }));
  const seen = new Set<string>();
  const out: ControlRef[] = [];
  for (const f of attachControls(findings)) {
    for (const c of f.controls) {
      const id = `${c.framework}\u0000${c.clause}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(c);
    }
  }
  return out;
}

interface Drafts {
  risk: Map<string, unknown>;
  notice: Map<string, unknown>;
  adapters: Map<string, unknown>;
}

function drafts(members: Map<string, unknown>): Drafts {
  const table = (file: string, key: string): unknown => {
    const doc = members.get(file);
    return isRecord(doc) ? doc[key] : undefined;
  };
  const risk = new Map<string, unknown>();
  const list = table('risk_functions.json', 'risk_functions');
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (isRecord(entry) && typeof entry['applies_to'] === 'string') risk.set(entry['applies_to'], entry);
    }
  }
  const notice = table('notice_targets.json', 'notice_targets');
  const adapters = table('adapters.json', 'adapters');
  return {
    risk,
    notice: new Map(isRecord(notice) ? Object.entries(notice) : []),
    adapters: new Map(isRecord(adapters) ? Object.entries(adapters) : []),
  };
}

/** The fix for one refusal, from the generator's drafts for this catalog. */
function fixFor(r: CiVerdict, key: string, genKey: string, resource: string, genResource: string, d: Drafts): CiFix | undefined {
  if (r.verdict !== 'REFUSED') return undefined;
  if (r.clause === '8.4-3') {
    const entry = d.risk.get(genKey);
    if (!isRecord(entry)) {
      return {
        file: 'risk_functions.json',
        note: `no draft for "${key}": the scan cannot tell whether it reads, writes or cannot be undone; write its risk function by hand`,
      };
    }
    return { file: 'risk_functions.json', line: JSON.stringify({ ...entry, applies_to: key }) };
  }
  if (r.clause === 'DR-13') {
    const to = d.notice.get(genKey);
    if (to === undefined) return undefined;
    return { file: 'notice_targets.json', line: `${JSON.stringify(key)}: ${JSON.stringify(to)}` };
  }
  if (r.clause === 'TR-8') {
    const fidelity = d.adapters.get(genResource);
    if (fidelity === undefined) return undefined;
    return { file: 'adapters.json', line: `${JSON.stringify(resource)}: ${JSON.stringify(fidelity)}` };
  }
  return undefined;
}

/**
 * Grade every distinct tool of `catalog` against `tree`. Pure over the engine:
 * it discovers nothing, starts nothing and writes nothing.
 */
export async function gradeCatalog(engine: Engine, tree: UnsignedPolicyTree, catalog: readonly CatalogTool[]): Promise<CiTool[]> {
  const drafted = classify(catalog);
  const gen = policyMembers(catalog, drafted.classifications);
  const d = drafts(gen.members);
  const operator = loadReplayData().operator;
  const tenant = tree.tenantId ?? 'ten_ci_draft';

  const distinct = new Map<string, CatalogTool>();
  for (const t of catalog) if (!distinct.has(toolId(t.server, t.tool))) distinct.set(toolId(t.server, t.tool), t);
  const byServer = new Map<string, CatalogTool[]>();
  for (const t of distinct.values()) byServer.set(t.server, [...(byServer.get(t.server) ?? []), t]);

  const out: CiTool[] = [];
  for (const [id, t] of distinct) {
    const genKey = gen.tools.map.get(id);
    const genResource = gen.servers.map.get(t.server);
    if (genKey === undefined || genResource === undefined) throw new CiEngineFailed(`the scan assigned no key to "${t.tool}" on "${t.server}"`);
    const key = tree.names?.tools.get(id) ?? genKey;
    const resource = tree.names?.servers.get(t.server) ?? genResource;
    const proposal = toProposal(
      { tool: key, resource, params: {} },
      {
        schema_version: SCHEMA_VERSION,
        fidelity: FIDELITY,
        tenant_id: tenant,
        tools: { [key]: { schema_id: resource, resource } },
        schema_hashes: { [resource]: toolListHash(byServer.get(t.server) ?? []) },
      },
      operator,
      tenant,
    );
    const answer = await decide(engine, { proposal, policy: tree.policy });
    let result: CiVerdict;
    if (answer.ok) {
      const g = answer.result;
      result = { verdict: g.decision, risk: g.risk_floor_only, reversibility: g.reversibility, effective_tier: g.effective_tier, rule_id: g.rule_id };
    } else if (answer.error.kind === 'refusal') {
      result = { verdict: 'REFUSED', clause: answer.error.clause, message: answer.error.message };
    } else {
      throw new CiEngineFailed(`decide for "${t.tool}" on "${t.server}": ${answer.error.message}`);
    }
    const tool: CiTool = { client: t.client, server: t.server, tool: t.tool, key, resource, result, controls: controlsOf(result, t.tool) };
    const fix = fixFor(result, key, genKey, resource, genResource, d);
    if (fix !== undefined) tool.fix = fix;
    out.push(tool);
  }
  return out;
}

export function ciResult(policyDir: string, tools: CiTool[], notChecked: CiNotChecked[], configsRead: string[]): CiResult {
  return {
    mode: 'ci',
    unsigned: UNSIGNED_CI_LINE,
    policy_dir: policyDir,
    scan_version: packageVersion(),
    engine_pin: packageEnginePin(),
    configs_read: configsRead,
    tools,
    not_checked: notChecked,
    summary: {
      tools: tools.length,
      allowed: tools.filter((t) => t.result.verdict === 'ALLOW').length,
      held: tools.filter((t) => t.result.verdict === 'ATTEST').length,
      refused: tools.filter((t) => t.result.verdict === 'REFUSED').length,
      not_checked: notChecked.length,
    },
    exit_code: ciExitCode(tools),
  };
}

const rows = (controls: readonly ControlRef[]): string =>
  controls.length === 0 ? '' : ` (${controls.map((c) => `${c.framework} ${c.clause}`).join('; ')})`;

/** Plain lines for a CI log: no colour, one line per tool, the summary, then the fix lines. */
export function renderCi(r: CiResult): string[] {
  const lines = [r.unsigned, `Policy: ${r.policy_dir}`];
  for (const t of r.tools) {
    const v = t.result;
    const verdict =
      v.verdict === 'REFUSED'
        ? `REFUSED [${v.clause}] ${v.message}`
        : `${v.verdict} ${v.risk} ${v.reversibility} ${v.effective_tier} [${v.rule_id}]`;
    lines.push(`${t.server} ${t.tool} → ${verdict}${rows(t.controls)}`);
  }
  for (const n of r.not_checked) lines.push(`${n.server ?? '-'} → NOT CHECKED: ${n.message}`);
  if (r.tools.length === 0 && r.not_checked.length === 0) {
    lines.push('NOT CHECKED: no MCP server is configured in this repository, so no tool was graded.');
  }
  const s = r.summary;
  lines.push(
    `${s.tools} tool${s.tools === 1 ? '' : 's'} graded: ${s.allowed} allowed, ${s.held} held for approval, ${s.refused} refused; ` +
      `${s.not_checked} not checked. Exit ${r.exit_code}.`,
  );
  const fixes = r.tools.filter((t) => t.fix !== undefined);
  if (fixes.length > 0) {
    lines.push(`To grade the refused tools, add to ${r.policy_dir}:`);
    for (const t of fixes) {
      const f = t.fix;
      if (f === undefined) continue;
      lines.push(`  ${f.file}: ${f.line ?? f.note ?? ''}`);
    }
    lines.push('  These are drafts from the scan: review each level before you merge.');
  }
  return lines.map((l) => redactText(l));
}

export interface CiRunOptions {
  /** As the person spelt it: printed so, and resolved against `base`. */
  policyDir: string;
  /** The directory a relative `policyDir` and `cwd` are resolved against. */
  base: string;
  cwd: string;
  platform: Platform;
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  /** Where the list of servers to start goes (stderr). */
  write: (text: string) => void;
  stdin: NodeJS.ReadableStream;
  isTTY: boolean;
}

/** Discover, list, grade. Returns the result; printing is the caller's. */
export async function runCiScan(engine: Engine, opts: CiRunOptions): Promise<CiResult> {
  // The policy first: a run with no policy to grade against starts no server.
  const tree = loadPolicyTreeUnsigned(resolve(opts.base, opts.policyDir));
  const cwd = resolve(opts.base, opts.cwd);
  const found = discover(opts.platform, cwd, cwd, opts.env, projectScoped(loadClientsData()));
  // --ci implies --yes: a CI runner has no one to ask. The list is still printed.
  await confirmSpawn(found.servers, { yes: true, isTTY: opts.isTTY, input: opts.stdin, write: opts.write });

  const listed = [];
  for (const s of found.servers) listed.push(await listServerTools(s, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const catalog: CatalogTool[] = [];
  const notChecked: CiNotChecked[] = [
    ...found.skipped.map((s) => {
      const where = configuredPhrase(s.configured_in);
      return { client: s.client, server: s.name, message: `${s.reason}${where === undefined ? '' : ` (${where})`}` };
    }),
    ...found.unreadable.map((u) => ({ message: `${u.path} could not be read (${u.reason})` })),
  ];
  for (const r of listed) {
    if (r.ok) catalog.push(...r.tools);
    else {
      const n: CiNotChecked = { message: r.finding.message };
      if (r.finding.client !== undefined) n.client = r.finding.client;
      if (r.finding.server !== undefined) n.server = r.finding.server;
      notChecked.push(n);
    }
  }
  const tools = await gradeCatalog(engine, tree, catalog);
  return ciResult(opts.policyDir, tools, notChecked, found.configs_read);
}

/** `--ci --json`: the result, redacted, keys sorted. */
export function renderCiJson(r: CiResult): string {
  return sortedJson(redactDeep(r)).trimEnd();
}
