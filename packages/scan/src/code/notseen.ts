/**
 * The honesty lines (acp docs/design/acp-455-tool-calling-surfaces.md §6) that
 * apply to THIS tree. Each is printed because something in the tree triggered
 * it, and each says, in numbers where there are numbers, what the scan did not
 * see. A report that omitted them would read as complete when it is not.
 */

import type { CodeTool, Exposure, RuntimeGate, SourceRef } from './types.js';
import { entryForPackage } from './sdks.js';

export interface NotSeenInput {
  exposures: Exposure[];
  gates: RuntimeGate[];
  mcpClients: SourceRef[];
  mcpLowLevel: SourceRef[];
  providerTools: { at: SourceRef; text: string }[];
  dynamicFiles: string[];
  /** The definitions carrying an authority hint, and per hint name how many carry each value as written (`true`, `false`). */
  hints: { tools: number; names: string[]; values?: { name: string; value: string; tools: number }[] };
  sdks: { name: string; version: string }[];
  /** Framework ids a front end in this package reads (the TS signatures). */
  readIds: ReadonlySet<string>;
  pyFiles: number;
  otherLang: Map<string, number>;
  configErrors: string[];
  /** When the tool-calls check ran: how many application functions deep a run function was followed. */
  reachDepth?: number;
}

function at(r: SourceRef): string {
  return `${r.file}:${r.line}`;
}

function list(xs: string[], max = 5): string {
  return xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
}

/**
 * Per authority hint name and value as written, how many tool definitions carry it: one count per
 * definition (a definition that writes one name twice counts once, with its first value). The one
 * count behind the honesty line and the report's claim sentence, so the two always add up alike.
 */
export function claimValues(tools: readonly Pick<CodeTool, 'authority_claims'>[]): { name: string; value: string; tools: number }[] {
  const n = new Map<string, { name: string; value: string; tools: number }>();
  for (const t of tools) {
    const seen = new Set<string>();
    for (const c of t.authority_claims ?? []) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const k = `${c.name}\u0000${c.value}`;
      const e = n.get(k) ?? { name: c.name, value: c.value, tools: 0 };
      e.tools += 1;
      n.set(k, e);
    }
  }
  return [...n.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : valueRank(a.value) - valueRank(b.value)));
}

/** `true` first, then `false`, then any other value as written: the order every claim count is said in. */
export function valueRank(value: string): number {
  return value === 'true' ? 0 : value === 'false' ? 1 : 2;
}

export function notSeen(i: NotSeenInput): string[] {
  const out: string[] = [];
  if (i.mcpClients.length > 0) {
    out.push(`Tools fetched at runtime from an MCP server are not listed (${i.mcpClients.length} client attach point(s): ${list(i.mcpClients.map(at))}); the scan names where they attach, and the server's own repository must be scanned for its tools.`);
  }
  if (i.mcpLowLevel.length > 0) {
    out.push(`${i.mcpLowLevel.length} MCP server(s) answer tools/call with a low-level request handler (${list(i.mcpLowLevel.map(at))}); the tools such a handler serves are listed at runtime and are not read.`);
  }
  if (i.gates.length > 0) {
    out.push(`Exposure is decided by data at runtime (${list(i.gates.map((g) => g.name))}): the scan lists every tool that CAN be exposed, not the set a given tenant, location or user sees.`);
  }
  const computed = i.exposures.filter((e) => e.kind === 'computed');
  if (computed.length > 0) {
    const unresolved = computed.filter((e) => e.tools.length === 0);
    out.push(`${computed.length} tool set(s) are built at runtime or passed as a value (${list(computed.map((e) => at(e.at)))}); names were joined back through the code for ${computed.length - unresolved.length} of them${unresolved.length > 0 ? `, and ${unresolved.length} could not be named from the code` : ''}.`);
  }
  if (i.providerTools.length > 0) {
    out.push(`${i.providerTools.length} provider-executed or provider-defined tool(s) are attached (${list(i.providerTools.map((p) => `${p.text} at ${at(p.at)}`), 3)}); where the provider runs the tool, no call reaches the application, and ZIFFER can only decide whether it is exposed.`);
  }
  if (i.hints.tools > 0) {
    // Split by value, as written: a definition that says `false` declares that NO confirmation is needed.
    const byName = i.hints.names.map((n) => {
      const vs = (i.hints.values ?? []).filter((v) => v.name === n).sort((a, b) => valueRank(a.value) - valueRank(b.value) || (a.value < b.value ? -1 : 1));
      return vs.length === 0 ? n : `${n}: ${vs.map((v) => `${v.value} in ${v.tools}`).join(', ')}`;
    });
    out.push(`${i.hints.tools} tool definition(s) carry authority hints (${list(byName)}); they are recorded as claims, and the draft policy does not rely on them.`);
  }
  if (i.reachDepth !== undefined) {
    out.push(`Each tool's run function was followed into the application's own functions, ${i.reachDepth} calls deep, for another tool it runs without passing the dispatcher; a call deeper than that, or made through an interface method or a function passed as a value (a callback, a workflow's execute taken from a map of workflows), is not followed, and a function a reached function only creates (a context's method) is counted as if it ran.`);
  }
  if (i.dynamicFiles.length > 0) {
    out.push(`${i.dynamicFiles.length} file(s) load code by a computed name (dynamic import, require of a variable, or eval), which import resolution cannot follow: ${list(i.dynamicFiles)}.`);
  }
  const notRead = i.sdks.filter((s) => {
    const e = entryForPackage(s.name);
    return e !== undefined && e.kind === 'framework' && !i.readIds.has(e.id);
  });
  if (notRead.length > 0) {
    out.push(`Declared in package.json but not yet read by this scanner: ${list(notRead.map((s) => `${s.name} ${s.version}`), 10)}.`);
  }
  if (i.pyFiles > 0) out.push(`${i.pyFiles} Python file(s) are present; the TypeScript front end does not read them.`);
  const other = [...i.otherLang.entries()].filter(([, n]) => n > 0);
  if (other.length > 0) out.push(`${other.map(([l, n]) => `${n} ${l}`).join(', ')} file(s) are present; tool definitions in those languages are not parsed.`);
  // No line for TypeScript outside a tsconfig's program or under a hidden directory: every admitted
  // file is read (a tsconfig's program or the loose one, ts/program.ts) and hidden directories are
  // walked, so such a line could only be dead or false (ACP-474).
  for (const e of i.configErrors) out.push(`A tsconfig.json could not be read, and the files only it covers were not: ${e}.`);
  return out;
}
