/**
 * Mastra (`@mastra/core`; record §3.21). `createTool({ id, description, inputSchema,
 * outputSchema?, requireApproval?, execute })` from `@mastra/core/tools` defines a
 * tool; `new Agent({ tools: { key: tool } })` from `@mastra/core/agent` hands a MAP to
 * a model, and the model sees the map KEY as the tool's name (`listAssignedTools`
 * names each entry by its key, @mastra/core 1.71.0), so the join renames the
 * definition by the key the way it does the AI SDK's. `new Mastra({ tools })` serves
 * tools to the Mastra server's clients, `new MCPServer({ tools })` from `@mastra/mcp` to
 * MCP clients. `requireApproval` pauses the run for an
 * approval the application resumes (K2), recorded as a claim; the place a check
 * stands is the top of `execute` (K3). `new MCPClient(...)` from `@mastra/mcp` is an
 * attach point whose tools are listed at runtime.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { execCalls, exposureOfMap, hintsOf, literalOf, modelName, noteAt, schemaOfValue, type ExtractContext } from './common.js';
import type { FoundTool } from './facts.js';
import { calleeExportName, calleePackage, constString, declIdOf, functionBody, getProp, packageMatches, propValue, refKey, refOf, unwrap } from './util.js';

const SDK = 'mastra';
export const MASTRA_INTERCEPTION = 'Mastra runs these tools itself: requireApproval on a tool (K2) pauses the run for an approval the application resumes, and a check at the top of the tool\'s execute (K3) is where ZIFFER stands.';

function mastraPackage(ctx: ExtractContext, callee: ts.Expression): string | undefined {
  const pkg = calleePackage(ctx.checker, callee);
  return packageMatches(pkg, packagesOf(SDK)) ? pkg : undefined;
}

function assignedTo(node: ts.Node): ts.VariableDeclaration | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  return n.parent !== undefined && ts.isVariableDeclaration(n.parent) ? n.parent : undefined;
}

/** `createTool({ id, description, inputSchema, execute })`. True when the call was Mastra's. */
export function mastraCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (cn !== 'createTool') return false;
  const pkg = mastraPackage(ctx, call.expression);
  if (pkg === undefined) return false;
  const a0 = call.arguments[0];
  const fields = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (fields === undefined) return true;
  const v = assignedTo(call);
  // The id until a tools map renames it by its key; the variable as the last resort.
  const name = modelName(ctx, SDK, propValue(getProp(fields, 'id')), call, v !== undefined && ts.isIdentifier(v.name) ? v.name.text : undefined);
  if (name === undefined) return true;
  const schemaNode = propValue(getProp(fields, 'inputSchema'));
  const exec = getProp(fields, 'execute');
  const defined_at = refOf(ctx.root, call);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(fields, 'description')), ctx.checker) ?? '',
    ...(schemaNode !== undefined && ts.isExpression(schemaNode) ? schemaOfValue(ctx.checker, schemaNode, 'inputSchema') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: SDK,
    via: `createTool() from "${pkg}"`,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const found: FoundTool = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), name, undefined), hints: hintsOf(fields) };
  if (v !== undefined) found.varId = declIdOf(v);
  ctx.facts.tools.push(found);
  return true;
}

/** `new Agent({ tools })`, `new Mastra({ tools })`, `new MCPServer({ tools })`, `new MCPClient(...)`. True when the class was Mastra's. */
export function mastraNew(ctx: ExtractContext, expr: ts.NewExpression): boolean {
  const cn = calleeExportName(ctx.checker, expr.expression);
  if (cn !== 'Agent' && cn !== 'Mastra' && cn !== 'MCPClient' && cn !== 'MCPServer') return false;
  if (mastraPackage(ctx, expr.expression) === undefined) return false;
  if (cn === 'MCPClient') {
    ctx.facts.mcpClients.push(refOf(ctx.root, expr));
    return true;
  }
  const a0 = expr.arguments?.[0];
  const opts = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (cn === 'Agent' && opts !== undefined && (getProp(opts, 'agents') !== undefined || getProp(opts, 'workflows') !== undefined)) {
    noteAt(ctx.facts, 'mastra:sub-agents', refOf(ctx.root, expr), (n, where) => `${n} Mastra agent(s) hand the model their sub-agents or workflows (the agents / workflows options of new Agent: ${where}), which Mastra turns into tools the model can call; those are not listed as tools here, and their own tools are listed where they are defined.`);
  }
  const p = opts === undefined ? undefined : getProp(opts, 'tools');
  const value = propValue(p);
  if (p === undefined || value === undefined) return true;
  const sym = ts.isShorthandPropertyAssignment(p) ? ctx.checker.getShorthandAssignmentValueSymbol(p) : undefined;
  const v = ts.isExpression(value) ? unwrap(value) : value;
  // `tools: ({ requestContext }) => ({...})`: chosen per request at runtime.
  const dynamic = ts.isArrowFunction(v) || ts.isFunctionExpression(v);
  const read = dynamic ? { isStatic: false, entries: [], names: [], reason: 'the tools are returned by a function called per request' } : exposureOfMap(ctx, value, sym);
  ctx.facts.exposures.push({
    at: refOf(ctx.root, expr),
    via: cn === 'Agent' ? 'new Agent({ tools }) from "@mastra/core"' : cn === 'MCPServer' ? 'new MCPServer({ tools }) from "@mastra/mcp" (served to MCP clients)' : 'new Mastra({ tools }) (served by the Mastra server to its clients)',
    sdk: SDK,
    ...read,
    interception: MASTRA_INTERCEPTION,
  });
  return true;
}
