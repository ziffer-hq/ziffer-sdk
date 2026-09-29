/**
 * `--report` (ACP-443): the file a developer forwards and the archive the
 * review page asks for. The run is the whole command over the fixture home,
 * as e2e.test.ts makes it, from packages/scan; it needs the engine module.
 */

import assert from 'node:assert/strict';
import { NOTICE_ONLY_UNLISTED } from '../code/grade.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listBundle } from '../bundle/generate.js';
import { type CliContext, run } from '../cli.js';
import { loadReplayData } from '../replay/data.js';
import { OWN_LABEL } from '../replay/own.js';
import { type ReplayResult, type ReplayRow, UNSIGNED_DEMO_LINE, WITHOUT_POLICY } from '../replay/replay.js';
import type { CatalogTool, Finding } from '../types.js';
import { attachControls, statusWords } from './controls.js';
import { ZIFFER_LOGO_SVG } from './brand.js';
import { CODE } from './code.fixture.test.data.js';
import { COVERED, exposureGrade, GRADE_DEFINITION, gradeSentence, GROUP_WORDS, NOT_READ_YET, sortedVerdicts, type CodeSdkEntry } from './code.js';
import { ARCHIVE_FILE, CTA_TEXT, EXPLAIN, GATE_FILE, GROUP_LABEL, homeless, JSON_FILE, renderReportHtml, REPORT_FILE } from './file.js';
import { AFTER_PASTE, ASK_ORDER, ASK_QUESTION, ASSISTANT_CONFIG_TITLE, confirmKind, HEADLINE_LIMIT_ORDER, LIMITS_FOLD_TITLE, PLACEHOLDERS_ID, termsUsed } from './code-html.js';
import { codeRules } from './rules.js';
import { DOC, MEMBER_DOC, TERMS } from './docs.js';
import type { CodeSection, Exposure } from '../code/types.js';
import { loadCodeSdks } from '../code/sdks.js';
import { UNCLASSIFIED_REASON } from '../classify/index.js';
import { GROUND_PAIRS, reportStyle } from './page-style.js';
import { renderTerminal, REVIEW_URL } from './terminal.js';
import { BOOK_URL, MCP_URL } from './exec.js';
import { FIXTURE } from './fixture.test.data.js';
import { PAGE_SCRIPT, scriptHash } from './script.js';
import { shapedApp, STRESS, STRESS_SKILLS } from './door.fixture.test.data.js';
import { SKILL_LIMITS } from './instructions.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const HOME = join(PKG, 'fixtures', 'home');
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-report-'));
const PROJECT = join(WORK, 'project');
mkdirSync(PROJECT);
after(() => rmSync(WORK, { recursive: true, force: true }));

const NOW = new Date('2026-09-25T12:00:00Z');
/** The credential-shaped values in fixtures/home, as e2e.test.ts lists them (ACP-449). */
const SECRETS = ['sk_test_fixture_0001', 'sntryu_fixture_0002', 'fixture-remote-0003', 'fixture-env-value-0004'];

const POLICY = [
  'SIGNATURE',
  'adapters.json',
  'alert_targets.json',
  'attesters/registry.json',
  'door_identities.json',
  'floors.json',
  'limits.json',
  'manifest.json',
  'notice_targets.json',
  'receipt_identity.json',
  'reversibility.json',
  'risk_functions.json',
  'tool-names.json',
];

async function scan(args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    env: process.env,
    platform: 'darwin',
    home: join(WORK, 'not-the-home'),
    cwd: WORK,
    stdin: Readable.from([]),
    isTTY: false,
    prompt: () => undefined,
    now: () => NOW,
  };
  const code = await run(['--home', HOME, '--cwd', PROJECT, '--platform', 'darwin', ...args], { out: (l) => out.push(l), err: (l) => err.push(l) }, ctx);
  return { code, out, err };
}

test('--report writes the report, the JSON and the archive beside the policy, and the policy is untouched', async () => {
  const dir = join(WORK, 'one');
  const policy = join(dir, 'ziffer-policy');
  const r = await scan(['--yes', '--report', '--out', policy]);
  assert.equal(r.code, 0, r.err.join('\n'));
  for (const f of [REPORT_FILE, JSON_FILE, ARCHIVE_FILE]) assert.ok(existsSync(join(dir, f)), `${f} was not written`);
  // The policy folder is a signed bundle: nothing may be added to it.
  assert.deepEqual(listBundle(policy), POLICY);

  const html = readFileSync(join(dir, REPORT_FILE), 'utf8');
  for (const secret of SECRETS) assert.ok(!html.includes(secret), `the report carries ${secret}`);
  assert.ok(html.includes('[redacted]'), 'the report shows no [redacted] where a credential was');
  assert.ok(!html.includes('/Users/'), 'the report carries a /Users/ path');
  assert.ok(!html.includes(HOME), 'the report carries the scanned home');
  assert.ok(html.includes('<code>~/.claude.json</code>'), 'the scanned home is not shown from ~');
  // Self-contained: nothing runs and nothing is fetched. The one url() allowed is an embedded font (ACP-455, 2026-09-28).
  assert.ok(!/<script|<link|<img|<iframe|\ssrc=|url\((?!data:font\/woff2;base64,)/i.test(html), 'the report can fetch or run something');
  assert.match(html, /default-src 'none'/);
  for (const heading of [
    'What your AI coding agents can reach',
    'What can do damage that cannot be undone',
    'Findings',
    'What this scan could not see',
    'Replay',
    'Draft policy',
  ]) {
    assert.ok(html.includes(`<h2>${heading}`), `no section "${heading}"`);
  }
  assert.ok(html.includes(`<p class="notice">${UNSIGNED_DEMO_LINE}</p>`), 'the UNSIGNED DEMO line is not verbatim');
  assert.ok(html.indexOf(UNSIGNED_DEMO_LINE) > html.indexOf('<h2>Replay'), 'the UNSIGNED DEMO line is not in the replay');
  for (const placeholder of ['Approvers.', 'Notice addressee:</strong> not named yet.', 'Signing key.']) assert.ok(html.includes(placeholder), placeholder);
  assertPresentation(html);
  // The summary's replay sentence counts the replay the JSON document carries:
  // the harness rows and the machine's own row, by outcome.
  const doc: unknown = JSON.parse(readFileSync(join(dir, JSON_FILE), 'utf8'));
  const replay: unknown = typeof doc === 'object' && doc !== null ? Reflect.get(doc, 'replay') : undefined;
  assert.ok(typeof replay === 'object' && replay !== null, 'no replay in the JSON document');
  const rows: unknown = Reflect.get(replay, 'rows');
  assert.ok(Array.isArray(rows));
  const kinds: unknown[] = rows.map((row: unknown) => (typeof row === 'object' && row !== null ? Reflect.get(Reflect.get(row, 'outcome') ?? {}, 'kind') : undefined));
  const own: unknown = Reflect.get(replay, 'own');
  if (typeof own === 'object' && own !== null && Reflect.get(own, 'outcome') !== undefined) kinds.push(Reflect.get(Reflect.get(own, 'outcome') ?? {}, 'kind'));
  const n = (k: string): number => kinds.filter((x) => x === k).length;
  assert.equal(n('refused') + n('held') + n('allowed'), kinds.length, 'an outcome with no kind');
  const sentence = `Under the draft policy: ${n('refused')} refused, ${n('held')} held for approval, ${n('allowed')} allowed.`;
  assert.ok(plain(html).includes(sentence), `the summary lacks "${sentence}"`);

  const json = readFileSync(join(dir, JSON_FILE), 'utf8');
  for (const secret of SECRETS) assert.ok(!json.includes(secret), `the JSON carries ${secret}`);
  assert.ok(!json.includes(HOME), 'the JSON carries the scanned home');

  const listing = execFileSync('tar', ['-tzf', join(dir, ARCHIVE_FILE)], { encoding: 'utf8' }).trimEnd().split('\n');
  assert.deepEqual(listing, [
    'ziffer-policy/',
    'ziffer-policy/SIGNATURE',
    'ziffer-policy/adapters.json',
    'ziffer-policy/alert_targets.json',
    'ziffer-policy/attesters/',
    'ziffer-policy/attesters/registry.json',
    'ziffer-policy/door_identities.json',
    'ziffer-policy/floors.json',
    'ziffer-policy/limits.json',
    'ziffer-policy/manifest.json',
    'ziffer-policy/notice_targets.json',
    'ziffer-policy/receipt_identity.json',
    'ziffer-policy/reversibility.json',
    'ziffer-policy/risk_functions.json',
    'ziffer-policy/tool-names.json',
    REPORT_FILE,
    JSON_FILE,
  ]);
  // The archive holds the policy exactly as written.
  const into = mkdtempSync(join(WORK, 'x-'));
  execFileSync('tar', ['-xzf', join(dir, ARCHIVE_FILE), '-C', into]);
  for (const f of POLICY) assert.ok(readFileSync(join(into, 'ziffer-policy', f)).equals(readFileSync(join(policy, f))), f);
  assert.equal(readFileSync(join(into, REPORT_FILE), 'utf8'), html);
});

test('--report --json: the document names the two paths under review, absolute', async () => {
  const dir = join(WORK, 'two');
  const r = await scan(['--yes', '--json', '--no-replay', '--report', '--out', join(dir, 'ziffer-policy')]);
  assert.equal(r.code, 0, r.err.join('\n'));
  const doc: unknown = JSON.parse(r.out.join('\n'));
  assert.ok(typeof doc === 'object' && doc !== null);
  const review: unknown = Reflect.get(doc, 'review');
  assert.ok(typeof review === 'object' && review !== null, 'no review object');
  assert.equal(Reflect.get(review, 'archive'), join(dir, ARCHIVE_FILE));
  assert.equal(Reflect.get(review, 'report'), join(dir, REPORT_FILE));
  assert.ok(readFileSync(join(dir, REPORT_FILE), 'utf8').includes('The replay was not run'));
});

test('--report where a report already exists: ReviewFileOccupied, exit 2, nothing written', async () => {
  const dir = join(WORK, 'one');
  const before = readFileSync(join(dir, REPORT_FILE));
  const r = await scan(['--yes', '--report', '--out', join(dir, 'another-policy')]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /^ReviewFileOccupied: /);
  assert.ok(!existsSync(join(dir, 'another-policy')), 'the policy was written before the refusal');
  assert.ok(readFileSync(join(dir, REPORT_FILE)).equals(before));
});

/** The page's text with every tag removed: what a reader sees, not how it is set. */
const plain = (html: string): string => html.replace(/<[^>]+>/g, '');
const count = (html: string, needle: string): number => html.split(needle).length - 1;

/**
 * What ACP-454 added, on any report: the logo once, the call to action at the
 * top and at the bottom, every section's two paragraphs, and still nothing
 * that loads or runs.
 */
function assertPresentation(html: string): void {
  const root = ZIFFER_LOGO_SVG.slice(0, ZIFFER_LOGO_SVG.indexOf('>') + 1);
  assert.equal(count(html, root), 1, 'the logo\'s root element is not there exactly once');
  assert.equal(count(html, '<svg'), 1, 'a second svg');
  assert.ok(count(html, `href="${REVIEW_URL}"`) >= 2, 'the review link is not there at least twice');
  assert.ok(count(html, `${CTA_TEXT} &#8594;</a>`) >= 2, 'the call to action is not there at least twice');
  assert.ok(html.includes(`Attach <code>${ARCHIVE_FILE}</code> to the email from that page.`), 'the archive is not in the call to action');
  assert.ok(plain(html).includes('Then add the ZIFFER MCP server, @ziffer-io/mcp, to the AI agent you code with.'), 'the MCP next step');
  for (const [key, e] of Object.entries(EXPLAIN)) {
    assert.ok(html.includes(`<span class="label">What this means</span>${e.means}</p>`), `${key}: no "What this means"`);
    assert.ok(html.includes(`<span class="label">What to do</span>${e.todo}</p>`), `${key}: no "What to do"`);
  }
  assert.ok(!/<img|\ssrc=|<script/i.test(html), 'the report can fetch or run something');
  for (const secret of SECRETS) assert.ok(!html.includes(secret), `the report carries ${secret}`);
}

const POLICY_FILES = [
  { path: 'floors.json', text: '{"floors": {"mail": "T3"}}' },
  { path: 'reversibility.json', text: '{"reversibility": {"delete_email": "IRREVERSIBLE"}}' },
  { path: 'risk_functions.json', text: '{"risk_functions": [{"applies_to": "delete_email", "base": "HIGH", "raise_to": []}]}' },
  { path: 'notice_targets.json', text: '{"notice_targets": {"delete_email": ["developer"]}}' },
  { path: 'attesters/registry.json', text: '{"quorum_k": 2, "attesters": {"approver-1": {}, "approver-2": {}}}' },
  { path: 'receipt_identity.json', text: '{"name": "scan-demo-receipt-key"}' },
];

test('the renderer escapes every name, shows the dossier status words, and says so when there is no replay', () => {
  const hostile = {
    ...FIXTURE,
    catalog: FIXTURE.catalog.map((c, i) => (i === 2 ? { ...c, tool: '<img src=x onerror=alert(1)>' } : c)),
    classifications: FIXTURE.classifications.map((c) => (c.tool === 'delete_email' ? { ...c, tool: '<img src=x onerror=alert(1)>' } : c)),
    findings: attachControls(FIXTURE.findings),
  };
  const html = renderReportHtml(hostile, undefined, {
    machine: 'build-host',
    homes: [],
    policy: { files: POLICY_FILES, treeHash: 'sha256:00', tenantId: 'ten_demo_00', unclassified: [] },
    words: loadReplayData().words,
  });
  assert.ok(!html.includes('<img'), 'a tool name reached the page as markup');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('<dd>build-host</dd>'));
  assert.ok(html.includes('The replay was not run'));
  // Every control reference is printed with a status word from the dossier.
  const refs = hostile.findings.flatMap((f) => f.controls);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    const line = `${ref.framework} <span class="mono">${ref.clause}</span>: <span class="st st-`;
    const at = html.indexOf(line);
    assert.ok(at >= 0, `${ref.framework} ${ref.clause} is not cited`);
    assert.ok(html.slice(at).split('\n')[0]?.includes(`">${statusWords(ref)}</span>`), `${ref.clause}: not "${statusWords(ref)}"`);
  }
});

const CTX = {
  machine: 'build-host',
  homes: [],
  policy: { files: POLICY_FILES, treeHash: 'sha256:00', tenantId: 'ten_demo_00', unclassified: [] },
  words: loadReplayData().words,
};

test('the summary counts the fixture in three sentences, and every section explains itself', () => {
  const html = renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, undefined, CTX);
  assertPresentation(html);
  const text = plain(html);
  for (const sentence of [
    '4 tool servers, 8 tools reachable from 3 AI agent clients.',
    '2 can do damage that cannot be undone, and nobody is asked.',
    'The replay was not run, so no outcome under the draft policy is shown.',
  ]) {
    assert.ok(text.includes(sentence), `the summary lacks "${sentence}"`);
  }
  // The executive summary comes first; the technical report's own summary comes before its first section.
  assert.ok(html.indexOf('id="executive-summary"') < html.indexOf('class="summary"'), 'the executive summary is not first');
  assert.ok(html.indexOf('class="summary"') < html.indexOf('<h2>What your AI coding agents can reach'), 'the summary is not at the top of the technical report');
  // The flags are words, not field names.
  assert.ok(html.includes('sends data off this machine') || html.includes('reads input an attacker can write') || html.includes('>none<'));
  assert.ok(!/<td>egress|untrusted input/.test(html), 'a flag is still a field name');
});

test('the why column exists exactly when the classifier gave a reason', () => {
  const reason = 'description says "Permanently delete"';
  const withReason = {
    ...FIXTURE,
    classifications: FIXTURE.classifications.map((c) => (c.tool === 'delete_email' ? { ...c, reason } : c)),
  };
  const html = renderReportHtml(withReason, undefined, CTX);
  assert.ok(html.includes('<th>why</th>'), 'no why column');
  assert.ok(html.includes('description says &quot;Permanently delete&quot;'), 'the reason is not shown, escaped');
  const without = renderReportHtml(FIXTURE, undefined, CTX);
  assert.ok(!without.includes('<th>why</th>'), 'a why column with nothing in it');
});

/** A replay as a real machine produces it: every harness case names a tool this machine lacks. */
function grammarReplay(): ReplayResult {
  const data = loadReplayData();
  const rows: ReplayRow[] = Array.from({ length: 8 }, (_, i) => ({
    id: `fx-0${i + 1}`,
    subset: 'agent',
    behaviour: 'exfiltrate',
    injection: 'hidden text in a shared document',
    tool: 'transfer_funds',
    resource: 'acct:1',
    without_policy: WITHOUT_POLICY,
    proposal: null,
    outcome: { kind: 'refused', stage: 'grammar', clause: 'V-11', message: 'no such verb: transfer_funds' },
  }));
  return {
    first_line: UNSIGNED_DEMO_LINE,
    run: { fingerprint: 'sha256:0123456789abcdef', tenant_id: 'ten_demo_00', policy_bundle_hash: 'sha256:00', now: 0, receipt_key: { classical: '', pq: '' } },
    provenance: { cases: data.caseProvenance, bundle: data.bundle.provenance },
    quorum_k: 2,
    rows,
    own: {
      server: 'database',
      tool: 'execute_sql_2',
      original_name: 'execute-sql',
      without: 'executes',
      label: OWN_LABEL,
      outcome: {
        kind: 'held',
        risk: 'HIGH',
        reversibility: 'IRREVERSIBLE',
        rule_id: 'r1',
        rule_ids: ['r1'],
        awaits: { k: 2, required_roles: [], risk: 'HIGH', proposal_hash: 'sha256:01', policy_bundle_hash: 'sha256:00' },
      },
    },
  };
}

test('every harness case refused before grading: the summary says so, and names the own tool by the name it lists', () => {
  const html = renderReportHtml(FIXTURE, grammarReplay(), CTX);
  const sentence =
    'Under the draft policy: the 8 harness cases are refused before grading (their tools are not on this machine); ' +
    'your own tool, database \u00b7 execute-sql, is HELD until 2 approvers sign.';
  assert.ok(plain(html).includes(sentence), `the summary lacks "${sentence}"`);
  assert.ok(!plain(html).includes('0 refused'), 'the counts sentence was printed');
  const summary = html.slice(html.indexOf('class="summary"'), html.indexOf('</section>'));
  assert.ok(!summary.includes('execute_sql_2'), 'the summary names the normalised key');
});

test('INFO findings are one table of rows under "Lower findings", never cards', () => {
  const info: Finding[] = Array.from({ length: 18 }, (_, i) => ({
    id: `egress:tool_${i}`,
    kind: 'egress',
    severity: 'info',
    tools: [`tool_${i}`],
    client: 'Claude Code',
    message: 'reads untrusted input, can send data out',
    controls: [],
  }));
  const high = FIXTURE.findings.filter((f) => f.severity !== 'info');
  const html = renderReportHtml({ ...FIXTURE, findings: attachControls([...high, ...info]) }, undefined, CTX);
  assert.ok(html.includes('<h3 class="lower">Lower findings (18)</h3>'), 'no Lower findings heading');
  const at = html.indexOf('<h3 class="lower">');
  const lower = html.slice(at, html.indexOf('</table>', at));
  assert.equal(count(lower, '<table>'), 1, 'not one table');
  assert.equal(count(lower, '<tr>') - 1, 18, 'not one row per INFO finding');
  assert.equal(count(html, 'class="sev sev-info"'), 0, 'an INFO finding is still a card');
  assert.equal(count(html, '<div class="finding">'), high.length, 'the HIGH and WARN cards');
});

test('one server configured in three clients is one row naming the three, and counts once', () => {
  const one = (client: string, tool: string): CatalogTool => ({
    client,
    server: 'code-review-graph',
    tool,
    description: `The ${tool} tool.`,
    params: ['q'],
    source_path: `~/.${client.toLowerCase().replace(/ /g, '')}/mcp.json`,
  });
  const catalog = ['Cursor', 'VS Code', 'Claude Code'].flatMap((c) => [one(c, 'query_graph'), one(c, 'build_graph')]);
  const html = renderReportHtml({ ...FIXTURE, catalog, classifications: [], findings: [] }, undefined, CTX);
  const reach = html.slice(html.indexOf('<h2>What your AI coding agents can reach'), html.indexOf('<h2>What can do damage'));
  assert.equal(count(reach, '<span class="nw">code-review-graph</span>'), 1, 'the server is not one row');
  assert.ok(plain(reach).includes('3 AI agent clients: Cursor, VS Code, Claude Code'), 'the row does not name the three clients');
  assert.ok(plain(html).includes('1 tool server, 2 tools reachable from 3 AI agent clients.'), 'the summary counts rows, not servers');
});

test('homeless shows every home from ~, the longest first', () => {
  assert.equal(homeless('/Users/a/b/x and /Users/a/y', ['/Users/a', '/Users/a/b']), '~/x and ~/y');
  assert.equal(homeless('/Users/a/x', ['/Users/a/']), '~/x');
});

// ---------------------------------------------------------------------------
// ACP-455 `--code`: the application's tools, first, and the insertion card.
// ---------------------------------------------------------------------------

const CODE_SDKS: CodeSdkEntry[] = [
  { id: 'ai', framework: 'Vercel AI SDK', rows: ['Vercel AI SDK'], language: ['TS'], packages: ['ai'], covered: 'milestone-1', kind: 'framework' },
  { id: 'anthropic', framework: 'Anthropic SDK', rows: ['Anthropic SDK'], language: ['TS'], packages: ['@anthropic-ai/sdk'], covered: 'milestone-1', kind: 'framework' },
  { id: 'openai', framework: 'OpenAI SDK', rows: ['OpenAI SDK'], language: ['TS'], packages: ['openai'], covered: 'milestone-1', kind: 'framework' },
  { id: 'gemini', framework: 'Google Gen AI SDK', rows: ['Google Gen AI SDK'], language: ['TS'], packages: ['@google/genai'], covered: 'milestone-1', kind: 'framework' },
  { id: 'llamaindex', framework: 'LlamaIndex', rows: ['LlamaIndex'], language: ['TS'], packages: ['llamaindex'], covered: 'not-yet', kind: 'framework' },
];
const CODE_CTX = { ...CTX, codeSdks: CODE_SDKS };
const CODE_ONLY_RESULT = { ...FIXTURE, clients_scanned: [], clients_not_covered: [], catalog: [], classifications: [], findings: [], code: CODE };

/** The `<tbody>` rows of the table right after `marker`. */
function rowsAfter(html: string, marker: string): string[] {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `no ${marker}`);
  const body = html.slice(html.indexOf('<tbody>', at), html.indexOf('</tbody>', at));
  return body.split(/<tr(?: [^>]*)?>/).slice(1);
}

test('without --code the HTML is pinned and carries no script', () => {
  const html = renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, undefined, CTX);
  // Repinned by ACP-455 exec (was d769dfb1… from 74ada3f, 0.2.4): the executive summary first, its styles,
  // the technical report's title moved under the divider as an h2, the MITRE ATLAS table before the replay,
  // and the review booking first in Next.
  // Repinned by ACP-455's second review (was aa69462d…): the headline says the reading is a name or description
  // to confirm; the regulation block opens with the sector sentence, shows built or partial rows only and never
  // EU AI Act Art. 14(5) or DORA Art. 11(1); the LLM08 row is gone and LLM06 carries its 2025 id; the threat
  // table's column is one plain "With ZIFFER:" sentence per technique; the "What ZIFFER changes" lines are true
  // only once ZIFFER is in place and say so; the today line says the scan does not see who is asked.
  // Repinned by ACP-455's third review (was 757cbfb1…): the regulation block opens with "depends on your sector
  // and, for the EU AI Act, on what your system is used for"; the second and third "What ZIFFER changes" lines
  // start "From then on", so each reads as true only once ZIFFER is in place; the today line says what is true
  // ("unless a check in your application asks a person first") in place of "the scan does not see whether
  // anything does", and the held line starts "Once ZIFFER is in place, under the draft policy".
  // Repinned by ACP-455's second design (2026-09-28, was cae5a21b…): the page without --code is the same product as
  // the --code page: the two type families embedded as base64 @font-face sources (so the CSP adds `font-src data:`
  // and nothing wider), the font stacks naming them, the palette's tokens set to the approved design's values, and
  // the same masthead (the logo and one mono line: what this is, the machine, the day, the scan's version) in place
  // of the old logo row. Nothing it says changed.
  // Repinned by ACP-455's third design (2026-09-28, was 97c7ce83…): the same nav as the --code page (logo, machine,
  // day, the pill button; the scan's version stays in the footer), full-width bands alternating paper and white,
  // tables in cards, the summary in the dark card, the palette's tokens set to the third design's, dark text on
  // every orange ground (WCAG AA), and the technical divider as the --code page's (its em dash is gone). Nothing it
  // says changed; it still carries no script.
  // Repinned by ACP-460's OWASP correction (2026-09-28, was d7fddb9c…): Excessive Agency is cited as LLM03:2026, the
  // current edition's id and title from owasp.ts, and one sentence under the threats table says the edition, its date,
  // the 2025 number, and the two prevention strategies a check before each tool call answers. Nothing else changed.
  // Repinned by ACP-464 (was 5ed0aa5b…): the MCP link points at the guide's real heading, #10-the-mcp-assisted-path;
  // the page with #9 put back hashes to the old pin, so that link is the only change.
  assert.equal(createHash('sha256').update(html).digest('hex'), 'b01d37a5b40d7c188e7b5c894d583d34cead45bddb5b6f3263ada1db48bc45a7');
  assert.ok(html.includes('@font-face{font-family:"Schibsted Grotesk";src:url(data:font/woff2;base64,') && html.includes('<header class="mast">'), 'the same fonts and masthead as the --code page');
  assert.ok(!html.includes('<script'));
});

/**
 * The draft a `--code` run writes, for the fixture's nine tools and the MCP
 * fixture's installed ones: the members the proposed-policy section reads,
 * with the sidecar that names each tool's key and server. `update_note` has
 * no reversibility entry and `delete_gbp_post` no risk function, as a real
 * draft leaves them, so the section has something to mark "confirm".
 */
const CODE_TOOLS = CODE.verdicts.map((v) => v.tool.name);
const MCP_TOOLS = [...new Set(FIXTURE.catalog.map((c) => `${c.server}/${c.tool}`))];
const json = (v: unknown): string => JSON.stringify(v);
const CODE_POLICY_FILES = [
  {
    path: 'floors.json',
    text: json({ floors: { ...Object.fromEntries(CODE_TOOLS.map((n) => [`application_${n}`, n.startsWith('get') || n.startsWith('list') ? 'T0' : 'T3'])), mail: 'T3', github: 'T3', web: 'T2', notes: 'T0' } }),
  },
  {
    path: 'reversibility.json',
    text: json({
      reversibility: {
        cancel_reservation: 'IRREVERSIBLE', refund_payment: 'IRREVERSIBLE', send_guest_message: 'IRREVERSIBLE', add_charge: 'REVERSIBLE',
        get_property: 'REVERSIBLE', list_reservations: 'REVERSIBLE', update_rate_plan: 'REVERSIBLE', delete_email: 'IRREVERSIBLE', read_email: 'REVERSIBLE',
      },
    }),
  },
  {
    path: 'risk_functions.json',
    text: json({
      risk_functions: [
        ...CODE_TOOLS.filter((n) => n !== 'delete_gbp_post').map((n) => ({
          applies_to: n,
          base: ['cancel_reservation', 'refund_payment', 'add_charge'].includes(n) ? 'HIGH' : n === 'update_note' || n === 'send_guest_message' ? 'MEDIUM' : 'LOW',
          raise_to: n === 'update_note' ? [{ if: 'resource.effective_tier >= T2', then: 'HIGH' }] : [],
        })),
        { applies_to: 'delete_email', base: 'HIGH', raise_to: [] },
        { applies_to: 'read_email', base: 'LOW', raise_to: [] },
      ],
    }),
  },
  { path: 'notice_targets.json', text: json({ notice_targets: { cancel_reservation: ['developer'], update_note: ['developer'], delete_email: ['developer'] } }) },
  {
    path: 'tool-names.json',
    text: json({
      tools: [
        ...CODE_TOOLS.map((n) => ({ server: `application/${n}`, tool: n, key: n })),
        ...FIXTURE.catalog.map((c) => ({ server: c.server, tool: c.tool, key: c.tool })),
      ],
      servers: { ...Object.fromEntries(CODE_TOOLS.map((n) => [`application/${n}`, `application_${n}`])), mail: 'mail', github: 'github', web: 'web', notes: 'notes' },
      collisions: [],
    }),
  },
  { path: 'attesters/registry.json', text: '{"quorum_k": 2, "attesters": {"approver-1": {}, "approver-2": {}}}' },
  { path: 'receipt_identity.json', text: '{"name": "scan-demo-receipt-key"}' },
];
const COMBINED_CTX = { ...CODE_CTX, policy: { ...CTX.policy, files: CODE_POLICY_FILES } };
/** ONE scan, ONE report: the codebase and the installed tools in one result (the default run once the CLI lands). */
const COMBINED = { ...FIXTURE, findings: attachControls(FIXTURE.findings), code: CODE };
const CODE_ONLY_CTX = COMBINED_CTX;
/** A --code result carrying the stress inventory of skills (ACP-460): both groups, each long enough to fold into its dialog. */
const SKILLS_RESULT = { ...CODE_ONLY_RESULT, code: shapedApp(STRESS), skills: [...STRESS_SKILLS] };

/** The html between an element's opening marker and the next `</section>`. */
function sectionOf(html: string, marker: string): string {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `no ${marker}`);
  return html.slice(at, html.indexOf('</section>', at));
}

test('--code: the first screen holds the headline, the grade on its scale, the door, three findings, the one call and the call to action', () => {
  // Re-pointed by ACP-455's presentation (2026-09-28): the hero's grade box, four tiles and bar became the gauge,
  // the door diagram and three findings (first.test.ts holds their order and their numbers).
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  // Re-pointed by the second design (2026-09-28): the first screen is the approved prototype's, and the
  // executive sentences below it are the section "In plain words", before the technical part.
  const first = html.slice(html.indexOf('<div class="first" id="first-screen">'), html.indexOf('<div class="rest">'));
  assert.ok(first.length > 0);
  // 88 tools, 19 marked irreversible + 12 refused: (19 + 12) / 88 = 35% -> D, one letter (nothing unlisted).
  // Re-pointed by ACP-464 item 8: one grade, today's; D is both cases here, so nothing is within reach.
  assert.ok(first.includes('aria-label="Exposure grade D"') && first.includes('data-grade-today="D"') && !first.includes('data-grade-reachable'), first.slice(0, 400));
  assert.ok(!plain(first).includes('on its own'));
  assert.ok(first.includes('<figure class="door" id="door"'));
  assert.ok(first.includes('<code id="first-call-line"><span class="kw">await</span> zifferGate(name, input);</code>'));
  assert.ok(first.includes('<div class="where">api/src/lib/agents/tools/tool-executor.ts:56</div>'), 'the call names its place');
  assert.ok(first.includes(`href="${BOOK_URL}"`) && first.includes('href="#technical"'));
  // The grade's definition and its sentence are said below the fold, not on the first screen.
  // Re-pointed by the third design (2026-09-28): "In plain words" no longer repeats the grade; its definition and
  // its sentence are said once, in "What was read, and what was not", under "Other".
  // Re-pointed by ACP-464: the grade's counts are said once, beside the grade (the headline and its lede), and the
  // card that repeated them under "Other" is gone; what each letter means stays in "What was read", folded.
  const below = sectionOf(html, '<section class="sec" id="limits">');
  assert.ok(plain(below).includes(GRADE_DEFINITION));
  assert.ok(!plain(below).includes('31 of the 88 tools (35%) count'), 'the grade sentence is said twice');
  assert.ok(plain(first).includes('19 of them cannot be undone.') && plain(first).includes('12 have no rule in the draft policy'), plain(first).slice(0, 600));
});

test('--code: the grade is the worst when every tool cannot be undone, the best when none can and every tool has a rule', () => {
  const worst: CodeSection = { ...CODE, counts: { tools: 5, held: 3, notified: 2, refused: 0, allowed: 0, irreversible: 5 } };
  const best: CodeSection = { ...CODE, counts: { tools: 5, held: 0, notified: 0, refused: 0, allowed: 5, irreversible: 0 } };
  const refusedOnly: CodeSection = { ...CODE, counts: { tools: 4, held: 0, notified: 0, refused: 4, allowed: 0, irreversible: 0 } };
  assert.equal(exposureGrade(worst)?.worst, 'F');
  assert.equal(exposureGrade(best)?.worst, 'A');
  assert.equal(exposureGrade(refusedOnly)?.best, 'F', 'a tool with no rule is never read as safe, in the best case either');
  assert.equal(exposureGrade({ ...CODE, counts: { ...best.counts, tools: 0, allowed: 0 } }), undefined);
  // Each boundary of the definition sentence, on the engine's counts alone.
  const at = (exposed: number, tools: number): string | undefined =>
    exposureGrade({ ...CODE, counts: { tools, held: 0, notified: 0, refused: 0, allowed: tools - exposed, irreversible: exposed } })?.worst;
  assert.deepEqual([at(1, 11), at(1, 10), at(1, 5), at(1, 4), at(1, 2)], ['B', 'C', 'C', 'D', 'F']);
  for (const [section, letter] of [[worst, 'F'], [best, 'A']] as const) {
    const html = renderReportHtml({ ...COMBINED, code: section }, undefined, COMBINED_CTX);
    assert.ok(html.includes(`<div class="grade" role="img" aria-label="Exposure grade ${letter}">`) && html.includes(`data-grade-today="${letter}"`), letter);
  }
});

test('--code: every ZIFFER word the page uses is in the legend, and its first use links to its definition', () => {
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  const legend = html.slice(html.indexOf('<details class="app howto"'), html.indexOf('</details>', html.indexOf('<details class="app howto"')));
  for (const term of TERMS) {
    assert.ok(legend.includes(`<div class="term-row" id="term-${term.id}"><dt>${term.word}`), `${term.id} is not in the legend`);
    assert.ok(legend.includes(`href="${term.href}"`), `${term.id}: its link`);
  }
  const used = termsUsed(html);
  assert.ok(used.length >= 6, `only ${used.length} terms are marked`);
  for (const id of used) {
    assert.ok(TERMS.some((x) => x.id === id), `${id} is used and not in the legend`);
    const first = html.indexOf(`data-term="${id}"`);
    assert.ok(html.slice(html.lastIndexOf('<', first), first).startsWith('<a class="term"'), `the first use of ${id} is not a link`);
  }
  // Tier and risk levels each get their line.
  for (const level of ['LOW', 'MEDIUM', 'HIGH', 'T0', 'T1', 'T2', 'T3']) assert.ok(legend.includes(`<th scope="row">${level}</th>`), level);
});

test('--code: every link on the page is a ZIFFER page that exists, and no clause id is shown bare', () => {
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  // ACP-455 exec: the review booking (checked 200 on 2026-09-27) is the one link off ziffer.io; the MCP
  // path's anchor was read in the page's HTML the same day.
  const allowed = new Set<string>([...Object.values(DOC), REVIEW_URL, BOOK_URL, MCP_URL]);
  const hrefs = [...html.matchAll(/href="([^"#][^"]*)"/g)].map((m) => m[1] ?? '');
  assert.ok(hrefs.length > 10);
  for (const h of hrefs) {
    assert.ok(h.startsWith('https://ziffer.io/') || h === BOOK_URL, `a link leaves ziffer.io: ${h}`);
    assert.ok(allowed.has(h), `a link that was not verified: ${h}`);
  }
  // Since the second design (2026-09-28) the --code page shows no internal clause id at all, not even as a tag:
  // each rule is said in plain words. The fixture's refused tool carries 8.4-3, so the id had a chance to show.
  assert.ok(CODE.verdicts.some((v) => v.verdict.verdict === 'REFUSED' && v.verdict.clause === '8.4-3'));
  for (const clause of ['8.4-3', 'DR-13']) assert.equal(count(plain(html.replace(/<pre[^]*?<\/pre>/g, '')), clause), 0, `${clause} is on the page`);
});

test('--code: the proposed policy lists every tool once, grouped as the table, and marks what a person should confirm', () => {
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  const policy = sectionOf(html, '<section class="sec" id="policy">');
  const listed = [...policy.matchAll(/<tr class="rule" data-tool="([^"]+)">/g)].map((m) => m[1] ?? '');
  const installed = policy.slice(policy.indexOf('id="policy-installed"'));
  const codeRows = [...policy.slice(0, policy.indexOf('id="policy-installed"')).matchAll(/<tr class="rule" data-tool="([^"]+)">/g)].map((m) => m[1] ?? '');
  assert.deepEqual([...codeRows].sort(), [...CODE_TOOLS].sort(), 'not every code tool, or one twice');
  const mcpRows = [...installed.matchAll(/<tr class="rule" data-tool="([^"]+)">/g)].map((m) => m[1] ?? '');
  assert.equal(mcpRows.length, MCP_TOOLS.length, 'not every installed tool once');
  assert.equal(listed.length, CODE_TOOLS.length + MCP_TOOLS.length);
  // Re-pointed by ACP-455's presentation: grouped by the decision each rule asks, most urgent first (first.test.ts holds the grouping).
  const order = ['ask-notified-no-entry', 'ask-refused', 'ask-reason'].map((id) => policy.indexOf(`id="${id}"`));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > (order[i - 1] ?? 0))), `groups out of order: ${order.join(',')}`);
  // Each value names the member file it is read from, linked to the section that explains it, once under the checklist.
  for (const m of ['reversibility.json', 'risk_functions.json', 'floors.json', 'notice_targets.json']) {
    assert.ok(policy.includes(`<a class="member" href="${MEMBER_DOC[m] ?? ''}" rel="noopener noreferrer"><code>${m}</code></a>`), m);
  }
  const row = (name: string): string => policy.slice(policy.indexOf(`data-tool="${name}"`), policy.indexOf('</tr>', policy.indexOf(`data-tool="${name}"`)));
  // The rules read the draft, never a guess: update_note has no reversibility entry, delete_gbp_post no risk function.
  assert.ok(row('update_note').includes('no entry') && row('update_note').includes('MEDIUM, HIGH at tier T2 or above') && row('update_note').includes('can it be undone? if not, raise to HIGH'), row('update_note'));
  assert.ok(row('delete_gbp_post').includes('>none<') && row('delete_gbp_post').includes('write a rule'), row('delete_gbp_post'));
  assert.ok(row('cancel_reservation').includes('>no<') && row('cancel_reservation').includes('HIGH') && row('cancel_reservation').includes('>T3<'.replace(/[<>]/g, '')) && row('cancel_reservation').includes('check the reading'));
  assert.ok(!row('get_property').includes('class="ck"'), 'a plain read is marked to confirm');
  // Each kind of confirmation is explained once per group, not once per tool.
  assert.equal(count(policy, 'raise its risk to HIGH in'), 1);
});

test('--code on one scan with installed tools: the codebase, the call to action, the policy, the installed tools, the legend, the limits', () => {
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  const at = (s: string): number => html.indexOf(s);
  // Re-pointed by ACP-455's presentation: scope and limits first in the technical part, the appendix last.
  // Re-pointed by ACP-464: who is asked, then where ZIFFER goes, then what was read; the limits are no longer the first wall.
  const order = [
    '<div class="first" id="first-screen">',
    '<p class="eyebrow">In plain words</p>',
    '<section class="sec" id="entries">',
    '<section class="sec" id="insertion">',
    '<h2>What was read, and what was not.',
    '<h3>How your code gives tools to a model</h3>',
    '<h2>The draft policy, as a checklist.',
    '<h2>Tools installed in your AI assistants.',
    '<span id="how-to-read">',
    '<button class="appx" type="button" id="appendix"',
    '<h2>Next</h2>',
  ].map(at);
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > (order[i - 1] ?? 0))), `out of order: ${order.join(',')}`);
  // The installed tools' sections sit under their h2, folded, after the same tiles as the code half.
  assert.ok(at('<details class="inner more"><summary>What your AI coding agents can reach</summary>') > at('<h2>Tools installed in your AI assistants.'));
  const installed = sectionOf(html, '<section class="sec" id="installed">');
  const tiles = installed.slice(installed.indexOf('<div class="limits">'), installed.indexOf('</div></div>', installed.indexOf('<div class="limits">')));
  assert.equal(count(tiles, '<div><b>'), 4);
  for (const label of ['tool servers', 'tools an AI assistant can call', 'cannot be undone', 'HIGH findings']) assert.ok(tiles.includes(`<span>${label}`), label);
  assert.ok(installed.includes('<details class="inner more"><summary>Findings'), 'the findings are not folded');
  // The policy's groups are folded except the first, each with its count and one-line rule in view.
  const policy = sectionOf(html, '<section class="sec" id="policy">');
  // The checklist's groups are open, each headed by its question and count; the rules that ask nothing are folded.
  assert.ok(/<div class="q ask-notified-no-entry" id="ask-notified-no-entry"><div class="q-h"><h3 class="ask-q">Can it be undone\? If not, should a person approve it first\?<\/h3><span class="c count" data-count="1">1 row<\/span><\/div>/.test(policy), policy.slice(0, 600));
  assert.ok(policy.includes('<details class="inner ask-none" id="ask-none">'));
  assert.ok(!html.includes('<h2>What your AI coding agents can reach'));
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) assert.ok((levels[i] ?? 0) <= (levels[i - 1] ?? 0) + 1, `a heading skips a level at #${i}: ${levels.slice(0, i + 1).join(',')}`);
  // No raw member tables on the --code page: the policy is read as rules.
  assert.ok(!html.includes('<h3>Floors: the lowest tier each server is held to</h3>'));
});

test('--code: the application section maps the customer\'s own code: call sites, routes, the one function, the folders', () => {
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  const app = html.slice(html.indexOf('<div id="application">'), html.indexOf('</section>', html.indexOf('<div id="application">')));
  const text = plain(app).replace(/\s+/g, ' ');
  assert.ok(text.includes('example-platform defines 88 tools for a model in 412 files, through its own defineTool() helper.'), text.slice(0, 300));
  assert.ok(text.includes("The engine's verdict is listed here for 9 of the 88 tools.") || text.includes('The engine&#39;s verdict is listed here for 9 of the 88 tools.'));
  assert.ok(app.includes('<code>dynamicTool() in a loop</code>') && app.includes('api/src/lib/orchestrator/tool-bridge.ts:305'));
  assert.ok(text.includes('Which tools a call gets is decided at runtime by getToolsForLocation'));
  assert.ok(app.includes('<code>executeTool(name, input, ctx, abortSignal)</code>') && app.includes('<code>await zifferGate(name, input);</code>'));
  assert.ok(text.includes('Your tools live in 1 folder') && text.includes('api/src/lib/agents/tools/handlers/'));
  // The callers are said where the call is pasted (step 2 of "Put ZIFFER in place").
  const steps = sectionOf(html, '<section class="sec" id="insertion">');
  for (const c of ['api/src/lib/orchestrator/tool-bridge.ts:334', 'api/src/routes/console/lodging-veo.ts:1262']) assert.ok(steps.includes(c), c);
  // The frameworks come before this block in section 01, never inside it.
  assert.ok(!app.includes('Frameworks found in your dependencies'));
  // The technical definition phrase is kept, in the table, which is the appendix now (ACP-455 presentation).
  // Re-pointed by the third design (2026-09-28): the appendix is a card that opens a dialog holding every tool.
  const appendix = html.slice(html.indexOf('<dialog id="m-appendix"'), html.indexOf('</dialog>', html.indexOf('<dialog id="m-appendix"')));
  assert.ok(appendix.includes('Every tool below is defined through <code>defineTool() (app-local factory, returns an Anthropic Tool input schema)</code>'));
  assert.ok(app.includes('<a href="#appendix">the appendix</a>'));
  // The table: complete, the four groups in order, each group's shared sentence said once in its label row.
  const rows = rowsAfter(appendix, '<table class="r tools">');
  assert.deepEqual(
    rows.map((r) => /<code class="tn">([^<]+)<\/code>/.exec(r)?.[1] ?? /<td colspan="\d+"><b>([^<(]+)\(/.exec(r)?.[1]?.trim()),
    [
      GROUP_LABEL.held, 'cancel_reservation', 'refund_payment', 'send_guest_message', 'add_charge',
      GROUP_LABEL.notified, 'update_note',
      GROUP_LABEL.refused, 'delete_gbp_post',
      GROUP_LABEL.allowed, 'get_property', 'list_reservations', 'update_rate_plan',
    ],
  );
  assert.equal(count(appendix, 'held for a human before it runs'), 1, 'the held sentence is repeated per row');
  assert.ok(rows[5]?.includes('runs after a notice to the notice addressee; nobody is asked first'), 'the notified group says its sentence');
  const refusedRow = rows.find((r) => r.includes('>delete_gbp_post<')) ?? '';
  assert.ok(refusedRow.includes('no risk function applies to this task type') && !refusedRow.includes('8.4-3'), 'the refusal in plain words, no clause id');
  // Long descriptions are shown whole in the folded appendix, never truncated.
  for (const v of CODE.verdicts) assert.ok(appendix.includes(v.tool.description), `${v.tool.name}: description cut`);
});

test('--code: the insertion card names the function and its callers, carries the module and the one line escaped, four steps, and what happens after', () => {
  const html = renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX);
  // Re-pointed by the second design (2026-09-28): "Put ZIFFER in place", numbered steps, the code the full width of the column.
  const card = sectionOf(html, '<section class="sec" id="insertion">');
  assert.ok(card.includes(CODE.insertion.sentence));
  // Re-pointed by the third design (2026-09-28): each step a row, its badge and heading on the left, its code on the right, where it goes under the code.
  assert.ok(card.includes('<h3>Add one line at the top of executeTool</h3>'));
  assert.ok(card.includes('<p class="say">At the top of <code>executeTool(name, input, ctx, abortSignal)</code> (<code>api/src/lib/agents/tools/tool-executor.ts:56</code>).'));
  // The callers are not all "human-confirmed": the per-entry reading can find one with no check (ACP-455, 2026-09-28).
  assert.ok(card.includes('Its 3 callers, whichever path the call comes from: '));
  assert.ok(!html.includes('human-confirmed'));
  for (const c of ['api/src/lib/orchestrator/tool-bridge.ts:334', 'api/src/routes/console/lodging-veo.ts:1262', 'api/src/lib/agents/decorators/prospector-decision-logger.ts:67']) {
    assert.ok(card.includes(`<code>${c}</code>`), c);
  }
  // The module, escaped: its `<`, `&&` and quotes reach the page as text, never as markup.
  assert.ok(card.includes('Record&lt;string, unknown&gt;') && card.includes('&amp;&amp;') && !card.includes('Record<string'));
  assert.ok(card.includes(`<h3>Save the gate module</h3><p>As <code>${GATE_FILE}</code> beside <code>tool-executor.ts</code>.`));
  assert.ok(card.includes('<pre><code id="ziffer-call"><span class="k">await</span> zifferGate(name, input);</code></pre>'));
  // Every tool runs through the dispatcher here, so no per-tool step; naming the approvers is work the draft leaves.
  // A step with no card carries `compact` (2026-09-28): both forms are counted.
  assert.equal(count(card, '<li class="step"') + count(card, '<li class="step compact"'), 4, 'not four steps');
  assert.deepEqual([...card.matchAll(/<span class="badge">Step (\d)<\/span>/g)].map((m) => m[1]), ['1', '2', '3', '4']);
  assert.ok(!card.includes('Add the same call at the top of'), 'a per-tool step when every tool goes through the dispatcher');
  assert.ok(card.indexOf('Save the gate module') < card.indexOf('Add one line') && card.indexOf('Add one line') < card.indexOf('Name your approvers') && card.indexOf('Name your approvers') < card.indexOf('Review and sign the draft policy') && card.indexOf('Review and sign') < card.indexOf(`<code>${ARCHIVE_FILE}</code>`));
  // The module in full, the full width of the column, its first lines in view and the rest under "Show all N lines".
  const lines = CODE.insertion.snippet.split('\n').length;
  assert.ok(card.includes(`<div class="code"><div class="bar"><span><b>${GATE_FILE}</b> · TypeScript · ${lines} lines</span><button class="copy" type="button" data-copy-from="ziffer-snippet">Copy</button></div>`));
  // "Show all N lines" opens the whole module in a dialog with its own Copy button; the module is in the page once.
  assert.ok(card.includes(`<button class="more" type="button" data-open="m-ziffer-snippet">Show all ${lines} lines</button>`));
  assert.ok(card.includes('<dialog id="m-ziffer-snippet" class="code"'));
  assert.equal(count(html, 'id="ziffer-snippet"'), 1);
  assert.ok(card.includes(`href="${REVIEW_URL}"`));
  for (const s of AFTER_PASTE) assert.ok(card.includes(s), s);
  assert.ok(card.includes(`href="${DOC.sdkShape}"`));
  // Changed by the report's owner (2026-09-28, third design): the copy buttons are back, with the one script
  // the CSP allows by its hash; every button is one of the four kinds that script serves.
  for (const b of html.matchAll(/<button class="([a-z]+)"/g)) assert.ok(['copy', 'more', 'morebtn', 'appx', 'x'].includes(b[1] ?? ''), b[1]);
  assert.equal(count(html, '<script'), 1);
  assert.ok(html.includes(`script-src ${scriptHash()}`));
  assert.ok(!/<img|<link|<iframe|\ssrc=|url\((?!data:font\/woff2;base64,)/i.test(html), 'the report can fetch something');
  // A result made before `call`: the snippet is the whole paste.
  const noCall = { ...CODE.insertion };
  Reflect.deleteProperty(noCall, 'call');
  const older = renderReportHtml({ ...CODE_ONLY_RESULT, code: { ...CODE, insertion: noCall } }, undefined, CODE_ONLY_CTX);
  assert.ok(older.includes('<h3>Paste this at the top of executeTool</h3>') && !older.includes('ziffer-call'));
});

test('--code: the frameworks found say covered or not, and what the scan did not see is listed', () => {
  const html = renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX);
  assert.ok(plain(sectionOf(html, '<section class="sec" id="limits">')).includes('A syntax-only reading of the same files finds 2 tools and misses 86'));
  const list = html.slice(html.indexOf('Frameworks found in your dependencies'), html.indexOf('</details>', html.indexOf('Frameworks found in your dependencies')));
  const status = (name: string): string | undefined => list.split('<tr>').find((r) => r.startsWith(`<td><code>${name}</code>`));
  for (const n of ['ai', '@anthropic-ai/sdk', 'openai', '@google/genai']) assert.ok(status(n)?.includes(COVERED), n);
  for (const n of ['@ai-sdk/anthropic', 'llamaindex', 'zod']) assert.ok(status(n)?.includes(NOT_READ_YET), n);
  const text = plain(html).replace(/\s+/g, ' ');
  for (const l of CODE.catalog.not_seen) assert.ok(text.includes(l), l);
  // What the ways of finding a skill do not see (ACP-460): each sentence, under the heading it answers, once the result carries skills.
  const withSkills = sectionOf(renderReportHtml(SKILLS_RESULT, undefined, CODE_ONLY_CTX), '<section class="sec" id="limits">');
  for (const l of SKILL_LIMITS) {
    const col = withSkills.slice(withSkills.indexOf(`data-group="${l.group}"`));
    assert.ok(plain(col.slice(0, col.indexOf('</div>'))).includes(l.text), `${l.group}: ${l.text}`);
  }
  for (const l of SKILL_LIMITS) assert.ok(!text.includes(l.text), `said with no skills read: ${l.text}`);
  assert.ok(text.includes('3 declared frameworks are not read by this scan yet: @ai-sdk/anthropic, llamaindex and zod.'));
});

test('--code: the framework tile is about this application, and the expander lists every framework the scanner reads, by language, from the table (ACP-455, 2026-09-28)', () => {
  const html = renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX);
  const limits = plain(sectionOf(html, '<section class="sec" id="limits">')).replace(/\s+/g, ' ');
  assert.ok(limits.includes('tool-calling frameworks declared in this application’s dependencies are read by this scan'), 'the tile does not name this application');
  const fw = html.slice(html.indexOf('Frameworks found in your dependencies'), html.indexOf('</details>', html.indexOf('Frameworks found in your dependencies')));
  const text = plain(fw).replace(/\s+/g, ' ');
  assert.ok(text.includes('The table above is this application. The scan itself reads these frameworks, by the language they are written in:'), text);
  assert.ok(text.includes('TypeScript and JavaScript: Vercel AI SDK, Anthropic SDK, OpenAI SDK, Google Gen AI SDK.'), text);
  assert.ok(text.includes('Listed, and not read by this scan yet: LlamaIndex.'), text);
  // From the package's own table every framework is read: no "not read" sentence, and the three groups.
  const own = plain(renderReportHtml(CODE_ONLY_RESULT, undefined, { ...CODE_ONLY_CTX, codeSdks: loadCodeSdks() })).replace(/\s+/g, ' ');
  assert.ok(!own.includes('not read by this scan yet'), 'a framework is said to be unread');
  for (const g of ['TypeScript and JavaScript: ', 'Python: ', 'Configuration files: ']) assert.ok(own.includes(g), g);
  for (const f of loadCodeSdks().filter((x) => x.kind === 'framework')) assert.ok(own.includes(f.framework), f.framework);
});

test('--code: where a check can stand is said in plain words beside each place tools are handed to a model, and no kind code shows (ACP-455, 2026-09-28)', () => {
  const x = CODE.catalog.exposures[0];
  assert.ok(x !== undefined);
  const kinds: Exposure['interception'][] = [
    { kind: 'K1', name: 'a PreToolUse hook', present: true },
    { kind: 'K1', name: 'a toolApproval function on the model call', present: false },
    { kind: 'K2', name: 'an interrupt or the toolApproval middleware', present: false },
    { kind: 'K3', name: 'a check at the top of each tool function', present: false },
    { kind: 'K4', name: "the application's own dispatcher", present: true },
    { kind: 'K5', name: 'hosted search', present: false },
  ];
  const exposures = kinds.map((interception, i) => ({ ...x, at: { ...x.at, line: 10 + i }, ...(interception === undefined ? {} : { interception }) }));
  // The scan's own notes and via phrases carry the kinds in shorthand; the page says them without it.
  const not_seen = [...CODE.catalog.not_seen, '.claude/settings.json (Claude Code) registers hooks that run before the coding assistant\'s actions and can refuse them: an interception point already present (K1).', 'x.py:3 middleware= on the tool: a per-tool interception slot, K1-shaped)'];
  const tools = CODE.catalog.tools.map((tl, i) => (i === 0 ? { ...tl, via: `${tl.via} (no pre-call hook, K3: wrap the function)` } : tl));
  const html = renderReportHtml({ ...CODE_ONLY_RESULT, code: { ...CODE, verdicts: CODE.verdicts.map((v) => (v.tool.name === tools[0]?.name ? { ...v, tool: { ...v.tool, via: tools[0]?.via ?? v.tool.via } } : v)), catalog: { ...CODE.catalog, exposures, not_seen, tools } } }, undefined, CODE_ONLY_CTX);
  assert.ok(plain(html).includes('an interception point already present.'), 'the hook line is not on the page');
  const app = plain(html.slice(html.indexOf('<div id="application">'), html.indexOf('</div>', html.indexOf('<div id="application">')))).replace(/\s+/g, ' ');
  for (const said of [
    'The framework has its own step that runs before a tool and can refuse it (a PreToolUse hook), and this code uses it.',
    'The framework has its own step that runs before a tool and can refuse it (a toolApproval function on the model call), and this code does not use it.',
    'The framework can stop and wait for an approval before a tool runs (an interrupt or the toolApproval middleware), and this code does not use it.',
    'The framework runs these tools itself and has no step that can refuse one: a check stands at the top of each tool’s own function.',
    'The SDK runs nothing: your own code runs each tool the model asks for, and a check stands there.',
    'The provider runs these tools on its own servers: nothing in your code can stop one call, only whether the tool is offered at all.',
  ]) assert.ok(app.includes(said), said);
  assert.ok(!/\bK[1-5]\b/.test(plain(html.replace(/<pre[^]*?<\/pre>/g, ''))), 'a kind code is on the page');
});

test('--code with no MCP configuration: no empty installed-tools section, no empty replay, and the policy and the call to action stay', () => {
  const html = renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX);
  for (const absent of ['Tools installed in your AI assistants', 'What your AI coding agents can reach', 'What can do damage that cannot be undone', 'Findings', 'What this scan could not see<', 'No AI agent client on this machine', '<h2>Replay', 'The replay was not run']) {
    assert.ok(!html.includes(absent), `a code-only report carries "${absent}"`);
  }
  for (const kept of ['<h2>The draft policy, as a checklist.', 'Placeholders to replace before this policy is used', `${CTA_TEXT} &#8594;</a>`, '<section class="sec" id="insertion">']) assert.ok(html.includes(kept), kept);
});

test('one scan: a half that did not run is said in its place, never left as an empty section (ScanResult.scope, read structurally)', () => {
  const codeOnly = renderReportHtml({ ...CODE_ONLY_RESULT, ...{ scope: { code: 'read', installed: false } } }, undefined, CODE_ONLY_CTX);
  const installed = sectionOf(codeOnly, '<section class="sec" id="installed">');
  assert.ok(installed.includes('<h2>Tools installed in your AI assistants.</h2>') && installed.includes('Not scanned: this report covers your code only. Run npx @ziffer-io/scan in this folder to add the tools installed in your AI assistants.'), installed);
  // Without the field (a result made before it), a code-only page carries no installed section at all.
  assert.ok(!renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX).includes('id="installed"'));
  for (const [why, sentence] of [
    ['skipped-flag', 'Your application’s code was not scanned: this report covers only the tools installed in your AI assistants. Run npx @ziffer-io/scan in your project folder to add your code.'],
    ['no-codebase', 'No codebase was found in the folder scanned, so only the tools installed in your AI assistants are here.'],
  ] as const) {
    const html = renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings), ...{ scope: { code: why, installed: true } } }, undefined, CTX);
    assert.ok(html.includes(`<p class="notice">${sentence}</p>`), why);
    assert.ok(html.indexOf(sentence) < html.indexOf('<h2>What your AI coding agents can reach'), `${why}: not said up front`);
  }
});

test('--code: a tool no word classified is a drafted write marked "what does it do?", in the code half and the installed half', () => {
  const unknownCode: CodeSection = {
    ...CODE,
    verdicts: CODE.verdicts.map((v) => (v.tool.name === 'update_note' ? { ...v, draft_reason: UNCLASSIFIED_REASON } : v)),
  };
  const result = {
    ...COMBINED,
    code: unknownCode,
    classifications: FIXTURE.classifications.map((c) => (c.tool === 'read_email' ? { ...c, effect: 'write' as const, reason: UNCLASSIFIED_REASON } : c)),
  };
  const policy = sectionOf(renderReportHtml(result, undefined, COMBINED_CTX), '<section class="sec" id="policy">');
  const row = (name: string, from = 0): string => {
    const at = policy.indexOf(`data-tool="${name}"`, from);
    return policy.slice(at, policy.indexOf('</tr>', at));
  };
  assert.ok(row('update_note').includes('what does it do?'), row('update_note'));
  assert.ok(row('read_email', policy.indexOf('id="policy-installed"')).includes('what does it do?'));
  assert.ok(policy.includes('no word in the tool’s name or description says what it does'));
});

test('the grade sentence names "no rule" only when the engine refused a tool', () => {
  const none = exposureGrade({ ...CODE, counts: { tools: 5, held: 3, notified: 2, refused: 0, allowed: 0, irreversible: 5 } });
  const some = exposureGrade({ ...CODE, counts: { tools: 5, held: 3, notified: 0, refused: 2, allowed: 0, irreversible: 3 } });
  assert.ok(none !== undefined && some !== undefined);
  assert.equal(gradeSentence(none), '5 of the 5 tools (100%) are marked as impossible to undo by their name or description; confirm each reading.');
  assert.ok(gradeSentence(some).includes('2 have no rule in the draft policy;'));
  assert.ok(!gradeSentence(none).includes('no rule'));
  // Known and assumed irreversible are said apart (second review of the first customer's report).
  const assumed = exposureGrade({ ...CODE, verdicts: CODE.verdicts.map((v, i) => (i < 2 ? { ...v, what_ziffer_does: NOTICE_ONLY_UNLISTED } : v)), counts: { tools: 5, held: 3, notified: 2, refused: 0, allowed: 0, irreversible: 5 } });
  assert.ok(assumed !== undefined);
  assert.equal(
    gradeSentence(assumed),
    'Best case F: 3 of the 5 tools (60%) are marked as impossible to undo by their name or description; confirm each reading. ' +
      'Worst case F: 5 of the 5 (100%), also counting the 2 that change data and say nothing about undoing it. ' +
      'Classifying those 2 in reversibility.json moves the grade within this range.',
  );
});

test('--code: the policy is a checklist grouped by the decision each rule asks, most urgent first, each group its question and its count', () => {
  // ACP-455 presentation (2026-09-28): the tables were grouped by what ZIFFER does; a person reads them to decide.
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  // Re-pointed by the second design (2026-09-28): each group's first rows are in view, the rest under "N more in this group";
  // a group is read to its end (the next group, or the folded rules that ask nothing), so its count covers both.
  // Re-pointed by the third design (2026-09-28): a group's first rows are in view and "+ N more in this group"
  // opens a dialog holding the whole group. The rows in view are dropped here so that each rule is read once.
  const policy = sectionOf(html, '<section class="sec" id="policy">').replace(/<div class="card">(?:(?!<div class="card">)[^])*?<button class="morebtn"[^>]*>[^<]*<\/button><\/div>/g, '');
  const own = policy.slice(0, policy.indexOf('id="policy-installed"'));
  const rules = codeRules(CODE, COMBINED_CTX.policy.files, sortedVerdicts(CODE));
  const groups = [...own.matchAll(/<div class="q ask-([a-z-]+)" id="ask-\1"><div class="q-h"><h3 class="ask-q">([^<]+)<\/h3><span class="c count" data-count="(\d+)">\d+ rows?<\/span><\/div>([^]*?)(?=<div class="q |<details class="inner ask-none"|<p class="members)/g)];
  assert.ok(groups.length >= 3, `${groups.length} groups`);
  const kinds = groups.map((g) => g[1] ?? '');
  // Most urgent first: the order of ASK_ORDER, each kind once.
  const positions = kinds.map((k) => ASK_ORDER.findIndex((x) => x === k));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > (positions[i - 1] ?? -1))), kinds.join(','));
  for (const g of groups) {
    const kind = ASK_ORDER.find((x) => x === g[1]);
    assert.ok(kind !== undefined);
    assert.equal(g[2], ASK_QUESTION[kind], kind);
    const rows = [...(g[4] ?? '').matchAll(/<tr class="rule" data-tool="([^"]+)">/g)].map((m) => m[1] ?? '');
    assert.equal(Number(g[3]), rows.length, `${kind}: the count is not the rows`);
    // Every row in the group asks that decision, and every rule that asks it is in the group.
    const expected = rules.filter((r) => confirmKind(r) === kind).map((r) => r.verdict.tool.name);
    assert.deepEqual([...rows].sort(), [...expected].sort(), kind);
    // A visible empty box to tick on each row, drawn by CSS.
    assert.equal(count(g[4] ?? '', '<span class="box" aria-hidden="true"></span>'), rows.length);
  }
  // The rules that ask nothing are folded, last, and every code tool is on the checklist once.
  const none = own.slice(own.indexOf('<details class="inner ask-none" id="ask-none">'));
  const settled = [...none.matchAll(/<tr class="rule" data-tool="([^"]+)">/g)].map((m) => m[1] ?? '');
  assert.deepEqual([...settled].sort(), rules.filter((r) => confirmKind(r) === undefined).map((r) => r.verdict.tool.name).sort());
  assert.ok(own.indexOf('id="ask-none"') > own.lastIndexOf('<div class="q '));
  const all = [...own.matchAll(/<tr class="rule" data-tool="([^"]+)">/g)].map((m) => m[1] ?? '');
  assert.deepEqual([...all].sort(), [...CODE_TOOLS].sort());
  // The columns: the tool, the decision, then the draft's values in reader words; the files named once, under the checklist.
  assert.ok(/<thead><tr><th scope="col"><span class="sr">Done<\/span><\/th><th scope="col">Tool<\/th><th scope="col">To confirm<\/th><th scope="col">[^]*?Can it be undone\?[^]*?<\/th><th scope="col">[^]*?Risk[^]*?<\/th><th scope="col">[^]*?Tier[^]*?<\/th><th scope="col">(?:Who approves|Who is notified)<\/th><\/tr><\/thead>/.test(own));
  // A held tool waits for its approvers, any other is told after it runs: never one column for both.
  for (const table of own.split('<table class="r chk ruletable">').slice(1)) {
    const groups = new Set([...table.matchAll(/<small class="grp">(?:<a[^>]*>)?([^<]+)/g)].map((m) => m[1]));
    const head = /<th scope="col">(Who approves|Who is notified)<\/th>/.exec(table)?.[1];
    if (groups.has(GROUP_WORDS.held)) assert.ok(head === 'Who approves' && groups.size === 1, [...groups].join(','));
    else if (groups.size > 0) assert.equal(head, 'Who is notified');
  }
  assert.ok(!own.includes('Who is told'));
  assert.ok(!/<th[^>]*>[^<]*<a class="member"/.test(own), 'a file name in a column head');
  assert.equal(count(own, '<p class="members'), 1);
});

test('--code: the appendix holds every tool, in a dialog its card opens, and the first page prints alone', () => {
  // Re-pointed by the third design (2026-09-28): the appendix is a card that opens a dialog; its content is in the
  // page, shown in place when no script runs and when the page is printed.
  const html = renderReportHtml(COMBINED, undefined, COMBINED_CTX);
  const card = html.slice(html.indexOf('<button class="appx" type="button" id="appendix"'), html.indexOf('</button>', html.indexOf('<button class="appx" type="button" id="appendix"')));
  // The fixture lists 9 verdicts of 88 tools: the card says so; a complete list says "all".
  assert.ok(card.includes(`data-open="m-appendix">Appendix: ${CODE.verdicts.length} of the ${CODE.counts.tools} tools with their definitions <span>Open</span>`), card);
  const complete: CodeSection = { ...CODE, counts: { ...CODE.counts, tools: CODE.verdicts.length } };
  assert.ok(renderReportHtml({ ...COMBINED, code: complete }, undefined, COMBINED_CTX).includes(`data-open="m-appendix">Appendix: all ${CODE.verdicts.length} tools with their definitions `));
  assert.ok(html.includes('<dialog id="m-appendix"') && !/<dialog[^>]*\sopen/.test(html), 'a dialog open by default');
  assert.ok(html.indexOf('id="appendix"') > html.indexOf('<span id="how-to-read">'), 'the appendix is last');
  // Print: the first screen alone on page 1 of A4; a dialog's content is printed in place.
  assert.ok(/@media print\{[^]*?\.first\{page:cover;break-after:page/.test(html));
  assert.ok(/@page cover\{size:A4 landscape/.test(html));
  assert.ok(/@media print\{[^]*?dialog\{display:block;position:static/.test(html));
  assert.ok(html.includes('.noscript dialog{display:block;position:static') && html.includes('<html lang="en" class="noscript">'), 'without a script the dialogs are shown in place');
});

// ---------------------------------------------------------------- the third design (2026-09-28)

/** The WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}

test('contrast: every colour pair on a dark or an orange ground, and every tag, meets WCAG AA, read from the stylesheet itself', () => {
  const css = reportStyle();
  const value = (v: string): string => {
    if (v.startsWith('#')) return v;
    const m = new RegExp(`${v}:(#[0-9A-Fa-f]{6})[;}]`).exec(css);
    assert.ok(m !== null, `${v} is not a token of the stylesheet`);
    return m[1] ?? '';
  };
  assert.ok(GROUND_PAIRS.length >= 15);
  for (const p of GROUND_PAIRS) {
    const [a, b] = [luminance(value(p.fg)), luminance(value(p.bg))];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `${p.where}: ${value(p.fg)} on ${value(p.bg)} is ${ratio.toFixed(2)}:1`);
  }
  // The stylesheet writes those pairs: a literal of the list is in it, and white never sits on the orange.
  assert.ok(css.includes('#2E1604'));
  assert.ok(!/background:var\(--orange\);color:(?:#fff|#FFF|#ffffff)/.test(css), 'white text on the orange');
});

/**
 * The classes of LEFT-ALIGNED prose (ACP-464 item 6): a paragraph of these is as wide as the
 * container it sits in, so its right edge lines up with the cards and tables above and below it. A
 * centred title (`.head.c`, `.divider p`) is not prose that stops short and is not in this list.
 */
const LEFT_PROSE = ['say', 'intro', 'q-note', 'enrol', 'lede', 'lead', 'cond'] as const;

test('left-aligned prose has no max-width of its own: every paragraph fills its container, on both pages and in print (ACP-464)', () => {
  const css = reportStyle();
  // Innermost rules only: an @media block's own head is outside the braces the pattern reads.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: (m[1] ?? '').trim(), body: m[2] ?? '' }));
  assert.ok(rules.length > 100, 'the stylesheet was not read');
  const offenders: string[] = [];
  for (const r of rules) {
    const mw = /max-width:\s*([^;]+)/.exec(r.body);
    if (mw === null || (mw[1] ?? '').trim() === 'none') continue;
    for (const sel of r.sel.split(',').map((x) => x.trim())) {
      const last = sel.split(/[\s>+~]+/).at(-1) ?? '';
      const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? '');
      if (classes.some((c) => (LEFT_PROSE as readonly string[]).includes(c)) || /\.step\.compact\s+p$/.test(sel)) offenders.push(`${sel}{${r.body}}`);
    }
  }
  assert.deepEqual(offenders, [], 'a left-aligned block of prose carries a max-width of its own');
});

test('every link on the page goes somewhere in it, every button opens a dialog that exists, every Copy has its code', () => {
  for (const html of [renderReportHtml(COMBINED, undefined, COMBINED_CTX), renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX), renderReportHtml(SKILLS_RESULT, undefined, CODE_ONLY_CTX)]) {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1] ?? '');
    assert.ok(anchors.length > 0);
    for (const a of anchors) assert.ok(a !== '' && ids.has(a), `href="#${a}" has no target`);
    const opens = [...html.matchAll(/data-open="([^"]+)"/g)].map((m) => m[1] ?? '');
    assert.ok(opens.length >= 2);
    for (const o of opens) assert.ok(html.includes(`<dialog id="${o}"`), `data-open="${o}" names no dialog`);
    for (const c of html.matchAll(/data-copy-from="([^"]+)"/g)) assert.ok(new RegExp(`<code id="${c[1] ?? ''}">`).test(html), `Copy from ${c[1]}`);
    // The skills groups' own dialogs (ACP-460) are among the ones checked, when the page carries them.
    if (html.includes('id="skills-app"')) for (const d of ['m-skills-app', 'm-skills-assistant']) assert.ok(opens.includes(d), `no button opens ${d}`);
    // A dialog closes: each carries its Close button.
    assert.equal(count(html, '<dialog '), count(html, 'data-close>Close</button>'));
  }
});

test('the words "first screen" (the designers\' name for the top of the page) and the contract\'s names for a skill\'s finding reach no reader: both reports and the terminal', () => {
  const visible = (h: string): string => plain(h.replace(/<style>[^]*?<\/style>/g, '').replace(/<script>[^]*?<\/script>/g, ''));
  const said = [
    visible(renderReportHtml(COMBINED, undefined, COMBINED_CTX)),
    visible(renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX)),
    visible(renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, undefined, CTX)),
    renderTerminal(COMBINED, { full: true }),
    renderTerminal(CODE_ONLY_RESULT, { full: true }),
    visible(renderReportHtml(SKILLS_RESULT, undefined, CODE_ONLY_CTX)),
    renderTerminal(SKILLS_RESULT, { full: true }),
  ];
  for (const s of said) assert.ok(!/first[\s-]screen/i.test(s), s.slice(0, 200));
  // Nor do the contract's own names for how a skill was found and who loads it (ACP-460).
  for (const s of said) for (const w of [/\bsignals?\b/i, /found_by/, /loaded_by/, /declared_tools/, /\bhome\b/i]) assert.ok(!w.test(s), `${String(w)}: ${s.slice(0, 200)}`);
});

/** One style rule: its selectors, its declarations, its place in the sheet, and the media it sits in. */
interface SheetRule { selectors: string[]; decls: Map<string, string>; order: number; print: boolean }

/** The stylesheet's style rules in source order, `@media print` marked, `@page` and `@font-face` dropped; a screen `@media` is read as applying. */
function sheetRules(css: string): SheetRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: SheetRule[] = [];
  const close = (from: number): number => {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return i;
    }
    return text.length;
  };
  const walk = (start: number, end: number, print: boolean): void => {
    let i = start;
    while (i < end) {
      const open = text.indexOf('{', i);
      if (open < 0 || open >= end) return;
      const prelude = text.slice(i, open).replace(/^[\s}]+/, '').trim();
      const shut = close(open);
      if (prelude.startsWith('@media')) walk(open + 1, shut, print || /\bprint\b/.test(prelude));
      else if (!prelude.startsWith('@')) {
        const decls = new Map<string, string>();
        for (const d of text.slice(open + 1, shut).split(';')) {
          const at = d.indexOf(':');
          if (at > 0) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
        }
        out.push({ selectors: prelude.split(',').map((s) => s.trim()), decls, order: out.length, print });
      }
      i = shut + 1;
    }
  };
  walk(0, text.length, false);
  return out;
}

/**
 * The winning value of `prop` on a `<dialog>` carrying `classes`: only selectors that are the dialog itself
 * (`dialog`, `.x`, `dialog.x`), optionally under the root's `.noscript`, by specificity then source order.
 */
function dialogWinner(rules: SheetRule[], classes: readonly string[], prop: string, state: { print: boolean; noscript: boolean }): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  for (const r of rules) {
    if (r.print && !state.print) continue;
    const value = r.decls.get(prop);
    if (value === undefined) continue;
    for (const sel of r.selectors) {
      const m = /^(\.noscript\s+)?(dialog)?((?:\.[\w-]+)*)$/.exec(sel);
      const cls = m?.[3] ?? '';
      if (m === null || (m[2] === undefined && cls === '')) continue;
      if (m[1] !== undefined && !state.noscript) continue;
      const own = cls === '' ? [] : cls.slice(1).split('.');
      if (!own.every((c) => classes.includes(c))) continue;
      const spec = (own.length + (m[1] === undefined ? 0 : 1)) * 10 + (m[2] === undefined ? 0 : 1);
      if (best === undefined || spec > best.spec || (spec === best.spec && r.order > best.order)) best = { spec, order: r.order, value };
    }
  }
  return best?.value;
}

test('every dialog the page opens is centred and scrolls: no inline-card rule wins its margin or overflow, and print and no-script still show it in place', () => {
  // The code dialog also carries `.code`, whose `margin:0` and `overflow:hidden` (the inline dark card) pinned the modal to the
  // top-left corner with its content cut off (ACP-455, seen in a browser at 1440x900, 2026-09-28).
  const html = renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX);
  const sets = [...html.matchAll(/<dialog\b[^>]*>/g)].map((m) => (/\bclass="([^"]*)"/.exec(m[0])?.[1] ?? '').split(/\s+/).filter((c) => c !== ''));
  assert.ok(sets.some((c) => c.includes('code')), 'no dialog carries the code class: the check would be vacuous');
  const rules = sheetRules(reportStyle());
  for (const classes of sets) {
    const name = `<dialog class="${classes.join(' ')}">`;
    const screen = { print: false, noscript: false };
    // Unset leaves the browser's modal default (margin:auto, overflow:auto); anything else must restate it.
    assert.ok(['auto', undefined].includes(dialogWinner(rules, classes, 'margin', screen)), `${name}: margin ${String(dialogWinner(rules, classes, 'margin', screen))}`);
    assert.ok(['auto', undefined].includes(dialogWinner(rules, classes, 'overflow', screen)), `${name}: overflow ${String(dialogWinner(rules, classes, 'overflow', screen))}`);
    for (const state of [{ print: true, noscript: false }, { print: false, noscript: true }]) {
      assert.equal(dialogWinner(rules, classes, 'margin', state), '16px 0 0', `${name} ${state.print ? 'in print' : 'without script'}: not shown in place`);
    }
  }
});

test('--code: a step with no card is one compact row ending in its action, never a two-column row with an empty half; step 4 opens the placeholders', () => {
  const html = renderReportHtml(CODE_ONLY_RESULT, undefined, CODE_ONLY_CTX);
  const steps = [...html.matchAll(/<li class="step( compact)?"[^>]*>([^]*?)<\/li>/g)];
  assert.ok(steps.length >= 4);
  for (const [, compact, inner = ''] of steps) {
    if (compact === undefined) assert.ok(/<div class="side">(?!<\/div>)/.test(inner), `a two-column step with nothing on the right: ${inner.slice(0, 120)}`);
    else assert.ok(/<div class="end"><a [^>]*>[^<]/.test(inner) && !inner.includes('class="side"'), `a compact step without its action: ${inner.slice(0, 120)}`);
  }
  const named = steps.find((s) => (s[2] ?? '').includes('Name your approvers'));
  assert.ok(named?.[1] !== undefined && (named[2] ?? '').includes(`<a class="textbtn" href="#${PLACEHOLDERS_ID}">See the placeholders</a>`), 'step 4 has no link to the placeholders');
  assert.ok(html.includes(`<details class="inner placeholders" id="${PLACEHOLDERS_ID}">`), 'the link names no <details>');
  assert.ok(PAGE_SCRIPT.includes('if(q instanceof HTMLDetailsElement)q.open=true'), 'no script opens a <details> an in-page link names');
});

// ---------------------------------------------------------------- ACP-464 item 1: what was read stops being the wall

const NESTED_NOTE = 'Not read by rule: 5605 source file(s) in a nested git worktree or submodule checkout (a directory holding a .git file); 1800 source file(s) in test code.';
const UNRESOLVED_NOTE = '347 file(s) import packages the type checker could not resolve (not installed, as in a fresh clone or a CI checkout, or resolved only by a bundler); install the dependencies and re-run for the full reading.';
const limitsOf = (code: CodeSection): string => sectionOf(renderReportHtml({ ...CODE_ONLY_RESULT, code }, undefined, CODE_ONLY_CTX), '<section class="sec" id="limits">');
const headlineOf = (sec: string): string[] => [...(/<div class="col" data-group="headline">[^]*?<\/ul>/.exec(sec)?.[0] ?? '').matchAll(/<li data-limit="([a-z-]+)">/g)].map((m) => m[1] ?? '');

test('ACP-464 item 1: "What was read" keeps its four tiles, heads with at most three limits chosen by rule, and folds every other note into one closed block', () => {
  const code: CodeSection = { ...CODE, catalog: { ...CODE.catalog, not_seen: [...CODE.catalog.not_seen, UNRESOLVED_NOTE, NESTED_NOTE, '3 file(s) load code by a computed name (dynamic import, require of a variable, or eval), which import resolution cannot follow: a.js, b.js, c.js.'] } };
  const sec = limitsOf(code);
  assert.equal((/<div class="limits">[^]*?<\/div><\/div>/.exec(sec)?.[0] ?? '').split('<div><b>').length - 1, 4, 'four tiles');
  // The three first limits of the order, each with its figure; the fourth that applies (computed imports) is not a headline.
  assert.deepEqual(headlineOf(sec), ['runtime-set', 'unresolved-imports', 'nested-checkouts']);
  assert.deepEqual(HEADLINE_LIMIT_ORDER.slice(0, 3), ['runtime-set', 'unresolved-imports', 'nested-checkouts']);
  const head = plain(/<div class="col" data-group="headline">[^]*?<\/ul>/.exec(sec)?.[0] ?? '');
  assert.ok(head.includes('decided at run time by getToolsForLocation'), head);
  assert.ok(head.includes('347 files import packages that could not be resolved, so the grade is provisional.'), head);
  assert.ok(head.includes('5,605 source files were skipped as a nested worktree or submodule checkout.'), head);
  // Every other note sits in ONE closed details, in its groups, and none is lost.
  const fold = /<details class="inner limits-fold"><summary>([^<]*)<\/summary>[^]*?<\/details>/.exec(sec);
  assert.ok(fold !== null, 'no folded block');
  assert.equal(fold[1], LIMITS_FOLD_TITLE);
  assert.equal(count(sec, '<details class="inner limits-fold"'), 1);
  assert.ok(!/<details class="inner limits-fold" open/.test(sec), 'the folded block is open');
  assert.ok(!sec.slice(0, sec.indexOf('<details class="inner limits-fold"')).includes('<div class="col" data-group="runtime"'), 'a group sits outside the fold');
  for (const l of code.catalog.not_seen) assert.ok(plain(fold[0]).includes(l), `a note left the page: ${l}`);
  for (const g of ['runtime', 'unread', 'how', 'other']) assert.ok(fold[0].includes(`data-group="${g}"`), g);
  // The frameworks expander and the scanner's own list stay in this section.
  assert.ok(sec.includes('<summary>Frameworks found in your dependencies</summary>') && sec.includes('The scan itself reads these frameworks'));
});

test('ACP-464 item 1: with none of the first three limits, the next ones of the order take their place; a limit whose figure is zero is never shown', () => {
  const code: CodeSection = {
    ...CODE,
    catalog: {
      ...CODE.catalog,
      gates: [],
      sdks: [],
      exposures: CODE.catalog.exposures.filter((x) => x.kind !== 'computed'),
      not_seen: ['3 file(s) load code by a computed name (dynamic import, require of a variable, or eval), which import resolution cannot follow: a.js, b.js, c.js.', '12 Python files present, not read: no python3 on PATH'],
    },
  };
  assert.deepEqual(headlineOf(limitsOf(code)), ['computed-imports', 'python-unread']);
  const none: CodeSection = { ...code, catalog: { ...code.catalog, not_seen: [] } };
  assert.deepEqual(headlineOf(limitsOf(none)), []);
  assert.ok(!limitsOf(none).includes('data-group="headline"'), 'an empty headline card');
});

// ---------------------------------------------------------------- ACP-464 item 2: coding-assistant findings leave "Other"

test('ACP-464 item 2: a note whose kind is a coding assistant\'s configuration is said under the AI assistants, not in "What was read"; placed by kind, never by its words', () => {
  const hooks = '.claude/settings.json (Claude Code) registers hooks that run before the coding assistant\'s actions and can refuse them (PreToolUse for "Write|Edit" at line 4): an interception point already present.';
  const mcp = '.mcp.json configures 2 MCP server(s) for a coding assistant (db, code-review-graph): their tools are reachable from the assistant and are listed at runtime, not here.';
  // The same words with no kind: a renderer that matched file names would move it, and must not.
  const lookalike = '.cursor/mcp.json configures 1 MCP server(s) for a coding assistant (graph): their tools are reachable from the assistant and are listed at runtime, not here.';
  const code: CodeSection = { ...CODE, catalog: { ...CODE.catalog, not_seen: [...CODE.catalog.not_seen, hooks, mcp, lookalike], assistant_config: [hooks, mcp] } };
  // A code-only scan: the installed half was not run.
  const html = renderReportHtml({ ...CODE_ONLY_RESULT, scope: { code: 'read', installed: false }, code }, undefined, CODE_ONLY_CTX);
  const txt = (h: string): string => plain(h).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const limits = txt(sectionOf(html, '<section class="sec" id="limits">'));
  const installedHtml = sectionOf(html, '<section class="sec" id="installed">');
  const installed = txt(installedHtml);
  assert.ok(installedHtml !== '', 'no AI assistants section');
  assert.ok(limits.includes(CODE.catalog.not_seen[0] ?? '-'), 'the limits were not read as text');
  for (const l of [hooks, mcp]) {
    assert.ok(!limits.includes(l), `still in What was read: ${l}`);
    assert.ok(installed.includes(l), `not under the AI assistants: ${l}`);
  }
  assert.ok(limits.includes(lookalike), 'a note with no kind was moved by its words');
  assert.ok(!installed.includes(lookalike));
  assert.ok(installedHtml.includes(`<h3>${ASSISTANT_CONFIG_TITLE}</h3>`), 'no sub-heading');
  // A code-only scan: the section still says the assistants themselves were not scanned, before the notes.
  const said = installed.search(/not scanned|were not read|was not scanned|not read/i);
  assert.ok(said >= 0, installed.slice(0, 300));
  assert.ok(said < installed.indexOf(hooks));
});
