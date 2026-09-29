/**
 * The syntax-only pass: signatures (a) AI SDK, (b) Anthropic and (c) the OpenAI
 * Agents SDK's `tool({...})` evaluated by import NAME only, with no type checker,
 * over the same files. It exists to be
 * measured against the checked pass -- `syntax_only.missed` is what a regex- or
 * AST-only scanner would have printed as absent -- so it must stay as naive as a
 * good syntax-only scanner would be, and no naiver: it follows aliases in the
 * import clause and namespace imports, which a careful syntax scanner does.
 */

import ts from 'typescript';

import { calleeName, dottedName, getProp, insideLoop, propValue, propertyNameText, refKey, refOf, stringValue, unwrap } from './util.js';

const AI_MODULES = ['ai', '@ai-sdk/provider-utils'];
const ANTHROPIC_RE = /^@anthropic-ai\/sdk(\/|$)/;
/** `@openai/agents`, `@openai/agents/realtime`, `@openai/agents-core`, `@openai/agents-openai`, ... */
const AGENTS_RE = /^@openai\/agents(-[a-z]+)?(\/|$)/;
const ANTHROPIC_CALL_RE = /(^|\.)messages\.(create|stream|toolRunner|parse)$/;

interface Imports {
  aiTool: Set<string>;
  aiNamespaces: Set<string>;
  anthropic: boolean;
  /** Local names `tool` from an OpenAI Agents SDK module is bound to, and namespace imports of one. */
  agentsTool: Set<string>;
  agentsNamespaces: Set<string>;
}

function importsOf(sf: ts.SourceFile): Imports {
  const out: Imports = { aiTool: new Set(), aiNamespaces: new Set(), anthropic: false, agentsTool: new Set(), agentsNamespaces: new Set() };
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const mod = st.moduleSpecifier.text;
    if (ANTHROPIC_RE.test(mod)) out.anthropic = true;
    if (AGENTS_RE.test(mod)) {
      const nb = st.importClause?.namedBindings;
      if (nb !== undefined && ts.isNamespaceImport(nb)) out.agentsNamespaces.add(nb.name.text);
      else if (nb !== undefined) for (const el of nb.elements) if ((el.propertyName ?? el.name).text === 'tool') out.agentsTool.add(el.name.text);
      continue;
    }
    if (!AI_MODULES.includes(mod)) continue;
    const nb = st.importClause?.namedBindings;
    if (nb === undefined) continue;
    if (ts.isNamespaceImport(nb)) out.aiNamespaces.add(nb.name.text);
    else {
      for (const el of nb.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (imported === 'tool' || imported === 'dynamicTool') out.aiTool.add(el.name.text);
      }
    }
  }
  return out;
}

function isBridgeSite(call: ts.Node): boolean {
  let n: ts.Node = call;
  while (n.parent !== undefined && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent))) n = n.parent;
  const p = n.parent;
  if (p === undefined) return false;
  if (ts.isPropertyAssignment(p) && p.initializer === n) return propertyNameText(p.name) === undefined;
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(p.left)) {
    return stringValue(p.left.argumentExpression) === undefined;
  }
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return false;
  return insideLoop(n);
}

function inAnthropicToolsArray(obj: ts.Node): boolean {
  const arr = obj.parent;
  if (arr === undefined || !ts.isArrayLiteralExpression(arr)) return false;
  const pa = arr.parent;
  if (pa === undefined || !ts.isPropertyAssignment(pa) || propertyNameText(pa.name) !== 'tools') return false;
  const call = pa.parent.parent;
  return call !== undefined && ts.isCallExpression(call) && ANTHROPIC_CALL_RE.test(dottedName(call.expression) ?? '');
}

/** Definition sites (refKey) the syntax-only pass recognises in one file. */
export function syntaxOnlyFile(root: string, sf: ts.SourceFile): string[] {
  const imp = importsOf(sf);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const e = unwrap(node.expression);
      const a0 = node.arguments[0];
      const isAi = (ts.isIdentifier(e) && imp.aiTool.has(e.text))
        || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && imp.aiNamespaces.has(e.expression.text) && (e.name.text === 'tool' || e.name.text === 'dynamicTool'));
      if (isAi && a0 !== undefined && ts.isObjectLiteralExpression(a0) && !isBridgeSite(node)) found.push(refKey(refOf(root, node)));
      const isAgents = (ts.isIdentifier(e) && imp.agentsTool.has(e.text))
        || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && imp.agentsNamespaces.has(e.expression.text) && e.name.text === 'tool');
      if (isAgents && a0 !== undefined && ts.isObjectLiteralExpression(a0)) found.push(refKey(refOf(root, node)));
      if (imp.anthropic && ts.isIdentifier(e) && (calleeName(e) === 'betaZodTool' || calleeName(e) === 'betaTool') && a0 !== undefined && ts.isObjectLiteralExpression(a0)) {
        found.push(refKey(refOf(root, node)));
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      const name = stringValue(propValue(getProp(node, 'name')));
      if (name !== undefined && getProp(node, 'input_schema') !== undefined && (imp.anthropic || inAnthropicToolsArray(node))) {
        found.push(refKey(refOf(root, node)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
