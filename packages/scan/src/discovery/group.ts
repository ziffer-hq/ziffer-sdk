/**
 * One server, however many times it is configured (ACP-450).
 *
 * `~/.claude.json` keeps one `mcpServers` block per project directory, so a
 * person who added the same server in thirteen projects has it configured
 * thirteen times. The first run on a real machine started it thirteen times,
 * listed its tools thirteen times and printed thirteen findings about one
 * server. Entries are one server when the client, the server's name and what
 * it runs (the command and its arguments, or for an entry that is not started,
 * the reason, which names a remote server's address) are the same; the first
 * is kept, started once, and carries every place it is configured.
 *
 * Environment and working directory are not in the key: two projects that give
 * one server different keys still run one program, and it is listed once, with
 * the first project's environment.
 */

import type { ServerEntry } from '../mcp/client.js';
import type { ConfiguredIn } from '../types.js';
import type { DiscoveredServer, SkippedServer } from './shapes.js';

function placeOf(e: { source_path: string; project?: string }): ConfiguredIn {
  return e.project === undefined ? { file: e.source_path } : { file: e.source_path, project: e.project };
}

function groupBy<T extends { source_path: string; project?: string; configured_in?: ConfiguredIn[] }>(
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  const groups = new Map<string, { first: T; places: ConfiguredIn[] }>();
  for (const item of items) {
    const k = key(item);
    const place = placeOf(item);
    const g = groups.get(k);
    if (g === undefined) {
      groups.set(k, { first: item, places: [place] });
      continue;
    }
    if (!g.places.some((p) => p.file === place.file && p.project === place.project)) g.places.push(place);
  }
  return [...groups.values()].map(({ first, places }) => (places.length > 1 ? { ...first, configured_in: places } : first));
}

export function groupServers(servers: readonly DiscoveredServer[]): DiscoveredServer[] {
  return groupBy(servers, (s) => JSON.stringify([s.client, s.name, s.command, s.args]));
}

export function groupSkipped(skipped: readonly SkippedServer[]): SkippedServer[] {
  return groupBy(skipped, (s) => JSON.stringify([s.client, s.name, s.reason]));
}

/** "configured in 13 projects", or "configured in 3 places" when not every place is a project. */
export function configuredPhrase(places: readonly ConfiguredIn[] | undefined): string | undefined {
  if (places === undefined || places.length < 2) return undefined;
  const noun = places.every((p) => p.project !== undefined) ? 'projects' : 'places';
  return `configured in ${places.length} ${noun}`;
}

/**
 * What starting a server runs, whichever client names it (ACP-454).
 *
 * ACP-450 grouped one server across the projects of ONE client. The next real
 * run had `uvx code-review-graph serve` configured in seven clients (Windsurf,
 * Cursor, VS Code, GitHub Copilot, Claude Code, Gemini CLI, Codex CLI): the
 * listing asked to start it seven times, the scan started seven processes for
 * one program, and the headline counted it seven times. Two entries start the
 * same program when the command, the arguments IN ORDER and the NAMES of the
 * environment variables they are given agree; a remote entry is its address.
 * The client, the server's name in that client, the environment's values and
 * the working directory are not in the signature: the first entry is started,
 * with its own values, and its tool list serves every entry that shares it.
 */
export function startSignature(
  e: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> } | { url: string },
): string {
  if ('url' in e) return JSON.stringify(['url', e.url]);
  return JSON.stringify(['stdio', e.command, e.args, Object.keys(e.env).sort()]);
}

/**
 * A skipped entry's signature: its address when it is a remote server, else
 * the ACP-450 key (client, name, reason), because an entry that names no
 * program to start has no start signature to share.
 */
export function skippedSignature(s: SkippedServer): string {
  return s.url === undefined ? JSON.stringify(['skipped', s.client, s.name, s.reason]) : startSignature({ url: s.url });
}

/** Every configured entry that starts one program, and the one that is started. */
export interface StartGroup<T extends ServerEntry = ServerEntry> {
  signature: string;
  /** The entry that is started: the first configured, with its environment and working directory. */
  first: T;
  /** Every entry sharing the signature, `first` among them, in discovery order. */
  entries: T[];
}

/** Entries by start signature, in the order each signature is first seen. */
export function groupBySignature<T extends ServerEntry>(servers: readonly T[]): StartGroup<T>[] {
  const groups = new Map<string, StartGroup<T>>();
  for (const s of servers) {
    const signature = startSignature(s);
    const g = groups.get(signature);
    if (g === undefined) groups.set(signature, { signature, first: s, entries: [s] });
    else g.entries.push(s);
  }
  return [...groups.values()];
}

/** Distinct values in first-seen order. */
export function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** "configured in 7 AI agent clients: Windsurf, Cursor, ...", or undefined for one client. */
export function clientsPhrase(clients: readonly string[]): string | undefined {
  const d = distinct(clients);
  return d.length < 2 ? undefined : `configured in ${d.length} AI agent clients: ${d.join(', ')}`;
}
