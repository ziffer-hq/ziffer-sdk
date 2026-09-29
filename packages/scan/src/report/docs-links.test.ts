/**
 * Every https://ziffer.io/docs link the report and the MCP package can print points at a page and
 * an anchor that exist (ACP-464 item 7). The report linked `developers/sdk#9-the-mcp-assisted-path`
 * while the guide's heading is "## 10. The MCP-assisted path": a renumbered guide broke the link and
 * nothing read both.
 *
 * The pages generated from this repository come from `docs/onboarding/<guide>.md`, per the TABLE in
 * `tools/publish-docs.sh` (read here, never edited). An anchor must be a heading of that guide,
 * slugged the way the site slugs it: lower case, spaces to hyphens, punctuation and backticks
 * dropped, underscores KEPT ("## 6. `risk_functions.json`" is `#6-risk_functionsjson`).
 *
 * Pages hand-written on the site have no source here, and this test cannot see them. They are
 * listed by name in `NOT_CHECKABLE_HERE`, so the limit is stated rather than silent, and a link to
 * a site page that is in neither the TABLE nor that list fails.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DOC } from './docs.js';
import { MCP_URL } from './exec.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCES = [join(REPO, 'packages/scan/src'), join(REPO, 'packages/mcp/src')];

/** Site pages with no source in this repository: their anchors cannot be checked from here. */
export const NOT_CHECKABLE_HERE: readonly string[] = ['docs', 'docs/concepts', 'docs/glossary', 'docs/quickstart', 'docs/refusals'];

/** The site's slug of a heading's text. */
export function siteSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** `<page under www/content/docs>` to `<guide under docs/onboarding>`, read from the publish script's TABLE. */
function table(): Map<string, string> {
  const sh = readFileSync(join(REPO, 'tools/publish-docs.sh'), 'utf8');
  const m = /^TABLE='([^']*)'/m.exec(sh);
  assert.ok(m !== null, 'no TABLE in tools/publish-docs.sh');
  const out = new Map<string, string>();
  for (const row of (m[1] ?? '').split('\n')) {
    const [guide, page] = row.trim().split(':');
    if (guide !== undefined && page !== undefined && guide !== '') out.set(`docs/${page}`, guide);
  }
  assert.ok(out.size >= 5, `the TABLE was not read: ${out.size} rows`);
  return out;
}

/** Every heading of a guide, outside fenced code, as the site slugs it. */
function anchors(md: string): Set<string> {
  const out = new Set<string>();
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h !== null) out.add(siteSlug(h[1] ?? ''));
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith('.ts') && !name.includes('.test.')) out.push(p);
  }
  return out;
}

/** Every docs URL the two packages can print: the literals in their source, the report's DOC table, and the MCP link. */
function printedUrls(): Set<string> {
  const urls = new Set<string>([...Object.values(DOC), MCP_URL]);
  for (const f of SOURCES.flatMap(sourceFiles)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/ziffer\.io\/docs[^\s'"`)<>\]]*/g)) urls.add(m[0].replace(/[.,;:]+$/, ''));
  }
  return urls;
}

test('the site slug: lower case, spaces to hyphens, punctuation and backticks dropped, underscores kept', () => {
  assert.equal(siteSlug('6. `risk_functions.json`'), '6-risk_functionsjson');
  assert.equal(siteSlug('10. The MCP-assisted path'), '10-the-mcp-assisted-path');
  assert.equal(siteSlug('7. What this does **not** give you yet'), '7-what-this-does-not-give-you-yet');
});

test('every ziffer.io/docs link the report and the MCP package print is a page, and its anchor a heading of the guide it is built from (ACP-464)', () => {
  const pages = table();
  const urls = printedUrls();
  assert.ok(urls.size >= 10, `too few links found: ${urls.size}`);
  assert.ok(urls.has(MCP_URL));
  const bad: string[] = [];
  const unchecked: string[] = [];
  let checked = 0;
  for (const url of [...urls].sort()) {
    const [path = '', anchor] = url.replace('https://ziffer.io/', '').replace(/\/$/, '').split('#');
    const guide = pages.get(path);
    if (guide === undefined) {
      if (NOT_CHECKABLE_HERE.includes(path)) unchecked.push(url);
      else bad.push(`${url}: the page is neither generated from this repository (tools/publish-docs.sh TABLE) nor listed as not checkable from here`);
      continue;
    }
    const md = readFileSync(join(REPO, 'docs/onboarding', guide), 'utf8');
    if (anchor !== undefined && !anchors(md).has(anchor)) bad.push(`${url}: #${anchor} is not a heading of docs/onboarding/${guide}`);
    checked += 1;
  }
  assert.deepEqual(bad, []);
  assert.ok(checked >= 5, `only ${checked} links were checked against a guide`);
  // The limit, stated: these are printed and cannot be checked from this repository.
  assert.ok(unchecked.length > 0);
});
