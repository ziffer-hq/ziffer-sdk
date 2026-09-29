/**
 * `data/code-sdks.json` against the record it is drawn from: every row of the
 * coverage table in acp docs/design/acp-455-tool-calling-surfaces.md §4 (read
 * 2026-09-26, 28 rows) is named by an entry, ids are unique, `covered` is the
 * closed set, and a malformed file halts by name.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COVERAGE_VALUES, CodeSdksDataInvalid, entryForPackage, loadCodeSdks, parseCodeSdks } from './sdks.js';

// The first column of the record's §4 table, verbatim, in its order.
const RECORD_ROWS = [
  'AI SDK v7/v6',
  'AI SDK v5 / v4',
  'AI SDK provider tools',
  'Anthropic Messages',
  'Claude Agent SDK',
  'OpenAI Chat / Responses / Azure / compatible',
  'OpenAI Agents SDK',
  'Gemini',
  'Mistral',
  'Cohere',
  'Bedrock Converse',
  'LangChain / LangGraph',
  'LlamaIndex',
  'Pydantic AI',
  'CrewAI',
  'AG2 legacy / AG2 1.x',
  'MS Agent Framework',
  'Semantic Kernel',
  'Haystack',
  'Instructor & structured output',
  'MCP server (TS SDK)',
  'MCP server (Py `mcp` 2 / 1, `fastmcp`)',
  'VS Code LM tools',
  'Coding-assistant hooks',
  'Mastra / Genkit',
  'ADK / Strands',
  'smolagents / DSPy',
  "App-local factory (the user's `defineTool`)",
];

test('every row of the record coverage table is named by an entry, and no entry names a row the table lacks', () => {
  assert.equal(RECORD_ROWS.length, 28);
  const named = new Set(loadCodeSdks().flatMap((e) => e.rows));
  for (const row of RECORD_ROWS) assert.ok(named.has(row), `row not named: ${row}`);
  for (const row of named) assert.ok(RECORD_ROWS.includes(row), `entry names a row the record lacks: ${row}`);
});

test('covered is the closed set, ids are unique, schema entries name no row', () => {
  const entries = loadCodeSdks();
  for (const e of entries) {
    assert.ok(COVERAGE_VALUES.includes(e.covered), `${e.id}: ${e.covered}`);
    if (e.kind === 'schema') assert.deepEqual(e.rows, [], e.id);
  }
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
});

test('the milestone-1 set is the one the build order names', () => {
  const covered = loadCodeSdks().filter((e) => e.kind === 'framework' && e.covered === 'milestone-1').map((e) => e.id).sort();
  assert.deepEqual(covered, ['adk', 'ag2', 'agent-framework', 'ai', 'anthropic', 'bedrock', 'claude-agent-sdk', 'coding-assistant-hooks', 'cohere', 'crewai', 'dspy', 'gemini', 'genkit', 'haystack', 'instructor', 'langchain', 'llamaindex', 'local', 'mastra', 'mcp', 'mistral', 'openai', 'openai-agents', 'pydantic-ai', 'semantic-kernel', 'smolagents', 'strands', 'vscode-lm-tools']);
});

test('a scope pattern matches the scope and nothing else', () => {
  assert.equal(entryForPackage('@ai-sdk/anthropic')?.id, 'ai');
  assert.equal(entryForPackage('@ai-sdkx/anthropic'), undefined);
  assert.equal(entryForPackage('left-pad'), undefined);
});

test('a malformed data file halts by name', () => {
  assert.throws(() => parseCodeSdks('{"frameworks":[{"id":"x","framework":"X","rows":[],"language":[],"packages":[],"covered":"soon","kind":"framework"}]}'), CodeSdksDataInvalid);
  assert.throws(() => parseCodeSdks('{"frameworks":[{"id":"x","framework":"X","rows":[],"language":[],"packages":[],"covered":"not-yet","kind":"framework"},{"id":"x","framework":"Y","rows":[],"language":[],"packages":[],"covered":"not-yet","kind":"framework"}]}'), CodeSdksDataInvalid);
});
