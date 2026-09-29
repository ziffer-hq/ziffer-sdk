/**
 * The `--code` report as one page (ACP-455 presentation, third design, 2026-09-28), in the
 * prototype's order (report-v3): the top of the page (nav, headline and grade, door, findings, the
 * call); "In plain words" in three bands; the divider; the technical sections, one band each, the
 * tone alternating (never a number: a section that is absent leaves no hole to explain); the legend
 * and the appendix, folded; the footer.
 *
 * It loads nothing: the Content-Security-Policy is `default-src 'none'` with inline styles, `data:`
 * fonts and ONE script allowed by its hash (`script.ts`: copy, open a dialog, close it). Code the
 * reader copies has a Copy button; a long module, a long group of rows and the appendix open in a
 * `<dialog>`, whose content is shown in place when no script runs and when the page is printed.
 */

import type { CodeSection } from '../code/types.js';
import type { ReplayResult } from '../replay/replay.js';
import type { ScanResult } from '../types.js';
import type { AnnexSource } from './annex.js';
import { assistantConfigHtml, CodeHtml, isUnknown, PLACEHOLDERS_ID, secHtml, type Sec } from './code-html.js';
import { andList, notScannedSentence, scopeOf } from './code.js';
import {
  BOOK_TEXT,
  BOOK_URL,
  codeExecSummary,
  MCP_TEXT,
  MCP_URL,
  STEER_ACTS,
  STEER_HONEST,
  STEER_LEAD,
  STEER_STEPS,
  steerCondition,
  steerWrites,
  todayLede,
  WHAT_CHANGES_TILES,
  WHAT_CHANGES_WHEN,
  type ExecBullet,
} from './exec.js';
import { BULLET_TAG } from './exec-html.js';
import { FIRST_FINDINGS, firstFindings, firstScreen } from './first.js';
import { FONT_SRC } from './fonts.js';
import { ARCHIVE_FILE, ARCHIVE_POLICY_DIR, CTA_TEXT, DRAFT_NOTICE, escapeHtml } from './names.js';
import { reportStyle } from './page-style.js';
import { PAGE_SCRIPT, scriptHash } from './script.js';
import { REVIEW_URL } from './terminal.js';
import type { ReportContext } from './file.js';

const e = escapeHtml;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export interface CodePageInput {
  result: ScanResult;
  code: CodeSection;
  ctx: ReportContext;
  /** Scan-result text, escaped, home paths as `~`. */
  t: (s: string) => string;
  /** Replay or policy text, redacted and escaped. */
  r: (s: string) => string;
  title: string;
  /** The installed half's parts, folded one `<details>` each (`file.ts`). */
  installedParts: (folded: boolean) => string[];
  replayParts: () => string[];
  showMcp: boolean;
  placeholderBoxes: readonly string[];
  installedTiles: { servers: number; tools: number; clients: number; irreversible: number; high: number };
  /** The installed half's summary sentences (`summarySentences`). */
  sentences: readonly string[];
  replayed: ReplayResult | undefined;
  source: AnnexSource;
}

/** The plain part's reply warning is said only when the top of the page does not already say it. */
function replyOnTop(code: CodeSection, skills: ScanResult['skills']): boolean {
  return firstFindings(code, skills).slice(0, FIRST_FINDINGS).some((f) => f.kind === 'reply');
}

/** A tool list as the table's middle column: up to three names, then "+ N" for the rest of the group. */
function toolCell(b: ExecBullet, t: (s: string) => string): string {
  const more = b.size - b.tools.length;
  return `${b.tools.map(t).join(', ')}${more > 0 ? ` + ${more}` : ''}`;
}

/**
 * "In plain words" (ACP-455, third design): three bands, each for the person who decides. What a
 * model can do today, one row per group of the summary's bullets; how an outsider could steer it, in
 * the one orange band; what ZIFFER changes, three tiles. A block with no data is left out. Every word
 * is `ExecSummary`'s or a builder's in `exec.ts`; what the top of the page and the technical part
 * already say (the grade, the entries with no check, the paths around the door, the work) is not
 * repeated here.
 */
function plainBands(code: CodeSection, result: ScanResult, source: AnnexSource, t: (s: string) => string): string[] {
  const s = codeExecSummary(code, result, source);
  const out: string[] = [];
  const eyebrow = '<p class="eyebrow">In plain words</p>';
  let first = true;
  const brow = (): string => {
    const x = first ? eyebrow : '';
    first = false;
    return x;
  };
  if (s.bullets.length > 0) {
    const head = ['What it does', 'Tools', 'Why the draft holds it'];
    const rows = s.bullets.map((b) => {
      const pill = b.kind === 'held' ? '' : `<span class="tag${b.kind === 'notified' ? '' : ' no'} pill-tag">${BULLET_TAG[b.kind].word}</span><br>`;
      const cells = [`${pill}<b>${e(b.lead)}</b>`, toolCell(b, t), e(b.text)];
      return (
        `<tr class="xb xb-${b.kind}" data-kind="${b.kind}" data-tools="${e(b.tools.join(' '))}">` +
        cells.map((c, i) => `<td${i === 1 ? ' class="n"' : ''}${i === 0 ? '' : ` data-l="${head[i] ?? ''}"`}>${c}</td>`).join('') +
        '</tr>'
      );
    });
    const reply = s.reply !== undefined && !replyOnTop(code, result.skills) ? `<p class="cond reply-warn">${e(s.reply)}</p>` : '';
    // The data-leaving pair is said in the outsider band; with no outsider path, under this table.
    const leak = s.leak !== undefined && s.steering === undefined ? `<p class="cond">${t(s.leak.line)} <a href="#leak">Read it</a></p>` : '';
    out.push(
      '<section class="band white" id="plain"><div class="wrap">',
      `<div class="head c">${brow()}<h2>What a model can do today. <span>${e(todayLede(s.bullets.map((b) => b.kind)))}</span></h2></div>`,
      `<div class="card"><table class="acts"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
      `<p class="cond">${e(s.subline)}</p>${reply}${leak}`,
      '</div></section>',
    );
  }
  if (s.steering !== undefined) {
    const st = s.steering;
    const cond = steerCondition(st.gates);
    const gates = cond.gates.map((g) => `<code>${t(g.name)}</code> (${t(g.at)})`);
    const example = st.targets[0];
    const leak = s.leak === undefined ? '' : `<p class="fine">${t(s.leak.line)} <a href="#leak">Read it</a></p>`;
    out.push(
      `<section class="band ink" id="steer"><div class="wrap og">`,
      `<div>${brow()}<h2>How an outsider could steer it.</h2><p>${e(STEER_LEAD)}</p>` +
        `<p class="fine">${e(STEER_HONEST)} ${e(cond.lead)}${gates.length === 0 ? '' : ` ${andList(gates)}.`}</p>${leak}</div>`,
      '<div>' +
        `<div class="vec"><i>${e(STEER_STEPS[0])}</i>${e(steerWrites(st.words))}</div>` +
        `<div class="vec"><i>${e(STEER_STEPS[1])}</i>${st.readers.map((r) => `<code>${t(r)}</code>`).join(', ')}</div>` +
        `<div class="vec"><i>${e(STEER_STEPS[2])}</i>${e(STEER_ACTS)}${example === undefined ? '' : `, such as <code>${t(example)}</code>`}.</div>` +
        '</div>',
      '</div></section>',
    );
  }
  out.push(
    `<section class="band white" id="changes"><div class="wrap">`,
    `<div class="head c">${brow()}<h2>What ZIFFER changes. <span>${e(WHAT_CHANGES_WHEN)}</span></h2></div>`,
    `<ul class="tiles">${WHAT_CHANGES_TILES.map((w) => `<li class="tile"><b>${e(w.title)}</b><span>${e(w.text)}</span></li>`).join('')}</ul>`,
    '</div></section>',
  );
  return out;
}

export function renderCodePage(x: CodePageInput): string {
  const { result, code, ctx, t, r } = x;
  const p = ctx.policy;
  const cw = new CodeHtml({
    code,
    policy: p.files,
    catalog: result.catalog,
    unknown: new Set(result.classifications.filter((c) => isUnknown(c.reason)).map((c) => `${c.server}\u0000${c.tool}`)),
    t,
    ...(result.skills === undefined ? {} : { skills: result.skills }),
    ...(ctx.codeSdks === undefined ? {} : { codeSdks: ctx.codeSdks }),
  });
  const s = codeExecSummary(code, result, x.source);

  // The policy's tail: the placeholders, folded, and what signed the draft.
  const tail = [
    `<details class="inner placeholders" id="${PLACEHOLDERS_ID}"><summary>Placeholders to replace before this policy is used</summary>`,
    ...x.placeholderBoxes,
    '</details>',
    `<p class="say">${t(DRAFT_NOTICE)} Tree hash <code>${r(p.treeHash)}</code>, tenant <code>${r(p.tenantId)}</code>, ` +
      `${r(plural(p.files.length, 'file'))} in the <code>${ARCHIVE_POLICY_DIR}/</code> folder of the archive.</p>`,
  ].join('\n');

  // The installed half: tiles and its four parts, or the one sentence that says it was not scanned.
  const installedSkipped = notScannedSentence('installed', scopeOf(result));
  let installed: Sec | undefined;
  if (x.showMcp) {
    const n = x.installedTiles;
    const tile = (v: number, label: string): string => `<div><b>${v}</b><span>${label}</span></div>`;
    installed = {
      id: 'installed',
      title: 'Tools installed in your AI assistants',
      lede: `${t(x.sentences[0] ?? '')}. ${t(x.sentences[1] ?? '')}.`,
      body:
        `<div class="limits">${tile(n.servers, `tool servers configured in ${e(plural(n.clients, 'AI assistant'))}`)}${tile(n.tools, 'tools an AI assistant can call')}` +
        `${tile(n.irreversible, 'cannot be undone, drafted from name and description')}${tile(n.high, 'HIGH findings: ways a tool can be turned against you')}</div>` +
        x.installedParts(true).join('\n'),
    };
  } else if (installedSkipped !== undefined) {
    installed = { id: 'installed', title: 'Tools installed in your AI assistants', lede: '', body: `<p>${e(installedSkipped)}</p>` };
  }
  // What this repository configures for a developer's coding assistant is about the assistant, not the application
  // (ACP-464): said here, by the note's kind. In a code-only scan the sentence above still says the assistants were not scanned.
  const assistantConfig = assistantConfigHtml(code, t);
  if (assistantConfig !== '') {
    installed =
      installed === undefined
        ? { id: 'installed', title: 'Tools installed in your AI assistants', lede: '', body: assistantConfig }
        : { ...installed, body: `${installed.body}\n${assistantConfig}` };
  }
  const replay: Sec | undefined =
    x.replayed === undefined
      ? undefined
      : { id: 'replay', title: 'Replay', lede: 'What an AI agent obeying an injected instruction would do, with and without the draft policy.', body: x.replayParts().join('\n') };

  const sections = [
    // Who is asked, then where ZIFFER goes, then what was read (ACP-464): the limits stop being the first wall.
    cw.entries(),
    cw.insertion(),
    cw.limits(),
    cw.policy(tail),
    cw.leak(),
    cw.instructions(),
    cw.skills(),
    cw.threats(s.heat),
    cw.matters(s.matters),
    installed,
    replay,
  ].filter((z): z is Sec => z !== undefined);
  // No numbers: the band changes tone from one section to the next, paper first, after the divider.
  const bands = sections.map((sec, i) => secHtml(sec, i % 2 === 0 ? 'paper' : 'white'));

  const d = code.insertion.dispatcher;
  const footer = [
    `<div class="band${bands.length % 2 === 0 ? ' white' : ''}"><div class="wrap"><footer class="foot">`,
    '<h2>Next</h2>',
    '<div>',
    '<ol class="next">',
    `<li><a href="${BOOK_URL}" rel="noopener noreferrer">${e(BOOK_TEXT)}</a>.</li>`,
    `<li>Paste the ZIFFER call ${d === null ? 'into each tool' : `at the top of <code>${t(d.name)}</code>`}: <a href="#insertion">the steps are above</a>.</li>`,
    `<li>Review and sign the draft policy: <a href="${REVIEW_URL}" rel="noopener noreferrer">${e(CTA_TEXT)}</a>, and attach <code>${ARCHIVE_FILE}</code> to the email from that page.</li>`,
    `<li><a href="${MCP_URL}" rel="noopener noreferrer">${e(MCP_TEXT)}</a>.</li>`,
    '</ol>',
    `<p class="meta-line">Scanned ${t(result.date)} on ${t(ctx.machine)} · @ziffer-io/scan ${t(result.scan_version)} · engine ${t(result.engine_pin)}. ` +
      `Computed on that machine; nothing was sent anywhere. This file travels in <code>${ARCHIVE_FILE}</code> with the draft policy and the scan’s JSON document.</p>`,
    '</div>',
    '</footer></div></div>',
  ];

  const out = [
    '<!doctype html>',
    '<html lang="en" class="noscript">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; ${FONT_SRC}; script-src ${scriptHash()}">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${t(x.title)}</title>`,
    `<style>${reportStyle()}</style>`,
    '</head>',
    '<body>',
    '<main id="executive-summary" aria-labelledby="exec-h">',
    firstScreen(code, { date: result.date }, result.skills),
    '<div class="rest">',
    ...plainBands(code, result, x.source, t),
    '<section class="divider" id="technical"><div class="wrap"><p class="eyebrow">Technical report</p><h2>For your engineers.</h2></div></section>',
    ...bands,
    `<div class="band tight${bands.length % 2 === 0 ? '' : ' white'}"><div class="wrap">`,
    cw.legend(),
    cw.appendix(),
    '</div></div>',
    ...footer,
    '</div>',
    '</main>',
    `<script>${PAGE_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ];
  return `${out.join('\n')}\n`;
}
