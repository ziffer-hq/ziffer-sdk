import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ServerEntry } from '../mcp/client.js';
import { clientsPhrase, groupBySignature, skippedSignature, startSignature } from './group.js';

const entry = (over: Partial<ServerEntry>): ServerEntry => ({
  client: 'Cursor',
  name: 'code-review-graph',
  command: 'uvx',
  args: ['code-review-graph', 'serve'],
  env: {},
  source_path: '/home/you/.cursor/mcp.json',
  ...over,
});

test('the start signature ignores the client, the name and the environment VALUES (ACP-454)', () => {
  const a = entry({ client: 'Cursor', name: 'crg', env: { TOKEN: 'one', REGION: 'eu' } });
  const b = entry({ client: 'Windsurf', name: 'code-review-graph', env: { REGION: 'us', TOKEN: 'two' }, cwd: '/elsewhere' });
  assert.equal(startSignature(a), startSignature(b));
});

test('the start signature keeps the command, the argument ORDER and the environment NAMES', () => {
  const base = entry({ env: { TOKEN: 'x' } });
  assert.notEqual(startSignature(base), startSignature(entry({ env: { TOKEN: 'x' }, command: 'pipx' })));
  assert.notEqual(startSignature(base), startSignature(entry({ env: { TOKEN: 'x' }, args: ['serve', 'code-review-graph'] })));
  assert.notEqual(startSignature(base), startSignature(entry({ env: { OTHER: 'x' } })));
  assert.notEqual(startSignature(base), startSignature(entry({ env: {} })));
});

test('a remote entry signatures by its address, whichever client names it', () => {
  const where = 'https://mcp.example.test/mcp';
  const skipped = (client: string, name: string) => ({ client, name, source_path: '/x', reason: `a remote server at ${where}; ...`, url: where });
  assert.equal(skippedSignature(skipped('Cursor', 'aws')), skippedSignature(skipped('VS Code', 'aws-mcp')));
  assert.equal(skippedSignature(skipped('Cursor', 'aws')), startSignature({ url: where }));
  assert.notEqual(startSignature({ url: where }), startSignature({ url: `${where}/other` }));
  // An entry that names no program and no address has no signature to share: client and name keep it apart.
  const off = (client: string) => ({ client, name: 'x', source_path: '/x', reason: "turned off in the client's config" });
  assert.notEqual(skippedSignature(off('Cursor')), skippedSignature(off('Zed')));
});

test('two clients with the same command are one group; the first configured is the one started', () => {
  const seven = ['Windsurf', 'Cursor', 'VS Code', 'GitHub Copilot', 'Claude Code', 'Gemini CLI', 'Codex CLI'].map((client) => entry({ client }));
  const other = entry({ client: 'Cursor', name: 'aws-mcp', command: 'uvx', args: ['awslabs.aws-api-mcp-server'] });
  const groups = groupBySignature([...seven, other]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.first, seven[0]);
  assert.deepEqual(groups[0]?.entries.map((e) => e.client), ['Windsurf', 'Cursor', 'VS Code', 'GitHub Copilot', 'Claude Code', 'Gemini CLI', 'Codex CLI']);
  assert.deepEqual(groups[1]?.entries, [other]);
  assert.equal(
    clientsPhrase(groups[0]?.entries.map((e) => e.client) ?? []),
    'configured in 7 AI agent clients: Windsurf, Cursor, VS Code, GitHub Copilot, Claude Code, Gemini CLI, Codex CLI',
  );
  assert.equal(clientsPhrase(['Cursor', 'Cursor']), undefined);
});
