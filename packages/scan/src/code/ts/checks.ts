/**
 * What the source shows before one call to the dispatcher (ACP-455, 2026-09-28):
 * the enclosing function's or route's name, and the first condition before the call
 * that reads a name from `confirmation_names` (data/code-sdks.json), spelled exactly.
 *
 * Two shapes count. An `if` (or a `?:`, a `while`) whose TEST reads such a name and
 * ends before the call; and any other statement before the call that reads such a name
 * AND returns or throws. A statement that only computes the value (`const confirmed =
 * body.confirmed === true`) is not a check by itself; the `if (!confirmed) return` after
 * it is. Only statements of the enclosing function itself are read, never of a callback
 * defined inside it, and the search goes outward through anonymous functions to the
 * first named function or route handler. Comments are not in the syntax tree, so a
 * name in a comment never counts.
 *
 * A check FOUND is a line of code, not proof it stops anything; a check NOT found is
 * what the scan read, not proof nobody is asked.
 */

import ts from 'typescript';

import type { CallerCheck } from '../types.js';
import { collect, declIdOf, dottedName, firstDecl, functionName, getProp, propValue, refOf, resolveAlias, stringValue, unwrap } from './util.js';

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'del', 'all', 'use', 'route', 'handle', 'options', 'head']);

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);
}

/** `router.post('/path', ..., handler)`: the route's name as written, when `fn` is such a handler. */
function routeName(fn: ts.Node): string | undefined {
  const call = fn.parent;
  if (call === undefined || !ts.isCallExpression(call) || !call.arguments.some((a) => a === fn)) return undefined;
  if (!ts.isPropertyAccessExpression(call.expression) || !ROUTE_METHODS.has(call.expression.name.text)) return undefined;
  const path = stringValue(call.arguments[0]);
  if (path === undefined) return undefined;
  return `${dottedName(call.expression) ?? call.expression.name.text}('${path}')`;
}

function nearestFunction(n: ts.Node): ts.Node | undefined {
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !isFunctionLike(p)) p = p.parent;
  return p;
}

/** The names a node reads that are in the list: identifiers (not the name being declared) and string keys. */
function namesRead(root: ts.Node, names: ReadonlySet<string>): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (isFunctionLike(n) && n !== root) return;
    if (ts.isIdentifier(n) && names.has(n.text)) {
      const p = n.parent;
      const declared = (ts.isVariableDeclaration(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isParameter(p) && p.name === n) || (ts.isBindingElement(p) && p.name === n && p.propertyName === undefined && !ts.isObjectBindingPattern(p.parent));
      if (!declared) out.push(n);
    } else if (ts.isStringLiteral(n) && names.has(n.text)) {
      const p = n.parent;
      if ((ts.isElementAccessExpression(p) && p.argumentExpression === n) || (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.InKeyword)) out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

function exits(stmt: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found || isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(stmt, visit);
  return found;
}

function nameText(n: ts.Node): string {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : n.getText();
}

export function callerCheck(root: string, call: ts.CallExpression, caller: CallerCheck['caller'], names: ReadonlySet<string>): CallerCheck {
  // The functions to read: outward through anonymous ones, to the first named function or route.
  const chain: ts.Node[] = [];
  let inFunction = '';
  for (let fn = nearestFunction(call); fn !== undefined; fn = nearestFunction(fn)) {
    chain.push(fn);
    const route = routeName(fn);
    const named = route ?? functionName(fn);
    if (named !== undefined) {
      inFunction = named;
      break;
    }
  }
  const start = call.getStart();
  const found: { at: ts.Node; reads: ts.Node }[] = [];
  for (const fn of chain) {
    const body = isFunctionLike(fn) ? fn.body : undefined;
    if (body === undefined) continue;
    const own = (n: ts.Node): boolean => nearestFunction(n) === fn;
    for (const n of collect(body, (x): x is ts.Node => ts.isIfStatement(x) || ts.isConditionalExpression(x) || ts.isWhileStatement(x))) {
      if (!own(n)) continue;
      const test = ts.isConditionalExpression(n) ? n.condition : ts.isIfStatement(n) || ts.isWhileStatement(n) ? n.expression : undefined;
      if (test === undefined || test.getEnd() > start) continue;
      const r = namesRead(test, names)[0];
      if (r !== undefined) found.push({ at: n, reads: r });
    }
    for (const s of collect(body, (x): x is ts.Statement => ts.isExpressionStatement(x) || ts.isVariableStatement(x) || ts.isTryStatement(x) || ts.isSwitchStatement(x))) {
      if (!own(s) || s.getEnd() > start || !exits(s)) continue;
      const r = namesRead(s, names)[0];
      if (r !== undefined) found.push({ at: s, reads: r });
    }
  }
  found.sort((a, b) => a.at.getStart() - b.at.getStart());
  const first = found[0];
  const out: CallerCheck = { caller, in_function: inFunction };
  if (first !== undefined) out.check = { at: refOf(root, first.at), reads: nameText(first.reads) };
  return out;
}

// ---------------------------------------------------------------- what one caller can reach

/**
 * What bounds the tool names ONE dispatcher call can pass (`CallerCheck.reaches`, ACP-455 second
 * review), before the join maps it to the catalog's names: a set of literal names, or a name
 * prefix, and the reader phrase that says where the bound was read. Undefined when the name
 * reaches the call as a value the source does not bound (a parameter, a field, a lookup): then
 * the caller can reach any tool the dispatcher knows, and nothing is guessed.
 *
 * Three shapes count, all read from the source text:
 *  - the name argument is a literal, or a `const` whose value is one (`'restock'`);
 *  - before the call, in the enclosing function itself, `if (!LIST.includes(name)) return|throw`
 *    or `if (!SET.has(name)) ...`, where LIST/SET is a `const` (here or imported) whose value is
 *    an array literal of string literals, or `new Set([...])` of one;
 *  - before the call, `if (!name.startsWith('prefix')) return|throw` with a literal prefix.
 * A list handed to the model BESIDE the callback (the tool list of a model call) is not a bound:
 * nothing in the source stops the model naming another tool, so it is not read as one.
 */
export interface ReachBound {
  literal?: string[];
  prefix?: string;
  from: string;
}

function symbolOf(checker: ts.TypeChecker, n: ts.Node): ts.Symbol | undefined {
  const s = checker.getSymbolAtLocation(n);
  return s === undefined ? undefined : resolveAlias(checker, s);
}

/** A `const` whose initializer is an array literal of string literals, or `new Set([...])` of one: its strings. */
function literalList(checker: ts.TypeChecker, expr: ts.Expression): string[] | undefined {
  const sym = symbolOf(checker, unwrap(expr));
  const decl = firstDecl(sym);
  if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return undefined;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return undefined;
  let init = unwrap(decl.initializer);
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'Set') {
    const arg = init.arguments?.[0];
    if (arg === undefined || init.arguments?.length !== 1) return undefined;
    init = unwrap(arg);
  }
  if (!ts.isArrayLiteralExpression(init)) return undefined;
  const out: string[] = [];
  for (const el of init.elements) {
    const v = ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el) ? el.text : undefined;
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

/** Whether an `if`'s then-branch leaves the function (returns or throws) on every path it reads plainly. */
function thenExits(stmt: ts.IfStatement): boolean {
  const t = stmt.thenStatement;
  if (ts.isReturnStatement(t) || ts.isThrowStatement(t)) return true;
  if (!ts.isBlock(t)) return false;
  const last = t.statements[t.statements.length - 1];
  return last !== undefined && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

export function reachBound(root: string, call: ts.CallExpression, checker: ts.TypeChecker): ReachBound | undefined {
  const arg = call.arguments[0];
  if (arg === undefined) return undefined;
  const direct = ts.isStringLiteral(unwrap(arg)) || ts.isNoSubstitutionTemplateLiteral(unwrap(arg)) ? stringValue(arg) : undefined;
  if (direct !== undefined) return { literal: [direct], from: 'the name written at the call' };
  const nameExpr = unwrap(arg);
  if (!ts.isIdentifier(nameExpr)) return undefined;
  const nameSym = symbolOf(checker, nameExpr);
  if (nameSym === undefined) return undefined;
  // A `const` holding one literal name.
  const nameDecl = firstDecl(nameSym);
  if (nameDecl !== undefined && ts.isVariableDeclaration(nameDecl) && nameDecl.initializer !== undefined && ts.isVariableDeclarationList(nameDecl.parent) && (nameDecl.parent.flags & ts.NodeFlags.Const) !== 0) {
    const init = unwrap(nameDecl.initializer);
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return { literal: [init.text], from: `the name ${nameExpr.text} set at ${where(root, nameDecl)}` };
  }
  // A guard before the call, in the enclosing function itself.
  const fn = nearestFunction(call);
  const body = fn !== undefined && isFunctionLike(fn) ? fn.body : undefined;
  if (body === undefined) return undefined;
  const start = call.getStart();
  const sameName = (e: ts.Expression): boolean => {
    const u = unwrap(e);
    return ts.isIdentifier(u) && symbolOf(checker, u) === nameSym;
  };
  // A name assigned anywhere in the function is not the value the guard tested.
  const assigned = collect(body, (x): x is ts.BinaryExpression => ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken).some((b) => sameName(b.left));
  if (assigned) return undefined;
  for (const stmt of collect(body, (x): x is ts.IfStatement => ts.isIfStatement(x))) {
    if (nearestFunction(stmt) !== fn || stmt.getEnd() > start || !thenExits(stmt)) continue;
    const test = unwrap(stmt.expression);
    if (!ts.isPrefixUnaryExpression(test) || test.operator !== ts.SyntaxKind.ExclamationToken) continue;
    const inner = unwrap(test.operand);
    if (!ts.isCallExpression(inner) || !ts.isPropertyAccessExpression(inner.expression) || inner.arguments.length !== 1) continue;
    const method = inner.expression.name.text;
    const target = inner.expression.expression;
    const only = inner.arguments[0];
    if (only === undefined) continue;
    if ((method === 'includes' || method === 'has') && sameName(only)) {
      const names = literalList(checker, target);
      if (names !== undefined) return { literal: names, from: `the list ${target.getText()} the name is tested against at ${where(root, stmt)}` };
    }
    if (method === 'startsWith' && sameName(target)) {
      const prefix = ts.isStringLiteral(unwrap(only)) || ts.isNoSubstitutionTemplateLiteral(unwrap(only)) ? stringValue(only) : undefined;
      if (prefix !== undefined && prefix !== '') return { prefix, from: `the name prefix '${prefix}' tested at ${where(root, stmt)}` };
    }
  }
  return undefined;
}

function where(root: string, n: ts.Node): string {
  const r = refOf(root, n);
  return `${r.file}:${r.line}`;
}

// ---------------------------------------------------------------- what the model is told about

/**
 * Where the function holding ONE dispatcher call is handed on (`CallerCheck.offered`, ACP-455 third
 * reading): the named function the caller check read, or, when that function is returned by a
 * factory (`return async function decoratedOnToolCall(...)`), the factory. `id` is the declaration
 * a reference resolves to (`declIdOf`), so a site in another program still matches.
 */
export interface InstallTarget {
  name: string;
  id: string;
  factory: boolean;
}

export function installTarget(call: ts.CallExpression): InstallTarget | undefined {
  let named: ts.Node | undefined;
  for (let fn = nearestFunction(call); fn !== undefined; fn = nearestFunction(fn)) {
    if (routeName(fn) !== undefined) return undefined; // a route is installed by the router, not handed a tool list
    if (functionName(fn) !== undefined) {
      named = fn;
      break;
    }
  }
  if (named === undefined) return undefined;
  const declOf = (fn: ts.Node): ts.Node => (ts.isVariableDeclaration(fn.parent) ? fn.parent : fn);
  let up: ts.Node = named.parent;
  while (ts.isParenthesizedExpression(up)) up = up.parent;
  if ((ts.isFunctionExpression(named) || ts.isArrowFunction(named)) && (ts.isReturnStatement(up) || (ts.isArrowFunction(up) && up.body === named))) {
    const outer = ts.isArrowFunction(up) ? up : nearestFunction(up);
    const outerName = outer === undefined ? undefined : functionName(outer);
    if (outer === undefined || outerName === undefined) return undefined;
    return { name: outerName, id: declIdOf(declOf(outer)), factory: true };
  }
  const own = functionName(named);
  if (own === undefined || ts.isPropertyAssignment(named.parent) || ts.isMethodDeclaration(named)) return undefined;
  return { name: own, id: declIdOf(declOf(named)), factory: false };
}

/** A list the model is told about, read from the source: literal names, name prefixes over a catalog value, and the reader phrase. */
export interface OfferedList {
  literal: string[];
  prefixes: string[];
  from: string;
}

const MAX_DEPTH = 4;

function constInit(checker: ts.TypeChecker, id: ts.Identifier): ts.Expression | undefined {
  const s = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? checker.getShorthandAssignmentValueSymbol(id.parent) : symbolOf(checker, id);
  const decl = firstDecl(s === undefined ? undefined : resolveAlias(checker, s));
  if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return undefined;
  if (!ts.isVariableDeclarationList(decl.parent) || (decl.parent.flags & ts.NodeFlags.Const) === 0) return undefined;
  return decl.initializer;
}

/** One element's tool name: a string literal, an object literal's `name`, a factory call on one, or a `const` holding either. */
function elementName(checker: ts.TypeChecker, e: ts.Expression, depth: number): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const u = unwrap(e);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text;
  if (ts.isObjectLiteralExpression(u)) {
    const v = propValue(getProp(u, 'name'));
    return v === undefined || !ts.isExpression(v) ? undefined : stringValue(unwrap(v));
  }
  if (ts.isCallExpression(u) && u.arguments.length === 1) {
    const a = u.arguments[0];
    return a !== undefined && ts.isObjectLiteralExpression(unwrap(a)) ? elementName(checker, a, depth + 1) : undefined;
  }
  if (ts.isIdentifier(u)) {
    const init = constInit(checker, u);
    return init === undefined ? undefined : elementName(checker, init, depth + 1);
  }
  return undefined;
}

/** The one parameter of a one-parameter callback, and the expression it returns. */
function callbackOf(e: ts.Expression | undefined): { param: string; body: ts.Expression } | undefined {
  if (e === undefined) return undefined;
  const f = unwrap(e);
  if (!(ts.isArrowFunction(f) || ts.isFunctionExpression(f)) || f.parameters.length !== 1) return undefined;
  const p = f.parameters[0];
  if (p === undefined || !ts.isIdentifier(p.name)) return undefined;
  let body: ts.Expression | undefined;
  if (ts.isBlock(f.body)) {
    const only = f.body.statements.length === 1 ? f.body.statements[0] : undefined;
    body = only !== undefined && ts.isReturnStatement(only) ? only.expression : undefined;
  } else {
    body = f.body;
  }
  return body === undefined ? undefined : { param: p.name.text, body: unwrap(body) };
}

function isNameOf(e: ts.Expression, param: string): boolean {
  const u = unwrap(e);
  return ts.isPropertyAccessExpression(u) && u.name.text === 'name' && ts.isIdentifier(u.expression) && u.expression.text === param;
}

/** `...X.filter((t) => t.name.startsWith('p'))`, optionally followed by a `.map` that keeps `name`: the source and the prefix. */
function prefixFilter(e: ts.Expression): { source: string; prefix: string } | undefined {
  let u = unwrap(e);
  if (ts.isCallExpression(u) && ts.isPropertyAccessExpression(u.expression) && u.expression.name.text === 'map') {
    const cb = callbackOf(u.arguments[0]);
    if (cb === undefined || !ts.isObjectLiteralExpression(cb.body)) return undefined;
    const kept = propValue(getProp(cb.body, 'name'));
    if (kept === undefined || !ts.isExpression(kept) || !isNameOf(kept, cb.param)) return undefined;
    u = unwrap(u.expression.expression);
  }
  if (!ts.isCallExpression(u) || !ts.isPropertyAccessExpression(u.expression) || u.expression.name.text !== 'filter') return undefined;
  const cb = callbackOf(u.arguments[0]);
  if (cb === undefined || !ts.isCallExpression(cb.body) || !ts.isPropertyAccessExpression(cb.body.expression)) return undefined;
  const test = cb.body.expression;
  if (test.name.text !== 'startsWith' || !isNameOf(test.expression, cb.param) || cb.body.arguments.length !== 1) return undefined;
  const lit = cb.body.arguments[0];
  const prefix = lit === undefined ? undefined : stringValue(unwrap(lit));
  if (prefix === undefined || prefix === '') return undefined;
  return { source: u.expression.expression.getText(), prefix };
}

/** The tool list a `tools` value holds, when every element is readable from the source; undefined otherwise. */
export function offeredList(root: string, checker: ts.TypeChecker, value: ts.Expression, depth = 0): OfferedList | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const u = unwrap(value);
  if (ts.isIdentifier(u)) {
    const init = constInit(checker, u);
    return init === undefined ? undefined : offeredList(root, checker, init, depth + 1);
  }
  const at = where(root, u);
  if (ts.isObjectLiteralExpression(u)) {
    // A tool map (`{ shelf_count: tool(...) }`): the keys are the names the model sees.
    const keys: string[] = [];
    for (const p of u.properties) {
      if (ts.isSpreadAssignment(p) || p.name === undefined) return undefined;
      const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (k === undefined) return undefined;
      keys.push(k);
    }
    return keys.length === 0 ? undefined : { literal: keys, prefixes: [], from: `${at}, the tool map {${keys.join(', ')}}` };
  }
  if (!ts.isArrayLiteralExpression(u) || u.elements.length === 0) return undefined;
  const literal: string[] = [];
  const prefixes: string[] = [];
  const parts: string[] = [];
  const named: string[] = [];
  for (const el of u.elements) {
    if (ts.isSpreadElement(el)) {
      const f = prefixFilter(el.expression);
      if (f === undefined) return undefined;
      prefixes.push(f.prefix);
      parts.push(`${f.source} filtered by the name prefix "${f.prefix}"`);
      continue;
    }
    const n = elementName(checker, el, depth);
    if (n === undefined) return undefined;
    literal.push(n);
    named.push(ts.isIdentifier(unwrap(el)) ? unwrap(el).getText() : `'${n}'`);
  }
  const how = prefixes.length === 0 ? `the literal list [${named.join(', ')}]` : [...parts, ...named].join(', plus ');
  return { literal, prefixes, from: `${at}, ${how}` };
}

/**
 * The `tools` value handed beside a reference to the installed function: the reference is a
 * property of an object literal (`{ tools, onToolCall }`), directly or through one `const`
 * holding it. Undefined when any use of that `const` is not such a property, so a second,
 * unread installation never hides behind a first, readable one.
 */
export function toolsBeside(checker: ts.TypeChecker, site: ts.Expression): ts.Expression[] | undefined {
  let e: ts.Node = site;
  while (ts.isParenthesizedExpression(e.parent) || ts.isAwaitExpression(e.parent)) e = e.parent;
  const p = e.parent;
  if (ts.isVariableDeclaration(p) && p.initializer === e && ts.isIdentifier(p.name) && ts.isVariableDeclarationList(p.parent) && (p.parent.flags & ts.NodeFlags.Const) !== 0) {
    const sym = checker.getSymbolAtLocation(p.name);
    if (sym === undefined) return undefined;
    const declName = p.name;
    const refs = collect(e.getSourceFile(), (x): x is ts.Identifier => ts.isIdentifier(x) && x !== declName && x.text === declName.text).filter((x) => {
      const s = ts.isShorthandPropertyAssignment(x.parent) ? checker.getShorthandAssignmentValueSymbol(x.parent) : checker.getSymbolAtLocation(x);
      return s === sym;
    });
    if (refs.length === 0) return undefined;
    const out: ts.Expression[] = [];
    for (const r of refs) {
      const v = toolsOfObject(r);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (!ts.isExpression(e)) return undefined;
  const v = toolsOfObject(e);
  return v === undefined ? undefined : [v];
}

function toolsOfObject(e: ts.Node): ts.Expression | undefined {
  const p = e.parent;
  const obj = (ts.isPropertyAssignment(p) && p.initializer === e) || (ts.isShorthandPropertyAssignment(p) && p.name === e) ? p.parent : undefined;
  if (obj === undefined || !ts.isObjectLiteralExpression(obj)) return undefined;
  const t = getProp(obj, 'tools');
  if (t === undefined) return undefined;
  if (ts.isShorthandPropertyAssignment(t)) return t.name;
  const v = propValue(t);
  return v !== undefined && ts.isExpression(v) ? v : undefined;
}
