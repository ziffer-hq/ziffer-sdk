/**
 * VS Code language model tools (record §3.19), which is how a GitHub Copilot
 * extension gives Copilot's agent mode a tool of its own. Two halves: the
 * DECLARATION is data, `contributes.languageModelTools[]` in the extension's
 * package.json (`name`, `modelDescription`, `inputSchema`); the IMPLEMENTATION is
 * registered in code, `vscode.lm.registerTool('name', impl)`, where `impl` is a
 * `LanguageModelTool` whose `invoke(options, token)` VS Code calls, and whose
 * optional `prepareInvocation` may return `confirmationMessages` (VS Code asks the
 * person first: K2, in the editor's UI only). The place a check stands is the top of
 * `invoke` (K3). The two halves are joined by the literal name.
 *
 * `@types/vscode` declares `module 'vscode'`: a resolved callee lands in
 * `@types/vscode`, an unresolved one names the specifier `vscode` (`isVscode`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

import type { CodeTool, SourceRef } from '../types.js';
import { packagesOf } from '../sdks.js';
import { execCalls, jsonSchemaParams, literalOf, note, noteAt, writtenValue, type ExtractContext } from './common.js';
import type { AuthorityClaim, FoundTool, VscodeRegistration } from './facts.js';
import { calleePackage, collect, constString, firstDecl, functionBody, getProp, packageMatches, propValue, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

const SDK = 'vscode-lm-tools';
export const VSCODE_INTERCEPTION = 'VS Code runs each of these tools by calling its invoke(); a check at the top of invoke (K3) is where ZIFFER stands, and a prepareInvocation confirmation (K2) only asks the person in the editor.';

/**
 * The module specifier `vscode` is read here and NOT listed in data/code-sdks.json: it is
 * the whole editor API, imported by every extension file, and listing it there would count
 * every such file as a tool-calling framework's in the unresolved-imports line.
 */
function isVscode(ctx: ExtractContext, callee: ts.Expression): boolean {
  return packageMatches(calleePackage(ctx.checker, callee), [...packagesOf(SDK), 'vscode']);
}

/** The method of a class or object literal by name. */
function memberOf(impl: ts.ClassLikeDeclaration | ts.ObjectLiteralExpression, name: string): ts.Node | undefined {
  if (ts.isObjectLiteralExpression(impl)) return propValue(getProp(impl, name));
  for (const m of impl.members) {
    if ((ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) && ts.isIdentifier(m.name) && m.name.text === name) {
      return ts.isPropertyDeclaration(m) ? m.initializer : m;
    }
  }
  return undefined;
}

/** `new TabCountTool()`, `{ invoke }`, or an identifier bound to either: the implementation declaration. */
function implOf(ctx: ExtractContext, arg: ts.Expression): ts.ClassLikeDeclaration | ts.ObjectLiteralExpression | undefined {
  let e = unwrap(arg);
  if (ts.isIdentifier(e)) {
    const lit = literalOf(e, ctx.checker);
    if (lit !== undefined) return lit;
    const s = ctx.checker.getSymbolAtLocation(e);
    const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) e = unwrap(d.initializer);
  }
  if (ts.isObjectLiteralExpression(e)) return e;
  if (!ts.isNewExpression(e)) return undefined;
  const s = ctx.checker.getSymbolAtLocation(e.expression);
  const d = s === undefined ? undefined : firstDecl(resolveAlias(ctx.checker, s));
  return d !== undefined && (ts.isClassDeclaration(d) || ts.isClassExpression(d)) ? d : undefined;
}

/** `confirmationMessages` returned by `prepareInvocation`: the application's claim that the person is asked first. */
function confirmationClaims(prepare: ts.Node | undefined, checker: ts.TypeChecker): AuthorityClaim[] {
  const body = functionBody(prepare, checker);
  if (body === undefined) return [];
  for (const o of collect(body, ts.isObjectLiteralExpression)) {
    const p = getProp(o, 'confirmationMessages');
    const v = propValue(p);
    if (p !== undefined) return [{ name: 'confirmationMessages', value: v === undefined ? '' : writtenValue(v) }];
  }
  return [];
}

/** `vscode.lm.registerTool(name, impl)` and a `sendRequest` offered `vscode.lm.tools`. True when the call was VS Code's. */
export function vscodeCall(ctx: ExtractContext, call: ts.CallExpression, cn: string): boolean {
  if (cn !== 'registerTool' && cn !== 'sendRequest' && cn !== 'sendChatParticipantRequest' && cn !== 'registerMcpServerDefinitionProvider') return false;
  if (!isVscode(ctx, call.expression)) return false;
  if (cn === 'registerMcpServerDefinitionProvider') {
    // An extension handing the editor MCP servers (Copilot's own extension surface): their tools are listed at runtime.
    ctx.facts.mcpClients.push(refOf(ctx.root, call));
    return true;
  }
  if (cn === 'sendChatParticipantRequest') {
    const opts = call.arguments[2] === undefined ? undefined : literalOf(call.arguments[2], ctx.checker);
    if (opts === undefined || getProp(opts, 'tools') === undefined) return true;
    ctx.facts.exposures.push({
      at: refOf(ctx.root, call),
      via: 'sendChatParticipantRequest(request, context, { tools }) from "@vscode/chat-extension-utils"',
      sdk: SDK,
      isStatic: false,
      entries: [],
      names: [],
      reason: 'the list is a value, usually taken from vscode.lm.tools, which holds every tool installed in the editor, other extensions\' included',
      interception: 'The library runs each tool the model calls through VS Code, which calls the tool\'s invoke() (K3).',
    });
    return true;
  }
  if (cn === 'sendRequest') {
    // A chat participant that hands the editor's tool list to a model and dispatches the calls itself (K4).
    const sf = call.getSourceFile();
    const readsLmTools = collect(sf, ts.isPropertyAccessExpression).some((p) => p.name.text === 'tools' && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'lm');
    if (!readsLmTools) return true;
    ctx.facts.exposures.push({
      at: refOf(ctx.root, call),
      via: 'LanguageModelChat.sendRequest(messages, { tools })',
      sdk: SDK,
      isStatic: false,
      entries: [],
      names: [],
      reason: 'the list is chosen at runtime from vscode.lm.tools, which holds every tool installed in the editor, other extensions\' included',
      interception: 'This extension receives the model\'s tool calls and has them run (K4); each tool it runs still passes its own invoke().',
      point: { kind: 'K4', name: 'the extension\'s own loop over the model\'s tool calls', present: true },
    });
    return true;
  }
  const at = refOf(ctx.root, call);
  const name = constString(call.arguments[0], ctx.checker);
  if (name === undefined) {
    noteAt(ctx.facts, 'vscode-lm-tools:computed-name', at, (n, where) => `${n} vscode.lm.registerTool() call(s) register a tool under a computed name (${where}); a declaration in package.json is listed, and such a registration is not joined to it.`);
    return true;
  }
  const a1 = call.arguments[1];
  const impl = a1 === undefined ? undefined : implOf(ctx, a1);
  const reg: VscodeRegistration = { name, at, calls: [], hints: [] };
  if (impl !== undefined) {
    const invoke = memberOf(impl, 'invoke');
    if (invoke !== undefined) {
      reg.invokeAt = refOf(ctx.root, invoke);
      reg.calls = execCalls(ctx, functionBody(invoke, ctx.checker), name, undefined);
    }
    reg.hints = confirmationClaims(memberOf(impl, 'prepareInvocation'), ctx.checker);
  }
  ctx.facts.vscodeRegistrations.push(reg);
  return true;
}

interface Declared {
  name: string;
  at: SourceRef;
  description: string;
  params: string[];
  schema: boolean;
  manifestDir: string;
}

function jsonObject(n: ts.Node | undefined): ts.ObjectLiteralExpression | undefined {
  return n !== undefined && ts.isObjectLiteralExpression(n) ? n : undefined;
}

/** The `languageModelTools` declarations of one package.json, read from the JSON syntax tree so every one has its line. */
function declaredIn(root: string, file: string): { list?: SourceRef; tools: Declared[] } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { tools: [] };
  }
  if (!text.includes('languageModelTools')) return { tools: [] };
  // `createSourceFile` with parents set, so every node can say its own line (`parseJsonText` sets none).
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
  const st = sf.statements[0];
  const top = jsonObject(st !== undefined && ts.isExpressionStatement(st) ? st.expression : undefined);
  const contributes = top === undefined ? undefined : jsonObject(propValue(getProp(top, 'contributes')));
  const listProp = contributes === undefined ? undefined : getProp(contributes, 'languageModelTools');
  const list = propValue(listProp);
  if (listProp === undefined || list === undefined || !ts.isArrayLiteralExpression(list)) return { tools: [] };
  const tools: Declared[] = [];
  for (const el of list.elements) {
    const o = jsonObject(el);
    if (o === undefined) continue;
    const name = stringValue(propValue(getProp(o, 'name')));
    if (name === undefined) continue;
    const schema = propValue(getProp(o, 'inputSchema'));
    const params = jsonSchemaParams(schema);
    tools.push({
      name,
      at: refOf(root, o),
      description: stringValue(propValue(getProp(o, 'modelDescription'))) ?? stringValue(propValue(getProp(o, 'userDescription'))) ?? '',
      params: params ?? [],
      schema: params !== undefined,
      manifestDir: dirname(file),
    });
  }
  return { list: refOf(root, listProp), tools };
}

/**
 * After the pass: every declared tool, joined by name to its registration (the
 * nearest manifest above the registering file wins a name declared twice), and every
 * registration no manifest declares. One exposure per manifest that declares tools.
 */
export function vscodeManifests(ctx: Pick<ExtractContext, 'root' | 'facts'>, packageJsons: readonly string[]): void {
  const regs = ctx.facts.vscodeRegistrations;
  const joined = new Set<VscodeRegistration>();
  for (const file of packageJsons) {
    const { list, tools } = declaredIn(ctx.root, file);
    if (list === undefined || tools.length === 0) continue;
    const rel = relative(ctx.root, file).split('\\').join('/');
    for (const d of tools) {
      const reg = regs.find((r) => r.name === d.name && !relative(d.manifestDir, join(ctx.root, r.at.file)).startsWith('..')) ?? regs.find((r) => r.name === d.name);
      const tool: CodeTool = {
        name: d.name,
        description: d.description,
        schema_kind: d.schema ? 'json_schema' : 'unknown',
        params: d.params,
        sdk: SDK,
        via: reg !== undefined ? `contributes.languageModelTools in ${rel}, run by vscode.lm.registerTool()` : `contributes.languageModelTools in ${rel} (no vscode.lm.registerTool() for it was found)`,
        defined_at: d.at,
      };
      const found: FoundTool = { tool, key: refKey(d.at), calls: [], hints: [] };
      if (reg !== undefined) {
        joined.add(reg);
        if (reg.invokeAt !== undefined) tool.execute_at = reg.invokeAt;
        found.calls = reg.calls;
        found.hints = reg.hints;
      }
      ctx.facts.tools.push(found);
    }
    ctx.facts.exposures.push({
      at: list,
      via: 'contributes.languageModelTools (offered to VS Code chat and Copilot agent mode)',
      sdk: SDK,
      isStatic: true,
      entries: [],
      names: tools.map((t) => t.name),
      interception: VSCODE_INTERCEPTION,
    });
  }
  for (const r of regs) {
    if (joined.has(r)) continue;
    const tool: CodeTool = { name: r.name, description: '', schema_kind: 'unknown', params: [], sdk: SDK, via: 'vscode.lm.registerTool() (not declared in a package.json contributes.languageModelTools)', defined_at: r.at };
    if (r.invokeAt !== undefined) tool.execute_at = r.invokeAt;
    ctx.facts.tools.push({ tool, key: refKey(r.at), calls: r.calls, hints: r.hints });
  }
  const first = ctx.facts.tools.find((t) => t.tool.sdk === SDK);
  if (first !== undefined) {
    note(ctx.facts, 'vscode-lm-tools:runtime', 'VS Code language model tools are listed as the extension declares them; which of them a given chat offers is decided in the editor at runtime (the declaration\'s `when` clause, the tools the person has enabled), and tools other extensions contribute are not in this tree.', first.tool.defined_at);
  }
}
