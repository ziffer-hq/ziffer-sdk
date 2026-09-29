#!/usr/bin/env node
/**
 * `npx @ziffer-io/mcp` — the entry point (ACP-197, section 6b).
 *
 * # Everything human goes to stderr
 *
 * stdout is the JSON-RPC stream. A single stray `console.log` — a banner, a
 * version line, a debug print — is not a cosmetic problem: it lands in the
 * middle of a framed message and the client's parser fails on a protocol error
 * that names nothing about where it came from. So this file writes to stderr,
 * which MCP clients surface as server logs, and nothing else in this package
 * writes to either.
 *
 * # It does not check its configuration before starting
 *
 * Deliberately, and `config.ts` carries the argument: a stdio server that exits
 * during the handshake tells the agent only that the server failed to start,
 * and the variable that was missing dies on a stderr nobody reads. Starting and
 * refusing per tool puts the variable name in front of the one party that can
 * fix it. The startup line below reports what is configured so a developer who
 * IS reading the log gets the same information early — a report, not a gate.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { VARS } from './config.js';
import { createDefaultServer } from './server.js';

/**
 * Which variables are set, never their values.
 *
 * `ZIFFER_API_KEY` is a bearer credential and this line goes to a log an agent
 * may capture into its own context. Presence is the whole of what is useful
 * here anyway: the question this answers is "did my environment reach the
 * server", and a boolean answers it.
 */
function configurationSummary(): string {
  return Object.values(VARS)
    .map((variable) => {
      const raw = process.env[variable];
      return `${variable}=${raw === undefined || raw.trim() === '' ? 'unset' : 'set'}`;
    })
    .join(' ');
}

async function main(): Promise<void> {
  const server = createDefaultServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`ziffer mcp: serving on stdio (${configurationSummary()})\n`);
}

main().catch((error: unknown) => {
  // Reached only if the transport itself fails — a tool refusal never lands
  // here, because every handler returns its refusal as a result. Exiting
  // non-zero matters: an MCP client restarts or reports a server that died, and
  // a process that lingers after its transport is gone is one the client waits
  // on for ever.
  process.stderr.write(
    `ziffer mcp: could not serve: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
