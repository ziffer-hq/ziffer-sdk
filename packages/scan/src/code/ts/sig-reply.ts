/**
 * The loop that runs what the model asked for (ACP-474). A tool in the Anthropic
 * Messages format, or an OpenAI function tool, is a definition with no execute body:
 * the application reads the model's reply and runs the request itself, usually
 * through one function of its own -- `runTool(block.name, block.input)`. That call is
 * where every such tool runs, so its callee is a dispatcher.
 *
 * The request is recognised by its TYPE, never by a spelling: the argument is a read
 * of a member the SDK declares on its tool-request type (`ToolUseBlock.name`), which
 * the checker resolves only when the SDK's types are installed. With the types
 * unresolved nothing is claimed, and the door stays provisional -- a variable merely
 * named `block` proves nothing.
 */

import ts from 'typescript';

import { packagesOf } from '../sdks.js';
import { functionInfo, type ExtractContext } from './common.js';
import { calleeSymbol, firstDecl, isTreeSource, packageMatches, packageOfFile, refOf, unwrap } from './util.js';

/** One SDK's tool-request type: where it is declared, and which of its members carry the tool's name and its input. */
interface RequestType {
  /** The catalog's SDK id, which is also the `sdk` of the tools the request can name. */
  sdk: string;
  /** The declaring interface, qualified by the namespaces around it. */
  owner: string;
  name: string;
  input: string;
}

const REQUEST_TYPES: readonly RequestType[] = [
  // Messages API: the `tool_use` content block of a reply.
  { sdk: 'anthropic', owner: 'ToolUseBlock', name: 'name', input: 'input' },
  // Chat Completions: `message.tool_calls[i].function`.
  { sdk: 'openai', owner: 'ChatCompletionMessageFunctionToolCall.Function', name: 'name', input: 'arguments' },
  // Responses: a `function_call` output item.
  { sdk: 'openai', owner: 'ResponseFunctionToolCall', name: 'name', input: 'arguments' },
];

/** `x`, `(x)`, `x as T`, `JSON.parse(x)`: the expression an argument is read from. */
function argumentRead(e: ts.Expression): ts.Expression {
  let v = unwrap(e);
  for (;;) {
    if (ts.isCallExpression(v) && v.arguments.length >= 1 && ts.isPropertyAccessExpression(v.expression) && v.expression.name.text === 'parse' && ts.isIdentifier(v.expression.expression) && v.expression.expression.text === 'JSON') {
      const a0 = v.arguments[0];
      if (a0 === undefined) return v;
      v = unwrap(a0);
    } else return v;
  }
}

/** The interface a property is declared in, qualified by its namespaces (`A.Function`). */
function ownerOf(decl: ts.Declaration): string | undefined {
  const iface = decl.parent;
  if (iface === undefined || !ts.isInterfaceDeclaration(iface)) return undefined;
  const names = [iface.name.text];
  let p: ts.Node | undefined = iface.parent;
  while (p !== undefined && !ts.isSourceFile(p)) {
    if (ts.isModuleDeclaration(p) && ts.isIdentifier(p.name)) names.unshift(p.name.text);
    p = p.parent;
  }
  return names.join('.');
}

interface RequestRead {
  type: RequestType;
  role: 'name' | 'input';
  /** The request expression the member is read from, as written: name and input must come from the same one. */
  receiver: string;
}

function requestRead(checker: ts.TypeChecker, arg: ts.Expression): RequestRead | undefined {
  const v = argumentRead(arg);
  if (!ts.isPropertyAccessExpression(v)) return undefined;
  const member = v.name.text;
  const d = firstDecl(checker.getSymbolAtLocation(v.name));
  if (d === undefined || !ts.isPropertySignature(d)) return undefined;
  const owner = ownerOf(d);
  if (owner === undefined) return undefined;
  const pkg = packageOfFile(d.getSourceFile().fileName);
  for (const type of REQUEST_TYPES) {
    if (type.owner !== owner || !packageMatches(pkg, packagesOf(type.sdk))) continue;
    const role = member === type.name ? 'name' : member === type.input ? 'input' : undefined;
    if (role !== undefined) return { type, role, receiver: unwrap(v.expression).getText() };
  }
  return undefined;
}

/**
 * A call to a function of the tree whose arguments carry both the name and the input of
 * one tool request read from the model's reply. Recorded for the join, which makes the
 * callee the dispatcher of that SDK's tools that have no execute body of their own.
 */
export function replyDispatch(ctx: ExtractContext, call: ts.CallExpression): void {
  if (call.arguments.length < 2) return;
  const reads: RequestRead[] = [];
  for (const a of call.arguments) {
    const r = requestRead(ctx.checker, a);
    if (r !== undefined) reads.push(r);
  }
  const name = reads.find((r) => r.role === 'name');
  if (name === undefined) return;
  const input = reads.find((r) => r.role === 'input' && r.type === name.type && r.receiver === name.receiver);
  if (input === undefined) return;
  const decl = firstDecl(calleeSymbol(ctx.checker, call.expression));
  if (decl === undefined || !isTreeSource(decl.getSourceFile().fileName)) return;
  const fi = functionInfo(ctx, decl);
  if (fi === undefined) return;
  ctx.facts.functions.set(fi.id, fi.info);
  ctx.facts.replyCalls.push({ at: refOf(ctx.root, call), sdk: name.type.sdk, calleeId: fi.id });
}
