import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ScanResult } from '../types.js';
import type { CodeSection, CodeTool, CodeToolVerdict } from '../code/types.js';
import { NO_REVERSIBILITY_ENTRY, NOTICE_ONLY_UNLISTED } from '../code/grade.js';
import { ANNEX } from './annex.js';
import { attachControls, FINDING_CONTROLS, isExcludedCitation, type FindingControls } from './controls.js';
import { FIXTURE } from './fixture.test.data.js';
import { CODE } from './code.fixture.test.data.js';
import { frameworkRows, loadCodeSdks, NOT_READ_YET, type CodeSdkEntry } from './code.js';
import { renderJson } from './json.js';
import { hasOwnCase, hasReview, isOwnAbsent } from './own.js';
import {
  APP_TOOLS_NOT_YET,
  CANNOT_SEE_WITH_CODE,
  CODE_CTA_TITLE,
  CODE_IN_REPORT,
  CODE_MODULE_IN_REPORT,
  CONTROLS_CONTINUATION,
  CONTROLS_LABEL,
  execLines,
  execOf,
  FULL_DETAIL,
  IRREVERSIBLE_CONSEQUENCE,
  MCP_NEXT,
  NEXT_OPEN,
  NEXT_RUN,
  PAIR_CONSEQUENCE,
  POLICY_PATH_TOKEN,
  renderPreamble,
  renderTerminal,
  REVIEW_URL,
  stripAnsi,
  type ReplaySummary,
  type TerminalOptions,
} from './terminal.js';
import { UNSIGNED_DEMO_LINE } from '../replay/replay.js';

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(here, '..', '..', 'src', 'report', 'terminal.snapshot.txt');

/** The fixture's pair as the classifier builds it now (ACP-454): its readers and actors beside the flat list. */
const WITH_SIDES = FIXTURE.findings.map((f) => (f.kind === 'pair' ? { ...f, readers: ['read_email'], actors: ['send_email'] } : f));
const RESULT: ScanResult = { ...FIXTURE, findings: attachControls(WITH_SIDES) };

/** The replay as the one screen reads it: the outcome of each case, the quorum, and the own case. */
const REFUSED_BEFORE = { kind: 'refused', stage: 'grammar' } as const;
const ROWS: ReplaySummary['rows'] = [
    { outcome: REFUSED_BEFORE },
    { outcome: REFUSED_BEFORE },
    { outcome: REFUSED_BEFORE },
    { outcome: REFUSED_BEFORE },
    { outcome: { kind: 'refused', stage: 'engine' } },
    { outcome: { kind: 'held' } },
    { outcome: { kind: 'held' } },
    { outcome: { kind: 'allowed' } },
];
const OWN_HELD = {
  kind: 'held',
  risk: 'HIGH',
  reversibility: 'IRREVERSIBLE',
  rule_id: 'rule-1',
  rule_ids: ['rule-1'],
  awaits: { k: 2, required_roles: ['approver'], risk: 'HIGH', proposal_hash: 'sha256:p', policy_bundle_hash: 'sha256:b' },
};
const OWN_REFUSED = { kind: 'refused', stage: 'engine', clause: 'DR-13', message: 'refused' };
const OWN_ALLOWED = {
  kind: 'allowed',
  risk: 'LOW',
  reversibility: 'REVERSIBLE',
  notice_recipients: null,
  rule_id: 'rule-1',
  envelope: {},
  receipt_text: 'receipt',
  verification: { verdict: 'PASSED' },
};
/** The full present shape: the replay module's guard is the one guard (ACP-451), and it checks every field. */
const OWN = {
  server: 'mail',
  tool: 'delete_email',
  original_name: 'delete_email',
  without: 'executes',
  outcome: OWN_HELD,
  label: 'a proposal this scan wrote, not one an AI agent made',
};
/** A replay carrying `own`, the field the replay module adds (ACP-451); a variable, so the extra field is allowed. */
function withOwn(own: unknown, rows: ReplaySummary['rows'] = ROWS): ReplaySummary {
  const r = { rows, quorum_k: 2, own };
  return r;
}
const REPLAY = withOwn(OWN);
/** What the CLI passes: the result, with the paths --report wrote beside it. */
/** `reach` as `cli.ts` computes it over the fixture (ACP-454): no program is configured in two clients here. */
const REACH = { servers: 4, tools: 8, clients: 3, not_started: { remote: 0, timed_out: 1, other: 1 } };
const REVIEWED = {
  ...RESULT,
  reach: REACH,
  review: { archive: '/home/you/ziffer-scan/ziffer-review.tar.gz', report: '/home/you/ziffer-scan/ziffer-scan-report.html' },
};
const SHOWN: TerminalOptions = {
  replay: REPLAY,
  policy: { path: '/home/you/ziffer-scan/ziffer-policy', files: 13 },
  cwd: '/home/you',
  open: true,
  wrote: { dir: './ziffer-scan/', items: 5, gitWorkTree: true },
};
/** Any ANSI escape. */
const ESC = '\u001b[';

/**
 * The complete report `--full` prints after the one screen -- asserted to BE
 * the one screen, a blank line, and then the rest, so every test below that
 * reads a section of the complete report reads what `--full` prints.
 */
function full(result: ScanResult, opts: TerminalOptions = {}): string {
  const screen = renderTerminal(result, opts);
  const all = renderTerminal(result, { ...opts, full: true });
  assert.ok(all.startsWith(`${screen}\n`), 'the --full output does not begin with the one screen');
  return all.slice(screen.length + 1);
}

/** The only lines a clause id may appear on. */
function isControlsLine(line: string): boolean {
  return line.trimStart().startsWith(CONTROLS_LABEL) || line.startsWith(CONTROLS_CONTINUATION);
}

test('the terminal rendering equals the committed snapshot', () => {
  // UPDATE BY INTENT, NEVER BY COPYING THE DIFF. When this goes red, read the
  // difference and decide whether a person should now read the new text. If
  // yes, regenerate with ZIFFER_SCAN_WRITE_SNAPSHOT=1 and say in the commit
  // which change to the output was intended. Pasting whatever the renderer
  // printed into the .txt makes this test agree with the code, which is the
  // one thing a snapshot must never do by construction.
  // ACP-452: the one screen first, then (--full) the complete report, so the
  // snapshot shows both what a person reads first and that the rest is unchanged.
  const rendered = renderTerminal(REVIEWED, { ...SHOWN, full: true });
  if (process.env.ZIFFER_SCAN_WRITE_SNAPSHOT === '1') writeFileSync(SNAPSHOT, rendered);
  assert.ok(existsSync(SNAPSHOT), `${SNAPSHOT} is missing; a snapshot test with nothing to compare is not a test`);
  assert.equal(rendered, readFileSync(SNAPSHOT, 'utf8'));
});

test('colour never changes the text: the coloured rendering, escapes stripped, IS the snapshot (ACP-454)', () => {
  const coloured = renderTerminal(REVIEWED, { ...SHOWN, full: true, color: true });
  assert.ok(coloured.includes(ESC), 'the coloured rendering has no escape at all');
  assert.equal(stripAnsi(coloured), readFileSync(SNAPSHOT, 'utf8'));
  // The palette: the wordmark and the headings orange, HIGH red, HELD amber, the engine line dim.
  assert.ok(coloured.startsWith('\u001b[1;38;5;202mZIFFER\u001b[0m scan 0.1.0'), coloured.slice(0, 60));
  assert.ok(coloured.includes('\u001b[1;38;5;202mNEXT\u001b[0m'));
  assert.ok(coloured.includes('\u001b[31mHIGH\u001b[0m'));
  assert.ok(coloured.includes('\u001b[33mHELD\u001b[0m'));
  assert.ok(coloured.includes('\u001b[2mengine 01234567'));
  // The same holds at 120 columns and without a replay.
  for (const opts of [{ ...SHOWN, width: 120 }, {}]) {
    assert.equal(stripAnsi(renderTerminal(REVIEWED, { ...opts, full: true, color: true })), renderTerminal(REVIEWED, { ...opts, full: true }));
  }
});

test('the preamble: the wordmark, what the scan does, and that nothing starts before a yes (ACP-454)', () => {
  assert.deepEqual(renderPreamble({ width: 120 }), [
    'ZIFFER scan',
    'Reads the MCP configuration of your AI coding tools, starts each server once to list its tools, sends nothing anywhere.',
    'Nothing starts before you say yes.',
    '',
  ]);
  assert.match(renderPreamble({ yes: true }).join('\n'), /--yes was given/);
  assert.ok(renderPreamble().every((l) => l.length <= 80));
  assert.equal(stripAnsi(renderPreamble({ color: true }).join('\n')), renderPreamble().join('\n'));
});

test('no clause id appears in a sentence a person reads, only on the Controls lines', () => {
  const clauseId = /[A-Z]{2,4}-\d+/;
  // The one screen with an own case the engine REFUSED at a clause: the clause stays in --json.
  const refused = withOwn({ ...OWN, outcome: OWN_REFUSED });
  const screen = renderTerminal(REVIEWED, { ...SHOWN, replay: refused });
  assert.match(screen, /REFUSED: irreversible, and nobody is named to be told/);
  const lines = renderTerminal(REVIEWED, { ...SHOWN, replay: refused, full: true }).split('\n');
  const offending = lines.filter((l) => !isControlsLine(l) && clauseId.test(l));
  assert.deepEqual(offending, []);
  // And the Controls lines do carry them: the filter above is not vacuous.
  assert.ok(lines.some((l) => isControlsLine(l) && clauseId.test(l)));
});

test('sections come in the brief\'s order and the last three lines are exact', () => {
  const text = full(RESULT);
  const order = ['CLIENTS', 'SERVERS', 'TOOLS', 'FINDINGS', 'BLAST RADIUS', 'WHAT THIS SCAN CANNOT SEE', 'NEXT'];
  const at = order.map((h) => text.split('\n').findIndex((l) => l.startsWith(h)));
  assert.ok(at.every((i) => i >= 0), `a section is missing: ${JSON.stringify(at)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  const lines = text.trimEnd().split('\n');
  assert.deepEqual(lines.slice(-3), [POLICY_PATH_TOKEN, REVIEW_URL, MCP_NEXT]);
  assert.ok(!text.includes('--ci'), 'the report names a --ci flag no code implements');
  const cannot = lines.indexOf('WHAT THIS SCAN CANNOT SEE');
  const next = lines.indexOf('NEXT');
  assert.ok(next - cannot - 2 <= 4, 'the "cannot see" paragraph is at most four lines');
});

test('findings print most severe first, one line of controls each where the kind cites any', () => {
  const lines = full(RESULT).split('\n');
  const sev = lines.filter((l) => /^ {2}(HIGH|WARN|INFO) {2}/.test(l)).map((l) => l.slice(2, 6));
  assert.equal(sev.length, FIXTURE.findings.length);
  const rank = { HIGH: 0, WARN: 1, INFO: 2 } as const;
  const ranks = sev.map((s) => (s === 'HIGH' ? rank.HIGH : s === 'WARN' ? rank.WARN : rank.INFO));
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks);
});

test('the not-covered client and every status word, "not covered" included, print verbatim', () => {
  const text = full(RESULT);
  assert.match(text, /Not covered: +JetBrains AI Assistant/);
  // One real annex row per status word, cited by a test-only mapping: the
  // shipped mapping cites what a reader should open, not one of each word.
  const kinds = { ...FINDING_CONTROLS.kinds };
  const words: string[] = [];
  const cites = [];
  for (const status of ['built', 'partial', 'not checked', 'lands in', 'customer obligation', 'not covered'] as const) {
    // A row this package never cites (EXCLUDED_CITATIONS) prints nowhere; the first other row of that status does.
    const row = ANNEX.rows.find((r) => r.status === status && !isExcludedCitation(r));
    assert.ok(row, `no "${status}" row at the pin`);
    cites.push({ framework: row.framework, clause: row.clause });
    words.push(`${row.framework} ${row.clause} — ${status === 'lands in' ? `lands in ${row.milestone ?? ''}` : status}`);
  }
  kinds.egress = cites;
  const mapping: FindingControls = { ...FINDING_CONTROLS, kinds };
  const flat = full({ ...FIXTURE, findings: attachControls(FIXTURE.findings, mapping) }, { width: 10_000 });
  for (const w of words) assert.ok(flat.includes(w), `missing verbatim: ${w}`);
});

test('every line fits 80 columns, the one screen and --full alike', () => {
  const long = renderTerminal(REVIEWED, { ...SHOWN, full: true }).split('\n').filter((l) => l.length > 80);
  assert.deepEqual(long, []);
});

/** The fixture with `n` more pair findings, one of them with a tool list far wider than any terminal. */
function withPairs(n: number): ScanResult {
  const many = { ...RESULT, findings: [...RESULT.findings] };
  for (let i = 0; i < n; i++) {
    const tools = i === 0 ? Array.from({ length: 12 }, (_, k) => `a_long_tool_name_${k}`) : [`a${i}`, `b${i}`];
    many.findings.push({ id: `pair:x${i}`, kind: 'pair', severity: 'high', tools, client: 'Zed', message: 'm', controls: [] });
  }
  return many;
}

test('at 120 columns nothing is cut and nothing is over 120: every finding is on the screen, wrapped (ACP-454)', () => {
  const result = withPairs(37);
  const text = renderTerminal(result, { ...SHOWN, width: 120, full: true });
  const lines = text.split('\n');
  assert.deepEqual(lines.filter((l) => l.length > 120), []);
  assert.ok(!text.includes('+...') && !text.includes('...') && !/and \d+ more/.test(text), 'something was cut');
  // 3 of the fixture's and 37 added: 40 findings, 40 lines that start one.
  const screen = renderTerminal(result, { ...SHOWN, width: 120 }).split('\n');
  const heads = screen.filter((l) => /^ {2}(HIGH|WARN|INFO) {2}/.test(l));
  assert.equal(heads.length, 40, screen.join('\n'));
  // The wide one wraps rather than ending: its last tool is on the screen.
  assert.ok(screen.some((l) => l.includes('a_long_tool_name_11')), 'the wide finding lost its tail');
  assert.ok(screen.some((l) => /^ {8}\S/.test(l)), 'the wide finding did not wrap under its text');
  // And the wider terminal is used: a line of the one screen is longer than 80.
  assert.ok(screen.some((l) => l.length > 80));
});

test('"agent" is never bare: every occurrence reads "AI agent"', () => {
  const text = renderTerminal(REVIEWED, { ...SHOWN, full: true });
  const bare = [...text.matchAll(/(\S*\s)?agent/gi)].filter((m) => m[1] !== 'AI ');
  assert.deepEqual(bare.map((m) => m[0]), []);
});

test('no colour unless the caller asks (the CLI asks for a terminal); color: true paints', () => {
  assert.ok(!renderTerminal(REVIEWED, { ...SHOWN, full: true }).includes('\u001b['));
  assert.ok(renderTerminal(RESULT, { color: true }).includes('\u001b[31mHIGH\u001b[0m'));
  assert.ok(full(RESULT, { color: true }).includes('\u001b[31mHIGH\u001b[0m'));
});

test('--json is the ScanResult verbatim, keys sorted, two-space indent, statuses included', () => {
  const json = renderJson(RESULT);
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(RESULT)));
  assert.ok(json.startsWith('{\n  "catalog": ['));
  assert.equal(renderJson({ ...RESULT }), json);
  assert.match(json, /"status": "partial"/);
});

test('two servers exposing one tool name each show their own draft (client + server + tool key)', () => {
  const result: ScanResult = {
    ...FIXTURE,
    catalog: [
      { client: 'Cursor', server: 'files', tool: 'remove', description: '', params: [], source_path: 'a' },
      { client: 'Cursor', server: 'tags', tool: 'remove', description: '', params: [], source_path: 'b' },
    ],
    classifications: [
      { client: 'Cursor', server: 'files', tool: 'remove', effect: 'irreversible', egress: false, untrusted_input: false, matched: [], draft: true },
      { client: 'Cursor', server: 'tags', tool: 'remove', effect: 'write', egress: false, untrusted_input: false, matched: [], draft: true },
    ],
    findings: [],
  };
  const lines = full(result).split('\n');
  const at = (header: string): string => lines[lines.indexOf(header) + 1] ?? '';
  assert.match(at('  Cursor · files'), /^ {4}remove +irreversible/);
  assert.match(at('  Cursor · tags'), /^ {4}remove +write/);
});

test('SERVERS and BLAST RADIUS list only clients with a configured server; the rest are counted, and CLIENTS stays complete', () => {
  const result = { ...RESULT, clients_scanned: [...RESULT.clients_scanned, 'Goose'] };
  const lines = full(result).split('\n');
  // ACP-450: CLIENTS splits what it looked for the way SERVERS does -- a client
  // with no configuration on the machine is never listed as if it were scanned.
  assert.ok(!lines.some((l) => l.startsWith('  Scanned:')), 'CLIENTS still prints one "Scanned:" list');
  assert.ok(lines.includes('  Configured:              Claude Code, VS Code, Cursor'), lines.join('\n'));
  assert.ok(lines.includes('  No configuration found:  Zed, Goose'), lines.join('\n'));
  const servers = lines.slice(lines.indexOf('SERVERS'), lines.indexOf('TOOLS'));
  const blast = lines.slice(lines.indexOf('BLAST RADIUS (counts, not a score)'), lines.indexOf('WHAT THIS SCAN CANNOT SEE'));
  for (const section of [servers, blast]) assert.ok(!section.some((l) => /\b(Zed|Goose)\b/.test(l)), section.join('\n'));
  assert.ok(servers.includes('  2 other clients have no tool servers configured.'));
  const none = full({ ...RESULT, clients_scanned: ['Claude Code', 'VS Code', 'Cursor'] }).split('\n');
  assert.ok(none.includes('  No configuration found:  none'), none.join('\n'));
  assert.ok(!servers.some((l) => l.includes('no tool servers configured') && !l.includes('other client')));
});

test('a server that did not start is named in the SERVERS name column, never "(server)"', () => {
  const text = full(RESULT);
  assert.ok(!text.includes('(server)'));
  assert.match(text, /^ {4}python-tools {6}runtime missing: /m);
  assert.match(text, /^ {4}linear {12}not started: /m);
});

test('a server configured in several projects is one SERVERS row with the count beneath it (ACP-450)', () => {
  const lines = full(RESULT).split('\n');
  const row = lines.findIndex((l) => l.startsWith('    web '));
  assert.ok(row > 0);
  assert.equal(lines[row + 1], `${' '.repeat(32)}configured in 3 projects`);
  assert.equal(lines.filter((l) => l.startsWith('    web ')).length, 1);
  assert.equal(lines.filter((l) => l === '  Claude Code · web').length, 1);
});

// ---------------------------------------------------------------------------
// The one screen (ACP-452)
// ---------------------------------------------------------------------------

test('the one screen: header, damage, other findings, blind spots, replay, NEXT, and the pointer to the rest, in that order', () => {
  const lines = renderTerminal(REVIEWED, SHOWN).trimEnd().split('\n');
  assert.equal(lines[0], 'ZIFFER scan 0.1.0 · this machine · nothing was sent anywhere');
  assert.equal(lines[1], 'engine 01234567 · 2026-09-25T09:30:00Z');
  // What the run wrote, and that it sits in a git work tree (ACP-454).
  assert.equal(lines[2], 'Wrote ./ziffer-scan/ (5 items). It is yours to delete; nothing was sent.');
  assert.equal(lines[3], 'Add ziffer-scan/ to .gitignore, or run with --out elsewhere.');
  const outside = renderTerminal(REVIEWED, { ...SHOWN, wrote: { dir: './ziffer-scan/', items: 2, gitWorkTree: false } }).split('\n');
  assert.equal(outside[2], 'Wrote ./ziffer-scan/ (2 items). It is yours to delete; nothing was sent.');
  assert.equal(outside[3], '');
  const at = [
    lines.findIndex((l) => l.startsWith('The AI agents you code with can reach 4 tool servers with 8 tools, from 3')),
    lines.findIndex((l) => l.startsWith('  HIGH  ')),
    lines.indexOf('NOT IN THIS PICTURE'),
    lines.indexOf('REPLAY'),
    lines.indexOf('NEXT'),
    lines.indexOf(FULL_DETAIL),
  ];
  assert.ok(at.every((i) => i > 0), `a block is missing: ${JSON.stringify(at)}\n${lines.join('\n')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  // The last line is a verb; the pointer to the rest is just above it.
  assert.equal(lines.at(-1), NEXT_OPEN);
  assert.equal(lines.at(-2), FULL_DETAIL);
  // None of the complete report's sections is on the one screen.
  for (const h of ['CLIENTS', 'SERVERS', 'TOOLS', 'BLAST RADIUS (counts, not a score)']) assert.ok(!lines.includes(h), h);
  assert.ok(!lines.some((l) => l.startsWith('FINDINGS')));
});

test('the irreversible tools are a table: server, tool, what it can do, then what that means (ACP-454)', () => {
  const lines = renderTerminal(RESULT).split('\n');
  const head = lines.findIndex((l) => l.startsWith('The AI agents you code with'));
  assert.match(lines.slice(head, head + 2).join(' '), /2 of them can do damage that cannot be undone:$/);
  const table = lines.indexOf('  server  tool                what it can do');
  assert.ok(table > head, lines.join('\n'));
  assert.deepEqual(lines.slice(table + 1, table + 4), [
    '  mail    delete_email        delete',
    '  github  merge_pull_request  merge',
    `  ${IRREVERSIBLE_CONSEQUENCE}`,
  ]);
  const none = renderTerminal({ ...RESULT, classifications: RESULT.classifications.filter((c) => c.effect !== 'irreversible') });
  assert.match(none.replace(/\n/g, ' '), /None of them is classified as irreversible by this scan's draft rules\./);
  assert.ok(!none.includes('what it can do') && !none.includes(IRREVERSIBLE_CONSEQUENCE));
  // The phrase is short: the keyword, "off this machine" when it sends, SQL named when the tool says so.
  const sql = {
    ...RESULT,
    classifications: [
      { client: 'Cursor', server: 'db', tool: 'execute_sql', effect: 'irreversible' as const, egress: false, untrusted_input: false, matched: ['effect.irreversible:execute'], draft: true as const },
      { client: 'Cursor', server: 'mailer', tool: 'send', effect: 'irreversible' as const, egress: true, untrusted_input: false, matched: ['effect.irreversible:send', 'egress:send'], draft: true as const },
    ],
  };
  const rows = renderTerminal(sql).split('\n');
  assert.ok(rows.includes('  db      execute_sql  execute SQL'), rows.join('\n'));
  assert.ok(rows.includes('  mailer  send         send off this machine'), rows.join('\n'));
});

test('the other findings: one each, most severe first, never an irreversible one, all of them, and what a pair means', () => {
  const lines = renderTerminal(RESULT).split('\n');
  const other = lines.filter((l) => /^ {2}(HIGH|WARN|INFO) {2}/.test(l));
  assert.deepEqual(other, [
    '  HIGH  Claude Code: an AI agent that reads read_email can then run send_email',
    '  HIGH  search_notes · Cursor: its description speaks to the AI agent',
    '  WARN  fetch_url · Claude Code: reads untrusted input, can send data out',
  ]);
  assert.ok(!other.some((l) => l.includes('delete_email') || l.includes('merge_pull_request')));
  const after = lines.indexOf(other.at(-1) ?? '') + 1;
  assert.equal(lines.slice(after, after + 2).map((l) => l.trim()).join(' '), PAIR_CONSEQUENCE);
  const noPair = renderTerminal({ ...RESULT, findings: RESULT.findings.filter((f) => f.kind !== 'pair') });
  assert.ok(!noPair.includes(PAIR_CONSEQUENCE), 'the pair sentence printed with no pair on the screen');
  const all = renderTerminal(withPairs(10)).split('\n');
  assert.equal(all.filter((l) => /^ {2}(HIGH|WARN|INFO) {2}/.test(l)).length, 13);
  assert.ok(!all.some((l) => /and \d+ more/.test(l)));
});

test('what the scan could not see is counts, one line each, with the timeout doubled', () => {
  const lines = renderTerminal(RESULT).split('\n');
  const block = lines.slice(lines.indexOf('NOT IN THIS PICTURE') + 1, lines.indexOf('NEXT') - 1).join('\n');
  assert.equal(
    block,
    [
      '  1 server took longer than 60 s to start and is not in this picture (rerun with',
      '    --timeout 120)',
      '  1 other server could not be started or read and is not in this picture',
      '  1 tool could not be read from its name or description; the draft treats it as',
      '    a write for a person to confirm',
      '  1 client has no configuration on this machine',
      '  JetBrains AI Assistant is not covered',
      '  Tools your own application defines for a model in its code are not in this',
      '    picture yet',
    ].join('\n'),
  );
  const remote = {
    ...RESULT,
    findings: [
      ...RESULT.findings,
      { id: 'r', kind: 'server_not_started' as const, severity: 'info' as const, tools: [], client: 'Zed', server: 'docs', controls: [],
        message: 'The server "docs" was not scanned: a remote server at https://x.test/mcp; this scan starts only servers that run on this machine.' },
    ],
  };
  assert.ok(renderTerminal(remote).split('\n').includes('  1 remote server is not started by this scan'));
});

test('the replay is two lines under the UNSIGNED DEMO line: the harness summary, then your own tool', () => {
  const text = renderTerminal(REVIEWED, SHOWN);
  const lines = text.split('\n');
  const start = lines.indexOf('REPLAY');
  const block = lines.slice(start + 1, lines.indexOf('NEXT') - 1);
  assert.equal(block.slice(0, 2).join(' '), UNSIGNED_DEMO_LINE);
  assert.equal(
    block.slice(2).join('\n'),
    [
      '  Without ZIFFER, all 8 injected actions execute; under the draft policy, 4 are',
      '  refused before grading, 1 is refused when graded, 2 are held until 2 approvers',
      '  sign, 1 is allowed.',
      '  Your mail · delete_email: without ZIFFER executes; under the draft policy HELD',
      '  until 2 approvers sign',
      '  (a proposal this scan wrote, not one an AI agent made)',
    ].join('\n'),
  );
  const allowed = renderTerminal(RESULT, { replay: withOwn({ ...OWN, outcome: OWN_ALLOWED }) });
  assert.match(allowed.replace(/\n {2}/g, ' '), /under the draft policy ALLOWED/);
  const absent = renderTerminal(RESULT, { replay: withOwn({ absent: true, reason: 'No tool of yours is in the adapter grammar.' }) });
  assert.ok(absent.split('\n').includes('  No tool of yours is in the adapter grammar.'));
  assert.ok(!absent.includes('Your '));
  const without = renderTerminal(RESULT, { replay: { rows: ROWS, quorum_k: 2 } });
  assert.ok(!without.includes('Your ') && without.includes('Without ZIFFER, all 8'));
  // On a real machine the harness's eight tools are absent, and the summary says so (ACP-454).
  const grammar: ReplaySummary['rows'] = ROWS.map(() => ({ outcome: REFUSED_BEFORE }));
  const real = renderTerminal(RESULT, { replay: withOwn(OWN, grammar) }).split('\n');
  const rs = real.indexOf('REPLAY');
  assert.deepEqual(real.slice(rs + 3, rs + 8), [
    '  Without ZIFFER, all 8 injected actions execute; under the draft policy, 8 are',
    "  refused before grading: the harness's eight tools are not on this machine.",
    '  Your own tool is:',
    '  mail · delete_email: without ZIFFER executes; under the draft policy HELD',
    '  until 2 approvers sign',
  ]);
  const realNoOwn = renderTerminal(RESULT, { replay: { rows: grammar, quorum_k: 2 } });
  assert.ok(realNoOwn.includes('not on this machine.') && !realNoOwn.includes('Your own tool is:'));
  assert.ok(!renderTerminal(RESULT).includes('REPLAY'), 'a run with --no-replay has no replay block');
});

test('NEXT with --report: open the report first, then review and sign off with the archive, the policy, the MCP line (ACP-454)', () => {
  const lines = renderTerminal(REVIEWED, SHOWN).split('\n');
  const next = lines.slice(lines.indexOf('NEXT') + 1, lines.indexOf(FULL_DETAIL) - 1);
  assert.deepEqual(next, [
    '  Open the report:      open ziffer-scan/ziffer-scan-report.html',
    `  Review and sign off:  ${REVIEW_URL}`,
    '                        Attach ziffer-scan/ziffer-review.tar.gz to the email',
    '                        that page sends you.',
    '  The draft policy is ziffer-scan/ziffer-policy (13 files), signed by a key made',
    '  for this run and discarded: a draft to review, not a policy to deploy.',
    `  ${MCP_NEXT}`,
  ]);
  assert.equal(lines.at(-2), NEXT_OPEN);
  // Not macOS: the path alone. Elsewhere than the cwd: the whole path.
  const linux = renderTerminal(REVIEWED, { ...SHOWN, open: false, cwd: '/elsewhere' }).split('\n');
  assert.ok(linux.includes('  Open the report:      /home/you/ziffer-scan/ziffer-scan-report.html'), linux.join('\n'));
});

test('NEXT without --report: how to get the report comes first, and the last line says to run it (ACP-454)', () => {
  const lines = renderTerminal(RESULT, SHOWN).split('\n');
  const next = lines.slice(lines.indexOf('NEXT') + 1, lines.indexOf(FULL_DETAIL) - 1);
  assert.equal(next[0], '  Get the shareable report:  ziffer-scan --report');
  assert.equal(
    next.slice(1, 3).map((l) => l.trim()).join(' '),
    'Move or delete ./ziffer-scan/ first: a new run does not overwrite it.',
  );
  assert.ok(next[1]?.startsWith(' '.repeat(29)), next.join('\n'));
  assert.ok(next.includes(`  Review and sign off:       ${REVIEW_URL}`), next.join('\n'));
  assert.ok(!lines.some((l) => l.includes('Attach ')));
  assert.equal(lines.at(-2), NEXT_RUN);
  const plain = renderTerminal(RESULT).split('\n');
  assert.ok(plain.includes(POLICY_PATH_TOKEN), 'without a policy the one screen prints the token the CLI fills');
});

test('the guards read the shapes structurally and refuse anything else', () => {
  assert.ok(hasOwnCase(OWN));
  assert.ok(!hasOwnCase({ ...OWN, outcome: { kind: 'held' } }), 'a hold that names no k');
  assert.ok(!hasOwnCase({ absent: true, reason: 'x' }));
  assert.ok(isOwnAbsent({ absent: true, reason: 'x' }));
  assert.ok(!isOwnAbsent({ absent: false, reason: 'x' }));
  assert.ok(hasReview(REVIEWED));
  assert.ok(!hasReview(RESULT));
  assert.ok(!hasReview({ review: { archive: 1, report: 'x' } }));
});

test('--full shows the classifier\'s reason as a "because" column when it gives one; the one screen never does (ACP-454)', () => {
  // `reason` is read structurally: a Classification without it renders as before.
  const reasoned = {
    ...RESULT,
    classifications: RESULT.classifications.map((c) => (c.tool === 'send_email' ? { ...c, reason: 'description says "Send an email"' } : c)),
  };
  const wide = full(reasoned, { width: 120 }).split('\n');
  const row = wide.find((l) => l.startsWith('    send_email '));
  assert.equal(row, `${'    send_email              write         egress                   draft'.padEnd(74)}because description says "Send an email"`);
  const narrow = full(reasoned).split('\n');
  const at = narrow.findIndex((l) => l.startsWith('    send_email '));
  assert.equal(narrow[at], '    send_email              write         egress                   draft');
  assert.equal(narrow[at + 1], '      because description says "Send an email"');
  assert.ok(!renderTerminal(reasoned, SHOWN).includes('because'), 'the one screen shows the reason');
  assert.equal(full(RESULT).includes('because'), false);
});

test('a NEXT command is never split between "open" and its path: too long for its label, it goes whole on the next line', () => {
  const long = `/very/long/${'d'.repeat(90)}/ziffer-scan/ziffer-scan-report.html`;
  const r = { ...RESULT, review: { archive: '/a.tar.gz', report: long } };
  const lines = renderTerminal(r, { ...SHOWN, cwd: '/elsewhere' }).split('\n');
  const at = lines.indexOf('  Open the report:');
  assert.ok(at > 0, lines.join('\n'));
  assert.equal(lines[at + 1], `    open ${long}`);
});

test('a pair reads reader -> actor from its readers and actors, wrapped; without them, the flat list as before (ACP-454)', () => {
  const bare = {
    id: 'pair:x:Claude Code', kind: 'pair' as const, severity: 'high' as const, client: 'Claude Code', message: 'm', controls: [],
    tools: ['get_price_list_urls', 'navigate_page', 'execute_sentry_tool', 'execute_sql', 'merge_pull_request', 'send_feedback', 'send_stripe_feedback'],
  };
  const pair = {
    ...bare,
    readers: ['get_price_list_urls', 'navigate_page'],
    actors: ['execute_sentry_tool', 'execute_sql', 'merge_pull_request', 'send_feedback', 'send_stripe_feedback'],
  };
  const lines = renderTerminal({ ...RESULT, findings: [pair] }).split('\n');
  const at = lines.findIndex((l) => l.startsWith('  HIGH  '));
  assert.deepEqual(lines.slice(at, at + 3), [
    '  HIGH  Claude Code: an AI agent that reads get_price_list_urls or navigate_page',
    '        can then run execute_sentry_tool, execute_sql, merge_pull_request,',
    '        send_feedback or send_stripe_feedback',
  ]);
  const flat = renderTerminal({ ...RESULT, findings: [bare] });
  assert.match(flat, /HIGH {2}get_price_list_urls \+ navigate_page/);
});

test('INFO findings that send data out are ONE line on the one screen, every one in --full (ACP-454)', () => {
  const catalog = Array.from({ length: 18 }, (_, i) => ({ client: 'Claude Code', server: 's', tool: `t${i}`, description: '', params: [], source_path: 'p' }));
  const classifications = catalog.map((t, i) => ({
    client: t.client, server: t.server, tool: t.tool, effect: 'read' as const, egress: true, untrusted_input: i < 15, matched: [], draft: true as const,
  }));
  const infos = catalog.map((t) => ({
    id: `egress:${t.tool}`, kind: 'egress' as const, severity: 'info' as const, tools: [t.tool], client: t.client, message: 'This tool can send data out.', controls: [],
  }));
  const result: ScanResult = { ...RESULT, catalog: [...RESULT.catalog, ...catalog], classifications: [...RESULT.classifications, ...classifications], findings: [...RESULT.findings, ...infos] };
  const screen = renderTerminal(result, { width: 120 }).split('\n');
  const info = screen.filter((l) => l.startsWith('  INFO  '));
  assert.equal(info.length, 1, screen.join('\n'));
  // At 120 columns the one line wraps once, under its text.
  const at = screen.indexOf(info[0] ?? '');
  assert.deepEqual(screen.slice(at, at + 2), [
    '  INFO  18 tools can send data off this machine, 15 of them after reading untrusted input: --full and the report list',
    '        them',
  ]);
  // HIGH and WARN stay one each, and come first.
  assert.equal(screen.filter((l) => /^ {2}(HIGH|WARN) {2}/.test(l)).length, 3);
  assert.ok(screen.indexOf(info[0] ?? '') > screen.findIndex((l) => l.startsWith('  WARN  ')));
  const rest = full(result).split('\n').filter((l) => /^ {2}INFO {2}t\d+ · Claude Code$/.test(l));
  assert.equal(rest.length, 18);
  const one = renderTerminal({ ...result, findings: [...RESULT.findings, ...infos.slice(0, 1)] }).split('\n');
  const oneAt = one.findIndex((l) => l.startsWith('  INFO  '));
  assert.equal(
    one.slice(oneAt, oneAt + 2).map((l) => l.trim()).join(' '),
    'INFO  1 tool can send data off this machine, after reading untrusted input: --full and the report list it',
  );
});

test('the own case prints the tool\'s real name, never the bundle\'s key (ACP-454)', () => {
  const keyed = withOwn({ ...OWN, server: 'db-prod', tool: 'execute_sql_2', original_name: 'execute_sql' });
  const screen = renderTerminal(RESULT, { replay: keyed });
  assert.ok(screen.replace(/\n {2}/g, ' ').includes('Your db-prod · execute_sql: without ZIFFER executes'), screen);
  assert.ok(!screen.includes('execute_sql_2'), 'the one screen printed the bundle key');
  const grammar = withOwn({ ...OWN, tool: 'execute_sql_2', original_name: 'execute_sql' }, ROWS.map(() => ({ outcome: REFUSED_BEFORE })));
  assert.ok(!renderTerminal(RESULT, { replay: grammar }).includes('execute_sql_2'));
});

test('with reach, the headline and NOT IN THIS PICTURE count each program once, however many clients configure it (ACP-454)', () => {
  // One program configured in seven clients: seven catalog rows per tool, seven
  // not-started findings for one remote address, one reach.
  const clients = ['Windsurf', 'Cursor', 'VS Code', 'GitHub Copilot', 'Claude Code', 'Gemini CLI', 'Codex CLI'];
  const catalog = clients.flatMap((client) =>
    ['get_graph', 'query_graph'].map((tool) => ({ client, server: 'code-review-graph', tool, description: '', params: [], source_path: '/x' })),
  );
  const remote = clients.map((client) => ({
    id: `server_not_started:${client}/aws`, kind: 'server_not_started' as const, severity: 'info' as const, tools: [], client, server: 'aws', controls: [],
    message: 'The server "aws" was not scanned: a remote server at https://x.test/mcp; this scan starts only servers that run on this machine.',
  }));
  const seven: ScanResult = { ...RESULT, catalog, classifications: [], findings: remote };
  // Without reach (a result made before ACP-454): catalog rows, as before.
  const before = renderTerminal(seven).split('\n');
  assert.ok(before.some((l) => l.startsWith('The AI agents you code with can reach 7 tool servers with 14 tools.')), before.join('\n'));
  assert.ok(before.includes('  7 remote servers are not started by this scan'));
  const reach = { servers: 1, tools: 2, clients: 7, not_started: { remote: 1, timed_out: 0, other: 0 } };
  const after = renderTerminal({ ...seven, reach }).split('\n');
  assert.ok(after.some((l) => l.startsWith('The AI agents you code with can reach 1 tool server with 2 tools, from 7')), after.join('\n'));
  assert.ok(after.includes('  1 remote server is not started by this scan'), after.join('\n'));
  assert.ok(after.some((l) => l.startsWith('AI agent clients.')), after.join('\n'));
  assert.ok(!after.some((l) => l.includes('other server')), after.join('\n'));
});

// ---------------------------------------------------------------------------
// ACP-455 `--code`: the application's own tools, first, and ONE call to action.
// ---------------------------------------------------------------------------

/** The coverage table the code tests read: explicit, so the front end's data file can grow without moving them. */
const SDKS: CodeSdkEntry[] = [
  { id: 'ai', framework: 'Vercel AI SDK', rows: ['Vercel AI SDK'], language: ['TS'], packages: ['ai'], covered: 'milestone-1', kind: 'framework' },
  { id: 'anthropic', framework: 'Anthropic SDK', rows: ['Anthropic SDK'], language: ['TS'], packages: ['@anthropic-ai/sdk'], covered: 'milestone-1', kind: 'framework' },
  { id: 'openai', framework: 'OpenAI SDK', rows: ['OpenAI SDK'], language: ['TS'], packages: ['openai'], covered: 'milestone-1', kind: 'framework' },
  { id: 'gemini', framework: 'Google Gen AI SDK', rows: ['Google Gen AI SDK'], language: ['TS'], packages: ['@google/genai'], covered: 'milestone-1', kind: 'framework' },
  { id: 'llamaindex', framework: 'LlamaIndex', rows: ['LlamaIndex'], language: ['TS'], packages: ['llamaindex'], covered: 'not-yet', kind: 'framework' },
];
const PATHS = { archive: '/home/you/ziffer-scan/ziffer-review.tar.gz', report: '/home/you/ziffer-scan/ziffer-scan-report.html' };
/** A `--code` run with no MCP configuration at all: the empty catalog a code-only run produces. */
const CODE_ONLY = {
  ...FIXTURE,
  clients_scanned: [],
  clients_not_covered: [],
  catalog: [],
  classifications: [],
  findings: [],
  code: CODE,
  review: PATHS,
};
const WITH_CODE = { ...REVIEWED, code: CODE };
const CODE_OPTS: TerminalOptions = { ...SHOWN, codeSdks: SDKS };

/** The lines inside the call-to-action box, borders removed. */
function boxed(text: string): string[] {
  return stripAnsi(text)
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .map((l) => l.slice(1, -1).trim());
}

test('without --code the one screen and --full are byte-identical to 0.2.4 (hashes taken before ACP-455 touched the renderer)', () => {
  const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
  // Retaken when an unclassified tool became a drafted write (the classifier's change on int): the one
  // NOT IN THIS PICTURE sentence about it is the only line that moved, as the snapshot's diff shows.
  // First pinned from the 74ada3f tree, before this change: the committed snapshot
  // covers REVIEWED + SHOWN; these cover the defaults and the coloured --full.
  // ACP-455 exec: the executive summary is the ONLY addition, so the hashes stay the 0.2.4 ones and
  // are taken over the rendering with that one block cut out; the block is tested on its own.
  const result = { ...FIXTURE, findings: attachControls(FIXTURE.findings) };
  const withoutExec = (text: string, width: number, color: boolean): string => {
    const paint = (code: string, t: string): string => (color && t !== '' ? `\u001b[${code}m${t}\u001b[0m` : t);
    const block = `${execLines(execOf(result), width, paint).join('\n')}\n\n`;
    assert.equal(text.split(block).length, 2, 'the executive summary is not in the rendering exactly once');
    return text.replace(block, '');
  };
  assert.equal(sha(withoutExec(renderTerminal(result), 80, false)), '72494af620788dd93b3cf4ef0cbd41b2859f7b18ec381e75828359164f182214');
  // --full retaken by ACP-455's second review (was 0c5d255b…): the Controls lines of the two irreversible
  // findings no longer cite EU AI Act Art. 14(5) or DORA Art. 11(1) (controls.ts EXCLUDED_CITATIONS), as the
  // snapshot's diff shows; nothing else in --full moved. The one screen's hash above did not move.
  assert.equal(
    sha(withoutExec(renderTerminal(result, { full: true, width: 100, color: true }), 100, true)),
    '400fcfaf4c20e25bc45afcf74353f881b6425e2e70fcad6358ad5179c17c3970',
  );
});

test('--code: the application block comes first, with the numbers in plain words, and replaces the "not in this picture yet" line', () => {
  const text = renderTerminal(WITH_CODE, CODE_OPTS);
  const lines = text.split('\n');
  assert.ok(lines.includes('YOUR APPLICATION · example-platform'), text);
  const flat = lines.join(' ').replace(/\s+/g, ' ');
  for (const sentence of [
    // The route in a reader's words: the type-system phrase stays in the HTML table (the user rejected it on the first screen).
    'It defines 88 tools for a model in 412 files, through its own defineTool() helper.',
    'Exposure grade D: 31 of the 88 tools (35%) count: 19 are marked as impossible to undo by their name or description and 12 have no rule in the draft policy; confirm each reading.',
    '31 would be held for a human before running, 19 are treated as irreversible, 4 tools run after a notice under the draft policy, 12 are refused by the engine, 41 run recorded.',
    "The engine's verdict is listed here for 9 of the 88 tools.",
  ]) {
    assert.ok(flat.includes(sentence), `missing: ${sentence}`);
  }
  assert.ok(!flat.includes('app-local factory'), 'the type-system phrase is on the one screen');
  assert.ok(!flat.includes(APP_TOOLS_NOT_YET), 'the "not in this picture yet" line still prints beside the block that replaces it');
  assert.ok(renderTerminal(REVIEWED, SHOWN).replace(/\s+/g, ' ').includes(APP_TOOLS_NOT_YET), 'without --code the line is gone too');
  // First: before the MCP picture.
  assert.ok(text.indexOf('YOUR APPLICATION') < text.indexOf('The AI agents you code with can reach'));
  // The held tools: the first of the four, irreversible first, each on one line with where and why; the rest counted.
  const held = lines.slice(lines.indexOf('Held for a human before they run (4):') + 1);
  const toolLines = held.slice(0, 8).filter((l) => /^ {2}[a-z_]+ ·/.test(l));
  assert.deepEqual(toolLines.map((l) => l.trim().split(' ·')[0]), ['cancel_reservation', 'refund_payment']);
  assert.ok(flat.includes('cancel_reservation · api/src/lib/agents/tools/handlers/cancel-reservation.ts:12 · name says "cancel"'));
  assert.ok(flat.includes(`+ 2 more: the report and ziffer-scan --full list every one.`));
  assert.ok(!held.slice(0, 12).some((l) => l.includes('get_property') || l.includes('delete_gbp_post')), 'an allowed or refused tool is in the held list');
  // The refused group: one line of names, the reason once.
  assert.ok(flat.includes('Refused by the engine (1): delete_gbp_post.'), flat);
  // The computed exposure says who decides at runtime, in --full (the one screen names the insertion point instead).
  const full = renderTerminal(WITH_CODE, { ...CODE_OPTS, full: true }).replace(/\s+/g, ' ');
  assert.ok(full.includes('exposure is decided at runtime by getToolsForLocation (api/src/lib/agents/tools/tool-registry.ts:102); the scan lists what can be exposed.'));
});

test('--code: ONE boxed call to action names the dispatcher and points at the report; the snippet is never printed', () => {
  const text = renderTerminal(WITH_CODE, CODE_OPTS);
  const inside = boxed(text).join(' ').replace(/\s+/g, ' ');
  assert.ok(inside.includes(CODE.insertion.sentence), inside);
  assert.ok(inside.includes('tool-executor.ts:56'), inside);
  assert.ok(inside.includes(`${CODE_MODULE_IN_REPORT} open ziffer-scan/ziffer-scan-report.html`), inside);
  // The ONE line to paste is printed verbatim, inside the box.
  assert.ok(boxed(text).includes('await zifferGate(name, input);'), inside);
  // A result made before `call` existed: the snippet is the whole paste, and the box says the code is in the report.
  const noCall = { ...CODE.insertion };
  Reflect.deleteProperty(noCall, 'call');
  const older = boxed(renderTerminal({ ...WITH_CODE, code: { ...CODE, insertion: noCall } }, CODE_OPTS)).join(' ').replace(/\s+/g, ' ');
  assert.ok(older.includes(`${CODE_IN_REPORT} open ziffer-scan/ziffer-scan-report.html`) && !older.includes('zifferGate'), older);
  assert.equal(stripAnsi(text).split('\n').filter((l) => l.startsWith('┌─ ')).length, 1, 'not exactly one box');
  assert.ok(stripAnsi(text).includes(`┌─ ${CODE_CTA_TITLE} `));
  for (const line of CODE.insertion.snippet.split('\n').filter((l) => l.trim().length > 8)) {
    assert.ok(!text.includes(line.trim()), `the snippet reached the terminal: ${line}`);
  }
  assert.ok(!text.includes('ZifferClient'));
});

test('--code: declared frameworks the scan does not read are named, the covered ones are not', () => {
  const text = renderTerminal(WITH_CODE, CODE_OPTS).split('\n').join(' ').replace(/\s+/g, ' ');
  assert.ok(text.includes(`@ai-sdk/anthropic 3.0.44, llamaindex 0.12.1 and zod 4.1.12: ${NOT_READ_YET}.`), text);
  for (const covered of ['openai 7.23.0', '@google/genai 2.24.0', 'ai 7.0.116,']) assert.ok(!text.includes(`${covered}: ${NOT_READ_YET}`) && !text.includes(`, ${covered} and`));
  // The one screen prints the first limit and counts the rest; --full prints every one.
  assert.ok(text.includes(CODE.catalog.not_seen[0] ?? ''), 'the first limit is not on the one screen');
  assert.ok(text.includes('+ 1 more: the report and ziffer-scan --full list every one.'), text);
  const full = renderTerminal(WITH_CODE, { ...CODE_OPTS, full: true }).split('\n').join(' ').replace(/\s+/g, ' ');
  for (const l of CODE.catalog.not_seen) assert.ok(full.includes(l), `not_seen line missing from --full: ${l}`);
  // A framework a tool was found through is covered, whatever the table says.
  const uncovered: CodeSdkEntry[] = SDKS.map((e) => (e.id === 'ai' ? { ...e, covered: 'not-yet' } : e));
  const viaAi = (t: CodeTool): CodeTool => ({ ...t, sdk: 'ai' });
  const found: CodeSection = { ...CODE, verdicts: CODE.verdicts.map((v, i) => (i === 0 ? { ...v, tool: viaAi(v.tool) } : v)) };
  assert.deepEqual(frameworkRows(found, uncovered).find((f) => f.name === 'ai')?.covered, true);
  assert.deepEqual(frameworkRows(CODE, uncovered).find((f) => f.name === 'ai')?.covered, false);
});

test('--code: NEXT is four numbered steps, the paste at the dispatcher, and the last line is a verb', () => {
  const lines = renderTerminal(WITH_CODE, CODE_OPTS).split('\n');
  const next = lines.slice(lines.indexOf('NEXT') + 1, lines.indexOf(FULL_DETAIL) - 1);
  assert.deepEqual(next, [
    '  1. Open the report:        open ziffer-scan/ziffer-scan-report.html',
    '  2. Paste the ZIFFER call:  api/src/lib/agents/tools/tool-executor.ts:56',
    '                             at the top of executeTool; the code is in the',
    '                             report.',
    '  3. Review and sign:        ziffer-scan/ziffer-policy',
    '                             the draft policy (13 files), signed by a key made',
    '                             for this run and discarded: a draft to review, not',
    '                             a policy to deploy.',
    '  4. Attach to the review:   ziffer-scan/ziffer-review.tar.gz',
    `                             at ${REVIEW_URL}, in the email that page`,
    '                             sends you.',
    `  ${MCP_NEXT}`,
  ]);
  assert.equal(lines.at(-2), NEXT_OPEN);
  // Without a policy path, the CLI's token stands on its own line, as in 0.2.4.
  const { policy: _drop, ...noPolicy } = CODE_OPTS;
  assert.ok(renderTerminal(WITH_CODE, noPolicy).split('\n').includes(POLICY_PATH_TOKEN));
  // Without --report: how to get it, and the last line says to run it.
  const noReport = renderTerminal({ ...RESULT, code: CODE }, CODE_OPTS).split('\n');
  assert.ok(noReport.includes('  1. Get the report:         ziffer-scan --report'), noReport.join('\n'));
  assert.equal(noReport.at(-2), NEXT_RUN);
});

test('--code with no MCP configuration: no empty MCP sentence, table or line', () => {
  const text = renderTerminal(CODE_ONLY, CODE_OPTS);
  for (const absent of ['The AI agents you code with can reach', 'what it can do', 'NOT IN THIS PICTURE', MCP_NEXT]) {
    assert.ok(!text.includes(absent), `a code-only run printed "${absent}"`);
  }
  const full = renderTerminal(CODE_ONLY, { ...CODE_OPTS, full: true });
  for (const absent of ['CLIENTS', 'SERVERS', 'TOOLS\n', 'FINDINGS', 'BLAST RADIUS']) assert.ok(!full.includes(absent), `--full printed ${absent}`);
  assert.ok(full.includes('APPLICATION TOOLS · example-platform'));
  assert.ok(full.includes(CANNOT_SEE_WITH_CODE.slice(0, 60)) && !full.includes(APP_TOOLS_NOT_YET));
});

test('--code: every line fits the width at 80 and 120, coloured or not, and colour never changes the text', () => {
  for (const width of [80, 120]) {
    for (const result of [WITH_CODE, CODE_ONLY]) {
      const plain = renderTerminal(result, { ...CODE_OPTS, width, full: true });
      const over = plain.split('\n').filter((l) => l.length > width);
      assert.deepEqual(over, [], `over ${width}`);
      assert.equal(stripAnsi(renderTerminal(result, { ...CODE_OPTS, width, full: true, color: true })), plain);
    }
  }
  // No clause id in a sentence a person reads: the refusal's clause stays in --json.
  assert.ok(!renderTerminal(WITH_CODE, { ...CODE_OPTS, full: true }).includes('8.4-3'));
});

test('the coverage data file the reports read is the front end\'s, one reader', () => {
  // The parser and its refusals are tested in code/sdks.test.ts; here only that the reports see the same entries.
  assert.ok(loadCodeSdks().length > 0);
  assert.ok(loadCodeSdks().some((e) => e.id === 'ai' && e.covered === 'milestone-1'));
});

test('--code: tools that run after a notice with nobody asked are their own group, between held and refused, their sentence said once', () => {
  const lines = renderTerminal(WITH_CODE, CODE_OPTS).split('\n');
  // What the DRAFT does, never "nobody is asked": the application's own checks are the per-entry reading (ACP-455, 2026-09-28).
  const at = lines.indexOf('4 tools run after a notice under the draft policy:');
  assert.ok(at > lines.indexOf('Held for a human before they run (4):'), lines.join('\n'));
  assert.ok(at < lines.findIndex((l) => l.startsWith('Refused by the engine')));
  assert.equal(lines[at + 1], '  Runs after a notice to the notice addressee; nobody is asked first.');
  assert.equal(
    lines.slice(at + 2, at + 4).join(' ').replace(/\s+/g, ' ').trim(),
    'update_note · api/src/lib/agents/tools/handlers/update-note.ts:10 · description says "Overwrite"',
  );
  // Never among the held ones, never read as harmless.
  assert.ok(!lines.slice(lines.indexOf('Held for a human before they run (4):'), at).some((l) => l.includes('update_note')));
  // A result made before `notified`: no row, no group, and the sentence reads as it did.
  const counts = { ...CODE.counts };
  Reflect.deleteProperty(counts, 'notified');
  const older: CodeSection = { ...CODE, counts, verdicts: CODE.verdicts.filter((v) => v.tool.name !== 'update_note') };
  const text = renderTerminal({ ...WITH_CODE, code: older }, CODE_OPTS);
  assert.ok(!text.includes('after a notice'), text);
  assert.ok(text.replace(/\s+/g, ' ').includes('19 are treated as irreversible, 12 are refused by the engine'));
});

/** A tool of the fixture, to vary by name and place. */
function fixtureTool(i: number): CodeTool {
  const t = CODE.verdicts[i]?.tool;
  if (t === undefined) throw new Error(`fixture: no verdict ${i}`);
  return t;
}

test('--code: a sentence many tools share is printed once per group, and a held tool is never also said to be "cannot be undone"', () => {
  // The first customer's run printed NOTICE_ONLY_UNLISTED 22 times and appended ", cannot be undone" to a sentence about reversibility.
  const notified = (name: string, i: number): CodeToolVerdict => ({
    tool: { ...fixtureTool(7), name, defined_at: { file: `api/tools/${name}.ts`, line: 10 + i, col: 1 } },
    verdict: { verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: `rule:${name}` },
    what_ziffer_does: NOTICE_ONLY_UNLISTED,
    untrusted_input: false,
    egress: false,
  });
  const heldUnlisted = (name: string): CodeToolVerdict => ({
    tool: { ...fixtureTool(1), name },
    verdict: { verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T2', rule_id: `rule:${name}` },
    what_ziffer_does: NO_REVERSIBILITY_ENTRY,
    untrusted_input: false,
    egress: false,
  });
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => notified(`update_${n}`, i));
  const verdicts = [...CODE.verdicts.filter((v) => v.tool.name !== 'update_note'), ...many, heldUnlisted('sync_x'), heldUnlisted('upload_y')];
  const code: CodeSection = { ...CODE, verdicts, counts: { ...CODE.counts, tools: verdicts.length, notified: many.length } };
  const flatOf = (s: string): string => s.replace(/\s+/g, ' ');
  const screen = flatOf(renderTerminal({ ...WITH_CODE, code }, CODE_OPTS));
  const whole = flatOf(renderTerminal({ ...WITH_CODE, code }, { ...CODE_OPTS, full: true }));
  const once = (text: string, needle: string): number => text.split(needle).length - 1;
  const lead = 'These run after a notice under the draft; it does not know whether they can be undone.';
  assert.equal(once(screen, lead), 1, 'the notice sentence is repeated on the one screen');
  assert.equal(once(whole, lead), 2, 'the notice sentence is repeated in --full (once on the screen, once in the full list)');
  // The held no-entry case: said once, as a note naming its tools.
  assert.ok(screen.includes('2 of them only because the draft does not know whether they can be undone: sync_x and upload_y (add them to reversibility.json if they can).'), screen);
  assert.ok(!screen.includes(', cannot be undone'), 'a held tool is still suffixed ", cannot be undone"');
  // Every notified tool is on its own line in --full, name · where.
  for (const v of many) assert.ok(whole.includes(`${v.tool.name} · api/tools/${v.tool.name}.ts:`), v.tool.name);
});

test('--code: the one screen stays short on a large application; the complete lists are --full\'s', () => {
  const many = Array.from({ length: 60 }, (_, i): CodeToolVerdict => ({
    tool: { ...fixtureTool(0), name: `tool_${i}`, defined_at: { file: `api/tools/t${i}.ts`, line: i + 1, col: 1 } },
    verdict:
      i % 3 === 0
        ? { verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: `r${i}` }
        : i % 3 === 1
          ? { verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: `r${i}` }
          : { verdict: 'ALLOW', risk: 'LOW', reversibility: 'REVERSIBLE', effective_tier: 'T0', rule_id: `r${i}` },
    what_ziffer_does: i % 3 === 1 ? NOTICE_ONLY_UNLISTED : 'held for a human before it runs, then recorded with a signed receipt',
    untrusted_input: false,
    egress: false,
  }));
  const code: CodeSection = { ...CODE, verdicts: many, counts: { tools: 60, held: 20, notified: 20, refused: 0, allowed: 20, irreversible: 40 } };
  // A code run replays nothing: the options it prints under are CODE_OPTS without a replay.
  const { replay: _none, ...codeRun } = CODE_OPTS;
  const screen = renderTerminal({ ...CODE_ONLY, code }, { ...codeRun, width: 100 }).split('\n');
  const full = renderTerminal({ ...CODE_ONLY, code }, { ...CODE_OPTS, width: 100, full: true });
  assert.ok(screen.length <= 60, `the one screen is ${screen.length} lines`);
  for (const v of many.filter((x) => x.verdict.verdict !== 'REFUSED' && x.verdict.reversibility === 'IRREVERSIBLE')) assert.ok(full.includes(`${v.tool.name} · `), v.tool.name);
});

test('the preamble with reads: what the one scan reads, the no-codebase line, and the question only when a server starts', () => {
  const both = renderPreamble({ width: 200, reads: { code: '/work/app', installed: true } });
  assert.equal(both[1], 'Reads your code under /work/app, then the MCP configuration of your AI tools, starting each server once to list its tools; sends nothing anywhere.');
  assert.ok(both.includes('Nothing starts before you say yes.'));
  const codeOnly = renderPreamble({ width: 200, reads: { code: '/work/app', installed: false } });
  // Re-pointed by ACP-464: reading Python runs this machine's own Python, so the preamble no longer says "starts nothing".
  assert.deepEqual(codeOnly.slice(1), ["Reads your code under /work/app; starts no tool server, runs this machine's Python to read Python, sends nothing anywhere.", '']);
  const home = renderPreamble({ width: 200, reads: { installed: true, noCodebase: true } });
  assert.ok(home.includes('No codebase given: run it from your project folder or pass --cwd.'));
  // Without reads: the installed-tools preamble, as before.
  assert.deepEqual(renderPreamble({ width: 200 }), renderPreamble({ width: 200, reads: { installed: true } }));
});
