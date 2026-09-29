import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listServerTools } from './client.js';
import type { ServerEntry } from './client.js';

// dist/mcp/client.test.js -> <package>/fixtures/mcp/echo-server.mjs
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'mcp', 'echo-server.mjs');

function entry(over: Partial<ServerEntry> = {}): ServerEntry {
  return {
    client: 'Claude Code',
    name: 'echo',
    command: process.execPath,
    args: [FIXTURE],
    env: {},
    source_path: '/fixture/.mcp.json',
    ...over,
  };
}

test('the catalog carries every tool with its params, client, server and source', async () => {
  const r = await listServerTools(entry());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.tools, [
    {
      client: 'Claude Code',
      server: 'echo',
      tool: 'read_email',
      description: 'Read the latest email.',
      params: ['folder', 'limit'],
      source_path: '/fixture/.mcp.json',
    },
    { client: 'Claude Code', server: 'echo', tool: 'send_email', description: '', params: [], source_path: '/fixture/.mcp.json' },
  ]);
});

test('a command not on PATH is runtime_missing naming the command, not a crash', async () => {
  const r = await listServerTools(entry({ command: 'ziffer-scan-no-such-runtime', args: [] }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.finding.kind, 'runtime_missing');
  assert.match(r.finding.message, /"ziffer-scan-no-such-runtime" is not installed/);
  assert.equal(r.finding.client, 'Claude Code');
});

test('a server that never answers is server_not_started within the timeout', async () => {
  const started = Date.now();
  const r = await listServerTools(entry({ args: [FIXTURE, '--hang'] }), 500);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.finding.kind, 'server_not_started');
  assert.ok(Date.now() - started < 8000, 'the timeout bounds the wait');
});

test('a server that exits at once is server_not_started', async () => {
  const r = await listServerTools(entry({ args: ['-e', 'process.exit(3)'] }), 5000);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.finding.kind, 'server_not_started');
});

test('the server gets its declared env and the SDK floor, never this process environment', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'scan-env-')), 'env.json');
  process.env['SECRET_X'] = 'must-not-arrive';
  try {
    const r = await listServerTools(entry({ args: [FIXTURE, '--env-out', out], env: { DECLARED_Y: 'yes' } }));
    assert.equal(r.ok, true);
  } finally {
    delete process.env['SECRET_X'];
  }
  const got: unknown = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(typeof got === 'object' && got !== null);
  // macOS's CoreFoundation sets __CF_USER_TEXT_ENCODING inside every child
  // process itself, whatever env it was spawned with (measured: a node child
  // spawned with env {A:'1'} reports [A, __CF_USER_TEXT_ENCODING]). It is not
  // ours to pass or withhold, so it is the one name removed before comparing.
  const keys = Object.keys(got)
    .filter((k) => !(process.platform === 'darwin' && k === '__CF_USER_TEXT_ENCODING'))
    .sort();
  assert.ok(!keys.includes('SECRET_X'), 'a planted secret reached the server');
  // The exact allowed set: declared, plus the SDK's getDefaultEnvironment()
  // names that are set in this process. Anything else is a leak.
  const floor = ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'].filter((k) => process.env[k] !== undefined);
  assert.deepEqual(keys, ['DECLARED_Y', ...floor].sort());
});
