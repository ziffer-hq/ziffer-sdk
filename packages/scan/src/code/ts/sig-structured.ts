/**
 * Structured output (record §3.17): an EXCLUSION, recognised so it is said and never
 * counted. Instructor (`@instructor-ai/instructor`: `Instructor({ client, mode })`,
 * then `client.chat.completions.create({ response_model: { schema, name } })`) uses the
 * provider's tool channel to shape an answer into a schema; the AI SDK's
 * `generateObject` / `streamObject` and OpenAI's `zodResponseFormat` / `zodTextFormat`
 * do the same through JSON mode. Nothing is executed: the "tool" is the response
 * model. None of these recognisers adds a tool; each place is counted in one honesty
 * line, so the absence from the tool list is visible rather than silent.
 *
 * `response_model` is read on any call whose argument literal carries one with a
 * `schema`: Instructor's own examples import it through a path alias (`@/instructor`)
 * no package check can follow, and this reading can only add a sentence, never a tool.
 */

import ts from 'typescript';

import type { SourceRef } from '../types.js';
import { packagesOf } from '../sdks.js';
import { literalOf, note, type ExtractContext } from './common.js';
import type { Facts } from './facts.js';
import { calleePackage, getProp, packageMatches, propValue, refOf } from './util.js';

const seen = new WeakMap<Facts, { refs: SourceRef[]; kinds: Set<string> }>();

/** The schema as written, shortened for one line: the argument or property that names it. */
function shown(n: ts.Node | undefined): string {
  if (n === undefined) return '';
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  const t = n.getText().replace(/\s+/g, ' ');
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

function record(ctx: ExtractContext, at: SourceRef, kind: string, name: string): void {
  ctx.facts.structured.push({ name: name === '' ? kind : name, at });
  const s = seen.get(ctx.facts) ?? { refs: [], kinds: new Set<string>() };
  seen.set(ctx.facts, s);
  s.refs.push(at);
  s.kinds.add(kind);
  const shown = s.refs.slice(0, 3).map((r) => `${r.file}:${r.line}`).join(', ');
  const where = s.refs.length > 3 ? `${shown} and ${s.refs.length - 3} more` : shown;
  note(ctx.facts, 'structured-output', `${s.refs.length} structured-output schema(s) (${[...s.kinds].join(', ')}: ${where}) shape a model's answer through its tool channel or JSON mode, and nothing runs: they are not tools, and are not listed as tools.`, at);
}

/** Called on every call whose name could be one of these; adds nothing to the tool list. */
export function structuredOutput(ctx: ExtractContext, call: ts.CallExpression, cn: string): void {
  if (cn === 'generateObject' || cn === 'streamObject') {
    const a0 = call.arguments[0];
    const schema = a0 !== undefined && ts.isObjectLiteralExpression(a0) ? propValue(getProp(a0, 'schema')) : undefined;
    if (packageMatches(calleePackage(ctx.checker, call.expression), packagesOf('ai'))) record(ctx, refOf(ctx.root, call), `AI SDK ${cn}`, shown(schema));
    return;
  }
  if (cn === 'zodResponseFormat' || cn === 'zodTextFormat') {
    const named = call.arguments[1];
    const name = named !== undefined && (ts.isStringLiteral(named) || ts.isNoSubstitutionTemplateLiteral(named)) ? named : call.arguments[0];
    if (packageMatches(calleePackage(ctx.checker, call.expression), packagesOf('openai'))) record(ctx, refOf(ctx.root, call), `OpenAI ${cn}`, shown(name));
    return;
  }
  const a0 = call.arguments[0];
  const args = a0 === undefined || !ts.isObjectLiteralExpression(a0) ? undefined : a0;
  const rm = args === undefined ? undefined : propValue(getProp(args, 'response_model'));
  const model = rm === undefined ? undefined : literalOf(rm, ctx.checker);
  if (model === undefined || getProp(model, 'schema') === undefined) return;
  const fromInstructor = packageMatches(calleePackage(ctx.checker, call.expression), packagesOf('instructor'));
  const n = propValue(getProp(model, 'name'));
  record(ctx, refOf(ctx.root, call), fromInstructor ? 'Instructor response_model' : 'an Instructor-style response_model', shown(n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n : propValue(getProp(model, 'schema'))));
}
