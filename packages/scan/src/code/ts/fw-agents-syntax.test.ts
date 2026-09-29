/**
 * The syntax-only pass and the OpenAI Agents SDK (ACP-455): `tool({...})` imported by
 * name, under an alias, or through a namespace is seen by import name alone; an agent
 * run as a tool (`agent.asTool`) needs to know what `agent` is, which only the
 * type-following pass does. The measured `missed` is that difference.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-openai-agents-ts/', import.meta.url));

test('syntax-only: the import-named tool() calls are found (named, aliased, through a namespace), the asTool() tool is the one missed', async () => {
  const catalog = await scanCode(FIXTURE);
  assert.deepEqual(catalog.tools.map((t) => t.name).sort(), ['find_book', 'lookup_order', 'read_back', 'refund_order']);
  // The factory's tool() is a syntax find with no name the checked pass can list: it is counted
  // by the syntax pass and SAID by the checked one, never silently dropped.
  assert.deepEqual(catalog.syntax_only, { found: 4, missed: 1 });
  assert.ok(catalog.not_seen.some((l) => l.startsWith('1 OpenAI Agents SDK tool() definition(s) take their name from a value the code does not fix (src/tools.ts:37)')));
});
