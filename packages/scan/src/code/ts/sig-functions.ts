/**
 * The function-tool object family (record §3.4, §3.7, §3.8): one JSON shape,
 * three native SDKs, three ids.
 *
 *   nested (Chat Completions, Mistral, Cohere v2): { type: 'function', function: { name, description?, parameters? } }
 *   flat (OpenAI Responses):                       { type: 'function', name, description?, parameters }
 *   Cohere v1:                                     { name, description?, parameterDefinitions }
 *
 * The SHAPE never decides the id -- it is the same object in all three. What
 * decides is the package that types the literal (its contextual type), or the
 * package of the call it is handed to. A literal nothing types and no known call
 * receives is not claimed: an OpenAI-shaped object in an untyped file could be
 * for any of a dozen compatible endpoints.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { entryForPackage } from '../sdks.js';
import { arrayEntries, execCalls, hintsOf, literalOf, modelName, schemaOf, schemaOfValue, typeConstituents, type ExtractContext } from './common.js';
import type { FoundExposure } from './facts.js';
import { calleeName, dottedName, firstDecl, functionBody, getProp, propValue, propertyNameText, refKey, refOf, resolveAlias, stringValue, calleePackage, calleeSymbol, unwrap, declIdOf, packageOfFile, constString } from './util.js';

type FamilyId = 'openai' | 'mistral' | 'cohere';

/** Per id, the calls that take a `tools` list, matched on the callee's dotted spelling AND its declaring package. */
const CALLS: Record<FamilyId, RegExp> = {
  openai: /(^|\.)(chat\.completions\.(create|stream|parse|runTools)|responses\.(create|stream|parse))$/,
  mistral: /((^|\.)(chat|agents)\.(complete|stream)|^(chatComplete|chatStream|agentsComplete|agentsStream))$/,
  cohere: /(^|\.)(v2\.)?(chat|chatStream)$/,
};

const HELPERS = new Set(['zodFunction', 'zodResponsesFunction']);

function familyOfPackage(pkg: string | undefined): FamilyId | undefined {
  if (pkg === undefined) return undefined;
  const id = entryForPackage(pkg)?.id;
  return id === 'openai' || id === 'mistral' || id === 'cohere' ? id : undefined;
}

function familyOfType(t: ts.Type | undefined): FamilyId | undefined {
  if (t === undefined) return undefined;
  for (const c of typeConstituents(t)) {
    for (const s of [c.aliasSymbol, c.getSymbol()]) {
      const d = firstDecl(s);
      const f = d === undefined ? undefined : familyOfPackage(packageOfFile(d.getSourceFile().fileName));
      if (f !== undefined) return f;
    }
  }
  return undefined;
}

/** The literal's name and where its schema and execute member live, for any of the three shapes. */
function shapeOf(obj: ts.ObjectLiteralExpression): { name: string; inner: ts.ObjectLiteralExpression; shape: 'nested' | 'flat' | 'v1' } | undefined {
  const type = stringValue(propValue(getProp(obj, 'type')));
  const fn = propValue(getProp(obj, 'function'));
  if (fn !== undefined && ts.isObjectLiteralExpression(fn) && (type === undefined || type === 'function')) {
    const name = stringValue(propValue(getProp(fn, 'name')));
    return name === undefined ? undefined : { name, inner: fn, shape: 'nested' };
  }
  const name = stringValue(propValue(getProp(obj, 'name')));
  if (name === undefined) return undefined;
  if (type === 'function') return { name, inner: obj, shape: 'flat' };
  if (getProp(obj, 'parameterDefinitions') !== undefined) return { name, inner: obj, shape: 'v1' };
  return undefined;
}

export function literalFunctionName(o: ts.ObjectLiteralExpression): string | undefined {
  return shapeOf(o)?.name;
}

/** The call a literal is an element of, as `tools: [ ... ]` (or openai's deprecated `functions: [ ... ]`). */
function enclosingToolsCall(obj: ts.Node): ts.CallExpression | undefined {
  const arr = obj.parent;
  if (arr === undefined || !ts.isArrayLiteralExpression(arr)) return undefined;
  const pa = arr.parent;
  if (pa === undefined || !ts.isPropertyAssignment(pa)) return undefined;
  const key = propertyNameText(pa.name);
  if (key !== 'tools' && key !== 'functions') return undefined;
  const call = pa.parent.parent;
  return call !== undefined && ts.isCallExpression(call) ? call : undefined;
}

function callFamily(ctx: ExtractContext, call: ts.CallExpression): FamilyId | undefined {
  const dn = dottedName(call.expression) ?? calleeName(call.expression);
  if (dn === undefined || !Object.values(CALLS).some((re) => re.test(dn))) return undefined;
  const fam = familyOfPackage(calleePackage(ctx.checker, call.expression));
  return fam !== undefined && CALLS[fam].test(dn) ? fam : undefined;
}

/**
 * The member path a reader recognises, receiver dropped: `client.chat.completions.create`
 * -> `chat.completions.create`, `co.v2.chat` -> `v2.chat`, but a client merely NAMED
 * `v2` -> `chat`. Spelled from property accesses only, so a variable's name never
 * leaks into the label.
 */
function tail(call: ts.CallExpression, _fam: FamilyId): string {
  const names: string[] = [];
  let e: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(e)) {
    names.unshift(e.name.text);
    e = e.expression;
  }
  if (names.length === 0) return calleeName(call.expression) ?? 'call';
  // `this.client.chat...`: the first name is the client field, not an API member.
  if (e.kind === ts.SyntaxKind.ThisKeyword && names.length > 1) names.shift();
  return names.join('.');
}

/**
 * A call's label: the member path, and which client it is where that matters --
 * `CohereClientV2.chat` against the v1 `CohereClient.chat`, and an OpenAI client
 * pointed at Azure or at a compatible endpoint.
 */
function label(ctx: ExtractContext, call: ts.CallExpression, fam: FamilyId, args = ''): string {
  if (fam === 'cohere' && ts.isPropertyAccessExpression(call.expression)) {
    const cls = receiverClass(ctx, call.expression.expression);
    return `${cls !== undefined && cls !== '__type' ? `${cls}.` : ''}${tail(call, fam)}${args}`;
  }
  return `${tail(call, fam)}${args}${fam === 'openai' ? openaiFlavour(ctx, call) : ''}`;
}

/** The class a client was constructed from as the code spells it (`new CohereClient(...)`), else its type's name. */
function receiverClass(ctx: ExtractContext, recv: ts.Expression): string | undefined {
  const at = ts.isPropertyAccessExpression(recv) ? recv.name : recv;
  const s = ctx.checker.getSymbolAtLocation(at);
  const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
  if (d !== undefined && (ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d))) {
    const init = d.initializer === undefined ? undefined : unwrap(d.initializer);
    if (init !== undefined && ts.isNewExpression(init)) return calleeName(init.expression);
    if (d.type !== undefined && ts.isTypeReferenceNode(d.type)) return d.type.typeName.getText();
  }
  return ctx.checker.getTypeAtLocation(recv).getSymbol()?.getName();
}

/**
 * `new OpenAI({ baseURL })` is an OpenAI-compatible endpoint and `new AzureOpenAI(...)`
 * is Azure; both stay under id `openai` and say which in `via`.
 */
function openaiFlavour(ctx: ExtractContext, call: ts.CallExpression): string {
  let e: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(e)) e = e.expression;
  const target = ts.isIdentifier(e) ? e : undefined;
  if (target === undefined) return '';
  const s = ctx.checker.getSymbolAtLocation(target);
  const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
  const init = d !== undefined && (ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d)) && d.initializer !== undefined ? unwrap(d.initializer) : undefined;
  if (init === undefined || !ts.isNewExpression(init)) return '';
  if (calleeName(init.expression) === 'AzureOpenAI') return ' (Azure OpenAI)';
  const a0 = init.arguments?.[0];
  return a0 !== undefined && ts.isObjectLiteralExpression(a0) && getProp(a0, 'baseURL') !== undefined ? ' (OpenAI-compatible endpoint)' : '';
}

function pushTool(ctx: ExtractContext, obj: ts.ObjectLiteralExpression, fam: FamilyId, via: string): void {
  const s = shapeOf(obj);
  if (s === undefined) return;
  const defined_at = refOf(ctx.root, obj);
  const exec = getProp(s.inner, 'function') !== undefined && s.shape === 'nested' ? getProp(s.inner, 'function') : undefined;
  const tool: CodeTool = {
    name: s.name,
    description: constString(propValue(getProp(s.inner, 'description')), ctx.checker) ?? '',
    ...schemaOf(ctx.checker, s.inner),
    sdk: fam,
    via,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const p = obj.parent;
  const found = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), s.name, undefined), hints: hintsOf(s.inner) };
  ctx.facts.tools.push(p !== undefined && ts.isVariableDeclaration(p) ? { ...found, varId: declIdOf(p) } : found);
}

/** A function-tool literal anywhere: claimed when its contextual type or the call it is handed to names the SDK. */
export function functionToolLiteral(ctx: ExtractContext, obj: ts.ObjectLiteralExpression): void {
  if (shapeOf(obj) === undefined) return;
  // The inner `function: { name, ... }` of a nested literal is the outer one's, not a second tool.
  if (obj.parent !== undefined && ts.isPropertyAssignment(obj.parent) && propertyNameText(obj.parent.name) === 'function') return;
  const call = enclosingToolsCall(obj);
  const fromCall = call === undefined ? undefined : callFamily(ctx, call);
  if (fromCall !== undefined && call !== undefined) {
    pushTool(ctx, obj, fromCall, `tools[] on ${label(ctx, call, fromCall)}`);
    return;
  }
  const fam = familyOfType(ctx.checker.getContextualType(obj));
  if (fam !== undefined) pushTool(ctx, obj, fam, `function tool object typed from "${fam === 'openai' ? 'openai' : fam === 'mistral' ? '@mistralai/mistralai' : 'cohere-ai'}"`);
}

/** `zodFunction({ name, parameters, function })` / `zodResponsesFunction(...)` from `openai/helpers/zod`. */
export function openaiHelper(ctx: ExtractContext, call: ts.CallExpression): boolean {
  const cn = calleeName(call.expression);
  if (cn === undefined || !HELPERS.has(cn)) return false;
  if (familyOfPackage(calleePackage(ctx.checker, call.expression)) !== 'openai') return false;
  const arg = call.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return true;
  const fnNode = propValue(getProp(arg, 'function'));
  const name = modelName(ctx, 'openai', propValue(getProp(arg, 'name')), call, fnNode !== undefined && ts.isIdentifier(fnNode) ? fnNode.text : undefined);
  if (name === undefined) return true;
  const defined_at = refOf(ctx.root, call);
  const exec = getProp(arg, 'function');
  const params = propValue(getProp(arg, 'parameters'));
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(arg, 'description')), ctx.checker) ?? '',
    ...(params !== undefined && ts.isExpression(params) ? schemaOfValue(ctx.checker, params, 'parameters') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: 'openai',
    via: `${cn}() from "openai/helpers/zod"`,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const found = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), name, undefined), hints: hintsOf(arg) };
  const p = call.parent;
  ctx.facts.tools.push(p !== undefined && ts.isVariableDeclaration(p) ? { ...found, varId: declIdOf(p) } : found);
  return true;
}

/** A call of one of the three SDKs that hands a `tools` list to a model. Returns true when it was one. */
export function functionToolsCall(ctx: ExtractContext, call: ts.CallExpression): boolean {
  const fam = callFamily(ctx, call);
  if (fam === undefined) return false;
  const arg = call.arguments.find((a): a is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(a) && (getProp(a, 'tools') !== undefined || getProp(a, 'functions') !== undefined));
  if (arg === undefined) return true;
  const p = getProp(arg, 'tools') ?? getProp(arg, 'functions');
  const value = propValue(p);
  if (p === undefined || value === undefined) return true;
  const via = label(ctx, call, fam, '({ tools })');
  const e: FoundExposure = { at: refOf(ctx.root, call), via, sdk: fam, isStatic: false, entries: [], names: [] };
  const v = ts.isExpression(value) ? unwrap(value) : value;
  if (ts.isArrayLiteralExpression(v)) {
    const r = arrayEntries(ctx, v, literalFunctionName);
    Object.assign(e, r);
    if (!r.isStatic) e.reason = 'an element of the list is not a literal tool';
  } else {
    e.reason = 'the list is a value, not a literal';
    const sym = ts.isShorthandPropertyAssignment(p) ? ctx.checker.getShorthandAssignmentValueSymbol(p) : ts.isExpression(v) ? ctx.checker.getSymbolAtLocation(v) : undefined;
    const d = sym === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, sym));
    if (d !== undefined) e.valueTargetId = declIdOf(d);
    // `const tools = [ ... ]` passed by name: the literals are this SDK's tools, and the names are readable.
    const init = d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined ? unwrap(d.initializer) : undefined;
    if (init !== undefined && ts.isArrayLiteralExpression(init)) {
      for (const el of init.elements) {
        const o = literalOf(el, ctx.checker);
        if (o !== undefined && ctx.checker.getContextualType(o) === undefined) pushTool(ctx, o, fam, `tools[] passed to ${label(ctx, call, fam)}`);
      }
      const r = arrayEntries(ctx, init, literalFunctionName);
      e.names = r.names;
      e.entries = r.entries;
    }
  }
  ctx.facts.exposures.push(e);
  return true;
}
