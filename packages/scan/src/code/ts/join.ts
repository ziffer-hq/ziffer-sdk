/**
 * The joins no single file can make: an AI SDK tool named by the map key that
 * exposes it, a loop bridge's tool names recovered through the type its loop
 * reads (S-LOCAL's return type), the one function every execute body delegates
 * to and every place in the tree that calls it, and which filtered lists are
 * lists of TOOLS.
 */

import ts from 'typescript';

import { loadCodeNames } from '../sdks.js';
import type { CallerCheck, CodeTool, Dispatcher, Exposure, RuntimeGate, SourceRef, ToolCall } from '../types.js';
import { callerCheck, installTarget, offeredList, reachBound, toolsBeside, type InstallTarget, type OfferedList, type ReachBound } from './checks.js';
import type { Facts, FoundBridge, FoundTool } from './facts.js';
import type { BuiltProgram } from './program.js';
import { calleeName, calleeSymbol, declIdOf, firstDecl, refKey, refOf, relPath, resolveAlias } from './util.js';
import { exposurePoint, markerIn, toolPoint } from '../interception.js';

export interface Joined {
  tools: CodeTool[];
  exposures: Exposure[];
  dispatchers: Dispatcher[];
  gates: RuntimeGate[];
  /** Per bridge (by refKey of its site), the names joined back; used by the honesty lines. */
  bridgeNames: Map<string, string[]>;
}

/** Frameworks whose model sees a tools MAP's key as the tool's name (AI SDK; Mastra's `listAssignedTools`). */
const MAP_KEYED: ReadonlySet<string> = new Set(['ai', 'mastra']);

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function bridgeTools(b: FoundBridge, tools: FoundTool[]): FoundTool[] {
  if (b.handlerTypeId === undefined) return [];
  return tools.filter((t) => t.typeId === b.handlerTypeId);
}

function sortRefs<T extends { at: SourceRef }>(xs: T[]): T[] {
  return xs.sort((a, b) => (refKey(a.at) < refKey(b.at) ? -1 : 1));
}

export function join(facts: Facts, programs: BuiltProgram[], root: string, processed: ReadonlyMap<string, BuiltProgram>): Joined {
  // Dedupe tools by definition site (a file reachable from two programs is read once, but be defensive).
  const byKey = new Map<string, FoundTool>();
  for (const t of facts.tools) if (!byKey.has(t.key)) byKey.set(t.key, t);
  // The handing-over file of each exposure, for the framework's interception markers.
  const sourceByRel = new Map<string, ts.SourceFile>();
  for (const [fileName, bp] of processed) {
    const sf = bp.files.find((f) => f.fileName === fileName);
    if (sf !== undefined) sourceByRel.set(relPath(root, fileName), sf);
  }
  const tools = [...byKey.values()];

  // AI SDK tools take the key of the map that exposes them.
  const byVar = new Map<string, FoundTool>();
  for (const t of tools) if (t.varId !== undefined) byVar.set(t.varId, t);
  const byFactory = new Map<string, FoundTool>();
  for (const t of tools) if (t.factoryId !== undefined) byFactory.set(t.factoryId, t);
  for (const e of facts.exposures) {
    for (const entry of e.entries) {
      if (entry.key === undefined) continue;
      const t = (entry.valueId !== undefined ? byVar.get(entry.valueId) : undefined)
        ?? (entry.toolKey !== undefined ? byKey.get(entry.toolKey) : undefined)
        ?? (entry.calleeId !== undefined ? byFactory.get(entry.calleeId) : undefined);
      if (t !== undefined && MAP_KEYED.has(t.tool.sdk)) t.tool.name = entry.key;
    }
  }

  // Bridges: the names are the S-LOCAL tools of the type the loop reads.
  const bridgeNames = new Map<string, string[]>();
  const bridgeByTarget = new Map<string, FoundBridge>();
  for (const b of facts.bridges) {
    bridgeNames.set(refKey(b.at), uniq(bridgeTools(b, tools).map((t) => t.tool.name)));
    if (b.targetId !== undefined) bridgeByTarget.set(b.targetId, b);
  }

  // Gates (needed by the exposure notes): filtered lists whose element type is a tool type.
  const toolTypeIds = new Set(tools.map((t) => t.typeId).filter((x): x is string => x !== undefined));
  const gateSeen = new Set<string>();
  const gates: RuntimeGate[] = [];
  for (const g of facts.gates) {
    const isToolType = (id: string, pkg: string | undefined): boolean => toolTypeIds.has(id) || pkg === '@anthropic-ai/sdk' || pkg === 'ai' || (pkg?.startsWith('@ai-sdk/') ?? false);
    if (!isToolType(g.elemTypeId, g.elemPackage) || !isToolType(g.retElemTypeId, g.retElemPackage)) continue;
    const k = refKey(g.at);
    if (gateSeen.has(k)) continue;
    gateSeen.add(k);
    gates.push({
      name: g.fnName,
      at: g.at,
      note: `${g.fnName} narrows ${g.listText} to what ${g.callee} returns at runtime, so which of these tools a model can reach is decided by data, not by the code.`,
    });
  }
  const gateClause = gates.length > 0 ? ` Which ones a given call sees is narrowed at runtime (${gates.map((g) => g.name).join(', ')}); the scan lists what CAN be exposed.` : ' The scan lists what CAN be exposed.';

  const exposures: Exposure[] = [];
  for (const b of facts.bridges) {
    const names = bridgeNames.get(refKey(b.at)) ?? [];
    const through = b.handlerTypeName !== undefined ? `the ${b.handlerTypeName} type` : 'the type the loop reads';
    const bsf = sourceByRel.get(b.at.file);
    const interception = exposurePoint(b.sdk, (m) => (bsf === undefined ? undefined : markerIn(bsf, root, m)));
    exposures.push({
      ...(interception === undefined ? {} : { interception }),
      at: b.at,
      via: b.via,
      kind: 'computed',
      tools: names,
      note: names.length > 0
        ? `Tools are built in a loop under a computed key; ${names.length} name(s) were joined back through ${through}.${gateClause}`
        : `Tools are built in a loop under a computed key and no name could be joined back through ${through}.${gateClause}`,
    });
  }
  for (const e of facts.exposures) {
    let names = [...e.names];
    let isStatic = e.isStatic;
    let reason = e.reason;
    // Array elements left for the join: named by the definition they resolve to.
    for (const entry of e.entries) {
      if (entry.key !== undefined) continue;
      const t = (entry.valueId !== undefined ? byVar.get(entry.valueId) : undefined) ?? (entry.toolKey !== undefined ? byKey.get(entry.toolKey) : undefined);
      if (t !== undefined) names.push(t.tool.name);
      else {
        isStatic = false;
        reason = 'an element of the list is not a tool definition the scan found';
      }
    }
    // An MCP server's connect: the tools registered on the same server object.
    if (e.serverId !== undefined) {
      names = tools.filter((t) => t.serverId === e.serverId).map((t) => t.tool.name);
      if (facts.mcpDynamicServers.has(e.serverId)) {
        isStatic = false;
        reason = 'a tool is registered on this server under a computed name';
      }
    }
    let note: string;
    if (e.serverId !== undefined) {
      note = isStatic
        ? `This MCP server serves the ${names.length} tool(s) registered on it to whatever client connects; the model on the other side is not in this tree.`
        : `This MCP server serves ${names.length} tool(s) registered by literal name, and more under computed names (${reason ?? 'computed'}); the model on the other side is not in this tree.`;
    } else if (isStatic) {
      note = `The tool set is written out at this call: ${names.length} tool(s).`;
    } else {
      const bridge = e.valueTargetId !== undefined ? bridgeByTarget.get(e.valueTargetId) : undefined;
      if (bridge !== undefined) {
        names = bridgeNames.get(refKey(bridge.at)) ?? [];
        note = `The tool set is the map built by the loop at ${bridge.at.file}:${bridge.at.line}; ${names.length} name(s) joined back through it.${gateClause}`;
      } else if (names.length > 0) {
        note = `The tool set is computed (${reason ?? 'not a literal'}); ${names.length} name(s) were read through its type or joined back to their definitions.${gateClause}`;
      } else {
        note = `The tool set is computed (${reason ?? 'not a literal'}) and its names are not readable from this call site.${gateClause}`;
      }
    }
    if (e.interception !== undefined) note = `${note} ${e.interception}`;
    // A Claude Agent SDK in-process server: its tools reach the model as `mcp__<server>__<name>`.
    if (e.mcpServer !== undefined) {
      const server = (e.mcpServer.declId === undefined ? undefined : facts.claudeServerKeys.get(e.mcpServer.declId)) ?? e.mcpServer.name;
      if (server !== undefined) {
        for (const n of names) {
          for (const t of tools) {
            if (t.tool.sdk !== e.sdk || t.tool.name !== n) continue;
            const seen = `mcp__${server}__${n}`;
            if (seen !== n && t.tool.model_name === undefined) t.tool.model_name = seen;
          }
        }
      }
    }
    const sf = sourceByRel.get(e.at.file);
    const interception = e.point ?? exposurePoint(e.sdk, (m) => (sf === undefined ? undefined : markerIn(sf, root, m)));
    exposures.push({ at: e.at, via: e.via, kind: isStatic ? 'static' : 'computed', tools: uniq(names), note, ...(interception === undefined ? {} : { interception }) });
  }

  // Dispatchers: a tree function called with the tool's name and input by >=2 execute bodies, by one loop bridge, or from the model's reply.
  const reach = new Map<string, Set<string>>();
  const add = (id: string, toolKey: string): void => {
    const s = reach.get(id) ?? new Set<string>();
    s.add(toolKey);
    reach.set(id, s);
  };
  const viaBridge = new Set<string>();
  for (const t of tools) for (const c of t.calls) if (c.nameArg && c.argc >= 2) add(c.calleeId, t.key);
  for (const b of facts.bridges) {
    for (const c of b.calls) {
      if (!c.nameArg || c.argc < 2) continue;
      viaBridge.add(c.calleeId);
      if (!reach.has(c.calleeId)) reach.set(c.calleeId, new Set());
      for (const t of bridgeTools(b, tools)) add(c.calleeId, t.key);
    }
  }
  // The loop over the model's reply (sig-reply.ts): the callee runs every tool of that SDK
  // that has no execute body -- one reply call is enough, as one loop bridge is.
  const viaReply = new Set<string>();
  for (const r of facts.replyCalls) {
    const bodiless = tools.filter((t) => t.tool.sdk === r.sdk && t.tool.execute_at === undefined);
    if (bodiless.length === 0) continue;
    viaReply.add(r.calleeId);
    for (const t of bodiless) add(r.calleeId, t.key);
  }
  const dispatcherIds = [...reach.entries()].filter(([id, s]) => s.size >= 2 || viaBridge.has(id) || viaReply.has(id)).map(([id]) => id);
  const callers = findCallers(dispatcherIds, facts, programs, root, processed, tools.map((t) => t.tool.name));
  resolveToolCalls(tools, new Set(dispatcherIds), toolTypeIds);
  for (const t of tools) {
    if (t.hints.length > 0) t.tool.authority_claims = t.hints.map((h) => ({ name: h.name, value: h.value }));
    const own = toolPoint(t.tool.sdk, t.tool.authority_claims, t.tool.defined_at);
    if (own !== undefined) t.tool.interception = own;
    if (STUB_WORD.test(t.tool.description)) t.tool.declared_stub = true;
  }
  const dispatchers: Dispatcher[] = [];
  for (const id of dispatcherIds) {
    const info = facts.functions.get(id);
    if (info === undefined) continue;
    const delegating = reach.get(id) ?? new Set<string>();
    for (const k of delegating) {
      const t = byKey.get(k);
      if (t !== undefined && t.tool.delegates_to === undefined) t.tool.delegates_to = info.name;
    }
    const sites = callers.get(id) ?? [];
    dispatchers.push({ name: info.name, at: info.at, signature: info.signature, callers: sites.map((c) => c.caller), tools_delegating: delegating.size, caller_checks: sites });
  }
  dispatchers.sort((a, b) => b.tools_delegating - a.tools_delegating || b.callers.length - a.callers.length);

  const outTools = tools.map((t) => t.tool).sort((a, b) => (refKey(a.defined_at) < refKey(b.defined_at) ? -1 : 1));
  return { tools: outTools, exposures: sortRefs(exposures), dispatchers, gates: sortRefs(gates), bridgeNames };
}

/** The whole word "stub", any case: `declared_stub` (a reading of the description; "stubborn" is not it). */
export const STUB_WORD = /\bstub\b/i;

/**
 * `CodeTool.calls` from the candidates `reach.ts` recorded: a direct call counts when it
 * resolves to ANOTHER tool's run function; a lookup when the looked-up value's type is a
 * tool type. A path that entered the dispatcher, or entered another tool's run function
 * (the direct call to it is the finding), is dropped.
 */
function resolveToolCalls(tools: FoundTool[], dispatcherIds: ReadonlySet<string>, toolTypeIds: ReadonlySet<string>): void {
  const byTarget = new Map<string, FoundTool>();
  const execOwner = new Map<string, FoundTool>();
  for (const t of tools) {
    byTarget.set(`def:${t.key}`, t);
    for (const id of t.execIds ?? []) {
      byTarget.set(`exec:${id}`, t);
      execOwner.set(id, t);
    }
  }
  for (const t of tools) {
    if (t.reach === undefined) continue;
    const seen = new Set<string>();
    const calls: ToolCall[] = [];
    for (const r of t.reach) {
      if (r.pathIds.some((id) => dispatcherIds.has(id) || execOwner.has(id))) continue;
      let call: ToolCall | undefined;
      if (r.via === 'direct') {
        const inner = r.targets.map((x) => byTarget.get(x)).find((x): x is FoundTool => x !== undefined);
        if (inner === undefined || inner === t) continue;
        call = { tool: inner.tool.name, at: r.at, via: 'direct', through: r.through };
      } else {
        const isTool = r.elemSdkTool === true || (r.elemTypeId !== undefined && toolTypeIds.has(r.elemTypeId));
        if (!isTool) continue;
        call = { at: r.at, via: 'lookup', through: r.through };
        if (r.literalKey !== undefined) call.tool = r.literalKey;
      }
      const k = `${refKey(call.at)}|${call.via}|${call.tool ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      calls.push(call);
    }
    if (calls.length > 0) t.tool.calls = calls;
  }
}

/** Every call site of each dispatcher in the tree, by symbol identity (declaration position), not by spelling, with what the source shows before it. */
/** A bound read from the source, as the catalog's tool names: `CallerCheck.reaches` and `reaches_from`. */
function reachesOf(bound: ReachBound, toolNames: readonly string[]): Pick<CallerCheck, 'reaches' | 'reaches_from'> {
  const known = [...new Set(toolNames)];
  const reaches = bound.prefix !== undefined ? known.filter((n) => n.startsWith(bound.prefix ?? '')) : known.filter((n) => (bound.literal ?? []).includes(n));
  return { reaches: reaches.sort(), reaches_from: bound.from };
}

function findCallers(ids: string[], facts: Facts, programs: BuiltProgram[], root: string, processed: ReadonlyMap<string, BuiltProgram>, toolNames: readonly string[]): Map<string, CallerCheck[]> {
  const out = new Map<string, CallerCheck[]>();
  if (ids.length === 0) return out;
  const confirmation = new Set(loadCodeNames().confirmation);
  const names = new Set(ids.map((id) => facts.functions.get(id)?.name).filter((n): n is string => n !== undefined));
  const wanted = new Set(ids);
  const installs: { entry: CallerCheck; target: InstallTarget }[] = [];
  for (const bp of programs) {
    for (const sf of bp.files) {
      if (processed.get(sf.fileName) !== bp) continue;
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const cn = calleeName(n.expression);
          if (cn !== undefined && names.has(cn)) {
            const d = firstDecl(calleeSymbol(bp.checker, n.expression));
            const id = d === undefined ? undefined : declIdOf(d);
            if (id !== undefined && wanted.has(id)) {
              const list = out.get(id) ?? [];
              const entry = callerCheck(root, n, refOf(root, n), confirmation);
              const bound = reachBound(root, n, bp.checker);
              const full = bound === undefined ? entry : { ...entry, ...reachesOf(bound, toolNames) };
              list.push(full);
              out.set(id, list);
              const target = installTarget(n);
              if (target !== undefined) installs.push({ entry: full, target });
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  offered(installs, programs, root, processed, toolNames);
  for (const list of out.values()) list.sort((a, b) => (refKey(a.caller) < refKey(b.caller) ? -1 : 1));
  return out;
}

/**
 * `CallerCheck.offered` (ACP-455, third reading): for each caller whose function is handed on by
 * name, or made by a factory, every place in the tree that hands it on beside a `tools` value.
 * Set only when there is at least one such place and EVERY place's list is readable from the
 * source and names only catalog tools; one unread installation leaves the field absent, never a
 * partial list read as the whole.
 */
function offered(installs: { entry: CallerCheck; target: InstallTarget }[], programs: BuiltProgram[], root: string, processed: ReadonlyMap<string, BuiltProgram>, toolNames: readonly string[]): void {
  if (installs.length === 0) return;
  const byId = new Map<string, InstallTarget>();
  for (const i of installs) byId.set(i.target.id, i.target);
  const names = new Set([...byId.values()].map((t) => t.name));
  const found = new Map<string, (OfferedList | undefined)[]>();
  for (const bp of programs) {
    for (const sf of bp.files) {
      if (processed.get(sf.fileName) !== bp) continue;
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && names.has(n.text)) {
          const shorthand = ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n ? bp.checker.getShorthandAssignmentValueSymbol(n.parent) : undefined;
          const d = firstDecl(shorthand !== undefined ? resolveAlias(bp.checker, shorthand) : calleeSymbol(bp.checker, n));
          const id = d === undefined ? undefined : declIdOf(d);
          const target = id === undefined ? undefined : byId.get(id);
          const declaring = d !== undefined && ((ts.isFunctionDeclaration(d) || ts.isVariableDeclaration(d)) && d.name === n);
          const imported = ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent) || ts.isExportSpecifier(n.parent);
          if (id !== undefined && target !== undefined && !declaring && !imported) {
            const isCallee = ts.isCallExpression(n.parent) && n.parent.expression === n;
            const site = target.factory ? (isCallee && ts.isCallExpression(n.parent) ? n.parent : undefined) : isCallee ? undefined : n;
            if (site !== undefined) {
              const values = toolsBeside(bp.checker, site);
              const lists = found.get(id) ?? [];
              if (values === undefined) lists.push(undefined);
              else for (const v of values) lists.push(offeredList(root, bp.checker, v));
              found.set(id, lists);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  const known = new Set(toolNames);
  for (const { entry, target } of installs) {
    const lists = found.get(target.id) ?? [];
    if (lists.length === 0) continue;
    const got = new Set<string>();
    const from: string[] = [];
    let readable = true;
    for (const l of lists) {
      if (l === undefined || l.literal.some((n) => !known.has(n))) {
        readable = false;
        break;
      }
      for (const n of l.literal) got.add(n);
      for (const p of l.prefixes) for (const n of known) if (n.startsWith(p)) got.add(n);
      from.push(l.from);
    }
    if (!readable || got.size === 0) continue;
    entry.offered = [...got].sort();
    entry.offered_from = [...new Set(from)].join('; ');
  }
}
