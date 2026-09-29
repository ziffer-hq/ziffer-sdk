/**
 * The draft policy the scan wrote, read back as one rule per tool (ACP-455):
 * what "The policy we propose" renders.
 *
 * NOTHING HERE DECIDES. Each field is a value read from a member file the run
 * wrote and signed (`floors.json`, `risk_functions.json`, `reversibility.json`,
 * `notice_targets.json`), found through the sidecar `tool-names.json` that
 * says which key the draft gave each tool and each server. What ZIFFER does
 * with the tool is the engine's verdict, carried in `CodeToolVerdict`; this
 * module never re-derives it from the values. An absent entry stays absent,
 * and the page says what the engine does with an absence (the policy page's
 * "three kinds of missing"), never a value it guessed.
 */

import type { CatalogTool } from '../types.js';
import type { CodeSection, CodeToolVerdict } from '../code/types.js';
import { groupOf, type VerdictGroup } from './code.js';
import { isRecord } from './names.js';

export interface PolicyFile {
  path: string;
  text: string;
}

export interface RiskFunction {
  base: string;
  raise: { if: string; then: string }[];
}

/** One tool's rule, as the draft states it. Every field absent means the member has no entry. */
export interface DraftRule {
  /** The draft's key for the tool (`task_type`). */
  key: string;
  /** The draft's key for the tool's resource (`schema_id`), from `tool-names.json`. */
  resource?: string;
  floor?: string;
  risk?: RiskFunction;
  reversibility?: string;
  notice?: string[];
}

export interface CodeRule extends DraftRule {
  verdict: CodeToolVerdict;
  group: VerdictGroup;
}

export interface McpRule extends DraftRule {
  server: string;
  tool: string;
}

function member(files: readonly PolicyFile[], path: string): Record<string, unknown> | undefined {
  const f = files.find((x) => x.path === path);
  if (f === undefined) return undefined;
  const v: unknown = JSON.parse(f.text);
  return isRecord(v) ? v : undefined;
}

function table(doc: Record<string, unknown> | undefined, key: string): Record<string, unknown> {
  const t = doc?.[key];
  return isRecord(t) ? t : {};
}

function strings(v: unknown): string[] | undefined {
  if (typeof v === 'string') return [v];
  return Array.isArray(v) && v.every((x): x is string => typeof x === 'string') ? v : undefined;
}

/** The draft's members, read once. */
export class DraftPolicyView {
  private readonly floors: Record<string, unknown>;
  private readonly reversibility: Record<string, unknown>;
  private readonly notice: Record<string, unknown>;
  private readonly risk = new Map<string, RiskFunction>();
  /** `server\u0000tool` to the tool's key, and server to the server's key, from the sidecar. */
  private readonly toolKeys = new Map<string, string>();
  private readonly serverKeys = new Map<string, string>();

  constructor(files: readonly PolicyFile[]) {
    this.floors = table(member(files, 'floors.json'), 'floors');
    this.reversibility = table(member(files, 'reversibility.json'), 'reversibility');
    this.notice = table(member(files, 'notice_targets.json'), 'notice_targets');
    const list = member(files, 'risk_functions.json')?.['risk_functions'];
    for (const r of Array.isArray(list) ? list : []) {
      if (!isRecord(r) || typeof r['applies_to'] !== 'string' || typeof r['base'] !== 'string') continue;
      const raise = (Array.isArray(r['raise_to']) ? r['raise_to'] : []).flatMap((x: unknown) =>
        isRecord(x) && typeof x['if'] === 'string' && typeof x['then'] === 'string' ? [{ if: x['if'], then: x['then'] }] : [],
      );
      this.risk.set(r['applies_to'], { base: r['base'], raise });
    }
    const sidecar = member(files, 'tool-names.json');
    const tools = sidecar?.['tools'];
    for (const t of Array.isArray(tools) ? tools : []) {
      if (isRecord(t) && typeof t['server'] === 'string' && typeof t['tool'] === 'string' && typeof t['key'] === 'string') {
        this.toolKeys.set(`${t['server']}\u0000${t['tool']}`, t['key']);
      }
    }
    for (const [server, key] of Object.entries(table(sidecar, 'servers'))) if (typeof key === 'string') this.serverKeys.set(server, key);
  }

  /** The key the sidecar gave `tool` on `server`, if it lists it. */
  keyOf(server: string, tool: string): string | undefined {
    return this.toolKeys.get(`${server}\u0000${tool}`);
  }

  /** A code tool's key: the grader's `key` when it differs from the name, else the name (`CodeToolVerdict.key`). */
  codeKey(v: CodeToolVerdict): string {
    return v.key ?? v.tool.name;
  }

  /** The draft's rule for the tool with this key, on this server (sidecar name) when known. */
  rule(key: string, server?: string): DraftRule {
    const resource = server === undefined ? undefined : this.serverKeys.get(server);
    const floor = resource === undefined ? undefined : this.floors[resource];
    const reversibility = this.reversibility[key];
    const notice = strings(this.notice[key]);
    const risk = this.risk.get(key);
    return {
      key,
      ...(resource === undefined ? {} : { resource }),
      ...(typeof floor === 'string' ? { floor } : {}),
      ...(risk === undefined ? {} : { risk }),
      ...(typeof reversibility === 'string' ? { reversibility } : {}),
      ...(notice === undefined ? {} : { notice }),
    };
  }

  /** The sidecar server name a code tool's key sits under (`application/<name>`), if listed. */
  codeServer(key: string): string | undefined {
    for (const [id, k] of this.toolKeys) if (k === key) return id.slice(0, id.indexOf('\u0000'));
    return undefined;
  }
}

/** One rule per tool the application defines, in the verdicts' order. */
export function codeRules(code: CodeSection, files: readonly PolicyFile[], ordered: readonly CodeToolVerdict[]): CodeRule[] {
  const view = new DraftPolicyView(files);
  return ordered.map((v) => {
    const key = view.codeKey(v);
    return { ...view.rule(key, view.codeServer(key)), verdict: v, group: groupOf(v) };
  });
}

/** One rule per distinct installed tool (server and tool), sorted by server then tool. */
export function mcpRules(catalog: readonly CatalogTool[], files: readonly PolicyFile[]): McpRule[] {
  const view = new DraftPolicyView(files);
  const seen = new Set<string>();
  const out: McpRule[] = [];
  for (const c of catalog) {
    const id = `${c.server}\u0000${c.tool}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = view.keyOf(c.server, c.tool) ?? c.tool;
    out.push({ ...view.rule(key, c.server), server: c.server, tool: c.tool });
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => cmp(a.server, b.server) || cmp(a.tool, b.tool));
}

/** "risk MEDIUM, HIGH at tier T2 or above": a risk function in reader words; an unknown clause is shown as written. */
export function riskWords(r: RiskFunction): string {
  const raises = r.raise
    .filter((x) => x.then !== r.base)
    .map((x) => {
      const tier = /^resource\.effective_tier >= (T\d)$/.exec(x.if);
      return tier === null ? `${x.then} when ${x.if}` : `${x.then} at tier ${tier[1] ?? ''} or above`;
    });
  return [r.base, ...raises].join(', ');
}
