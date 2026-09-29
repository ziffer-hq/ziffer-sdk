/**
 * Small readers over the TypeScript AST and checker that every signature shares.
 *
 * Identity across programs is a STRING, never a `ts.Symbol`: the scan builds one
 * `ts.Program` per tsconfig, a file can sit in two of them, and a symbol from one
 * program's checker is a different object from the same declaration seen through
 * another. `declId` names a declaration by file and position, which is the same in
 * every program that parsed the same bytes.
 */

import { relative, sep } from 'node:path';
import ts from 'typescript';

import type { SourceRef } from '../types.js';

/** A SourceRef for `node`, relative to the scanned root, POSIX separators, 1-based. */
export function refOf(root: string, node: ts.Node): SourceRef {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { file: relPath(root, sf.fileName), line: line + 1, col: character + 1 };
}

export function relPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

export function refKey(r: SourceRef): string {
  return `${r.file}:${r.line}:${r.col}`;
}

/** The npm package a file belongs to when it is under `node_modules`, else undefined. */
export function packageOfFile(fileName: string): string | undefined {
  const norm = fileName.split(sep).join('/');
  const idx = norm.lastIndexOf('/node_modules/');
  if (idx < 0) return undefined;
  const parts = norm.slice(idx + '/node_modules/'.length).split('/');
  const first = parts[0];
  if (first === undefined) return undefined;
  if (first.startsWith('@')) {
    const second = parts[1];
    return second === undefined ? undefined : `${first}/${second}`;
  }
  return first;
}

/** True when the file is the customer's source: not a dependency, not a declaration file. */
export function isTreeSource(fileName: string): boolean {
  return packageOfFile(fileName) === undefined && !fileName.endsWith('.d.ts') && !/\.d\.[mc]ts$/.test(fileName);
}

/** Follow import aliases to the symbol that is declared. */
export function resolveAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  if ((sym.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(sym);
    } catch {
      return sym;
    }
  }
  return sym;
}

export function firstDecl(sym: ts.Symbol | undefined): ts.Declaration | undefined {
  return sym?.declarations?.[0];
}

export function declIdOf(decl: ts.Node): string {
  return `${decl.getSourceFile().fileName}#${decl.getStart()}`;
}

/** The package a symbol is declared in (after aliases), or undefined when it is the tree's own. */
export function symbolPackage(checker: ts.TypeChecker, sym: ts.Symbol | undefined): string | undefined {
  if (sym === undefined) return undefined;
  const decl = firstDecl(resolveAlias(checker, sym));
  return decl === undefined ? undefined : packageOfFile(decl.getSourceFile().fileName);
}

/**
 * `pkg` matches one of `patterns`: an exact name, or a prefix ending in `*` --
 * `@scope/*` for a whole npm scope, `langchain-*` for a family of PyPI names.
 */
export function packageMatches(pkg: string | undefined, patterns: readonly string[]): boolean {
  if (pkg === undefined) return false;
  return patterns.some((p) => (p.endsWith('*') ? pkg.startsWith(p.slice(0, -1)) && pkg.length >= p.length : pkg === p));
}

/**
 * The package a bare module specifier names: `@scope/name/sub/path` -> `@scope/name`,
 * `name/sub` -> `name`; undefined for a relative, absolute or `node:` specifier.
 */
export function packageOfSpecifier(spec: string): string | undefined {
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || /^[a-zA-Z]:[\\/]/.test(spec)) return undefined;
  const parts = spec.split('/');
  const first = parts[0];
  if (first === undefined || first === '') return undefined;
  if (first.startsWith('@')) {
    const second = parts[1];
    return second === undefined || second === '' || first === '@' ? undefined : `${first}/${second}`;
  }
  return first;
}

/** Where an identifier comes from when the checker cannot follow it: the module specifier it was imported by, and the export it names. */
export interface ImportOrigin {
  pkg: string;
  specifier: string;
  /** The export imported: a name, `default`, or `*` for a namespace or a whole `require`. */
  imported: string;
}

function requireSpecifier(e: ts.Expression | undefined): string | undefined {
  if (e === undefined) return undefined;
  let x = unwrap(e);
  if (ts.isAwaitExpression(x)) x = unwrap(x.expression);
  if (ts.isPropertyAccessExpression(x)) return requireSpecifier(x.expression);
  if (!ts.isCallExpression(x)) return undefined;
  const a0 = x.arguments[0];
  const isRequire = ts.isIdentifier(x.expression) && x.expression.text === 'require';
  const isImport = x.expression.kind === ts.SyntaxKind.ImportKeyword;
  return (isRequire || isImport) && a0 !== undefined && ts.isStringLiteralLike(a0) ? a0.text : undefined;
}

function originOf(specifier: string | undefined, imported: string): ImportOrigin | undefined {
  if (specifier === undefined) return undefined;
  const pkg = packageOfSpecifier(specifier);
  return pkg === undefined ? undefined : { pkg, specifier, imported };
}

/**
 * The import an identifier is bound by, read off the DECLARATION (an `import`, an
 * `import x = require()`, or a `require`/`import()` binding) and never through
 * module resolution. A fresh clone with no `node_modules` has every framework
 * import unresolved, and the checker then knows only that the binding exists; the
 * declaration still says which package it names.
 */
export function importOrigin(checker: ts.TypeChecker, id: ts.Identifier): ImportOrigin | undefined {
  const sym = checker.getSymbolAtLocation(id);
  const d = firstDecl(sym);
  if (d === undefined) return undefined;
  if (ts.isImportSpecifier(d)) {
    const decl = d.parent.parent.parent;
    const spec = ts.isStringLiteral(decl.moduleSpecifier) ? decl.moduleSpecifier.text : undefined;
    return originOf(spec, (d.propertyName ?? d.name).text);
  }
  if (ts.isImportClause(d)) return originOf(ts.isStringLiteral(d.parent.moduleSpecifier) ? d.parent.moduleSpecifier.text : undefined, 'default');
  if (ts.isNamespaceImport(d)) {
    const decl = d.parent.parent;
    return originOf(ts.isStringLiteral(decl.moduleSpecifier) ? decl.moduleSpecifier.text : undefined, '*');
  }
  if (ts.isImportEqualsDeclaration(d) && ts.isExternalModuleReference(d.moduleReference) && ts.isStringLiteral(d.moduleReference.expression)) {
    return originOf(d.moduleReference.expression.text, '*');
  }
  if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)) {
    const init = d.initializer === undefined ? undefined : unwrap(d.initializer);
    const spec = requireSpecifier(init);
    if (spec === undefined) return undefined;
    const member = init !== undefined && ts.isPropertyAccessExpression(init) ? init.name.text : '*';
    return originOf(spec, member);
  }
  if (ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && ts.isVariableDeclaration(d.parent.parent)) {
    const spec = requireSpecifier(d.parent.parent.initializer);
    const prop = propertyNameText(d.propertyName) ?? (ts.isIdentifier(d.name) ? d.name.text : undefined);
    return prop === undefined ? undefined : originOf(spec, prop);
  }
  return undefined;
}

/** The leftmost identifier of a type name: `Anthropic` in `Anthropic.Messages.Tool`. */
function typeNameRoot(n: ts.EntityName): ts.Identifier {
  return ts.isIdentifier(n) ? n : typeNameRoot(n.left);
}

/** The import a declaration's written type names: `server: McpServer`, `tools: Anthropic.Tool[]`. */
export function annotationOrigin(checker: ts.TypeChecker, type: ts.TypeNode | undefined): ImportOrigin | undefined {
  if (type === undefined) return undefined;
  if (ts.isArrayTypeNode(type)) return annotationOrigin(checker, type.elementType);
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    for (const t of type.types) {
      const o = annotationOrigin(checker, t);
      if (o !== undefined) return o;
    }
    return undefined;
  }
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName;
    const named = ts.isIdentifier(name) ? name.text : name.right.text;
    // `Array<Tool>`, `Record<string, Tool>`, `Promise<Client>`: the argument is the type that names the package.
    if ((named === 'Array' || named === 'ReadonlyArray' || named === 'Promise' || named === 'Record') && type.typeArguments !== undefined) {
      return annotationOrigin(checker, type.typeArguments[type.typeArguments.length - 1]);
    }
    const o = importOrigin(checker, typeNameRoot(name));
    return o === undefined ? undefined : { ...o, imported: ts.isIdentifier(name) ? o.imported : `${o.imported}.${name.right.text}` };
  }
  if (ts.isImportTypeNode(type) && ts.isLiteralTypeNode(type.argument) && ts.isStringLiteral(type.argument.literal)) {
    return originOf(type.argument.literal.text, type.qualifier === undefined ? '*' : type.qualifier.getText());
  }
  return undefined;
}

/**
 * The import an expression's VALUE comes from, followed by declarations only:
 * an imported identifier; a variable, property or parameter whose written type
 * or initializer (`new OpenAI()`, `createClient()`, `await Foo.create()`) names
 * one; the receiver of a member access or a call. Undefined when nothing on the
 * way names a package -- never a guess from a spelling.
 */
export function exprOrigin(checker: ts.TypeChecker, expr: ts.Expression, depth = 0): ImportOrigin | undefined {
  if (depth > 6) return undefined;
  const e = unwrap(expr);
  if (ts.isAwaitExpression(e)) return exprOrigin(checker, e.expression, depth + 1);
  if (ts.isCallExpression(e) || ts.isNewExpression(e)) return exprOrigin(checker, e.expression, depth + 1);
  if (ts.isPropertyAccessExpression(e)) {
    // `this.client`: the class member's declaration, when it has one; else the receiver.
    const member = firstDecl(checker.getSymbolAtLocation(e.name));
    if (member !== undefined && isTreeSource(member.getSourceFile().fileName)) {
      const o = declOrigin(checker, member, depth + 1);
      if (o !== undefined) return o;
    }
    if (e.expression.kind === ts.SyntaxKind.ThisKeyword) return undefined;
    return exprOrigin(checker, e.expression, depth + 1);
  }
  if (ts.isElementAccessExpression(e)) return exprOrigin(checker, e.expression, depth + 1);
  if (!ts.isIdentifier(e)) return undefined;
  const imported = importOrigin(checker, e);
  if (imported !== undefined) return imported;
  // An import of the tree's OWN module (`import { ai } from './genkit'`) is an alias: its
  // declaration there (`export const ai = genkit(...)`) says which package the value is from.
  const sym = checker.getSymbolAtLocation(e);
  const d = firstDecl(sym === undefined ? undefined : resolveAlias(checker, sym));
  return d === undefined ? undefined : declOrigin(checker, d, depth + 1);
}

function declOrigin(checker: ts.TypeChecker, d: ts.Declaration, depth: number): ImportOrigin | undefined {
  if (ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isParameter(d) || ts.isPropertyAssignment(d)) {
    const typed = ts.isPropertyAssignment(d) ? undefined : annotationOrigin(checker, d.type);
    if (typed !== undefined) return typed;
    if (d.initializer !== undefined) return exprOrigin(checker, d.initializer, depth + 1);
  }
  return undefined;
}

/** True when the symbol, aliases followed, lands on a declaration the checker could read. */
function resolvesToDeclaration(checker: ts.TypeChecker, sym: ts.Symbol | undefined): boolean {
  return sym !== undefined && firstDecl(resolveAlias(checker, sym)) !== undefined;
}

/** Where a callee is declared: the package, and the declaring file (checked) or the import specifier (unresolved). */
export interface CalleeOrigin {
  pkg: string;
  /** The declaration's file when the checker resolved it; the module specifier when it did not. */
  path: string;
  /** False when the package was read off an import declaration because the module did not resolve. */
  resolved: boolean;
  /** The export the chain starts from when read off an import (`McpServer`, `Agent`, `*`). */
  imported?: string;
}

/**
 * The package a call's callee comes from. The checker decides when it can: a
 * symbol resolved into `node_modules` names its package, and one resolved into
 * the tree names none (the tree's own `tool()` is the tree's). Only when the
 * checker cannot resolve the symbol at all -- the module is not installed -- is the
 * import declaration read instead (`exprOrigin`).
 */
export function calleeOrigin(checker: ts.TypeChecker, callee: ts.Expression): CalleeOrigin | undefined {
  const sym = calleeSymbol(checker, callee);
  const d = firstDecl(sym === undefined ? undefined : resolveAlias(checker, sym));
  // `const { QueryEngineTool } = await import('llamaindex')` with the module not installed: the
  // binding is declared in the tree, but it names an export of the package it destructures.
  if (d !== undefined && ts.isBindingElement(d) && isTreeSource(d.getSourceFile().fileName)) {
    const o = exprOrigin(checker, callee);
    if (o !== undefined) return { pkg: o.pkg, path: o.specifier, resolved: false, imported: o.imported };
  }
  if (d !== undefined) {
    const pkg = packageOfFile(d.getSourceFile().fileName);
    return pkg === undefined ? undefined : { pkg, path: d.getSourceFile().fileName.split(sep).join('/'), resolved: true };
  }
  if (resolvesToDeclaration(checker, sym)) return undefined;
  const o = exprOrigin(checker, callee);
  return o === undefined ? undefined : { pkg: o.pkg, path: o.specifier, resolved: false, imported: o.imported };
}

export function calleePackage(checker: ts.TypeChecker, callee: ts.Expression): string | undefined {
  return calleeOrigin(checker, callee)?.pkg;
}

/** The symbol a call's callee names, aliases followed. */
export function calleeSymbol(checker: ts.TypeChecker, callee: ts.Expression): ts.Symbol | undefined {
  const at = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const sym = checker.getSymbolAtLocation(at);
  if (sym === undefined) return undefined;
  const resolved = resolveAlias(checker, sym);
  // `const { executeTool } = await import('./tool-executor.js')`: the binding names a
  // property of the module's type, and that property is the declared function.
  const d = firstDecl(resolved);
  if (d !== undefined && ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent)) {
    const prop = propertyNameText(d.propertyName) ?? (ts.isIdentifier(d.name) ? d.name.text : undefined);
    const p = prop === undefined ? undefined : checker.getPropertyOfType(checker.getTypeAtLocation(d.parent), prop);
    if (p !== undefined) return resolveAlias(checker, p);
  }
  return resolved;
}

/**
 * The name a recogniser dispatches on: the EXPORT an identifier callee is imported as
 * (`import { tool as realtimeTool }` calls `tool`), else the spelled name. Without it an
 * aliased import of a framework's function is missed by every signature keyed on the name.
 */
export function calleeExportName(checker: ts.TypeChecker, callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) {
    const o = importOrigin(checker, callee);
    if (o !== undefined && o.imported !== '*' && o.imported !== 'default') return o.imported;
  }
  return calleeName(callee);
}

/** The simple name a callee is spelled with: `f` for `f(...)`, `m` for `a.b.m(...)`. */
export function calleeName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** The dotted spelling of a property-access chain, `client.beta.messages.create`; undefined past a call or element access. */
export function dottedName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  if (ts.isPropertyAccessExpression(expr)) {
    const left = dottedName(expr.expression);
    return left === undefined ? expr.name.text : `${left}.${expr.name.text}`;
  }
  return undefined;
}

/** A property's static name; undefined for a computed key. */
export function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  if (ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

/** A member of an object literal by static name. */
export function getProp(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find((p) => {
    if (ts.isSpreadAssignment(p)) return false;
    return propertyNameText(p.name) === name;
  });
}

/** The expression a member carries: the initializer, the shorthand identifier, or the method itself. */
export function propValue(p: ts.ObjectLiteralElementLike | undefined): ts.Node | undefined {
  if (p === undefined) return undefined;
  if (ts.isPropertyAssignment(p)) return p.initializer;
  if (ts.isShorthandPropertyAssignment(p)) return p.name;
  if (ts.isMethodDeclaration(p)) return p;
  return undefined;
}

/** A string literal's text, or, with a checker, the literal type of a constant. */
export function stringValue(node: ts.Node | undefined, checker?: ts.TypeChecker): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression, checker);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return stringValue(node.expression, checker);
  if (checker !== undefined && ts.isExpression(node)) {
    const t = checker.getTypeAtLocation(node);
    if (t.isStringLiteral()) return t.value;
  }
  return undefined;
}

/** Strip parentheses, `as`, `satisfies` and non-null wrappers. */
export function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

/** The body of a function-valued member: an arrow, a function expression, a method, or an identifier naming a function declared in the tree. */
export function functionBody(node: ts.Node | undefined, checker?: ts.TypeChecker): ts.Node | undefined {
  if (node === undefined) return undefined;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
    return node.body;
  }
  if (checker !== undefined && ts.isIdentifier(node)) {
    const sym = checker.getSymbolAtLocation(node);
    const decl = sym === undefined ? undefined : firstDecl(resolveAlias(checker, sym));
    if (decl === undefined || !isTreeSource(decl.getSourceFile().fileName)) return undefined;
    if (ts.isFunctionDeclaration(decl)) return decl.body;
    if (ts.isVariableDeclaration(decl) && decl.initializer !== undefined) return functionBody(unwrap(decl.initializer));
  }
  return undefined;
}

/** Every node under `root` (inclusive) satisfying `pred`. */
export function collect<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  const visit = (n: ts.Node): void => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

/** The nearest enclosing function-like node, or undefined at module level. */
export function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let n: ts.Node | undefined = node.parent;
  while (n !== undefined) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) {
      return n;
    }
    n = n.parent;
  }
  return undefined;
}

/** The name a function-like node is known by: its own, or the variable/property it is assigned to. */
export function functionName(fn: ts.Node): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name !== undefined) {
    return propertyNameText(fn.name);
  }
  const p = fn.parent;
  if (p !== undefined && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p !== undefined && ts.isPropertyAssignment(p)) return propertyNameText(p.name);
  return undefined;
}

/** A function's parameter list as written, names only: `(name, input, ctx, abortSignal)`. */
export function parameterList(fn: ts.SignatureDeclaration): string {
  const names = fn.parameters.map((p) => {
    const rest = p.dotDotDotToken !== undefined ? '...' : '';
    return rest + (ts.isIdentifier(p.name) ? p.name.text : p.name.getText());
  });
  return `(${names.join(', ')})`;
}

/** True when `node` sits inside a loop body (for, for-of, for-in, while, do) or a `.forEach`/`.map` callback, below `stop`. */
export function insideLoop(node: ts.Node): boolean {
  let n: ts.Node | undefined = node.parent;
  while (n !== undefined && !ts.isSourceFile(n)) {
    if (ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) return true;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent !== undefined && ts.isCallExpression(n.parent)) {
      const cn = calleeName(n.parent.expression);
      if (cn === 'forEach' || cn === 'map' || cn === 'flatMap' || cn === 'reduce') return true;
    }
    n = n.parent;
  }
  return false;
}

/**
 * A string a definition spells as a constant: a literal, a concatenation or a
 * template of constants, or a `const` (or a const object's member) holding one.
 * Undefined when any part is not constant; never a guess.
 */
export function constString(node: ts.Node | undefined, checker?: ts.TypeChecker, depth = 0): string | undefined {
  if (node === undefined || depth > 8) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return constString(node.expression, checker, depth + 1);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = constString(node.left, checker, depth + 1);
    const r = l === undefined ? undefined : constString(node.right, checker, depth + 1);
    return l === undefined || r === undefined ? undefined : l + r;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const v = constString(span.expression, checker, depth + 1);
      if (v === undefined) return undefined;
      out += v + span.literal.text;
    }
    return out;
  }
  if (checker !== undefined && (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
    const sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : ts.isElementAccessExpression(node) ? node.argumentExpression : node);
    const d = sym === undefined ? undefined : firstDecl(resolveAlias(checker, sym));
    // A constant, an object literal's member, a class attribute or an enum member holding a literal.
    if (d !== undefined && (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d) || ts.isEnumMember(d)) && d.initializer !== undefined) {
      const v = constString(d.initializer, checker, depth + 1);
      if (v !== undefined) return v;
    }
    // `DESCRIPTIONS.send_email` on a `Record<string, string>`: the checker has no member
    // symbol, so read the const's object literal (through `Object.freeze`) by key.
    if (ts.isPropertyAccessExpression(node)) {
      const obj = constObjectLiteral(node.expression, checker);
      const member = obj === undefined ? undefined : getProp(obj, node.name.text);
      if (member !== undefined && ts.isPropertyAssignment(member)) {
        const v = constString(member.initializer, checker, depth + 1);
        if (v !== undefined) return v;
      }
    }
    const t = checker.getTypeAtLocation(node);
    if (t.isStringLiteral()) return t.value;
  }
  return undefined;
}

function constObjectLiteral(expr: ts.Expression, checker: ts.TypeChecker): ts.ObjectLiteralExpression | undefined {
  const sym = checker.getSymbolAtLocation(expr);
  const d = sym === undefined ? undefined : firstDecl(resolveAlias(checker, sym));
  if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
  let init = unwrap(d.initializer);
  if (ts.isCallExpression(init) && dottedName(init.expression) === 'Object.freeze' && init.arguments[0] !== undefined) init = unwrap(init.arguments[0]);
  return ts.isObjectLiteralExpression(init) ? init : undefined;
}
