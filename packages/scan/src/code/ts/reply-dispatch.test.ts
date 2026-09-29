/**
 * The door when tools carry no execute body (ACP-474): tools in the Anthropic Messages
 * format or OpenAI function tools are run by the application from the loop over the
 * model's reply, through one function of its own. That function is the dispatcher of
 * the SDK's bodiless tools, recognised by the TYPE of what it receives (a tool request
 * from the reply), never by a spelling. The applications in the fixtures are invented.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';
import type { CodeCatalog } from '../types.js';

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/code/${name}/`, import.meta.url));
}

/** `name -> delegates_to` for every tool, `-` where it delegates to nothing. */
function delegation(c: CodeCatalog): string[] {
  return c.tools.map((t) => `${t.name} -> ${t.delegates_to ?? '-'}`).sort();
}

function dispatchers(c: CodeCatalog): string[] {
  return c.dispatchers.map((d) => `${d.name} ${d.at.file}:${d.at.line} tools=${d.tools_delegating} callers=${d.callers.map((x) => `${x.file}:${x.line}`).join(',')}`);
}

test('Anthropic: runTool(block.name, block.input) from the tool_use loop is the dispatcher of the bodiless Messages tools only', async () => {
  const c = await scanCode(fixture('reply-anthropic-ts'));
  assert.deepEqual(dispatchers(c), ['runTool src/agent.ts:39 tools=3 callers=src/agent.ts:60']);
  assert.deepEqual(delegation(c), [
    'chargeDeposit -> runTool',
    'findRoom -> runTool',
    // Another SDK's request never reaches runTool, and a tool with its own run body runs in the SDK's runner.
    'lookupGuest -> -',
    'printReceipt -> -',
    'releaseRoom -> runTool',
  ]);
});

test('OpenAI Chat Completions: callTool(toolCall.function.name, JSON.parse(toolCall.function.arguments)) is the dispatcher', async () => {
  const c = await scanCode(fixture('reply-openai-chat-ts'));
  assert.deepEqual(dispatchers(c), ['callTool src/agent.ts:10 tools=2 callers=src/agent.ts:25']);
  assert.deepEqual(delegation(c), ['chargeDeposit -> callTool', 'findRoom -> callTool']);
});

test('OpenAI Responses: this.invokeTool(item.name, item.arguments) over function_call items is the dispatcher', async () => {
  const c = await scanCode(fixture('reply-openai-responses-ts'));
  assert.deepEqual(dispatchers(c), ['invokeTool src/agent.ts:11 tools=2 callers=src/agent.ts:19']);
  assert.deepEqual(delegation(c), ['findRoom -> invokeTool', 'releaseRoom -> invokeTool']);
});

test('DECOY: the same loop and runTool, handed plain strings spelled block.name and block.input, finds no dispatcher', async () => {
  const c = await scanCode(fixture('reply-negative-ts'));
  assert.deepEqual(c.dispatchers, []);
  assert.deepEqual(delegation(c), ['findRoom -> -', 'releaseRoom -> -']);
});

/**
 * The tools are inline in the call so they are found WITHOUT the SDK's types (the call is read
 * through its import declaration); the request's type is then unresolved, and nothing is claimed
 * from `block.name` and `block.input` alone.
 */
const UNRESOLVED_APP = `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function runTool(name: string, input: unknown): Promise<string> {
  return name === 'findRoom' ? JSON.stringify(input) : 'released';
}

export async function answer(question: string): Promise<string> {
  const reply = await client.messages.create({
    model: 'claude-model',
    max_tokens: 1024,
    tools: [
      { name: 'findRoom', description: 'Read the rooms free on a night.', input_schema: { type: 'object', properties: {} } },
      { name: 'releaseRoom', description: 'Release a held room back to sale.', input_schema: { type: 'object', properties: {} } },
    ],
    messages: [{ role: 'user', content: question }],
  });
  for (const block of reply.content) {
    if (block.type === 'tool_use') return runTool(block.name, block.input);
  }
  return '';
}
`;

test('unresolved types: with no node_modules the Messages tools are found and no dispatcher is claimed from the spelling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp474-unresolved-'));
  try {
    mkdirSync(join(dir, 'src'));
    cpSync(join(fixture('reply-anthropic-ts'), 'tsconfig.json'), join(dir, 'tsconfig.json'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'harbour-inn-unresolved', private: true, type: 'module', dependencies: { '@anthropic-ai/sdk': '0.128.0' } }));
    writeFileSync(join(dir, 'src', 'agent.ts'), UNRESOLVED_APP);
    const c = await scanCode(dir);
    // Not vacuous: the bodiless tools a dispatcher would take ARE in the catalog.
    assert.deepEqual(c.tools.map((t) => `${t.name} ${t.sdk} ${t.execute_at === undefined ? 'no body' : 'body'}`).sort(), ['findRoom anthropic no body', 'releaseRoom anthropic no body']);
    assert.deepEqual(c.dispatchers, []);
    assert.deepEqual(delegation(c), ['findRoom -> -', 'releaseRoom -> -']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
