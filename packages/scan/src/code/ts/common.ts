/**
 * Readers every signature shares: what a type is and where it is declared, a
 * definition literal's schema and parameters, and the calls an execute body makes.
 */

import ts from 'typescript';

import type { CodeTool, SourceRef } from '../types.js';
import { loadCodeNames } from '../sdks.js';
import type { AuthorityClaim, ExecCall, ExposureEntry, Facts, FoundExposure, FunctionInfo, NoteKind } from './facts.js';
import {
  calleeName,
  calleeSymbol,
  collect,
  constString,
  declIdOf,
  exprOrigin,
  firstDecl,
  functionName,
  getProp,
  isTreeSource,
  packageMatches,
  packageOfFile,
  parameterList,
  propValue,
  propertyNameText,
  refKey,
  refOf,
  resolveAlias,
  stringValue,
  unwrap,
} from './util.js';

export const EXEC_MEMBERS = ['execute', 'handler', 'run', 'invoke', 'func'];
export const SCHEMA_MEMBERS = ['zodSchema', 'inputSchema', 'input_schema', 'parameters', 'schema', 'parametersJsonSchema', 'parameterDefinitions'];

export interface ExtractContext {
  root: string;
  checker: ts.TypeChecker;
  facts: Facts;
}

// ---------------------------------------------------------------- types

export function typeSymbol(t: ts.Type): ts.Symbol | undefined {
  return t.aliasSymbol ?? t.getSymbol();
}

export function typeIdOf(t: ts.Type): string | undefined {
  const d = firstDecl(typeSymbol(t));
  return d === undefined ? undefined : declIdOf(d);
}

export function typeConstituents(t: ts.Type): ts.Type[] {
  return t.isUnion() || t.isIntersection() ? [t, ...t.types] : [t];
}

/** The package a type (or any member of its union) is declared in, when it is one of `patterns`. */
export function typeFromPackages(t: ts.Type, patterns: readonly string[]): string | undefined {
  for (const c of typeConstituents(t)) {
    for (const s of [c.aliasSymbol, c.getSymbol()]) {
      const d = firstDecl(s);
      const pkg = d === undefined ? undefined : packageOfFile(d.getSourceFile().fileName);
      if (packageMatches(pkg, patterns)) return pkg;
    }
  }
  return undefined;
}

/** `Tool.InputSchema`, not `InputSchema`: the name as the SDK's reader would spell it, module prefix dropped. */
export function qualifiedTypeName(checker: ts.TypeChecker, t: ts.Type): string {
  const s = typeSymbol(t);
  if (s === undefined) return checker.typeToString(t);
  return checker.getFullyQualifiedName(s).replace(/^"[^"]*"\./, '');
}

export function isZodType(t: ts.Type): boolean {
  return typeFromPackages(t, ['zod']) !== undefined;
}

/**
 * A Zod schema by its type, or -- when `zod` is not installed and the type is an
 * error -- by the import its expression starts from (`z.object(...)` with `z`
 * imported from `zod` or `zod/v4`, or from a package that re-exports zod's `z`).
 */
export function isZodValue(checker: ts.TypeChecker, e: ts.Expression): boolean {
  if (isZodType(checker.getTypeAtLocation(e))) return true;
  const o = exprOrigin(checker, e);
  if (o === undefined) return false;
  return o.pkg === 'zod' || (o.imported === 'z' && packageMatches(o.pkg, ZOD_REEXPORTS));
}

/**
 * Packages whose `z` export IS zod, re-exported: `genkit` (`export { ..., z } from
 * '@genkit-ai/core'`, genkit 1.42.0 lib/index.d.ts), which Genkit apps import `z` from.
 */
const ZOD_REEXPORTS = ['genkit', '@genkit-ai/*'];

export function propType(checker: ts.TypeChecker, t: ts.Type, name: string, at: ts.Node): ts.Type | undefined {
  const p = checker.getPropertyOfType(t, name);
  return p === undefined ? undefined : checker.getTypeOfSymbolAtLocation(p, at);
}

export function isStringish(t: ts.Type | undefined): boolean {
  return t !== undefined && ((t.flags & ts.TypeFlags.StringLike) !== 0 || (t.flags & ts.TypeFlags.Any) !== 0);
}

/** Top-level keys of a Zod object schema, read from its type's `shape`. */
export function zodParams(checker: ts.TypeChecker, expr: ts.Expression): string[] {
  const t = checker.getTypeAtLocation(expr);
  const shape = propType(checker, t, 'shape', expr);
  if (shape !== undefined) {
    const names = checker.getPropertiesOfType(shape).map((p) => p.getName());
    if (names.length > 0) return names;
  }
  return zodParamsSyntax(expr, checker);
}

/** Top-level keys of a `z.object({...})` literal, following one identifier to its initializer. */
export function zodParamsSyntax(expr: ts.Expression, checker?: ts.TypeChecker): string[] {
  let e: ts.Expression = unwrap(expr);
  if (ts.isIdentifier(e) && checker !== undefined) {
    const sym = checker.getSymbolAtLocation(e);
    const d = sym === undefined ? undefined : firstDecl(resolveAlias(checker, sym));
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) e = unwrap(d.initializer);
  }
  // Walk down a method chain (`z.object({...}).strict().describe(...)`) to the `object(` call.
  while (ts.isCallExpression(e)) {
    if (calleeName(e.expression) === 'object') {
      const a = e.arguments[0];
      if (a !== undefined && ts.isObjectLiteralExpression(a)) {
        return a.properties.map((p) => (ts.isSpreadAssignment(p) ? undefined : propertyNameText(p.name))).filter((n): n is string => n !== undefined);
      }
      return [];
    }
    if (ts.isPropertyAccessExpression(e.expression)) e = e.expression.expression;
    else break;
  }
  return [];
}

/** Keys of a JSON-schema literal's `properties`, following one identifier to its initializer. */
export function jsonSchemaParams(node: ts.Node | undefined, checker?: ts.TypeChecker): string[] | undefined {
  if (node === undefined || !ts.isExpression(node)) return undefined;
  let e = unwrap(node);
  if (ts.isIdentifier(e) && checker !== undefined) {
    const sym = checker.getSymbolAtLocation(e);
    const d = sym === undefined ? undefined : firstDecl(resolveAlias(checker, sym));
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) e = unwrap(d.initializer);
  }
  if (ts.isCallExpression(e) && calleeName(e.expression) === 'jsonSchema' && e.arguments[0] !== undefined) e = unwrap(e.arguments[0]);
  if (!ts.isObjectLiteralExpression(e)) return undefined;
  const props = propValue(getProp(e, 'properties'));
  if (props === undefined || !ts.isObjectLiteralExpression(props)) return [];
  return props.properties.map((p) => (ts.isSpreadAssignment(p) ? undefined : propertyNameText(p.name))).filter((n): n is string => n !== undefined);
}

/** schema_kind and params of whichever schema member a definition literal carries. */
export function schemaOf(checker: ts.TypeChecker, arg: ts.ObjectLiteralExpression): { schema_kind: CodeTool['schema_kind']; params: string[] } {
  for (const m of SCHEMA_MEMBERS) {
    const v = propValue(getProp(arg, m));
    if (v === undefined || !ts.isExpression(v)) continue;
    return schemaOfValue(checker, v, m);
  }
  return { schema_kind: 'unknown', params: [] };
}

/**
 * One schema value: a Zod schema (params from its shape), a JSON-schema literal
 * (params from `properties`), a raw Zod shape `{ a: z.string() }` (MCP v1,
 * LangChain), or Cohere v1's `parameterDefinitions` map (params are its keys).
 */
export function schemaOfValue(checker: ts.TypeChecker, v: ts.Expression, member: string): { schema_kind: CodeTool['schema_kind']; params: string[] } {
  if (isZodValue(checker, v)) return { schema_kind: 'zod', params: zodParams(checker, v) };
  const lit = literalOf(v, checker);
  if (lit !== undefined && getProp(lit, 'properties') === undefined && getProp(lit, 'type') === undefined) {
    const keys = lit.properties.map((p) => (ts.isSpreadAssignment(p) ? undefined : propertyNameText(p.name))).filter((n): n is string => n !== undefined);
    if (member === 'parameterDefinitions') return { schema_kind: 'json_schema', params: keys };
    const values = lit.properties.map((p) => propValue(p)).filter((x): x is ts.Node => x !== undefined);
    if (values.length > 0 && values.every((x) => ts.isExpression(x) && isZodValue(checker, x))) return { schema_kind: 'zod', params: keys };
  }
  const json = jsonSchemaParams(v, checker);
  if (json !== undefined) return { schema_kind: 'json_schema', params: json };
  return { schema_kind: 'unknown', params: [] };
}

/** An object literal, directly or through one identifier's initializer. */
export function literalOf(node: ts.Node, checker: ts.TypeChecker): ts.ObjectLiteralExpression | undefined {
  if (!ts.isExpression(node)) return undefined;
  let e = unwrap(node);
  if (ts.isIdentifier(e)) {
    const sym = checker.getSymbolAtLocation(e);
    const d = sym === undefined ? undefined : firstDecl(resolveAlias(checker, sym));
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) e = unwrap(d.initializer);
  }
  return ts.isObjectLiteralExpression(e) ? e : undefined;
}

/**
 * The tools of an array handed to a model: a literal element's name is read now (and,
 * with `stringIsName`, a string element is a name);
 * an identifier or an inline call is left as an entry for the join, which names
 * it from the definition it resolves to (or makes the set computed when it does not).
 */
export function arrayEntries(ctx: ExtractContext, arr: ts.ArrayLiteralExpression, literalName: (o: ts.ObjectLiteralExpression) => string | undefined, stringIsName = false): { isStatic: boolean; names: string[]; entries: ExposureEntry[] } {
  const names: string[] = [];
  const entries: ExposureEntry[] = [];
  let isStatic = true;
  for (const raw of arr.elements) {
    const el = ts.isSpreadElement(raw) ? undefined : unwrap(raw);
    if (el === undefined) {
      isStatic = false;
      continue;
    }
    const byName = stringIsName ? stringValue(el) : undefined;
    if (byName !== undefined) {
      // A framework that looks a tool up in its registry by name (Genkit): the string IS the name.
      names.push(byName);
    } else if (ts.isObjectLiteralExpression(el)) {
      const n = literalName(el);
      if (n === undefined) isStatic = false;
      else names.push(n);
    } else if (ts.isIdentifier(el)) {
      const s = ctx.checker.getSymbolAtLocation(el);
      const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
      const init = d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined ? unwrap(d.initializer) : undefined;
      const n = init !== undefined && ts.isObjectLiteralExpression(init) ? literalName(init) : undefined;
      if (n !== undefined) names.push(n);
      else if (d !== undefined) entries.push({ valueId: declIdOf(d) });
      else isStatic = false;
    } else if (ts.isCallExpression(el) || ts.isNewExpression(el)) {
      entries.push({ toolKey: refKey(refOf(ctx.root, el)) });
    } else {
      isStatic = false;
    }
  }
  return { isStatic, names, entries };
}

/** A value as written, whitespace runs collapsed, cut at 200 characters: what the report quotes. */
export function writtenValue(n: ts.Node): string {
  const text = n.getText().replace(/\s+/g, ' ').trim();
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}

/**
 * The authority claims a definition literal writes (`authority_claim_names` in
 * data/code-sdks.json), each with its value as written; an `annotations` object's own
 * members are read too (MCP's `destructiveHint` lives there). In source order.
 */
export function hintsOf(arg: ts.ObjectLiteralExpression): AuthorityClaim[] {
  const names = new Set(loadCodeNames().authorityClaims);
  const out: AuthorityClaim[] = [];
  const read = (obj: ts.ObjectLiteralExpression, depth: number): void => {
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) continue;
      const name = propertyNameText(p.name);
      if (name === undefined || !names.has(name)) continue;
      const v = propValue(p);
      out.push({ name, value: v === undefined ? '' : writtenValue(v) });
      if (depth === 0 && v !== undefined && ts.isExpression(v)) {
        const inner = unwrap(v);
        if (ts.isObjectLiteralExpression(inner)) read(inner, 1);
      }
    }
  };
  read(arg, 0);
  return out;
}

/** An MCP `server.tool(name, description, shape, annotations, cb)` annotations argument: the object as written, and the claims inside it. */
export function annotationClaims(obj: ts.ObjectLiteralExpression): AuthorityClaim[] {
  return [{ name: 'annotations', value: writtenValue(obj) }, ...hintsOf(obj)];
}

// ---------------------------------------------------------------- execute bodies

export function functionInfo(ctx: ExtractContext, decl: ts.Declaration): { id: string; info: FunctionInfo } | undefined {
  let fn: ts.SignatureDeclaration | undefined;
  if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) fn = decl;
  else if (ts.isVariableDeclaration(decl) && decl.initializer !== undefined) {
    const init = unwrap(decl.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fn = init;
  }
  if (fn === undefined) return undefined;
  const name = ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) ? decl.name.text : functionName(fn);
  if (name === undefined) return undefined;
  return { id: declIdOf(decl), info: { name, at: refOf(ctx.root, decl), signature: parameterList(fn) } };
}

/** Calls an execute body makes to functions declared in the tree, with whether the first argument carries the tool name. */
export function execCalls(ctx: ExtractContext, body: ts.Node | undefined, toolName: string | undefined, keyName: string | undefined): ExecCall[] {
  if (body === undefined) return [];
  const out: ExecCall[] = [];
  for (const call of collect(body, ts.isCallExpression)) {
    const sym = calleeSymbol(ctx.checker, call.expression);
    const decl = firstDecl(sym);
    if (decl === undefined || !isTreeSource(decl.getSourceFile().fileName)) continue;
    const fi = functionInfo(ctx, decl);
    if (fi === undefined) continue;
    ctx.facts.functions.set(fi.id, fi.info);
    const a0 = call.arguments[0];
    let nameArg = false;
    if (a0 !== undefined) {
      const lit = stringValue(a0);
      if (lit !== undefined && toolName !== undefined && lit === toolName) nameArg = true;
      else if (ts.isIdentifier(a0) && (a0.text === keyName || /name/i.test(a0.text))) nameArg = true;
    }
    out.push({ calleeId: fi.id, calleeName: fi.info.name, nameArg, argc: call.arguments.length });
  }
  return out;
}

export function execMember(arg: ts.ObjectLiteralExpression): ts.ObjectLiteralElementLike | undefined {
  for (const m of EXEC_MEMBERS) {
    const p = getProp(arg, m);
    if (p !== undefined) return p;
  }
  return undefined;
}

// ---------------------------------------------------------------- tool maps

/**
 * A tools MAP handed to a model (`{ refundOrder, lookup: lookupOrder }`): its literal keys are the
 * names the model sees (AI SDK, Mastra), each entry left for the join to rename its definition.
 */
export function exposureOfMap(ctx: ExtractContext, value: ts.Node, valueSym: ts.Symbol | undefined): Omit<FoundExposure, 'at' | 'via' | 'sdk'> {
  const v = ts.isExpression(value) ? unwrap(value) : value;
  if (ts.isObjectLiteralExpression(v)) {
    const entries: ExposureEntry[] = [];
    let isStatic = true;
    const names: string[] = [];
    for (const p of v.properties) {
      if (ts.isSpreadAssignment(p)) {
        isStatic = false;
        names.push(...namedProps(ctx, p.expression));
        continue;
      }
      const key = propertyNameText(p.name);
      if (key === undefined) {
        isStatic = false;
        continue;
      }
      names.push(key);
      const e: ExposureEntry = { key };
      const pv = propValue(p);
      if (pv !== undefined && ts.isIdentifier(pv)) {
        const s = ts.isShorthandPropertyAssignment(p) ? ctx.checker.getShorthandAssignmentValueSymbol(p) : ctx.checker.getSymbolAtLocation(pv);
        const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
        if (d !== undefined) e.valueId = declIdOf(d);
      } else if (pv !== undefined && ts.isExpression(pv)) {
        const call = unwrap(pv);
        if (ts.isCallExpression(call)) {
          e.toolKey = refKey(refOf(ctx.root, call));
          const fd = firstDecl(calleeSymbol(ctx.checker, call.expression));
          if (fd !== undefined && isTreeSource(fd.getSourceFile().fileName)) e.calleeId = declIdOf(fd);
        }
      }
      entries.push(e);
    }
    return isStatic ? { isStatic, entries, names } : { isStatic, entries, names, reason: 'a key of the map is computed or spread' };
  }
  const out: Omit<FoundExposure, 'at' | 'via' | 'sdk'> = { isStatic: false, entries: [], names: [], reason: 'the map is a value, not a literal' };
  const sym = valueSym ?? (ts.isExpression(v) ? ctx.checker.getSymbolAtLocation(v) : undefined);
  const d = sym === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, sym));
  if (d !== undefined) out.valueTargetId = declIdOf(d);
  if (ts.isExpression(v)) out.names = namedProps(ctx, v);
  return out;
}

/** The named (non-index) properties of an expression's type: tool names readable through the type. */
export function namedProps(ctx: ExtractContext, e: ts.Expression): string[] {
  const t = ctx.checker.getTypeAtLocation(e);
  if (typeFromPackages(t, ['ai', '@ai-sdk/*']) !== undefined) return [];
  return ctx.checker.getPropertiesOfType(t).map((p) => p.getName());
}

// ---------------------------------------------------------------- honesty lines

/** A framework's sentence for the honesty lines, once per key. */
export function note(facts: Facts, key: string, sentence: string, at?: SourceRef, kind?: NoteKind): void {
  facts.notes.set(key, sentence);
  if (kind !== undefined) facts.noteKinds.set(key, kind);
  // The place the sentence is about: a sentence whose every place is a framework's own source is dropped (`code/index.ts`).
  if (at !== undefined) facts.noteRefs.set(key, [...(facts.noteRefs.get(key) ?? []), at]);
}

/** The places a note's `where` shows: three, then how many more. */
export function whereOf(refs: readonly SourceRef[]): string {
  const shown = refs.slice(0, 3).map((r) => `${r.file}:${r.line}`).join(', ');
  return refs.length > 3 ? `${shown} and ${refs.length - 3} more` : shown;
}

/**
 * A sentence that counts places: each call adds `at`, and the sentence is rewritten from
 * the count and the first three places, so twenty sites make one line, not twenty.
 */
/**
 * The name the model sees, when the definition writes it as an expression (ACP-455,
 * 2026-09-28): resolved when it is a literal, a constant, a class attribute or an enum member
 * holding one in the scanned tree (`constString`). When it cannot be resolved the definition
 * is recorded (`Facts.computedNames`) and `fallback` is returned: the tool is listed under
 * that name (the function's, the variable's) or, with none, not listed; either way a
 * `not_seen` line says so (`computedNameLines`). Never a silent fallback. With no `node` (the
 * definition writes no name), `fallback` as before.
 */
export function modelName(ctx: ExtractContext, sdk: string, node: ts.Node | undefined, at: ts.Node, fallback?: string): string | undefined {
  if (node === undefined) return fallback;
  const v = constString(node, ctx.checker);
  if (v !== undefined) return v;
  const text = node.getText().replace(/\s+/g, ' ');
  ctx.facts.computedNames.push({ sdk, ...(fallback === undefined ? {} : { listed: fallback }), at: refOf(ctx.root, at), expr: text.length > 60 ? `${text.slice(0, 57)}...` : text });
  return fallback;
}

/** One honesty line per framework for `Facts.computedNames`, in the Python walker's words. */
export function computedNameLines(names: Facts['computedNames'], display: (sdk: string) => string): string[] {
  const by = new Map<string, Facts['computedNames']>();
  for (const n of names) by.set(n.sdk, [...(by.get(n.sdk) ?? []), n]);
  const out: string[] = [];
  for (const sdk of [...by.keys()].sort()) {
    const xs = by.get(sdk) ?? [];
    const listed = xs.filter((x) => x.listed !== undefined).map((x) => `${x.listed ?? ''} at ${x.at.file}:${x.at.line} (${x.expr})`);
    const dropped = xs.filter((x) => x.listed === undefined).map((x) => `${x.at.file}:${x.at.line} (${x.expr})`);
    const parts: string[] = [];
    const few = (l: string[]): string => `${l.slice(0, 5).join('; ')}${l.length > 5 ? '; ...' : ''}`;
    if (listed.length > 0) parts.push(`${listed.length} tool(s) are given their name for the model by an expression the scan could not resolve to a literal (${few(listed)}): each is listed under its function's name, and the name the model sees is computed`);
    if (dropped.length > 0) parts.push(`${dropped.length} place(s) write a tool's shape with a name for the model the scan cannot resolve and no function name to list it under (${few(dropped)}): they are not listed as tools; where one copies a tool defined elsewhere, that tool is listed where it is defined`);
    out.push(`${display(sdk)}: ${parts.join('; ')}`);
  }
  return out;
}

export function noteAt(facts: Facts, key: string, at: SourceRef, make: (count: number, where: string) => string): void {
  const refs = facts.noteRefs.get(key) ?? [];
  refs.push(at);
  facts.noteRefs.set(key, refs);
  facts.noteMakers.set(key, make);
  facts.notes.set(key, make(refs.length, whereOf(refs)));
}
