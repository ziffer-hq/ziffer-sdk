/**
 * What both reports, and the MCP server, say about the three readings the scanner added on
 * 2026-09-28 (ACP-455): a tool that runs another tool without passing the dispatcher
 * (`CodeTool.calls`), what the source shows before each call to the dispatcher
 * (`Dispatcher.caller_checks`, with the tools' own `authority_claims`), and what a tool's
 * words say about undoing it (`CodeToolVerdict.undo_hints`). Written once, so the page, the
 * terminal and the agent read the same sentences.
 *
 * EVERY SENTENCE IS A READING OF THE SOURCE TEXT. A check that was found is a line of code, not
 * proof that it stops anything; a check that was not found is what the scan read in one
 * function, not proof that nobody is asked. A check that did not run (`CodeCatalog.checks`) is
 * "not looked for", never "none found". Names, counts, files and lines come from the data.
 */

import type { CallerCheck, CodeSection, CodeTool, CodeToolVerdict, Dispatcher, ToolCall, UndoHint } from '../code/types.js';
import { andList, groupOf, where, type VerdictGroup } from './code.js';
import { claimValues } from '../code/notseen.js';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The dispatcher the insertion chose, when there is one. */
function dispatcherOf(code: CodeSection): Dispatcher | null {
  return code.insertion.dispatcher;
}

// ---------------------------------------------------------------- which checks ran

export type CheckName = 'tool_calls' | 'caller_checks';

/** Whether a check ran for at least one language read. Absent `checks` (a catalog made before them): it did not. */
export function checkRan(code: CodeSection, check: CheckName): boolean {
  return (code.catalog.checks ?? []).some((c) => c[check]);
}

const LANGUAGE_WORDS = { typescript: 'TypeScript', python: 'Python' } as const;

/** The language a source file is read as, by its extension: what `checks` is keyed by. */
function languageOf(file: string): 'typescript' | 'python' {
  return /\.pyi?$/.test(file) ? 'python' : 'typescript';
}

/**
 * The limits section's lines on these two checks, per language read: what ran, and for what
 * did not, "not looked for" in place of "none found". Counts are the data's.
 */
export function checkLines(code: CodeSection): string[] {
  const checks = code.catalog.checks;
  const door = dispatcherOf(code)?.name ?? 'the dispatcher';
  const bypassWhat = `Tools that run another tool without passing ${door}`;
  const entryWhat = `What the code tests before each call to ${door}`;
  if (checks === undefined || checks.length === 0) {
    return [`${bypassWhat}: not looked for in this scan.`, `${entryWhat}: not looked for in this scan.`];
  }
  const d = dispatcherOf(code);
  return checks.map((c) => {
    const sites = code.catalog.tools.filter((t) => languageOf(t.defined_at.file) === c.language).reduce((n, t) => n + (t.calls ?? []).length, 0);
    const bypass = c.tool_calls ? (sites === 0 ? 'looked for, none found' : `looked for, ${plural(sites, 'found', 'found')}`) : 'not looked for';
    let entries = 'not looked for';
    if (c.caller_checks) {
      const rows = (d?.caller_checks ?? []).filter((x) => languageOf(x.caller.file) === c.language);
      const none = rows.filter((x) => x.check === undefined).length;
      entries =
        d === null
          ? 'looked for; the scan found no one dispatcher to read the calls of'
          : rows.length === 0
            ? `looked for; no call to ${d.name} in this language`
            : `looked for, no confirmation check found before ${none} of ${plural(rows.length, 'call')}`;
    }
    return `${LANGUAGE_WORDS[c.language]}: ${bypassWhat.charAt(0).toLowerCase()}${bypassWhat.slice(1)}: ${bypass}. ${entryWhat}: ${entries}.`;
  });
}

// ---------------------------------------------------------------- 1. paths that pass the door unseen

/** One call site where a tool runs another tool without passing the dispatcher. */
export interface BypassPath {
  outer: string;
  call: ToolCall;
}

/** Every such call site, in the catalog's order. Empty when none was found or the check did not run. */
export function bypassPaths(code: CodeSection): BypassPath[] {
  return code.catalog.tools.flatMap((t: CodeTool) => (t.calls ?? []).map((call) => ({ outer: t.name, call })));
}

/** The heading of the finding, and of its line in the executive summary. */
export const BYPASS_TITLE = 'Paths that pass the door unseen';

/** Where the one ZIFFER call sits, as a sentence names it. */
function doorOf(code: CodeSection, outer: string): string {
  const d = dispatcherOf(code);
  return d === null ? `the top of ${outer}` : d.name;
}

/**
 * "closeProperty also runs createGbpPost at handlers/close-property.ts:263, without passing
 * executeTool. A ZIFFER call at executeTool would decide closeProperty and not see createGbpPost."
 */
export function bypassSentence(code: CodeSection, p: BypassPath): string {
  const door = doorOf(code, p.outer);
  const at = where(p.call.at);
  const through = p.call.through.length === 0 ? '' : ` (through ${andList(p.call.through)})`;
  if (p.call.tool === undefined) {
    return `${p.outer} runs a tool chosen at run time at ${at}${through}; any tool may be the one run.`;
  }
  const passing = dispatcherOf(code) === null ? '' : `, without passing ${door}`;
  return `${p.outer} also runs ${p.call.tool} at ${at}${through}${passing}. A ZIFFER call at ${door} would decide ${p.outer} and not see ${p.call.tool}.`;
}

/** What to do about one path. */
export function bypassFix(code: CodeSection, p: BypassPath): string {
  const d = dispatcherOf(code);
  const at = where(p.call.at);
  return d === null ? `Put the ZIFFER call at ${at} too.` : `Route that call through ${d.name}, or put the ZIFFER call at ${at} too.`;
}

/** The "To confirm" cell of a tool the draft raised: "also runs createGbpPost", "runs a tool chosen at run time". */
export function raisedCell(v: Pick<CodeToolVerdict, 'raised_by'>): string | undefined {
  if (v.raised_by === undefined) return undefined;
  return v.raised_by === '*' ? 'runs a tool chosen at run time' : `also runs ${v.raised_by}`;
}

/**
 * "The draft grades closeProperty as strictly as createGbpPost, the tool it runs. The draft grades
 * runWorkflow as strictly as the strictest tool in the draft, since …", one sentence per tool, from
 * `raised_by`; undefined when no tool was raised.
 */
export function raisedSentence(code: CodeSection): string | undefined {
  const raised = code.verdicts.filter((v) => v.raised_by !== undefined);
  if (raised.length === 0) return undefined;
  const parts = raised.map((v) =>
    v.raised_by === '*'
      ? `The draft grades ${v.tool.name} as strictly as the strictest tool in the draft, since any tool may be the one it runs.`
      : `The draft grades ${v.tool.name} as strictly as ${v.raised_by ?? ''}, the tool it runs.`,
  );
  const d = dispatcherOf(code);
  const why = d === null ? [] : [`A ZIFFER call at ${d.name} would decide only the outer tool, so its decision would be the only one the inner tool gets.`];
  return [...parts, ...why].join(' ');
}

/**
 * The executive summary's line: "2 places where a tool runs another tool without passing
 * executeTool: a ZIFFER call there would decide closeProperty and runWorkflow and not see the
 * tool each one runs." Undefined when there is none.
 */
export function bypassSummary(code: CodeSection): string | undefined {
  const paths = bypassPaths(code);
  if (paths.length === 0) return undefined;
  const outer = [...new Set(paths.map((p) => p.outer))];
  const d = dispatcherOf(code);
  const place = paths.length === 1 ? '1 place where a tool runs another tool' : `${paths.length} places where a tool runs another tool`;
  const each = outer.length === 1 ? 'the tool it runs' : 'the tool each one runs';
  return d === null
    ? `${place} directly: a ZIFFER call at the top of ${andList(outer)} would decide ${outer.length === 1 ? 'it' : 'each'} and not see ${each}.`
    : `${place} without passing ${d.name}: a ZIFFER call at ${d.name} would decide ${andList(outer)} and not see ${each}.`;
}

// ---------------------------------------------------------------- 2. who is asked, per entry

/** The heading of the per-entry table. */
export const ENTRIES_TITLE = 'Who is asked, per entry';

/** The per-entry table's two fixed sentences, under it. */
export const CHECK_FOUND_MEANS = 'A check that was found is a line of code; the scan does not prove it stops the action.';
export const CHECK_NOT_FOUND_MEANS = 'A check that was not found is what the scan read in that function, not proof that nobody is asked elsewhere.';

/** Why the application's own confirmation and a ZIFFER approval are different things. */
export const CONFIRM_VS_APPROVAL =
  'Your application’s own confirmation is checked by the same code a manipulated model drives, and it leaves no signed record of who confirmed. ' +
  'A ZIFFER approval is a signature by a named approver, checked outside your application, and it leaves a receipt.';

/** The dispatcher's callers with what the source shows before each; undefined when the check did not run or there is no dispatcher. */
export function callerChecks(code: CodeSection): readonly CallerCheck[] | undefined {
  return dispatcherOf(code)?.caller_checks;
}

/** A caller's enclosing function or route, as written. */
export function entryFunction(c: CallerCheck): string {
  return c.in_function === '' ? 'an anonymous function' : c.in_function;
}

/** "a check of `requires_confirmation` at tool-bridge.ts:325 comes before the call", or "no confirmation check was found before the call". */
export function entryFinding(c: CallerCheck): string {
  return c.check === undefined ? 'no confirmation check was found before the call' : `a check of \`${c.check.reads}\` at ${where(c.check.at)} comes before the call`;
}

/**
 * What the scan read about a person being asked, and what it did not (ACP-455, second review):
 * "The scan read the code before each call to executeTool: it found a confirmation check before
 * 2 of the 3 calls. It does not see whether a person answered it." Counted from `caller_checks`.
 * When there is no dispatcher, or the check did not run, it says the scan did not look.
 */
export function confirmationSentence(code: CodeSection): string {
  const d = dispatcherOf(code);
  if (d === null) {
    return 'The scan found no one function every tool runs through, so it did not look for a confirmation check before the calls.';
  }
  const checks = callerChecks(code);
  if (checks === undefined) return `The scan did not look for a confirmation check before the calls to ${d.name}.`;
  if (checks.length === 0) return `The scan found no call to ${d.name} to read for a confirmation check.`;
  const found = checks.filter((c) => c.check !== undefined).length;
  const lead = `The scan read the code before each call to ${d.name}: it found a confirmation check before ${found} of the ${plural(checks.length, 'call')}.`;
  return found === 0 ? `${lead} It does not see whether a person is asked elsewhere.` : `${lead} It does not see whether a person answered it.`;
}

/** The callers with no confirmation check found. */
export function uncheckedCallers(code: CodeSection): CallerCheck[] {
  return (callerChecks(code) ?? []).filter((c) => c.check === undefined);
}

const REACH_GROUP_WORDS: Record<VerdictGroup, string> = {
  held: 'held for a person',
  notified: 'run after a notice',
  allowed: 'run, recorded',
  refused: 'refused: no rule',
};

/**
 * What one caller with no confirmation check found can reach (ACP-455, second review), from
 * `CallerCheck.reaches`: the tools named and grouped by what the draft does with each; all stubs
 * said as such; or, when the source does not bound the name, every tool the dispatcher knows.
 */
export function reachSentence(code: CodeSection, c: CallerCheck): string {
  const d = dispatcherOf(code);
  if (c.reaches === undefined) {
    const n = d?.tools_delegating ?? code.verdicts.length;
    return `The source does not bound which tools this path can call, so it can reach any of the ${plural(n, 'tool')} the dispatcher knows.`;
  }
  const from = c.reaches_from === undefined ? '' : ` (read from ${c.reaches_from})`;
  const verdicts = c.reaches.map((name) => code.verdicts.find((v) => v.tool.name === name)).filter((v): v is CodeToolVerdict => v !== undefined);
  if (verdicts.length === 0) return `This path reaches no tool the scan found${from}.`;
  const stubs = verdicts.filter((v) => v.tool.declared_stub === true);
  const live = verdicts.filter((v) => v.tool.declared_stub !== true);
  if (live.length === 0) {
    return (
      `This path reaches ${plural(stubs.length, 'tool')}${from}, ${stubs.length === 1 ? 'declared and not wired yet' : 'all declared and not wired yet'}. ` +
      `When ${stubs.length === 1 ? 'it is' : 'they are'} wired, this is the path with no confirmation check in front of ${stubs.length === 1 ? 'it' : 'them'}.`
    );
  }
  const order: VerdictGroup[] = ['held', 'notified', 'allowed', 'refused'];
  const groups = order
    .map((g) => ({ g, names: live.filter((v) => groupOf(v) === g).map((v) => v.tool.name) }))
    .filter((x) => x.names.length > 0)
    .map((x) => `${REACH_GROUP_WORDS[x.g]}: ${andList(x.names)}`);
  const more = stubs.length === 0 ? '' : ` It also reaches ${plural(stubs.length, 'tool')} declared and not wired yet: ${andList(stubs.map((v) => v.tool.name))}.`;
  return `This path reaches ${plural(live.length, 'live tool')}${from}; ${groups.join('; ')}.${more}`;
}

/**
 * What the code that installs one path tells the model about (`CallerCheck.offered`, ACP-455 third
 * reading), said BEFORE what the path can run, and never merged with it: "The code that installs
 * this path tells the model about 17 tools (…): 16 declared and not wired yet, and respond.
 * Nothing on the path refuses a tool name that is not on that list, so a manipulated model could
 * ask for any of the 82 tools the dispatcher knows." Undefined when the source does not show the list.
 */
export function offeredSentence(code: CodeSection, c: CallerCheck): string | undefined {
  if (c.offered === undefined || c.offered.length === 0) return undefined;
  const d = dispatcherOf(code);
  const how = c.offered_from === undefined ? '' : ` (${c.offered_from})`;
  const verdicts = c.offered.map((name) => code.verdicts.find((v) => v.tool.name === name));
  const isStubName = (name: string): boolean => code.verdicts.some((v) => v.tool.name === name && v.tool.declared_stub === true);
  const stubs = c.offered.filter(isStubName);
  const live = c.offered.filter((n) => !isStubName(n));
  const names =
    stubs.length === c.offered.length
      ? stubs.length === 1 ? 'declared and not wired yet' : 'all declared and not wired yet'
      : stubs.length === 0
        ? andList(live)
        : `${stubs.length} declared and not wired yet, and ${andList(live)}`;
  const lead = `The code that installs this path tells the model about ${plural(c.offered.length, 'tool')}${how}: ${names}.`;
  const reach =
    c.reaches === undefined
      ? ` Nothing on the path refuses a tool name that is not on that list, so a manipulated model could ask for any of the ${plural(d?.tools_delegating ?? code.verdicts.length, 'tool')} the dispatcher knows.`
      : ` ${reachSentence(code, c)}`;
  // The stubs that run through the dispatcher are the ones this path would put in front of a model once wired.
  const dispatched = verdicts.filter((v): v is CodeToolVerdict => v !== undefined && (d === null || v.tool.delegates_to === d.name));
  const wired =
    stubs.length > 0 && c.check === undefined && dispatched.length > 0 && dispatched.every((v) => v.tool.declared_stub === true)
      ? stubs.length === c.offered.length
        ? ` When ${stubs.length === 1 ? 'it is' : 'they are'} wired, this is the path with no confirmation check in front of ${stubs.length === 1 ? 'it' : 'them'}.`
        : ` When the ${plural(stubs.length, 'stub')} ${stubs.length === 1 ? 'is' : 'are'} wired, this is the path with no confirmation check in front of ${stubs.length === 1 ? 'it' : 'them'}.`
      : '';
  return `${lead}${reach}${wired}`;
}

/** Both facts about one path, in order: what the model is told about (when the source shows it), then what the path can run. */
export function pathSentence(code: CodeSection, c: CallerCheck): string {
  return offeredSentence(code, c) ?? reachSentence(code, c);
}

/**
 * The executive summary's line when a caller has no check: "From decoratedOnToolCall
 * (prospector-decision-logger.ts:67), no confirmation check was found before the call to
 * executeTool. The source does not bound which tools this path can call, …". One sentence pair
 * per caller, the second `reachSentence`'s. Undefined when every caller has one, or the check did not run.
 */
export function uncheckedSummary(code: CodeSection): string | undefined {
  const d = dispatcherOf(code);
  const none = uncheckedCallers(code);
  if (d === null || none.length === 0) return undefined;
  return none
    .map((c) => `From ${entryFunction(c)} (${where(c.caller)}), no confirmation check was found before the call to ${d.name}. ${pathSentence(code, c)}`)
    .join(' ');
}

/**
 * The claim side, split by the value written (ACP-455, second review): "`requires_confirmation`
 * is written on 82 tool definitions: 25 set it to true, asking for a confirmation, and 57 set it
 * to false, which declares that no confirmation is needed. That is a statement in the tool's
 * definition. The scan read where it is tested: …". The figures add up to the total, and they
 * are `claimValues`', the honesty line's own count. Undefined when no tool declares an authority property.
 */
export function claimsSentence(code: CodeSection): string | undefined {
  const values = claimValues(code.catalog.tools);
  if (values.length === 0) return undefined;
  const names = [...new Set(values.map((v) => v.name))];
  const declared = names.map((name) => {
    const vs = values.filter((v) => v.name === name);
    const total = vs.reduce((n, v) => n + v.tools, 0);
    const each = vs.map((v) => {
      const lead = `${v.tools} set${v.tools === 1 ? 's' : ''} it to ${v.value}`;
      return v.value === 'true' ? `${lead}, asking for a confirmation` : v.value === 'false' ? `${lead}, which declares that no confirmation is needed` : lead;
    });
    return `\`${name}\` is written on ${plural(total, 'tool definition')}: ${each.join('; ')}`;
  });
  const checks = callerChecks(code);
  const d = dispatcherOf(code);
  let tested: string;
  if (d === null) tested = 'The scan found no one dispatcher whose calls it could read.';
  else if (checks === undefined) tested = `Where it is tested before a call to ${d.name} was not looked for in this scan.`;
  else {
    const found = checks.filter((c) => c.check !== undefined && names.includes(c.check.reads));
    tested =
      found.length === 0
        ? `The scan read where it is tested: no call to ${d.name} is preceded by a test of ${names.length === 1 ? 'that name' : 'those names'}.`
        : `The scan read where it is tested: ${andList(found.map((c) => `before the call in ${entryFunction(c)} (${where(c.caller)}), at ${where(c.check?.at ?? c.caller)}`))}.`;
  }
  return `${declared.join('. ')}. That is a statement in the tool’s definition. ${tested}`;
}

function capital(s: string): string {
  return s === '' ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/**
 * The held-table note: where the application checks a confirmation before a call, the person who
 * confirms there can be enrolled as the ZIFFER approver. Never that the application's click can
 * replace a ZIFFER approval.
 */
export function enrolNote(code: CodeSection): string {
  const d = dispatcherOf(code);
  const found = (callerChecks(code) ?? []).filter((c) => c.check !== undefined);
  const lead =
    d === null || found.length === 0
      ? 'Where your application asks a person to confirm before one of these runs'
      : `The scan found a confirmation check before ${found.length} of the ${plural(d.callers.length, 'call')} to ${d.name} (${andList(found.map(entryFunction))})`;
  return `${lead}: the person who confirms there can be enrolled as the ZIFFER approver, so they confirm once, in ZIFFER.`;
}

// ---------------------------------------------------------------- 3. proposed undo entries

/** The heading of the proposed-entries table. */
export const UNDO_TITLE = 'Proposed undo entries';

/** Said once above the table. */
export const UNDO_NEVER_ON_OWN_WORD =
  'The draft never takes these on their own word: a tool’s words can make the draft stricter, never looser. Each entry below changes the draft only when a person confirms it.';

/** One hint's evidence in the source's words: `description says "Reversible via"`, `deleteGbpPost exists`. */
export function hintEvidence(h: UndoHint): string {
  return h.source === 'inverse_tool' ? `${h.evidence} exists` : `description says "${h.evidence}"`;
}

/**
 * Said once above the proposed-policy tables when a row shows what its source says about undoing
 * it: the asymmetry of the draft, in a reader's words.
 */
export const UNDO_CONSERVATIVE =
  'The scan is conservative on purpose: words that say an action cannot be undone make the draft stricter; words that say it can are shown here and change nothing until a person confirms.';

/** The `can_be_undone` and `reads_only` hints of one tool, in the source's words, for its "To confirm" cell; empty when none. */
export function undoEvidence(v: Pick<CodeToolVerdict, 'undo_hints'>): string[] {
  return [...new Set((v.undo_hints ?? []).filter((h) => h.says !== 'cannot_be_undone').map(hintEvidence))];
}

/** The `cannot_be_undone` hints, as the reason shown in the row they made stricter; undefined when none. */
export function cannotUndoReason(v: Pick<CodeToolVerdict, 'undo_hints'>): string | undefined {
  const hs = (v.undo_hints ?? []).filter((h) => h.says === 'cannot_be_undone');
  if (hs.length === 0) return undefined;
  const words = hs.filter((h) => h.source === 'description').map((h) => `"${h.evidence}"`);
  const tools = hs.filter((h) => h.source === 'inverse_tool').map(hintEvidence);
  return [...(words.length === 0 ? [] : [`description says ${andList(words)}`]), ...tools].join('; ');
}

export interface UndoRow {
  tool: string;
  /** The draft's key for the tool: the key an entry is written under. */
  key: string;
  evidence: string[];
  /** What the draft does with the tool now, in words. */
  draft: string;
  /** The line to add to `reversibility.json` if a person confirms; undefined when nothing is proposed. */
  entry?: string;
  /** Why nothing is proposed, when nothing is. */
  none?: string;
  ambiguous: boolean;
}

/** The ambiguous row's words. */
export const UNDO_AMBIGUOUS = 'the description is ambiguous; read it';

const GROUP_DOES: Record<VerdictGroup, string> = {
  held: 'held for a person',
  notified: 'runs after a notice under the draft policy',
  refused: 'refused: no rule',
  allowed: 'runs, with a receipt',
};

/** A rule as `rules.ts` reads it, narrowed to what the table needs. */
export interface UndoRule {
  key: string;
  reversibility?: string;
  verdict: CodeToolVerdict;
}

/**
 * One row per tool with a `can_be_undone` or `reads_only` hint. Contradictory hints (can and
 * cannot, or reads-only beside can-be-undone, or reads-only on a tool the draft treats as one
 * that cannot be undone) propose nothing: the description is read by a person first.
 */
export function undoRows(rules: readonly UndoRule[]): UndoRow[] {
  const out: UndoRow[] = [];
  for (const r of rules) {
    const hs = r.verdict.undo_hints ?? [];
    const says = new Set(hs.map((h) => h.says));
    if (!says.has('can_be_undone') && !says.has('reads_only')) continue;
    const readsAsWrite = r.verdict.verdict.verdict !== 'REFUSED' && r.verdict.verdict.reversibility === 'IRREVERSIBLE';
    const ambiguous =
      (says.has('can_be_undone') && says.has('cannot_be_undone')) || (says.has('reads_only') && (says.has('can_be_undone') || says.has('cannot_be_undone') || readsAsWrite));
    const listed = r.reversibility === undefined ? 'no entry, read as impossible to undo' : r.reversibility === 'IRREVERSIBLE' ? 'listed as impossible to undo' : 'listed as one that can be undone';
    const row: UndoRow = {
      tool: r.verdict.tool.name,
      key: r.key,
      evidence: hs.filter((h) => h.says !== 'cannot_be_undone' || ambiguous).map(hintEvidence),
      draft: `${listed}; ${GROUP_DOES[groupOf(r.verdict)]}`,
      ambiguous,
    };
    if (ambiguous) row.none = UNDO_AMBIGUOUS;
    else if (r.reversibility === 'REVERSIBLE') row.none = 'nothing to add: the draft already lists it as one that can be undone';
    else row.entry = `${JSON.stringify(r.key)}: "REVERSIBLE"`;
    out.push(row);
  }
  return out;
}

/** "add" or "change it to", by what the draft lists now. */
export function entryVerb(r: Pick<UndoRule, 'reversibility'>): string {
  return r.reversibility === undefined ? 'add' : 'change it to';
}

/** The tools whose proposed entry is a change (not the ambiguous ones, not those already listed). */
export function proposedTools(rows: readonly UndoRow[]): Set<string> {
  return new Set(rows.filter((r) => r.entry !== undefined).map((r) => r.tool));
}
