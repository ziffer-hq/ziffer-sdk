/**
 * What the agent reads about the 2026-09-28 readings (ACP-455): the places a tool runs another
 * tool without passing the dispatcher, and the calls to it with no confirmation check found, in
 * the report's own words, in `remediation`, in the text block, in the structured view, and from
 * `explain_scan_finding` for one tool or one caller. Absent when the scan found none. Every name
 * here is invented; the policy folder does not exist, so the members read as unreadable, which
 * this test does not look at.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { bypassPaths, bypassSentence, CHECK_NOT_FOUND_MEANS, codeHeadlineOf, CONFIRM_VS_APPROVAL, reachSentence, uncheckedSummary } from '@ziffer-io/scan';

import type { CodebaseScan, CodeSection } from './scan-code.js';
import { explainScanFinding } from './scan-explain.js';
import { codebaseText, codebaseView, remediation } from './scan-remedy.js';

const at = (file: string, line: number): { file: string; line: number; col: number } => ({ file, line, col: 1 });

type Tool = CodeSection['catalog']['tools'][number];
function tool(name: string, extra: Partial<Tool> = {}): Tool {
  return { name, description: `${name}.`, schema_kind: 'json_schema', params: [], sdk: 'ai', via: 'tool() from "ai"', defined_at: at(`src/${name}.ts`, 3), delegates_to: 'runTool', ...extra };
}

const TOOLS: Tool[] = [
  tool('closeVenue', { calls: [{ tool: 'publishNotice', at: at('src/close-venue.ts', 40), via: 'direct', through: [] }] }),
  tool('publishNotice'),
];

const DISPATCHER: CodeSection['catalog']['dispatchers'][number] = {
  name: 'runTool',
  at: at('src/run-tool.ts', 5),
  signature: '(name, input, ctx)',
  callers: [at('src/logger.ts', 6), at('src/bridge.ts', 18)],
  tools_delegating: 2,
  caller_checks: [
    { caller: at('src/logger.ts', 6), in_function: 'loggedOnToolCall' },
    { caller: at('src/bridge.ts', 18), in_function: 'execute', check: { at: at('src/bridge.ts', 12), reads: 'requires_confirmation' } },
  ],
};

const held = { verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: 'r' } as const;

function scanOf(tools: Tool[], dispatcher: CodeSection['catalog']['dispatchers'][number]): CodebaseScan {
  return {
    root: '/work/invented',
    policy: '/work/out/ziffer-policy',
    tools_file: '/work/out/ziffer-tools.json',
    section: {
      catalog: { root: '/work/invented', sdks: [], files_read: 3, tools, exposures: [], dispatchers: [dispatcher], gates: [], syntax_only: { found: 2, missed: 0 }, not_seen: [], checks: [{ language: 'typescript', tool_calls: true, caller_checks: true }] },
      verdicts: tools.map((t) => ({ tool: t, verdict: held, what_ziffer_does: 'held', untrusted_input: false, egress: false, ...(t.calls === undefined ? {} : { raised_by: 'publishNotice' }) })),
      insertion: { dispatcher, per_tool: false, sentence: 'One call at the top of runTool.', snippet: "import { zifferGate } from './ziffer-gate.js';", snippet_language: 'typescript', call: 'await zifferGate(name, input, zifferOperator(ctx));' },
      counts: { tools: tools.length, held: tools.length, refused: 0, notified: 0, allowed: 0, irreversible: tools.length },
    },
  };
}

const SCAN = scanOf(TOOLS, DISPATCHER);

test('remediation, the text block and the view carry the bypass path and the entry with no check, in the report\'s words', () => {
  const r = remediation(SCAN);
  const path = bypassPaths(SCAN.section)[0];
  assert.ok(path !== undefined);
  const bypass = `${bypassSentence(SCAN.section, path)} Route that call through runTool, or put the ZIFFER call at src/close-venue.ts:40 too.`;
  assert.equal(bypass, 'closeVenue also runs publishNotice at src/close-venue.ts:40, without passing runTool. A ZIFFER call at runTool would decide closeVenue and not see publishNotice. Route that call through runTool, or put the ZIFFER call at src/close-venue.ts:40 too.');
  assert.ok(r.unseen?.includes(bypass));
  assert.ok(r.steps.includes(bypass), 'a step for the inner call site');
  const none = uncheckedSummary(SCAN.section);
  // Second review: what the caller can reach, the report's own sentence (reachSentence), never "the tools reachable".
  assert.equal(
    none,
    'From loggedOnToolCall (src/logger.ts:6), no confirmation check was found before the call to runTool. ' +
      'The source does not bound which tools this path can call, so it can reach any of the 2 tools the dispatcher knows.',
  );
  assert.ok(r.unseen?.includes(`${none} ${CHECK_NOT_FOUND_MEANS}`));
  assert.ok(r.unseen?.includes(CONFIRM_VS_APPROVAL));
  const text = codebaseText(SCAN, r).join('\n');
  assert.ok(text.includes('WHAT ONE CALL DOES NOT SEE (pass these on as written):') && text.includes(bypass) && text.includes(none ?? '-'), text);
  const view = codebaseView(SCAN);
  assert.ok(Array.isArray(view['bypass_paths']) && view['bypass_paths'].length === 1);
  assert.ok(Array.isArray(view['entries']) && view['entries'].length === 2);
  assert.ok(text.includes('run after a notice under the draft policy') && !text.includes('nobody answers'));
});

test('absent: no calls and every caller checked, no unseen lines, no bypass step, no entries without a check', () => {
  const quiet = scanOf([tool('closeVenue'), tool('publishNotice')], { ...DISPATCHER, caller_checks: DISPATCHER.caller_checks?.filter((c) => c.check !== undefined) ?? [] });
  const r = remediation(quiet);
  assert.equal(r.unseen, undefined);
  assert.ok(!r.steps.some((s) => s.includes('without passing')));
  assert.ok(!codebaseText(quiet, r).join('\n').includes('WHAT ONE CALL DOES NOT SEE'));
  assert.equal(codebaseView(quiet)['bypass_paths'], undefined);
});

test('explain_scan_finding explains a tool\'s bypass path, and a caller with no check by its function or its file:line', () => {
  const t = explainScanFinding(SCAN, 'closeVenue');
  assert.equal(t.isError, false);
  assert.ok(t.text.includes('WHAT THE CALL AT THE DISPATCHER DOES NOT SEE HERE:') && t.text.includes('closeVenue also runs publishNotice at src/close-venue.ts:40'), t.text);
  assert.ok(Array.isArray(t.structured['bypass_paths']));
  assert.ok(!explainScanFinding(SCAN, 'publishNotice').text.includes('DOES NOT SEE HERE'), 'the inner tool is not the one with the path');
  for (const name of ['loggedOnToolCall', 'src/logger.ts:6']) {
    const e = explainScanFinding(SCAN, name);
    assert.equal(e.isError, false, e.text);
    assert.ok(e.text.startsWith('The call to runTool at src/logger.ts:6, in loggedOnToolCall: no confirmation check was found before the call.'), e.text);
    assert.ok(e.text.includes('The source does not bound which tools this path can call, so it can reach any of the 2 tools the dispatcher knows.'), e.text);
    assert.ok(e.text.includes(CHECK_NOT_FOUND_MEANS) && e.text.includes(CONFIRM_VS_APPROVAL));
  }
  const checked = explainScanFinding(SCAN, 'execute');
  assert.ok(checked.text.includes('a check of `requires_confirmation` at src/bridge.ts:12 comes before the call'), checked.text);
  // A name that is neither: refused, naming the callers it can explain.
  const miss = explainScanFinding(SCAN, 'nothing_here');
  assert.equal(miss.isError, true);
  assert.ok(miss.text.includes('loggedOnToolCall (src/logger.ts:6)'));
});

// Second review (2026-09-28): the agent reads the report's own headline, built by the same function,
// and the count of tools the engine treats as impossible to undo is the headline's live tools only.
test('remediation opens with the report\'s headline, and each entry with no check says what it reaches', () => {
  const r = remediation(SCAN);
  const headline = codeHeadlineOf(SCAN.section);
  assert.equal(headline, 'A model in invented can call 2 live tools. 2 cannot be undone, by their own name or description, or by what they run.');
  assert.ok(r.finding.startsWith(`${headline} `), r.finding);
  assert.ok(!/of them cannot be undone/.test(r.finding), r.finding);
  // A stub is left out of the list, as the headline leaves it out.
  const stub = scanOf([...TOOLS, tool('openTill', { description: 'Stub: open the till.', declared_stub: true })], DISPATCHER);
  const f = remediation(stub).finding;
  assert.ok(f.startsWith(`${codeHeadlineOf(stub.section)} `) && codeHeadlineOf(stub.section).includes('(1 more is a stub)'), f);
  assert.ok(!f.includes('openTill at'), f);
  const view = codebaseView(SCAN);
  const entries = view['entries'];
  assert.ok(Array.isArray(entries));
  const [logged] = entries;
  const c = DISPATCHER.caller_checks?.[0];
  assert.ok(c !== undefined);
  assert.deepEqual(logged, { at: 'src/logger.ts:6', in_function: 'loggedOnToolCall', before_the_call: 'no confirmation check was found before the call', check_found: false, reaches: reachSentence(SCAN.section, c) });
});

test('the words "first screen" (the report designers\' own name for the top of the page) never reach the MCP text or its data', () => {
  const r = remediation(SCAN);
  const said = [codebaseText(SCAN, r).join('\n'), JSON.stringify(codebaseView(SCAN)), explainScanFinding(SCAN, 'closeVenue').text];
  for (const s of said) assert.ok(!/first[\s-]screen/i.test(s), s.slice(0, 200));
});
