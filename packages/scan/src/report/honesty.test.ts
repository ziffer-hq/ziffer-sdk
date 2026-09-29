/**
 * The report says only what the scan measured (ACP-455, second review). A reader who knows
 * the scanned application found sentences that were false or overstated: "on its own" when
 * the scan does not see whether anyone is asked, one letter where the data gives a range,
 * "cannot be undone" read from a keyword, regulation rows that do not apply, an OWASP row
 * that does not exist, ZIFFER's internal threat-model ids printed as findings, "one line of
 * code", a stand-in addressee printed as "you". Each test below fails on the old sentence.
 *
 * The application here is built in the shape of the first customer's: most writes with no
 * reversibility entry, a reply tool held for approval, tools whose description says stub,
 * a tool that returns counts beside tools that return outsiders' text, and one tool that
 * does not run through the dispatcher.
 */

import assert from 'node:assert/strict';
import { OWASP_EXCESSIVE_AGENCY } from './owasp.js';
import { test } from 'node:test';

import type { CiVerdict } from '../ci/ci.js';
import { countsOf, NO_REVERSIBILITY_ENTRY, NOTICE_ONLY_UNLISTED, whatZifferDoes } from '../code/grade.js';
import type { CodeSection, CodeTool, CodeToolVerdict } from '../code/types.js';
import { loadReplayData } from '../replay/data.js';
import type { ScanResult } from '../types.js';
import { CODE } from './code.fixture.test.data.js';
import { exposureGrade, gradeLabel, gradeNow, gradeRecord, gradeSentence, gradeNowSentence, gradeTitle, GRADE_DEFINITION, provisionalReason, STUB_LABEL, workSentence } from './code.js';
import { TOLD_PLACEHOLDER } from './code-html.js';
import { attachControls, EXCLUDED_CITATIONS, FINDING_CONTROLS, parseFindingControls } from './controls.js';
import { codeExecSummary, execSentences, HEAT_TECHNIQUES, MATTERS_INTRO, WHAT_CHANGES } from './exec.js';
import { TECHNIQUE_GLOSS } from './exec-html.js';
import { FIXTURE } from './fixture.test.data.js';
import { renderReportHtml } from './file.js';
import { confirmationSentence } from './paths.js';
import { renderTerminal } from './terminal.js';

// ---------------------------------------------------------------- the application

const at = (file: string, line: number): { file: string; line: number; col: number } => ({ file, line, col: 1 });

function tool(name: string, description: string, params: string[] = [], dispatched = true): CodeTool {
  return {
    name,
    description,
    schema_kind: 'zod',
    params,
    sdk: 'local',
    via: 'defineTool() (app-local factory, returns an Anthropic Tool input schema)',
    defined_at: at(`api/tools/${name}.ts`, 10),
    execute_at: at(`api/tools/${name}.ts`, 24),
    ...(dispatched ? { delegates_to: 'executeTool' } : {}),
  };
}

const held = (rule: string): CiVerdict => ({ verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: rule });
const notice = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: rule });
const read = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'LOW', reversibility: 'REVERSIBLE', effective_tier: 'T0', rule_id: rule });

/** Listed IRREVERSIBLE by the draft: a word in the name or description. */
function known(t: CodeTool, reason: string): CodeToolVerdict {
  return { tool: t, verdict: held(t.name), what_ziffer_does: whatZifferDoes(held(t.name)), draft_reason: reason, untrusted_input: false, egress: false, irreversible_class: 3 };
}
/** No reversibility entry: the engine treats it as irreversible, nothing in the tool says so. */
function unlisted(t: CodeTool, isHeld = false): CodeToolVerdict {
  const v = isHeld ? held(t.name) : notice(t.name);
  return { tool: t, verdict: v, what_ziffer_does: isHeld ? NO_REVERSIBILITY_ENTRY : NOTICE_ONLY_UNLISTED, untrusted_input: false, egress: false };
}
function reader(t: CodeTool, words: string[] = []): CodeToolVerdict {
  return { tool: t, verdict: read(t.name), what_ziffer_does: whatZifferDoes(read(t.name)), untrusted_input: words.length > 0, ...(words.length > 0 ? { untrusted_words: words } : {}), egress: false };
}

const STUB = (what: string): string => `${what} Stub for Phase 72 - wired in Phase 74.`;
/** A tool the scanner read as declared, not wired: the field is set as the scanner sets it, beside the description that says so. */
const stubTool = (name: string, what: string): CodeTool => ({ ...tool(name, STUB(what)), declared_stub: true });

const VERDICTS: CodeToolVerdict[] = [
  known(tool('deleteGbpPost', 'Delete a post from the Google Business Profile.'), 'name says "delete"'),
  known(tool('cancelReservation', 'Cancel a booking and trigger the refund.'), 'name says "cancel"'),
  known(tool('respond', 'Send your response to the guest. Always use this tool to deliver your final answer.', ['message'], false), 'description says "Send your response"'),
  unlisted(tool('replyToReview', 'Post a public owner reply to a Google review.', ['reviewId', 'comment']), true),
  unlisted(tool('applyDiscount', 'Apply a post-booking discount to a direct booking.')),
  unlisted(tool('updateRoomPrice', 'Set the nightly price of a room.')),
  known(stubTool('prospector_send_email', 'Send an outreach email.'), 'name says "send"'),
  unlisted(stubTool('prospector_bulk_enrich', 'Queue enrichment jobs for prospects.')),
  reader(stubTool('prospector_get_prospect', 'Read-only full detail for one prospect.')),
  reader(tool('getInboxStats', 'Get a fast snapshot of the guest inbox: total unread messages plus open and resolved conversation counts.'), ['inbox', 'message', 'conversation']),
  reader(tool('listConversations', 'List recent guest conversations in the inbox.', ['status']), ['conversation', 'inbox', 'message']),
  reader(tool('getConversationThread', 'Read the full message history for a guest conversation.', ['conversationId']), ['conversation', 'message']),
  reader(tool('getRecentReviews', 'Get recent reviews from Google and OTA sources.', ['source']), ['review']),
  reader(tool('getProperty', 'Read one property by id.', ['propertyId'])),
];

const APP: CodeSection = {
  ...CODE,
  catalog: {
    ...CODE.catalog,
    tools: VERDICTS.map((v) => v.tool),
    not_seen: [
      ...CODE.catalog.not_seen,
      "347 file(s) import packages the type checker could not resolve (not installed, as in a fresh clone or a CI checkout, or resolved only by a bundler); their framework calls were recognised through the import declarations, and readings that need the framework's types (a literal typed only by an SDK type, a factory's return type) are not made there. Install the dependencies and re-run for the full reading.",
    ],
  },
  verdicts: VERDICTS,
  insertion: { ...CODE.insertion, dispatcher: CODE.insertion.dispatcher === null ? null : { ...CODE.insertion.dispatcher, tools_delegating: VERDICTS.length - 1 } },
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
      { path: 'reversibility.json', text: '{"reversibility": {"deleteGbpPost": "IRREVERSIBLE", "cancelReservation": "IRREVERSIBLE", "respond": "IRREVERSIBLE"}}' },
      { path: 'risk_functions.json', text: JSON.stringify({ risk_functions: VERDICTS.map((v) => ({ applies_to: v.tool.name, base: 'HIGH', raise_to: [] })) }) },
      { path: 'notice_targets.json', text: JSON.stringify({ notice_targets: Object.fromEntries(VERDICTS.filter((v) => v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE').map((v) => [v.tool.name, ['developer']])) }) },
      { path: 'attesters/registry.json', text: '{"quorum_k": 2, "attesters": {"approver-1": {}, "approver-2": {}}}' },
      { path: 'receipt_identity.json', text: '{"name": "scan-demo-receipt-key"}' },
    ],
    treeHash: 'sha256:00',
    tenantId: 'ten_demo_00',
    unclassified: [],
  },
};

const count = (h: string, needle: string): number => h.split(needle).length - 1;
const html = (): string => renderReportHtml(RESULT, undefined, CTX);
const text = (s: string): string =>
  s.replace(/<style[^]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const summaryOf = (h: string): string => h.slice(h.indexOf('id="executive-summary"'), h.indexOf('id="technical"'));

/** An application with the first customer's numbers: `known`, `unlisted`, `reads` tools, `stubs` of each also present. */
function sized(n: { known: number; unlisted: number; reads: number }, stubs = { known: 0, unlisted: 0, reads: 0 }): CodeSection {
  const make = (k: number, f: (t: CodeTool) => CodeToolVerdict, prefix: string, stub: boolean): CodeToolVerdict[] =>
    Array.from({ length: k }, (_, i) => f(stub ? stubTool(`${prefix}${i}`, 'A tool.') : tool(`${prefix}${i}`, 'A tool.')));
  const verdicts = [
    ...make(n.known, (t) => known(t, 'name says "delete"'), 'k', false),
    ...make(n.unlisted, (t) => unlisted(t), 'u', false),
    ...make(n.reads, (t) => reader(t), 'r', false),
    ...make(stubs.known, (t) => known(t, 'name says "send"'), 'sk', true),
    ...make(stubs.unlisted, (t) => unlisted(t), 'su', true),
    ...make(stubs.reads, (t) => reader(t), 'sr', true),
  ];
  return { ...CODE, catalog: { ...CODE.catalog, not_seen: [] }, verdicts, counts: countsOf(verdicts) };
}

// ---------------------------------------------------------------- 1. the headline

/** The headline's numbers, read back from its words: live tools, then each clause. */
function headlineNumbers(h: string): { live: number; stubs: number; cannot: number; writes: number; reads: number; refused: number } {
  const n = (re: RegExp): number => Number(re.exec(h)?.[1] ?? '0');
  return {
    live: n(/can call (\d+) live tools?/),
    stubs: n(/\((\d+) more (?:is a stub|are stubs)\)/),
    cannot: n(/(\d+) cannot be undone/),
    writes: n(/(\d+) writes? and says? nothing about undoing it/),
    reads: n(/(\d+) only reads?\./),
    refused: n(/(\d+) (?:has|have) no rule/),
  };
}

// Second review (2026-09-28): five numbers in one sentence became one number and three that add up to it.
test('1b. the headline: live tools, then three clauses that add up to them, the same totals as the grade box', () => {
  const withStubs = sized({ known: 9, unlisted: 27, reads: 31 }, { known: 1, unlisted: 12, reads: 3 });
  const cases: [string, CodeSection][] = [['app', APP], ['fixture', CODE], ['stubs', withStubs]];
  for (const [label, code] of cases) {
    const g = exposureGrade(code);
    assert.ok(g !== undefined, label);
    const h = codeExecSummary(code, { ...RESULT, code }).headline;
    const x = headlineNumbers(h);
    assert.equal(x.live, g.tools, `${label}: ${h}`);
    assert.equal(x.cannot + x.writes + x.reads + x.refused, x.live, `${label}: the clauses do not add up: ${h}`);
    assert.equal(x.stubs, g.stubs, `${label}: ${h}`);
    assert.equal(x.stubs === 0, !h.includes('more are stub') && !h.includes('more is a stub'), `${label}: the parenthesis`);
    // The grade box: best case counts the "cannot be undone" clause (and any refused), worst also the writes.
    const best = x.cannot + x.refused;
    const box = gradeSentence(g);
    if (g.unlisted > 0) {
      assert.ok(box.includes(`Worst case ${g.worst}: ${best + x.writes} of the ${x.live}`), `${label}: ${box}`);
      assert.ok(box.includes(`Best case ${g.best}: ${best} of the ${x.live} tools`) || best === 0, `${label}: ${box}`);
    }
  }
  // The first case carries stubs and a detailed split; the fixture none, so its headline has no parenthesis.
  assert.ok(headlineNumbers(codeExecSummary(APP, RESULT).headline).stubs > 0);
});

test('1. the headline says what the tools say, never "on its own"', () => {
  const noStubs = sized({ known: 10, unlisted: 39, reads: 34 });
  assert.equal(
    codeExecSummary(noStubs, { ...RESULT, code: noStubs }).headline,
    'A model in example-platform can call 83 live tools. 10 cannot be undone, by their own name or description. 39 write and say nothing about undoing it. 34 only read.',
  );
  const withStubs = sized({ known: 9, unlisted: 27, reads: 31 }, { known: 1, unlisted: 12, reads: 3 });
  assert.equal(
    codeExecSummary(withStubs, { ...RESULT, code: withStubs }).headline,
    'A model in example-platform can call 67 live tools (16 more are stubs). 9 cannot be undone, by their own name or description. 27 write and say nothing about undoing it. 31 only read.',
  );
  const page = html();
  const screen = renderTerminal({ ...RESULT }, { full: true });
  for (const old of ['on its own', 'with no ZIFFER in front of them', 'without ZIFFER, a model can run', 'can take 49 actions']) {
    assert.ok(!text(page).includes(old), `the page still says "${old}"`);
    assert.ok(!screen.includes(old), `the terminal still says "${old}"`);
  }
  // The bullets said the notice-only tools run "today" with nobody asking: the scan does not see today.
  const s = codeExecSummary(APP, RESULT);
  for (const sentence of execSentences(s)) assert.ok(!/today, and under the draft/.test(sentence), sentence);
  // The subline says what the scan read about asking a person, never that it does not see it (second review).
  assert.equal(s.subline, confirmationSentence(APP));
  assert.ok(!s.subline.includes('does not see whether your application asks'), s.subline);
});

// ---------------------------------------------------------------- 2. the grade

test('2. the grade is ONE letter, today\'s, says what reaches the one within reach, and is provisional only with its reason (ACP-464)', () => {
  // Re-pointed by ACP-464 item 8 (was "the grade is a range"): the owner read "C to F" and could not tell the grade.
  // Today is the worst case: a tool with no reversibility entry counts as not undoable until it is classified.
  const cardOf = (h: string): string => h.slice(h.indexOf('<div class="grade" role="img"'), h.indexOf('<figure class="door"'));
  const pageOf = (code: CodeSection): string => renderReportHtml({ ...RESULT, code }, undefined, CTX);
  // Best and worst differ, nothing provisional.
  const first = sized({ known: 10, unlisted: 39, reads: 34 });
  const g = exposureGrade(first);
  assert.ok(g !== undefined);
  assert.equal(g.best, 'C');
  assert.equal(g.worst, 'F');
  assert.deepEqual(gradeNow(g), { today: 'F', reachable: 'C', unclassified: 39, provisionalFiles: 0 });
  assert.equal(gradeLabel(g), 'F');
  assert.equal(gradeTitle(g), 'Exposure grade F', 'no unresolved imports: not provisional');
  assert.equal(gradeNowSentence(g), 'F today. 39 tools change data and do not say whether that can be undone, so they count as not undoable. If all 39 can be undone, the grade is C.');
  assert.equal(provisionalReason(g), undefined);
  // The JSON's field is the same function's reading, with both cases kept.
  assert.deepEqual(gradeRecord(first), { today: 'F', reachable: 'C', best: 'C', worst: 'F', unclassified: 39, provisional_files: 0 });
  const card = cardOf(pageOf(first));
  assert.ok(card.includes('data-grade-today="F" data-grade-reachable="C"'), card);
  assert.equal(count(card, '<em class="g-'), 1, 'two letters shown large');
  assert.ok(!card.includes('<span>to</span>') && !text(card).includes(' to F'), 'the card prints the range');
  assert.equal(count(card, ' on"'), 1, 'more than one letter lit');
  assert.ok(card.includes('<li class="g-f on">F</li>') && card.includes('<li class="g-c reach">C</li>'), card);
  assert.ok(text(card).includes('reachable') && text(card).includes('today'));
  assert.ok(!card.includes('provisional'), 'a pill with nothing provisional');
  assert.ok(!card.includes('reversibility.json'), 'the card names a file');
  // Best and worst the same: the letter alone.
  const one = sized({ known: 1, unlisted: 0, reads: 9 });
  const o = exposureGrade(one);
  assert.ok(o !== undefined && gradeLabel(o) === 'C' && gradeNow(o).reachable === undefined && gradeNowSentence(o) === undefined);
  const oneCard = cardOf(pageOf(one));
  assert.ok(oneCard.includes('data-grade-today="C"') && !oneCard.includes('data-grade-reachable'), oneCard);
  assert.ok(!oneCard.includes('class="now"') && !oneCard.includes('reach') && !oneCard.includes('provisional') && !oneCard.includes('<p'), `the card says more than its letter: ${oneCard}`);
  assert.ok(GRADE_DEFINITION.includes('A none, B under 10%, C under 25%, D under 50%, F half or more.'));
  // The app with unresolved imports: provisional, and why, in words under the pill.
  const a = exposureGrade(APP);
  assert.ok(a !== undefined);
  assert.equal(gradeTitle(a), `Exposure grade ${a.worst} (provisional)`);
  assert.equal(provisionalReason(a), 'provisional: 347 files import packages the scan could not resolve');
  const page = html();
  assert.ok(page.includes(`aria-label="Exposure grade ${a.worst} (provisional)"`));
  assert.ok(page.includes('<span class="prov">provisional</span></div><p class="why">provisional: 347 files import packages the scan could not resolve</p>'), cardOf(page));
  // Every surface: the terminal and the JSON say today's grade by the same function.
  assert.ok(renderTerminal(RESULT).includes(`Exposure grade ${a.worst} (provisional):`));
  if (a.best !== a.worst) assert.ok(text(renderTerminal(RESULT)).includes(`${a.worst} today.`));
});

// ---------------------------------------------------------------- 3. keyword readings

test('3. a keyword reading is said as one wherever the summary says a tool cannot be undone', () => {
  const s = codeExecSummary(APP, RESULT);
  const summary = text(summaryOf(html()));
  assert.ok(!/\bCannot be undone\b/.test(summary), 'a summary bullet states "Cannot be undone" from a keyword');
  const heldKnown = s.bullets.filter((b) => b.kind === 'held' && b.tools.includes('deleteGbpPost'));
  assert.equal(heldKnown.length, 1);
  assert.equal(heldKnown[0]?.text, 'Marked as impossible to undo by their name or description; confirm.');
  // The policy's gap line says the two bases apart (it counts every tool the engine treats so, stubs included).
  const unlistedAll = APP.verdicts.filter((v) => v.what_ziffer_does === NO_REVERSIBILITY_ENTRY || v.what_ziffer_does === NOTICE_ONLY_UNLISTED).length;
  const gap = `${APP.counts.irreversible - unlistedAll} because their name or description says so (confirm each reading), ${unlistedAll} because nothing says they can be undone`;
  assert.ok(text(html()).includes(gap), `the gap line: ${gap}`);
});

// ---------------------------------------------------------------- 4. regulation

test('4. the regulation block opens with the sector sentence, shows built or partial rows only, and never 14(5) or DORA 11(1)', () => {
  const s = codeExecSummary(APP, RESULT);
  assert.ok(s.matters.length > 0);
  for (const m of s.matters) assert.ok(m.status === 'built' || m.status === 'partial', `${m.framework} ${m.clause}: ${m.status}`);
  // Since the second design (2026-09-28) the regulation rows are the technical part's "Why it matters", opened by the sentence.
  const page = html();
  const summary = page.slice(page.indexOf('<section class="sec" id="matters">'), page.indexOf('</section>', page.indexOf('<section class="sec" id="matters">')));
  // Re-pointed by the third design (2026-09-28): the sector sentence opens the section as the grey half of its heading.
  assert.ok(summary.includes(`<h2>Why it matters. <span>${MATTERS_INTRO}</span></h2>`));
  // The EU AI Act binds by what the system is used for, not by sector (second review, 2026-09-28).
  assert.equal(MATTERS_INTRO, 'Which of these bind you depends on your sector and, for the EU AI Act, on what your system is used for.');
  for (const gone of ['Art. 14(5)', 'Art. 11(1)', 'not checked']) assert.ok(!summary.includes(gone) && !page.includes(gone), `the page still shows ${gone}`);
  // The data file names neither row; a mapping that did would still print neither.
  for (const x of EXCLUDED_CITATIONS) {
    for (const list of Object.values(FINDING_CONTROLS.kinds)) {
      assert.ok(!list.some((c) => c.framework === x.framework && c.clause === x.clause), `${x.framework} ${x.clause} is in finding-controls.json`);
    }
    assert.ok(x.reason.length > 20, 'each exclusion carries its reason');
  }
  const injected = parseFindingControls({
    kinds: { ...FINDING_CONTROLS.kinds, irreversible: [...FINDING_CONTROLS.kinds.irreversible, ...EXCLUDED_CITATIONS.map((x) => ({ framework: x.framework, clause: x.clause }))] },
    mitre_position_status: FINDING_CONTROLS.mitre_position_status,
  });
  const [f] = attachControls(FIXTURE.findings.filter((x) => x.kind === 'irreversible'), injected);
  assert.ok(f !== undefined && f.controls.length > 0);
  for (const c of f.controls) assert.ok(!EXCLUDED_CITATIONS.some((x) => x.clause === c.clause), `${c.clause} was attached`);
  // The terminal prints each finding's rows: neither excluded row, on the installed-tools run either.
  const screen = renderTerminal({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, { full: true });
  assert.ok(!screen.includes('Art. 14(5)') && !screen.includes('Art. 11(1)'));
});

// ---------------------------------------------------------------- 5. OWASP

test('5. no "Tool autonomy" row anywhere; one Excessive Agency row, cited by the 2026 edition\'s id', () => {
  const o = OWASP_EXCESSIVE_AGENCY;
  assert.deepEqual(HEAT_TECHNIQUES.filter((t) => t.framework === 'OWASP LLM Top 10').map((t) => t.id), [o.dossierId]);
  // The dossier's "Tool autonomy" row is no entry of any edition of the list: never a cell.
  assert.equal(codeExecSummary(APP, RESULT).heat.find((h) => h.name === 'Tool autonomy'), undefined);
  // The --code page's table (second design, 2026-09-28) and the page without --code, each in its own markup.
  for (const [page, row, named] of [
    // Re-pointed by the third design: the technique's name in bold, its framework and id as the small line.
    [html(), new RegExp(`<small>OWASP LLM Top 10 ${o.id}</small>`, 'g'), `<b>${o.title}</b><small>OWASP LLM Top 10 ${o.id}`],
    [renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, undefined, CTX), new RegExp(`<code>${o.id}</code>`, 'g'), `${o.id}</code><br>${o.title}`],
  ] as const) {
    assert.ok(!page.includes('Tool autonomy'), 'a "Tool autonomy" row');
    assert.equal((page.match(row) ?? []).length, 1, `one ${o.id} row`);
    assert.ok(page.includes(named));
  }
});

// ---------------------------------------------------------------- 6. the ZIFFER column

test('6. the threat table speaks of ZIFFER in plain words, one sentence per technique, the same as the cards', () => {
  const page = html();
  const atlas = page.slice(page.indexOf('<section class="sec" id="atlas">'), page.indexOf('</section>', page.indexOf('<section class="sec" id="atlas">')));
  for (const jargon of ['B-2', 'B-3', 'B-4', 'B-6', 'RK-5', '§6', '§2.2', 'unnovel', 'Out of scope by design', 'Partially constrained', 'The core of the design']) {
    assert.ok(!text(page).includes(jargon), `the page says "${jargon}"`);
  }
  const cells = [...atlas.matchAll(/<td data-l="With ZIFFER">([^<]*)<\/td>/g)].map((m) => m[1] ?? '');
  assert.ok(cells.length >= 4);
  for (const c of cells) assert.ok(c.startsWith('With ZIFFER: '), c);
  // The tool-poisoning card and its row say the same sentence.
  const poison = `With ZIFFER: ${TECHNIQUE_GLOSS['AML.T0110'] ?? ''}.`;
  assert.ok(cells.includes(poison));
  // The cards are the page without --code's (the --code page has the table only, since the second design).
  const installed = renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, undefined, CTX);
  assert.ok(summaryOf(installed).includes(`<span class="hc-s">${poison}</span>`));
});

// ---------------------------------------------------------------- 7. the work

test('7. the work is stated from the scan: the dispatcher call, the module, the policy, the approvers, and each tool outside it', () => {
  assert.equal(
    workSentence(APP),
    'The work: one call at the top of executeTool, the gate module this report provides, the draft policy files to review and sign, and the approvers to name. ' +
      '13 of the 14 tools go through executeTool; respond does not, and needs its own call.',
  );
  assert.equal(WHAT_CHANGES[0], 'Once ZIFFER is in place, every tool call that goes through it is checked before it runs.');
  const page = text(html());
  for (const old of ['Every action a model takes goes through ZIFFER', 'adds one line of code', 'Put ZIFFER here: one call']) assert.ok(!page.includes(old), old);
  assert.ok(page.includes('Add the same call at the top of the tool that does not go through executeTool'), 'the step for respond');
  assert.ok(page.includes('Name your approvers and the person told first'));
});

// ---------------------------------------------------------------- 8. replies held

test('8. a held reply tool is named above the held tables', () => {
  const page = html();
  const warning = 'As drafted, respond is held for approval, so replies would wait for a person. Decide what this carries before you sign.';
  const policy = page.slice(page.indexOf('<section class="sec" id="policy">'));
  assert.ok(policy.includes(`<p class="reply-warn box-note no">${warning}</p>`), 'the policy\'s held group');
  assert.ok(policy.indexOf('reply-warn') < policy.indexOf('<table class="r chk ruletable">'), 'above the table');
  assert.ok(page.slice(page.indexOf('id="tools"')).includes(warning), 'the tools table');
  // No reply tool held: no warning.
  const none = { ...APP, verdicts: APP.verdicts.filter((v) => v.tool.name !== 'respond') };
  assert.ok(!renderReportHtml({ ...RESULT, code: { ...none, counts: countsOf(none.verdicts) } }, undefined, CTX).includes('reply-warn">'));
});

// ---------------------------------------------------------------- 9. the stand-in addressee

test('9. the stand-in addressee reads "not named yet", in the column and in the Placeholders box', () => {
  const page = html();
  assert.equal(TOLD_PLACEHOLDER, 'not named yet');
  assert.ok(!page.includes('you, who ran this scan') && !page.includes('placeholder: name a real person'));
  // The column is "Who is notified" for a tool told after it runs, "Who approves" for a held one (third design,
  // 2026-09-28: "Who is told" read as who approves); the draft's stand-ins read "not named yet" in both.
  assert.ok(page.includes(`<td data-l="Who is notified"><span class="warn">not named yet</span></td>`));
  assert.ok(/<td data-l="Who approves">2 of 2 approvers, <span class="warn">not named yet<\/span><\/td>/.test(page));
  assert.ok(
    text(page).includes('Notice addressee: not named yet. The draft uses the stand-in developer . Name the person or channel who is told before these tools run.'),
    'the Placeholders box',
  );
});

// ---------------------------------------------------------------- 10. stubs

test('10. a tool whose description says stub is labelled, and left out of the headline and the grade', () => {
  const page = html();
  for (const name of ['prospector_send_email', 'prospector_bulk_enrich', 'prospector_get_prospect']) {
    assert.ok(page.includes(`<code class="tn">${name}</code><br><span class="stub">${STUB_LABEL}</span>`), `${name} in the tools table`);
  }
  assert.equal(STUB_LABEL, 'declared, not wired (its description says stub)');
  const g = exposureGrade(APP);
  assert.ok(g !== undefined);
  assert.equal(g.stubs, 3);
  assert.equal(g.tools, APP.counts.tools - 3);
  assert.equal(g.known, 3, 'the stub marked irreversible is not counted');
  assert.ok(gradeSentence(g).includes('3 tools whose description says they are stubs are left out of these numbers.'));
  const s = codeExecSummary(APP, RESULT);
  assert.ok(s.headline.includes(`can call ${g.tools} live tools (3 more are stubs).`), s.headline);
  for (const b of s.bullets) for (const name of b.tools) assert.ok(!name.startsWith('prospector_'), `${name} is a stub named in a bullet`);
  // "stub" as part of another word is not a stub.
  const stubborn = sized({ known: 1, unlisted: 0, reads: 1 });
  const v0 = stubborn.verdicts[0];
  assert.ok(v0 !== undefined);
  const renamed = { ...stubborn, verdicts: [{ ...v0, tool: { ...v0.tool, description: 'Handles stubborn stubs-free cases.' } }, ...stubborn.verdicts.slice(1)] };
  assert.equal(exposureGrade(renamed)?.stubs, 0);
  // One source: the scanner's `declared_stub`. A description saying "Stub" with the field absent is not read again here.
  const unread = { ...stubborn, verdicts: [{ ...v0, tool: { ...v0.tool, description: STUB('A tool.') } }, ...stubborn.verdicts.slice(1)] };
  assert.equal(exposureGrade(unread)?.stubs, 0, 'the report read the description instead of the field');
  const marked = { ...stubborn, verdicts: [{ ...v0, tool: { ...v0.tool, declared_stub: true } }, ...stubborn.verdicts.slice(1)] };
  assert.equal(exposureGrade(marked)?.stubs, 1, 'the field alone makes a stub');
});

// ---------------------------------------------------------------- 11. the steering box

test('11. the steering box leads with tools that return outsiders’ text, never a counts tool, and does not claim the chain', () => {
  const s = codeExecSummary(APP, RESULT);
  assert.ok(s.steering !== undefined);
  assert.deepEqual(s.steering.readers.slice(0, 2), ['getConversationThread', 'getRecentReviews']);
  assert.ok(!s.steering.readers.includes('getInboxStats'), 'a tool that returns counts');
  // Counts listed beside message previews are not "only counts": that tool still returns outsiders' text.
  const previews = { ...APP, verdicts: APP.verdicts.map((v) => (v.tool.name === 'listConversations' ? { ...v, tool: { ...v.tool, description: 'Returns conversation IDs, last-message previews, status, unread counts.' } } : v)) };
  assert.ok(codeExecSummary(previews, { ...RESULT, code: previews }).steering?.readers.includes('listConversations'));
  const onlyCounts = { ...APP, verdicts: APP.verdicts.map((v) => (v.tool.name === 'listConversations' ? { ...v, tool: { ...v.tool, description: 'Returns only counts of open conversations.' } } : v)) };
  assert.ok(!codeExecSummary(onlyCounts, { ...RESULT, code: onlyCounts }).steering?.readers.includes('listConversations'));
  assert.ok(!s.steering.text.includes('getInboxStats'));
  assert.ok(
    s.steering.text.includes(
      `depends on which tools your application gives it at run time, which the scan found is decided by data in getToolsForLocation (${APP.catalog.gates[0]?.at.file ?? ''}:${APP.catalog.gates[0]?.at.line ?? 0}). If both are given to the same model, that text could push it toward them.`,
    ),
    s.steering.text,
  );
  assert.ok(!/can try to steer the model to /.test(s.steering.text), 'the chain is claimed');
  // Without a gate entry, the sentence says only what is possible.
  const ungated = { ...APP, catalog: { ...APP.catalog, gates: [] } };
  const u = codeExecSummary(ungated, { ...RESULT, code: ungated }).steering;
  assert.ok(u !== undefined && u.text.includes('If the same model can also call') && !u.text.includes('decided by data'), u?.text);
});
