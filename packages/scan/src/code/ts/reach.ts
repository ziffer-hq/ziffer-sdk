/**
 * A tool that runs another tool without passing the dispatcher (ACP-455, 2026-09-28).
 *
 * From each tool's run function the scan follows calls into functions declared in
 * the application's own source, to `REACH_DEPTH` functions deep, and records two
 * kinds of call site: a call to a function that may be ANOTHER tool's run function
 * (resolved in the join, where every tool is known), and a run function taken from a
 * map by key and called (`TOOLS_BY_NAME.get(name).execute(...)`, `tools[name].execute(...)`),
 * kept in the join only when the map's element type is a tool type. A path that
 * enters the dispatcher is dropped in the join: the dispatcher sees that call.
 *
 * What the reading does NOT do, and says so in the report: it does not follow a call
 * through an interface or a function-typed value (a workflow's `execute` taken from a
 * workflow map), only through functions the checker resolves to a body; and a function
 * a reached function CREATES (a closure it returns) is read as if it runs, which is an
 * over-reading on purpose -- a tool that builds a context whose method runs other tools
 * is reported, never missed.
 */

import ts from 'typescript';

import { packagesOf } from '../sdks.js';
import { EXEC_MEMBERS, typeFromPackages, typeIdOf, type ExtractContext } from './common.js';
import type { FoundTool, RawToolCall } from './facts.js';
import { calleeSymbol, collect, declIdOf, firstDecl, functionBody, functionName, isTreeSource, propValue, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

/** How many application functions deep a run function is followed. */
export const REACH_DEPTH = 4;

/** The SDK packages whose types make a looked-up value a tool. */
function toolSdkPackages(): string[] {
  return [...packagesOf('ai'), ...packagesOf('anthropic'), ...packagesOf('langchain'), ...packagesOf('openai-agents'), ...packagesOf('mcp')];
}

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);
}

function stripAwait(e: ts.Expression): ts.Expression {
  let x = unwrap(e);
  while (ts.isAwaitExpression(x)) x = unwrap(x.expression);
  return x;
}

/** `def:<refKey>` of the value a variable declaration is initialised with: the key a tool definition is found under. */
function defTarget(ctx: ExtractContext, d: ts.Declaration | undefined): string | undefined {
  if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
  return `def:${refKey(refOf(ctx.root, stripAwait(d.initializer)))}`;
}

function declOfExpr(ctx: ExtractContext, e: ts.Expression): ts.Declaration | undefined {
  const at = ts.isPropertyAccessExpression(e) ? e.name : e;
  const s = ctx.checker.getSymbolAtLocation(at);
  return s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
}

/** The body of a tree function a declaration names, when it has one. */
function bodyOfDecl(ctx: ExtractContext, d: ts.Declaration): ts.Node | undefined {
  if (!isTreeSource(d.getSourceFile().fileName)) return undefined;
  if (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d)) return d.body;
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined) return functionBody(unwrap(d.initializer), ctx.checker);
  if (ts.isPropertyAssignment(d)) return functionBody(unwrap(d.initializer), ctx.checker);
  return undefined;
}

function nameOfDecl(d: ts.Declaration): string {
  if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)) return d.name.text;
  if (ts.isPropertyAssignment(d)) return functionName(d.initializer) ?? d.name.getText();
  return functionName(d) ?? '(anonymous)';
}

/** A map lookup `M.get(k)` or `M[k]`, directly or through one `const x = ...` hop: the key expression. */
function lookupKey(ctx: ExtractContext, recv: ts.Expression): ts.Expression | undefined {
  const direct = (e: ts.Expression): ts.Expression | undefined => {
    const x = stripAwait(e);
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'get' && x.arguments.length === 1) return x.arguments[0];
    if (ts.isElementAccessExpression(x)) return x.argumentExpression;
    return undefined;
  };
  const k = direct(recv);
  if (k !== undefined) return k;
  const r = unwrap(recv);
  if (!ts.isIdentifier(r)) return undefined;
  const d = declOfExpr(ctx, r);
  if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
  return direct(d.initializer);
}

interface Frame {
  body: ts.Node;
  through: string[];
  pathIds: string[];
  depth: number;
}

/** The named functions between `node` and the frame's body, outermost first. */
function nestedNames(node: ts.Node, body: ts.Node): string[] {
  const out: string[] = [];
  let n: ts.Node | undefined = node.parent;
  while (n !== undefined && n !== body) {
    if (isFunctionLike(n)) {
      const name = functionName(n);
      if (name !== undefined) out.unshift(name);
    }
    n = n.parent;
  }
  return out;
}

/** The candidate tool calls reachable from one run function body. */
export function reachOf(ctx: ExtractContext, body: ts.Node, ownIds: ReadonlySet<string>): RawToolCall[] {
  const out: RawToolCall[] = [];
  const visited = new Set<string>(ownIds);
  const sdkPkgs = toolSdkPackages();
  const queue: Frame[] = [{ body, through: [], pathIds: [], depth: 0 }];
  for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
    for (const call of collect(f.body, ts.isCallExpression)) {
      const callee = unwrap(call.expression);
      const through = [...f.through, ...nestedNames(call, f.body)];
      const at = refOf(ctx.root, call);

      // A run function taken from a map by key and called.
      if (ts.isPropertyAccessExpression(callee) && EXEC_MEMBERS.includes(callee.name.text)) {
        const key = lookupKey(ctx, callee.expression);
        if (key !== undefined) {
          const t = ctx.checker.getTypeAtLocation(callee.expression).getNonNullableType();
          const r: RawToolCall = { at, via: 'lookup', targets: [], through, pathIds: f.pathIds };
          const id = typeIdOf(t);
          if (id !== undefined) r.elemTypeId = id;
          if (typeFromPackages(t, sdkPkgs) !== undefined) r.elemSdkTool = true;
          const lit = stringValue(key);
          if (lit !== undefined) r.literalKey = lit;
          out.push(r);
          continue;
        }
      }

      // A call that may be another tool's run function: by the declaration called,
      // by `x.execute` on a variable holding a definition, or by a variable that
      // re-exports one (`export const execute = tool.execute`).
      const d = firstDecl(calleeSymbol(ctx.checker, callee));
      const targets: string[] = [];
      if (d !== undefined && isTreeSource(d.getSourceFile().fileName)) {
        targets.push(`exec:${declIdOf(d)}`);
        if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
          const init = stripAwait(d.initializer);
          if (ts.isPropertyAccessExpression(init) && EXEC_MEMBERS.includes(init.name.text)) {
            const t = defTarget(ctx, declOfExpr(ctx, init.expression));
            if (t !== undefined) targets.push(t);
          }
        }
      }
      if (ts.isPropertyAccessExpression(callee) && EXEC_MEMBERS.includes(callee.name.text)) {
        const t = defTarget(ctx, declOfExpr(ctx, callee.expression));
        if (t !== undefined) targets.push(t);
      }
      if (targets.length > 0) out.push({ at, via: 'direct', targets, through, pathIds: f.pathIds });

      // Follow the call into the application's own function, to the stated depth.
      if (d === undefined || f.depth >= REACH_DEPTH) continue;
      const id = declIdOf(d);
      if (visited.has(id)) continue;
      const b = bodyOfDecl(ctx, d);
      if (b === undefined) continue;
      visited.add(id);
      queue.push({ body: b, through: [...through, nameOfDecl(d)], pathIds: [...f.pathIds, id], depth: f.depth + 1 });
    }
  }
  return out;
}

/** The outermost node of `sf` starting at each position asked for. */
function nodesAt(sf: ts.SourceFile, positions: ReadonlySet<number>): Map<number, ts.Node> {
  const out = new Map<number, ts.Node>();
  const visit = (n: ts.Node): void => {
    if (n.end < 0) return;
    const s = n.getStart(sf);
    if (positions.has(s) && !out.has(s)) out.set(s, n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * For the tools found in one file: the ids that ARE each run function, and the
 * candidate tool calls it reaches. Run once per file, after the signatures, so every
 * signature gets the reading without carrying it.
 */
export function reachForFile(ctx: ExtractContext, sf: ts.SourceFile, tools: FoundTool[]): void {
  const withExec = tools.filter((t) => t.tool.execute_at !== undefined);
  if (withExec.length === 0) return;
  const pos = new Map<FoundTool, number>();
  for (const t of withExec) {
    const e = t.tool.execute_at;
    if (e === undefined) continue;
    pos.set(t, sf.getPositionOfLineAndCharacter(e.line - 1, e.col - 1));
  }
  const nodes = nodesAt(sf, new Set(pos.values()));
  for (const [t, p] of pos) {
    const n = nodes.get(p);
    if (n === undefined) continue;
    const ids = new Set<string>([declIdOf(n)]);
    let value: ts.Node | undefined = n;
    if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isMethodDeclaration(n)) value = propValue(n);
    if (value !== undefined && ts.isExpression(value)) {
      const v = unwrap(value);
      if (ts.isIdentifier(v)) {
        const d = declOfExpr(ctx, v);
        if (d !== undefined) ids.add(declIdOf(d));
      } else if (isFunctionLike(v)) ids.add(declIdOf(v));
    }
    const body = value === undefined ? undefined : functionBody(value, ctx.checker);
    t.execIds = [...ids];
    t.reach = body === undefined ? [] : reachOf(ctx, body, ids);
  }
}
