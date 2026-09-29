/**
 * The executive summary's truth rules (ACP-455). Each test recomputes what a
 * sentence claims from the result it was built from; none compares the
 * summary to a copy of itself.
 */

import assert from 'node:assert/strict';
import { OWASP_EXCESSIVE_AGENCY } from './owasp.js';
import { test } from 'node:test';

import type { CodeSection, CodeToolVerdict } from '../code/types.js';
import { NOTICE_ONLY_UNLISTED } from '../code/grade.js';
import { loadReplayData } from '../replay/data.js';
import type { ScanResult } from '../types.js';
import { ANNEX } from './annex.js';
import { CODE } from './code.fixture.test.data.js';
import { exposureGrade } from './code.js';
import { attachControls } from './controls.js';
import {
  BANNED,
  BOOK_URL,
  codeExecSummary,
  execSentences,
  HEAT_TECHNIQUES,
  MARKED_IRREVERSIBLE,
  mcpExecSummary,
  MCP_URL,
  toolWords,
  type ExecSummary, readsOutsiderText } from './exec.js';
import { heatMini } from './exec-html.js';
import { TECHNIQUE_GLOSS } from './exec-html.js';
import { FIXTURE } from './fixture.test.data.js';
import { renderReportHtml } from './file.js';
import { execLines, execOf } from './terminal.js';

const COMBINED: ScanResult = { ...FIXTURE, findings: attachControls(FIXTURE.findings), code: CODE };

/** A second shape, the first customer's: notified tools with no reversibility entry, a reader of outside text, nothing refused. */
function customerLike(): CodeSection {
  const base = CODE.verdicts;
  const pick = (name: string): CodeToolVerdict => {
    const v = base.find((x) => x.tool.name === name);
    if (v === undefined) throw new Error(name);
    return v;
  };
  const notified = (name: string, words: string[] = []): CodeToolVerdict => ({
    tool: { ...pick('update_note').tool, name },
    verdict: { verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: `rule:${name}` },
    what_ziffer_does: NOTICE_ONLY_UNLISTED,
    untrusted_input: words.length > 0,
    ...(words.length > 0 ? { untrusted_words: words } : {}),
    egress: false,
  });
  const reader: CodeToolVerdict = { ...pick('list_reservations'), tool: { ...pick('list_reservations').tool, name: 'listConversations' }, untrusted_input: true, untrusted_words: ['conversation', 'message', 'inbox'] };
  const verdicts = [
    pick('cancel_reservation'),
    pick('refund_payment'),
    pick('send_guest_message'),
    notified('applyDiscount'),
    notified('updateRoomPrice'),
    notified('closeProperty', ['email']),
    reader,
    pick('get_property'),
  ];
  const { package_name: _unnamed, ...catalog } = CODE.catalog;
  return {
    ...CODE,
    catalog: { ...catalog, root: '~/DEV/EXAMPLE-PLATFORM' },
    verdicts,
    counts: { tools: 8, held: 3, notified: 3, refused: 0, allowed: 2, irreversible: 6 },
  };
}

/**
 * The fixture's only marked tool is `send_guest_message`, a SENDER that mentions a message:
 * naming it as a reader was the false statement the second review found. The case gains a
 * real reader: a read tool whose own name says what it reads.
 */
function withReader(code: CodeSection): CodeSection {
  const read = code.verdicts.find((v) => v.verdict.verdict === 'ALLOW' && v.verdict.reversibility === 'REVERSIBLE');
  assert.ok(read !== undefined);
  const reader = { ...read, tool: { ...read.tool, name: 'get_guest_messages' }, untrusted_input: true, untrusted_words: ['message'] };
  return { ...code, verdicts: [...code.verdicts, reader] };
}

test('a sender that mentions a message is not counted as reading outsider text', () => {
  const sender = CODE.verdicts.find((v) => v.tool.name === 'send_guest_message');
  assert.ok(sender !== undefined && sender.untrusted_input === true);
  assert.equal(readsOutsiderText(sender), false);
  assert.equal(codeExecSummary(CODE, { ...COMBINED, code: CODE }).steering, undefined);
});

const CASES: [string, CodeSection][] = [
  ['fixture', withReader(CODE)],
  ['customer-like', customerLike()],
];

/** Every whole number printed in the summary's own sentences (headline to steering; clause ids excluded). */
function numbersIn(s: ExecSummary): number[] {
  // A file:line reference (`tool-registry.ts:102`) is a place in the source, not a number the summary claims.
  const text = [s.headline, s.subline, ...s.bullets.flatMap((b) => [b.lead, b.text]), s.steering?.text ?? '', s.leak?.text ?? ''].join(' ').replace(/[\w./-]+:\d+/g, '');
  return [...text.matchAll(/(?<![\w.])(\d+)(?![\w.])/g)].map((m) => Number(m[1]));
}

test('exec: every number in the summary is a count or a grade field, recomputed', () => {
  for (const [label, code] of CASES) {
    const s = codeExecSummary(code, { ...COMBINED, code });
    const g = exposureGrade(code);
    assert.ok(g !== undefined);
    const checks = code.insertion.dispatcher?.caller_checks ?? [];
    const allowed = new Set([code.counts.tools, code.counts.notified, g.tools, g.known + g.derived, g.unlisted, g.refused, g.reads, g.stubs, checks.length, checks.filter((c) => c.check !== undefined).length]);
    const found = numbersIn(s);
    assert.ok(found.length >= 2, `${label}: no number found`);
    for (const n of found) assert.ok(allowed.has(n), `${label}: ${n} is not a field of the result (${[...allowed].join(', ')})`);
    // The headline's numbers are exactly the grade's, and it never says "on its own".
    assert.ok(s.headline.includes(`can call ${g.tools} live tools`), `${label}: ${s.headline}`);
    if (g.known + g.derived > 0) assert.ok(s.headline.includes(`${g.known + g.derived} cannot be undone, by `), `${label}: ${s.headline}`);
    if (g.unlisted > 0) assert.ok(s.headline.includes(`${g.unlisted} write and say nothing about undoing it.`), `${label}: ${s.headline}`);
    assert.ok(!s.headline.includes('on its own'), `${label}: ${s.headline}`);
    const notified = s.bullets.find((b) => b.kind === 'notified');
    if (notified !== undefined) assert.equal(notified.count, code.counts.notified);
  }
});

test('exec: a bullet names only tools whose engine verdict is the one its words imply', () => {
  for (const [label, code] of CASES) {
    const s = codeExecSummary(code, { ...COMBINED, code });
    const verdictOf = (name: string): CodeToolVerdict => {
      const v = code.verdicts.find((x) => x.tool.name === name);
      assert.ok(v !== undefined, `${label}: ${name} is not in the verdicts`);
      return v;
    };
    assert.ok(s.bullets.length > 0 && s.bullets.length <= 5);
    for (const b of s.bullets) {
      const says = `${b.lead} ${b.text}`;
      if (says.includes('with no ZIFFER approval')) assert.equal(b.kind, 'notified', `${label}: "${says}" is not a notified bullet`);
      for (const name of b.tools) {
        const v = verdictOf(name).verdict;
        if (b.kind === 'notified') assert.ok(v.verdict === 'ALLOW' && v.reversibility === 'IRREVERSIBLE', `${label}: ${name} said to run with nobody asking is ${v.verdict}`);
        if (b.kind === 'held') assert.equal(v.verdict, 'ATTEST', `${label}: ${name} said to wait for a person is ${v.verdict}`);
        if (b.kind === 'refused') assert.equal(v.verdict, 'REFUSED', `${label}: ${name}`);
        if (b.text === MARKED_IRREVERSIBLE) assert.ok(v.verdict !== 'REFUSED' && v.reversibility === 'IRREVERSIBLE', `${label}: ${name} said to be irreversible`);
      }
    }
    // The page carries the same bullets, their kind and tools on the element.
    const html = renderReportHtml({ ...COMBINED, code }, undefined, HTML_CTX);
    // Re-pointed by the third design (2026-09-28): one table row per bullet under "What a model can do today".
    const items = [...html.matchAll(/<tr class="xb xb-(\w+)" data-kind="(\w+)" data-tools="([^"]*)">([^]*?)<\/tr>/g)];
    assert.equal(items.length, s.bullets.length, `${label}: the page's bullets are not the summary's`);
    for (const m of items) {
      const body = m[4] ?? '';
      if (body.includes('with no ZIFFER approval')) assert.equal(m[2], 'notified', body);
      for (const name of (m[3] ?? '').split(' ')) {
        const v = verdictOf(name).verdict;
        if (m[2] === 'notified') assert.equal(v.verdict, 'ALLOW', `${name} in a "nobody asked" bullet`);
        if (m[2] === 'held') assert.equal(v.verdict, 'ATTEST', `${name} in a "ZIFFER holds" bullet`);
      }
    }
  }
});

test('exec: no banned word, and no percentage, in any summary', () => {
  const summaries: ExecSummary[] = [
    ...CASES.map(([, code]) => codeExecSummary(code, { ...COMBINED, code })),
    mcpExecSummary({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, { tools: 8, irreversible: 2 }),
  ];
  for (const s of summaries) {
    for (const sentence of execSentences(s)) {
      for (const word of BANNED) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(sentence), `"${word}" in: ${sentence}`);
      assert.ok(!sentence.includes('%'), `a percentage outside the grade: ${sentence}`);
    }
  }
});

test('exec: the outsider block appears iff some verdict reads untrusted input, in the summary, the page and the screen', () => {
  for (const [label, code] of CASES) {
    const marked = code.verdicts.some(readsOutsiderText);
    assert.ok(marked, `${label}: the case must carry a reader`);
    const s = codeExecSummary(code, { ...COMBINED, code });
    assert.ok(s.steering !== undefined);
    // A reader is a tool that READS and whose own name or parameters say the text comes from outside.
    for (const r of s.steering.readers) assert.ok(code.verdicts.some((v) => v.tool.name === r && readsOutsiderText(v)), r);
    for (const t of s.steering.targets) assert.ok(code.verdicts.some((v) => v.tool.name === t && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE'), t);
    assert.ok(renderReportHtml({ ...COMBINED, code }, undefined, HTML_CTX).includes('How an outsider could steer it'));
    const none: CodeSection = { ...code, verdicts: code.verdicts.map((v) => ({ ...v, untrusted_input: false })) };
    assert.equal(codeExecSummary(none, { ...COMBINED, code: none }).steering, undefined, `${label}: a steering path with no reader`);
    assert.ok(!renderReportHtml({ ...COMBINED, code: none }, undefined, HTML_CTX).includes('How an outsider could steer it'));
    assert.ok(!execLines(execOf({ ...COMBINED, code: none }), 80, (_c, t) => t).join('\n').includes('Outsiders'));
  }
});

test('exec: the ATLAS cells name only dossier rows, count from the verdicts, and never colour what is not measured', () => {
  const code = customerLike();
  const s = codeExecSummary(code, { ...COMBINED, code });
  assert.ok(s.heat.length >= 5 && s.heat.length <= 8);
  for (const h of s.heat) {
    const row = ANNEX.atlas.find((r) => r.id === h.id);
    assert.ok(row !== undefined, `${h.id} is not in the embedded MITRE chapter`);
    assert.equal(h.name, row.name, `${h.id}'s name is not the dossier's`);
    assert.equal(h.position, row.position_label.replace(/\.$/, ''));
    if (h.level === 'unmeasured') assert.equal(h.count, undefined);
    if (h.count === undefined) assert.equal(h.level, 'unmeasured');
  }
  const cell = (id: string): ExecSummary['heat'][number] => {
    const c = s.heat.find((h) => h.id === id);
    assert.ok(c !== undefined, id);
    return c;
  };
  assert.equal(cell('AML.T0051.001').count, code.verdicts.filter(readsOutsiderText).length);
  // A sender that mentions a message is not a reader: fewer than every marked tool.
  assert.ok(code.verdicts.filter(readsOutsiderText).every((v) => v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'REVERSIBLE'));
  assert.equal(cell('AML.T0086').count, code.verdicts.filter((v) => v.egress).length);
  const g = exposureGrade(code);
  assert.ok(g !== undefined);
  assert.equal(cell(OWASP_EXCESSIVE_AGENCY.dossierId).count, g.known + g.unlisted);
  // The dossier's "Tool autonomy" row is no entry of any edition of the OWASP list: never a cell.
  assert.equal(s.heat.find((h) => h.name === 'Tool autonomy'), undefined);
  assert.ok(!renderReportHtml({ ...COMBINED, code }, undefined, HTML_CTX).split('Technical report')[0]?.includes(OWASP_EXCESSIVE_AGENCY.id), 'the executive cells are MITRE ATLAS only');
  assert.equal(cell('AML.T0051').level, 'unmeasured');
  // Code only: the tool-poisoning technique is about third-party tools, which this run did not read.
  const codeOnly = codeExecSummary(code, { ...COMBINED, code, catalog: [], findings: [], classifications: [], scope: { code: 'read', installed: false } });
  assert.equal(codeOnly.heat.find((h) => h.id === 'AML.T0110')?.level, 'unmeasured');
  // Every ID and name rendered in the cells is in the embedded data; a grey cell carries no colour class.
  const html = heatMini(s.heat);
  for (const m of html.matchAll(/<span class="hc-id">([^<]+)<\/span><span class="hc-n">([^<]+)<\/span>/g)) {
    assert.ok(ANNEX.atlas.some((r) => r.id === m[1] && r.name.replace(/&/g, '&amp;') === m[2]), `${m[1]} ${m[2]}`);
  }
  for (const m of html.matchAll(/<div class="hc hc-(\w+)">([^]*?)<\/div>/g)) {
    if ((m[2] ?? '').includes('not measured by this scan')) assert.equal(m[1], 'unmeasured');
  }
  assert.ok(HEAT_TECHNIQUES.every((t) => ANNEX.atlas.some((r) => r.id === t.id)), 'a technique listed is not in the dossier');
});

test('exec: the page opens with the summary, its two links, the divider, then the technical report; print keeps it to its own page', () => {
  const html = renderReportHtml(COMBINED, undefined, HTML_CTX);
  const at = (x: string): number => html.indexOf(x);
  assert.ok(at('id="executive-summary"') > 0 && at('id="executive-summary"') < at('id="technical"'));
  assert.ok(at('id="technical"') < at('<section class="sec" id="limits">'), 'the technical report comes before the summary');
  assert.ok(html.includes(`href="${BOOK_URL}"`) && html.includes(`href="${MCP_URL}"`) && html.includes('href="#technical"'));
  const summary = html.slice(at('id="executive-summary"'), at('id="technical"'));
  // Since ACP-455's presentation the first screen names the one place to paste the call, and nothing else by path.
  const withoutCall = summary.replace(/<div class="where">[^]*?<\/div>/, '');
  assert.ok(summary.includes('<div class="where">'), 'the call names its place');
  assert.ok(!/[\w-]+\/[\w-]+\.(ts|js|json)\b/.test(withoutCall), 'a file path in the summary');
  assert.ok(!summary.includes('8.4-3') && !summary.includes('DR-13'), 'a clause id in the summary');
  // Print: the first screen alone on page 1 (second design, 2026-09-28); a closed <details> stays closed.
  assert.ok(html.includes('.first{page:cover;break-after:page') && !html.includes('details::details-content'));
  // The footer: the booking first.
  const footer = html.slice(at('<footer'));
  assert.ok(footer.indexOf(BOOK_URL) < footer.indexOf('Paste the ZIFFER call'));
});

test('exec: the MCP-only page has its own summary, built from the installed tools and the pair finding', () => {
  const result = { ...FIXTURE, findings: attachControls(FIXTURE.findings) };
  const s = mcpExecSummary(result, { tools: 8, irreversible: 2 });
  assert.equal(s.headline, 'The AI assistants on this machine can call 8 tools; 2 of them are marked as impossible to undo by their name or description; confirm.');
  assert.equal(s.heat.find((h) => h.name === 'Tool autonomy'), undefined);
  for (const b of s.bullets) for (const name of b.tools) assert.ok(result.classifications.some((c) => c.tool === name && c.effect === 'irreversible'), name);
  assert.ok(s.steering !== undefined && s.steering.readers.includes('read_email'));
  assert.ok(renderReportHtml(result, undefined, HTML_CTX).includes('id="executive-summary"'));
});

test('exec: the terminal summary is 6 to 10 lines and carries the review link', () => {
  for (const [, code] of CASES) {
    const lines = execLines(execOf({ ...COMBINED, code }), 80, (_c, t) => t);
    assert.ok(lines.length >= 6 && lines.length <= 10, `${lines.length} lines:\n${lines.join('\n')}`);
    assert.ok(lines.at(-1)?.includes(BOOK_URL));
  }
});

test('exec: a tool name reads as the action it names', () => {
  assert.equal(toolWords('cancelReservation'), 'cancel a reservation');
  assert.equal(toolWords('deleteGbpPost'), 'delete a GBP post');
  assert.equal(toolWords('prospector_send_email'), 'send an email (prospector)');
  assert.equal(toolWords('updateAccessInfo'), 'update access info');
  assert.equal(toolWords('modifyReservationDates'), 'modify reservation dates');
  assert.equal(toolWords('respond'), 'respond');
});

// ---------------------------------------------------------------- context

const HTML_CTX = {
  homes: [],
  machine: 'test-machine',
  words: loadReplayData().words,
  policy: {
    files: [
      { path: 'floors.json', text: '{"floors": {"mail": "T3"}}' },
      { path: 'reversibility.json', text: '{"reversibility": {"delete_email": "IRREVERSIBLE"}}' },
      { path: 'risk_functions.json', text: '{"risk_functions": [{"applies_to": "delete_email", "base": "HIGH", "raise_to": []}]}' },
      { path: 'notice_targets.json', text: '{"notice_targets": {"delete_email": ["developer"]}}' },
      { path: 'attesters/registry.json', text: '{"quorum_k": 2, "attesters": {"approver-1": {}, "approver-2": {}}}' },
      { path: 'receipt_identity.json', text: '{"name": "scan-demo-receipt-key"}' },
    ],
    treeHash: 'sha256:00',
    tenantId: 'ten_demo_00',
    unclassified: [],
  },
};

test('every technique shown has a plain ZIFFER sentence, and every sentence is a technique the dossier still carries', () => {
  const code = customerLike();
  const cells = codeExecSummary(code, { ...COMBINED, code }).heat.filter((h) => h.framework === 'MITRE ATLAS');
  for (const h of cells) assert.ok(TECHNIQUE_GLOSS[h.id] !== undefined, `no plain words for ${h.id}`);
  // Every technique with a sentence is still a row of the dossier, and no sentence reads as a disclaimer.
  for (const [id, text] of Object.entries(TECHNIQUE_GLOSS)) {
    assert.ok(ANNEX.atlas.some((r) => r.id === id), `${id} is no longer in the dossier`);
    assert.ok(!/does not close|partially|out of scope|reduces/i.test(text), `${id}: "${text}"`);
  }
  for (const t of HEAT_TECHNIQUES) assert.ok(TECHNIQUE_GLOSS[t.id] !== undefined, `${t.id} is listed and has no ZIFFER sentence`);
});
