#!/usr/bin/env node
// A fixture MCP server for packages/scan's client tests (dev-only, never
// published: `files` ships dist/ alone). It exposes two tools and, when given
// `--env-out <file>`, writes the environment it was started with to that file
// so a test can assert what did and did not arrive. `--hang` accepts the
// connection and never answers, for the timeout path. `--sleep <ms>` waits
// that long before it starts serving, as a server whose package manager is
// still fetching it does on a cold start (ACP-450). `--start-log <file>`
// APPENDS one line per start, so a test can count how many times one
// configured program was started (ACP-454). Any other argument is
// ignored, so a fixture can carry credential-shaped flags (ACP-449).
import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const argv = process.argv.slice(2);
const envOut = argv.indexOf('--env-out');
if (envOut >= 0) writeFileSync(argv[envOut + 1], JSON.stringify(process.env));
const startLog = argv.indexOf('--start-log');
if (startLog >= 0) appendFileSync(argv[startLog + 1], `${process.pid}\n`);
const sleepAt = argv.indexOf('--sleep');
if (sleepAt >= 0) await sleep(Number(argv[sleepAt + 1]));
if (argv.includes('--hang')) {
  setInterval(() => {}, 1 << 30);
} else {
  const server = new Server({ name: 'echo', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'read_email',
        description: 'Read the latest email.',
        inputSchema: { type: 'object', properties: { folder: { type: 'string' }, limit: { type: 'number' } } },
      },
      { name: 'send_email', inputSchema: { type: 'object' } },
    ],
  }));
  await server.connect(new StdioServerTransport());
}
