/**
 * One pass over the tree's own files in one type-checked program: every tool
 * definition the milestone-1 signatures recognise, every place a tool set is
 * handed to a model, every loop that builds a tool set at runtime, and every
 * candidate runtime gate. Each recogniser decides by what the CHECKER says a
 * symbol or a type is, never by how an identifier is spelled -- `tool(` from
 * LangChain and `tool(` from the AI SDK are one string and two frameworks.
 */

import { builtinModules } from 'node:module';
import ts from 'typescript';

import type { CodeTool } from '../types.js';
import { entryForPackage, packagesOf } from '../sdks.js';
import {
  arrayEntries,
  execCalls,
  modelName,
  exposureOfMap,
  execMember,
  hintsOf,
  isStringish,
  isZodType,
  jsonSchemaParams,
  propType,
  qualifiedTypeName,
  schemaOf,
  typeFromPackages,
  typeIdOf,
  typeSymbol,
  EXEC_MEMBERS,
  type ExtractContext,
} from './common.js';
import type { ExposureEntry, FoundBridge, FoundExposure, FoundTool, GateCandidate } from './facts.js';
import { geminiCall, geminiLiteral } from './sig-gemini.js';
import { functionToolLiteral, functionToolsCall, openaiHelper } from './sig-functions.js';
import { langchainCall, langchainClass, langchainNew } from './sig-langchain.js';
import { mcpCall } from './sig-mcp.js';
import { agentsCall, agentsNew } from './sig-agents.js';
import { vscodeCall } from './sig-vscode.js';
import { claudeAgentCall, claudeAgentOptions } from './sig-claude-agent.js';
import { bedrockCall, bedrockLiteral, bedrockNew } from './sig-bedrock.js';
import { mastraCall, mastraNew } from './sig-mastra.js';
import { genkitCall } from './sig-genkit.js';
import { llamaindexCall, llamaindexNew } from './sig-llamaindex.js';
import { structuredOutput } from './sig-structured.js';
import { reachForFile } from './reach.js';
import { replyDispatch } from './sig-reply.js';
import {
  calleeExportName,
  calleeName,
  calleeSymbol,
  collect,
  constString,
  declIdOf,
  dottedName,
  enclosingFunction,
  firstDecl,
  functionBody,
  functionName,
  getProp,
  insideLoop,
  isTreeSource,
  packageMatches,
  packageOfFile,
  packageOfSpecifier,
  propValue,
  propertyNameText,
  refKey,
  refOf,
  resolveAlias,
  stringValue,
  calleePackage,
  unwrap,
} from './util.js';

export type { ExtractContext } from './common.js';

const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules);
const AI_TOOL_FNS = new Set(['tool', 'dynamicTool']);
const AI_CALL_FNS = new Set(['generateText', 'streamText', 'generateObject', 'streamObject']);
const AI_AGENT_CLASSES = new Set(['ToolLoopAgent', 'Experimental_Agent', 'Agent']);
const ANTHROPIC_HELPERS = new Set(['betaZodTool', 'betaTool', 'betaStandardSchemaTool']);
const ANTHROPIC_CALL_RE = /(^|\.)messages\.(create|stream|toolRunner|parse)$/;
const MCP_CLIENT_FNS = new Set(['createMCPClient', 'experimental_createMCPClient', 'mcpToTool']);

// ---------------------------------------------------------------- AI SDK

interface NamePosition {
  name?: string;
  varId?: string;
  /** The declaration of the function that RETURNS the definition (`const createDocument = (props) => tool({...})`). */
  factoryId?: string;
  bridge?: { keyName?: string; targetId?: string };
}

/**
 * A definition returned by a function of the tree -- the arrow's body, or a
 * `return` -- takes the function's name until an exposure keys it: the tools map
 * `{ createDocument: createDocument({ session }) }` renames it through `factoryId`.
 */
function factoryPosition(n: ts.Node): NamePosition | undefined {
  const p = n.parent;
  if (p === undefined) return undefined;
  let fn: ts.Node | undefined;
  if (ts.isArrowFunction(p) && p.body === n) fn = p;
  else if (ts.isReturnStatement(p)) fn = enclosingFunction(p);
  if (fn === undefined || insideLoop(n)) return undefined;
  const name = functionName(fn);
  if (name === undefined) return undefined;
  const decl = fn.parent !== undefined && ts.isVariableDeclaration(fn.parent) ? fn.parent : fn;
  return { name, factoryId: declIdOf(decl) };
}

/** Where a definition's value lands decides its name: a map key, a variable, or a computed key (a bridge). */
function namePosition(ctx: ExtractContext, call: ts.Expression): NamePosition {
  let n: ts.Node = call;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isAwaitExpression(n.parent))) n = n.parent;
  const p = n.parent;
  if (p === undefined) return {};
  if (ts.isPropertyAssignment(p) && p.initializer === n) {
    const key = propertyNameText(p.name);
    if (key !== undefined) return { name: key };
    return { bridge: {} };
  }
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === n) {
    const left = p.left;
    if (ts.isElementAccessExpression(left)) {
      const lit = stringValue(left.argumentExpression);
      if (lit !== undefined) return { name: lit };
      const target = ctx.checker.getSymbolAtLocation(left.expression);
      const td = firstDecl(target);
      const bridge: { keyName?: string; targetId?: string } = {};
      if (ts.isIdentifier(left.argumentExpression)) bridge.keyName = left.argumentExpression.text;
      if (td !== undefined) bridge.targetId = declIdOf(td);
      return { bridge };
    }
    if (ts.isPropertyAccessExpression(left)) return { name: left.name.text };
  }
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return { name: p.name.text, varId: declIdOf(p) };
  if (ts.isArrayLiteralExpression(p) && insideLoop(p)) return { bridge: {} };
  if (insideLoop(n)) return { bridge: {} };
  return factoryPosition(n) ?? {};
}

function handlerType(ctx: ExtractContext, arg: ts.ObjectLiteralExpression): { id?: string; name?: string } {
  for (const m of ['inputSchema', 'parameters', 'description']) {
    const v = propValue(getProp(arg, m));
    if (v !== undefined && ts.isPropertyAccessExpression(v)) {
      const t = ctx.checker.getTypeAtLocation(v.expression);
      const id = typeIdOf(t);
      const s = typeSymbol(t);
      const out: { id?: string; name?: string } = {};
      if (id !== undefined) out.id = id;
      if (s !== undefined) out.name = s.getName();
      return out;
    }
  }
  return {};
}

function aiTool(ctx: ExtractContext, call: ts.CallExpression, fnName: string): void {
  const arg = call.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return;
  const pos = namePosition(ctx, call);
  const exec = execMember(arg);
  if (pos.bridge !== undefined) {
    const ht = handlerType(ctx, arg);
    const b: FoundBridge = {
      at: refOf(ctx.root, call),
      via: `${fnName}() in a loop`,
      sdk: 'ai',
      calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), undefined, pos.bridge.keyName),
    };
    if (pos.bridge.keyName !== undefined) b.keyName = pos.bridge.keyName;
    if (pos.bridge.targetId !== undefined) b.targetId = pos.bridge.targetId;
    if (ht.id !== undefined) b.handlerTypeId = ht.id;
    if (ht.name !== undefined) b.handlerTypeName = ht.name;
    ctx.facts.bridges.push(b);
    return;
  }
  const defined_at = refOf(ctx.root, call);
  const name = pos.name ?? '(unnamed)';
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(arg, 'description')), ctx.checker) ?? '',
    ...schemaOf(ctx.checker, arg),
    sdk: 'ai',
    via: `${fnName}() from "ai"`,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const found: FoundTool = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), name, undefined), hints: hintsOf(arg) };
  if (pos.varId !== undefined) found.varId = pos.varId;
  if (pos.factoryId !== undefined) found.factoryId = pos.factoryId;
  ctx.facts.tools.push(found);
}

function aiExposure(ctx: ExtractContext, call: ts.CallExpression | ts.NewExpression, via: string): void {
  const arg = call.arguments?.[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return;
  const p = getProp(arg, 'tools');
  const value = propValue(p);
  if (p === undefined || value === undefined) return;
  const sym = ts.isShorthandPropertyAssignment(p) ? ctx.checker.getShorthandAssignmentValueSymbol(p) : undefined;
  ctx.facts.exposures.push({ at: refOf(ctx.root, call), via, sdk: 'ai', ...exposureOfMap(ctx, value, sym) });
}

// ---------------------------------------------------------------- Anthropic

function isAnthropicCallArray(node: ts.Node): ts.CallExpression | undefined {
  // node is an element of an array literal that is the `tools` member of a call's first argument.
  const arr = node.parent;
  if (arr === undefined || !ts.isArrayLiteralExpression(arr)) return undefined;
  const pa = arr.parent;
  if (pa === undefined || !ts.isPropertyAssignment(pa) || propertyNameText(pa.name) !== 'tools') return undefined;
  const obj = pa.parent;
  const call = obj.parent;
  if (call === undefined || !ts.isCallExpression(call)) return undefined;
  const dn = dottedName(call.expression);
  return dn !== undefined && ANTHROPIC_CALL_RE.test(dn) ? call : undefined;
}

function anthropicLiteral(ctx: ExtractContext, obj: ts.ObjectLiteralExpression): void {
  const nameNode = propValue(getProp(obj, 'name'));
  const schema = getProp(obj, 'input_schema');
  if (schema === undefined) return;
  const name = modelName(ctx, 'anthropic', nameNode, obj);
  if (name === undefined) return;
  // A literal handed to the tree's own factory is that factory's (S-LOCAL), not a second definition.
  const parent = obj.parent;
  if (parent !== undefined && ts.isCallExpression(parent) && parent.arguments.some((a) => a === obj)) {
    const d = firstDecl(calleeSymbol(ctx.checker, parent.expression));
    if (d !== undefined && isTreeSource(d.getSourceFile().fileName)) return;
  }
  const inCall = isAnthropicCallArray(obj);
  const ctxType = ctx.checker.getContextualType(obj);
  const typed = ctxType !== undefined && typeFromPackages(ctxType, packagesOf('anthropic')) !== undefined;
  if (inCall === undefined && !typed) return;
  const defined_at = refOf(ctx.root, obj);
  const via = inCall !== undefined ? `tools[] on ${dottedTail(inCall.expression)}` : 'Tool object typed from "@anthropic-ai/sdk"';
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(obj, 'description')), ctx.checker) ?? '',
    schema_kind: 'json_schema',
    params: jsonSchemaParams(propValue(schema), ctx.checker) ?? [],
    sdk: 'anthropic',
    via,
    defined_at,
  };
  const found: FoundTool = { tool, key: refKey(defined_at), calls: [], hints: hintsOf(obj) };
  const p = obj.parent;
  if (p !== undefined && ts.isVariableDeclaration(p)) found.varId = declIdOf(p);
  ctx.facts.tools.push(found);
}

function dottedTail(e: ts.Expression): string {
  const dn = dottedName(e) ?? '';
  const i = dn.indexOf('messages.');
  const j = dn.lastIndexOf('beta.messages.');
  return j >= 0 ? dn.slice(j) : i >= 0 ? dn.slice(i) : dn;
}

function anthropicHelper(ctx: ExtractContext, call: ts.CallExpression, fnName: string): void {
  const arg = call.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return;
  const name = modelName(ctx, 'anthropic', propValue(getProp(arg, 'name')), call);
  if (name === undefined) return;
  const defined_at = refOf(ctx.root, call);
  const exec = execMember(arg);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(arg, 'description')), ctx.checker) ?? '',
    ...schemaOf(ctx.checker, arg),
    sdk: 'anthropic',
    via: `${fnName}() from "@anthropic-ai/sdk"`,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  ctx.facts.tools.push({ tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), name, undefined), hints: hintsOf(arg) });
}

function anthropicExposure(ctx: ExtractContext, call: ts.CallExpression): void {
  const arg = call.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return;
  const p = getProp(arg, 'tools');
  const value = propValue(p);
  if (p === undefined || value === undefined) return;
  const via = `${dottedTail(call.expression)}({ tools })`;
  const v = ts.isExpression(value) ? unwrap(value) : value;
  if (ts.isArrayLiteralExpression(v)) {
    const r = arrayEntries(ctx, v, (o) => stringValue(propValue(getProp(o, 'name'))));
    const e: FoundExposure = { at: refOf(ctx.root, call), via, sdk: 'anthropic', ...r };
    if (!r.isStatic) e.reason = 'an element of the array is not a literal tool';
    ctx.facts.exposures.push(e);
    return;
  }
  const e: FoundExposure = { at: refOf(ctx.root, call), via, sdk: 'anthropic', isStatic: false, entries: [], names: [], reason: 'the array is a value, not a literal' };
  const sym = ts.isShorthandPropertyAssignment(p) ? ctx.checker.getShorthandAssignmentValueSymbol(p) : ts.isExpression(v) ? ctx.checker.getSymbolAtLocation(v) : undefined;
  const d = sym === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, sym));
  if (d !== undefined) e.valueTargetId = declIdOf(d);
  ctx.facts.exposures.push(e);
}

// ---------------------------------------------------------------- S-LOCAL

/**
 * S-LOCAL (record §2.1): a call to a function declared in the TREE whose resolved
 * return type has `name: string` and `description: string` and either a member
 * whose type is declared by a known tool SDK, or a Zod-typed member beside a
 * function member named like an execute body. The name and description are read
 * from the argument literal; a call with no literal name defines nothing.
 */
function localFactory(ctx: ExtractContext, call: ts.CallExpression): void {
  const arg = call.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return;
  const name = stringValue(propValue(getProp(arg, 'name')), ctx.checker);
  if (name === undefined) return;
  const sym = calleeSymbol(ctx.checker, call.expression);
  const decl = firstDecl(sym);
  if (decl === undefined || !isTreeSource(decl.getSourceFile().fileName)) return;
  const sig = ctx.checker.getResolvedSignature(call);
  if (sig === undefined) return;
  const rt = ctx.checker.getReturnTypeOfSignature(sig);
  if (!isStringish(propType(ctx.checker, rt, 'name', call)) || !isStringish(propType(ctx.checker, rt, 'description', call))) return;

  const sdkPackages = [...packagesOf('anthropic'), ...packagesOf('ai')];
  let returns: string | undefined;
  let zodMember: string | undefined;
  let execName: string | undefined;
  for (const p of ctx.checker.getPropertiesOfType(rt)) {
    const pt = ctx.checker.getTypeOfSymbolAtLocation(p, call);
    const pkg = typeFromPackages(pt, sdkPackages);
    if (pkg !== undefined && returns === undefined) {
      returns = `${p.getName()} typed ${qualifiedTypeName(ctx.checker, pt)} from "${pkg}"`;
    }
    if (zodMember === undefined && isZodType(pt)) zodMember = p.getName();
    if (execName === undefined && EXEC_MEMBERS.includes(p.getName()) && pt.getNonNullableType().getCallSignatures().length > 0) execName = p.getName();
  }
  if (returns === undefined) {
    if (zodMember === undefined || execName === undefined) return;
    returns = `a Zod schema (${zodMember}) and ${execName}()`;
  }
  const rtName = typeSymbol(rt)?.getName();
  const factory = calleeName(call.expression) ?? 'factory';
  const defined_at = refOf(ctx.root, call);
  const exec = execMember(arg);
  const tool: CodeTool = {
    name,
    description: constString(propValue(getProp(arg, 'description')), ctx.checker) ?? '',
    ...schemaOf(ctx.checker, arg),
    sdk: 'local',
    via: `${factory}() (app-local factory, returns ${rtName !== undefined && rtName !== '__type' ? `${rtName} with ` : ''}${returns})`,
    defined_at,
  };
  if (exec !== undefined) tool.execute_at = refOf(ctx.root, exec);
  const found: FoundTool = { tool, key: refKey(defined_at), calls: execCalls(ctx, functionBody(propValue(exec), ctx.checker), name, undefined), hints: hintsOf(arg) };
  const tid = typeIdOf(rt);
  if (tid !== undefined) found.typeId = tid;
  const p = call.parent;
  if (p !== undefined && ts.isVariableDeclaration(p)) found.varId = declIdOf(p);
  ctx.facts.tools.push(found);
}

// ---------------------------------------------------------------- gates

interface FnTaint {
  tainted: Set<string>;
  callee?: string;
}

const taintCache = new WeakMap<ts.Node, FnTaint>();

/** Variables in `fn` whose value flows from an awaited call to a function declared in another file. */
function taintOf(ctx: ExtractContext, fn: ts.FunctionLikeDeclaration): FnTaint {
  const hit = taintCache.get(fn);
  if (hit !== undefined) return hit;
  const out: FnTaint = { tainted: new Set() };
  const body = fn.body;
  if (body !== undefined) {
    const own = fn.getSourceFile().fileName;
    for (const aw of collect(body, ts.isAwaitExpression)) {
      const e = unwrap(aw.expression);
      if (!ts.isCallExpression(e)) continue;
      const d = firstDecl(calleeSymbol(ctx.checker, e.expression));
      if (d === undefined || d.getSourceFile().fileName === own) continue;
      const vd = aw.parent;
      if (vd !== undefined && ts.isVariableDeclaration(vd) && ts.isIdentifier(vd.name)) {
        out.tainted.add(vd.name.text);
        const spelled = dottedName(e.expression) ?? calleeName(e.expression);
        if (out.callee === undefined && spelled !== undefined) out.callee = spelled;
      }
    }
    if (out.tainted.size > 0) {
      for (const vd of collect(body, ts.isVariableDeclaration)) {
        if (!ts.isIdentifier(vd.name) || vd.initializer === undefined || out.tainted.has(vd.name.text)) continue;
        if (collect(vd.initializer, ts.isIdentifier).some((i) => out.tainted.has(i.text))) out.tainted.add(vd.name.text);
      }
    }
  }
  taintCache.set(fn, out);
  return out;
}

function gateCandidate(ctx: ExtractContext, call: ts.CallExpression): void {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'filter') return;
  const cb = call.arguments[0];
  if (cb === undefined) return;
  const fn = enclosingFunction(call);
  if (fn === undefined) return;
  const taint = taintOf(ctx, fn);
  if (taint.tainted.size === 0 || taint.callee === undefined) return;
  if (!collect(cb, ts.isIdentifier).some((i) => taint.tainted.has(i.text))) return;
  const recv = call.expression.expression;
  const elem = ctx.checker.getIndexTypeOfType(ctx.checker.getTypeAtLocation(recv), ts.IndexKind.Number);
  if (elem === undefined) return;
  const elemTypeId = typeIdOf(elem);
  if (elemTypeId === undefined) return;
  const fnName = functionName(fn);
  if (fnName === undefined) return;
  // A gate RETURNS tools: a function that filters the list only to report on it (a
  // coherence check, a metric) narrows nothing a model sees.
  const sig = ctx.checker.getSignatureFromDeclaration(fn);
  if (sig === undefined) return;
  const ret = ctx.checker.getAwaitedType(ctx.checker.getReturnTypeOfSignature(sig));
  const retElem = ret === undefined ? undefined : ctx.checker.getIndexTypeOfType(ret, ts.IndexKind.Number) ?? ctx.checker.getIndexTypeOfType(ret, ts.IndexKind.String);
  if (retElem === undefined) return;
  const retElemTypeId = typeIdOf(retElem);
  if (retElemTypeId === undefined) return;
  const g: GateCandidate = { fnName, at: refOf(ctx.root, fn), callee: taint.callee, listText: recv.getText(), elemTypeId, retElemTypeId };
  const rd = firstDecl(typeSymbol(retElem));
  const rp = rd === undefined ? undefined : packageOfFile(rd.getSourceFile().fileName);
  if (rp !== undefined) g.retElemPackage = rp;
  const pkg = firstDecl(typeSymbol(elem));
  const ep = pkg === undefined ? undefined : packageOfFile(pkg.getSourceFile().fileName);
  if (ep !== undefined) g.elemPackage = ep;
  ctx.facts.gates.push(g);
}

// ---------------------------------------------------------------- the pass

function isDynamicLoad(call: ts.CallExpression): boolean {
  const a0 = call.arguments[0];
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) return a0 === undefined || stringValue(a0) === undefined;
  if (ts.isIdentifier(call.expression) && call.expression.text === 'require') return a0 === undefined || stringValue(a0) === undefined;
  return ts.isIdentifier(call.expression) && call.expression.text === 'eval';
}

/**
 * Bare imports the checker could not resolve (a clone with no `node_modules`): the
 * file is still read, its framework calls recognised through the import
 * declarations, and the count is reported because type-based readings (a literal
 * typed by an SDK, a factory's return type) are weaker without the types.
 */
function noteUnresolved(ctx: ExtractContext, sf: ts.SourceFile): void {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const pkg = packageOfSpecifier(st.moduleSpecifier.text);
    // A Node built-in written without `node:` is not a package anyone installs.
    if (pkg === undefined || NODE_BUILTINS.has(pkg) || ctx.checker.getSymbolAtLocation(st.moduleSpecifier) !== undefined) continue;
    ctx.facts.unresolvedFiles.add(sf.fileName);
    if (entryForPackage(pkg) !== undefined) ctx.facts.unresolvedFrameworkFiles.add(sf.fileName);
  }
}

export function extractFile(ctx: ExtractContext, sf: ts.SourceFile): void {
  const { checker } = ctx;
  noteUnresolved(ctx, sf);
  const aiPkgs = packagesOf('ai');
  const anthropicPkgs = packagesOf('anthropic');
  const firstTool = ctx.facts.tools.length;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const cn = calleeExportName(checker, node.expression);
      if (isDynamicLoad(node)) ctx.facts.dynamicFiles.add(sf.fileName);
      replyDispatch(ctx, node);
      if (cn !== undefined) {
        // Structured output is said, never counted (record §3.17): read beside whatever else the call is.
        structuredOutput(ctx, node, cn);
        const pkgOf = (): string | undefined => calleePackage(checker, node.expression);
        let handled = true;
        if (AI_TOOL_FNS.has(cn) && packageMatches(pkgOf(), aiPkgs)) aiTool(ctx, node, cn);
        else if (AI_CALL_FNS.has(cn) && packageMatches(pkgOf(), aiPkgs)) aiExposure(ctx, node, `${cn}({ tools })`);
        else if (ANTHROPIC_HELPERS.has(cn) && packageMatches(pkgOf(), anthropicPkgs)) anthropicHelper(ctx, node, cn);
        else if (ANTHROPIC_CALL_RE.test(dottedName(node.expression) ?? '') && packageMatches(pkgOf(), anthropicPkgs)) anthropicExposure(ctx, node);
        else if (openaiHelper(ctx, node) || functionToolsCall(ctx, node) || geminiCall(ctx, node) || mcpCall(ctx, node, cn) || langchainCall(ctx, node, cn) || agentsCall(ctx, node, cn) || vscodeCall(ctx, node, cn) || claudeAgentCall(ctx, node, cn) || bedrockCall(ctx, node, cn) || mastraCall(ctx, node, cn) || genkitCall(ctx, node, cn) || llamaindexCall(ctx, node, cn)) handled = true;
        else if (MCP_CLIENT_FNS.has(cn)) ctx.facts.mcpClients.push(refOf(ctx.root, node));
        else if (cn === 'filter') gateCandidate(ctx, node);
        else handled = false;
        if (!handled) {
          const a0 = node.arguments[0];
          if (a0 !== undefined && ts.isObjectLiteralExpression(a0) && getProp(a0, 'name') !== undefined) localFactory(ctx, node);
        }
        // Provider tools: `<provider>.tools.<name>(...)` on an `@ai-sdk/*` provider.
        const ce = node.expression;
        if (ts.isPropertyAccessExpression(ce) && ts.isPropertyAccessExpression(ce.expression) && ce.expression.name.text === 'tools') {
          if (packageMatches(calleePackage(checker, ce.expression.expression), ['@ai-sdk/*'])) ctx.facts.providerTools.push({ at: refOf(ctx.root, node), text: ce.getText() });
        }
      }
    } else if (ts.isNewExpression(node)) {
      const cn = calleeExportName(checker, node.expression);
      if (cn !== undefined && AI_AGENT_CLASSES.has(cn) && packageMatches(calleePackage(checker, node.expression), aiPkgs)) aiExposure(ctx, node, `new ${cn}({ tools })`);
      else if (langchainNew(ctx, node)) {
        // a LangChain tool class or ToolNode
      } else if (agentsNew(ctx, node)) {
        // an OpenAI Agents SDK agent handed its tools
      } else if (bedrockNew(ctx, node)) {
        // a Bedrock Converse command handed its toolConfig
      } else if (mastraNew(ctx, node)) {
        // a Mastra agent or instance handed its tools map
      } else if (llamaindexNew(ctx, node)) {
        // a LlamaIndex tool or agent class
      } else if (cn === 'Client' && packageMatches(calleePackage(checker, node.expression), packagesOf('mcp'))) ctx.facts.mcpClients.push(refOf(ctx.root, node));
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      langchainClass(ctx, node);
    } else if (ts.isObjectLiteralExpression(node)) {
      if (getProp(node, 'toolSpec') !== undefined) bedrockLiteral(ctx, node);
      else if (getProp(node, 'input_schema') !== undefined) anthropicLiteral(ctx, node);
      else if (getProp(node, 'function') !== undefined || getProp(node, 'type') !== undefined || getProp(node, 'parameterDefinitions') !== undefined) functionToolLiteral(ctx, node);
      else if (getProp(node, 'name') !== undefined && (getProp(node, 'parameters') !== undefined || getProp(node, 'parametersJsonSchema') !== undefined || getProp(node, 'description') !== undefined)) geminiLiteral(ctx, node);
      if (getProp(node, 'mcp_servers') !== undefined) ctx.facts.mcpClients.push(refOf(ctx.root, node));
      if (getProp(node, 'allowedTools') !== undefined) claudeAgentOptions(ctx, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  reachForFile(ctx, sf, ctx.facts.tools.slice(firstTool));
  ctx.facts.filesRead += 1;
}
