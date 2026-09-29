/**
 * Google Gen AI SDK (`@google/genai`, record §3.6): a FunctionDeclaration
 * `{ name, description?, parameters | parametersJsonSchema }` inside
 * `config.tools: [{ functionDeclarations: [...] }]` on `models.generateContent`,
 * `generateContentStream`, `chats.create`, a chat's `sendMessage*`, `live.connect`.
 * A tools entry that is not `functionDeclarations` (googleSearch, codeExecution,
 * urlContext, ...) is a provider-executed tool: counted for the honesty line,
 * never listed as the application's.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { arrayEntries, hintsOf, literalOf, modelName, schemaOf, typeConstituents, type ExtractContext } from './common.js';
import type { FoundExposure } from './facts.js';
import { calleeSymbol, constString, packageOfFile, declIdOf, dottedName, firstDecl, getProp, packageMatches, propValue, propertyNameText, refKey, refOf, resolveAlias, stringValue, calleePackage, unwrap } from './util.js';

const CALL_RE = /(^|\.)(models\.(generateContent|generateContentStream)|chats\.create|sendMessage|sendMessageStream|live\.connect)$/;

function isDeclarationType(t: ts.Type | undefined): boolean {
  if (t === undefined) return false;
  return typeConstituents(t).some((c) => {
    const s = c.aliasSymbol ?? c.getSymbol();
    const d = firstDecl(s);
    return s?.getName() === 'FunctionDeclaration' && d !== undefined && packageMatches(packageOfFile(d.getSourceFile().fileName), packagesOf('gemini'));
  });
}

function inFunctionDeclarations(obj: ts.Node): boolean {
  const arr = obj.parent;
  return arr !== undefined && ts.isArrayLiteralExpression(arr) && arr.parent !== undefined && ts.isPropertyAssignment(arr.parent) && propertyNameText(arr.parent.name) === 'functionDeclarations';
}

export function geminiName(o: ts.ObjectLiteralExpression): string | undefined {
  return stringValue(propValue(getProp(o, 'name')));
}

export function geminiLiteral(ctx: ExtractContext, obj: ts.ObjectLiteralExpression): void {
  const inArray = inFunctionDeclarations(obj);
  if (!inArray && !isDeclarationType(ctx.checker.getContextualType(obj))) return;
  // Inside functionDeclarations with no type at all (plain JS), only claim it when the file reaches the SDK.
  if (inArray && !isDeclarationType(ctx.checker.getContextualType(obj)) && getProp(obj, 'parameters') === undefined && getProp(obj, 'parametersJsonSchema') === undefined && getProp(obj, 'description') === undefined) return;
  const name = modelName(ctx, 'gemini', propValue(getProp(obj, 'name')), obj);
  if (name === undefined) return;
  const defined_at = refOf(ctx.root, obj);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(obj, 'description')), ctx.checker) ?? '',
    ...schemaOf(ctx.checker, obj),
    sdk: 'gemini',
    via: inArray ? 'functionDeclarations[] for "@google/genai"' : 'FunctionDeclaration from "@google/genai"',
    defined_at,
  };
  const p = obj.parent;
  const found = { tool, key: refKey(defined_at), calls: [], hints: hintsOf(obj) };
  ctx.facts.tools.push(p !== undefined && ts.isVariableDeclaration(p) ? { ...found, varId: declIdOf(p) } : found);
}

export function geminiCall(ctx: ExtractContext, call: ts.CallExpression): boolean {
  const dn = dottedName(call.expression);
  if (dn === undefined || !CALL_RE.test(dn)) return false;
  if (!packageMatches(calleePackage(ctx.checker, call.expression), packagesOf('gemini'))) return false;
  const arg = call.arguments[0];
  const config = arg !== undefined && ts.isObjectLiteralExpression(arg) ? literalOf(propValue(getProp(arg, 'config')) ?? arg, ctx.checker) : undefined;
  const tp = config === undefined ? undefined : getProp(config, 'tools');
  const value = propValue(tp);
  if (value === undefined || !ts.isExpression(value)) return true;
  const parts = dn.split('.');
  const e: FoundExposure = { at: refOf(ctx.root, call), via: `${parts.slice(-2).join('.')}({ config: { tools } })`, sdk: 'gemini', isStatic: true, entries: [], names: [] };
  const v = unwrap(value);
  if (!ts.isArrayLiteralExpression(v)) {
    e.isStatic = false;
    e.reason = 'the tools list is a value, not a literal';
    const s = ctx.checker.getSymbolAtLocation(v);
    const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
    if (d !== undefined) e.valueTargetId = declIdOf(d);
  } else {
    for (const el of v.elements) {
      const o = literalOf(el, ctx.checker);
      const fd = o === undefined ? undefined : propValue(getProp(o, 'functionDeclarations'));
      if (o === undefined) {
        e.isStatic = false;
        e.reason = 'an entry of the tools list is not a literal';
        continue;
      }
      if (fd === undefined) {
        // googleSearch, codeExecution, urlContext, fileSearch...: the provider runs these.
        const key = o.properties.map((p) => (ts.isSpreadAssignment(p) ? undefined : propertyNameText(p.name))).find((k) => k !== undefined);
        ctx.facts.providerTools.push({ at: refOf(ctx.root, o), text: `@google/genai ${key ?? 'tool'}` });
        continue;
      }
      if (!ts.isExpression(fd) || !ts.isArrayLiteralExpression(unwrap(fd))) {
        e.isStatic = false;
        e.reason = 'functionDeclarations is a value, not a literal';
        continue;
      }
      const arr = unwrap(fd);
      if (!ts.isArrayLiteralExpression(arr)) continue;
      const r = arrayEntries(ctx, arr, geminiName);
      e.names.push(...r.names);
      e.entries.push(...r.entries);
      if (!r.isStatic) {
        e.isStatic = false;
        e.reason = 'a function declaration is not a literal';
      }
    }
  }
  ctx.facts.exposures.push(e);
  return true;
}
