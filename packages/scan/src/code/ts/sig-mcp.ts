/**
 * MCP server registration (`@modelcontextprotocol/sdk`, record §3.18): tools the
 * application SERVES to whatever model connects, `McpServer.registerTool(name,
 * { description, inputSchema, annotations }, handler)` and the deprecated
 * `.tool(name, description?, schema?, annotations?, handler)` (removed in the v2
 * SDK). The exposure is the server's `connect(transport)`, and its tools are the
 * registrations made on the same server object.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { annotationClaims, execCalls, hintsOf, literalOf, schemaOfValue, type ExtractContext } from './common.js';
import type { AuthorityClaim } from './facts.js';
import { calleeOrigin, constString, declIdOf, firstDecl, functionBody, getProp, packageMatches, propValue, refKey, refOf, resolveAlias } from './util.js';

/**
 * A method of the SDK's SERVER side: declared under its `server/` directory, or --
 * when the SDK is not installed and the checker cannot follow the receiver -- a
 * receiver whose import names that directory (`@modelcontextprotocol/sdk/server/mcp.js`)
 * or the v2 server package.
 */
function isServerMethod(ctx: ExtractContext, call: ts.CallExpression): boolean {
  const o = calleeOrigin(ctx.checker, call.expression);
  if (o === undefined || !packageMatches(o.pkg, [...packagesOf('mcp'), '@modelcontextprotocol/server'])) return false;
  return /\/server(\/|$)/.test(o.path);
}

function serverId(ctx: ExtractContext, call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const recv = call.expression.expression;
  const at = ts.isPropertyAccessExpression(recv) ? recv.name : recv;
  const s = ctx.checker.getSymbolAtLocation(at);
  const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
  return d === undefined ? undefined : declIdOf(d);
}

export function mcpCall(ctx: ExtractContext, call: ts.CallExpression, method: string): boolean {
  if (method !== 'registerTool' && method !== 'tool' && method !== 'connect' && method !== 'setRequestHandler') return false;
  if (!isServerMethod(ctx, call)) return false;
  const sid = serverId(ctx, call);
  if (method === 'setRequestHandler') {
    const a0 = call.arguments[0];
    if (a0 !== undefined && ts.isIdentifier(a0) && a0.text === 'CallToolRequestSchema') ctx.facts.mcpLowLevel.push(refOf(ctx.root, call));
    return true;
  }
  if (method === 'connect') {
    const t = call.arguments[0];
    const tname = t === undefined ? 'transport' : (ctx.checker.getTypeAtLocation(t).getSymbol()?.getName() ?? 'transport');
    const e = { at: refOf(ctx.root, call), via: `McpServer.connect(${tname})`, sdk: 'mcp', isStatic: true, entries: [], names: [] };
    ctx.facts.exposures.push(sid === undefined ? e : { ...e, serverId: sid });
    return true;
  }
  const name = constString(call.arguments[0], ctx.checker);
  if (name === undefined) {
    if (sid !== undefined) ctx.facts.mcpDynamicServers.add(sid);
    return true;
  }
  const rest = call.arguments.slice(1);
  const cb = rest[rest.length - 1];
  let description = '';
  let schema: Pick<CodeTool, 'schema_kind' | 'params'> = { schema_kind: 'unknown', params: [] };
  let hints: AuthorityClaim[] = [];
  if (method === 'registerTool') {
    const cfg = rest[0] === undefined ? undefined : literalOf(rest[0], ctx.checker);
    if (cfg !== undefined) {
      description = constString(propValue(getProp(cfg, 'description')), ctx.checker) ?? '';
      const is = propValue(getProp(cfg, 'inputSchema'));
      if (is !== undefined && ts.isExpression(is)) schema = schemaOfValue(ctx.checker, is, 'inputSchema');
      hints = hintsOf(cfg);
    }
  } else {
    const middle = rest.slice(0, -1);
    const d = middle[0] === undefined ? undefined : constString(middle[0], ctx.checker);
    if (d !== undefined) description = d;
    const shape = middle.find((a) => ts.isObjectLiteralExpression(a) || (ts.isIdentifier(a) && literalOf(a, ctx.checker) !== undefined));
    if (shape !== undefined) schema = schemaOfValue(ctx.checker, shape, 'inputSchema');
    const objects = middle.filter((a): a is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(a));
    const annotations = objects.length > 1 ? objects[objects.length - 1] : undefined;
    if (annotations !== undefined) hints = annotationClaims(annotations);
  }
  const defined_at = refOf(ctx.root, call);
  const tool: CodeTool = {
    name,
    description,
    ...schema,
    sdk: 'mcp',
    via: method === 'registerTool' ? 'registerTool() on McpServer (served to MCP clients)' : 'tool() on McpServer (deprecated; served to MCP clients)',
    defined_at,
  };
  if (cb !== undefined) tool.execute_at = refOf(ctx.root, cb);
  const found = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(cb, ctx.checker), name, undefined), hints };
  ctx.facts.tools.push(sid === undefined ? found : { ...found, serverId: sid });
  return true;
}
