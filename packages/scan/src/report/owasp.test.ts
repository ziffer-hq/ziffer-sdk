/**
 * The OWASP citation (2026-09-28): one entry, read from `owasp.ts`, printed with the current
 * edition's id and date, the older number said once, and no other OWASP identifier written
 * anywhere in the scan's source, its data or the MCP server's source.
 *
 * Left out of the sweep, each for its reason: this module (the one place), the generated annex
 * source (the dossier's own text, regenerated from the spec repository on every build, where the
 * row is keyed by its 2025 number) and test files (which name identifiers to assert they are absent).
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CODE } from './code.fixture.test.data.js';
import { renderReportHtml } from './file.js';
import { FIXTURE } from './fixture.test.data.js';
import { attachControls } from './controls.js';
import { loadReplayData } from '../replay/data.js';
import { OWASP_EXCESSIVE_AGENCY, owaspNote } from './owasp.js';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));
const ROOTS = ['scan/src', 'scan/data', 'mcp/src'];
const OWN = 'scan/src/report/owasp.ts';

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

test('no OWASP identifier is written outside owasp.ts in the scan\'s source, its data or the MCP server\'s source', () => {
  const swept: string[] = [];
  const found: string[] = [];
  for (const r of ROOTS) {
    for (const abs of files(join(PACKAGES, r))) {
      const rel = relative(PACKAGES, abs).split('\\').join('/');
      if (rel === OWN || rel.startsWith('scan/src/generated/') || /\.test(\.data)?\.ts$/.test(rel)) continue;
      swept.push(rel);
      const text = readFileSync(abs, 'utf8');
      for (const m of text.matchAll(/LLM\d{2}/g)) found.push(`${rel}: ${m[0]}`);
    }
  }
  assert.ok(swept.length > 50 && swept.some((f) => f.startsWith('mcp/src/')) && swept.some((f) => f.startsWith('scan/data/')), 'the sweep read nothing');
  assert.deepEqual(found, []);
  // The one place does hold them: the sweep would find an identifier written there.
  assert.ok(/LLM\d{2}/.test(readFileSync(join(PACKAGES, OWN), 'utf8')));
});

test('the page cites Excessive Agency as the 2026 edition\'s id, explains it once with the edition\'s date and the older number, and claims no compliance', () => {
  const o = OWASP_EXCESSIVE_AGENCY;
  const ctx = {
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
  const pages = [
    renderReportHtml({ ...FIXTURE, catalog: [], findings: [], classifications: [], scope: { code: 'read', installed: false }, code: CODE }, undefined, ctx),
    renderReportHtml({ ...FIXTURE, findings: attachControls(FIXTURE.findings) }, undefined, ctx),
  ];
  const note = owaspNote();
  assert.equal(
    note,
    'Excessive Agency is LLM03:2026 in the OWASP Top 10 for LLM Applications 2026, published 2026-08-03 (LLM06 in the 2025 edition); a check before each tool call answers two of its nine prevention strategies, 6 (Require user approval) and 7 (Complete mediation, which names “an independent pre-execution policy decision point between the tool and the downstream system”), and the other seven, such as giving a model fewer tools and narrower permissions, remain your own work.',
  );
  // The quote is the phrase the brief allowed, word for word, and nothing longer.
  assert.equal(o.quote, 'an independent pre-execution policy decision point between the tool and the downstream system');
  for (const html of pages) {
    const text = html.replace(/<[^>]+>/g, '');
    assert.ok(html.includes(o.id), 'the 2026 id is not printed');
    assert.ok(!html.includes(`${o.dossierId}:2025`) && !html.includes('LLM06:'), 'the 2025 id printed as the citation');
    assert.equal(text.split(o.previous).length - 1, 1, 'the older number said more or less than once');
    assert.ok(!/compl(y|ies|iant)|satisf(y|ies)|certified against/i.test(text.slice(text.indexOf(o.title) - 400, text.indexOf(o.title) + 1200)), 'a compliance claim near the citation');
  }
});
