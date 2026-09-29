import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ClientsDataInvalid, loadClientsData, parseClientsData } from './clients.js';

interface Mutable {
  clients: Array<Record<string, unknown>>;
}
function isMutable(v: unknown): v is Mutable {
  return (
    typeof v === 'object' &&
    v !== null &&
    'clients' in v &&
    Array.isArray(v.clients) &&
    v.clients.every((c: unknown) => typeof c === 'object' && c !== null && !Array.isArray(c))
  );
}
function freshCopy(): Mutable {
  const v: unknown = JSON.parse(readFileSync(`${PKG}data/clients.json`, 'utf8'));
  if (!isMutable(v)) throw new Error('data/clients.json has no clients list');
  return v;
}

const PKG = fileURLToPath(new URL('../../', import.meta.url));

test('the attribution file names the agent-scan commit the data file was taken from', () => {
  // So the next refresh of the upstream paths cannot forget the notice: the SHA in
  // data/clients.json must appear verbatim in the hand-written attribution file.
  const data = loadClientsData();
  const attribution = readFileSync(`${PKG}THIRD-PARTY-NOTICES.attribution.md`, 'utf8');
  assert.match(data.upstream.commit, /^[0-9a-f]{40}$/);
  assert.ok(attribution.includes(data.upstream.commit), `attribution file lacks ${data.upstream.commit}`);
  assert.ok(attribution.includes('snyk/agent-scan'));
  assert.ok(attribution.includes('Apache License, Version 2.0'));
});

test('every covered client has a fixture directory', () => {
  // Not a count: a list of client directories under fixtures/clients/, each named by slug.
  const data = loadClientsData();
  for (const c of data.clients) {
    if (c.status === 'not covered') continue;
    const slug = c.name.toLowerCase().replace(/ /g, '-');
    assert.ok(existsSync(`${PKG}fixtures/clients/${slug}`), `no fixture directory for ${c.name}`);
  }
});

test('no entry claims it was verified against an install', () => {
  const raw = readFileSync(`${PKG}data/clients.json`, 'utf8');
  assert.ok(!raw.includes('"install"'));
});

test('the loader refuses a data file that is not the shape discovery reads', () => {
  assert.doesNotThrow(() => parseClientsData(freshCopy()));
  const broken: Array<[string, (d: Mutable) => void]> = [
    ['covered with no path', (d) => void (d.clients[0] = { name: 'X', status: 'covered', mcp_config_paths: [] })],
    ['not covered with a path', (d) => {
      const first = d.clients[0];
      if (first !== undefined) first['status'] = 'not covered';
    }],
    ['duplicate name', (d) => {
      const first = d.clients[0];
      if (first !== undefined) d.clients.push(first);
    }],
    ['path outside the grammar', (d) => {
      d.clients[0] = { name: 'X', status: 'covered', mcp_config_paths: [
        { platforms: ['linux'], path: '/etc/mcp.json', format: 'json', shape: 'server_map', key: ['mcpServers'], scope: 'user', verified: 'docs' },
      ] };
    }],
    ['verified by install', (d) => {
      d.clients[0] = { name: 'X', status: 'covered', mcp_config_paths: [
        { platforms: ['linux'], path: '~/x.json', format: 'json', shape: 'server_map', key: ['mcpServers'], scope: 'user', verified: 'install' },
      ] };
    }],
  ];
  for (const [label, mutate] of broken) {
    const copy = freshCopy();
    mutate(copy);
    assert.throws(() => parseClientsData(copy), ClientsDataInvalid, label);
  }
});
