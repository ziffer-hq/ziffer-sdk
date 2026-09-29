/**
 * The three readings the scanner added on 2026-09-28, as the reports show them (ACP-455): the
 * paths that pass the dispatcher unseen (`calls`), who is asked per entry (`caller_checks`,
 * `authority_claims`), the proposed undo entries (`undo_hints`), which checks ran (`checks`),
 * and the operator the integration passes. Each test fails without its sentence, and each
 * finding has a test that it is ABSENT when its data is: a scan with no `calls` prints no
 * bypass section, and a check that did not run reads "not looked for", never "none found".
 *
 * The application is invented; its shape is the first customer's.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CiVerdict } from '../ci/ci.js';
import { countsOf, NO_REVERSIBILITY_ENTRY, NOTICE_ONLY_UNLISTED, whatZifferDoes } from '../code/grade.js';
import type { CallerCheck, CodeSection, CodeTool, CodeToolVerdict, Dispatcher, UndoHint } from '../code/types.js';
import { loadReplayData } from '../replay/data.js';
import type { ScanResult } from '../types.js';
import { CODE } from './code.fixture.test.data.js';
import { countsSentence, exposureGrade, gradeIfReversible, gradeLabel, gradeSentence, irreversibleBasis } from './code.js';
import { operatorSentence } from './code-html.js';
import { codeEvidence, codeExecSummary, codeLeak, execSentences, MARKED_IRREVERSIBLE, TODAY_LEDE, TODAY_LEDE_TAGGED, WHAT_CHANGES, WHAT_CHANGES_WHEN } from './exec.js';
import { FIXTURE } from './fixture.test.data.js';
import { renderReportHtml } from './file.js';
import {
  CHECK_FOUND_MEANS,
  CHECK_NOT_FOUND_MEANS,
  checkLines,
  claimsSentence,
  CONFIRM_VS_APPROVAL,
  confirmationSentence,
  reachSentence,
  UNDO_AMBIGUOUS,
  UNDO_CONSERVATIVE,
  UNDO_NEVER_ON_OWN_WORD,
} from './paths.js';
import { renderTerminal, stripAnsi } from './terminal.js';

const at = (file: string, line: number, col = 1): { file: string; line: number; col: number } => ({ file, line, col });

function tool(name: string, description: string, extra: Partial<CodeTool> = {}): CodeTool {
  return {
    name,
    description,
    schema_kind: 'zod',
    params: [],
    sdk: 'local',
    via: 'defineTool() (app-local factory, returns an Anthropic Tool input schema)',
    defined_at: at(`api/tools/${name}.ts`, 10),
    execute_at: at(`api/tools/${name}.ts`, 24),
    delegates_to: 'runTool',
    ...extra,
  };
}

const held = (rule: string): CiVerdict => ({ verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: rule });
const notice = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: rule });
const read = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'LOW', reversibility: 'REVERSIBLE', effective_tier: 'T0', rule_id: rule });

function verdict(t: CodeTool, v: CiVerdict, extra: Partial<CodeToolVerdict> = {}, unlisted = false): CodeToolVerdict {
  const what = unlisted ? (v.verdict === 'ATTEST' ? NO_REVERSIBILITY_ENTRY : NOTICE_ONLY_UNLISTED) : whatZifferDoes(v);
  return { tool: t, verdict: v, what_ziffer_does: what, untrusted_input: false, egress: false, ...extra };
}

const hint = (says: UndoHint['says'], source: UndoHint['source'], evidence: string): UndoHint => ({ says, source, evidence });
const confirmClaim = (value: string): Pick<CodeTool, 'authority_claims'> => ({ authority_claims: [{ name: 'requires_confirmation', value }] });

const VERDICTS: CodeToolVerdict[] = [
  verdict(tool('closeVenue', 'Close the venue for the season.', { ...confirmClaim('true'), calls: [{ tool: 'publishNotice', at: at('api/tools/close-venue.ts', 263, 39), via: 'direct', through: [] }] }), held('closeVenue'), {
    raised_by: 'publishNotice',
    draft_reason: 'also runs publishNotice',
  }),
  verdict(tool('runPlaybook', 'Run a saved playbook.', { ...confirmClaim('false'), calls: [{ at: at('api/playbooks/context.ts', 74, 25), via: 'lookup', through: ['buildContext', 'invokeTool'] }] }), held('runPlaybook'), {
    raised_by: '*',
    draft_reason: 'no word in its name or description tells the draft what it does: drafted as a write, confirm; runs a tool chosen at run time',
  }),
  verdict(tool('updateDoorCode', 'Update the venue door code.', confirmClaim('true')), held('updateDoorCode'), { draft_reason: 'name says "door code"' }),
  verdict(tool('publishNotice', 'Publish a notice on the venue page.', confirmClaim('true')), held('publishNotice'), {
    undo_hints: [hint('can_be_undone', 'inverse_tool', 'removeNotice')],
    draft_reason: 'name says "publish"',
  }),
  verdict(tool('removeNotice', 'Permanently remove a notice.', confirmClaim('true')), held('removeNotice'), {
    undo_hints: [hint('cannot_be_undone', 'description', 'Permanently')],
    draft_reason: 'name says "remove"',
  }),
  verdict(tool('markThreadDone', 'Mark a thread done. Reversible via reopenThread.', confirmClaim('false')), notice('markThreadDone'), {
    undo_hints: [hint('can_be_undone', 'description', 'Reversible via'), hint('can_be_undone', 'inverse_tool', 'reopenThread')],
  }, true),
  verdict(tool('setVenueKind', 'Set the venue kind override; does NOT modify bookings. Pass null to clear.', confirmClaim('false')), notice('setVenueKind'), {
    undo_hints: [hint('reads_only', 'description', 'does NOT modify'), hint('can_be_undone', 'description', 'Pass null to clear')],
  }, true),
  verdict(tool('reopenThread', 'Reopen a thread.', confirmClaim('false')), notice('reopenThread'), {}, true),
  verdict(tool('getVenueStats', 'Read-only counts for the venue.', confirmClaim('false')), read('getVenueStats'), {
    undo_hints: [hint('reads_only', 'description', 'Read-only')],
  }),
];

const CHECKS: CallerCheck[] = [
  { caller: at('api/decorators/decision-logger.ts', 67, 25), in_function: 'loggedOnToolCall' },
  { caller: at('api/orchestrator/bridge.ts', 334, 25), in_function: 'execute', check: { at: at('api/orchestrator/bridge.ts', 325, 9), reads: 'requires_confirmation' } },
  { caller: at('api/routes/confirm.ts', 1262, 27), in_function: "router.post('/venues/:id/confirmed-tool')", check: { at: at('api/routes/confirm.ts', 1230, 5), reads: 'confirmed' } },
];

const DISPATCHER: Dispatcher = {
  name: 'runTool',
  at: at('api/tools/run-tool.ts', 56),
  signature: '(toolName, rawInput, ctx, abortSignal)',
  callers: CHECKS.map((c) => c.caller),
  tools_delegating: VERDICTS.length,
  caller_checks: CHECKS,
};

const APP: CodeSection = {
  ...CODE,
  catalog: {
    ...CODE.catalog,
    package_name: 'invented-venues',
    tools: VERDICTS.map((v) => v.tool),
    dispatchers: [DISPATCHER],
    not_seen: [],
    checks: [
      { language: 'typescript', tool_calls: true, caller_checks: true },
      { language: 'python', tool_calls: true, caller_checks: true },
    ],
  },
  verdicts: VERDICTS,
  insertion: { ...CODE.insertion, dispatcher: DISPATCHER, call: 'await zifferGate(toolName, rawInput, zifferOperator(ctx));', sentence: 'One call at the top of runTool puts every one of the 8 tools under ZIFFER.' },
  counts: countsOf(VERDICTS),
};

const RESULT: ScanResult = { ...FIXTURE, catalog: [], findings: [], classifications: [], scope: { code: 'read', installed: false }, code: APP };

const CTX = {
  homes: [],
  machine: 'test-machine',
  words: loadReplayData().words,
  policy: {
    files: [
      { path: 'floors.json', text: '{"floors": {}}' },
      { path: 'reversibility.json', text: '{"reversibility": {"closeVenue": "IRREVERSIBLE", "runPlaybook": "IRREVERSIBLE", "updateDoorCode": "IRREVERSIBLE", "publishNotice": "IRREVERSIBLE", "removeNotice": "IRREVERSIBLE", "getVenueStats": "REVERSIBLE"}}' },
      { path: 'risk_functions.json', text: JSON.stringify({ risk_functions: VERDICTS.map((v) => ({ applies_to: v.tool.name, base: 'HIGH', raise_to: [] })) }) },
      { path: 'notice_targets.json', text: '{"notice_targets": {}}' },
      { path: 'attesters/registry.json', text: '{"quorum_k": 2, "attesters": {"approver-1": {}, "approver-2": {}}}' },
      { path: 'receipt_identity.json', text: '{"name": "scan-demo-receipt-key"}' },
    ],
    treeHash: 'sha256:00',
    tenantId: 'ten_demo_00',
    unclassified: [],
  },
};

const text = (s: string): string =>
  s.replace(/<style[^]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const page = (r: ScanResult = RESULT): string => renderReportHtml(r, undefined, CTX);
const summaryOf = (h: string): string => h.slice(h.indexOf('id="executive-summary"'), h.indexOf('id="technical"'));
/** From the element carrying `id` (a section, or since the second design a step of "Put ZIFFER in place") to the end of its section. */
const sectionOf = (h: string, id: string): string => {
  const i = h.indexOf(` id="${id}"`);
  return i < 0 ? '' : h.slice(i, h.indexOf('</section>', i));
};
const withCode = (code: CodeSection): ScanResult => ({ ...RESULT, code });

/** The app with every tool's calls and raises removed: the check ran and found none. */
function noCalls(checks: CodeSection['catalog']['checks'] = APP.catalog.checks): CodeSection {
  const verdicts = APP.verdicts.map((v) => {
    const { calls: _c, ...t } = v.tool;
    const { raised_by: _r, ...rest } = v;
    return { ...rest, tool: t };
  });
  const { checks: _k, ...catalog } = APP.catalog;
  return { ...APP, catalog: { ...catalog, tools: verdicts.map((v) => v.tool), ...(checks === undefined ? {} : { checks }) }, verdicts };
}

/** The app as a catalog made before the checks: no `checks` at all. */
function withoutChecks(): CodeSection {
  const { checks: _k, ...catalog } = APP.catalog;
  return { ...APP, catalog };
}

function withCallerChecks(checks: CallerCheck[] | undefined): CodeSection {
  const { caller_checks: _x, ...d } = DISPATCHER;
  const dispatcher: Dispatcher = checks === undefined ? d : { ...d, caller_checks: checks };
  return { ...APP, catalog: { ...APP.catalog, dispatchers: [dispatcher] }, insertion: { ...APP.insertion, dispatcher } };
}

// ---------------------------------------------------------------- 1. paths that pass the door unseen

test('1. each path a tool runs another tool unseen is a finding, with what to do, and a line in the executive summary', () => {
  const h = page();
  const s = text(sectionOf(h, 'bypass'));
  assert.ok(s.includes('Paths that pass the door unseen'));
  assert.ok(
    s.includes('closeVenue also runs publishNotice at api/tools/close-venue.ts:263, without passing runTool. A ZIFFER call at runTool would decide closeVenue and not see publishNotice. Route that call through runTool, or put the ZIFFER call at api/tools/close-venue.ts:263 too.'),
    s,
  );
  assert.ok(s.includes('runPlaybook runs a tool chosen at run time at api/playbooks/context.ts:74 (through buildContext and invokeTool); any tool may be the one run.'), s);
  assert.ok(
    s.includes(
      'The draft grades closeVenue as strictly as publishNotice, the tool it runs. The draft grades runPlaybook as strictly as the strictest tool in the draft, since any tool may be the one it runs. ' +
        'A ZIFFER call at runTool would decide only the outer tool, so its decision would be the only one the inner tool gets.',
    ),
    s,
  );
  const exec = codeExecSummary(APP, RESULT);
  const line = 'places where a tool runs another tool without passing runTool: a ZIFFER call at runTool would decide closeVenue and runPlaybook and not see the tool each one runs.';
  assert.equal(exec.unseen?.find((u) => u.kind === 'bypass')?.text, `2 ${line}`);
  assert.ok(execSentences(exec).includes(`2 ${line}`));
  // Re-pointed by the third design (2026-09-28): "In plain words" no longer repeats it. The page says it at the
  // top (the finding) and in step 3 of "Put ZIFFER in place"; the terminal and the MCP text keep the sentence.
  assert.ok(text(summaryOf(h)).includes('closeVenue and runPlaybook run a tool without passing runTool, so one call there would not see them.'), 'the finding at the top');
  assert.ok(text(sectionOf(h, 'insertion')).includes('2 places where a tool runs another tool without passing runTool. One ZIFFER call at runTool would decide the outer tool and would not see the inner one.'), 'step 3');
  assert.ok(exec.work.endsWith('The 2 places where a tool runs another tool without passing runTool need the same call, or to be routed through it.'), exec.work);
  assert.ok(!codeExecSummary(noCalls(), withCode(noCalls())).work.includes('runs another tool'));
  // The policy table's "To confirm" cell says why the outer tool is graded as it is.
  const policy = sectionOf(h, 'policy');
  assert.ok(/data-tool="closeVenue"[^]*?also runs publishNotice/.test(policy));
  assert.ok(/data-tool="runPlaybook"[^]*?runs a tool chosen at run time/.test(policy));
});

test('1. the insertion card counts no inner call as covered: one step per inner call site', () => {
  // Re-pointed by the second design (2026-09-28): one row per inner call site in step 3 of "Put ZIFFER in place".
  const card = text(renderReportHtml(RESULT, undefined, CTX).split('id="insertion"')[1] ?? '');
  assert.ok(card.includes('close-venue.ts:263 closeVenue runs publishNotice'), card);
  assert.ok(card.includes('Route that call through runTool, or put the ZIFFER call at api/tools/close-venue.ts:263 too.'), card);
  assert.ok(card.includes('context.ts:74 runPlaybook runs a tool chosen at run time'), card);
  assert.ok(card.includes('Route that call through runTool, or put the ZIFFER call at api/playbooks/context.ts:74 too.'), card);
  // The first screen's finding names the outer tools and says the one call would not see them.
  const first = page().split('<ol class="finds">')[1] ?? '';
  assert.ok(text(first.slice(0, first.indexOf('</ol>'))).includes('closeVenue and runPlaybook run a tool without passing runTool, so one call there would not see them.'), text(first.slice(0, 600)));
});

test('1. absent: with no calls the page has no bypass section, no summary line, no raise cell; a check that did not run says so', () => {
  const none = noCalls();
  const h = page(withCode(none));
  assert.ok(!h.includes('id="bypass"'), 'a bypass section with nothing in it');
  assert.ok(!h.includes('Paths that pass the door unseen'));
  assert.equal(codeExecSummary(none, withCode(none)).unseen?.some((u) => u.kind === 'bypass') ?? false, false);
  assert.ok(!h.includes('class="ck raised"') && !h.includes('<table class="r cover">'));
  assert.ok(!text(h).includes('would not see 2 places') && !text(h).includes('does not see 2 places'));
  // The check did not run: one line says it was not looked for, never "none found".
  const unrun = noCalls([{ language: 'typescript', tool_calls: false, caller_checks: true }]);
  const u = text(page(withCode(unrun)));
  assert.ok(u.includes('Tools that run another tool without passing runTool: not looked for in this scan.'), 'the reason the finding is absent');
  assert.ok(!u.includes('looked for, none found'));
});

// ---------------------------------------------------------------- 2. who is asked, per entry

test('2. one row per caller, the check found or not, the two sentences that bound it, the claims and why a click is not an approval', () => {
  const h = page();
  const sec = sectionOf(h, 'entries');
  assert.equal((sec.match(/<tr class="entry/g) ?? []).length, 3);
  const s = text(sec);
  assert.ok(s.includes('Who is asked, per entry'));
  // Re-pointed by the second design (2026-09-28): the entry first, its place under it, then the mark and what it means.
  // ACP-464: what the model can reach is the second column, "Before the call" the third.
  assert.ok(s.includes('loggedOnToolCall api/decorators/decision-logger.ts:67 not bounded by the source: any tool the dispatcher knows NO CHECK FOUND no confirmation check was found before the call'), s);
  assert.ok(s.includes('execute api/orchestrator/bridge.ts:334 not bounded by the source: any tool the dispatcher knows check found a check of requires_confirmation at api/orchestrator/bridge.ts:325 comes before the call'), s);
  assert.ok(s.includes("router.post('/venues/:id/confirmed-tool') api/routes/confirm.ts:1262 not bounded by the source: any tool the dispatcher knows check found a check of confirmed at api/routes/confirm.ts:1230 comes before the call"), s);
  assert.ok(sec.includes(`${CHECK_FOUND_MEANS} ${CHECK_NOT_FOUND_MEANS}`));
  assert.equal(CHECK_FOUND_MEANS, 'A check that was found is a line of code; the scan does not prove it stops the action.');
  assert.equal(CHECK_NOT_FOUND_MEANS, 'A check that was not found is what the scan read in that function, not proof that nobody is asked elsewhere.');
  assert.equal(
    claimsSentence(APP),
    // Split by the value written (second review): `false` declares that no confirmation is needed; 4 + 5 = 9.
    '`requires_confirmation` is written on 9 tool definitions: 4 set it to true, asking for a confirmation; 5 set it to false, which declares that no confirmation is needed. ' +
      'That is a statement in the tool’s definition. ' +
      'The scan read where it is tested: before the call in execute (api/orchestrator/bridge.ts:334), at api/orchestrator/bridge.ts:325.',
  );
  assert.ok(sec.includes('<code>requires_confirmation</code>'));
  assert.ok(s.includes(CONFIRM_VS_APPROVAL));
  // The executive summary names the caller with no check found.
  const u = codeExecSummary(APP, RESULT).unseen?.find((x) => x.kind === 'unchecked');
  assert.equal(
    u?.text,
    'From loggedOnToolCall (api/decorators/decision-logger.ts:67), no confirmation check was found before the call to runTool. ' +
      `The source does not bound which tools this path can call, so it can reach any of the ${DISPATCHER.tools_delegating} tools the dispatcher knows.`,
  );
  // Re-pointed by the third design (2026-09-28): "In plain words" no longer repeats it; the top of the page names
  // the entry with no check, and the per-entry section says both sentences; the terminal and the MCP keep u.text.
  assert.ok(summaryOf(h).includes('data-finding="unchecked"') && text(summaryOf(h)).includes('loggedOnToolCall'), 'the finding at the top');
  assert.ok(text(sec).includes('no confirmation check was found before the call') && text(sec).includes(`it can reach any of the ${DISPATCHER.tools_delegating} tools the dispatcher knows`), 'the per-entry section');
  // The held-table note: the person who confirms can be enrolled; never that a click replaces an approval.
  assert.ok(
    text(sectionOf(h, 'policy')).includes(
      "The scan found a confirmation check before 2 of the 3 calls to runTool (execute and router.post('/venues/:id/confirmed-tool')): the person who confirms there can be enrolled as the ZIFFER approver, so they confirm once, in ZIFFER.",
    ),
  );
});

test('2. the notice group says what the DRAFT does, never that nobody is asked', () => {
  for (const out of [page(), renderTerminal(RESULT, { full: true })]) {
    // The per-entry table's own bound says "not proof that nobody is asked elsewhere": that sentence is the point, not the group's label.
    const t = text(out).split(CHECK_NOT_FOUND_MEANS).join(' ');
    for (const old of ['nobody is asked', 'nobody asked', 'NOBODY ASKED', 'Nobody is asked', 'without asking anyone', 'with nobody asking']) assert.ok(!t.includes(old), `still says "${old}"`);
  }
  assert.ok(text(page()).includes('run after a notice under the draft'));
});

test('2. absent: every caller checked prints no summary line; a check that did not run prints no table and says so', () => {
  const all = withCallerChecks(CHECKS.filter((c) => c.check !== undefined));
  assert.equal(codeExecSummary(all, withCode(all)).unseen?.some((u) => u.kind === 'unchecked') ?? false, false);
  assert.ok(!summaryOf(page(withCode(all))).includes('data-finding="unchecked"'));
  const unrun = withCallerChecks(undefined);
  const h = page(withCode(unrun));
  assert.ok(!h.includes('<table class="r entries">'));
  assert.ok(text(sectionOf(h, 'entries')).includes('What the code tests before each call to runTool : not looked for in this scan.'));
  assert.ok(claimsSentence(unrun)?.endsWith('Where it is tested before a call to runTool was not looked for in this scan.'));
  assert.equal(codeExecSummary(unrun, withCode(unrun)).unseen?.some((u) => u.kind === 'unchecked') ?? false, false);
  // No authority property anywhere: no claims sentence.
  const bare = { ...APP, catalog: { ...APP.catalog, tools: APP.catalog.tools.map(({ authority_claims: _a, ...t }) => t) } };
  assert.equal(claimsSentence(bare), undefined);
});

// ---------------------------------------------------------------- 3. proposed undo entries

test('3. the proposed undo entries: evidence in the source’s words, what the draft does, the entry to add, the ambiguous one, and the grade if confirmed', () => {
  const h = page();
  const box = h.slice(h.indexOf('id="undo"'), h.indexOf('</div>', h.indexOf('class="undo-grade"')));
  const t = text(box);
  assert.ok(t.includes('Proposed undo entries'));
  assert.ok(t.includes(UNDO_NEVER_ON_OWN_WORD));
  assert.ok(t.includes('publishNotice removeNotice exists listed as impossible to undo; held for a person change it to "publishNotice": "REVERSIBLE"'), t);
  assert.ok(t.includes('markThreadDone description says "Reversible via" reopenThread exists no entry, read as impossible to undo; runs after a notice under the draft policy add "markThreadDone": "REVERSIBLE"'), t);
  assert.ok(t.includes(`setVenueKind description says "does NOT modify" description says "Pass null to clear"`) && t.includes(`${UNDO_AMBIGUOUS}`), t);
  assert.ok(!t.includes('"setVenueKind": "REVERSIBLE"'), 'an entry proposed for an ambiguous description');
  assert.ok(t.includes('getVenueStats description says "Read-only" listed as one that can be undone; runs, with a receipt nothing to add'), t);
  assert.ok(!/data-tool="removeNotice"/.test(box), 'a cannot-be-undone tool is not a proposal');
  // The cannot-be-undone words are the reason in the row they made stricter.
  assert.ok(/data-tool="removeNotice"[^]*?description says &quot;Permanently&quot;/.test(sectionOf(h, 'policy')));
  // The grade if every entry is confirmed: computed from the same counts.
  const now = exposureGrade(APP);
  const after = gradeIfReversible(APP, new Set(['publishNotice', 'markThreadDone']));
  assert.ok(now !== undefined && after !== undefined);
  assert.equal(after.moved, 2);
  assert.equal(after.grade.known, now.known - 1);
  assert.equal(after.grade.unlisted, now.unlisted - 1);
  const sentence = `If a person confirms every entry proposed here, 2 tools leave the grade's count and the grade becomes ${gradeLabel(after.grade)}`;
  assert.ok(t.includes(sentence), `${sentence} | ${t}`);
});

test('the policy’s gap line says its counts include the stubs the grade leaves out, so the page does not show two numbers for one thing', () => {
  const verdicts = APP.verdicts.map((v, i) => (i === 4 ? { ...v, tool: { ...v.tool, declared_stub: true } } : v));
  const h = text(sectionOf(page(withCode({ ...APP, verdicts })), 'policy'));
  assert.ok(h.includes('(these counts include 1 tool whose description says it is a stub, which the grade leaves out)'), h.slice(0, 600));
  assert.ok(!text(sectionOf(page(), 'policy')).includes('these counts include'));
  // The terminal's counts line says the same (third review): the engine's counts keep the stubs the headline leaves out.
  assert.ok(countsSentence({ ...APP, verdicts }).endsWith("These are the engine's counts over all 9 tools, the 1 stub included."), countsSentence({ ...APP, verdicts }));
  assert.ok(!countsSentence(APP).includes('included'));
});

test('3. absent: no undo hint, no table', () => {
  const verdicts = APP.verdicts.map(({ undo_hints: _u, ...v }) => v);
  const h = page(withCode({ ...APP, verdicts }));
  assert.ok(!h.includes('id="undo"') && !h.includes('Proposed undo entries'));
});

// ---------------------------------------------------------------- 4. which checks ran

test('4. the limits say which checks ran per language, and "not looked for" where one did not', () => {
  assert.deepEqual(checkLines(APP), [
    'TypeScript: tools that run another tool without passing runTool: looked for, 2 found. What the code tests before each call to runTool: looked for, no confirmation check found before 1 of 3 calls.',
    'Python: tools that run another tool without passing runTool: looked for, none found. What the code tests before each call to runTool: looked for; no call to runTool in this language.',
  ]);
  const limits = text(sectionOf(page(), 'limits'));
  assert.ok(limits.includes('Python: tools that run another tool without passing runTool: looked for, none found.'));
  const before = withoutChecks();
  assert.deepEqual(checkLines(before), [
    'Tools that run another tool without passing runTool: not looked for in this scan.',
    'What the code tests before each call to runTool: not looked for in this scan.',
  ]);
  const half = { ...APP, catalog: { ...APP.catalog, checks: [{ language: 'typescript' as const, tool_calls: false, caller_checks: true }] } };
  assert.ok(checkLines(half)[0]?.startsWith('TypeScript: tools that run another tool without passing runTool: not looked for.'));
});

// ---------------------------------------------------------------- 5. the operator

test('5. the operator: read from the dispatcher’s context object when there is one, else the application, said', () => {
  assert.equal(
    operatorSentence(APP),
    "The call passes runTool's ctx to zifferOperator in the module. An operator is the person on whose behalf the model acts. " +
      'Which field of ctx identifies the signed-in person is yours to choose there; until you choose, every proposal names the application, invented-venues, not a person.',
  );
  assert.ok(text(page()).includes("The call passes runTool's ctx to zifferOperator in the module."));
  const plain = { ...APP, insertion: { ...APP.insertion, dispatcher: { ...DISPATCHER, signature: '(toolName, rawInput)' } } };
  assert.equal(
    operatorSentence(plain),
    'runTool has no context parameter, so every proposal will name the application, invented-venues, as its operator, not a person. An operator is the person on whose behalf the model acts.',
  );
});

// ---------------------------------------------------------------- 7. the terminal

test('7. the one screen gains two lines, each only when its finding is there', () => {
  const screen = stripAnsi(renderTerminal(RESULT, { width: 120 })).split('\n');
  assert.ok(screen.includes('Paths that pass runTool unseen: 2 (closeVenue and runPlaybook).'), screen.join('\n'));
  assert.ok(screen.includes('Calls to runTool with no check found: 1 of 3 (loggedOnToolCall).'));
  const quiet = withCallerChecks(CHECKS.filter((c) => c.check !== undefined));
  const q = stripAnsi(renderTerminal(withCode({ ...noCalls(), catalog: { ...noCalls().catalog, dispatchers: quiet.catalog.dispatchers }, insertion: quiet.insertion }), { width: 120 }));
  assert.ok(!q.includes('unseen:') && !q.includes('with no check found'), q);
  // Exactly two more lines than the same screen without them.
  const base = stripAnsi(renderTerminal(withCode({ ...noCalls(), catalog: { ...noCalls().catalog, dispatchers: quiet.catalog.dispatchers }, insertion: quiet.insertion }), { width: 120 })).split('\n');
  assert.equal(screen.length - base.length, 2);
});

// ---------------------------------------------------------------- the reason a tool is held, as the data records it

test('each held tool is shown under its actual reason: its own words, running another tool, or an access value', () => {
  const basis = Object.fromEntries(APP.verdicts.map((v) => [v.tool.name, irreversibleBasis(v)]));
  assert.deepEqual(
    { closeVenue: basis['closeVenue'], runPlaybook: basis['runPlaybook'], updateDoorCode: basis['updateDoorCode'], publishNotice: basis['publishNotice'], removeNotice: basis['removeNotice'], markThreadDone: basis['markThreadDone'] },
    { closeVenue: 'runs_another', runPlaybook: 'runs_another', updateDoorCode: 'access_value', publishNotice: 'marked', removeNotice: 'marked', markThreadDone: undefined },
  );
  const bullets = codeExecSummary(APP, RESULT).bullets;
  for (const b of bullets) {
    if (b.text !== MARKED_IRREVERSIBLE) continue;
    for (const name of b.tools) assert.equal(basis[name], 'marked', `${name} said to be marked by its own words`);
  }
  const runs = bullets.find((b) => b.tools.includes('closeVenue'));
  assert.deepEqual(runs?.tools.slice().sort(), ['closeVenue', 'runPlaybook']);
  assert.equal(runs?.text, 'Held because each runs another tool, and the draft grades each as strictly as the tool it runs: closeVenue runs publishNotice; runPlaybook runs a tool chosen at run time.');
  const access = bullets.find((b) => b.tools.includes('updateDoorCode'));
  assert.deepEqual(access?.tools, ['updateDoorCode']);
  // The policy's gap line says the same split, over every tool the engine treats so.
  assert.ok(
    text(sectionOf(page(), 'policy')).includes(
      '2 because their name or description says so (confirm each reading), 2 because they run another tool, 1 because it writes an access value, 3 because nothing says they can be undone',
    ),
  );
  assert.equal(access?.text, 'Held because its name or parameters name an access value or a secret (name says "door code").');
});

test('the headline and the grade split the count by reason, and the parts add up to the graded total', () => {
  const g = exposureGrade(APP);
  assert.ok(g !== undefined);
  assert.deepEqual(
    { known: g.known, derived: g.derived, runsAnother: g.runsAnother, accessValue: g.accessValue, unlisted: g.unlisted, reads: g.reads, refused: g.refused, tools: g.tools },
    { known: 2, derived: 3, runsAnother: 2, accessValue: 1, unlisted: 3, reads: 1, refused: 0, tools: 9 },
  );
  assert.equal(g.known + g.derived + g.unlisted + g.reads + g.refused, g.tools);
  assert.equal(g.runsAnother + g.accessValue, g.derived);
  // Second review: one number of live tools, then three clauses that add up to it (5 + 3 + 1 = 9).
  assert.equal(
    codeExecSummary(APP, RESULT).headline,
    'A model in invented-venues can call 9 live tools. 5 cannot be undone, by their own name or description, by what they run, or because they write an access value. ' +
      '3 write and say nothing about undoing it. 1 only reads.',
  );
  // The grade box keeps the detailed split, with the same total of 5.
  assert.ok(
    gradeSentence(g).includes(
      '5 of the 9 tools (55%) count: 2 are marked as impossible to undo by their name or description, 2 are treated as impossible to undo because they run another tool and 1 because it writes an access value; confirm each reading.',
    ),
    gradeSentence(g),
  );
});

test('3. no cell of the proposed policy repeats a phrase: the raise is said once', () => {
  const policy = sectionOf(page(), 'policy');
  const cells = [...policy.matchAll(/<td(?: data-l="[^"]*")?>([^]*?)<\/td>/g)].map((m) => text(m[1] ?? '').trim());
  assert.ok(cells.length > 20);
  for (const cell of cells) {
    const w = cell.split(/\s+/).filter((x) => x !== '');
    const seen = new Set<string>();
    for (let i = 0; i + 3 <= w.length; i++) {
      const tri = w.slice(i, i + 3).join(' ');
      assert.ok(!seen.has(tri), `"${tri}" twice in the cell "${cell}"`);
      seen.add(tri);
    }
  }
  const close = policy.slice(policy.indexOf('data-tool="closeVenue"'));
  const confirmCell = /<td data-l="To confirm">([^]*?)<\/td>/.exec(close)?.[1] ?? '';
  assert.equal(text(confirmCell).trim(), 'also runs publishNotice');
});

test('the executive summary carries the reply warning when the draft holds the tool that carries replies, and not otherwise', () => {
  const reply = verdict(tool('respond', 'Send your response to the guest. Always use this tool to deliver your final answer.'), held('respond'), { draft_reason: 'description says "Send your response"', irreversible_class: 1 });
  const verdicts = [...APP.verdicts, reply];
  const withReply = { ...APP, catalog: { ...APP.catalog, tools: verdicts.map((v) => v.tool) }, verdicts, counts: countsOf(verdicts) };
  const warn = 'As drafted, respond is held for approval, so replies would wait for a person. Decide what this carries before you sign.';
  assert.equal(codeExecSummary(withReply, withCode(withReply)).reply, warn);
  // Re-pointed by the third design (2026-09-28): said once above the technical part, by the top of the page when it
  // is among the three findings there, else under "What a model can do today"; never twice.
  const sum = text(summaryOf(page(withCode(withReply))));
  assert.equal(sum.split(warn).length - 1, 1, sum.slice(0, 800));
  assert.equal(codeExecSummary(APP, RESULT).reply, undefined);
  assert.ok(!text(summaryOf(page())).includes('replies would wait'));
});

// ---------------------------------------------------------------- the second review (2026-09-28)

test('review 2: the summary says what the scan read about asking a person, with the counts, never "does not see whether your application asks"', () => {
  const exec = codeExecSummary(APP, RESULT);
  assert.equal(confirmationSentence(APP), 'The scan read the code before each call to runTool: it found a confirmation check before 2 of the 3 calls. It does not see whether a person answered it.');
  assert.equal(exec.subline, confirmationSentence(APP));
  const summary = text(summaryOf(page()));
  assert.ok(summary.includes(confirmationSentence(APP)), summary.slice(0, 600));
  assert.ok(!summary.includes('does not see whether your application asks') && !summary.includes('the scan does not see whether anything does'), summary.slice(0, 900));
  // None found: said, and what it cannot see.
  const none = withCallerChecks(CHECKS.map(({ check: _c, ...c }) => c));
  assert.equal(confirmationSentence(none), 'The scan read the code before each call to runTool: it found a confirmation check before 0 of the 3 calls. It does not see whether a person is asked elsewhere.');
  // Not looked: in those words.
  assert.equal(confirmationSentence(withCallerChecks(undefined)), 'The scan did not look for a confirmation check before the calls to runTool.');
  const noDoor = { ...APP, insertion: { ...APP.insertion, dispatcher: null, per_tool: true } };
  assert.equal(confirmationSentence(noDoor), 'The scan found no one function every tool runs through, so it did not look for a confirmation check before the calls.');
});

test('review 2: a caller with no check found says what it reaches: all stubs, live tools grouped, or everything when the source does not bound it', () => {
  const stubbed = (names: readonly string[]): CodeSection => {
    const verdicts = APP.verdicts.map((v) => (names.includes(v.tool.name) ? { ...v, tool: { ...v.tool, declared_stub: true } } : v));
    return { ...APP, verdicts, catalog: { ...APP.catalog, tools: verdicts.map((v) => v.tool) } };
  };
  const bounded = (reaches: string[]): CallerCheck => ({ caller: at('api/desks/till.ts', 12, 3), in_function: 'tillDesk', reaches, reaches_from: "the name prefix 'till_' tested at api/desks/till.ts:9" });
  // Every tool it reaches is a stub.
  const allStubs = stubbed(['markThreadDone', 'reopenThread']);
  assert.equal(
    reachSentence(allStubs, bounded(['markThreadDone', 'reopenThread'])),
    "This path reaches 2 tools (read from the name prefix 'till_' tested at api/desks/till.ts:9), all declared and not wired yet. " +
      'When they are wired, this is the path with no confirmation check in front of them.',
  );
  // Live tools, grouped held / notice / runs, and the stubs beside them said apart.
  assert.equal(
    reachSentence(stubbed(['reopenThread']), bounded(['closeVenue', 'getVenueStats', 'markThreadDone', 'reopenThread'])),
    "This path reaches 3 live tools (read from the name prefix 'till_' tested at api/desks/till.ts:9); held for a person: closeVenue; run after a notice: markThreadDone; run, recorded: getVenueStats. " +
      'It also reaches 1 tool declared and not wired yet: reopenThread.',
  );
  // Not bounded by the source.
  const [first] = CHECKS;
  assert.ok(first !== undefined);
  assert.equal(reachSentence(APP, first), `The source does not bound which tools this path can call, so it can reach any of the ${DISPATCHER.tools_delegating} tools the dispatcher knows.`);
  // The executive bullet and the per-entry row say the same sentence.
  const code = withCallerChecks([bounded(['markThreadDone', 'reopenThread']), ...CHECKS.slice(1)]);
  const both = { ...code, verdicts: allStubs.verdicts, catalog: { ...code.catalog, tools: allStubs.catalog.tools } };
  const sentence = reachSentence(both, bounded(['markThreadDone', 'reopenThread']));
  const u = codeExecSummary(both, withCode(both)).unseen?.find((x) => x.kind === 'unchecked');
  assert.equal(u?.text, `From tillDesk (api/desks/till.ts:12), no confirmation check was found before the call to runTool. ${sentence}`);
  assert.ok(text(sectionOf(page(withCode(both)), 'entries')).includes(sentence));
});

/** The app with a read that names an access value and a sender: the pair the data-leaving finding names. */
function withLeak(): CodeSection {
  const reader = verdict(tool('getDoorCode', 'Get the venue door code.'), read('getDoorCode'), { sensitive_value: 'door code' });
  const sender = verdict(tool('emailGuest', 'Email the guest.'), notice('emailGuest'), { egress: true }, true);
  const verdicts = [...APP.verdicts.map((v) => (v.tool.name === 'updateDoorCode' ? { ...v, sensitive_value: 'door code' } : v)), reader, sender];
  return { ...APP, verdicts, catalog: { ...APP.catalog, tools: verdicts.map((v) => v.tool) }, counts: countsOf(verdicts) };
}

test('review 2: a read that returns an access value and a tool that sends data out are named as a path, conditional on the tool set, never as a chain', () => {
  const code = withLeak();
  const leak = codeLeak(code);
  assert.ok(leak !== undefined);
  assert.deepEqual(leak.readers, [{ tool: 'getDoorCode', word: 'door code' }], 'a WRITE of an access value is not a reader');
  assert.deepEqual(leak.senders, ['emailGuest']);
  const gate = code.catalog.gates[0];
  assert.ok(gate !== undefined);
  assert.equal(
    leak.text,
    `getDoorCode returns door code; emailGuest sends data out. Which tools a model is given is decided at run time by getToolsForLocation (${gate.at.file}:${gate.at.line}). ` +
      'If both are given to the same model, a manipulated model can send one through the other.',
  );
  const summary = summaryOf(page(withCode(code)));
  // Re-pointed by the third design (2026-09-28): "In plain words" says the pair in one line (in the outsider band,
  // or under the first table when there is no outsider path) and links to the section, which says the whole sentence.
  assert.ok(text(summary).includes(leak.line) && summary.includes('<a href="#leak">Read it</a>'));
  assert.ok(text(sectionOf(page(withCode(code)), 'leak')).includes(leak.text));
  const t0086 = codeEvidence(code, undefined)['AML.T0086'];
  assert.ok(t0086 !== undefined && 'evidence' in t0086 && t0086.evidence.endsWith('; getDoorCode returns an access value one of them could send'), JSON.stringify(t0086));
  // More senders than are named: the count, then the first ones, never "among" glued to a name.
  const many = { ...code, verdicts: [...code.verdicts, ...['faxGuest', 'postReview', 'smsGuest'].map((n) => verdict(tool(n, `${n}.`), notice(n), { egress: true }, true))] };
  assert.ok(codeLeak(many)?.text.startsWith('getDoorCode returns door code; 4 tools send data out, among them emailGuest, faxGuest and postReview.'), codeLeak(many)?.text);
  // The ATLAS row counts the senders the path names, stubs left out as everywhere else.
  const stubSender = { ...code, verdicts: [...code.verdicts, verdict(tool('faxGuest', 'Stub: fax the guest.', { declared_stub: true }), notice('faxGuest'), { egress: true }, true)] };
  const cell = codeEvidence(stubSender, undefined)['AML.T0086'];
  assert.ok(cell !== undefined && 'count' in cell && cell.count === 1 && !cell.tools.some((x) => x.name === 'faxGuest'), JSON.stringify(cell));
  // No sender, no path: nothing named.
  const quiet = { ...code, verdicts: code.verdicts.map((v) => ({ ...v, egress: false })) };
  assert.equal(codeLeak(quiet), undefined);
  assert.equal(codeLeak(APP), undefined);
});

test('review 2: the "To confirm" cell shows what the source says about undoing, in its words, under one sentence said once', () => {
  const policy = sectionOf(page(), 'policy');
  const row = policy.slice(policy.indexOf('data-tool="markThreadDone"'));
  const cell = /<td data-l="To confirm">([^]*?)<\/td>/.exec(row)?.[1] ?? '';
  assert.ok(text(cell).includes('description says "Reversible via"; reopenThread exists'), text(cell));
  assert.equal(policy.split(UNDO_CONSERVATIVE).length - 1, 1, 'said once');
  assert.ok(policy.indexOf(UNDO_CONSERVATIVE) < policy.indexOf('<table class="r chk ruletable">'), 'above the tables');
  // A cannot-be-undone hint stays in its own column, not in "To confirm".
  const remove = policy.slice(policy.indexOf('data-tool="removeNotice"'));
  assert.ok(!text(/<td data-l="To confirm">([^]*?)<\/td>/.exec(remove)?.[1] ?? '').includes('Permanently'));
  // No hint anywhere: no sentence.
  const verdicts = APP.verdicts.map(({ undo_hints: _u, ...v }) => v);
  assert.ok(!page(withCode({ ...APP, verdicts })).includes(UNDO_CONSERVATIVE));
});

test('review 2: what holds only after the customer integrates is said as conditional', () => {
  assert.ok(WHAT_CHANGES.every((w) => w.startsWith('Once ZIFFER is in place') || w.startsWith('From then on')), WHAT_CHANGES.join(' | '));
  const h = text(page());
  assert.ok(h.includes('Grouped by what ZIFFER would do under the draft policy.'));
  // The first screen claims no coverage: it says where the call goes, and the door says how many tools run through it.
  const first = text(summaryOf(page()));
  assert.ok(!/ puts /.test(first) && first.includes('Put ZIFFER at the top of runTool'), first.slice(0, 2000));
  // Re-pointed by the third design (2026-09-28): the page has no ZIFFER HOLDS marks for that sentence to point at;
  // the condition is said by the headings: the actions the draft policy WOULD hold, and what changes once the calls are in place.
  // ACP-464: the subtitle speaks of today, then of what the draft would hold; a row the draft does not hold is the tagged exception.
  assert.ok((h.includes(TODAY_LEDE) || h.includes(TODAY_LEDE_TAGGED)) && [TODAY_LEDE, TODAY_LEDE_TAGGED].every((l) => l.includes('would hold')));
  assert.ok(h.includes(`What ZIFFER changes. ${WHAT_CHANGES_WHEN}`) && WHAT_CHANGES_WHEN.startsWith('Once '));
});
