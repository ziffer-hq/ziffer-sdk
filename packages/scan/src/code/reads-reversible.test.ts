/**
 * A tool that only READS is never counted among the tools that cannot be undone (ACP-455,
 * second review, 2026-09-28). The first rule for secrets raised a read of an access value to a
 * write, and the engine, finding no reversibility entry for it, treated it as IRREVERSIBLE: two
 * tools of the first customer's application that change nothing were counted among the tools
 * that cannot be undone. This holds the corrected rule over EVERY fixture catalog in the
 * package: the hand-made code catalogs, every source-tree fixture scanned for real (TypeScript
 * and Python), and the installed-tools catalog the bundle tests use.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { toolId } from '../bundle/names.js';
import { classify } from '../classify/index.js';
import { draftBundle } from '../scan/policy.js';
import { oneScan } from '../scan/one.js';
import type { CatalogTool } from '../types.js';
import { isRecord } from '../wasm/json.js';
import { type Engine, loadEngine } from '../wasm/loader.js';
import { locateWasm } from '../wasm/locate.js';
import { codeDrafts } from './grade.js';
import { scanCode } from './index.js';
import { findPython, scanPython } from './py/index.js';
import type { CodeCatalog } from './types.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const CODE = join(PKG, 'fixtures', 'code');
const NOW = new Date('2026-09-28T12:00:00Z');

/** Every source-tree fixture a front end reads, by language. */
const TS_TREES = ['tool-calls', 'example-shape', 'frameworks-ts', 'reaches', 'corpus-shapes'];
const PY_TREES = ['checks-py', 'frameworks-py'];
const JSON_CATALOGS = ['catalog-example-shape.json', 'catalog-per-tool.json'];

function isCatalog(v: unknown): v is CodeCatalog {
  return isRecord(v) && typeof v['root'] === 'string' && Array.isArray(v['tools']) && Array.isArray(v['dispatchers']) && Array.isArray(v['not_seen']);
}

let engine: Engine;
const catalogs: { label: string; catalog: CodeCatalog }[] = [];
before(async () => {
  engine = await loadEngine(readFileSync(locateWasm()));
  for (const f of JSON_CATALOGS) {
    const v: unknown = JSON.parse(readFileSync(join(CODE, f), 'utf8'));
    assert.ok(isCatalog(v), f);
    catalogs.push({ label: f, catalog: v });
  }
  for (const d of TS_TREES) catalogs.push({ label: d, catalog: await scanCode(join(CODE, d)) });
  assert.ok((await findPython()) !== null, 'no python3 >= 3.9 on PATH: the Python fixtures cannot be read');
  for (const d of PY_TREES) catalogs.push({ label: d, catalog: await scanPython(join(CODE, d)) });
});

test('across every code fixture catalog, no tool the draft reads as a read is IRREVERSIBLE under the engine', async () => {
  let reads = 0;
  let secretReads = 0;
  for (const { label, catalog } of catalogs) {
    const drafts = codeDrafts(catalog).classifications;
    const one = await oneScan({ code: catalog }, engine, { now: NOW, out: '' });
    const section = one.result.code;
    assert.ok(section !== undefined, label);
    for (const [i, c] of drafts.entries()) {
      if (c.effect !== 'read') continue;
      reads += 1;
      const v = section.verdicts[i];
      assert.ok(v !== undefined && v.tool.name === c.tool, `${label}: ${c.tool}`);
      if (v.sensitive_value !== undefined) secretReads += 1;
      assert.notEqual(v.verdict.verdict === 'REFUSED' ? undefined : v.verdict.reversibility, 'IRREVERSIBLE', `${label}: ${c.tool} reads and is IRREVERSIBLE`);
    }
  }
  // Not vacuous: reads were checked, and at least one of them names an access value.
  assert.ok(reads > 0, 'no read tool in any fixture');
  assert.ok(secretReads > 0, 'no fixture has a read that names an access value: the rule is not exercised');
});

test('the installed-tools fixture catalog: every read is listed REVERSIBLE in the draft, never IRREVERSIBLE', async () => {
  const doc: unknown = JSON.parse(readFileSync(join(PKG, 'fixtures', 'bundle', 'catalog.json'), 'utf8'));
  assert.ok(isRecord(doc) && Array.isArray(doc['catalog']));
  const rows: CatalogTool[] = doc['catalog'].filter(
    (t: unknown): t is CatalogTool =>
      isRecord(t) && typeof t['client'] === 'string' && typeof t['server'] === 'string' && typeof t['tool'] === 'string' && typeof t['description'] === 'string' && Array.isArray(t['params']),
  );
  assert.equal(rows.length, doc['catalog'].length);
  const { classifications } = classify(rows);
  const bundle = await draftBundle(rows, classifications, engine, NOW);
  const f = bundle.files.find((x) => x.path === 'reversibility.json');
  assert.ok(f !== undefined);
  const parsed: unknown = JSON.parse(f.text);
  assert.ok(isRecord(parsed) && isRecord(parsed['reversibility']));
  const table = parsed['reversibility'];
  let reads = 0;
  for (const c of classifications) {
    if (c.effect !== 'read') continue;
    reads += 1;
    const key = bundle.tools.map.get(toolId(c.server, c.tool));
    assert.ok(key !== undefined, c.tool);
    assert.equal(table[key], 'REVERSIBLE', `${c.server}/${c.tool}`);
  }
  assert.ok(reads > 0);
});
