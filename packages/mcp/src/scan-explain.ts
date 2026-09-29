/**
 * `explain_scan_finding` (ACP-455): one tool from the last codebase scan, and
 * why the ENGINE decided what it did.
 *
 * It reads the verdict the scan recorded and the draft policy members the
 * engine graded against — `risk_functions.json`, `reversibility.json`,
 * `floors.json`, `notice_targets.json` — out of the folder that scan wrote. It
 * grades nothing: a second grader here could disagree with the engine, and the
 * one it would disagree with is the one that runs in production. Every member
 * is linked to its section of the policy-by-example page, and the fix is the
 * same as the scan's, word for word, because it comes from the same function.
 */

import { join } from 'node:path';

import { bypassFix, bypassPaths, bypassSentence, callerChecks, capabilityText, CONFIRM_VS_APPROVAL, GIVEN_TO, heldToolsLine, NAMED_NOT_IN_CODE, skillLoadText, entryFinding, entryFunction, reachSentence, refusalLine, skillInstructionSentence, SKILLS_LEAD, toolInstructionSentence } from '@ziffer-io/scan';

import { isRecord, readJson, type CodebaseScan, type CodeToolVerdict } from './scan-code.js';
import { BY_EXAMPLE, ENGINE_NOT_AGENT, ENTRY_BOUNDS, INSTRUCTION_FIX, outcomeOf, remediation, toolView } from './scan-remedy.js';
import type { ToolOutcome } from './tools.js';

export interface ExplainOutcome extends ToolOutcome {
  readonly structured: Record<string, unknown>;
}

/** One policy member line the verdict rests on. */
interface Member {
  readonly file: string;
  readonly key: string;
  readonly value: unknown;
  readonly doc: string;
}

function member(policy: string, file: string, table: string | null, key: string, doc: string, absentDoc: string): Member {
  let value: unknown;
  try {
    const doc0 = readJson(join(policy, file));
    value = table === null ? doc0 : isRecord(doc0) ? doc0[table] : undefined;
  } catch (error) {
    return { file, key, value: `unreadable: ${refusalLine(error)}`, doc };
  }
  if (Array.isArray(value)) {
    const entry = value.find((e) => isRecord(e) && e['applies_to'] === key);
    return entry === undefined ? { file, key, value: 'absent', doc: absentDoc } : { file, key, value: entry, doc };
  }
  if (isRecord(value) && key in value) return { file, key, value: value[key], doc };
  return { file, key, value: 'absent', doc: absentDoc };
}

/** The resource the draft names this tool under, from the tools file the scan wrote. */
function resourceOf(scan: CodebaseScan, tool: string): string | undefined {
  try {
    const doc = readJson(scan.tools_file);
    const tools = isRecord(doc) ? doc['tools'] : undefined;
    const entry = isRecord(tools) ? tools[tool] : undefined;
    const resource = isRecord(entry) ? entry['resource'] : undefined;
    return typeof resource === 'string' ? resource : undefined;
  } catch {
    return undefined;
  }
}

/** Why, in one paragraph, from the verdict's fields and the members read. */
function why(v: CodeToolVerdict, members: { risk: Member; reversibility: Member; floor: Member; notice: Member }): { because: string; decided_by: Member } {
  const verdict = v.verdict;
  if (verdict.verdict === 'REFUSED') {
    return {
      because:
        verdict.clause === '8.4-3'
          ? 'The engine refused it at clause 8.4-3: the draft policy has no risk function for this tool, and an action with no risk function is refused, never graded (unknown is never LOW).'
          : `The engine refused it at clause ${verdict.clause}: ${verdict.message}`,
      decided_by: members.risk,
    };
  }
  const tier = `effective tier ${verdict.effective_tier} (floors.json names the resource at ${String(members.floor.value)})`;
  switch (outcomeOf(verdict)) {
    case 'held':
      return {
        because:
          `The draft's risk function grades it ${verdict.risk}, and at HIGH the engine answers ATTEST: the call is held until a ` +
          `person the policy names approves it, then runs with a signed receipt. Reversibility ${verdict.reversibility}; ${tier}.`,
        decided_by: members.risk,
      };
    case 'notified':
      return {
        because:
          `The draft grades it ${verdict.risk}, below HIGH, and reversibility.json says ${verdict.reversibility}: an irreversible ` +
          'action below HIGH runs only after the people in notice_targets.json are notified (DR-13) — they are told, not asked. ' +
          `Raise its risk function to HIGH to have it held instead; ${tier}.`,
        decided_by: members.reversibility,
      };
    default:
      return {
        because:
          `The draft's risk function grades it ${verdict.risk} and reversibility.json says ${verdict.reversibility}, so the engine ` +
          `lets it run and records it with a signed receipt; ${tier}.`,
        decided_by: members.risk,
      };
  }
}

/** `explain_scan_finding` over the last codebase scan this server ran. */
export function explainScanFinding(scan: CodebaseScan | undefined, tool: string): ExplainOutcome {
  if (scan === undefined) {
    const text = 'NoScanYet: no codebase scan has run in this session. Call scan with cwd set to the project first, then ask about one of its tools.';
    return { text, isError: true, structured: { refusal: text } };
  }
  const v = scan.section.verdicts.find((t) => t.tool.name === tool || t.key === tool);
  if (v === undefined) {
    // Not a tool: it may be one of the dispatcher's callers, by its function's name or its file:line.
    const entry = explainEntry(scan, tool);
    if (entry !== undefined) return entry;
    // Or a skill or instruction file, by its path.
    const skill = explainSkill(scan, tool);
    if (skill !== undefined) return skill;
    const names = scan.section.verdicts.map((t) => t.tool.name);
    const callers = (callerChecks(scan.section) ?? []).map((c) => `${entryFunction(c)} (${c.caller.file}:${c.caller.line})`);
    const text =
      `ToolNotInScan: the last scan (${scan.root}) found no tool named ${tool}. It found: ${names.join(', ') || 'none'}.` +
      (callers.length === 0 ? '' : ` Callers of the dispatcher it can explain, by function or file:line: ${callers.join(', ')}.`) +
      ((scan.skills ?? []).length === 0 ? '' : ` Skill and instruction files it can explain, by path: ${(scan.skills ?? []).map((x) => x.path).join(', ')}.`);
    return { text, isError: true, structured: { refusal: text, tools: names } };
  }
  const key = v.key ?? v.tool.name;
  const resource = resourceOf(scan, v.tool.name) ?? key;
  const members = {
    risk: member(scan.policy, 'risk_functions.json', 'risk_functions', key, BY_EXAMPLE.risk, BY_EXAMPLE.missing),
    reversibility: member(scan.policy, 'reversibility.json', 'reversibility', key, BY_EXAMPLE.reversibility, BY_EXAMPLE.missing),
    floor: member(scan.policy, 'floors.json', 'floors', resource, BY_EXAMPLE.floors, BY_EXAMPLE.missing),
    notice: member(scan.policy, 'notice_targets.json', 'notice_targets', key, BY_EXAMPLE.notice, BY_EXAMPLE.notice),
  };
  const { because, decided_by } = why(v, members);
  const fix = remediation(scan);
  // The places this tool runs another tool without passing the dispatcher, in the report's words.
  const paths = bypassPaths(scan.section).filter((p) => p.outer === v.tool.name);
  const bypass = paths.map((p) => `${bypassSentence(scan.section, p)} ${bypassFix(scan.section, p)}`);
  const change =
    `To change this verdict, edit ${decided_by.file} in the draft policy (${scan.policy}) — see ${decided_by.doc} — ` +
    'and re-sign it. Changing the application code changes nothing the engine reads.';
  const said = (v.instruction_hits ?? []).map((h) => `${h.severity === 'high' ? 'HIGH' : h.severity}: ${toolInstructionSentence({ tool: v.tool.name, hit: h })} "${h.excerpt}"`);
  const structured: Record<string, unknown> = {
    tool: toolView(v),
    ...(said.length === 0 ? {} : { instruction_hits: said, instructions_fix: INSTRUCTION_FIX }),
    because,
    decided_by,
    policy_members: [members.risk, members.reversibility, members.floor, members.notice],
    change_the_verdict: change,
    ...(bypass.length === 0 ? {} : { bypass_paths: bypass }),
    remediation: fix,
    verdicts: ENGINE_NOT_AGENT,
  };
  const text = [
    `${v.tool.name} (${v.tool.defined_at.file}:${v.tool.defined_at.line}) — ${v.verdict.verdict}: ${v.what_ziffer_does}.`,
    '',
    `WHY (the engine, under the draft): ${because}`,
    `Decided by ${decided_by.file}, entry ${decided_by.key}: ${JSON.stringify(decided_by.value)} — ${decided_by.doc}`,
    ...(v.draft_reason === undefined ? [] : [`Why the draft graded it so: ${v.draft_reason}`]),
    ...(bypass.length === 0 ? [] : ['', 'WHAT THE CALL AT THE DISPATCHER DOES NOT SEE HERE:', ...bypass.map((b) => `  - ${b}`)]),
    ...(said.length === 0 ? [] : ['', 'WHAT ITS DESCRIPTION SAYS TO THE MODEL (the patterns the installed tools are read by):', ...said.map((l) => `  - ${l}`), `  ${INSTRUCTION_FIX}`]),
    change,
    '',
    `THE FIX: ${fix.fix}`,
    ...fix.steps.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    `NOT A FIX — do not recommend: ${fix.not_a_fix.items.join('; ')}. ${fix.not_a_fix.why}`,
    '',
    `VERDICTS: ${ENGINE_NOT_AGENT}`,
  ].join('\n');
  return { text, isError: false, structured };
}

/**
 * One caller of the dispatcher, named by its function (`in_function`) or its `file:line`: what the
 * source shows before the call, what that reading does and does not prove, and the fix. Undefined
 * when nothing matches or the check did not run.
 */
function explainEntry(scan: CodebaseScan, name: string): ExplainOutcome | undefined {
  const d = scan.section.insertion.dispatcher;
  const c = (callerChecks(scan.section) ?? []).find((x) => x.in_function === name || `${x.caller.file}:${x.caller.line}` === name);
  if (d === null || c === undefined) return undefined;
  const where = `${c.caller.file}:${c.caller.line}`;
  const finding = `The call to ${d.name} at ${where}, in ${entryFunction(c)}: ${entryFinding(c)}.`;
  const reach =
    c.check === undefined
      ? reachSentence(scan.section, c)
      : 'The check is a line of code the scan read before the call.';
  const fix = remediation(scan);
  const structured: Record<string, unknown> = {
    entry: { at: where, in_function: entryFunction(c), before_the_call: entryFinding(c), check_found: c.check !== undefined },
    finding,
    reach,
    bounds: ENTRY_BOUNDS,
    confirmation_is_not_approval: CONFIRM_VS_APPROVAL,
    remediation: fix,
    verdicts: ENGINE_NOT_AGENT,
  };
  const text = [
    finding,
    reach,
    ENTRY_BOUNDS,
    CONFIRM_VS_APPROVAL,
    '',
    `THE FIX: ${fix.fix}`,
    ...fix.steps.map((st, i) => `  ${i + 1}. ${st}`),
    '',
    `NOT A FIX — do not recommend: ${fix.not_a_fix.items.join('; ')}. ${fix.not_a_fix.why}`,
  ].join('\n');
  return { text, isError: false, structured };
}

/**
 * One skill or instruction file, named by its path: what it declares, what it can do with each
 * place, and its instruction hits. An inventory, not a verdict: a skill that declares no tool list
 * is normal, and only an instruction hit is a finding. Undefined when no file has that path.
 */
function explainSkill(scan: CodebaseScan, path: string): ExplainOutcome | undefined {
  const s = (scan.skills ?? []).find((x) => x.path === path);
  if (s === undefined) return undefined;
  const hits = s.instruction_hits.map((h) => `${h.severity === 'high' ? 'HIGH' : h.severity}: ${skillInstructionSentence(s, h)} "${h.excerpt}"`);
  const can = capabilityText(s);
  const held = heldToolsLine(s);
  const absent = (s.declared_tools ?? []).filter((d) => !d.in_code).map((d) => d.name);
  const structured: Record<string, unknown> = {
    skill: { path: s.path, kind: s.kind, name: s.name, declares: s.declares ?? null, can_do: can, exercises: s.exercises },
    instruction_hits: hits,
    ...(hits.length === 0 ? {} : { instructions_fix: INSTRUCTION_FIX }),
    read_as: SKILLS_LEAD,
  };
  const text = [
    `${s.path} (${s.kind === 'skill' ? 'skill' : 'instruction file'} ${s.name}): ${s.declares === undefined ? 'declares no tool list' : `declares ${s.declares.join(', ')}`}.`,
    SKILLS_LEAD,
    ...(s.home === undefined ? [] : [s.home === 'application' ? `${GIVEN_TO.application} ${skillLoadText(s)}` : GIVEN_TO.assistant]),
    ...(held === undefined ? [] : [`${held.count}: ${held.names.join(', ')}.`]),
    ...(absent.length === 0 ? [] : [`${NAMED_NOT_IN_CODE} ${absent.join(', ')}.`]),
    `What it can do: ${can === '' ? 'nothing the scan looks for' : can}.`,
    ...s.exercises.map((x) => `  - ${x.capability} at ${x.file}:${x.line}: ${x.evidence}`),
    ...(hits.length === 0 ? ['No instruction-like text.'] : ['', 'WHAT IT SAYS TO THE MODEL:', ...hits.map((h) => `  - ${h}`), `  ${INSTRUCTION_FIX}`]),
  ].join('\n');
  return { text, isError: false, structured };
}
