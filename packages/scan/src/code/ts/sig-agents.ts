/**
 * OpenAI Agents SDK, TypeScript (`@openai/agents`, `@openai/agents-core`,
 * `@openai/agents/realtime`; record §3.9): `tool({ name, description, parameters,
 * execute })` defines a function tool; `new Agent({ tools })`, `Agent.create({ tools })`
 * and `new RealtimeAgent({ tools })` hand a list to a model; `agent.asTool({ toolName,
 * toolDescription })` makes a whole agent one tool of another. `webSearchTool()`,
 * `fileSearchTool()`, `codeInterpreterTool()`, `imageGenerationTool()` and
 * `hostedMcpTool()` run on OpenAI's side: counted for the honesty line, never listed as
 * the application's. Every recogniser asks the package of the callee first --
 * `tool` is also the AI SDK's and LangChain's -- through the checker, or through the
 * import declaration when the SDK is not installed.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { arrayEntries, execCalls, hintsOf, literalOf, modelName, noteAt, schemaOfValue, type ExtractContext } from './common.js';
import type { FoundExposure } from './facts.js';
import { calleeExportName, calleePackage, constString, declIdOf, dottedName, firstDecl, functionBody, getProp, packageMatches, propValue, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

const AGENT_CLASSES = new Set(['Agent', 'RealtimeAgent']);
const HOSTED = new Set(['webSearchTool', 'fileSearchTool', 'codeInterpreterTool', 'imageGenerationTool', 'hostedMcpTool', 'computerTool', 'shellTool', 'applyPatchTool', 'localShellTool']);

function agentsPackage(ctx: ExtractContext, callee: ts.Expression): string | undefined {
  const pkg = calleePackage(ctx.checker, callee);
  return packageMatches(pkg, packagesOf('openai-agents')) ? pkg : undefined;
}

/** The variable a definition is assigned to, for the join and for a name of last resort. */
function assignedTo(node: ts.Node): ts.VariableDeclaration | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  return n.parent !== undefined && ts.isVariableDeclaration(n.parent) ? n.parent : undefined;
}

function push(ctx: ExtractContext, call: ts.CallExpression, name: string, fields: ts.ObjectLiteralExpression, descMember: string, exec: ts.ObjectLiteralElementLike | undefined, via: string): void {
  const schemaNode = propValue(getProp(fields, 'parameters'));
  const defined_at = refOf(ctx.root, call);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(fields, descMember)), ctx.checker) ?? '',
    ...(schemaNode !== undefined && ts.isExpression(schemaNode) ? schemaOfValue(ctx.checker, schemaNode, 'parameters') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: 'openai-agents',
    via,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const found = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), name, undefined), hints: hintsOf(fields) };
  const v = assignedTo(call);
  ctx.facts.tools.push(v !== undefined ? { ...found, varId: declIdOf(v) } : found);
}

function listExposure(ctx: ExtractContext, at: ts.Node, value: ts.Node | undefined, via: string): void {
  if (value === undefined || !ts.isExpression(value)) return;
  const e: FoundExposure = { at: refOf(ctx.root, at), via, sdk: 'openai-agents', isStatic: false, entries: [], names: [] };
  const v = unwrap(value);
  if (ts.isArrayLiteralExpression(v)) {
    Object.assign(e, arrayEntries(ctx, v, (o) => stringValue(propValue(getProp(o, 'name')))));
    if (!e.isStatic) e.reason = 'an element of the list is not a tool the scan can name';
  } else {
    e.reason = 'the list is a value, not a literal';
    const s = ctx.checker.getSymbolAtLocation(v);
    const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
    if (d !== undefined) e.valueTargetId = declIdOf(d);
  }
  ctx.facts.exposures.push(e);
}

/** `tool({...})`, `Agent.create({ tools })`, `agent.asTool({...})` and the hosted tools. True when the call was the SDK's. */
export function agentsCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (cn !== 'tool' && cn !== 'create' && cn !== 'asTool' && !HOSTED.has(cn)) return false;
  if (cn === 'create' && !/(^|\.)(Agent|RealtimeAgent)\.create$/.test(dottedName(call.expression) ?? '')) return false;
  const pkg = agentsPackage(ctx, call.expression);
  if (pkg === undefined) return false;
  const a0 = call.arguments[0];
  const fields = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (HOSTED.has(cn)) {
    ctx.facts.providerTools.push({ at: refOf(ctx.root, call), text: `${cn}() from "${pkg}"` });
    return true;
  }
  if (cn === 'create') {
    if (fields !== undefined) listExposure(ctx, call, propValue(getProp(fields, 'tools')), `${dottedName(call.expression) ?? 'Agent.create'}({ tools })`);
    return true;
  }
  if (fields === undefined) return true;
  if (cn === 'asTool') {
    const name = modelName(ctx, 'openai-agents', propValue(getProp(fields, 'toolName')), call);
    if (name !== undefined) push(ctx, call, name, fields, 'toolDescription', undefined, `agent.asTool() from "${pkg}" (an agent run as one tool)`);
    return true;
  }
  const exec = getProp(fields, 'execute');
  // The SDK names an unnamed tool after its execute function; the variable is the last resort.
  const execFn = propValue(exec);
  const fnName = execFn !== undefined && ts.isFunctionExpression(execFn) && execFn.name !== undefined ? execFn.name.text : undefined;
  const v = assignedTo(call);
  const name = modelName(ctx, 'openai-agents', propValue(getProp(fields, 'name')), call, fnName ?? (v !== undefined && ts.isIdentifier(v.name) ? v.name.text : undefined));
  if (name === undefined) {
    // A factory's `tool({ name, ... })` with the name passed in: a definition, said, never silently dropped.
    noteAt(ctx.facts, 'openai-agents:unnamed', refOf(ctx.root, call), (n, where) => `${n} OpenAI Agents SDK tool() definition(s) take their name from a value the code does not fix (${where}); they are not listed.`);
    return true;
  }
  push(ctx, call, name, fields, 'description', exec, `tool() from "${pkg}"`);
  return true;
}

/** `new Agent({ tools })` / `new RealtimeAgent({ tools })`. True when the class was the SDK's. */
export function agentsNew(ctx: ExtractContext, expr: ts.NewExpression): boolean {
  const cn = calleeExportName(ctx.checker, expr.expression);
  if (cn === undefined || !AGENT_CLASSES.has(cn)) return false;
  if (agentsPackage(ctx, expr.expression) === undefined) return false;
  const a0 = expr.arguments?.[0];
  const opts = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (opts !== undefined) listExposure(ctx, expr, propValue(getProp(opts, 'tools')), `new ${cn}({ tools })`);
  return true;
}
