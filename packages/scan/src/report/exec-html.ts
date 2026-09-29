/**
 * The executive summary as HTML (ACP-455): the page's first section, for a
 * reader who never opens the technical report below it, and the MITRE ATLAS /
 * OWASP view in both its sizes (the cells in the summary, the table in the
 * technical report).
 *
 * Every word comes from `report/exec.ts`; this file only lays it out. It loads
 * nothing: the cells are CSS, the links are plain anchors the page's CSP
 * allows (navigation is not a fetch).
 */

import { OWASP_EXCESSIVE_AGENCY, OWASP_FRAMEWORK, owaspNote } from './owasp.js';
import { BOOK_TEXT, BOOK_URL, MATTERS_INTRO, MCP_TEXT, MCP_URL, TECH_TEXT, todayIntro, WHAT_CHANGES, type BulletKind, type ExecSummary, type HeatCell } from './exec.js';
import { gradeShort, gradeTitle, type ExposureGrade } from './code.js';
import { gradeBox } from './code-html.js';
import { escapeHtml } from './names.js';

/** The badge a bullet carries: what happens to its tools, in words beside the colour. */
export const BULLET_TAG: Record<BulletKind, { cls: string; word: string }> = {
  held: { cls: 'b-held', word: 'ZIFFER HOLDS' },
  notified: { cls: 'b-notified', word: 'NOTICE ONLY UNDER THE DRAFT' },
  refused: { cls: 'b-refused', word: 'NO RULE YET' },
};

/** The badge of a line on what one call at the dispatcher does not see, or an entry with no check found. */
export const UNSEEN_TAG: Record<'bypass' | 'unchecked', string> = { bypass: 'NOT SEEN BY THE ONE CALL', unchecked: 'NO CHECK FOUND' };

/**
 * The same, on the `--code` page (ACP-455 presentation): there the one colour that means "act" is
 * used for nothing else, so the cells are shaded in ink and warm greys, and the legend says so.
 */
export const CODE_HEAT_LEGEND =
  'Shade: ink, at least one tool counted is one the engine treats as impossible to undo or has no rule for; ' +
  'sand, every tool counted can be undone; white, the scan counted none; striped grey, the scan has no way to measure it. ' +
  'The last line of each says what ZIFFER does about the technique.';

/** What a heat cell's colour means, said once under the cells. */
export const HEAT_LEGEND =
  'Colour: dark orange, at least one tool counted is one the engine treats as impossible to undo or has no rule for; ' +
  'sand, every tool counted can be undone; white, the scan counted none; grey, the scan has no way to measure it. ' +
  'The last line of each says what ZIFFER does about the technique.';

const e = escapeHtml;

function heatWords(h: HeatCell): string {
  if (h.count === undefined) return 'not measured by this scan';
  return h.count === 0 ? 'no' : `yes · ${h.count} ${h.count === 1 ? 'tool' : 'tools'}`;
}

/**
 * What ZIFFER does about each technique, one plain sentence, read after "With ZIFFER:". The
 * dossier's own position cell ("Out of scope by design", "B-2: no direct tool access", "§6
 * closed grammar; conceded as unnovel") is ZIFFER's threat model talking about ZIFFER, in its
 * own ids; printed in a report about the reader's application it read as a statement about
 * THEIR code. The executive cells and the technical table print this sentence and nothing
 * else, so the two say the same thing. A technique with no sentence here is not shown.
 */
export const TECHNIQUE_GLOSS: Readonly<Record<string, string>> = {
  'AML.T0051': 'a manipulated model still cannot act without authorisation',
  'AML.T0051.001': 'injected text can still reach the model, and whatever the model then tries still needs authorisation',
  'AML.T0086': 'every send needs authorisation; a leak through a send your policy allows is closed only by the policy you sign',
  'AML.T0110': 'a tool cannot be changed or swapped without a new policy signed with your offline key',
  [OWASP_EXCESSIVE_AGENCY.dossierId]: 'a call your signed policy holds waits for a named person, and a call with no rule does not run',
};

/** "With ZIFFER: …", or undefined for a technique with no sentence. */
export function withZiffer(id: string): string | undefined {
  const gloss = TECHNIQUE_GLOSS[id];
  return gloss === undefined ? undefined : `With ZIFFER: ${gloss}.`;
}

/**
 * The id a reader looks up: the dossier keys its one OWASP row by the 2025 number without a year;
 * the page prints the current edition's id, with the year, from `owasp.ts`.
 */
export function shownId(h: Pick<HeatCell, 'framework' | 'id'>): string {
  return h.framework === OWASP_FRAMEWORK && h.id === OWASP_EXCESSIVE_AGENCY.dossierId ? OWASP_EXCESSIVE_AGENCY.id : h.id;
}

/** The name a reader looks up: the OWASP row's title is the edition's, from `owasp.ts`; every other row keeps the dossier's. */
export function shownName(h: Pick<HeatCell, 'framework' | 'id' | 'name'>): string {
  return h.framework === OWASP_FRAMEWORK && h.id === OWASP_EXCESSIVE_AGENCY.dossierId ? OWASP_EXCESSIVE_AGENCY.title : h.name;
}

/** The cells, no prose: the summary's size. */
export function heatMini(all: readonly HeatCell[], legend: string = HEAT_LEGEND): string {
  // The executive cells are MITRE ATLAS only: OWASP rows under a MITRE heading, two of them
  // naming one idea, read as a confused mapping. The technical table keeps both lists.
  const cells = all.filter((h) => h.framework === 'MITRE ATLAS' && withZiffer(h.id) !== undefined);
  if (cells.length === 0) return '';
  const cell = (h: HeatCell): string =>
    `<div class="hc hc-${h.level}">` +
    `<span class="hc-id">${e(h.id)}</span>` +
    `<span class="hc-n">${e(h.name)}</span>` +
    `<span class="hc-v">In your code: <b>${e(heatWords(h))}</b></span>` +
    `<span class="hc-s">${e(withZiffer(h.id) ?? '')}</span>` +
    '</div>';
  return `<div class="heat" role="list" aria-label="MITRE ATLAS techniques for tool-calling models">${cells.map(cell).join('')}</div><p class="heat-legend">${e(legend)}</p>`;
}

/** The table: the technical report's size, every tool counted and the chapter's own mechanism. */
export function heatTable(all: readonly HeatCell[], toolName: (s: string) => string, legend: string = HEAT_LEGEND): string {
  const cells = all.filter((h) => withZiffer(h.id) !== undefined);
  if (cells.length === 0) return '';
  const rows = cells.map((h) => {
    const tools =
      h.tools.length === 0
        ? '<span class="muted">none</span>'
        : h.tools.length <= 8
          ? h.tools.map(toolName).join(', ')
          : `<details class="desc"><summary>${h.tools.length} tools</summary><p>${h.tools.map(toolName).join(', ')}</p></details>`;
    return (
      `<tr class="hr-${h.level}">` +
      `<td data-label="Technique"><span class="hc-dot hc-${h.level}" aria-hidden="true"></span><code>${e(shownId(h))}</code><br>${e(shownName(h))} <span class="muted small">${e(h.framework)}</span></td>` +
      `<td data-label="In your code"><b>${e(heatWords(h))}</b><br><span class="small">${e(h.evidence)}</span></td>` +
      `<td data-label="Tools involved">${tools}</td>` +
      `<td data-label="With ZIFFER">${e(withZiffer(h.id) ?? '')}</td>` +
      '</tr>'
    );
  });
  return (
    '<section id="atlas">' +
    '<h2>MITRE ATLAS and OWASP: what this scan saw</h2>' +
    '<p class="takeaway">The techniques that apply to a model calling tools, each with what the scan counted in your code and what ZIFFER does about it.</p>' +
    '<div class="scroll"><table class="atlas"><thead><tr><th scope="col">Technique</th><th scope="col">In your code</th><th scope="col">Tools involved</th><th scope="col">With ZIFFER</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table></div>` +
    `<p class="small muted">${e(legend)} Only the techniques about a model that calls tools are shown; the rest of the matrix is not about this scan.</p>` +
    (cells.some((h) => h.framework === OWASP_FRAMEWORK) ? `<p class="small muted">${e(owaspNote())}</p>` : '') +
    '</section>'
  );
}

function gradeTile(g: ExposureGrade): string {
  return '<div class="xgrade">' + gradeBox(g) + `<p><b>${e(gradeTitle(g))}.</b> ${e(gradeShort(g))}</p>` + '</div>';
}

/** The summary section and the divider after it. `names` renders a tool name (escaped, home paths hidden). */
export function execHtml(s: ExecSummary, kicker: string, names: (s: string) => string): string {
  const out: string[] = ['<section class="exec" id="executive-summary" aria-labelledby="exec-h">'];
  out.push(`<p class="kicker">${e(kicker)}</p>`, `<h1 id="exec-h" class="exec-h">${e(s.headline)}</h1>`, `<p class="exec-sub">${e(s.subline)}</p>`);
  out.push('<div class="exec-cols">', '<div class="exec-main">');
  const unseen = s.unseen ?? [];
  if (s.bullets.length > 0 || unseen.length > 0) {
    out.push('<h2>What a model can do today</h2>', `<p class="today">${e(todayIntro(s))}</p>`, '<ul class="xlist">');
    for (const b of s.bullets) {
      const tag = BULLET_TAG[b.kind];
      out.push(
        `<li class="xb xb-${b.kind}" data-kind="${b.kind}" data-tools="${e(b.tools.join(' '))}">` +
          `<span class="badge ${tag.cls}">${tag.word}</span> <b>${e(b.lead)}.</b> ` +
          `${e(b.text)} <span class="xnames">${b.tools.map(names).join(', ')}</span></li>`,
      );
    }
    for (const u of unseen) {
      const href = u.kind === 'bypass' ? '#bypass' : '#entries';
      out.push(`<li class="xb xb-${u.kind}" data-kind="${u.kind}"><span class="badge b-refused">${UNSEEN_TAG[u.kind]}</span> ${e(u.text)} <a href="${href}">See the technical part</a>.</li>`);
    }
    out.push('</ul>');
    if (s.reply !== undefined) out.push(`<p class="reply-warn">${e(s.reply)}</p>`);
  }
  if (s.steering !== undefined || s.leak !== undefined) {
    out.push(
      '<div class="steer" id="steer"><h2>How an outsider could steer it</h2>',
      ...(s.steering === undefined ? [] : [`<p>${e(s.steering.text)}</p>`]),
      ...(s.leak === undefined ? [] : [`<p class="leak">${e(s.leak.text)}</p>`]),
      '<p class="small muted">A path your code allows, read from the tools’ own names and descriptions; not a record that anyone has used it.</p></div>',
    );
  }
  out.push('</div>', '<aside class="exec-side">');
  if (s.grade !== undefined) out.push(gradeTile(s.grade));
  out.push(
    `<a class="cta cta-book" href="${BOOK_URL}" rel="noopener noreferrer">${e(BOOK_TEXT)}</a>`,
    `<p class="side-link"><a href="${MCP_URL}" rel="noopener noreferrer">${e(MCP_TEXT)}</a></p>`,
    `<p class="side-link"><a href="#technical">${e(TECH_TEXT)} &#8595;</a></p>`,
    '</aside>',
    '</div>',
  );
  out.push('<div class="exec-lower">');
  out.push('<div class="matters-box"><h2>Why it matters</h2>');
  if (s.matters.length > 0) {
    out.push(`<p class="matters-intro">${e(MATTERS_INTRO)}</p>`);
    const frameworks = [...new Set(s.matters.map((m) => m.framework))];
    out.push(
      '<ul class="matters">' +
        frameworks
          .map((f) => {
            const rows = s.matters.filter((m) => m.framework === f);
            return `<li><b>${e(f)}</b>: ${rows.map((m) => `${e(m.clause)}, ${e(m.asks.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()))} <span class="st st-${m.status === 'built' ? 'built' : m.status === 'partial' || m.status === 'lands in' ? 'partial' : 'open'}">ZIFFER: ${e(m.status_words)}</span>`).join('; ')}.</li>`;
          })
          .join('') +
        '</ul>',
      '<p class="small muted">Each status is the one ZIFFER’s own control mapping gives its answer to that article, word for word.</p>',
    );
  }
  out.push(heatMini(s.heat), '</div>');
  out.push(
    '<div class="changes-box"><h2>What ZIFFER changes</h2>',
    `<ol class="changes">${WHAT_CHANGES.map((w) => `<li>${e(w)}</li>`).join('')}</ol>`,
    `<p class="work"><b>${e(s.work)}</b></p>`,
    `<p class="exec-cta"><a class="cta cta-book" href="${BOOK_URL}" rel="noopener noreferrer">${e(BOOK_TEXT)}</a></p>`,
    '</div>',
  );
  out.push('</div>', '</section>');
  out.push('<div class="tech-divider" id="technical"><p class="eyebrow">Technical report</p><h2>For your engineers.</h2></div>');
  return out.join('\n');
}

/**
 * The summary's styles, the ATLAS view's, and the print rules: the summary on
 * one A4 page, the technical report from the next, every `<details>` open.
 */
export const EXEC_STYLE = `
header.tech-top{margin:0 0 14px}
h2.tech-title{font-size:28px;margin:0 0 10px}
ol.next{padding-left:22px}ol.next li{margin:6px 0}
.exec{background:var(--card);border-radius:var(--r);box-shadow:var(--sh-m);padding:28px 32px 30px;margin:0}
.kicker{margin:0 0 10px;font:400 12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:10px}
.kicker:before{content:"";width:7px;height:7px;background:var(--orange);transform:rotate(45deg);flex:none}
h1.exec-h{font-size:32px;line-height:1.22;margin:0 0 10px}
.exec-sub{margin:0 0 14px;font-size:16px;color:var(--muted)}
.exec h2{font-size:18px;margin:22px 0 8px;padding:0;border:0}
.exec-cols{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:10px 32px;align-items:start}
p.today{margin:0 0 10px;font-size:15px;color:var(--muted)}
ul.xlist{list-style:none;margin:0;padding:0}
li.xb{padding:10px 0;border-bottom:1px solid var(--rule-soft);font-size:15px;line-height:1.45}
li.xb:last-child{border-bottom:0}
.xnames{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere;margin-top:2px}.xnames code{font-size:inherit;white-space:normal}
.reply-warn{background:var(--orange-tint);border-radius:12px;padding:12px 16px}
.steer{background:var(--dark);color:var(--on-dark-2);border-radius:var(--r);padding:6px 20px 12px;margin:16px 0 0}
.steer h2{color:var(--on-dark)}
.steer p{margin:6px 0;font-size:15px}.steer .muted{color:#B8B0A0}
.exec-side{background:var(--paper);border-radius:var(--r);padding:18px 20px}
.xgrade{display:flex;gap:12px;align-items:flex-start;margin:0 0 14px}
.xgrade .grade{width:58px;height:58px;font-size:36px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:var(--paper);background:var(--ink);font-weight:700;line-height:1}
.xgrade p{margin:0;font-size:13px;line-height:1.45}
.xgrade .grade.grade-range{width:auto;min-width:58px;padding:0 10px;font-size:24px;gap:4px}.xgrade .grade .to{font-size:11px}
.matters-intro{margin:0 0 6px;font-size:14.5px;font-weight:600}
a.cta.cta-book{display:block;text-align:center;font-size:16px;padding:13px 16px}
.exec-cta a.cta.cta-book{display:inline-block}
.side-link{margin:12px 0 0;font-size:14px}
.exec-lower{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:10px 32px;margin-top:10px;border-top:1px solid var(--rule-soft)}
ul.matters{margin:0;padding-left:18px;font-size:14.5px}ul.matters li{margin:4px 0}
ol.changes{margin:0;padding-left:20px;font-size:15px}ol.changes li{margin:4px 0}
.work{margin:10px 0;font-size:15px}
.exec-cta{margin:12px 0 0}
.heat{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 6px}
.hc{display:flex;flex-direction:column;gap:2px;border-radius:12px;padding:8px 10px;border:1px solid var(--rule);font-size:12px;line-height:1.35;min-width:0}
.hc-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600}
.hc-n{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.hc-s{font-size:11px;opacity:.9}
.hc-high{background:var(--orange-dark);border-color:var(--orange-dark);color:#ffffff}
.hc-low{background:#EAD9B0;border-color:#D8C28E}
.hc-none{background:var(--card)}
.hc-unmeasured{background:#E4E1DC;border-color:#D2CEC7;color:var(--muted)}
.heat-legend{font-size:11.5px;color:var(--muted);margin:4px 0 0}
span.hc-dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;padding:0;border:1px solid var(--rule)}
table.atlas td{font-size:13.5px}table.atlas td code{white-space:normal}
.tech-divider{text-align:center;margin:56px 0 0}
.tech-divider .eyebrow{display:flex;justify-content:center;align-items:center;gap:10px;margin:0 0 12px;font:400 12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.tech-divider .eyebrow:before{content:"";width:7px;height:7px;background:var(--orange);transform:rotate(45deg);flex:none}
.tech-divider h2{font-size:34px;margin:0}
@media (max-width:900px){.exec-cols,.exec-lower{grid-template-columns:minmax(0,1fr)}.exec{padding:20px 18px}}
@media (max-width:560px){h1.exec-h{font-size:24px}.heat{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media print{
@page{size:A4;margin:10mm 11mm}
body{background:#ffffff;font-size:11px;line-height:1.4}
main,main.code{max-width:none;padding:0}
header.top.exec-top{margin:0 0 4px;padding:0}header.exec-top svg.logo{height:22px}.kind{font-size:10px}
.exec{border:0;border-top:3px solid var(--orange);border-radius:0;padding:6px 0 0;margin:0;break-after:page;page-break-after:always}
.kicker{font-size:9.5px}
h1.exec-h{font-size:19px;margin:0 0 4px}
.exec-sub{font-size:10.5px;margin:0 0 4px}
.exec h2{font-size:10.5px;margin:6px 0 3px}
p.today{font-size:10.5px;margin:0 0 4px}
li.xb{font-size:10.5px;padding:3px 0 3px 8px;margin:0 0 3px;line-height:1.35}
.xnames{font-size:8.5px}
.badge{font-size:8px}
.steer{padding:1px 10px 4px;margin:6px 0 0}.steer p{font-size:10.5px;margin:2px 0}
.exec-cols{grid-template-columns:minmax(0,1fr) 170px;gap:6px 16px}
.exec-side{padding:8px 10px}
.xgrade{flex-direction:column;gap:6px;margin:0 0 8px}.xgrade .grade{width:40px;height:40px;font-size:26px}.xgrade p{font-size:9px}
.xgrade .grade.grade-range{width:auto;padding:0 6px;font-size:16px}
a.cta.cta-book{font-size:12px;padding:8px 10px}
.side-link{font-size:10px;margin:6px 0 0}
.exec-lower{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:4px 16px}
ul.matters{font-size:9.5px;padding-left:14px}ul.matters li{margin:1px 0}
ol.changes,.work{font-size:10.5px}.work{margin:4px 0}.exec-cta{display:none}
.heat{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:6px 0 2px}
.hc{font-size:8.5px;padding:3px 5px}.hc-id{font-size:8px}.hc-n{font-size:9px}.hc-s{font-size:8px}
.heat-legend,.small{font-size:8px}
a.cta{box-shadow:none}
.exec-side a.cta.cta-book::after{content:"\\A" attr(href);white-space:pre-wrap;font-size:8px;font-weight:400}
.hc,.badge,.grade,.tile,.seg-held,.seg-notified,.seg-refused,.seg-allowed,.sw,.steer,.node-z,th,a.cta,.exec-side{print-color-adjust:exact;-webkit-print-color-adjust:exact}
.tech-divider{margin-top:0}
details::details-content{content-visibility:visible;display:block}
details.fold:not([open]) pre{display:block}
button.copy{display:none}
.scroll{overflow:visible}
.lane,tr,.finding,li.xb,.hc,.xgrade{break-inside:avoid}
}
`;
