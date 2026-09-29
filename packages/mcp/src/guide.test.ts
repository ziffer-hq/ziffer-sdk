/**
 * That `get_integration_guide` serves the real document (ACP-197, section 6b
 * point 5: "assert against the file, not a copy").
 *
 * The assertion that carries the weight is {@link !"the served guide is the doc
 * on disk"}: it reads `docs/onboarding/sdk.md` from the repository and compares
 * it against what the tool returns out of the module embedded at build time.
 * A copy of the expected text pasted into this file would make the test pass
 * for ever and prove only that this file agrees with itself — the served text
 * and the doc could then drift apart with nothing to notice, which is exactly
 * the failure the embed step introduces the possibility of.
 *
 * The extractor below is written out again rather than imported from
 * `guide.ts`. That is not duplication for its own sake: importing the thing
 * under test to compute the expected value would let a broken slicer agree with
 * itself. Two independent readings of one document is the point.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { asLanguage, GUIDE_SOURCE_PATH, integrationGuide, LANGUAGES } from './guide.js';
import { getIntegrationGuide } from './tools.js';

/** dist/guide.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const docPath = join(repoRoot, GUIDE_SOURCE_PATH);
const doc = readFileSync(docPath, 'utf8');

/** Slice one marked span out of the doc, independently of `guide.ts`. */
function spanFromDisk(name: string): string {
  const open = `<!-- guide:${name} -->`;
  const close = `<!-- guide:/${name} -->`;
  const openAt = doc.indexOf(open);
  const closeAt = doc.indexOf(close);
  assert.notEqual(openAt, -1, `${docPath} has no ${open}`);
  assert.notEqual(closeAt, -1, `${docPath} has no ${close}`);
  return doc.slice(openAt + open.length, closeAt).trim();
}

test('the served guide is the doc on disk, not a copy of it', () => {
  for (const language of LANGUAGES) {
    const expected = [spanFromDisk('common'), spanFromDisk(language)].join('\n\n');
    assert.equal(
      integrationGuide(language),
      expected,
      `the ${language} guide the tool serves is not what ${GUIDE_SOURCE_PATH} says. ` +
        'Either the embedded copy is stale (run `pnpm --filter @ziffer-io/mcp build`) ' +
        'or the extraction disagrees with the markers in the doc.',
    );
  }
});

test('the guide is substantial, so an empty span cannot pass the comparison above', () => {
  // Without this, deleting the BODY of every marked span -- leaving the markers
  // -- would satisfy the equality test with two empty strings. The comparison
  // proves the served text matches the doc; this proves the doc says something.
  for (const language of LANGUAGES) {
    assert.ok(
      integrationGuide(language).length > 2000,
      `the ${language} guide is too short to be the walkthrough`,
    );
  }
});

test('every language carries the sentence the whole doc exists to land', () => {
  // The one claim section 6b point 4 requires by name. Asserted on the text the
  // TOOL returns, because an agent that reads the guide and misses this will
  // wire up the calls and skip the check they exist to make.
  for (const language of LANGUAGES) {
    const served = integrationGuide(language);
    assert.match(
      served,
      /MCP alone routes the question; only the SDK's `verify` line enforces the answer/,
      `the ${language} guide does not tell the reader that MCP enforces nothing`,
    );
  }
});

test('each language section carries its own language and not the other', () => {
  // Guards a marker mix-up that the equality test alone would not catch if both
  // spans were wrong in the same way.
  assert.match(integrationGuide('python'), /from ziffer import/);
  assert.doesNotMatch(integrationGuide('python'), /import \{ ZifferClient/);
  assert.match(integrationGuide('typescript'), /import \{ ZifferClient/);
  assert.doesNotMatch(integrationGuide('typescript'), /from ziffer import/);
});

test('get_integration_guide serves that text, and refuses an unknown language by name', () => {
  const ok = getIntegrationGuide('python');
  assert.equal(ok.isError, false);
  assert.equal(ok.text, integrationGuide('python'));

  for (const unknown of ['rust', 'Python', 'PYTHON', '', 'python ']) {
    const bad = getIntegrationGuide(unknown);
    assert.equal(bad.isError, true, `${JSON.stringify(unknown)} was accepted as a language`);
    assert.match(bad.text, /^UnknownLanguage: /);
    // The refusal lists what IS accepted: an agent that guessed wrong should be
    // able to fix the call from the error alone, without another round trip.
    for (const language of LANGUAGES) assert.match(bad.text, new RegExp(language));
  }
});

test('asLanguage narrows without a cast, and rejects everything else', () => {
  assert.equal(asLanguage('python'), 'python');
  assert.equal(asLanguage('typescript'), 'typescript');
  assert.equal(asLanguage('go'), null);
  assert.equal(asLanguage('toString'), null);
});
