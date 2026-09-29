/**
 * The loop over the model's reply, in Python (ACP-481). Tools in the Anthropic Messages
 * format and OpenAI function tools carry no run body: the application runs each request
 * itself, often through a handler map where no if/elif names the tools. Python has no
 * types, so the request is FOLLOWED inside one function body: a model call on a client of
 * the SDK, the reply's tool requests, the loop over them, and a call to an application
 * function passed one request's name and its input. The applications are invented.
 *
 * These run the real walker under the machine's python3, as index.test.ts does.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { CodeCatalog } from '../types.js';
import { findPython, scanPython } from './index.js';

function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/code/${name}/`, import.meta.url));
}

/** `name sdk -> delegates_to` for every tool, `-` where it delegates to nothing. */
function delegation(c: CodeCatalog): string[] {
  return c.tools.map((t) => `${t.name} ${t.sdk} -> ${t.delegates_to ?? '-'}`).sort();
}

function dispatchers(c: CodeCatalog): string[] {
  return c.dispatchers.map((d) => `${d.name} ${d.at.file}:${d.at.line} tools=${d.tools_delegating} callers=${d.callers.map((x) => `${x.file}:${x.line}`).join(',')}`);
}

before(async () => {
  const py = await findPython();
  assert.ok(py !== null, 'no python3 >= 3.9 on PATH: these tests exercise the real walker and cannot run without one');
});

test('Anthropic: run_tool(block.name, block.input) into a handler map is the dispatcher of the bodiless Messages tools only', async () => {
  const c = await scanPython(fixture('reply-anthropic-py'));
  assert.deepEqual(dispatchers(c), ['run_tool desk.py:37 tools=3 callers=desk.py:47']);
  assert.deepEqual(delegation(c), [
    'charge_deposit anthropic -> run_tool',
    'find_room anthropic -> run_tool',
    'hold_room anthropic -> run_tool',
    // Another SDK's tool never reaches run_tool, and a tool with its own run body runs in the SDK's runner.
    'lookup_guest openai -> -',
    'print_receipt anthropic -> -',
  ]);
});

test('OpenAI Chat Completions: call_tool(tool_call.function.name, json.loads(...arguments)) through message = reply.choices[0].message', async () => {
  const c = await scanPython(fixture('reply-openai-chat-py'));
  assert.deepEqual(dispatchers(c), ['call_tool agent.py:27 tools=2 callers=agent.py:38']);
  assert.deepEqual(delegation(c), ['find_room openai -> call_tool', 'release_room openai -> call_tool']);
});

test('OpenAI Responses: invoke_tool(tool_name=item.name, arguments=...) over the narrowed function_call items', async () => {
  const c = await scanPython(fixture('reply-openai-responses-py'));
  assert.deepEqual(dispatchers(c), ['invoke_tool concierge.py:18 tools=2 callers=concierge.py:25']);
  assert.deepEqual(delegation(c), ['find_room openai -> invoke_tool', 'release_room openai -> invoke_tool']);
});

test('the client held on self: self.dispatch(block.name, dict(block.input)) is the dispatcher', async () => {
  const c = await scanPython(fixture('reply-self-client-py'));
  assert.deepEqual(dispatchers(c), ['dispatch bookings.py:17 tools=2 callers=bookings.py:25']);
  assert.deepEqual(delegation(c), ['cancel_booking anthropic -> dispatch', 'find_room anthropic -> dispatch']);
});

test('DECOY: the same loop and run_tool over plain queued objects spelled .name and .input finds no dispatcher', async () => {
  const c = await scanPython(fixture('reply-decoy-plain-py'));
  // Not vacuous: the bodiless tools a dispatcher would take ARE in the catalog.
  assert.deepEqual(c.tools.map((t) => `${t.name} ${t.sdk} ${t.execute_at === undefined ? 'no body' : 'body'}`).sort(), ['find_room anthropic no body', 'release_room anthropic no body']);
  assert.deepEqual(c.dispatchers, []);
  assert.deepEqual(delegation(c), ['find_room anthropic -> -', 'release_room anthropic -> -']);
});

test('the stated limit: a reply handed in as a parameter is not followed, and no dispatcher is claimed', async () => {
  const c = await scanPython(fixture('reply-decoy-param-py'));
  assert.deepEqual(c.tools.map((t) => `${t.name} ${t.sdk} ${t.execute_at === undefined ? 'no body' : 'body'}`).sort(), ['find_room anthropic no body', 'release_room anthropic no body']);
  assert.deepEqual(c.dispatchers, []);
  assert.deepEqual(delegation(c), ['find_room anthropic -> -', 'release_room anthropic -> -']);
});
