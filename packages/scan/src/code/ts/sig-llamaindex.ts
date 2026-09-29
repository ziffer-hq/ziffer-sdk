/**
 * LlamaIndex, TypeScript (`llamaindex`, `@llamaindex/*`; record §3.11).
 * `tool(fn, { name, description, parameters })` and the object form `tool({ name,
 * description, parameters, execute })` -- `tool` is `FunctionTool.from`, declared in
 * `@llamaindex/core/tools` 0.12.1 -- define a tool; `FunctionTool.from(...)` and `new
 * FunctionTool(fn, metadata)` are the same. A query engine run as a tool
 * (`index.queryTool({ metadata })`, `new QueryEngineTool({ metadata })`) is a tool
 * named by `metadata.name`. Exposures: `agent({ tools })` / `new FunctionAgent({ tools
 * })` from `@llamaindex/workflow`, and an LLM's `exec({ tools })`, which runs the
 * calls itself. LlamaIndex documents no pre-execution hook: the place a check stands
 * is the top of the tool function (K3); its ToolCall events only observe. The
 * two-argument `tool(fn, {...})` collides with LangChain's `tool(fn, { schema })`
 * except for the key and the package, and the package decides.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { arrayEntries, execCalls, hintsOf, literalOf, modelName, noteAt, schemaOfValue, type ExtractContext } from './common.js';
import type { FoundExposure, FoundTool } from './facts.js';
import { calleeExportName, calleePackage, constString, declIdOf, dottedName, firstDecl, functionBody, getProp, packageMatches, propValue, refKey, refOf, resolveAlias, unwrap } from './util.js';

const SDK = 'llamaindex';
/** The ready-made tools `@llamaindex/tools` exports (its dist/index.d.ts, read 2026-09-28): run in the application, defined outside it. */
const PREBUILT = new Set(['wiki', 'weather', 'duckduckgo', 'interpreter', 'imageGenerator', 'codeGenerator', 'documentGenerator', 'codeArtifactGenerator', 'documentArtifactGenerator', 'extractMissingCells', 'fillMissingCells', 'getOpenAPIActionTools']);
export const LLAMAINDEX_INTERCEPTION = 'LlamaIndex runs these tools itself and documents no hook that runs before one and can refuse it: a check at the top of the tool function (K3) is where ZIFFER stands; its ToolCall events only observe.';

function liPackage(ctx: ExtractContext, callee: ts.Expression): string | undefined {
  const pkg = calleePackage(ctx.checker, callee);
  return packageMatches(pkg, packagesOf(SDK)) ? pkg : undefined;
}

function assignedTo(node: ts.Node): ts.VariableDeclaration | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  return n.parent !== undefined && ts.isVariableDeclaration(n.parent) ? n.parent : undefined;
}

function pushTool(ctx: ExtractContext, at: ts.Expression, meta: ts.ObjectLiteralExpression, fn: ts.Node | undefined, schemaMember: string | undefined, via: string): void {
  const nameNode = propValue(getProp(meta, 'name'));
  const name = nameNode === undefined ? undefined : modelName(ctx, SDK, nameNode, at, fn !== undefined && ts.isIdentifier(fn) ? fn.text : undefined);
  if (name === undefined && nameNode !== undefined) return;
  if (name === undefined) {
    // A name built at runtime (`tool_${title}` in a loop), or none (LlamaIndex's default): not listed, said.
    noteAt(ctx.facts, 'llamaindex:unnamed', refOf(ctx.root, at), (n, where) => `${n} LlamaIndex tool(s) are named at runtime or take LlamaIndex's default name (${where}); they are not listed, and their names cannot be read from the code.`);
    return;
  }
  const schemaNode = schemaMember === undefined ? undefined : propValue(getProp(meta, schemaMember));
  const defined_at = refOf(ctx.root, at);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(meta, 'description')), ctx.checker) ?? '',
    ...(schemaNode !== undefined && ts.isExpression(schemaNode) ? schemaOfValue(ctx.checker, schemaNode, 'parameters') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: SDK,
    via,
    defined_at,
  };
  if (fn !== undefined) tool.execute_at = refOf(ctx.root, fn);
  const found: FoundTool = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(fn, ctx.checker), name, undefined), hints: hintsOf(meta) };
  const v = assignedTo(at);
  if (v !== undefined) found.varId = declIdOf(v);
  ctx.facts.tools.push(found);
}

/** `tool(fn, meta)` / `tool({ ..., execute })` and `FunctionTool.from`, one reading for both. */
function functionTool(ctx: ExtractContext, at: ts.Expression, args: readonly ts.Expression[], via: string): void {
  const [a0, a1] = args;
  if (a0 === undefined) return;
  const second = a1 === undefined ? undefined : literalOf(a1, ctx.checker);
  if (second !== undefined) {
    pushTool(ctx, at, second, a0, 'parameters', via);
    return;
  }
  const obj = literalOf(a0, ctx.checker);
  if (obj !== undefined) pushTool(ctx, at, obj, propValue(getProp(obj, 'execute')), 'parameters', via);
}

/** A query engine as a tool: `{ metadata: { name, description } }`. */
function queryTool(ctx: ExtractContext, at: ts.Expression, a0: ts.Expression | undefined, via: string): void {
  const opts = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  const metaNode = opts === undefined ? undefined : propValue(getProp(opts, 'metadata'));
  const meta = metaNode === undefined ? opts : literalOf(metaNode, ctx.checker);
  if (meta !== undefined) pushTool(ctx, at, meta, undefined, undefined, via);
}

function exposure(ctx: ExtractContext, call: ts.Expression, value: ts.Node | undefined, via: string): void {
  if (value === undefined || !ts.isExpression(value)) return;
  const e: FoundExposure = { at: refOf(ctx.root, call), via, sdk: SDK, isStatic: false, entries: [], names: [], interception: LLAMAINDEX_INTERCEPTION };
  const v = unwrap(value);
  if (ts.isArrayLiteralExpression(v)) {
    Object.assign(e, arrayEntries(ctx, v, (o) => constString(propValue(getProp(o, 'name')), ctx.checker)));
    if (!e.isStatic) e.reason = 'an element of the list is not a tool the scan can name';
  } else {
    e.reason = 'the list is a value, not a literal';
    const s = ts.isAwaitExpression(v) ? undefined : ctx.checker.getSymbolAtLocation(v);
    const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
    if (d !== undefined) e.valueTargetId = declIdOf(d);
  }
  ctx.facts.exposures.push(e);
}

/** LlamaIndex's definitions and exposures by call. True when the call was LlamaIndex's. */
export function llamaindexCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (cn !== 'tool' && cn !== 'from' && cn !== 'queryTool' && cn !== 'agent' && cn !== 'exec' && cn !== 'mcp' && !PREBUILT.has(cn)) return false;
  if (cn === 'from' && !/(^|\.)FunctionTool\.from$/.test(dottedName(call.expression) ?? '')) return false;
  const pkg = liPackage(ctx, call.expression);
  if (pkg === undefined) return false;
  if (cn === 'tool' || cn === 'from') functionTool(ctx, call, call.arguments, `${cn === 'from' ? 'FunctionTool.from' : 'tool'}() from "${pkg}"`);
  else if (cn === 'queryTool') queryTool(ctx, call, call.arguments[0], `queryTool() from "${pkg}" (a query engine run as a tool)`);
  else if (cn === 'mcp') ctx.facts.mcpClients.push(refOf(ctx.root, call));
  else if (PREBUILT.has(cn)) noteAt(ctx.facts, 'llamaindex:prebuilt', refOf(ctx.root, call), (n, where) => `${n} prebuilt tool(s) from @llamaindex/tools are created (${where}): wiki, weather, duckduckgo, interpreter, OpenAPI actions and the like run in this application but are defined in the package, and are not listed.`);
  else {
    const a0 = call.arguments[0];
    const opts = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
    if (opts !== undefined) exposure(ctx, call, propValue(getProp(opts, 'tools')), cn === 'agent' ? `agent({ tools }) from "${pkg}"` : `llm.exec({ tools }) from "${pkg}" (runs the calls itself)`);
  }
  return true;
}

/** `new FunctionTool(fn, metadata)`, `new QueryEngineTool({ metadata })`, `new FunctionAgent({ tools })`. True when the class was LlamaIndex's. */
export function llamaindexNew(ctx: ExtractContext, expr: ts.NewExpression): boolean {
  const cn = calleeExportName(ctx.checker, expr.expression);
  if (cn !== 'FunctionTool' && cn !== 'QueryEngineTool' && cn !== 'FunctionAgent' && cn !== 'ReActAgent') return false;
  const pkg = liPackage(ctx, expr.expression);
  if (pkg === undefined) return false;
  const args = expr.arguments ?? [];
  if (cn === 'FunctionTool') functionTool(ctx, expr, args, `new FunctionTool() from "${pkg}"`);
  else if (cn === 'QueryEngineTool') queryTool(ctx, expr, args[0], `new QueryEngineTool() from "${pkg}" (a query engine run as a tool)`);
  else {
    const opts = args[0] === undefined ? undefined : literalOf(args[0], ctx.checker);
    if (opts !== undefined) exposure(ctx, expr, propValue(getProp(opts, 'tools')), `new ${cn}({ tools }) from "${pkg}"`);
  }
  return true;
}
