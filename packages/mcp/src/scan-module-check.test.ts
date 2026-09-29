/**
 * `check_integration` passes on the module `ziffer-scan --code` writes, as the
 * scan writes it, and fails on the same module with its verify line removed
 * (ACP-479).
 *
 * Until ACP-479 the module proposed, polled and returned without verifying the
 * receipt, and this server's own check answered FAIL on it: the product's two
 * halves disagreed about what an integration is. The module comes from a real
 * code scan of a fixture the scan package ships, never from a copy pasted here,
 * so the day the generator stops verifying this file goes red.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { processContext, run } from '@ziffer-io/scan';

import { checkIntegrationTool } from './integration-check.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', '..', 'scan', 'fixtures', 'code', 'fw-openai-agents-ts');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Scan the fixture with --code and return the module the scan wrote for it. */
async function scannedModule(): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), 'ziffer-mcp-scan-module-'));
  const out = join(work, 'ziffer-scan', 'ziffer-policy');
  const printed: string[] = [];
  const code = await run(['--code', '--out', out, '--no-color'], { out: (l) => printed.push(l), err: (l) => printed.push(l) }, {
    ...processContext(),
    cwd: FIXTURE,
    home: work,
    isTTY: false,
    stdoutTTY: false,
    stderrTTY: false,
  });
  assert.equal(code, 0, printed.join('\n'));
  const doc: unknown = JSON.parse(readFileSync(join(work, 'ziffer-scan', 'ziffer-scan.json'), 'utf8'));
  const section = isRecord(doc) ? doc['code'] : undefined;
  const insertion = isRecord(section) ? section['insertion'] : undefined;
  const snippet = isRecord(insertion) ? insertion['snippet'] : undefined;
  assert.ok(typeof snippet === 'string' && snippet.length > 0, 'the scan wrote no module');
  return snippet;
}

async function check(module: string): Promise<string> {
  const app = mkdtempSync(join(tmpdir(), 'ziffer-mcp-scan-module-app-'));
  mkdirSync(join(app, 'src'));
  writeFileSync(join(app, 'src', 'ziffer-gate.ts'), module);
  return (await checkIntegrationTool(app)).text;
}

test('check_integration: the scan\'s module PASSES as written, and FAILS with its verify line removed', async () => {
  const module = await scannedModule();
  const verifyLine = /^\s*verifyReceipt\(decision\.receipt,.*$\n/m;
  assert.match(module, verifyLine, 'the module has no verifyReceipt line to remove');

  const asWritten = await check(module);
  assert.match(asWritten, /^PASS\s+src\/ziffer-gate\.ts:\d+$/m, asWritten);
  assert.match(asWritten, /1 PASS, 0 FAIL, 0 NOT CHECKED\./, asWritten);

  const withoutVerify = await check(module.replace(verifyLine, ''));
  assert.match(withoutVerify, /^FAIL\s+src\/ziffer-gate\.ts:\d+$/m, withoutVerify);
  assert.match(withoutVerify, /0 PASS, 1 FAIL, 0 NOT CHECKED\./, withoutVerify);
});
