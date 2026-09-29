/**
 * Finds the MCP servers the AI agent clients on this machine are configured to start.
 *
 * Pure over the file system: it reads config files and spawns nothing. The home directory,
 * the working directory and the environment are arguments, never read from the process here,
 * so a test (or a scan of another user's home) passes its own.
 *
 * One server configured in several places (a project block each, in `~/.claude.json`) is
 * reported once, with every place it is configured (`group.ts`, ACP-450).
 *
 * What it reports is what the files say, in four lists: servers it could start, entries it
 * will not start and why (`skipped`), files that exist but could not be read and why
 * (`unreadable`), and clients this tool does not know how to read at all (`not_covered`). A
 * missing file is not reported: most machines do not run most clients.
 */

import { readFileSync } from 'node:fs';

import { type ClientsData, type ConfigLocation, type Platform, loadClientsData } from './clients.js';
import { parseJsonc } from './jsonc.js';
import { groupServers, groupSkipped } from './group.js';
import { expandGlob, resolveTemplate } from './paths.js';
import { type DiscoveredServer, type SkippedServer, extract } from './shapes.js';
import { readToml } from './toml.js';
import { readYaml } from './yaml.js';

export interface Unreadable {
  path: string;
  reason: string;
}

export interface DiscoveryResult {
  servers: DiscoveredServer[];
  skipped: SkippedServer[];
  not_covered: string[];
  unreadable: Unreadable[];
  /** Covered clients whose paths were looked at on this platform, found or not. */
  clients_checked: string[];
  /** Every config file that was read, in the order it was read. */
  configs_read: string[];
}

function errorReason(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = err.code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function parse(text: string, loc: ConfigLocation, path: string): unknown {
  switch (loc.format) {
    case 'json':
      return parseJsonc(text);
    case 'toml':
      return readToml(text, path);
    case 'yaml':
      return readYaml(text, path);
  }
}

export function discover(
  platform: Platform,
  home: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  data: ClientsData = loadClientsData(),
): DiscoveryResult {
  const result: DiscoveryResult = {
    servers: [],
    skipped: [],
    not_covered: [],
    unreadable: [],
    clients_checked: [],
    configs_read: [],
  };
  for (const client of data.clients) {
    if (client.status === 'not covered') {
      result.not_covered.push(client.name);
      continue;
    }
    const locations = client.mcp_config_paths.filter((l) => l.platforms.includes(platform));
    if (locations.length === 0) continue;
    result.clients_checked.push(client.name);
    const seen = new Set<string>();
    for (const loc of locations) {
      const resolved = resolveTemplate(loc.path, home, cwd, env);
      if (!resolved.ok) {
        result.unreadable.push({ path: loc.path, reason: resolved.reason });
        continue;
      }
      let files: string[];
      try {
        files = expandGlob(resolved.path);
      } catch (err) {
        result.unreadable.push({ path: resolved.path, reason: errorReason(err) });
        continue;
      }
      for (const file of files) {
        // One file named twice for a client (the home directory is also the working
        // directory) is read once, or each of its servers would be reported twice.
        if (seen.has(file)) continue;
        seen.add(file);
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch (err) {
          const code = errorCode(err);
          if (code === 'ENOENT' || code === 'ENOTDIR') continue;
          result.unreadable.push({ path: file, reason: errorReason(err) });
          continue;
        }
        let entries;
        try {
          entries = extract(parse(text, loc, file), loc, file);
        } catch (err) {
          result.unreadable.push({ path: file, reason: errorReason(err) });
          continue;
        }
        result.configs_read.push(file);
        const emitAs: Array<{ client: string; via?: string }> = [{ client: client.name }];
        if (client.also_emit_as !== undefined) emitAs.push(client.also_emit_as);
        for (const as of emitAs) {
          for (const e of entries) {
            if (e.kind === 'skipped') {
              const skipped: SkippedServer = { client: as.client, name: e.server, source_path: file, reason: e.reason };
              if (e.project !== undefined) skipped.project = e.project;
              if (e.url !== undefined) skipped.url = e.url;
              result.skipped.push(skipped);
              continue;
            }
            const s: DiscoveredServer = {
              client: as.client,
              name: e.server,
              command: e.command,
              args: e.args,
              env: e.env,
              source_path: file,
            };
            if (e.cwd !== undefined) s.cwd = e.cwd;
            if (as.via !== undefined) s.via = as.via;
            if (e.project !== undefined) s.project = e.project;
            result.servers.push(s);
          }
        }
      }
    }
  }
  result.servers = groupServers(result.servers);
  result.skipped = groupSkipped(result.skipped);
  return result;
}
