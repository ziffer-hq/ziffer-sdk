/**
 * scripts/embed-annex.mjs halts by name on a status word the annex's own
 * vocabulary does not have (ACP-439). Run against a small synthetic dossier in
 * a temp directory, with ZIFFER_ANNEX_OUT pointing there too, so the real
 * generated module is never touched. The clean run is the control: without it,
 * a script that failed on every input would pass the planted case.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'embed-annex.mjs');

const VOCAB = [
  '**Status vocabulary.** Six values.',
  '',
  '- **built** — a mechanism exists.',
  '- **partial** — part of it.',
  '- **not checked** — no command goes red.',
  '- **lands in M*x*** — decided, not built.',
  '- **customer obligation** — outside the product.',
  '- **not covered** — not answered.',
  '',
  '---',
].join('\n');

function annex(status: string): string {
  return [
    '# Annex E',
    '## How to read a row',
    VOCAB,
    '## NIS2 — Directive (EU) 2022/2555, Article 21(2)',
    '| framework clause | what it asks | answered by | status | evidence |',
    '| --- | --- | --- | --- | --- |',
    '| Art. 21(2)(a) | Risk analysis | `RK-1` | **built** | `x.py` |',
    `| Art. 21(2)(i) | Access control | \`AT-2\` | ${status} | \`y.py\` |`,
    '| Art. 23(3) | Notify recipients | `DR-1` | **lands in M6** | — |',
    '',
  ].join('\n');
}

const MITRE = [
  '# 02',
  '## ATLAS mapping (corroborated identifiers only)',
  '| ATLAS technique | ACP position | Mechanism |',
  '|---|---|---|',
  '| **AML.T0051** — LLM Prompt Injection | **Out of scope by design.** It is assumed. | validator |',
  '| **AML.T0051.001** — LLM Prompt Injection: Indirect | **Same.** Nothing changes. | grammar |',
  '',
  '## OWASP LLM Top 10 correspondence',
  '| OWASP | Position |',
  '|---|---|',
  '| LLM01 Prompt Injection | Assumed successful |',
  '',
].join('\n');

function run(status: string): { status: number | null; stderr: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'embed-annex-'));
  try {
    mkdirSync(join(dir, 'dossier', 'annexes'), { recursive: true });
    writeFileSync(join(dir, 'dossier', 'annexes', 'E-control-mapping.md'), annex(status));
    writeFileSync(join(dir, 'dossier', '02-THREAT-MODEL-MITRE.md'), MITRE);
    const outFile = join(dir, 'out.ts');
    const r = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, ZIFFER_ENGINE_CHECKOUT: dir, ZIFFER_ANNEX_OUT: outFile },
    });
    let out = '';
    try {
      out = readFileSync(outFile, 'utf8');
    } catch {
      out = '';
    }
    return { status: r.status, stderr: r.stderr, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('control: a dossier in the vocabulary embeds, "Same." resolved and the milestone kept', () => {
  const r = run('**partial**');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.out, /"status": "lands in",\s+"milestone": "M6"/);
  assert.match(r.out, /"position_label": "Out of scope by design\.",\s+"position_inherited_from": "AML\.T0051"/);
});

test('a status word outside the vocabulary halts AnnexStatusUnknown and writes nothing', () => {
  const r = run('**mostly built**');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AnnexStatusUnknown: .*E-control-mapping\.md:\d+: "mostly built"/);
  assert.equal(r.out, '');
});

test('a status cell that is not one bold word halts too', () => {
  const r = run('**partial** (see note)');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AnnexStatusUnknown/);
});
