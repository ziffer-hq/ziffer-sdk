/**
 * Genkit (`genkit`, `@genkit-ai/*`; record §3.21). `ai.defineTool({ name,
 * description, inputSchema }, fn)` on the instance `genkit({...})` returns -- and
 * `ai.dynamicTool(...)`, the standalone `tool(...)` -- define a tool whose `fn` is the
 * run function; `ai.defineInterrupt({ name, description, inputSchema })` defines a
 * tool with no function: the model's call pauses the run for the application to
 * answer (K2). Tools reach a model through a `tools` list, by value or by NAME (a
 * string), on `ai.generate`, `ai.generateStream`, `ai.definePrompt`, `ai.defineAgent`
 * and a session's `chat`. The place a check stands is the top of the tool function
 * (K3); an interrupt or the `toolApproval` middleware pauses for the application.
 */

import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { packagesOf } from '../sdks.js';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { arrayEntries, execCalls, hintsOf, literalOf, modelName, noteAt, schemaOfValue, type ExtractContext } from './common.js';
import type { FoundExposure, FoundTool } from './facts.js';
import { calleePackage, constString, declIdOf, firstDecl, functionBody, getProp, packageMatches, propValue, refKey, refOf, resolveAlias, unwrap } from './util.js';

const SDK = 'genkit';
const DEFINE = new Set(['defineTool', 'dynamicTool', 'tool', 'defineInterrupt']);
const EXPOSE = new Set(['generate', 'generateStream', 'definePrompt', 'defineAgent', 'chat']);
export const GENKIT_INTERCEPTION = 'Genkit runs these tools itself: a check at the top of the tool function (K3) is where ZIFFER stands, and an interrupt or the toolApproval middleware (K2) pauses the run for the application to answer.';

function genkitPackage(ctx: ExtractContext, callee: ts.Expression): string | undefined {
  const pkg = calleePackage(ctx.checker, callee);
  return packageMatches(pkg, packagesOf(SDK)) ? pkg : undefined;
}

function assignedTo(node: ts.Node): ts.VariableDeclaration | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  return n.parent !== undefined && ts.isVariableDeclaration(n.parent) ? n.parent : undefined;
}

function define(ctx: ExtractContext, call: ts.CallExpression, cn: string, pkg: string): void {
  const a0 = call.arguments[0];
  const cfg = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  if (cfg === undefined) return;
  const fnArg = cn === 'defineInterrupt' ? undefined : call.arguments[1];
  const name = modelName(ctx, SDK, propValue(getProp(cfg, 'name')), call, fnArg !== undefined && ts.isIdentifier(fnArg) ? fnArg.text : undefined);
  if (name === undefined) return;
  const schemaNode = propValue(getProp(cfg, 'inputSchema')) ?? propValue(getProp(cfg, 'inputJsonSchema'));
  const fn = cn === 'defineInterrupt' ? undefined : call.arguments[1];
  const defined_at = refOf(ctx.root, call);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(cfg, 'description')), ctx.checker) ?? '',
    ...(schemaNode !== undefined && ts.isExpression(schemaNode) ? schemaOfValue(ctx.checker, schemaNode, 'inputSchema') : { schema_kind: 'unknown' as const, params: [] }),
    sdk: SDK,
    via: cn === 'defineInterrupt' ? `defineInterrupt() from "${pkg}" (the call pauses the run for the application to answer; nothing runs)` : `${cn}() from "${pkg}"`,
    defined_at,
  };
  if (fn !== undefined) tool.execute_at = refOf(ctx.root, fn);
  // `z` taken from the application's own module (a re-export of genkit's): not followed, said.
  if (schemaNode !== undefined && tool.schema_kind !== 'zod' && localZ(call.getSourceFile())) {
    noteAt(ctx.facts, 'genkit:local-z', defined_at, (n, where) => `${n} Genkit tool(s) write their input schema with \`z\` imported from the application's own module (${where}); the scan does not follow that re-export to Zod, so their parameters are not listed.`);
  }
  const found: FoundTool = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(fn, ctx.checker), name, undefined), hints: hintsOf(cfg) };
  const v = assignedTo(call);
  if (v !== undefined) found.varId = declIdOf(v);
  ctx.facts.tools.push(found);
}

function expose(ctx: ExtractContext, call: ts.CallExpression, cn: string): void {
  const a0 = call.arguments[0];
  const opts = a0 === undefined ? undefined : literalOf(a0, ctx.checker);
  const value = opts === undefined ? undefined : propValue(getProp(opts, 'tools'));
  if (value === undefined || !ts.isExpression(value)) return;
  const e: FoundExposure = { at: refOf(ctx.root, call), via: `${cn}({ tools }) from "genkit"`, sdk: SDK, isStatic: false, entries: [], names: [], interception: GENKIT_INTERCEPTION };
  const v = unwrap(value);
  if (ts.isArrayLiteralExpression(v)) {
    // A tool may be named by a string: Genkit looks it up in its registry by that name.
    Object.assign(e, arrayEntries(ctx, v, (o) => constString(propValue(getProp(o, 'name')), ctx.checker), true));
    if (!e.isStatic) e.reason = 'an element of the list is not a tool the scan can name';
  } else {
    e.reason = 'the list is a value, not a literal';
    const s = ctx.checker.getSymbolAtLocation(v);
    const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
    if (d !== undefined) e.valueTargetId = declIdOf(d);
  }
  ctx.facts.exposures.push(e);
}

/** The file imports `z` from a relative module: the application's own re-export, not a package. */
function localZ(sf: ts.SourceFile): boolean {
  return sf.statements.some((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith('.')
    && st.importClause?.namedBindings !== undefined && ts.isNamedImports(st.importClause.namedBindings)
    && st.importClause.namedBindings.elements.some((e) => e.name.text === 'z'));
}

/**
 * After the pass, when the tree uses Genkit: `.prompt` files (Dotprompt) whose front matter
 * declares `tools:` hand those tools to a model without any code naming them.
 */
export function genkitPromptFiles(ctx: Pick<ExtractContext, 'root' | 'facts'>, textFiles: readonly string[]): void {
  const used = ctx.facts.tools.some((t) => t.tool.sdk === SDK) || ctx.facts.exposures.some((e) => e.sdk === SDK);
  if (!used) return;
  for (const file of textFiles) {
    if (!file.endsWith('.prompt')) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const line = fm?.[1]?.split(/\r?\n/).findIndex((l) => /^tools\s*:/.test(l)) ?? -1;
    if (line < 0) continue;
    noteAt(ctx.facts, 'genkit:prompt-files', { file: relative(ctx.root, file).split('\\').join('/'), line: line + 2, col: 1 }, (n, where) => `${n} Genkit .prompt file(s) declare tools in their front matter (${where}); those lists are not read, so which tools those prompts hand a model is not listed here.`);
  }
}

/** Genkit's definitions and the calls that hand tools to a model. True when the call was Genkit's. */
export function genkitCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (!DEFINE.has(cn) && !EXPOSE.has(cn)) return false;
  const pkg = genkitPackage(ctx, call.expression);
  if (pkg === undefined) return false;
  if (DEFINE.has(cn)) define(ctx, call, cn, pkg);
  else expose(ctx, call, cn);
  return true;
}
