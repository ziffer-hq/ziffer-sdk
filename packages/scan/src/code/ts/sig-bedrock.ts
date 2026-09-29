/**
 * Amazon Bedrock Converse (`@aws-sdk/client-bedrock-runtime`; record §3.9). A tool
 * is `{ toolSpec: { name, description, inputSchema: { json: {...} } } }` -- the
 * `inputSchema.json` double wrap is the distinctive part -- inside `toolConfig: {
 * tools: [...] }`, handed to `new ConverseCommand({...})` / `ConverseStreamCommand`
 * (sent with `client.send`) or to the aggregated client's `converse` /
 * `converseStream`. The SDK returns the model's `toolUse` blocks and runs nothing:
 * the application dispatches (K4). A `toolConfig` imported from a JSON file (the AWS
 * examples do this) is read from that file. Bedrock Agents action groups and
 * AgentCore gateways are configured in the service, not in this source.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { arrayEntries, jsonSchemaParams, literalOf, modelName, noteAt, typeFromPackages, type ExtractContext } from './common.js';
import type { FoundExposure, FoundTool } from './facts.js';
import { calleeExportName, calleePackage, constString, declIdOf, firstDecl, getProp, packageMatches, packageOfSpecifier, propValue, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

const SDK = 'bedrock';
const COMMANDS = new Set(['ConverseCommand', 'ConverseStreamCommand']);
const METHODS = new Set(['converse', 'converseStream']);
const INVOKE_COMMANDS = new Set(['InvokeModelCommand', 'InvokeModelWithResponseStreamCommand']);
const INVOKE_METHODS = new Set(['invokeModel', 'invokeModelWithResponseStream']);

/**
 * Two honesty lines, said only where the tree calls Bedrock (record §6 items 4 and 5):
 * what the service configures out of this code, and an InvokeModel body not read.
 */
function serviceLine(ctx: ExtractContext, at: ts.Node): void {
  noteAt(ctx.facts, 'bedrock:service', refOf(ctx.root, at), (_n, where) => `Amazon Bedrock is called in this code (${where}): tools a Bedrock Agents action group or an AgentCore gateway gives a model are configured in the AWS service and run by it, not written in this code, so they are not listed here.`);
}

function invokeLine(ctx: ExtractContext, at: ts.Node): void {
  serviceLine(ctx, at);
  noteAt(ctx.facts, 'bedrock:invoke-model', refOf(ctx.root, at), (n, where) => `${n} Bedrock InvokeModel call(s) (${where}) send a request body in the model provider's own format; a tools list inside it (an Anthropic Messages body) is not read as an exposure, so the tools such a call offers a model are not listed.`);
}
export const BEDROCK_INTERCEPTION = 'Bedrock Converse returns the model\'s toolUse blocks and runs nothing: the application\'s own dispatcher, where it answers a toolUse, is where a check stands (K4).';

function isSdk(ctx: ExtractContext, callee: ts.Expression): boolean {
  return packageMatches(calleePackage(ctx.checker, callee), packagesOf(SDK));
}

function fileImportsSdk(sf: ts.SourceFile): boolean {
  return sf.statements.some((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && packageMatches(packageOfSpecifier(st.moduleSpecifier.text), packagesOf(SDK)));
}

/** The `toolSpec` literal of a Tool object, when it carries the `inputSchema.json` wrap. */
function specOf(obj: ts.ObjectLiteralExpression, checker?: ts.TypeChecker): ts.ObjectLiteralExpression | undefined {
  const specNode = propValue(getProp(obj, 'toolSpec'));
  const spec = specNode === undefined ? undefined : checker === undefined ? (ts.isObjectLiteralExpression(specNode) ? specNode : undefined) : literalOf(specNode, checker);
  if (spec === undefined) return undefined;
  const is = propValue(getProp(spec, 'inputSchema'));
  return is !== undefined && ts.isObjectLiteralExpression(is) && getProp(is, 'json') !== undefined ? spec : undefined;
}

function toolOf(ctx: Pick<ExtractContext, 'root'>, obj: ts.ObjectLiteralExpression, spec: ts.ObjectLiteralExpression, name: string, via: string, checker?: ts.TypeChecker): FoundTool {
  const is = propValue(getProp(spec, 'inputSchema'));
  const json = is !== undefined && ts.isObjectLiteralExpression(is) ? propValue(getProp(is, 'json')) : undefined;
  const params = jsonSchemaParams(json, checker);
  const defined_at = refOf(ctx.root, obj);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(spec, 'description')), checker) ?? '',
    schema_kind: params !== undefined ? 'json_schema' : 'unknown',
    params: params ?? [],
    sdk: SDK,
    via,
    defined_at,
  };
  return { tool, key: refKey(defined_at), calls: [], hints: [] };
}

/** Where a Tool object sits: in the `tools` of a `toolConfig` given to a Converse call, or anywhere. */
function converseCallOf(obj: ts.ObjectLiteralExpression): ts.CallExpression | ts.NewExpression | undefined {
  const arr = obj.parent;
  if (arr === undefined || !ts.isArrayLiteralExpression(arr)) return undefined;
  const tools = arr.parent;
  if (tools === undefined || !ts.isPropertyAssignment(tools)) return undefined;
  const cfg = tools.parent.parent;
  if (cfg === undefined || !ts.isPropertyAssignment(cfg)) return undefined;
  const call = cfg.parent.parent;
  return call !== undefined && (ts.isCallExpression(call) || ts.isNewExpression(call)) ? call : undefined;
}

/** `{ toolSpec: { name, inputSchema: { json } } }`: typed by the SDK, inside a Converse call, or in a file that imports the SDK. */
export function bedrockLiteral(ctx: ExtractContext, obj: ts.ObjectLiteralExpression): void {
  const spec = specOf(obj, ctx.checker);
  if (spec === undefined) return;
  const name = modelName(ctx, 'bedrock', propValue(getProp(spec, 'name')), obj);
  if (name === undefined) return;
  const call = converseCallOf(obj);
  const inCall = call !== undefined && isSdk(ctx, call.expression);
  const ctxType = ctx.checker.getContextualType(obj);
  const typed = ctxType !== undefined && typeFromPackages(ctxType, packagesOf(SDK)) !== undefined;
  if (!inCall && !typed && !fileImportsSdk(obj.getSourceFile())) return;
  const found = toolOf(ctx, obj, spec, name, 'toolSpec in toolConfig.tools for "@aws-sdk/client-bedrock-runtime" Converse', ctx.checker);
  const p = obj.parent;
  if (p !== undefined && ts.isVariableDeclaration(p)) found.varId = declIdOf(p);
  ctx.facts.tools.push(found);
}

/** Follow identifiers (`const tools_config = toolConfig`) to a default import of a relative `.json` file. */
function jsonImportOf(ctx: ExtractContext, e: ts.Expression, depth = 0): string | undefined {
  if (depth > 4 || !ts.isIdentifier(e)) return undefined;
  const s = ctx.checker.getSymbolAtLocation(e);
  const d = firstDecl(s);
  if (d === undefined) return undefined;
  if (ts.isImportClause(d) && ts.isStringLiteral(d.parent.moduleSpecifier)) {
    const spec = d.parent.moduleSpecifier.text;
    return spec.startsWith('.') && spec.endsWith('.json') ? resolve(dirname(d.getSourceFile().fileName), spec) : undefined;
  }
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined) return jsonImportOf(ctx, unwrap(d.initializer), depth + 1);
  return undefined;
}

/** The tools of a `toolConfig` JSON file, read from its syntax tree so each has its line. */
function toolsFromJson(ctx: ExtractContext, file: string): string[] | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
  const st = sf.statements[0];
  const top = st !== undefined && ts.isExpressionStatement(st) && ts.isObjectLiteralExpression(st.expression) ? st.expression : undefined;
  const list = top === undefined ? undefined : propValue(getProp(top, 'tools'));
  if (list === undefined || !ts.isArrayLiteralExpression(list)) return undefined;
  const names: string[] = [];
  for (const el of list.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const spec = specOf(el);
    const name = spec === undefined ? undefined : stringValue(propValue(getProp(spec, 'name')));
    if (spec === undefined || name === undefined) continue;
    const found = toolOf(ctx, el, spec, name, 'toolSpec in a toolConfig JSON file imported for "@aws-sdk/client-bedrock-runtime" Converse');
    if (!ctx.facts.tools.some((t) => t.key === found.key)) ctx.facts.tools.push(found);
    names.push(name);
  }
  return names;
}

function converseExposure(ctx: ExtractContext, call: ts.CallExpression | ts.NewExpression, via: string): void {
  const a0 = call.arguments?.[0];
  const input = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (input === undefined) return;
  const cfgNode = propValue(getProp(input, 'toolConfig'));
  if (cfgNode === undefined || !ts.isExpression(cfgNode)) return;
  const e: FoundExposure = { at: refOf(ctx.root, call), via, sdk: SDK, isStatic: false, entries: [], names: [], interception: BEDROCK_INTERCEPTION };
  const jsonFile = jsonImportOf(ctx, unwrap(cfgNode));
  const fromJson = jsonFile === undefined ? undefined : toolsFromJson(ctx, jsonFile);
  const cfg = literalOf(cfgNode, ctx.checker);
  const toolsNode = cfg === undefined ? undefined : propValue(getProp(cfg, 'tools'));
  const tools = toolsNode !== undefined && ts.isExpression(toolsNode) ? unwrap(toolsNode) : undefined;
  if (fromJson !== undefined) {
    e.isStatic = true;
    e.names = fromJson;
  } else if (tools !== undefined && ts.isArrayLiteralExpression(tools)) {
    Object.assign(e, arrayEntries(ctx, tools, (o) => {
      const spec = specOf(o, ctx.checker);
      return spec === undefined ? undefined : constString(propValue(getProp(spec, 'name')), ctx.checker);
    }));
    if (!e.isStatic) e.reason = 'an element of the list is not a tool the scan can name';
  } else {
    e.reason = cfg === undefined ? 'the toolConfig is a value, not a literal' : 'the list is a value, not a literal';
    const target = tools ?? unwrap(cfgNode);
    const s = ctx.checker.getSymbolAtLocation(target);
    const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
    if (d !== undefined) e.valueTargetId = declIdOf(d);
  }
  ctx.facts.exposures.push(e);
}

/** `new ConverseCommand({ toolConfig })` / `ConverseStreamCommand`. True when the class was the SDK's. */
export function bedrockNew(ctx: ExtractContext, expr: ts.NewExpression): boolean {
  const cn = calleeExportName(ctx.checker, expr.expression);
  if (cn !== undefined && INVOKE_COMMANDS.has(cn) && isSdk(ctx, expr.expression)) {
    invokeLine(ctx, expr);
    return true;
  }
  if (cn === undefined || !COMMANDS.has(cn) || !isSdk(ctx, expr.expression)) return false;
  serviceLine(ctx, expr);
  converseExposure(ctx, expr, `new ${cn}({ toolConfig })`);
  return true;
}

/** `client.converse({ toolConfig })` / `converseStream` on the aggregated client. True when the method was the SDK's. */
export function bedrockCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (INVOKE_METHODS.has(cn) && isSdk(ctx, call.expression)) {
    invokeLine(ctx, call);
    return true;
  }
  if (!METHODS.has(cn) || !isSdk(ctx, call.expression)) return false;
  serviceLine(ctx, call);
  converseExposure(ctx, call, `${cn}({ toolConfig })`);
  return true;
}
