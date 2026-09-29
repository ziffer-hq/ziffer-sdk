/**
 * From a parsed config file to server entries, one reader per `shape` the data file names.
 *
 * Every entry becomes either a local server this scan can start (command, args, env), or a
 * SKIPPED entry with the reason in plain words: a remote server, one the client has turned
 * off, one built into the client, or one whose fields are not the types the client itself
 * would accept. Nothing is dropped without a line saying so.
 */

import { posix } from 'node:path';

import type { ServerEntry } from '../mcp/client.js';
import type { ConfiguredIn } from '../types.js';
import type { ConfigLocation } from './clients.js';

/**
 * A server as a client's config states it. The fields `src/mcp/client.ts` starts a server
 * from are its `ServerEntry`, the one definition; discovery adds only `via`.
 */
export interface DiscoveredServer extends ServerEntry {
  /** Set when a client reads another client's file, e.g. GitHub Copilot through VS Code. */
  via?: string;
  /** The project block it came from, in a file that keeps one per project (`~/.claude.json`). */
  project?: string;
}

/** A configured entry this scan will not start, and why. */
export interface SkippedServer {
  client: string;
  name: string;
  source_path: string;
  reason: string;
  project?: string;
  /** A remote server's address, when its entry names one: its start signature (ACP-454). */
  url?: string;
  /** As `ServerEntry.configured_in`: set only when the same entry is configured in more than one place. */
  configured_in?: ConfiguredIn[];
}

export type Extracted =
  | { kind: 'server'; server: string; command: string; args: string[]; env: Record<string, string>; cwd?: string; project?: string }
  | { kind: 'skipped'; server: string; reason: string; project?: string; url?: string };

export class ConfigShapeUnexpected extends Error {
  override readonly name = 'ConfigShapeUnexpected';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const REMOTE_URL_KEYS = ['url', 'httpUrl', 'serverUrl', 'uri'];
const REMOTE_TYPES = ['http', 'sse', 'streamableHttp', 'streamable_http', 'streamable-http'];

interface Fields {
  command: string;
  args: string;
  env: string;
}
const STANDARD: Fields = { command: 'command', args: 'args', env: 'env' };

function asScalarString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** One server object in the common command/args/env form (field names per client). */
export function normalizeEntry(server: string, o: Record<string, unknown>, f: Fields = STANDARD): Extracted {
  if (o['disabled'] === true || o['enabled'] === false) {
    return { kind: 'skipped', server, reason: "turned off in the client's config" };
  }
  const command = o[f.command];
  if (command === undefined) {
    const url = REMOTE_URL_KEYS.map((k) => o[k]).find((v): v is string => typeof v === 'string');
    const type = o['type'];
    if (url !== undefined || (typeof type === 'string' && REMOTE_TYPES.includes(type))) {
      const reason = `a remote server${url === undefined ? '' : ` at ${url}`}; this scan starts only servers that run on this machine`;
      return url === undefined ? { kind: 'skipped', server, reason } : { kind: 'skipped', server, reason, url };
    }
    return { kind: 'skipped', server, reason: 'names no command to start' };
  }
  if (typeof command !== 'string' || command === '') {
    return { kind: 'skipped', server, reason: 'its command is not a text value' };
  }
  const argsRaw = o[f.args];
  const args: string[] = [];
  if (argsRaw !== undefined && argsRaw !== null) {
    if (!Array.isArray(argsRaw)) return { kind: 'skipped', server, reason: 'its arguments are not a list' };
    for (const a of argsRaw) {
      const s = asScalarString(a);
      if (s === null) return { kind: 'skipped', server, reason: 'one of its arguments is not a text value' };
      args.push(s);
    }
  }
  const envRaw = o[f.env];
  const env: Record<string, string> = {};
  if (envRaw !== undefined && envRaw !== null) {
    if (!isRecord(envRaw)) return { kind: 'skipped', server, reason: 'its environment is not a name-to-value map' };
    for (const [k, v] of Object.entries(envRaw)) {
      const s = asScalarString(v);
      if (s === null) return { kind: 'skipped', server, reason: `the environment variable ${k} has no text value` };
      env[k] = s;
    }
  }
  const out: Extracted = { kind: 'server', server, command, args, env };
  const cwd = o['cwd'];
  if (typeof cwd === 'string' && cwd !== '') out.cwd = cwd;
  return out;
}

function fromMap(map: unknown, where: string): Extracted[] {
  if (map === undefined || map === null) return [];
  if (!isRecord(map)) throw new ConfigShapeUnexpected(`${where} is not a name-to-server map`);
  return Object.entries(map).map(([name, entry]) =>
    isRecord(entry) ? normalizeEntry(name, entry) : { kind: 'skipped', server: name, reason: 'its entry is not an object' },
  );
}

function at(root: unknown, key: readonly string[]): unknown {
  let v = root;
  for (const k of key) {
    if (!isRecord(v)) return undefined;
    v = v[k];
  }
  return v;
}

function withCwd(list: Extracted[], cwd: string): Extracted[] {
  return list.map((e) => (e.kind === 'server' && e.cwd === undefined ? { ...e, cwd } : e));
}

function zed(root: unknown): Extracted[] {
  const map = at(root, ['context_servers']);
  if (map === undefined || map === null) return [];
  if (!isRecord(map)) throw new ConfigShapeUnexpected('context_servers is not a name-to-server map');
  return Object.entries(map).map(([name, entry]): Extracted => {
    if (!isRecord(entry)) return { kind: 'skipped', server: name, reason: 'its entry is not an object' };
    const cmd = entry['command'];
    if (isRecord(cmd)) {
      // The older form: command: { path, args, env }.
      return normalizeEntry(name, { ...cmd, enabled: entry['enabled'] }, { command: 'path', args: 'args', env: 'env' });
    }
    if (cmd === undefined && entry['url'] === undefined && entry['source'] === 'extension') {
      return { kind: 'skipped', server: name, reason: 'provided by a Zed extension; the settings file names no command to start' };
    }
    return normalizeEntry(name, entry);
  });
}

function continueYaml(root: unknown): Extracted[] {
  const list = at(root, ['mcpServers']);
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new ConfigShapeUnexpected('mcpServers is not a list');
  return list.map((entry: unknown, i: number): Extracted => {
    const fallback = `mcpServers[${i}]`;
    if (!isRecord(entry)) return { kind: 'skipped', server: fallback, reason: 'its entry is not an object' };
    const name = entry['name'];
    if (typeof name !== 'string' || name === '') return { kind: 'skipped', server: fallback, reason: 'it has no name' };
    return normalizeEntry(name, entry);
  });
}

function continueJson(root: unknown): Extracted[] {
  const list = at(root, ['experimental', 'modelContextProtocolServers']);
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new ConfigShapeUnexpected('experimental.modelContextProtocolServers is not a list');
  return list.map((entry: unknown, i: number): Extracted => {
    const name = `modelContextProtocolServers[${i}]`;
    const transport = isRecord(entry) ? entry['transport'] : undefined;
    if (!isRecord(transport)) return { kind: 'skipped', server: name, reason: 'it has no transport' };
    if (transport['type'] !== 'stdio') {
      return { kind: 'skipped', server: name, reason: 'a remote server; this scan starts only servers that run on this machine' };
    }
    return normalizeEntry(name, transport);
  });
}

function goose(root: unknown): Extracted[] {
  const map = at(root, ['extensions']);
  if (map === undefined || map === null) return [];
  if (!isRecord(map)) throw new ConfigShapeUnexpected('extensions is not a name-to-extension map');
  return Object.entries(map).map(([name, entry]): Extracted => {
    if (!isRecord(entry)) return { kind: 'skipped', server: name, reason: 'its entry is not an object' };
    if (entry['enabled'] === false) return { kind: 'skipped', server: name, reason: "turned off in the client's config" };
    const type = entry['type'];
    if (type === 'builtin' || type === 'platform') {
      return { kind: 'skipped', server: name, reason: 'runs inside Goose, not as a separate server' };
    }
    if (type === 'sse' || type === 'streamable_http' || type === 'http') {
      const uri = entry['uri'];
      const reason = `a remote server${typeof uri === 'string' ? ` at ${uri}` : ''}; this scan starts only servers that run on this machine`;
      return typeof uri === 'string' ? { kind: 'skipped', server: name, reason, url: uri } : { kind: 'skipped', server: name, reason };
    }
    if (type !== 'stdio') {
      return { kind: 'skipped', server: name, reason: `its type ${String(type)} is not one this scan reads` };
    }
    return normalizeEntry(name, entry, { command: 'cmd', args: 'args', env: 'envs' });
  });
}

function substitute(e: Extracted, variable: string, value: string): Extracted {
  if (e.kind !== 'server') return e;
  const token = '${' + variable + '}';
  const sub = (s: string): string => s.split(token).join(value);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.env)) env[k] = sub(v);
  const out: Extracted = { kind: 'server', server: e.server, command: sub(e.command), args: e.args.map(sub), env };
  if (e.cwd !== undefined) out.cwd = sub(e.cwd);
  if (e.project !== undefined) out.project = e.project;
  return out;
}

/** Reads one parsed file under its location's shape. */
export function extract(root: unknown, loc: ConfigLocation, filePath: string): Extracted[] {
  let list: Extracted[];
  switch (loc.shape) {
    case 'server_map':
      list = fromMap(at(root, loc.key ?? []), (loc.key ?? []).join('.'));
      break;
    case 'claude_json': {
      list = fromMap(at(root, ['mcpServers']), 'mcpServers');
      const projects = at(root, ['projects']);
      if (isRecord(projects)) {
        for (const [dir, p] of Object.entries(projects)) {
          const inProject = withCwd(fromMap(at(p, ['mcpServers']), `projects.${dir}.mcpServers`), dir);
          list.push(...inProject.map((e): Extracted => ({ ...e, project: dir })));
        }
      }
      break;
    }
    case 'codex_toml':
      list = fromMap(at(root, ['mcp_servers']), 'mcp_servers');
      break;
    case 'zed_settings':
      list = zed(root);
      break;
    case 'continue_yaml':
      list = continueYaml(root);
      break;
    case 'continue_json':
      list = continueJson(root);
      break;
    case 'goose_yaml':
      list = goose(root);
      break;
  }
  const variable = loc.plugin_root_var;
  if (variable !== undefined) {
    const dir = posix.dirname(filePath);
    list = list.map((e) => substitute(e, variable, dir));
  }
  return list;
}
