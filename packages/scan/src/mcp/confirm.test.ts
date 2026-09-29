import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import type { ServerEntry } from './client.js';
import { confirmSpawn, SpawnRefused } from './confirm.js';

const ENTRIES: ServerEntry[] = [
  { client: 'VS Code', name: 'mail', command: 'npx', args: ['-y', 'mail server'], env: {}, source_path: '/x/mcp.json' },
];

function io(over: { yes?: boolean; isTTY?: boolean; answer?: string }) {
  const written: string[] = [];
  const input = new PassThrough();
  if (over.answer !== undefined) input.end(`${over.answer}\n`);
  return {
    written,
    io: { yes: over.yes ?? false, isTTY: over.isTTY ?? false, input, write: (t: string) => written.push(t) },
  };
}

test('no TTY and no --yes refuses by name, after printing exactly what would have run', async () => {
  const c = io({});
  await assert.rejects(
    confirmSpawn(ENTRIES, c.io),
    (e: unknown) => e instanceof SpawnRefused && e.name === 'NotInteractive',
  );
  assert.match(c.written.join(''), /VS Code {2}mail {2}npx -y "mail server"/);
});

test('--yes approves without asking', async () => {
  const c = io({ yes: true });
  await confirmSpawn(ENTRIES, c.io);
  assert.doesNotMatch(c.written.join(''), /\[y\/N\]/);
});

test('on a TTY, y approves and anything else declines', async () => {
  await confirmSpawn(ENTRIES, io({ isTTY: true, answer: 'y' }).io);
  await assert.rejects(
    confirmSpawn(ENTRIES, io({ isTTY: true, answer: 'yes please' }).io),
    (e: unknown) => e instanceof SpawnRefused && e.name === 'SpawnDeclined',
  );
  await assert.rejects(confirmSpawn(ENTRIES, io({ isTTY: true, answer: '' }).io), SpawnRefused);
});

test('the listing redacts every credential form and every environment value, and says where a server is configured (ACP-449, ACP-450)', async () => {
  const c = io({ yes: true });
  await confirmSpawn(
    [
      {
        client: 'Claude Code',
        name: 'billing',
        command: 'npx',
        args: ['-y', 'billing-mcp', '--api-key=sk_test_unit_0001', '--access-token', 'sntryu_unit_0002'],
        env: { BILLING_REGION: 'eu-unit-0003' },
        source_path: '/x/.claude.json',
        configured_in: [
          { file: '/x/.claude.json', project: '/w/a' },
          { file: '/x/.claude.json', project: '/w/b' },
        ],
      },
    ],
    c.io,
  );
  const text = c.written.join('');
  for (const v of ['sk_test_unit_0001', 'sntryu_unit_0002', 'eu-unit-0003']) assert.ok(!text.includes(v), `printed ${v}`);
  assert.match(
    text,
    / {2}Claude Code {2}billing {2}BILLING_REGION=\[redacted\] npx -y billing-mcp --api-key=\[redacted\] --access-token \[redacted\] {2}\(configured in 2 projects\)\n/,
  );
});

test('the listing aligns client and server in columns (ACP-454)', async () => {
  const c = io({ yes: true });
  await confirmSpawn(
    [
      { client: 'Cursor', name: 'inbox', command: 'node', args: ['a.mjs'], env: {}, source_path: '/x' },
      { client: 'Claude Code', name: 'tickets', command: 'tix', args: [], env: {}, source_path: '/y' },
    ],
    c.io,
  );
  assert.deepEqual(c.written.join('').split('\n').slice(1, 3), [
    '  Cursor       inbox    node a.mjs',
    '  Claude Code  tickets  tix',
  ]);
});

test('start groups: one line per program, its names and the clients that configure it, and the count is of programs (ACP-454)', async () => {
  const crg = (client: string, name = 'code-review-graph'): ServerEntry => ({
    client, name, command: 'uvx', args: ['code-review-graph', 'serve'], env: { TOKEN: `secret-${client}` }, source_path: '/x',
  });
  const shared = [crg('Windsurf'), crg('Cursor', 'crg'), crg('Claude Code')];
  const alone: ServerEntry = { client: 'VS Code', name: 'mail', command: 'npx', args: ['-y', 'mail'], env: {}, source_path: '/y' };
  const c = io({ yes: true });
  await confirmSpawn(
    [
      { signature: 's1', first: shared[0] ?? alone, entries: shared },
      { signature: 's2', first: alone, entries: [alone] },
    ],
    c.io,
  );
  assert.equal(
    c.written.join(''),
    '2 tool servers will be started to list their tools:\n' +
      '  code-review-graph, crg  TOKEN=[redacted] uvx code-review-graph serve  (configured in 3 AI agent clients: Windsurf, Cursor, Claude Code)\n' +
      '  mail                    npx -y mail  (VS Code)\n',
  );
});
