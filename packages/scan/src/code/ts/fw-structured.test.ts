/**
 * Structured output is an exclusion (record §3.17): Instructor's response_model, the AI
 * SDK's generateObject and OpenAI's zodResponseFormat shape an answer and run nothing,
 * so none is a tool; each is said in one honesty line. A real function tool beside
 * them is still counted.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';
import type { CodeCatalog } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-instructor-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

test('structured output: the response models are not tools; the real function tool is', () => {
  assert.deepEqual(catalog.tools.map((t) => [t.name, t.sdk]), [['refund_order', 'openai']]);
});

test('structured output: each schema is counted in one honesty line, and Instructor is not "not yet read"', () => {
  const l = catalog.not_seen.find((x) => x.includes('structured-output schema(s)'));
  assert.equal(l, '3 structured-output schema(s) (Instructor response_model, AI SDK generateObject, OpenAI zodResponseFormat: src/decide.ts:14, src/decide.ts:22, src/decide.ts:25) shape a model\'s answer through its tool channel or JSON mode, and nothing runs: they are not tools, and are not listed as tools.');
  assert.ok(!catalog.not_seen.some((x) => x.startsWith('Declared in package.json but not yet read') && x.includes('@instructor-ai/instructor')));
});
