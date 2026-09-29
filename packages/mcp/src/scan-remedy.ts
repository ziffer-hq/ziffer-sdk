/**
 * What `scan` hands the AGENT about a codebase (ACP-455): the findings as data,
 * the one fix, and what is not a fix.
 *
 * The reader of a tool result is a model, and a model left to phrase a fix on
 * its own reaches for what it knows: a stricter prompt, a classifier on the
 * output, "ask the model to confirm first". Every one of those leaves the model
 * holding the authority to act and bets the outcome on the model behaving —
 * the architecture this product sells assumes the model is manipulable, and
 * its guarantee must not depend on injection failing (ZIFFER-SPEC-001 §5.1a:
 * relaxing a control on the strength of a content filter is a conformance
 * failure). So the fix is written here, once, in the result's `remediation`
 * field, and the same sentences are in the tool's description and in
 * `get_started`, rather than left to the agent's judgement.
 *
 * The verdicts are the ENGINE's under a draft policy. This module sorts them
 * into the four outcomes the scan counts and never grades a tool itself.
 */

import {
  bypassFix,
  bypassPaths,
  bypassSentence,
  CHECK_FOUND_MEANS,
  CHECK_NOT_FOUND_MEANS,
  CONFIRM_VS_APPROVAL,
  callerChecks,
  codeHeadlineOf,
  entryFinding,
  entryFunction,
  capabilityText,
  highInstructions,
  operatorSentence,
  pairsLine,
  GIVEN_TO,
  heldToolsLine,
  skillLoadText,
  skillsSummary,
  toolInstructionSentence,
  raisedSentence,
  reachSentence,
  uncheckedSummary,
} from '@ziffer-io/scan';

import type { CodebaseScan, CodeToolVerdict } from './scan-code.js';

/** Where a developer goes next. Checked live when this was written (HTTP 200). */
export const DOCS = {
  quickstart: 'https://ziffer.io/docs/quickstart',
  sdk: 'https://ziffer.io/docs/developers/sdk',
  byExample: 'https://ziffer.io/docs/policy/by-example',
} as const;

/** Sections of the policy-by-example page, by the anchors it serves (checked with curl, 2026-09-27). */
export const BY_EXAMPLE = {
  missing: `${DOCS.byExample}#3-three-kinds-of-missing`,
  floors: `${DOCS.byExample}#5-floorsjson`,
  risk: `${DOCS.byExample}#6-risk_functionsjson`,
  raise: `${DOCS.byExample}#6a-the-grammar-of-a-raise-clause`,
  reversibility: `${DOCS.byExample}#7-reversibilityjson`,
  notice: `${DOCS.byExample}#8-notice_targetsjson`,
  adapters: `${DOCS.byExample}#10-adaptersjson`,
} as const;

/** What an agent must NOT offer as the fix. Each is a model-side defence. */
export const NOT_A_FIX: readonly string[] = [
  'a prompt filter, or a stricter system prompt',
  'an output classifier, or a content filter on what the model writes',
  'asking the model to be careful, or to confirm with the user before it acts',
  'a model-side guardrail of any kind',
  "a requires_confirmation-style flag, or any authority hint, inside the application's own tool definitions",
];

export const NOT_A_FIX_WHY =
  'None of these removes the authority: each leaves the model able to run the tool and bets the outcome on the ' +
  'model behaving. ZIFFER assumes the model is manipulable — a prompt injection in an email, a web page or a ' +
  "tool's output can make it ask for anything — and its guarantee must not depend on the model (ZIFFER-SPEC-001 " +
  '§5.1a). A flag inside the same code the model drives is read by that code, not enforced on it.';

export const ENGINE_NOT_AGENT =
  "Every verdict here is the ZIFFER engine's, under a DRAFT policy the scan wrote for this codebase — never your " +
  'own judgement. Do not re-grade a tool, and do not call one safe or dangerous on your own reading. If the ' +
  'developer disagrees with a verdict, the change belongs in the draft policy (explain_scan_finding names the ' +
  'member and the line), then the policy is re-signed.';

/** The outcome the scan counts a verdict under (`counts` in the scan's `CodeSection`). */
export type Outcome = 'held' | 'notified' | 'allowed' | 'refused';

/**
 * The scan's own sorting (`isHeld` and `countsOf` in `packages/scan/src/code/
 * grade.ts`), restated because neither is on the package's library surface:
 * held is ATTEST or HIGH, notified is ALLOW and IRREVERSIBLE below HIGH.
 * `scan.test.ts` asserts these four tallies equal the scan's `counts`, so a
 * divergence is a red suite rather than two numbers on one screen.
 */
export function outcomeOf(v: CodeToolVerdict['verdict']): Outcome {
  if (v.verdict === 'REFUSED') return 'refused';
  if (v.verdict === 'ATTEST' || v.risk === 'HIGH') return 'held';
  return v.reversibility === 'IRREVERSIBLE' ? 'notified' : 'allowed';
}

const at = (r: { file: string; line: number }): string => `${r.file}:${r.line}`;

/** One tool as the agent reads it. */
export function toolView(v: CodeToolVerdict): Record<string, unknown> {
  const verdict = v.verdict;
  return {
    name: v.tool.name,
    at: at(v.tool.defined_at),
    ...(v.tool.execute_at === undefined ? {} : { execute_at: at(v.tool.execute_at) }),
    ...(v.tool.delegates_to === undefined ? {} : { delegates_to: v.tool.delegates_to }),
    sdk: v.tool.sdk,
    via: v.tool.via,
    outcome: outcomeOf(verdict),
    verdict: verdict.verdict,
    ...(verdict.verdict === 'REFUSED'
      ? { clause: verdict.clause, message: verdict.message }
      : { risk: verdict.risk, reversibility: verdict.reversibility, effective_tier: verdict.effective_tier, rule_id: verdict.rule_id }),
    what_ziffer_does: v.what_ziffer_does,
    ...(v.draft_reason === undefined ? {} : { draft_reason: v.draft_reason }),
    policy_key: v.key ?? v.tool.name,
    ...(v.instruction_hits === undefined || v.instruction_hits.length === 0
      ? {}
      : {
          instruction_hits: v.instruction_hits.map((h) => ({
            severity: h.severity,
            pattern: h.pattern,
            said: toolInstructionSentence({ tool: v.tool.name, hit: h }),
            excerpt: h.excerpt,
          })),
        }),
  };
}

/**
 * What the descriptions and the skills say to the model, of HIGH severity (2026-09-28), in the
 * report's words: one line each, with the place and the excerpt. The application's own
 * descriptions are its team's writing; the fix is to rewrite the text, never to filter the model.
 */
export function instructionLines(scan: CodebaseScan): string[] {
  return highInstructions(scan.section, scan.skills).map((h) => `${h.sentence} ${h.at}: "${h.excerpt}"`);
}

/** Why an instruction hit matters and what to do, said with every one. */
export const INSTRUCTION_FIX =
  'A model reads a tool description, a skill and an instruction file as instructions. Rewrite the text so it describes ' +
  'what the tool or the file does; do not add a filter on the model. What the model may run is decided by ZIFFER, not by the text.';

/** The skills and instruction files as the agent reads them: each with what it declares, what it can do, and its HIGH hits. */
export function skillsView(scan: CodebaseScan): Record<string, unknown> | undefined {
  const skills = scan.skills;
  if (skills === undefined) return undefined;
  return {
    summary: skillsSummary(skills),
    files: skills.map((s) => ({
      path: s.path,
      kind: s.kind,
      name: s.name,
      declares: s.declares ?? null,
      can_do: capabilityText(s),
      high_instruction_hits: s.instruction_hits.filter((h) => h.severity === 'high').map((h) => ({ line: h.line ?? null, why: h.why, excerpt: h.excerpt })),
      other_instruction_hits: s.instruction_hits.filter((h) => h.severity !== 'high').length,
      ...(s.home === undefined ? {} : { given_to: GIVEN_TO[s.home] }),
      ...(s.home === 'application' ? { loaded: skillLoadText(s) } : {}),
      ...(heldToolsLine(s) === undefined ? {} : { held_tools: heldToolsLine(s) }),
    })),
  };
}

/** The file the snippet is saved as, read out of the snippet's own import line. */
function snippetFile(scan: CodebaseScan): string {
  const match = /from '\.\/([\w.-]+)\.js'/.exec(scan.section.insertion.snippet);
  return match?.[1] === undefined ? 'the module file the snippet names' : `${match[1]}.ts`;
}

export interface Remediation {
  readonly finding: string;
  /**
   * What one call at the dispatcher does not see (ACP-455, 2026-09-28), in the report's own words:
   * each place a tool runs another tool without passing it, with what to do, and the calls to the
   * dispatcher with no confirmation check found. Absent when the scan found none.
   */
  readonly unseen?: readonly string[];
  readonly fix: string;
  readonly steps: readonly string[];
  readonly offer: string;
  readonly docs: { readonly quickstart: string; readonly sdk: string };
  readonly not_a_fix: { readonly items: readonly string[]; readonly why: string };
  readonly verdicts: string;
}

/** The one fix, with the dispatcher's file:line and the call line of THIS codebase. */
export function remediation(scan: CodebaseScan): Remediation {
  const { section } = scan;
  const c = section.counts;
  const ins = section.insertion;
  // The live tools the engine treats as impossible to undo under the draft: the headline's
  // "cannot be undone" and "write and say nothing about undoing it" together, stubs left out as
  // the headline leaves them out, so the agent reads the same numbers as the report.
  const irreversible = section.verdicts.filter((v) => v.tool.declared_stub !== true && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE');
  const finding =
    c.tools === 0
      ? 'The scan found no tool this codebase gives a model, so it found no authority to remove. not_seen says what it could not read.'
      : `${codeHeadlineOf(section)} ` +
        'When the model asks for a tool, the application runs it, and no check outside the model stands between its request and the code that acts. ' +
        (irreversible.length === 0
          ? 'Under the draft policy the engine treats none of them as impossible to undo.'
          : `Under the draft policy the engine treats these ${irreversible.length} as impossible to undo: ` +
            `${irreversible.map((v) => `${v.tool.name} at ${at(v.tool.defined_at)}`).join(', ')}.`);
  const fix =
    'Remove that authority from the model path and route every tool call through ZIFFER: the call reaches the code ' +
    'that acts only with a decision ZIFFER signed, and a held one waits for a person the policy names.';
  const file = snippetFile(scan);
  const place =
    ins.dispatcher === null
      ? `at the top of each tool's execute body (no single dispatcher was found; ${ins.sentence})`
      : `at the top of ${ins.dispatcher.name} (${at(ins.dispatcher.at)})`;
  const beside = ins.dispatcher === null ? 'beside the tools' : `beside ${ins.dispatcher.at.file}`;
  // The tools whose execute does not reach the dispatcher need the same line
  // in their own body; naming them is what makes "one line" not a lie.
  const dispatcher = ins.dispatcher;
  const outside = dispatcher === null ? [] : section.verdicts.filter((v) => v.tool.delegates_to !== dispatcher.name);
  const paths = bypassPaths(section);
  const steps = [
    `Add this one line ${place}: ${ins.call}` + (dispatcher === null ? '' : ` ${ins.sentence}`) + ` ${operatorSentence(section)}`,
    ...(outside.length === 0
      ? []
      : [
          `Add the same line at the top of the execute of each tool that does not run through ${dispatcher?.name ?? 'it'}: ` +
            outside.map((v) => `${v.tool.name} (${at(v.tool.execute_at ?? v.tool.defined_at)})`).join(', ') + '.',
        ]),
    // One step per place a tool runs another tool unseen: the call at the dispatcher does not see it.
    ...paths.map((p) => `${bypassSentence(section, p)} ${bypassFix(section, p)}`),
    `Save the snippet module (insertion.snippet) as ${file} ${beside}, and add its import line; it constructs the ZIFFER client, proposes each call and acts only on a signed decision.`,
    `Deploy ${scan.tools_file} with the application (the snippet reads ziffer-scan/ziffer-tools.json by default, or the path in ZIFFER_TOOLS_FILE).`,
    `Review the draft policy at ${scan.policy}, sign it with the developer's own key and publish it: ${DOCS.quickstart}. ` +
      'The scan signed it with a key made for this run and discarded, so it is a draft to review, never a policy to deploy.',
    `The SDK the snippet uses: ${DOCS.sdk}.`,
  ];
  const unseen = unseenOf(scan);
  return {
    finding,
    ...(unseen.length === 0 ? {} : { unseen }),
    fix,
    steps,
    offer: "You may offer to make this code change in the developer's repository. Make it only after they approve it.",
    docs: { quickstart: DOCS.quickstart, sdk: DOCS.sdk },
    not_a_fix: { items: NOT_A_FIX, why: NOT_A_FIX_WHY },
    verdicts: ENGINE_NOT_AGENT,
  };
}

/**
 * The bypass paths and the entries with no check found, in the report's words: the lines an agent
 * must pass on, never rephrase. Empty when the scan found neither.
 */
export function unseenOf(scan: CodebaseScan): string[] {
  const section = scan.section;
  const out: string[] = bypassPaths(section).map((p) => `${bypassSentence(section, p)} ${bypassFix(section, p)}`);
  const raised = raisedSentence(section);
  if (raised !== undefined && out.length > 0) out.push(raised);
  const none = uncheckedSummary(section);
  if (none !== undefined) out.push(`${none} ${CHECK_NOT_FOUND_MEANS}`, CONFIRM_VS_APPROVAL);
  return out;
}

/** The dispatcher's callers, each with what the source shows before its call; undefined when the check did not run. */
export function entriesView(scan: CodebaseScan): Record<string, unknown>[] | undefined {
  return callerChecks(scan.section)?.map((c) => ({
    at: at(c.caller),
    in_function: entryFunction(c),
    before_the_call: entryFinding(c),
    check_found: c.check !== undefined,
    ...(c.check === undefined ? { reaches: reachSentence(scan.section, c) } : {}),
  }));
}

/** The bounds on what an entry's reading means, said with every entry. */
export const ENTRY_BOUNDS = `${CHECK_FOUND_MEANS} ${CHECK_NOT_FOUND_MEANS}`;

/** How to present the result to the developer. */
export const HOW_TO_PRESENT =
  'Lead with the numbers (tools the model can call; held for a person; notified; refused; irreversible), then name ' +
  'each irreversible tool that is held or notified with its file:line and draft_reason, then give the ONE fix in ' +
  "remediation.steps, naming the dispatcher's file:line and the call line. Say what is not a fix only if the developer " +
  'proposes one of those. Offer to make the change; make it only on their approval.';

/** The codebase half as structured content. */
export function codebaseView(scan: CodebaseScan): Record<string, unknown> {
  const { section } = scan;
  const cat = section.catalog;
  const ins = section.insertion;
  return {
    status: 'scanned',
    root: scan.root,
    ...(cat.package_name === undefined ? {} : { package_name: cat.package_name }),
    files_read: cat.files_read,
    sdks: cat.sdks,
    counts: section.counts,
    tools: section.verdicts.map(toolView),
    exposures: cat.exposures.map((e) => ({ at: at(e.at), via: e.via, kind: e.kind, tools: e.tools, note: e.note })),
    gates: cat.gates.map((g) => ({ name: g.name, at: at(g.at), note: g.note })),
    dispatcher:
      ins.dispatcher === null
        ? null
        : {
            name: ins.dispatcher.name,
            at: at(ins.dispatcher.at),
            signature: ins.dispatcher.signature,
            tools_delegating: ins.dispatcher.tools_delegating,
            callers: ins.dispatcher.callers.map(at),
          },
    insertion: { sentence: ins.sentence, call: ins.call, per_tool: ins.per_tool, snippet: ins.snippet, snippet_language: ins.snippet_language, tools_file: scan.tools_file },
    ...(bypassPaths(section).length === 0
      ? {}
      : {
          bypass_paths: bypassPaths(section).map((p) => ({
            tool: p.outer,
            runs: p.call.tool ?? null,
            at: at(p.call.at),
            through: p.call.through,
            finding: bypassSentence(section, p),
            fix: bypassFix(section, p),
          })),
        }),
    ...(entriesView(scan) === undefined ? {} : { entries: entriesView(scan), entries_bounds: ENTRY_BOUNDS }),
    ...(instructionLines(scan).length === 0 ? {} : { instructions_high: instructionLines(scan), instructions_fix: INSTRUCTION_FIX }),
    ...(skillsView(scan) === undefined ? {} : { skills: skillsView(scan) }),
    ...(section.pairs === undefined || section.pairs.length === 0 ? {} : { data_leaving_pairs: section.pairs }),
    draft_policy: scan.policy,
    ...(scan.review === undefined ? {} : { report: scan.review.report, review_archive: scan.review.archive }),
    not_seen: cat.not_seen,
  };
}

/** The short text block the agent reads first. */
export function codebaseText(scan: CodebaseScan, r: Remediation): string[] {
  const c = scan.section.counts;
  const lines = [
    `Codebase ${scan.root}: ${c.tools} tools the application's code gives a model, graded by the ZIFFER engine under a draft policy: ` +
      `${c.held} held for a person, ${c.notified} run after a notice under the draft policy, ${c.refused} refused, ${c.allowed} allowed; ${c.irreversible} irreversible.`,
  ];
  const named = scan.section.verdicts.filter((v) => {
    const o = outcomeOf(v.verdict);
    return (o === 'held' || o === 'notified') && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE';
  });
  for (const v of named) {
    lines.push(`  - ${v.tool.name} (${at(v.tool.defined_at)}): ${outcomeOf(v.verdict)}${v.draft_reason === undefined ? '' : ` — ${v.draft_reason}`}`);
  }
  lines.push(
    '',
    `HOW TO PRESENT THIS: ${HOW_TO_PRESENT}`,
    '',
    `THE FINDING: ${r.finding}`,
    ...(r.unseen === undefined ? [] : ['', 'WHAT ONE CALL DOES NOT SEE (pass these on as written):', ...r.unseen.map((u) => `  - ${u}`)]),
    ...(instructionLines(scan).length === 0
      ? []
      : ['', 'TEXT THAT SPEAKS TO THE MODEL, HIGH SEVERITY (pass these on as written):', ...instructionLines(scan).map((l) => `  - ${l}`), `  ${INSTRUCTION_FIX}`]),
    ...(scan.skills === undefined ? [] : ['', `SKILLS: ${skillsSummary(scan.skills)} explain_scan_finding takes a file's path.`]),
    ...(scan.section.pairs === undefined || pairsLine(scan.section) === undefined ? [] : ['', `DATA THAT COULD LEAVE: ${pairsLine(scan.section) ?? ''}`]),
    '',
    `THE FIX: ${r.fix}`,
    ...r.steps.map((s, i) => `  ${i + 1}. ${s}`),
    r.offer,
    '',
    `NOT A FIX — do not recommend: ${r.not_a_fix.items.join('; ')}. ${r.not_a_fix.why}`,
    '',
    `VERDICTS: ${r.verdicts}`,
  );
  if (scan.review !== undefined) lines.push('', `Report (HTML, forwardable): ${scan.review.report}`);
  lines.push(`Draft policy: ${scan.policy}`, `Tool keys for the snippet: ${scan.tools_file}`);
  return lines;
}
