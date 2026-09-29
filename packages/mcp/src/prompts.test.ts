/**
 * The guided flows (ACP-467): that the three prompts are listed over the
 * protocol, that each returns its script, and that every script names ONLY tools
 * this server registers. The registry is read the way an MCP client reads it,
 * with `tools/list` over a real transport, never from a list retyped here.
 *
 * The last assertion is the one that matters: a script that names a tool the
 * server does not have sends a model to improvise inside a setup that ends in a
 * signed policy. It was made to fail once on purpose, by naming a tool that does
 * not exist in `setupScript`, and it named the tool; see the ticket.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { PLAIN_WORDS, PROMPT_ARGS, PROMPT_NAMES, PROMPTS, scanScript, setupScript, whyScript } from './prompts.js';
import { createServer } from './server.js';
import type { ClientFactory } from './tools.js';

const NO_CLIENT: ClientFactory = () => Promise.reject(new Error('no network in this test'));

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ env: {}, clientFor: NO_CLIENT });
  const client = new Client({ name: 'ziffer-prompt-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The registry as a client sees it: every tool name, and every argument name
 * any tool's input schema declares. */
async function registry(client: Client): Promise<{ tools: Set<string>; args: Set<string> }> {
  const listed = await client.listTools();
  const tools = new Set<string>();
  const args = new Set<string>();
  for (const tool of listed.tools) {
    tools.add(tool.name);
    const properties = tool.inputSchema.properties;
    if (isRecord(properties)) for (const arg of Object.keys(properties)) args.add(arg);
  }
  assert.ok(tools.size >= 21, `tools/list returned ${tools.size} tools: the registry was not read`);
  return { tools, args };
}

/** The script text of one prompt, fetched over the protocol. */
async function scriptOf(client: Client, name: string, args: Record<string, string>): Promise<string> {
  const got = await client.getPrompt({ name, arguments: args });
  assert.equal(got.messages.length, 1, `${name} returned ${got.messages.length} messages`);
  const message = got.messages[0];
  assert.ok(message !== undefined && message.role === 'user');
  assert.equal(message.content.type, 'text');
  return message.content.type === 'text' ? message.content.text : '';
}

const ARGS: Readonly<Record<string, Record<string, string>>> = {
  setup_ziffer: { project_path: '/work/booking-app' },
  scan_and_explain: { project_path: '/work/booking-app' },
  why_refused: { what: 'TenantMismatch' },
};

test('prompts/list lists the three flows, each with a title and a description', async () => {
  const client = await connect();
  const listed = await client.listPrompts();
  assert.deepEqual(listed.prompts.map((p) => p.name).sort(), [...PROMPT_NAMES].sort());
  const titles = new Map(listed.prompts.map((p) => [p.name, p.title ?? '']));
  assert.equal(titles.get('setup_ziffer'), 'Set up ZIFFER in this project');
  assert.equal(titles.get('scan_and_explain'), 'Scan this project and explain what it found');
  assert.equal(titles.get('why_refused'), 'Why was this refused');
  for (const prompt of listed.prompts) {
    assert.ok((prompt.description ?? '').length > 40, `${prompt.name} has no usable description`);
  }
  const why = listed.prompts.find((p) => p.name === 'why_refused');
  assert.deepEqual(
    why?.arguments?.map((a) => [a.name, a.required === true]),
    [
      ['what', true],
      ['proposal_b64', false],
    ],
  );
});

test('each prompt returns its script over the protocol, in order, with its arguments in it', async () => {
  const client = await connect();
  const setup = await scriptOf(client, 'setup_ziffer', ARGS['setup_ziffer'] ?? {});
  let at = -1;
  for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const found = setup.indexOf(`Step ${step}.`);
    assert.ok(found > at, `setup_ziffer: step ${step} is missing or out of order`);
    at = found;
  }
  assert.ok(setup.includes('/work/booking-app'), 'setup_ziffer ignored project_path');
  assert.match(setup, /verified receipt/);

  const scan = await scriptOf(client, 'scan_and_explain', ARGS['scan_and_explain'] ?? {});
  assert.ok(scan.includes('/work/booking-app'));
  assert.match(scan, /Step 1\. Call `scan`/);

  const why = await scriptOf(client, 'why_refused', ARGS['why_refused'] ?? {});
  assert.ok(why.includes('TenantMismatch'), 'why_refused dropped the name it was given');
  assert.match(why, /`explain_refusal`/);
});

test('why_refused needs its argument; the other two run with none', async () => {
  const client = await connect();
  await assert.rejects(() => client.getPrompt({ name: 'why_refused', arguments: {} }));
  assert.match(await scriptOf(client, 'setup_ziffer', {}), /the absolute path of the project you are working in/);
});

test('every tool a script names is one tools/list returns, and every script names at least one', async () => {
  const client = await connect();
  const { tools } = await registry(client);
  const scripts = [
    ['setup_ziffer', setupScript({ project_path: '/p' })],
    ['scan_and_explain', scanScript({ project_path: '/p' })],
    ['why_refused', whyScript({ what: 'x' })],
  ] as const;
  for (const [name, script] of scripts) {
    assert.ok(script.tools.size > 0, `${name} names no tool at all`);
    for (const tool of script.tools) {
      assert.ok(tools.has(tool), `${name} names \`${tool}\`, which tools/list does not return`);
      assert.ok(script.text().includes(`\`${tool}\``), `${name} recorded ${tool} but does not show it`);
    }
  }
});

test('every backticked name in a script is a tool, a tool argument, a prompt or a listed plain word', async () => {
  // The helper records the tools a script names through it; this reads the
  // TEXT, so a tool name typed into the prose past the helper is caught too.
  const client = await connect();
  const { tools, args } = await registry(client);
  const prompts = new Set<string>(PROMPT_NAMES);
  const plain = new Set(PLAIN_WORDS);
  for (const name of PROMPT_NAMES) {
    const text = await scriptOf(client, name, ARGS[name] ?? {});
    for (const match of text.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
      const word = match[1] ?? '';
      assert.ok(
        tools.has(word) || args.has(word) || prompts.has(word) || plain.has(word),
        `${name} names \`${word}\`, which is no registered tool, no tool argument, no prompt and no listed word`,
      );
    }
  }
});

test('every argument a prompt declares is one its script reads', () => {
  for (const name of PROMPT_NAMES) {
    for (const arg of Object.keys(PROMPT_ARGS[name])) {
      const marker = `MARK-${arg}-7f3a`;
      const text = PROMPTS[name].render({ what: 'x', [arg]: marker }).text();
      assert.ok(text.includes(marker) || arg === 'proposal_b64', `${name} declares ${arg} and never reads it`);
    }
  }
  // proposal_b64 is read as a presence, not quoted: the script tells the model
  // to pass it rather than pasting base64 into the conversation.
  assert.match(whyScript({ what: 'r', proposal_b64: 'AAAA' }).text(), /Pass the `proposal_b64` given with this prompt/);
  assert.match(whyScript({ what: 'r' }).text(), /Ask the developer for the exact proposal/);
});

test('the scripts say what a developer reads: no bare agent, no em dash, no ticket', () => {
  for (const name of PROMPT_NAMES) {
    const text = PROMPTS[name].render({ what: 'x' }).text();
    assert.doesNotMatch(text, /(?<!\bAI )\bagents?\b(?! authorization)/i, `${name} says a bare "agent"`);
    assert.doesNotMatch(text, /—/, `${name} carries an em dash`);
    assert.doesNotMatch(text, /\bACP-\d+/, `${name} carries a ticket number`);
  }
});
