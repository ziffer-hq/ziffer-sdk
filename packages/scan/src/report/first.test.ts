/**
 * The `--code` report's first screen (ACP-455 presentation, second design, 2026-09-28): its order,
 * the door diagram at every size the data can take, its labels' rules, and its numbers. A structural
 * test does not prove what a person sees (the screenshots do that); these hold what can be held from
 * the markup: the order of the elements, that the drawing does not grow with the number of tools,
 * that every label is cut by its written rule and fits its box, that no connector crosses a label,
 * and that every number on the first screen is the result object's and is said again in the
 * technical part. The names in the fixtures are invented.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CiVerdict } from '../ci/ci.js';
import { countsOf, NO_REVERSIBILITY_ENTRY, NOTICE_ONLY_UNLISTED, whatZifferDoes } from '../code/grade.js';
import type { CallerCheck, CodeSection, CodeTool, CodeToolVerdict, Dispatcher, ToolCall } from '../code/types.js';
import { loadReplayData } from '../replay/data.js';
import type { ScanResult } from '../types.js';
import { CODE } from './code.fixture.test.data.js';
import { exposureGrade } from './code.js';
import { shapedApp, STRESS } from './door.fixture.test.data.js';
import { BOOK_URL, codeHeadlineScreen, TODAY_LEDE, TODAY_LEDE_TAGGED, todayLede } from './exec.js';
import { ENTRIES_REACH_HEAD } from './code-html.js';
import { reportStyle } from './page-style.js';
import { aroundWords, callerRows, cutEnd, cutMiddle, doorBar, doorDiagram, FIRST_FINDINGS, heldParts, LABEL_RULES, outsideLine, routeLabel, type LabelRule } from './first.js';
import { FONT_FACES } from './fonts.js';
import { PAGE_SCRIPT, scriptHash } from './script.js';
import { FIXTURE } from './fixture.test.data.js';
import { renderReportHtml } from './file.js';
import { bypassPaths, offeredSentence } from './paths.js';

// ---------------------------------------------------------------- the application of the sentence tests

const at = (file: string, line: number): { file: string; line: number; col: number } => ({ file, line, col: 1 });
const DOOR = 'runTool';

function tool(name: string, description = 'A tool.', dispatched = true): CodeTool {
  return {
    name,
    description,
    schema_kind: 'zod',
    params: [],
    sdk: 'local',
    via: 'defineTool() (app-local factory)',
    defined_at: at(`src/tools/${name}.ts`, 10),
    execute_at: at(`src/tools/${name}.ts`, 20),
    ...(dispatched ? { delegates_to: DOOR } : {}),
  };
}
const heldV = (rule: string): CiVerdict => ({ verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: rule });
const noticeV = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: rule });
const readV = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'LOW', reversibility: 'REVERSIBLE', effective_tier: 'T0', rule_id: rule });

function known(t: CodeTool): CodeToolVerdict {
  return { tool: t, verdict: heldV(t.name), what_ziffer_does: whatZifferDoes(heldV(t.name)), draft_reason: 'name says "delete"', untrusted_input: false, egress: false, irreversible_class: 3 };
}
function unlisted(t: CodeTool): CodeToolVerdict {
  return { tool: t, verdict: noticeV(t.name), what_ziffer_does: NOTICE_ONLY_UNLISTED, untrusted_input: false, egress: false };
}
function reader(t: CodeTool): CodeToolVerdict {
  return { tool: t, verdict: readV(t.name), what_ziffer_does: whatZifferDoes(readV(t.name)), untrusted_input: false, egress: false };
}

/** An application of `callers` entries and `bypass` inner calls: 10 marked, 30 unlisted, 40 reads, and one tool outside the door. */
function app(n: { callers: number; bypass: number; door?: boolean }): CodeSection {
  const verdicts: CodeToolVerdict[] = [
    ...Array.from({ length: 10 }, (_, i) => known(tool(`purgeShelf${i}`))),
    ...Array.from({ length: 30 }, (_, i) => unlisted(tool(`restockShelf${i}`))),
    ...Array.from({ length: 40 }, (_, i) => reader(tool(`countShelf${i}`))),
    known(tool('reply', 'Send your reply to the customer.', false)),
  ];
  const calls: ToolCall[] = Array.from({ length: n.bypass }, (_, i): ToolCall =>
    i % 2 === 0
      ? { tool: `restockShelf${i}`, at: at(`src/tools/purge-shelf-${i}.ts`, 40 + i), via: 'direct', through: [] }
      : { at: at(`src/playbooks/context-${i}.ts`, 70 + i), via: 'lookup', through: ['buildContext', 'invokeTool'] },
  );
  const withCalls = verdicts.map((v, i) => {
    const c = calls[i];
    return c === undefined ? v : { ...v, tool: { ...v.tool, calls: [c] } };
  });
  const callers = Array.from({ length: n.callers }, (_, i) => at(`src/desks/desk-${i}.ts`, 12 + i));
  const checks: CallerCheck[] = callers.map((caller, i): CallerCheck =>
    i === 0
      ? { caller, in_function: 'loggedShelfCall', offered: ['countShelf0', 'countShelf1', 'purgeShelf0'], offered_from: 'scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_"' }
      : i % 2 === 1
        ? { caller, in_function: `router.post('/stores/:storeId/shelves/${i}/confirmed-action')`, check: { at: at(`src/desks/desk-${i}.ts`, 5 + i), reads: 'confirmed' } }
        : { caller, in_function: `deskHandler${i}` },
  );
  const dispatcher: Dispatcher = { name: DOOR, at: at('src/tools/run-tool.ts', 56), signature: '(name, input, ctx)', callers, tools_delegating: verdicts.length - 1, caller_checks: checks };
  const door = n.door ?? true;
  return {
    ...CODE,
    catalog: {
      ...CODE.catalog,
      package_name: 'corner-bookshop',
      tools: withCalls.map((v) => v.tool),
      dispatchers: door ? [dispatcher] : [],
      checks: [{ language: 'typescript', tool_calls: true, caller_checks: true }],
      syntax_only: { found: 3, missed: verdicts.length - 3 },
      not_seen: ['12 file(s) import packages the type checker could not resolve (not installed); readings that need the framework types are not made there.'],
    },
    verdicts: withCalls,
    insertion: { ...CODE.insertion, dispatcher: door ? dispatcher : null, per_tool: !door, call: 'await zifferGate(name, input, zifferOperator(ctx));' },
    counts: countsOf(withCalls),
  };
}

const CTX = {
  homes: [],
  machine: 'test-machine',
  words: loadReplayData().words,
  policy: {
    files: [
      { path: 'floors.json', text: '{"floors": {}}' },
      { path: 'reversibility.json', text: '{"reversibility": {}}' },
      { path: 'risk_functions.json', text: '{"risk_functions": []}' },
      { path: 'notice_targets.json', text: '{"notice_targets": {}}' },
      { path: 'attesters/registry.json', text: '{"quorum_k": 2, "attesters": {"approver-1": {}, "approver-2": {}}}' },
      { path: 'receipt_identity.json', text: '{"name": "scan-demo-receipt-key"}' },
    ],
    treeHash: 'sha256:00',
    tenantId: 'ten_demo_00',
    unclassified: [],
  },
};

const resultOf = (code: CodeSection): ScanResult => ({ ...FIXTURE, catalog: [], findings: [], classifications: [], scope: { code: 'read', installed: false }, code });
const page = (code: CodeSection): string => renderReportHtml(resultOf(code), undefined, CTX);
const unescape = (s: string): string => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (s: string): string => unescape(s.replace(/<style[^]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const firstOf = (h: string): string => h.slice(h.indexOf('<div class="first" id="first-screen">'), h.indexOf('<div class="rest">'));
const technicalOf = (h: string): string => h.slice(h.indexOf('id="technical"'));
const count = (h: string, needle: string): number => h.split(needle).length - 1;
// Re-pointed by ACP-464: the drawing is 292 high, or 306 when a tool does not pass the door (the lane under it moves down, once).
const svgOf = (h: string): string => /<svg viewBox="0 18 1144 (?:292|306)"[^]*?<\/svg>/.exec(h)?.[0] ?? '';
const listOf = (h: string): string => /<div class="door-list">[^]*?<\/div><figcaption/.exec(h)?.[0] ?? '';

// ---------------------------------------------------------------- 1. the order

test('first screen: masthead, headline, grade, door, findings, the call and the call to action, in that order, before the technical part', () => {
  const code = shapedApp({ tools: 81, callers: 3, paths: 2, outside: 1 });
  const h = page(code);
  const marks = ['<header class="mast">', '<section class="hero"', '<h1 id="exec-h"', '<div class="grade" role="img"', '<figure class="door"', '<ol class="finds">', '<section class="act" id="first-call">', 'class="cta"'];
  const where = marks.map((m) => h.indexOf(m));
  assert.ok(where.every((x, i) => x > 0 && (i === 0 || x > (where[i - 1] ?? 0))), `out of order: ${marks.map((m, i) => `${m}@${where[i]}`).join(', ')}`);
  // The first screen ends before "In plain words", which ends before the technical part.
  assert.ok((where.at(-1) ?? 0) < h.indexOf('<div class="rest">') && h.indexOf('id="plain"') < h.indexOf('id="technical"'));
  // Nothing else on the first screen.
  const first = firstOf(h);
  for (const absent of ['class="xb', 'id="steer"', 'class="sec"', '<table', 'class="limits"']) assert.ok(!first.includes(absent), absent);
  // The headline: two sentences, the second (the one to act on) underlined, then the builder's qualifiers in the lede.
  const hs = codeHeadlineScreen(code);
  assert.ok(first.includes(`<h1 id="exec-h">${hs.lead} <em>${hs.act}</em></h1>`), first.slice(0, 1200));
  assert.equal((`${hs.lead} ${hs.act}`.match(/\.(\s|$)/g) ?? []).length, 2);
  for (const r of hs.rest) assert.ok(text(first).includes(r.replace(/\s+/g, ' ')), r);
  // The masthead names the application, the day and the scan.
  // Re-pointed by the third design (2026-09-28): the nav names the application and the day; the scan's version is in the footer.
  assert.ok(first.includes('<span><b>corner-bookshop</b></span>'));
  assert.ok(h.slice(h.indexOf('<footer class="foot">')).includes('@ziffer-io/scan '), 'the scan and its version, in the footer');
});

test('the headline says the same numbers as the grade, with the stubs and the reasons in the lede', () => {
  const code = shapedApp(STRESS);
  const g = exposureGrade(code);
  assert.ok(g !== undefined);
  const hs = codeHeadlineScreen(code);
  assert.equal(hs.lead, `A model in lantern-bookshop-backoffice can call ${g.tools} live tools.`);
  assert.equal(hs.act, `${g.known + g.derived} of them cannot be undone.`);
  assert.ok(hs.rest[0]?.startsWith('Marked so by their own name or description'), hs.rest[0]);
  assert.ok(hs.rest.includes(`${g.unlisted} write and say nothing about undoing it.`), hs.rest.join(' | '));
  // A long headline is set one size smaller, never cut.
  assert.ok(firstOf(page(code)).includes('<h1 id="exec-h" class="long">'));
  assert.ok(!firstOf(page(shapedApp({ tools: 20, callers: 1, paths: 0, outside: 0 }))).includes('class="long"'));
});

test('first screen: three findings at most, in three columns, each with its verb and its link; the entries with no check first', () => {
  const first = firstOf(page(app({ callers: 3, bypass: 2 })));
  const kinds = [...first.matchAll(/<li class="find" data-finding="(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ['unchecked', 'bypass', 'reply'], 'the entries with no check found are one finding, then the paths, then the held reply');
  // Re-pointed by the third design (2026-09-28): no numbers, the verb as a small orange label, the title in bold.
  assert.ok(first.includes('<i class="n">ACT</i><b>Two entries have no confirmation check.</b>'), first.slice(first.indexOf('<ol class="finds">'), first.indexOf('<ol class="finds">') + 400));
  assert.equal(/<li class="find" data-finding="reply"><p><i class="n">([A-Z]+)<\/i>/.exec(first)?.[1], 'DECIDE');
  assert.equal(count(first, '<li class="find"'), FIRST_FINDINGS);
  assert.equal(count(first, '<li class="find"'), count(first, '>Read it</a>'));
  const one = firstOf(page(app({ callers: 1, bypass: 2 })));
  assert.ok(one.includes('<b>One entry has no confirmation check.</b>'));
});

// ---------------------------------------------------------------- 2. the diagram

interface Box { x: number; y: number; w: number; h: number }
interface Label extends Box { text: string; rule?: string }

/** The drawing's boxes, labels (a label's width estimated from its face: 0.6 em a character in the mono face, its exact advance; 0.5 in the sans, above the 0.45 the rendered page measures), and connector segments. */
function geometry(svg: string): { rects: Box[]; labels: Label[]; segments: [number, number, number, number][] } {
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)" class="([^"]*)"((?: [a-z-]+="[^"]*")*)>([^]*?)<\/text>/g)].map((m) => {
    const size = Number(m[3]);
    const shown = unescape((m[6] ?? '').replace(/<[^>]+>/g, ''));
    const w = shown.length * size * ((m[4] ?? '').split(' ').includes('m') ? 0.6 : 0.5);
    const rule = /data-rule="([a-zA-Z]+)"/.exec(m[5] ?? '')?.[1];
    return { x: Number(m[1]), y: Number(m[2]) - size, w, h: size + 2, text: shown, ...(rule === undefined ? {} : { rule }) };
  });
  const segments: [number, number, number, number][] = [];
  for (const m of svg.matchAll(/<path d="M([\d.]+) ([\d.]+)((?:[HV][\d.]+)+)" class="ln(?:-act)?"\/>/g)) {
    let x = Number(m[1]);
    let y = Number(m[2]);
    for (const step of (m[3] ?? '').matchAll(/([HV])([\d.]+)/g)) {
      const v = Number(step[2]);
      const [nx, ny] = step[1] === 'H' ? [v, y] : [x, v];
      segments.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    }
  }
  return { rects, labels, segments };
}

const inside = (p: [number, number], b: Box): boolean => p[0] > b.x && p[0] < b.x + b.w && p[1] > b.y && p[1] < b.y + b.h;

/** Every label fits the box it starts in, every cut label is within its rule, and no connector passes through a label. */
function assertLegible(svg: string, label: string): void {
  const g = geometry(svg);
  assert.ok(g.labels.length > 0, label);
  for (const l of g.labels) {
    // The smallest box the label starts in: a pill inside the band, a row inside nothing larger.
    const boxes = g.rects.filter((r) => l.x >= r.x && l.x < r.x + r.w && l.y + l.h / 2 >= r.y && l.y + l.h / 2 <= r.y + r.h).sort((a, b) => a.w * a.h - b.w * b.h);
    const box = boxes[0];
    if (box !== undefined) assert.ok(l.x + l.w <= box.x + box.w, `${label}: "${l.text}" leaves its box (${Math.round(l.x + l.w)} > ${box.x + box.w})`);
    if (l.rule !== undefined) assert.ok(l.text.length <= LABEL_RULES[l.rule as LabelRule], `${label}: "${l.text}" is longer than ${l.rule} (${LABEL_RULES[l.rule as LabelRule]})`);
  }
  for (const [x1, y1, x2, y2] of g.segments) {
    for (let i = 0; i <= 20; i++) {
      const p: [number, number] = [x1 + ((x2 - x1) * i) / 20, y1 + ((y2 - y1) * i) / 20];
      for (const l of g.labels) assert.ok(!inside(p, l), `${label}: a connector crosses "${l.text}" at ${p.map(Math.round).join(',')}`);
    }
  }
}

for (const callers of [1, 3, 9]) {
  test(`the door with ${callers} caller${callers === 1 ? '' : 's'}: at most three rows, callers with no check found first, the rest counted`, () => {
    const code = shapedApp({ tools: 60, callers, paths: 2, outside: 1 });
    const d = doorDiagram(code);
    const svg = svgOf(d);
    const rows = callerRows(code);
    const checks = code.insertion.dispatcher?.caller_checks ?? [];
    const noCheck = checks.filter((c) => c.check === undefined).length;
    assert.equal(rows.shown.length + (rows.more === undefined ? 0 : 1), Math.min(3, callers));
    // Callers with no check found come first.
    const firstChecked = rows.shown.findIndex((c) => c.check !== undefined);
    assert.ok(firstChecked < 0 || rows.shown.slice(firstChecked).every((c) => c.check !== undefined));
    assert.equal(count(svg, '>NO CHECK FOUND<'), rows.shown.filter((c) => c.check === undefined).length);
    if (callers > 3) {
      assert.equal(rows.more?.n, callers - 2);
      assert.equal((rows.more?.unchecked ?? 0) + rows.shown.filter((c) => c.check === undefined).length, noCheck);
      assert.ok(svg.includes(`<tspan data-n="callers-more">${callers - 2}</tspan> more callers`));
      assert.ok(svg.includes(`${rows.more?.unchecked ?? 0} with no check found · ${rows.more?.checked ?? 0} with a check`));
    } else assert.ok(!svg.includes('more callers'));
    // Re-pointed by the third design: the drawing has no lane titles; the list beside it counts the callers.
    assert.ok(listOf(d).includes(`Who calls the door · ${callers}`));
    assert.ok(svg.includes('>ZIFFER goes here<'));
    assertLegible(svg, `${callers} callers`);
    // The narrow list says the same rows.
    assert.equal(count(listOf(d), '<i>NO CHECK FOUND</i>'), rows.shown.filter((c) => c.check === undefined).length);
  });
}

for (const paths of [0, 2, 14]) {
  test(`the door with ${paths} path${paths === 1 ? '' : 's'} around it: ONE pill with the count, whatever the count`, () => {
    // Re-pointed by the third design (2026-09-28): the paths around the door are one dashed path under
    // the door carrying one pill, "N tools run another tool unseen"; the names are in the list and in step 3.
    const code = shapedApp({ tools: 60, callers: 3, paths, outside: 1 });
    const d = doorDiagram(code);
    const svg = svgOf(d);
    assert.equal(bypassPaths(code).length, paths);
    assert.equal(count(svg, 'class="dash"'), paths > 0 ? 1 : 0, 'one dashed path around the door, only when there is one');
    assert.equal(count(svg, '<tspan data-n="bypass">'), paths > 0 ? 1 : 0, 'one pill, never one per path');
    if (paths > 0) {
      assert.ok(svg.includes(aroundWords(bypassPaths(code)).html));
      assert.ok(aroundWords(bypassPaths(code)).html.startsWith(`<tspan data-n="bypass">${paths}</tspan> `));
      const outer = [...new Set(bypassPaths(code).map((p) => p.outer))];
      assert.ok(listOf(d).includes(outer[0] ?? '-'), 'the list names the outer tools');
    }
    // Re-pointed by ACP-464: this application has a tool outside the door, drawn in the lane under it, which is 14 lower.
    assert.ok(svg.startsWith('<svg viewBox="0 18 1144 306"'));
    assertLegible(svg, `${paths} paths`);
  });
}

for (const outside of [1, 11]) {
  test(`the door with ${outside} tool${outside === 1 ? '' : 's'} outside it: up to three names, then "+ N", counted`, () => {
    const code = shapedApp({ tools: 60, callers: 3, paths: 2, outside });
    const svg = svgOf(doorDiagram(code));
    // Re-pointed by the third design: the drawing says the count in its short form, the list the whole sentence.
    // Re-pointed by ACP-464: the drawing says what the list says, "it needs its own call".
    assert.ok(svg.includes(`<tspan data-n="outside">${outside}</tspan> ${outside === 1 ? 'tool does not pass the door: it needs its own call' : 'tools do not pass the door: each needs its own call'}`));
    assert.ok(listOf(doorDiagram(code)).includes(`${outside} ${outside === 1 ? 'tool does not pass the door: it needs its own call' : 'tools do not pass the door: each needs its own call'}`));
    const line = /data-rule="outsideLine"[^>]*>([^<]*)</.exec(svg)?.[1] ?? '';
    const names = code.verdicts.filter((v) => v.tool.delegates_to === undefined).map((v) => v.tool.name);
    assert.equal(unescape(line), outsideLine(names, outside));
    assert.equal(line.includes('+'), outside > 1 && outside > (line.match(/,/g) ?? []).length + 1);
    assertLegible(svg, `${outside} outside`);
  });
}

test('the door with every tool passing it says so, and with no dispatcher draws the per-tool case in the words the page already uses', () => {
  const all = svgOf(doorDiagram(shapedApp({ tools: 30, callers: 2, paths: 0, outside: 0 })));
  // Re-pointed by the third design: when every tool passes the door, the outcomes column has no row for the rest.
  assert.ok(!all.includes('data-n="outside"') && !all.includes('does not pass the door') && !all.includes('dash-box'));
  const code = shapedApp({ tools: 30, callers: 3, paths: 2, outside: 0, door: false });
  const d = doorDiagram(code);
  const svg = svgOf(d);
  assert.ok(!d.includes('ZIFFER goes here') && !d.includes('Who calls the door'));
  assert.ok(svg.includes('>No door: no single function runs every tool<'));
  assert.ok(svg.includes(`ZIFFER goes at the top of each tool’s run function, ${code.counts.tools} places.`));
  assert.ok(svg.includes('>around the door<') && svg.includes('<tspan data-n="bypass">'), 'the paths a tool runs directly are still drawn');
  assertLegible(svg, 'no door');
  assert.ok(listOf(d).includes('No door: no single function runs every tool'));
  assert.ok(firstOf(page(code)).includes('Put ZIFFER at the top of each tool’s run function'));
});

test('STRESS: 214 tools, 9 callers, 14 paths: the first screen does not grow with the number of tools, and every label keeps its rule', () => {
  const big = shapedApp(STRESS);
  const small = shapedApp({ ...STRESS, tools: 20 });
  const elements = (svg: string): number => (svg.match(/<[a-z]+[\s>]/g) ?? []).length;
  const bigSvg = svgOf(doorDiagram(big));
  assert.equal(elements(bigSvg), elements(svgOf(doorDiagram(small))), 'the drawing has as many elements for 214 tools as for 20');
  // Nor does the first screen as a whole: the same elements, whatever the number of tools.
  assert.equal(elements(firstOf(page(big))), elements(firstOf(page(small))));
  assertLegible(bigSvg, 'stress');
  // The stress shape shows only callers with no check; a caller with a check and a long reading holds callerLine.
  const long = shapedApp({ tools: 60, callers: 3, paths: 0, outside: 0 });
  const d = long.insertion.dispatcher;
  assert.ok(d !== null && d.caller_checks !== undefined);
  const checks = d.caller_checks.map((c) => (c.check === undefined ? c : { ...c, check: { ...c.check, reads: 'requires_confirmation_for_every_tenant_and_location' } }));
  const longSvg = svgOf(doorDiagram({ ...long, insertion: { ...long.insertion, dispatcher: { ...d, caller_checks: checks } } }));
  const lines = [...longSvg.matchAll(/data-rule="callerLine"[^>]*>([^<]*)</g)].map((m) => unescape(m[1] ?? ''));
  assert.ok(lines.length > 0 && lines.every((l) => l.length <= LABEL_RULES.callerLine) && lines.some((l) => l.endsWith('…')), lines.join(' | '));
  assertLegible(longSvg, 'long check');
  // Each rule fired at least once on the stress shape, so each one is held by a cut label, not a short one.
  const cut = [
    ...bigSvg.matchAll(/<text [^>]*data-rule="([a-zA-Z]+)"[^>]*>([^]*?)<\/text>/g),
    ...bigSvg.matchAll(/<tspan [^>]*data-rule="([a-zA-Z]+)"[^>]*>([^<]*)<\/tspan>/g),
  ].filter((m) => unescape((m[2] ?? '').replace(/<[^>]+>/g, '')).includes('…')).map((m) => m[1]);
  for (const rule of ['callerName', 'doorName', 'doorPath', 'callerPlace', 'outsideLine']) assert.ok(cut.includes(rule), `${rule} never cut on the stress shape`);
  // The bar counts every tool behind the door, and says so in the lane's title.
  const bar = doorBar(big);
  assert.equal(bar.total, big.insertion.dispatcher?.tools_delegating);
  assert.equal(bar.groups.reduce((s, g) => s + g.n, 0), bar.total);
});

test('the label rules: a name cut at its end, a path in its middle keeping the line, a route as its method and last two segments', () => {
  assert.equal(cutEnd('decoratedOnToolCall', 10), 'decorated…');
  assert.equal(cutEnd('short', 10), 'short');
  const p = cutMiddle('prospector-decision-logger.ts:67', 20);
  assert.equal(p.length, 20);
  assert.ok(p.endsWith('.ts:67') && p.includes('…'), p);
  assert.equal(routeLabel("router.post('/locations/:locationId/veo/execute-confirmed-tool')"), 'POST …/veo/execute-confirmed-tool');
  assert.equal(routeLabel("app.get('/health')"), 'GET /health');
  assert.equal(routeLabel('loggedShelfCall'), 'loggedShelfCall');
});

// ---------------------------------------------------------------- 3. the numbers

test('every number on the first screen is the result object\'s, and the technical part says the same number', () => {
  const code = app({ callers: 3, bypass: 2 });
  const h = page(code);
  const first = firstOf(h);
  const tech = text(technicalOf(h));
  const n = (key: string): number => {
    const m = new RegExp(`data-n="${key}">(\\d+)<`).exec(first);
    assert.ok(m !== null, `no ${key} on the first screen`);
    return Number(m[1]);
  };
  const d = code.insertion.dispatcher;
  const g = exposureGrade(code);
  assert.ok(d !== null && g !== undefined);
  // Every marked number is one this test knows: a new one must be added here.
  const keys = new Set([...first.matchAll(/data-n="([a-z-]+)"/g)].map((m) => m[1]));
  const held = new Set(['types', 'syntax', 'delegating', 'tools', 'door-held', 'door-notified', 'door-allowed', 'outside', 'bypass', 'offered', 'unchecked-more', 'cannot-outside']);
  for (const k of keys) assert.ok(held.has(k ?? ''), `the first screen marks "${k}" and nothing holds it`);
  // The credibility line.
  assert.equal(n('types'), code.counts.tools);
  assert.equal(n('syntax'), code.catalog.syntax_only.found);
  assert.ok(tech.includes(`where the scan found ${code.counts.tools} tools`), 'types');
  assert.ok(tech.includes(`finds ${code.catalog.syntax_only.found} tools and misses ${code.catalog.syntax_only.missed}`), 'syntax');
  // The grade: the range, and the entries that decide where in it.
  // Re-pointed by ACP-464 item 8: one grade, today's (the worst case), and the one within reach; its count is in the sentence.
  assert.ok(first.includes(`data-grade-today="${g.worst}"${g.best === g.worst ? '' : ` data-grade-reachable="${g.best}"`}`));
  if (g.best !== g.worst) assert.ok(text(first).includes(`${g.worst} today. ${g.unlisted} tools change data and do not say whether that can be undone`), 'the grade sentence');
  // Re-pointed by ACP-464: the grade's cases are said beside the grade, once; the card that repeated them in the limits is gone.
  assert.ok(!tech.includes(`Worst case ${g.worst}:`) && !tech.includes(`Best case ${g.best}:`), 'the grade sentence is said twice');
  // The card names no file: "lines in reversibility.json decide where you land" is gone (ACP-464 item 8).
  assert.ok(!text(first).includes('decide where you land'));
  // The door.
  assert.equal(n('delegating'), d.tools_delegating);
  assert.equal(n('tools'), code.counts.tools);
  assert.ok(tech.includes(`${d.tools_delegating} tools of ${code.counts.tools} run through it`), 'the application map');
  assert.equal(n('outside'), code.counts.tools - d.tools_delegating);
  assert.ok(tech.includes('Add the same call at the top of the tool that does not go through runTool'), 'the step for the tool outside the door');
  // The bar: each group behind the door, the result's verdicts, said again in step 2.
  const bar = doorBar(code);
  const behind = code.verdicts.filter((v) => v.tool.delegates_to === d.name);
  assert.equal(n('door-held'), behind.filter((v) => v.verdict.verdict === 'ATTEST').length);
  assert.equal(n('door-notified'), behind.filter((v) => v.verdict.verdict === 'ALLOW' && v.verdict.reversibility === 'IRREVERSIBLE').length);
  assert.equal(n('door-allowed'), behind.filter((v) => v.verdict.verdict === 'ALLOW' && v.verdict.reversibility === 'REVERSIBLE').length);
  // The page sets these numbers in bold: the words around a tag are read back without the space the tag left.
  assert.ok(tech.replace(/ ([,.])/g, '$1').includes(`Of the ${bar.total} tools that pass runTool, the draft holds ${n('door-held')}, runs after a notice ${n('door-notified')} and runs with a record ${n('door-allowed')}.`), 'step 2');
  // The paths around the door.
  assert.equal(n('bypass'), bypassPaths(code).length);
  assert.ok(tech.includes(`${bypassPaths(code).length} places where a tool runs another tool without passing ${d.name}`), 'step 3');
  // The line under the door (ACP-464): the headline's tool outside the door, the only part this application has.
  assert.equal(n('cannot-outside'), code.verdicts.filter((v) => v.tool.delegates_to !== d.name && v.verdict.verdict === 'ATTEST').length);
  // The findings.
  const offered = d.caller_checks?.[0]?.offered ?? [];
  assert.equal(n('offered'), offered.length);
  assert.ok(tech.includes(`tells the model about ${offered.length} tools`), 'the entries table');
});

// ---------------------------------------------------------------- 4. the page as a file

test('the page embeds its fonts, references no font by http, loads nothing and runs nothing', () => {
  const h = page(app({ callers: 3, bypass: 2 }));
  for (const f of FONT_FACES) assert.ok(h.includes(`@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,`), f.file);
  assert.equal(count(h, '@font-face'), FONT_FACES.length);
  assert.ok(!/url\((?!data:font\/woff2;base64,)/i.test(h), 'a url() that is not an embedded font');
  assert.ok(!/@import|https?:\/\/[^"'\s]*\.(?:woff2?|ttf|otf)|fonts\.googleapis|fonts\.gstatic/i.test(h), 'a font fetched');
  assert.ok(!/<img|<link|<iframe|\ssrc=/i.test(h), 'the report can fetch something');
  // Changed by the report's owner (2026-09-28): ONE script, allowed by its hash and by nothing wider; it
  // copies, opens a dialog and closes it, and reaches nothing outside the page.
  const scripts = [...h.matchAll(/<script>([^]*?)<\/script>/g)].map((m) => m[1] ?? '');
  assert.equal(count(h, '<script'), 1, 'exactly one script element');
  assert.equal(scripts[0], PAGE_SCRIPT);
  assert.ok(h.includes(`content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src ${scriptHash(scripts[0] ?? '')}"`), 'the CSP allows that script by its hash');
  assert.equal(/script-src ([^;"]*)/.exec(h)?.[1], scriptHash(scripts[0] ?? ''), 'the script source is the hash and nothing else');
  for (const bad of ['fetch', 'XMLHttpRequest', 'import', 'eval', 'Function(', 'src=', 'http', '://', 'WebSocket', 'sendBeacon', 'location']) assert.ok(!(scripts[0] ?? '').includes(bad), bad);
  // No em dash in what the page says (the code it quotes is the reader's own).
  assert.ok(!text(h.replace(/<pre[^]*?<\/pre>/g, '')).includes('—'), 'an em dash in the report text');
});

test('the technical sections carry no number, alternate their band, and an absent section leaves no hole to explain', () => {
  // Re-pointed by the third design (2026-09-28): sections are told apart by the band's tone, never by a number.
  const secs = (h: string): { tone: string; id: string }[] =>
    [...h.matchAll(/<div class="band( white)?"><div class="wrap"><section class="sec" id="([a-z-]+)"><header class="head"><h2>/g)].map((m) => ({ tone: m[1] === undefined ? 'paper' : 'white', id: m[2] ?? '' }));
  const h = page(app({ callers: 3, bypass: 2 }));
  const withEntries = secs(h);
  const noDoor = secs(page(app({ callers: 3, bypass: 2, door: false })));
  assert.ok(!/<span class="no">\d/.test(h), 'a section number');
  for (const list of [withEntries, noDoor]) assert.deepEqual(list.map((x) => x.tone), list.map((_, i) => (i % 2 === 0 ? 'paper' : 'white')));
  // Re-pointed by ACP-464: who is asked comes first, then where ZIFFER goes, then what was read.
  assert.deepEqual(withEntries.slice(0, 3).map((x) => x.id), ['entries', 'insertion', 'limits']);
  assert.ok(!noDoor.some((x) => x.id === 'entries'), 'no dispatcher, no per-entry section');
  assert.equal(noDoor[0]?.id, 'insertion', 'the next section takes its place and its tone');
  assert.equal(withEntries.length, noDoor.length + 1);
});

test('the offered sentence says both facts, in order, and the stubs only when they are all the path would put in front of a model', () => {
  const code = app({ callers: 3, bypass: 0 });
  const h = text(technicalOf(page(code)));
  assert.ok(
    h.includes(
      'The code that installs this path tells the model about 3 tools (scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_"): countShelf0, countShelf1 and purgeShelf0. ' +
        'Nothing on the path refuses a tool name that is not on that list, so a manipulated model could ask for any of the 80 tools the dispatcher knows.',
    ),
    h.slice(h.indexOf('Who is asked'), h.indexOf('Who is asked') + 1200),
  );
  assert.ok(!h.includes('When they are wired'), 'no stub on the list');
});

test('the offered sentence: all stubs said as such, and a stub list beside a tool outside the door said apart', () => {
  const base = app({ callers: 1, bypass: 0 });
  const stub = (v: CodeToolVerdict): CodeToolVerdict => ({ ...v, tool: { ...v.tool, declared_stub: true } });
  const verdicts = base.verdicts.map((v) => (v.tool.name === 'countShelf0' || v.tool.name === 'countShelf1' ? stub(v) : v));
  const code: CodeSection = { ...base, verdicts };
  const c = (offered: string[]): CallerCheck => ({ caller: at('src/desks/desk-0.ts', 12), in_function: 'loggedShelfCall', offered, offered_from: 'scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_"' });
  assert.equal(
    offeredSentence(code, c(['countShelf0', 'countShelf1'])),
    'The code that installs this path tells the model about 2 tools (scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_"): all declared and not wired yet. ' +
      'Nothing on the path refuses a tool name that is not on that list, so a manipulated model could ask for any of the 80 tools the dispatcher knows. ' +
      'When they are wired, this is the path with no confirmation check in front of them.',
  );
  assert.equal(
    offeredSentence(code, c(['countShelf0', 'countShelf1', 'reply'])),
    'The code that installs this path tells the model about 3 tools (scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_"): 2 declared and not wired yet, and reply. ' +
      'Nothing on the path refuses a tool name that is not on that list, so a manipulated model could ask for any of the 80 tools the dispatcher knows. ' +
      'When the 2 stubs are wired, this is the path with no confirmation check in front of them.',
  );
  assert.ok(!(offeredSentence(code, c(['countShelf0', 'countShelf2'])) ?? '').includes('wired, this is the path'));
  assert.equal(offeredSentence(code, { caller: at('src/desks/desk-0.ts', 12), in_function: 'x' }), undefined);
});

// ---------------------------------------------------------------- ACP-464: smaller items (5)

test('ACP-464 item 5: one booking link on the first screen, under the call; the masthead carries none', () => {
  const h = page(app({ callers: 3, bypass: 2 }));
  const first = firstOf(h);
  const mast = /<header class="mast">[^]*?<\/header>/.exec(first)?.[0] ?? '';
  assert.ok(mast !== '', 'no masthead');
  assert.ok(!mast.includes(BOOK_URL), 'the masthead still carries the booking link');
  assert.equal(count(first, `href="${BOOK_URL}"`), 1, 'the first screen carries more or fewer than one booking link');
  const call = /<section class="act" id="first-call">[^]*?<\/section>/.exec(first)?.[0] ?? '';
  assert.ok(call.includes(`href="${BOOK_URL}"`), 'the booking link is not under the call');
  // A booking link lower on the page stays.
  assert.ok(count(h.slice(h.indexOf('<div class="rest">')), `href="${BOOK_URL}"`) >= 1);
});

test('ACP-464 item 5: "What a model can do today" speaks of today in its subtitle, then of what the draft would hold', () => {
  const h = text(page(app({ callers: 3, bypass: 2 })));
  assert.ok(h.includes(`What a model can do today. ${TODAY_LEDE}`) || h.includes(`What a model can do today. ${TODAY_LEDE_TAGGED}`), h.slice(h.indexOf('What a model can do today'), h.indexOf('What a model can do today') + 200));
  for (const l of [TODAY_LEDE, TODAY_LEDE_TAGGED]) assert.ok(l.startsWith('These actions run today with no person in between') && l.includes('would hold'), l);
  assert.equal(todayLede(['held', 'held']), TODAY_LEDE);
  assert.equal(todayLede(['held', 'notified']), TODAY_LEDE_TAGGED);
});

test('ACP-464 item 5: "Who is asked" puts what the model can reach second, in ink, and "Before the call" third', () => {
  const h = page(app({ callers: 3, bypass: 2 }));
  const table = /<table class="r entries">[^]*?<\/table>/.exec(h)?.[0] ?? '';
  const heads = [...table.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Entry', ENTRIES_REACH_HEAD, 'Before the call']);
  const rows = [...table.matchAll(/<tr class="entry[^"]*">([^]*?)<\/tr>/g)].map((m) => [...(m[1] ?? '').matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((c) => c[1] ?? ''));
  assert.ok(rows.length >= 3);
  for (const r of rows) {
    assert.ok((r[1] ?? '').startsWith('<span class="reach">'), `the second cell is not what the model can reach: ${r[1]}`);
    assert.ok(!(r[1] ?? '').includes('muted'), 'the reach cell is grey');
    assert.ok(/class="tag/.test(r[2] ?? ''), `the third cell is not "Before the call": ${r[2]}`);
  }
  // The unbounded row says so in the reach cell.
  assert.ok(rows.some((r) => (r[1] ?? '').includes('not bounded by the source: any tool the dispatcher knows')));
  assert.ok(/table\.entries \.reach\{[^}]*color:var\(--ink\)[^}]*font-weight:600/.test(reportStyle()), 'the reach cell is not in the ink and weight of a headline');
});

// ---------------------------------------------------------------- ACP-464 item 3: the numbers add up in the reader's head

test('ACP-464 item 3: the line under the door reconciles the headline with the door, from one set, stubs said; it adds up for any application', () => {
  const heldUnknown = (t: CodeTool): CodeToolVerdict => ({ tool: t, verdict: heldV(t.name), what_ziffer_does: NO_REVERSIBILITY_ENTRY, untrusted_input: false, egress: false });
  const heldHigh = (t: CodeTool): CodeToolVerdict => ({ tool: t, verdict: { verdict: 'ATTEST', risk: 'HIGH', reversibility: 'REVERSIBLE', effective_tier: 'T3', rule_id: t.name }, what_ziffer_does: 'held', untrusted_input: false, egress: false });
  const base = app({ callers: 3, bypass: 0 });
  const extra: CodeToolVerdict[] = [
    heldUnknown(tool('syncLedger')),
    heldUnknown(tool('postReview')),
    heldUnknown(tool('uploadPhoto')),
    { ...known(tool('sendProspectMail', 'Stub: not wired yet.')), tool: { ...tool('sendProspectMail', 'Stub: not wired yet.'), declared_stub: true } },
    heldHigh(tool('grantRefund')),
  ];
  const verdicts = [...base.verdicts, ...extra];
  const d = base.insertion.dispatcher;
  assert.ok(d !== null);
  const dispatcher = { ...d, tools_delegating: d.tools_delegating + extra.length };
  const code: CodeSection = { ...base, verdicts, catalog: { ...base.catalog, tools: verdicts.map((v) => v.tool), dispatchers: [dispatcher] }, insertion: { ...base.insertion, dispatcher }, counts: countsOf(verdicts) };
  const g = exposureGrade(code);
  const p = heldParts(code);
  assert.ok(g !== undefined && p !== undefined);
  assert.equal(g.tools, 85, '81 of app(), four live extras');
  // The sets: 10 marked behind the door + reply outside it = the headline's 11; the door holds 10 + 3 + 1 stub + 1 HIGH = 15.
  assert.equal(p.cannot, g.known + g.derived);
  assert.deepEqual({ held: p.held, cannot: p.cannot, unknown: p.unknown, stubs: p.stubs, other: p.other, outside: p.outside, notice: p.notice }, { held: 15, cannot: 11, unknown: 3, stubs: 1, other: 1, outside: ['reply'], notice: 0 });
  // The identity the line is built on, and the door's own count.
  assert.equal(p.cannot - p.outside.length - p.notice + p.unknown + p.stubs + p.other, p.held);
  const first = firstOf(page(code));
  assert.equal(Number(/data-n="door-held">(\d+)</.exec(first)?.[1]), p.held);
  const line = text(/<p class="door-note"[^]*?<\/p>/.exec(first)?.[0] ?? '').replace(/ ([.,:])/g, '$1');
  assert.equal(
    line.trim(),
    '3 more are held because the draft cannot tell whether they can be undone. 1 held tool is declared and not wired yet, so not among the 85. ' +
      '1 more is held because the engine grades it HIGH risk. 1 of the 11 that cannot be undone does not pass the door: reply.',
  );
  // The headline says 11, and the stubs sentence cannot be read as the held count.
  const h = codeHeadlineScreen(code);
  assert.equal(h.act, '11 of them cannot be undone.');
  assert.ok(h.rest.includes('1 further tool is declared and not wired yet; it is not among the 85.'), h.rest.join(' | '));
  assert.ok(!h.rest.some((r) => /stubs?, not counted/.test(r)));
  // When the two numbers already agree, no line.
  const agree = app({ callers: 3, bypass: 0 });
  const inside: CodeSection = { ...agree, verdicts: agree.verdicts.filter((v) => v.tool.name !== 'reply'), counts: countsOf(agree.verdicts.filter((v) => v.tool.name !== 'reply')) };
  assert.ok(!page(inside).includes('class="door-note"'), 'a line when the numbers already agree');
});

// ---------------------------------------------------------------- ACP-464 item 4: a tool that does not pass the door is not among its outputs

test('ACP-464 item 4: a tool that does not pass the door is drawn beside it, in the lane of what goes around it, never in the column of its outcomes', () => {
  for (const [outside, paths] of [[1, 2], [1, 0], [11, 14]] as const) {
    const code = shapedApp({ tools: 60, callers: 3, paths, outside });
    const d = doorDiagram(code);
    const svg = svgOf(d);
    const g = geometry(svg);
    const label = g.labels.find((l) => l.rule === 'outsideLine');
    assert.ok(label !== undefined, 'no outside label');
    const box = g.rects.find((r) => label.x >= r.x && label.x < r.x + r.w && label.y >= r.y && label.y < r.y + r.h);
    assert.ok(box !== undefined, 'the names sit in no box');
    // The door's outcomes are the pills at the right; the outside box ends before the door's own path down.
    const pills = [...svg.matchAll(/data-n="door-(held|notified|allowed|refused)"/g)];
    assert.ok(pills.length >= 3);
    const outcomeX = Math.min(...g.rects.filter((r) => r.h === 36).map((r) => r.x));
    assert.ok(box.x + box.w < outcomeX, `the outside box reaches the outcomes column (${box.x + box.w} >= ${outcomeX})`);
    assert.ok(box.x + box.w < 552, 'the outside box is not beside the door');
    // It is in the lane under the door: below every caller card and level with the paths around it.
    assert.ok(box.y > 264, `the outside box is not in the lane under the door (y ${box.y})`);
    if (paths > 0) {
      const pill = /<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="34"/.exec(svg);
      assert.ok(pill !== null && Math.abs(Number(pill[1]) + 17 - (box.y + box.h / 2)) < 1, 'the outside box and the path around the door are not one lane');
    }
    // No wire from the door's fan goes to it: the fan has exactly one wire per outcome.
    // The fan leaves the door at x 690 (the door's right edge, 634, plus 56).
    assert.equal(count(svg, 'd="M690 150'), pills.length, 'a wire from the door leads to the outside tools');
    assert.ok(svg.includes(`${outside === 1 ? 'tool does not pass the door: it needs its own call' : 'tools do not pass the door: each needs its own call'}`));
    assertLegible(svg, `outside ${outside}`);
    // The narrow list: the outside row is in the group "Around the door", after the door's outcomes.
    const list = listOf(d);
    const around = list.indexOf('<p class="dh">Around the door</p>');
    assert.ok(around > list.indexOf('Behind it, under the draft policy') && list.indexOf('<div class="row outside">') > around, list);
  }
});

test('ACP-464: a number set in bold inside a row of the narrow door list stays in its sentence ("82 of 83 tools pass it")', () => {
  const css = reportStyle();
  // Only the row's heading is a block; a <b> inside its sentence is inline.
  assert.ok(css.includes('.door-list .row>b{display:block'), 'the row heading rule');
  assert.ok(!/\.door-list \.row b\{[^}]*display:block/.test(css), 'every <b> in a row is a block, so a number inside a sentence breaks onto its own line');
});
