/**
 * The `--code` report's first screen (ACP-455 presentation, second design, 2026-09-28), ported from
 * the approved prototype (report-v2): the masthead; the headline, its second sentence underlined in
 * the act colour, and the lede; the grade on its scale; the door diagram across the full width; three
 * findings in three equal columns; the one call and the call to action. At 1440x900 all of it is
 * visible without scrolling, whatever the size of the application.
 *
 * NOTHING HERE MEASURES. Every label, count and place is a field of the `CodeSection` or a sentence
 * the other report modules already build; this file chooses layout, order and truncation only. Every
 * number it prints carries `data-n`, so a test holds it to the technical part and to the result.
 *
 * THE DIAGRAM SCALES BY RULE, NEVER BY GROWING. The tools are one bar by draft outcome; the callers
 * at most three rows; the tools outside the door at most three names and "+ N"; the paths around the
 * door two pills and "+ N more". Its element count depends on how many of those slots are filled,
 * never on how many tools there are: 20 tools and 214 draw the same drawing. Every label is cut by a
 * written rule (`LABEL_RULES`), and each `<text>` names its rule in `data-rule` so a test can hold it.
 *
 * It loads nothing and runs nothing: the diagram is inline SVG, the arrowheads are polygons (no
 * `url(#marker)`), and on a narrow screen CSS swaps it for the same facts as a list.
 */

import { basename } from 'node:path';

import type { CallerCheck, CodeSection, CodeToolVerdict } from '../code/types.js';
import type { SkillRead } from '../types.js';
import { andList, exposureGrade, gradeNow, gradeNowSentence, gradeTitle, groupOf, provisionalReason, heldReplyWarning, insertionCall, isStub, isUnlisted, notifiedCount, where, type ExposureGrade, type GradeLetter, type VerdictGroup } from './code.js';
import { BOOK_URL, codeHeadlineScreen, codeLeak, codeSteering, execName } from './exec.js';
import { highInstructions } from './instructions.js';
import { escapeHtml } from './names.js';
import { bypassPaths, entryFunction, uncheckedCallers } from './paths.js';
import { ZIFFER_LOGO_SVG, ZIFFER_MARK_SHAPES, ZIFFER_MARK_VIEWBOX } from './brand.js';

const e = escapeHtml;
/** A number the first screen prints, marked for the test that holds it to the technical part. */
const num = (key: string, n: number): string => `<b data-n="${key}">${n}</b>`;

/** The call to action's words on the first screen; the footer and the other page keep the long form. */
export const BOOK_SHORT = 'Book a 30-minute review';

// ---------------------------------------------------------------- labels: the written rules

/**
 * The longest each label of the diagram may be, in characters, and how it is cut. The widths are
 * the drawing's own (viewBox 1144 wide, the third design's), divided by the advance of the face at
 * that size: IBM Plex Mono advances 0.6 em per character, the grotesk about 0.5 at weight 600.
 *
 * - a NAME (a function, a tool) is cut at its end: `decoratedOnToolCa…`;
 * - a PATH (`file:line`) is shown as its file name and line, and cut in its middle, so the line
 *   number always shows: `…logger.ts:67`;
 * - a ROUTE (`router.post('/a/b/c/d')`) is shown as its METHOD and its last two segments:
 *   `POST …/c/d`, then cut at its end like a name.
 */
export const LABEL_RULES = {
  /** A caller card's first line: the function or route (250 wide at 14.5px, the grotesk). */
  callerName: 30,
  /** A caller card's second line when a check was found, or was not looked for: "checks X  place" (260 wide at 11.5px mono). */
  callerLine: 37,
  /** The place beside the NO CHECK FOUND pill (134 wide at 11px mono). */
  callerPlace: 20,
  /** The door's name, inside the round door (150 wide at 16px mono). */
  doorName: 15,
  /** The door's place (150 wide at 11px mono). */
  doorPath: 22,
  /** The line of names outside the door, "+ N" included (300 wide at 13px mono). */
  outsideLine: 38,
  /** The "N more callers" card's second line (260 wide at 11px mono). */
  moreLine: 39,
} as const;
export type LabelRule = keyof typeof LABEL_RULES;

/** A name cut at its end to `n` characters, the last one an ellipsis. */
export function cutEnd(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`;
}

/** A path cut in its middle to `n` characters, keeping more of its end, where the file and the line are. */
export function cutMiddle(s: string, n: number): string {
  if (s.length <= n) return s;
  const head = Math.max(1, Math.floor((n - 1) * 0.35));
  const tail = n - 1 - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/** A route as its method and last two segments (`POST …/veo/execute-confirmed-tool`); anything else as written. */
export function routeLabel(s: string): string {
  const m = /\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]*)['"`]/i.exec(s);
  if (m === null) return s;
  const method = (m[1] ?? '').toUpperCase();
  const segs = (m[2] ?? '').split('/').filter((x) => x !== '');
  return segs.length <= 2 ? `${method} /${segs.join('/')}` : `${method} …/${segs.slice(-2).join('/')}`;
}

/** A place as the diagram shows it: the file name and the line, cut in the middle to `n`. */
const place = (ref: { file: string; line: number }, n: number): string => cutMiddle(`${basename(ref.file)}:${ref.line}`, n);
/** A caller's name as the diagram shows it. */
const callerName = (c: CallerCheck): string => cutEnd(routeLabel(entryFunction(c)), LABEL_RULES.callerName);

// ---------------------------------------------------------------- the hero

const LETTERS: readonly GradeLetter[] = ['A', 'B', 'C', 'D', 'F'];

/**
 * The grade card (ACP-464 item 8): ONE grade, today's, large; the five letters with today's lit and the
 * one within reach outlined and labelled "reachable", never two letters lit alike; the sentence that says
 * what gets there; the "provisional" pill only with its reason under it. All of it from `gradeNow`. What
 * each letter means is said in the technical part's limits, and the file the classifying goes in is named
 * where the classifying is done, not here.
 */
export function gradeHtml(g: ExposureGrade): string {
  const now = gradeNow(g);
  const sentence = gradeNowSentence(g);
  const why = provisionalReason(g);
  const cell = (l: GradeLetter): string => (l === now.today ? 'today' : l === now.reachable ? 'reachable' : '');
  return (
    `<div class="grade" role="img" aria-label="${e(gradeTitle(g))}">` +
    `<div class="top"><span class="k">Exposure grade</span>${why === undefined ? '' : '<span class="prov">provisional</span>'}</div>` +
    (why === undefined ? '' : `<p class="why">${e(why)}</p>`) +
    // The letter beside its scale, one row, so the card is no taller than the headline beside it.
    '<div class="gr">' +
    `<div class="v" data-grade-today="${now.today}"${now.reachable === undefined ? '' : ` data-grade-reachable="${now.reachable}"`}><em class="g-${now.today.toLowerCase()}">${now.today}</em></div>` +
    `<div><ol class="scale">${LETTERS.map((l) => `<li class="g-${l.toLowerCase()}${l === now.today ? ' on' : l === now.reachable ? ' reach' : ''}">${l}</li>`).join('')}</ol>` +
    (now.reachable === undefined ? '' : `<ol class="scale-l" aria-hidden="true">${LETTERS.map((l) => `<li>${cell(l)}</li>`).join('')}</ol>`) +
    '</div></div>' +
    (sentence === undefined ? '' : `<p class="now">${boldNumbers(e(sentence))}</p>`) +
    '</div>'
  );
}

/** Every standalone number of an escaped sentence in bold; a digit inside a name is left alone. */
const boldNumbers = (escaped: string): string => escaped.replace(/(^|[\s(])(\d+)(?=[\s,).]|$)/g, (_m, pre: string, d: string) => `${pre}<b>${d}</b>`);

/** "Found by following types through your code: 83 tools, where reading the syntax alone finds 1." Only when the syntax pass missed some. */
export function credibilityHtml(code: CodeSection): string {
  const s = code.catalog.syntax_only;
  if (s.missed <= 0) return '';
  return `Found by following types through your code: ${num('types', code.counts.tools)} ${code.counts.tools === 1 ? 'tool' : 'tools'}, where reading the syntax alone finds ${num('syntax', s.found)}.`;
}

/** Past this many characters the headline is set one size smaller, so the top of the page still fits 1440x900. */
export const HEADLINE_LONG = 80;

/** The headline: two short sentences, the second highlighted the site's way (`codeHeadlineScreen`). */
function headlineHtml(code: CodeSection): string {
  const h = codeHeadlineScreen(code);
  // A long application name would push the call off a laptop's screen: past the length the
  // design's headline has (about 80 characters), the type steps down one size, never the content.
  const long = h.lead.length + h.act.length > HEADLINE_LONG;
  return `<h1 id="exec-h"${long ? ' class="long"' : ''}>${e(h.lead)}${h.act === '' ? '' : ` <em>${e(h.act)}</em>`}</h1>`;
}

function heroHtml(code: CodeSection): string {
  const g = exposureGrade(code);
  const rest = codeHeadlineScreen(code).rest.join(' ');
  const cred = credibilityHtml(code);
  const lede = [rest === '' ? '' : boldNumbers(e(rest)), cred].filter((x) => x !== '').join(' ');
  return (
    `<div class="g${g === undefined ? ' solo' : ''}">` +
    '<div><p class="eyebrow">Agent authorization scan</p>' +
    headlineHtml(code) +
    (lede === '' ? '' : `<p class="lede">${lede}</p>`) +
    '</div>' +
    (g === undefined ? '' : gradeHtml(g)) +
    '</div>'
  );
}

// ---------------------------------------------------------------- the door diagram

/**
 * The drawing's places, in viewBox units (1144 wide, from y 18), the third design's own: caller
 * cards on the left, the round door in the middle, one pill per draft outcome on the right, and
 * the dashed path under the door that carries ONE pill for every path around it.
 */
const A = { x: 40, w: 290 };
const CARD_H = 60;
const CARD_GAP = 24;
const MID = 150;
const DOOR = { cx: 552, r: 82 };
const C = { x: 790, w: 230 };
const PILL_H = 36;
const VIEW = { y: 18, w: 1144, h: 292 };
/**
 * The lane under the door, where every tool that does NOT pass the door is drawn (ACP-464): the paths
 * around it, and the tools that never reach it. Never among the door's outcomes on the right, which
 * are what the door decides. With a tool outside the door the lane moves down and the drawing grows
 * by `LANE_GROW`, once, whatever the number of such tools.
 */
const LANE = { y: 282, yOutside: 296 };
const LANE_GROW = 14;
/** The box of the tools that do not pass the door: in the lane, its right edge short of the door's own path down. */
const OUTSIDE_BOX = { w: 400, h: 40, gap: 30 };
/** The advance of a mono character, in em: labels centred by hand use it, never `text-anchor`, so the page's legibility test measures what is drawn. */
const MONO_EM = 0.6;

/** A text of the drawing: escaped, and carrying the rule it was cut by when it was cut by one. */
function text(x: number, y: number, size: number, body: string, cls: string, rule?: LabelRule, extra = ''): string {
  return `<text x="${x}" y="${y}" font-size="${size}" class="${cls}"${rule === undefined ? '' : ` data-rule="${rule}"`}${extra}>${body}</text>`;
}

function box(x: number, y: number, w: number, h: number, rx: number, cls: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`;
}

/** A label centred on `cx` by its measured advance. */
const centred = (cx: number, chars: number, size: number, em: number): number => Math.round(cx - (chars * size * em) / 2);

/** The callers the diagram draws: every caller when three or fewer, else two and a card that counts the rest. Callers with no check found come first. */
export interface CallerRows {
  shown: CallerCheck[];
  /** When there are more than three: how many the third row counts, and how many of them have no check found. */
  more?: { n: number; unchecked: number; checked: number };
  /** Whether the check before each call ran at all. */
  checked: boolean;
}

export function callerRows(code: CodeSection): CallerRows {
  const d = code.insertion.dispatcher;
  if (d === null) return { shown: [], checked: false };
  const checked = d.caller_checks !== undefined;
  const all = d.caller_checks ?? d.callers.map((caller): CallerCheck => ({ caller, in_function: '' }));
  // Stable: the source order within each kind.
  const sorted = checked ? [...all.filter((c) => c.check === undefined), ...all.filter((c) => c.check !== undefined)] : all;
  if (sorted.length <= 3) return { shown: sorted, checked };
  const rest = sorted.slice(2);
  const unchecked = checked ? rest.filter((c) => c.check === undefined).length : 0;
  return { shown: sorted.slice(0, 2), more: { n: rest.length, unchecked, checked: checked ? rest.length - unchecked : 0 }, checked };
}

/** The tools behind the door, by what the draft does with them: the bar's segments. */
export interface DoorBar {
  total: number;
  groups: { group: VerdictGroup; n: number; label: string }[];
}

const BAR_ORDER: readonly VerdictGroup[] = ['held', 'notified', 'allowed', 'refused'];
const BAR_LABEL: Record<VerdictGroup, string> = { held: 'held for a person', notified: 'run after a notice', allowed: 'run, recorded', refused: 'refused, no rule' };
/** Four segments leave each a quarter of the bar: the labels are the short forms. */
const BAR_LABEL_SHORT: Record<VerdictGroup, string> = { held: 'held', notified: 'notice only', allowed: 'recorded', refused: 'no rule' };

/** The bar's counts: the tools that pass the door (all tools when there is none), each in the engine's group. */
export function doorBar(code: CodeSection): DoorBar {
  const d = code.insertion.dispatcher;
  const behind = d === null ? code.verdicts : code.verdicts.filter((v) => v.tool.delegates_to === d.name);
  const count = new Map<VerdictGroup, number>();
  for (const v of behind) count.set(groupOf(v), (count.get(groupOf(v)) ?? 0) + 1);
  const present = BAR_ORDER.filter((g) => (count.get(g) ?? 0) > 0 || g !== 'refused');
  const labels = present.length > 3 ? BAR_LABEL_SHORT : BAR_LABEL;
  return { total: behind.length, groups: present.map((g) => ({ group: g, n: count.get(g) ?? 0, label: labels[g] })) };
}

/** Each outcome's pill: held in ink, notice only in the soft orange, recorded in white, no rule in the act colour. */
const PILL_CLASS: Record<VerdictGroup, { fill: string; ink: string }> = {
  held: { fill: 'f-ink', ink: 'f-paper' },
  notified: { fill: 'f-soft', ink: '' },
  allowed: { fill: 'f-white s-rule', ink: '' },
  refused: { fill: 'f-act', ink: 'f-ink' },
};

/** The tools outside the door, as one line: up to three names, then "+ N", never longer than its rule. */
export function outsideLine(names: readonly string[], count: number): string {
  const max = LABEL_RULES.outsideLine;
  const shown: string[] = [];
  for (const nm of names.slice(0, 3)) {
    const next = [...shown, cutEnd(nm, 16)];
    const rest = count - next.length;
    const line = `${next.join(', ')}${rest > 0 ? `  + ${rest}` : ''}`;
    if (line.length > max && shown.length > 0) break;
    shown.push(cutEnd(nm, 16));
  }
  const rest = count - shown.length;
  return cutEnd(`${shown.join(', ')}${rest > 0 ? `  + ${rest}` : ''}`, max);
}

/**
 * The words of the one pill the path around the door ends at, its count marked: "2 run another tool,
 * unseen by the door" when each path has its own outer tool, "14 tool calls unseen by the door" when a
 * tool runs more than one.
 */
export function aroundWords(paths: readonly { outer: string }[]): { html: string; chars: number } {
  const n = paths.length;
  const outer = new Set(paths.map((p) => p.outer)).size;
  const words = outer === n ? 'run another tool, unseen by the door' : `tool ${n === 1 ? 'call' : 'calls'} unseen by the door`;
  return { html: `<tspan data-n="bypass">${n}</tspan> ${words}`, chars: `${n} ${words}`.length };
}

/** The right-hand rows: one pill per draft outcome, then the tools outside the door when there are any. */
function outcomeRows(n: number): number[] {
  const pitch = n <= 3 ? 80 : n === 4 ? 60 : 46;
  return Array.from({ length: n }, (_, i) => Math.round(MID + (i - (n - 1) / 2) * pitch));
}

/** A wire from (x1, y1) to (x2, y2): straight when level (and then a connector the legibility test follows), a curve otherwise. */
function wire(x1: number, y1: number, x2: number, y2: number, act: boolean): string {
  if (y1 === y2) return `<path d="M${x1} ${y1}H${x2}" class="${act ? 'ln-act' : 'ln'}"/>`;
  const mx = Math.round((x1 + x2) / 2);
  return `<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" class="wire${act ? ' act' : ''}"/>`;
}

/** The right side: the outcome pills, the note that they are the draft's, and the tools that do not pass the door. */
function rightSide(code: CodeSection, from: number, out: string[]): void {
  const d = code.insertion.dispatcher;
  const bar = doorBar(code);
  // Only what the door decides: a tool that does not pass it is drawn in the lane under the door (`laneSvg`).
  const ys = outcomeRows(bar.groups.length);
  const fan = from + 56;
  out.push(`<path d="M${from} ${MID}H${fan}" class="wire"/>`);
  bar.groups.forEach((g, i) => {
    const y = ys[i] ?? MID;
    out.push(wire(fan, MID, C.x, y, false));
    const k = PILL_CLASS[g.group];
    out.push(box(C.x, y - PILL_H / 2, C.w, PILL_H, PILL_H / 2, k.fill));
    out.push(text(C.x + 22, y + 5, 13, `<tspan font-weight="500" data-n="door-${g.group}">${g.n}</tspan><tspan dx="8">${e(g.label)}</tspan>`, `m ${k.ink}`.trim()));
  });
  const top = ys[0] ?? MID;
  out.push(text(C.x + C.w + 16, top - 4, 11.5, 'under the', 'm f-faint'), text(C.x + C.w + 16, top + 11, 11.5, 'draft policy', 'm f-faint'));
}

/** How many tools do not pass the door: 0 when there is no door (every tool then gets its own call). */
function outsideCount(code: CodeSection): number {
  const d = code.insertion.dispatcher;
  return d === null ? 0 : Math.max(0, code.counts.tools - d.tools_delegating);
}

/** The words under the names of the tools outside the door: what they are, and what each needs. */
export function outsideWords(n: number): string {
  return n === 1 ? 'tool does not pass the door: it needs its own call' : 'tools do not pass the door: each needs its own call';
}

/** The tools that do not pass the door, in the lane beside it, in the group of what goes around it. */
function outsideBox(code: CodeSection, y: number, out: string[]): void {
  const d = code.insertion.dispatcher;
  const n = outsideCount(code);
  if (d === null || n === 0) return;
  const names = code.verdicts.filter((v) => v.tool.delegates_to !== d.name).map((v) => v.tool.name);
  const x = DOOR.cx - OUTSIDE_BOX.gap - OUTSIDE_BOX.w;
  out.push(box(x, y - OUTSIDE_BOX.h / 2, OUTSIDE_BOX.w, OUTSIDE_BOX.h, 14, 'dash-box'));
  out.push(text(x + 20, y - 3, 13, e(outsideLine(names, n)), 'm', 'outsideLine', ' font-weight="500"'));
  out.push(text(x + 20, y + 13, 11, `<tspan data-n="outside">${n}</tspan> ${outsideWords(n)}`, 'm f-muted'));
}

/** The wide drawing. */
function doorSvg(code: CodeSection): string {
  const d = code.insertion.dispatcher;
  const out: string[] = [];
  const all = code.counts.tools;
  const paths = bypassPaths(code);

  if (d === null) {
    // The per-tool case: no function every tool runs through, so no door; the sentences the page already says.
    out.push(box(A.x, 60, 594, 180, 22, 'f-white sh'));
    out.push(text(A.x + 30, MID - 8, 19, 'No door: no single function runs every tool', '', undefined, ' font-weight="600"'));
    out.push(text(A.x + 30, MID + 20, 14, e(`ZIFFER goes at the top of each tool’s run function, ${all} ${all === 1 ? 'place' : 'places'}.`), 'f-muted'));
    rightSide(code, A.x + 594, out);
  } else {
    const rows = callerRows(code);
    const k = rows.shown.length + (rows.more === undefined ? 0 : 1);
    const start = MID - (k * CARD_H + (k - 1) * CARD_GAP) / 2;
    const cards: string[] = [];
    const labels: string[] = [];
    const mids: { y: number; act: boolean }[] = [];
    rows.shown.forEach((c, i) => {
      const y = start + i * (CARD_H + CARD_GAP);
      const no = rows.checked && c.check === undefined;
      cards.push(box(A.x, y, A.w, CARD_H, 14, no ? 'f-white s-act' : 'f-white'));
      labels.push(text(A.x + 20, y + 26, 14.5, e(callerName(c)), '', 'callerName', ' font-weight="600"'));
      if (no) {
        labels.push(box(A.x + 20, y + 35, 118, 17, 8.5, 'f-act'), text(A.x + 30, y + 47, 10.5, 'NO CHECK FOUND', 'm f-ink', undefined, ' font-weight="500"'));
        labels.push(text(A.x + 146, y + 47, 11, e(place(c.caller, LABEL_RULES.callerPlace)), 'm f-muted', 'callerPlace'));
      } else {
        const line = !rows.checked
          ? cutEnd(`check not looked for  ${place(c.caller, 16)}`, LABEL_RULES.callerLine)
          : c.check === undefined
            ? ''
            : cutEnd(`checks ${c.check.reads}`, LABEL_RULES.callerLine);
        labels.push(text(A.x + 20, y + 46, 11.5, e(line), 'm f-muted', 'callerLine'));
      }
      mids.push({ y: y + CARD_H / 2, act: no });
    });
    if (rows.more !== undefined) {
      const y = start + rows.shown.length * (CARD_H + CARD_GAP);
      cards.push(box(A.x, y, A.w, CARD_H, 14, 'f-white'));
      labels.push(text(A.x + 20, y + 26, 14.5, `<tspan data-n="callers-more">${rows.more.n}</tspan> more callers`, '', undefined, ' font-weight="600"'));
      const sub = rows.checked ? `${rows.more.unchecked} with no check found · ${rows.more.checked} with a check` : 'checks not looked for';
      labels.push(text(A.x + 20, y + 46, 11, e(cutEnd(sub, LABEL_RULES.moreLine)), `m ${rows.more.unchecked > 0 ? 'f-act-text' : 'f-muted'}`, 'moreLine'));
      mids.push({ y: y + CARD_H / 2, act: rows.more.unchecked > 0 });
    }
    // wires: each card into the door; a caller with no check found in the full act colour, drawn last
    const into = DOOR.cx - DOOR.r - 1;
    for (const m of [...mids.filter((x) => !x.act), ...mids.filter((x) => x.act)]) out.push(wire(A.x + A.w, m.y, into, MID, m.act));
    out.push(`<g class="sh">${cards.join('')}</g>`, ...labels);
    // the door: the ZIFFER mark, the dispatcher's name and place, and where ZIFFER goes
    const name = cutEnd(d.name, LABEL_RULES.doorName);
    const at = place(d.at, LABEL_RULES.doorPath);
    const s = 48 / ZIFFER_MARK_VIEWBOX.w;
    out.push(
      `<circle cx="${DOOR.cx}" cy="${MID}" r="${DOOR.r + 14}" class="halo"/>`,
      `<circle cx="${DOOR.cx}" cy="${MID}" r="${DOOR.r}" class="f-white s-act sh" stroke-width="2"/>`,
      `<g transform="translate(${DOOR.cx - 24} ${MID - 58}) scale(${s.toFixed(5)})" aria-hidden="true">${ZIFFER_MARK_SHAPES}</g>`,
      text(centred(DOOR.cx, name.length, 16, MONO_EM), MID + 8, 16, e(name), 'm', 'doorName', ' font-weight="500"'),
      text(centred(DOOR.cx, at.length, 11, MONO_EM), MID + 27, 11, e(at), 'm f-muted', 'doorPath'),
      text(centred(DOOR.cx, 16, 11.5, 0.5), MID + 48, 11.5, 'ZIFFER goes here', 'f-act-text', undefined, ' font-weight="600"'),
    );
    rightSide(code, DOOR.cx + DOOR.r, out);
  }

  // The lane under the door: what does not pass it. A tool that never reaches the door, beside it on the
  // left; a tool that runs another tool without passing it, ONE dashed path from the bottom of the door to
  // ONE pill. Both are in this lane, never among the door's outcomes.
  const L = outsideCount(code) > 0 ? LANE.yOutside : LANE.y;
  outsideBox(code, L, out);
  if (paths.length > 0) {
    const w = aroundWords(paths);
    const from = d === null ? { x: A.x + 297, y: 240 } : { x: DOOR.cx, y: MID + DOOR.r };
    const width = Math.min(VIEW.w - C.x - 6, Math.round(w.chars * 13 * MONO_EM + 44));
    out.push(
      `<path d="M${from.x} ${from.y}V${L - 20}C${from.x} ${L} ${from.x + 48} ${L} ${from.x + 88} ${L}H${C.x - 6}" class="dash"/>`,
      `<polygon points="${C.x - 1},${L} ${C.x - 9},${L - 4} ${C.x - 9},${L + 4}" class="f-act"/>`,
      text(from.x + 14, L - 24, 11.5, 'around the door', 'm f-act-text'),
      box(C.x, L - 17, width, 34, 17, 'f-act'),
      text(C.x + 22, L + 5, 13, w.html, 'm f-ink'),
    );
  }
  const h = VIEW.h + (L === LANE.yOutside ? LANE_GROW : 0);
  return `<svg viewBox="0 ${VIEW.y} ${VIEW.w} ${h}" role="img" aria-labelledby="door-cap">${out.join('')}</svg>`;
}

/** The narrow screens' version: the same facts as a list, in the same dotted panel. */
function doorList(code: CodeSection): string {
  const d = code.insertion.dispatcher;
  const all = code.counts.tools;
  const bar = doorBar(code);
  const out: string[] = [];
  const [lead, ...others] = bar.groups;
  const barRow = lead === undefined ? '' : `<div class="row"><b>${lead.n} ${e(lead.label)}</b><span>${e(others.map((g) => `${g.n} ${g.label}`).join(', '))}</span></div>`;
  if (d === null) {
    out.push('<p class="dh">Where ZIFFER goes</p>', `<div class="row z"><b>No door: no single function runs every tool</b><span>${e(`ZIFFER goes at the top of each tool’s run function, ${all} ${all === 1 ? 'place' : 'places'}.`)}</span></div>`);
    out.push('<p class="dh">Under the draft policy</p>', barRow);
  } else {
    const rows = callerRows(code);
    out.push(`<p class="dh">Who calls the door · ${d.callers.length}</p>`);
    for (const c of rows.shown) {
      const name = e(routeLabel(entryFunction(c)));
      if (!rows.checked) out.push(`<div class="row"><b>${name}</b><span>check not looked for, ${e(place(c.caller, 60))}</span></div>`);
      else if (c.check === undefined) out.push(`<div class="row no"><b>${name}</b><span><i>NO CHECK FOUND</i> ${e(place(c.caller, 60))}</span></div>`);
      else out.push(`<div class="row"><b>${name}</b><span>checks ${e(c.check.reads)}, ${e(place(c.check.at, 60))}</span></div>`);
    }
    if (rows.more !== undefined) {
      out.push(`<div class="row${rows.more.unchecked > 0 ? ' no' : ''}"><b>${rows.more.n} more callers</b><span>${rows.checked ? `${rows.more.unchecked} with no check found · ${rows.more.checked} with a check` : 'checks not looked for'}</span></div>`);
    }
    out.push(
      '<p class="dh">The door</p>',
      `<div class="row z"><b>${e(d.name)}</b><span>ZIFFER goes here. ${e(place(d.at, 60))}. <b data-n="delegating">${d.tools_delegating}</b> of <b data-n="tools">${all}</b> tools pass it.</span></div>`,
    );
    out.push('<p class="dh">Behind it, under the draft policy</p>', barRow);
  }
  // What does not pass the door, in one group: the tools that never reach it, then the paths around it.
  const outside = outsideCount(code);
  const paths = bypassPaths(code);
  if (outside > 0 || paths.length > 0) out.push('<p class="dh">Around the door</p>');
  if (d !== null && outside > 0) {
    const names = code.verdicts.filter((v) => v.tool.delegates_to !== d.name).map((v) => v.tool.name);
    out.push(`<div class="row outside"><b>${e(outsideLine(names, outside))}</b><span>${outside} ${outsideWords(outside)}</span></div>`);
  }
  if (paths.length > 0) {
    const outer = [...new Set(paths.map((p) => p.outer))];
    out.push(`<div class="row no"><b>${aroundWords(paths).html.replace(/<[^>]+>/g, '')}</b><span>${e(outer.slice(0, 3).join(', '))}${outer.length > 3 ? ` + ${outer.length - 3}` : ''}</span></div>`);
  }
  return `<div class="door-list">${out.join('')}</div>`;
}

/**
 * The line under the door (ACP-464): the headline counts the LIVE tools that cannot be undone, the
 * diagram counts every tool that passes the door by what the draft does with it, stubs included, so
 * the two numbers do not add up in the reader's head by themselves. One set is read, the tools held at
 * the door, and each part of it the headline does not already count is said with its figure:
 *
 * - `unknown`: held because the draft cannot tell whether they can be undone (no reversibility entry);
 * - `stubs`: held tools declared and not wired yet, which the headline leaves out;
 * - `other`: held for another reason, the engine grading them HIGH risk;
 * - `outside`, `notice`: the headline's tools that are NOT held at the door, because they do not pass
 *   it or because the draft runs them after a notice.
 *
 * So `held = (cannot - outside - notice) + unknown + stubs + other`, for any application. Absent when
 * every part is zero, which is when the two numbers already agree.
 */
export interface HeldParts {
  held: number;
  cannot: number;
  unknown: number;
  stubs: number;
  other: number;
  outside: string[];
  notice: number;
}

export function heldParts(code: CodeSection): HeldParts | undefined {
  const g = exposureGrade(code);
  if (g === undefined) return undefined;
  const d = code.insertion.dispatcher;
  const passes = (v: CodeToolVerdict): boolean => d === null || v.tool.delegates_to === d.name;
  const held = code.verdicts.filter((v) => passes(v) && groupOf(v) === 'held');
  // The headline's set: live, graded impossible to undo, and not only for want of an entry.
  const cannot = code.verdicts.filter((v) => !isStub(v) && v.verdict.verdict !== 'REFUSED' && v.verdict.reversibility === 'IRREVERSIBLE' && !isUnlisted(v));
  const heldCannot = cannot.filter((v) => passes(v) && groupOf(v) === 'held');
  const unknown = held.filter((v) => !isStub(v) && v.verdict.verdict === 'ATTEST' && v.verdict.reversibility === 'IRREVERSIBLE' && isUnlisted(v)).length;
  const stubs = held.filter(isStub).length;
  return {
    held: held.length,
    cannot: g.known + g.derived,
    unknown,
    stubs,
    other: held.length - heldCannot.length - unknown - stubs,
    outside: cannot.filter((v) => !passes(v)).map((v) => v.tool.name),
    notice: cannot.filter((v) => passes(v) && groupOf(v) !== 'held').length,
  };
}

export function heldLineHtml(code: CodeSection): string {
  const p = heldParts(code);
  const g = exposureGrade(code);
  if (p === undefined || g === undefined) return '';
  const parts: string[] = [];
  if (p.unknown > 0) parts.push(`${num('held-unknown', p.unknown)} more ${p.unknown === 1 ? 'is' : 'are'} held because the draft cannot tell whether ${p.unknown === 1 ? 'it' : 'they'} can be undone.`);
  if (p.stubs > 0) parts.push(`${num('held-stub', p.stubs)} held ${p.stubs === 1 ? 'tool is' : 'tools are'} declared and not wired yet, so not among the ${g.tools}.`);
  if (p.other > 0) parts.push(`${num('held-other', p.other)} more ${p.other === 1 ? 'is' : 'are'} held because the engine grades ${p.other === 1 ? 'it' : 'them'} HIGH risk.`);
  if (p.outside.length > 0) {
    const n = p.outside.length;
    const names = andList(p.outside.slice(0, 3).map((x) => `<code>${e(x)}</code>`)) + (n > 3 ? ` and ${n - 3} more` : '');
    parts.push(`${num('cannot-outside', n)} of the ${p.cannot} that cannot be undone ${n === 1 ? 'does' : 'do'} not pass the door: ${names}.`);
  }
  if (p.notice > 0) parts.push(`${num('cannot-notice', p.notice)} of the ${p.cannot} that cannot be undone ${p.notice === 1 ? 'runs' : 'run'} after a notice under the draft, not held.`);
  return parts.length === 0 ? '' : `<p class="door-note" id="door-note">${parts.join(' ')}</p>`;
}

/** The door diagram: the drawing, the list that replaces it on a narrow screen, and a caption a screen reader reads. */
export function doorDiagram(code: CodeSection): string {
  const d = code.insertion.dispatcher;
  const cap =
    d === null
      ? `No single function runs every tool, so there is no door: ZIFFER goes at the top of each of the ${code.counts.tools} tools.`
      : `${d.name} (${basename(d.at.file)}:${d.at.line}) is the door: ${d.tools_delegating} of the ${code.counts.tools} tools run through it, called from ${d.callers.length} ${d.callers.length === 1 ? 'place' : 'places'}. ZIFFER goes on the door.`;
  return `<figure class="door" id="door" aria-label="Where tool calls pass">${doorSvg(code)}${doorList(code)}<figcaption id="door-cap" class="sr">${e(cap)}</figcaption></figure>`;
}

// ---------------------------------------------------------------- three findings

export type FirstFindingKind = 'unchecked' | 'bypass' | 'reply' | 'leak' | 'instructions' | 'steer' | 'notified' | 'refused';

export interface FirstFinding {
  kind: FirstFindingKind;
  /** ACT: something to change; DECIDE: a choice to make before signing. */
  verb: 'ACT' | 'DECIDE';
  /** The column's heading, plain text. */
  title: string;
  /** Escaped html, numbers marked. */
  html: string;
  href: string;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
/** A count at the head of a sentence: a word up to nine, digits after. */
const word = (n: number): string => WORDS[n] ?? String(n);

/** One line for a caller with no confirmation check found (the column's heading says that much): what it offers the model, and what bounds it. */
function uncheckedLine(code: CodeSection, c: CallerCheck): string {
  const d = code.insertion.dispatcher;
  const fn = `<code>${e(entryFunction(c))}</code>`;
  const known = d?.tools_delegating ?? code.verdicts.length;
  if (c.offered !== undefined && c.offered.length > 0 && c.reaches === undefined) {
    return `${fn} tells the model about ${num('offered', c.offered.length)} tools, and nothing on the path refuses a name that is not on that list.`;
  }
  if (c.reaches === undefined) return `${fn} calls ${e(d?.name ?? 'the dispatcher')} with no check found, and nothing in the source bounds which of the ${num('known', known)} tools it can call.`;
  const stubs = c.reaches.filter((n) => code.verdicts.some((v) => v.tool.name === n && v.tool.declared_stub === true)).length;
  const all = stubs > 0 && stubs === c.reaches.length ? ', all declared and not wired yet' : '';
  return `${fn} calls ${e(d?.name ?? 'the dispatcher')} with no check found, and can reach ${num('reaches', c.reaches.length)} ${c.reaches.length === 1 ? 'tool' : 'tools'}${all}.`;
}

/** The findings the first screen can say, most important first; the page prints the first three. `skills` adds a HIGH instruction hit in a skill or instruction file, and nothing else from that inventory. */
export function firstFindings(code: CodeSection, skills?: readonly SkillRead[]): FirstFinding[] {
  const out: FirstFinding[] = [];
  const none = uncheckedCallers(code);
  const first = none[0];
  if (first !== undefined) {
    const more = none.length - 1;
    out.push({
      kind: 'unchecked',
      verb: 'ACT',
      title: `${word(none.length)} ${none.length === 1 ? 'entry has' : 'entries have'} no confirmation check`,
      html: `${uncheckedLine(code, first)}${more > 0 ? ` And ${num('unchecked-more', more)} more ${more === 1 ? 'entry' : 'entries'} like it.` : ''}`,
      href: '#entries',
    });
  }
  const paths = bypassPaths(code);
  if (paths.length > 0) {
    const d = code.insertion.dispatcher;
    const outer = [...new Set(paths.map((p) => p.outer))];
    const where_ = d === null ? 'directly' : `without passing ${e(d.name)}`;
    const named = outer.length <= 3 ? andList(outer.map((o) => `<code>${e(o)}</code>`)) : `${outer.slice(0, 2).map((o) => `<code>${e(o)}</code>`).join(', ')} and ${outer.length - 2} more`;
    out.push({
      kind: 'bypass',
      verb: 'ACT',
      title: `${word(outer.length)} ${outer.length === 1 ? 'tool runs' : 'tools run'} another tool unseen`,
      html: `${named} ${outer.length === 1 ? 'runs' : 'run'} a tool ${where_}${paths.length > outer.length ? `, in ${num('bypass', paths.length)} places` : ''}, so one call there would not see ${paths.length === 1 ? 'it' : 'them'}.`,
      href: '#bypass',
    });
  }
  const live = code.verdicts.filter((v) => !isStub(v));
  const reply = heldReplyWarning(live.filter((v) => v.verdict.verdict === 'ATTEST'));
  if (reply !== undefined) out.push({ kind: 'reply', verb: 'DECIDE', title: 'As drafted, the model’s replies would wait', html: e(reply), href: '#policy' });
  const leak = codeLeak(code);
  if (leak !== undefined) {
    const r = leak.readers[0];
    const senders = leak.senders;
    if (r !== undefined) {
      out.push({
        kind: 'leak',
        verb: 'ACT',
        title: 'An access value could leave',
        html: `<code>${e(r.tool)}</code> returns ${e(r.word)} and ${andList(senders.slice(0, 3).map((s) => `<code>${e(s)}</code>`))}${senders.length > 3 ? ` and ${senders.length - 3} more` : ''} ${senders.length === 1 ? 'sends' : 'send'} data out: a manipulated model given both can send one through the other.`,
        href: '#leak',
      });
    }
  }
  // Instruction-like text of HIGH severity, in a description or a skill: one line, after the data-leaving pairs.
  const said = highInstructions(code, skills);
  const hi = said[0];
  if (hi !== undefined) {
    const others = said.length - 1;
    out.push({
      kind: 'instructions',
      verb: 'ACT',
      title: hi.source === 'tool' ? 'A tool description speaks to the model' : 'An instruction file speaks to the model',
      html: `${e(hi.sentence)} <code>${e(basename(hi.at))}</code>${others > 0 ? ` And ${num('instructions', others)} more of high severity.` : ''}`,
      href: hi.source === 'tool' ? '#instructions' : '#skills',
    });
  }
  const steer = codeSteering(code);
  if (steer !== undefined) {
    out.push({ kind: 'steer', verb: 'DECIDE', title: 'Outsiders’ text reaches the model', html: `Text people outside your company can write reaches the model through ${andList(steer.readers.slice(0, 3).map((x) => `<code>${e(x)}</code>`))}.`, href: '#steer' });
  }
  const notified = live.filter((v: CodeToolVerdict) => v.verdict.verdict === 'ALLOW' && v.verdict.reversibility === 'IRREVERSIBLE').length;
  if (notified > 0 && notifiedCount(code) > 0) {
    out.push({
      kind: 'notified',
      verb: 'DECIDE',
      title: `${word(notified)} ${notified === 1 ? 'action runs' : 'actions run'} after a notice only`,
      html: `${num('notified', notified)} ${notified === 1 ? 'action the engine treats as impossible to undo runs' : 'actions the engine treats as impossible to undo run'} after a notice under the draft, with no approval.`,
      href: '#policy',
    });
  }
  const refused = live.filter((v) => v.verdict.verdict === 'REFUSED').length;
  if (refused > 0) {
    out.push({
      kind: 'refused',
      verb: 'DECIDE',
      title: `${word(refused)} ${refused === 1 ? 'tool has' : 'tools have'} no rule`,
      html: `${num('refused', refused)} ${refused === 1 ? 'tool has' : 'tools have'} no rule in the draft, so the engine refuses ${refused === 1 ? 'it' : 'them'}.`,
      href: '#policy',
    });
  }
  return out;
}

export const FIRST_FINDINGS = 3;

function findingsHtml(code: CodeSection, skills?: readonly SkillRead[]): string {
  const list = firstFindings(code, skills).slice(0, FIRST_FINDINGS);
  if (list.length === 0) return '';
  return (
    '<ol class="finds">' +
    list.map((f) => `<li class="find" data-finding="${f.kind}"><p><i class="n">${f.verb}</i><b>${e(f.title)}.</b> ${f.html} <a href="${f.href}">Read it</a></p></li>`).join('') +
    '</ol>'
  );
}

// ---------------------------------------------------------------- the call, and the call to action

/** The one line, with `await` set apart as the prototype sets it. */
function callCode(call: string): string {
  const m = /^(await\s+)(.*)$/.exec(call);
  return m === null ? e(call) : `<span class="kw">${e((m[1] ?? '').trimEnd())}</span> ${e(m[2] ?? '')}`;
}

function actHtml(code: CodeSection): string {
  const ins = code.insertion;
  const d = ins.dispatcher;
  const call = insertionCall(ins);
  const heading = d === null ? 'Put ZIFFER at the top of each tool’s run function' : `Put ZIFFER at the top of ${e(d.name)}`;
  const whereHtml = d === null ? '' : `<div class="where">${e(where(d.at))}</div>`;
  const line =
    call === undefined
      ? '<div class="codeline"><code>The code to paste is in the technical report: <a href="#insertion">put ZIFFER in place</a>.</code></div>'
      : `<div class="codeline"><code id="first-call-line">${callCode(call)}</code><button class="copy" type="button">Copy</button></div>`;
  return (
    '<section class="act" id="first-call">' +
    `<div><div class="head"><h2>${heading}</h2>${whereHtml}</div>${line}</div>` +
    `<div class="r"><a class="cta" href="${BOOK_URL}" rel="noopener noreferrer">${e(BOOK_SHORT)} &#8594;</a><a class="sub" href="#technical">or read on &#8595;</a></div>` +
    '</section>'
  );
}

// ---------------------------------------------------------------- the top of the page

/** "28 Sep 2026" from an ISO date. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/**
 * The nav both reports share: the logo, whose, when, and the pill button. The scan's version is in the
 * footer. `book: false` leaves the pill out: the `--code` page's first screen already carries the
 * booking link under the call, and two of them on one screen is one too many (ACP-464).
 */
export function mastheadHtml(subject: string, date: string, book = true): string {
  return (
    `<header class="mast"><div class="wrap">${ZIFFER_LOGO_SVG}` +
    `<div class="meta"><span><b>${e(subject)}</b></span><span>${e(shortDate(date))}</span>` +
    (book ? `<a class="pill" href="${BOOK_URL}" rel="noopener noreferrer">${e(BOOK_SHORT)} &#8594;</a>` : '') +
    '</div></div></header>'
  );
}

/** The top of the page, in its order: nav, headline and grade, door, findings, the call and the call to action. */
export function firstScreen(code: CodeSection, meta: { date: string }, skills?: readonly SkillRead[]): string {
  return [
    '<div class="first" id="first-screen">',
    mastheadHtml(execName(code), meta.date, false),
    '<section class="hero"><div class="wrap">',
    heroHtml(code),
    doorDiagram(code),
    heldLineHtml(code),
    findingsHtml(code, skills),
    actHtml(code),
    '</div></section>',
    '</div>',
  ].join('\n');
}
