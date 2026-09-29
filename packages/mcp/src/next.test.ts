/**
 * Every tool's answer ends with its next step (ACP-467): that every registered
 * tool has one for an answer and one for a refusal, that each names only tools
 * and prompts that exist, and that the step really is the last block a client
 * receives.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { nextLine, NEXT_STEPS } from './next.js';
import { PROMPT_NAMES } from './prompts.js';
import { createServer, TOOL_NAMES } from './server.js';
import type { ClientFactory } from './tools.js';

const NO_CLIENT: ClientFactory = () => Promise.reject(new Error('no network in this test'));

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ env: {}, clientFor: NO_CLIENT });
  const client = new Client({ name: 'ziffer-next-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test('every registered tool has a next step for an answer and for a refusal, and no other tool does', async () => {
  const client = await connect();
  const listed = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(listed, [...TOOL_NAMES].sort());
  assert.deepEqual(Object.keys(NEXT_STEPS).sort(), listed, 'NEXT_STEPS and tools/list name different tools');
  for (const tool of listed) {
    const step = NEXT_STEPS[tool];
    assert.ok(step !== undefined);
    assert.ok(step.ok.length > 20 && step.refused.length > 20, `${tool} has an empty next step`);
  }
});

test('every name a next step backticks is a registered tool, a prompt, or an argument of a tool', async () => {
  const client = await connect();
  const tools = await client.listTools();
  const known = new Set<string>([...tools.tools.map((t) => t.name), ...PROMPT_NAMES]);
  for (const tool of tools.tools) {
    const properties = tool.inputSchema.properties;
    if (typeof properties === 'object' && properties !== null) for (const arg of Object.keys(properties)) known.add(arg);
  }
  for (const [tool, step] of Object.entries(NEXT_STEPS)) {
    for (const line of [step.ok, step.refused]) {
      const named = [...line.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1] ?? '');
      assert.ok(named.length > 0, `${tool}: "${line}" names no tool`);
      for (const name of named) assert.ok(known.has(name), `${tool}: the next step names \`${name}\`, which does not exist`);
    }
  }
});

test('the next step is the last block of the answer, and a refusal gets the refusal step', async () => {
  const client = await connect();
  const refused = await client.callTool({ name: 'whoami', arguments: {} });
  const content = refused.content;
  assert.ok(Array.isArray(content) && content.length === 2);
  const last: unknown = content[content.length - 1];
  assert.ok(typeof last === 'object' && last !== null && 'text' in last && typeof last.text === 'string');
  assert.equal(last.text, nextLine('whoami', { text: '', isError: true }));
  assert.match(last.text, /`explain_refusal`/);

  const answered = await client.callTool({ name: 'get_started', arguments: {} });
  const blocks = answered.content;
  assert.ok(Array.isArray(blocks) && blocks.length === 2);
  const tail: unknown = blocks[1];
  assert.ok(typeof tail === 'object' && tail !== null && 'text' in tail && typeof tail.text === 'string');
  assert.match(tail.text, /^Next: call `scan`/);
});

test('a missing value and an unreachable service get their own next step, whichever tool raised them', async () => {
  const client = await connect();
  const known = new Set((await client.listTools()).tools.map((t) => t.name));
  const waiting = nextLine('propose', { text: 'ApiKeyUnconfigured: this server has no ZIFFER API key', isError: true }) ?? '';
  assert.match(waiting, /carry on with the steps that need none/);
  const down = nextLine('get_decision', { text: 'ServiceUnreachable: ZIFFER did not answer at https://x', isError: true }) ?? '';
  assert.match(down, /check the three things listed above/);
  for (const line of [waiting, down]) {
    for (const m of line.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      const name = m[1] ?? '';
      assert.ok(known.has(name) || new Set<string>(PROMPT_NAMES).has(name), `names \`${name}\`, which does not exist`);
    }
  }
  // Not on an answer: the same words in a successful answer are not a refusal.
  assert.doesNotMatch(nextLine('propose', { text: 'ApiKeyUnconfigured: x', isError: false }) ?? '', /carry on/);
});

test('a decision chooses its own next step: a DENY, a held action, a pending one, a verified receipt', async () => {
  const client = await connect();
  const tools = await client.listTools();
  const known = new Set<string>([...tools.tools.map((t) => t.name), ...PROMPT_NAMES]);
  for (const t of tools.tools) {
    const p = t.inputSchema.properties;
    if (typeof p === 'object' && p !== null) for (const a of Object.keys(p)) known.add(a);
  }
  const ok = (tool: string, value: unknown): string => nextLine(tool, { text: JSON.stringify(value, null, 2), isError: false }) ?? '';
  const denied = ok('propose', { decision_id: 'd', status: 'decided', outcome: 'DENY', refusal_category: 'PolicyRefused' });
  assert.match(denied, /refused this action \(PolicyRefused\).*`explain_refusal` with PolicyRefused/);
  const held = ok('check_decision', { decision_id: 'd', status: 'decided', outcome: 'ATTEST' });
  assert.match(held, /held for a person.*`list_decisions`/);
  const heldGet = ok('get_decision', { decision: { decision_id: 'd', status: 'decided', outcome: 'ATTEST' }, verification: { status: 'absent' } });
  assert.match(heldGet, /held for a person/);
  const pending = ok('propose', { decision_id: 'd', status: 'pending' });
  assert.match(pending, /`check_decision`/);
  const verified = ok('get_decision', { decision: { decision_id: 'd', status: 'decided', outcome: 'ALLOW' }, receipt: {}, verification: { status: 'verified' } });
  assert.match(verified, /the receipt verified on this machine/);
  // An ALLOW with its receipt on propose/check_decision keeps the static line: get_decision next.
  assert.match(ok('check_decision', { decision_id: 'd', status: 'decided', outcome: 'ALLOW', receipt: {} }), /`get_decision`/);
  for (const line of [denied, held, heldGet, pending, verified]) {
    for (const m of line.matchAll(/`([a-z][a-z0-9_]*)`/g)) assert.ok(known.has(m[1] ?? ''), `names \`${m[1] ?? ''}\`, which does not exist`);
  }
});

test('an unknown tool gets no next step, never a generic one', () => {
  assert.equal(nextLine('no_such_tool', { text: '', isError: false }), undefined);
});
