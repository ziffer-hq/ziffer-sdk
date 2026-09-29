/**
 * LangChain JS (record §3.10): `tool(fn, { name, description, schema })` from
 * `@langchain/core/tools` or `langchain`, `new DynamicStructuredTool({ name,
 * description, schema, func })` / `new DynamicTool(...)`; exposed through a chat
 * model's `bindTools([...])`, `createAgent({ tools })`, `createReactAgent({ tools })`
 * and `new ToolNode([...])`. A class extending `Tool`, `StructuredTool` or
 * `DynamicStructuredTool` whose `name` member is a literal is a tool too, its
 * `_call` the execute body. The tool name is the `name` field, never the variable.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { arrayEntries, execCalls, hintsOf, literalOf, modelName, schemaOfValue, type ExtractContext } from './common.js';
import type { FoundExposure } from './facts.js';
import { calleeExportName, calleePackage, calleeSymbol, constString, declIdOf, firstDecl, functionBody, getProp, packageMatches, propValue, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

const CLASSES = new Set(['DynamicStructuredTool', 'DynamicTool']);
const AGENT_FNS = new Set(['createAgent', 'createReactAgent']);

function lcPackage(ctx: ExtractContext, callee: ts.Expression): string | undefined {
  const pkg = calleePackage(ctx.checker, callee);
  return packageMatches(pkg, packagesOf('langchain')) || packageMatches(pkg, ['@langchain/*']) ? pkg : undefined;
}

function pushTool(ctx: ExtractContext, node: ts.Expression, fields: ts.ObjectLiteralExpression, exec: ts.Node | undefined, via: string): void {
  const name = modelName(ctx, 'langchain', propValue(getProp(fields, 'name')), node, exec !== undefined && ts.isIdentifier(exec) ? exec.text : undefined);
  if (name === undefined) return;
  const schemaNode = propValue(getProp(fields, 'schema'));
  const defined_at = refOf(ctx.root, node);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(fields, 'description')), ctx.checker) ?? '',
    ...(schemaNode !== undefined && ts.isExpression(schemaNode) ? schemaOfValue(ctx.checker, schemaNode, 'schema') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: 'langchain',
    via,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const p = node.parent;
  const found = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(exec, ctx.checker), name, undefined), hints: hintsOf(fields) };
  ctx.facts.tools.push(p !== undefined && ts.isVariableDeclaration(p) ? { ...found, varId: declIdOf(p) } : found);
}

function arrayExposure(ctx: ExtractContext, node: ts.Expression, value: ts.Node | undefined, via: string): void {
  if (value === undefined || !ts.isExpression(value)) return;
  const e: FoundExposure = { at: refOf(ctx.root, node), via, sdk: 'langchain', isStatic: false, entries: [], names: [] };
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

export function langchainCall(ctx: ExtractContext, call: ts.CallExpression, name: string): boolean {
  if (name !== 'tool' && name !== 'bindTools' && !AGENT_FNS.has(name)) return false;
  const pkg = lcPackage(ctx, call.expression);
  if (pkg === undefined) return false;
  if (name === 'tool') {
    const fields = call.arguments[1] === undefined ? undefined : literalOf(call.arguments[1], ctx.checker);
    if (fields !== undefined) pushTool(ctx, call, fields, call.arguments[0], `tool() from "${pkg}"`);
  } else if (name === 'bindTools') {
    arrayExposure(ctx, call, call.arguments[0], 'bindTools([ ... ])');
  } else {
    const a0 = call.arguments[0];
    const opts = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
    if (opts !== undefined) arrayExposure(ctx, call, propValue(getProp(opts, 'tools')), `${name}({ tools })`);
  }
  return true;
}

export function langchainNew(ctx: ExtractContext, expr: ts.NewExpression): boolean {
  const cn = calleeExportName(ctx.checker, expr.expression);
  if (cn === undefined || (!CLASSES.has(cn) && cn !== 'ToolNode')) return false;
  const pkg = lcPackage(ctx, expr.expression);
  if (pkg === undefined) return false;
  const a0 = expr.arguments?.[0];
  if (cn === 'ToolNode') {
    arrayExposure(ctx, expr, a0, 'new ToolNode([ ... ])');
    return true;
  }
  const fields = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (fields !== undefined) pushTool(ctx, expr, fields, propValue(getProp(fields, 'func')), `new ${cn}() from "${pkg}"`);
  return true;
}

const BASE_CLASSES = new Set(['Tool', 'StructuredTool', 'DynamicTool', 'DynamicStructuredTool']);

function memberInit(cls: ts.ClassLikeDeclaration, name: string): ts.Expression | undefined {
  for (const m of cls.members) {
    if (ts.isPropertyDeclaration(m) && !m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword) && ts.isIdentifier(m.name) && m.name.text === name) return m.initializer;
    if (ts.isGetAccessor(m) && ts.isIdentifier(m.name) && m.name.text === name && m.body !== undefined) {
      const ret = m.body.statements.find(ts.isReturnStatement);
      return ret?.expression;
    }
  }
  return undefined;
}

/** `class Calculator extends StructuredTool { name = 'calculator'; description = ...; schema = z.object(...); async _call(...) }`. */
export function langchainClass(ctx: ExtractContext, cls: ts.ClassLikeDeclaration): void {
  const ext = cls.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
  if (ext === undefined) return;
  const base = ext.expression;
  const baseName = ts.isIdentifier(base) ? base.text : ts.isPropertyAccessExpression(base) ? base.name.text : undefined;
  if (baseName === undefined || !BASE_CLASSES.has(baseName)) return;
  const pkg = lcPackage(ctx, base);
  if (pkg === undefined) return;
  const name = modelName(ctx, 'langchain', memberInit(cls, 'name'), cls, cls.name?.text);
  if (name === undefined) return;
  const schemaNode = memberInit(cls, 'schema');
  const exec = cls.members.find((m) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === '_call');
  const at = cls.name ?? cls;
  const defined_at = refOf(ctx.root, at);
  const tool: CodeTool = {
    name,
    description: constString(memberInit(cls, 'description'), ctx.checker) ?? '',
    ...(schemaNode !== undefined ? schemaOfValue(ctx.checker, schemaNode, 'schema') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: 'langchain',
    via: `class extending ${baseName} from "${pkg}"`,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  ctx.facts.tools.push({ tool, key: refKey(defined_at), calls: execCalls(ctx, exec === undefined ? undefined : functionBody(exec), name, undefined), hints: [] });
}
