/**
 * One file per signature in `fixtures/code/frameworks-ts`, and one test per id:
 * each signature finds exactly its tools, labels them with its own id, and names
 * the call that hands them to a model. The shapes were checked against each
 * SDK's current documentation (Context7, 2026-09-26) and against the installed
 * declarations the fixture typechecks with.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EMITTED_SDKS, scanCode } from '../index.js';
import type { CodeCatalog, CodeTool, Exposure } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/frameworks-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function tools(sdk: string): CodeTool[] {
  return catalog.tools.filter((t) => t.sdk === sdk).sort((a, b) => (a.name < b.name ? -1 : 1));
}

function row(t: CodeTool): [string, string[], string, string] {
  return [t.name, t.params, t.schema_kind, t.via];
}

function exposure(via: string): Exposure[] {
  return catalog.exposures.filter((e) => e.via === via);
}

test('openai: nested Chat tools, a list passed by name, zodFunction, an OpenAI-compatible endpoint, flat Responses tools', () => {
  assert.deepEqual(tools('openai').map(row), [
    ['cancel_subscription', ['subscriptionId', 'reason'], 'zod', 'zodFunction() from "openai/helpers/zod"'],
    ['create_ticket', ['title', 'body'], 'json_schema', 'tools[] on responses.create'],
    ['get_order', ['orderId', 'expand'], 'json_schema', 'tools[] on chat.completions.create'],
    ['lookup_sku', ['sku'], 'json_schema', 'tools[] on chat.completions.create (OpenAI-compatible endpoint)'],
    ['refund_order', ['orderId'], 'json_schema', 'tools[] passed to chat.completions.create'],
  ]);
  const chat = exposure('chat.completions.create({ tools })');
  assert.deepEqual(chat.map((e) => [e.kind, e.tools]), [
    ['static', ['get_order', 'cancel_subscription']],
    ['computed', ['refund_order']],
  ]);
  assert.deepEqual(exposure('chat.completions.create({ tools }) (OpenAI-compatible endpoint)').map((e) => e.tools), [['lookup_sku']]);
  assert.deepEqual(exposure('responses.create({ tools })').map((e) => e.tools), [['create_ticket']]);
});

test('mistral: the Chat-shaped object on chat.complete is Mistral, not OpenAI', () => {
  assert.deepEqual(tools('mistral').map(row), [['mistral_search', ['query'], 'json_schema', 'tools[] on chat.complete']]);
  assert.deepEqual(exposure('chat.complete({ tools })').map((e) => [e.kind, e.tools]), [['static', ['mistral_search']]]);
});

test('cohere: v2 ToolV2 and the v1 parameterDefinitions shape, each labelled by its client', () => {
  assert.deepEqual(tools('cohere').map(row), [
    ['cohere_lookup', ['accountId'], 'json_schema', 'tools[] on CohereClient.chat'],
    ['cohere_weather', ['city'], 'json_schema', 'tools[] on CohereClientV2.chat'],
  ]);
  assert.deepEqual(exposure('CohereClientV2.chat({ tools })').map((e) => e.tools), [['cohere_weather']]);
  assert.deepEqual(exposure('CohereClient.chat({ tools })').map((e) => e.tools), [['cohere_lookup']]);
});

test('gemini: a typed FunctionDeclaration and an inline one; googleSearch is a provider tool, not the application\'s', () => {
  assert.deepEqual(tools('gemini').map(row), [
    ['control_light', ['brightness', 'colorTemperature'], 'json_schema', 'FunctionDeclaration from "@google/genai"'],
    ['set_thermostat', ['celsius'], 'json_schema', 'functionDeclarations[] for "@google/genai"'],
  ]);
  assert.deepEqual(exposure('models.generateContent({ config: { tools } })').map((e) => [e.kind, e.tools]), [['static', ['control_light', 'set_thermostat']]]);
  assert.ok(catalog.not_seen.some((l) => l.includes('@google/genai googleSearch')));
});

test('mcp: registerTool and the deprecated tool(), served over the server\'s connect(transport)', () => {
  assert.deepEqual(tools('mcp').map(row), [
    ['delete_file', ['path'], 'zod', 'registerTool() on McpServer (served to MCP clients)'],
    ['read_file', ['path', 'encoding'], 'zod', 'tool() on McpServer (deprecated; served to MCP clients)'],
  ]);
  for (const t of tools('mcp')) assert.ok(t.execute_at !== undefined, t.name);
  const c = exposure('McpServer.connect(StdioServerTransport)');
  assert.equal(c.length, 1);
  assert.deepEqual([...(c[0]?.tools ?? [])].sort(), ['delete_file', 'read_file']);
});

test('langchain: tool(fn, { name }) and DynamicStructuredTool, named by their name field; bindTools joins the variables back', () => {
  assert.deepEqual(tools('langchain').map(row), [
    ['search_database', ['query', 'limit'], 'zod', 'tool() from "@langchain/core"'],
    ['send_email', ['to', 'body'], 'zod', 'tool() from "@langchain/core"'],
    ['transfer_funds', ['from', 'to', 'cents'], 'zod', 'new DynamicStructuredTool() from "@langchain/core"'],
  ]);
  assert.deepEqual(exposure('bindTools([ ... ])').map((e) => [e.kind, e.tools]), [['static', ['search_database', 'send_email']]]);
});

test('the frameworks fixture holds 15 tools, none of which a syntax-only AI SDK / Anthropic pass sees, and every id is emitted', () => {
  assert.equal(catalog.tools.length, 15);
  assert.deepEqual(catalog.syntax_only, { found: 0, missed: 15 });
  for (const t of catalog.tools) assert.ok(EMITTED_SDKS.includes(t.sdk), t.sdk);
  assert.deepEqual(catalog.sdks.map((s) => s.name), ['@google/genai', '@langchain/core', '@mistralai/mistralai', '@modelcontextprotocol/sdk', 'cohere-ai', 'openai', 'zod']);
});
