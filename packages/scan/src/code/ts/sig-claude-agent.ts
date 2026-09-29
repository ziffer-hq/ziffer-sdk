/**
 * Claude Agent SDK, TypeScript (`@anthropic-ai/claude-agent-sdk`; record §3.3).
 * Custom tools are in-process MCP tools: `tool(name, description, zodRawShape,
 * handler, extras?)` -- positional in the published 0.3.284 declaration (`sdk.d.ts`),
 * with the object form one mirrored docs page shows read as a fallback -- bundled by
 * `createSdkMcpServer({ name, tools })` and handed to `query({ prompt, options: {
 * mcpServers, allowedTools, tools, hooks, canUseTool } })`. The SDK runs every tool
 * itself; the place a check can refuse one is a `PreToolUse` hook (K1), which covers
 * the SDK's built-in tools (`Bash`, `Write`, `Edit`, ...) too. Built-in tools named
 * in `allowedTools` or `tools` are listed as tools: they run in the application's
 * process with the application's authority. `extras.annotations` are MCP
 * `ToolAnnotations`: claims, recorded, never relied on.
 */

import { readFileSync } from 'node:fs';

import ts from 'typescript';

import type { CodeTool, Interception } from '../types.js';
import { packagesOf } from '../sdks.js';
import { annotationClaims, arrayEntries, execCalls, hintsOf, literalOf, modelName, note, schemaOfValue, typeFromPackages, type ExtractContext } from './common.js';
import type { AuthorityClaim, Facts, FoundExposure, FoundTool } from './facts.js';
import { calleePackage, constString, declIdOf, firstDecl, functionBody, getProp, packageMatches, packageOfSpecifier, propValue, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

const SDK = 'claude-agent-sdk';
export const CLAUDE_AGENT_INTERCEPTION = 'The Claude Agent SDK runs these tools itself: a PreToolUse hook in the query() options (K1) is where a check can refuse one before it runs, built-in tools included; canUseTool is skipped for calls allowedTools or the permission mode already allow.';

function isSdk(ctx: ExtractContext, callee: ts.Expression): boolean {
  return packageMatches(calleePackage(ctx.checker, callee), packagesOf(SDK));
}

function assignedTo(node: ts.Node): ts.VariableDeclaration | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  return n.parent !== undefined && ts.isVariableDeclaration(n.parent) ? n.parent : undefined;
}

function pushTool(ctx: ExtractContext, call: ts.CallExpression, name: string, description: string, shape: ts.Node | undefined, handler: ts.Node | undefined, hints: AuthorityClaim[]): void {
  const defined_at = refOf(ctx.root, call);
  const tool: CodeTool = {
    name,
    description,
    ...(shape !== undefined && ts.isExpression(shape) ? schemaOfValue(ctx.checker, shape, 'inputSchema') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: SDK,
    via: 'tool() from "@anthropic-ai/claude-agent-sdk" (an in-process MCP tool)',
    defined_at,
  };
  if (handler !== undefined) tool.execute_at = refOf(ctx.root, handler);
  const found: FoundTool = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(handler, ctx.checker), name, undefined), hints };
  const v = assignedTo(call);
  if (v !== undefined) found.varId = declIdOf(v);
  ctx.facts.tools.push(found);
}

/** `tool(name, description, shape, handler, extras?)`, or the object form. */
function sdkTool(ctx: ExtractContext, call: ts.CallExpression): void {
  const [a0, a1, a2, a3, a4] = call.arguments;
  if (a0 === undefined) return;
  const obj = literalOf(a0, ctx.checker);
  if (obj !== undefined && getProp(obj, 'name') !== undefined) {
    const h = propValue(getProp(obj, 'handler')) ?? propValue(getProp(obj, 'handle'));
    const name = modelName(ctx, SDK, propValue(getProp(obj, 'name')), call, h !== undefined && ts.isIdentifier(h) ? h.text : undefined);
    if (name === undefined) return;
    pushTool(ctx, call, name, constString(propValue(getProp(obj, 'description')), ctx.checker) ?? '', propValue(getProp(obj, 'inputSchema')), propValue(getProp(obj, 'handler')) ?? propValue(getProp(obj, 'handle')), hintsOf(obj));
    return;
  }
  const name = modelName(ctx, SDK, a0, call, a3 !== undefined && ts.isIdentifier(a3) ? a3.text : undefined);
  if (name === undefined) return;
  const extras = a4 === undefined ? undefined : literalOf(a4, ctx.checker);
  const ann = extras === undefined ? undefined : propValue(getProp(extras, 'annotations'));
  const hints = ann !== undefined && ts.isObjectLiteralExpression(ann) ? annotationClaims(ann) : extras !== undefined ? hintsOf(extras) : [];
  pushTool(ctx, call, name, a1 === undefined ? '' : (constString(a1, ctx.checker) ?? ''), a2, a3, hints);
}

/** `mcp__server__tool` is how the model names an SDK MCP tool; the definition's own name is the part after the server. */
function toolNameOf(allowed: string): string {
  const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(allowed);
  return m?.[1] ?? allowed;
}

/** The name a permission rule names: `Bash(git status:*)` is `Bash`. */
function ruleName(entry: string): string {
  const i = entry.indexOf('(');
  return i < 0 ? entry : entry.slice(0, i);
}

const builtinsSeen = new WeakMap<Facts, Set<string>>();

/** `data/claude-agent-builtins.json`: the built-in tool names the SDK's current version defines, with that version and the date read. */
export interface ClaudeBuiltins {
  version: string;
  read: string;
  names: ReadonlySet<string>;
}

export class ClaudeBuiltinsDataInvalid extends Error {
  override readonly name = 'ClaudeBuiltinsDataInvalid';
}

export function parseClaudeBuiltins(text: string): ClaudeBuiltins {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ClaudeBuiltinsDataInvalid('data/claude-agent-builtins.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ClaudeBuiltinsDataInvalid('data/claude-agent-builtins.json is not an object');
  const version: unknown = Reflect.get(raw, 'version');
  const read: unknown = Reflect.get(raw, 'read');
  const names: unknown = Reflect.get(raw, 'names');
  if (typeof version !== 'string' || typeof read !== 'string' || !Array.isArray(names) || names.length === 0) throw new ClaudeBuiltinsDataInvalid('data/claude-agent-builtins.json needs version, read and a non-empty names list');
  const out = new Set<string>();
  for (const n of names) {
    if (typeof n !== 'string') throw new ClaudeBuiltinsDataInvalid('data/claude-agent-builtins.json names holds a non-string');
    out.add(n);
  }
  return { version, read, names: out };
}

/** The honesty line for `Facts.claudeUnknownBuiltins`, in the Python walker's words; undefined when there are none. */
export function unknownBuiltinsLine(found: readonly { name: string; at: { file: string; line: number } }[]): string | undefined {
  if (found.length === 0) return undefined;
  const known = loadClaudeBuiltins();
  const shown = found.slice(0, 5).map((f) => `${f.at.file}:${f.at.line} (${f.name})`).join(', ') + (found.length > 5 ? ', ...' : '');
  return `Claude Agent SDK: ${found.length} name(s) in an allowed-tools or tools list are not a built-in tool the SDK's current version defines (${shown}; @anthropic-ai/claude-agent-sdk ${known.version}, read ${known.read}): each is listed as written, and matches no tool, so it neither allows nor restricts one`;
}

let builtins: ClaudeBuiltins | undefined;
export function loadClaudeBuiltins(): ClaudeBuiltins {
  if (builtins === undefined) builtins = parseClaudeBuiltins(readFileSync(new URL('../../../data/claude-agent-builtins.json', import.meta.url), 'utf8'));
  return builtins;
}

/**
 * The string entries of `allowedTools` / `tools` in an options object the SDK reads:
 * built-in tool names become tools (one per name per tree), `mcp__...` entries name
 * tools the definitions already list.
 */
function namedTools(ctx: ExtractContext, opts: ts.ObjectLiteralExpression): { names: string[]; restricted: boolean } {
  const names: string[] = [];
  let restricted = false;
  for (const member of ['allowedTools', 'tools']) {
    const v = propValue(getProp(opts, member));
    if (v === undefined || !ts.isExpression(v)) continue;
    const arr = unwrap(v);
    if (!ts.isArrayLiteralExpression(arr)) continue;
    if (member === 'tools') restricted = true;
    for (const el of arr.elements) {
      const s = stringValue(el);
      if (s === undefined) continue;
      const name = ruleName(s);
      if (name.startsWith('mcp__')) {
        names.push(toolNameOf(name));
        continue;
      }
      names.push(name);
      const seen = builtinsSeen.get(ctx.facts) ?? new Set<string>();
      builtinsSeen.set(ctx.facts, seen);
      if (seen.has(name)) continue;
      seen.add(name);
      const defined_at = refOf(ctx.root, el);
      // A name the SDK's current version does not define: reported as written, and said.
      const known = loadClaudeBuiltins();
      const unknown = !known.names.has(name);
      if (unknown) ctx.facts.claudeUnknownBuiltins.push({ name, at: defined_at });
      ctx.facts.tools.push({
        tool: { name, description: '', schema_kind: 'unknown', params: [], sdk: SDK, via: unknown ? `name written in ${member} for a built-in tool of the Claude Agent SDK, which its current version does not define` : `built-in tool of the Claude Agent SDK, named in ${member} (the SDK runs it in this process)`, defined_at },
        key: refKey(defined_at),
        calls: [],
        hints: [],
      });
    }
  }
  return { names, restricted };
}

/** True when the file imports the SDK: the evidence for an options object whose type the checker cannot read. */
function fileImportsSdk(sf: ts.SourceFile): boolean {
  return sf.statements.some((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && packageMatches(packageOfSpecifier(st.moduleSpecifier.text), packagesOf(SDK)));
}

/** An options literal with `allowedTools` outside a query() call (a default-options field, a builder): typed by the SDK, or in a file that imports it. */
export function claudeAgentOptions(ctx: ExtractContext, obj: ts.ObjectLiteralExpression): void {
  const p = obj.parent;
  // query({ options: {...} }) reads it itself.
  if (p !== undefined && ts.isPropertyAssignment(p) && p.parent.parent !== undefined && ts.isCallExpression(p.parent.parent) && isSdk(ctx, p.parent.parent.expression)) return;
  const ctxType = ctx.checker.getContextualType(obj);
  const typed = ctxType !== undefined && typeFromPackages(ctxType, packagesOf(SDK)) !== undefined;
  if (!typed && !fileImportsSdk(obj.getSourceFile())) return;
  namedTools(ctx, obj);
}

function hookPresent(opts: ts.ObjectLiteralExpression, event: string): boolean {
  const hooks = propValue(getProp(opts, 'hooks'));
  return hooks !== undefined && ts.isObjectLiteralExpression(hooks) && getProp(hooks, event) !== undefined;
}

/** `tool(...)`, `createSdkMcpServer({ tools })`, `query({ options })`. True when the call was the SDK's. */
export function claudeAgentCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (cn !== 'tool' && cn !== 'createSdkMcpServer' && cn !== 'query') return false;
  if (!isSdk(ctx, call.expression)) return false;
  note(ctx.facts, 'claude-agent-sdk:settings', 'Claude Agent SDK: permissions configured outside the code (.claude/settings.json, the permissionMode option, the settingSources it loads) change which tools run without appearing at the call site, and are not read here.', refOf(ctx.root, call));
  if (cn === 'tool') {
    sdkTool(ctx, call);
    return true;
  }
  const a0 = call.arguments[0];
  const fields = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (fields === undefined) return true;
  if (cn === 'createSdkMcpServer') {
    const server = constString(propValue(getProp(fields, 'name')), ctx.checker);
    const value = propValue(getProp(fields, 'tools'));
    const e: FoundExposure = { at: refOf(ctx.root, call), via: `createSdkMcpServer({ tools })${server !== undefined ? ` "${server}"` : ''} (an in-process MCP server the SDK runs)`, sdk: SDK, isStatic: false, entries: [], names: [], interception: CLAUDE_AGENT_INTERCEPTION };
    const holder = assignedTo(call);
    e.mcpServer = { ...(server === undefined ? {} : { name: server }), ...(holder === undefined ? {} : { declId: declIdOf(holder) }) };
    const v = value !== undefined && ts.isExpression(value) ? unwrap(value) : undefined;
    if (v !== undefined && ts.isArrayLiteralExpression(v)) {
      Object.assign(e, arrayEntries(ctx, v, (o) => constString(propValue(getProp(o, 'name')), ctx.checker)));
      if (!e.isStatic) e.reason = 'an element of the list is not a tool the scan can name';
    } else if (v !== undefined) {
      e.reason = 'the list is a value, not a literal';
      const s = ctx.checker.getSymbolAtLocation(v);
      const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
      if (d !== undefined) e.valueTargetId = declIdOf(d);
    } else {
      return true;
    }
    ctx.facts.exposures.push(e);
    return true;
  }
  // query({ prompt, options })
  const opts = literalOf(propValue(getProp(fields, 'options')) ?? fields, ctx.checker);
  const at = refOf(ctx.root, call);
  if (opts === undefined) {
    ctx.facts.exposures.push({ at, via: 'query({ options })', sdk: SDK, isStatic: false, entries: [], names: [], reason: 'the options are a value, not a literal: which tools and servers they name is not read here', interception: CLAUDE_AGENT_INTERCEPTION });
    return true;
  }
  const { names, restricted } = namedTools(ctx, opts);
  const serversNode = propValue(getProp(opts, 'mcpServers'));
  const servers = serversNode !== undefined;
  // An external server (a `command` to spawn, a `url` to call) serves tools listed only at runtime.
  if (serversNode !== undefined && ts.isObjectLiteralExpression(serversNode)) {
    for (const p of serversNode.properties) {
      // The key an in-process server is registered under: the `<server>` of `mcp__<server>__<tool>`.
      const key = p.name === undefined ? undefined : ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
      const val = propValue(p);
      const vs = key !== undefined && val !== undefined && ts.isIdentifier(val) ? ctx.checker.getSymbolAtLocation(val) : undefined;
      const vd = vs === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, vs));
      if (key !== undefined && vd !== undefined) ctx.facts.claudeServerKeys.set(declIdOf(vd), key);
      const cfg = propValue(p);
      if (cfg !== undefined && ts.isObjectLiteralExpression(cfg) && (getProp(cfg, 'command') !== undefined || getProp(cfg, 'url') !== undefined)) ctx.facts.mcpClients.push(refOf(ctx.root, cfg));
    }
  }
  const pre = hookPresent(opts, 'PreToolUse');
  const canUse = getProp(opts, 'canUseTool');
  const hook = pre ? ` A PreToolUse hook is already registered here.` : canUse !== undefined ? ' A canUseTool callback is registered here, and no PreToolUse hook.' : '';
  // The hook read on THIS call's options, closer than a marker anywhere in the file.
  const hooksNode = getProp(opts, 'hooks');
  const point: Interception = pre && hooksNode !== undefined
    ? { kind: 'K1', name: 'a PreToolUse hook', present: true, at: refOf(ctx.root, hooksNode) }
    : canUse !== undefined
      ? { kind: 'K1', name: 'a canUseTool callback', present: true, at: refOf(ctx.root, canUse) }
      : { kind: 'K1', name: 'a PreToolUse hook', present: false };
  const e: FoundExposure = { at, via: 'query({ options })', sdk: SDK, isStatic: restricted && !servers, entries: [], names, interception: `${CLAUDE_AGENT_INTERCEPTION}${hook}`, point };
  if (!e.isStatic) e.reason = restricted ? 'the tools of the MCP servers in mcpServers are those servers\' own' : 'no `tools` list restricts the built-in tools, so every Claude Code built-in tool is available besides those named in allowedTools';
  ctx.facts.exposures.push(e);
  return true;
}
