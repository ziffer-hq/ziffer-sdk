/**
 * Ask one discovered MCP server what tools it offers (ACP-440).
 *
 * The server is started over stdio with the SDK's `Client` and
 * `StdioClientTransport`, asked `tools/list` (every page), and closed. Nothing
 * is called: listing tools is the only request this module ever sends.
 *
 * # A server that fails is a finding, never a crash
 *
 * One broken entry in one client's config must not end the scan of the other
 * forty. A command that is not on PATH is `runtime_missing` with the command
 * named; anything else that stops the list arriving within the timeout -- a
 * crash, a hang, a protocol error -- is `server_not_started`. A timeout's
 * finding says what to do about it (`timeoutAdvice`), because the usual cause
 * is a package manager fetching the server on its first start. The report then
 * says which servers were NOT looked at, which is the honest shape: a scan
 * that dropped them silently would read as "these tools do not exist".
 *
 * # The environment the server gets
 *
 * Only the entry's declared `env`, plus what the SDK's transport always adds:
 * `getDefaultEnvironment()`, which on POSIX is HOME, LOGNAME, PATH, SHELL, TERM
 * and USER (sudo's list; the SDK merges it under the declared env on every
 * spawn and offers no switch). This process's own environment is never passed
 * through: a discovered server must not inherit this machine's tokens from us.
 * The brief asked for PATH and HOME alone; the four extra names are the SDK's
 * floor, carry no credential, and the test asserts the exact set.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { configuredPhrase } from '../discovery/group.js';
import { packageVersion } from '../package-info.js';
import type { CatalogTool, ConfiguredIn, Finding } from '../types.js';

/** A stdio server as discovery found it in one client's config. */
export interface ServerEntry {
  client: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  source_path: string;
  /** Every place this server is configured, when it is more than one (ACP-450): it is started once. */
  configured_in?: ConfiguredIn[];
}

export type ListOutcome = { ok: true; tools: CatalogTool[] } | { ok: false; finding: Finding };

/**
 * 60 s, not 20 (ACP-450): on the first real run every `npx -y` and `uvx`
 * server timed out, because a cold start downloads the package first. The
 * person can give more with `--timeout`, and the finding says so.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Pages of `tools/list` followed before the server is treated as misbehaving. */
const MAX_PAGES = 100;

class ListTimeout extends Error {
  override readonly name = 'ListTimeout';
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function paramsOf(inputSchema: { [k: string]: unknown }): string[] {
  const props = inputSchema['properties'];
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return [];
  return Object.keys(props);
}

function finding(entry: ServerEntry, kind: 'server_not_started' | 'runtime_missing', message: string): Finding {
  const where = configuredPhrase(entry.configured_in);
  const out: Finding = {
    id: `${kind}:${entry.client}/${entry.name}`,
    kind,
    severity: 'warn',
    tools: [],
    client: entry.client,
    server: entry.name,
    message: where === undefined ? message : `${message} It is ${where}.`,
    controls: [],
  };
  if (entry.configured_in !== undefined) out.configured_in = entry.configured_in;
  return out;
}

/** Whole seconds, for a sentence and for the flag the person types next. */
export function timeoutAdvice(timeoutMs: number): string {
  const s = Math.max(1, Math.round(timeoutMs / 1000));
  return `it took longer than ${s} s to start; rerun with --timeout ${s * 2}, or start it once by hand so its packages are cached`;
}

export async function listServerTools(entry: ServerEntry, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ListOutcome> {
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: { ...entry.env },
    // Ignored, not inherited: a server's stderr is not this tool's output, and
    // an unread pipe would fill and stall the server mid-handshake.
    stderr: 'ignore',
    ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
  });
  const client = new Client({ name: 'ziffer-scan', version: packageVersion() });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ListTimeout(`no tool list within ${timeoutMs} ms`)), timeoutMs);
  });
  const work = (async (): Promise<CatalogTool[]> => {
    await client.connect(transport);
    const tools: CatalogTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.listTools(cursor === undefined ? {} : { cursor });
      for (const t of res.tools) {
        const tool: CatalogTool = {
          client: entry.client,
          server: entry.name,
          tool: t.name,
          description: t.description ?? '',
          params: paramsOf(t.inputSchema),
          source_path: entry.source_path,
        };
        if (entry.configured_in !== undefined) tool.configured_in = entry.configured_in;
        tools.push(tool);
      }
      cursor = res.nextCursor;
      if (cursor === undefined) return tools;
    }
    throw new Error(`more than ${MAX_PAGES} pages of tools`);
  })();
  // A rejection of `work` after the timeout won the race must not surface as
  // an unhandled rejection.
  work.catch(() => undefined);
  try {
    return { ok: true, tools: await Promise.race([work, timeout]) };
  } catch (error) {
    if (isEnoent(error)) {
      return {
        ok: false,
        finding: finding(entry, 'runtime_missing', `The server "${entry.name}" could not start: "${entry.command}" is not installed on this machine.`),
      };
    }
    const why = error instanceof ListTimeout ? timeoutAdvice(timeoutMs) : 'it stopped before listing its tools';
    return {
      ok: false,
      finding: finding(entry, 'server_not_started', `The server "${entry.name}" was not scanned: ${why}.`),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
