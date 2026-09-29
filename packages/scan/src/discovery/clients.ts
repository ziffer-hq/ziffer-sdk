/**
 * Loads `data/clients.json`, the one place a client's config path lives, and refuses it by
 * name (`ClientsDataInvalid`) if any entry is not the shape discovery reads. Code here holds
 * no path and no client name: adding a client is an edit to the data file and a fixture.
 */

import { readFileSync } from 'node:fs';

export type Platform = 'darwin' | 'linux' | 'win32';
export type ConfigFormat = 'json' | 'toml' | 'yaml';
export type ConfigShape =
  | 'server_map'
  | 'claude_json'
  | 'codex_toml'
  | 'zed_settings'
  | 'continue_yaml'
  | 'continue_json'
  | 'goose_yaml';

export interface ConfigLocation {
  platforms: Platform[];
  /** In the path grammar the data file's header states. */
  path: string;
  format: ConfigFormat;
  shape: ConfigShape;
  /** For `server_map`: the key path to the name-to-server object. */
  key?: string[];
  scope: 'user' | 'project';
  /** `upstream` = taken from agent-scan unchanged; `docs` = from the client's documentation. */
  verified: 'upstream' | 'docs';
  /** A `${VAR}` in command/args that the client replaces with the config file's directory. */
  plugin_root_var?: string;
}

export interface ClientEntry {
  name: string;
  status: 'covered' | 'not covered';
  note?: string;
  also_emit_as?: { client: string; via: string };
  mcp_config_paths: ConfigLocation[];
}

export interface ClientsData {
  upstream: { repository: string; commit: string; file: string; license: string };
  clients: ClientEntry[];
}

export class ClientsDataInvalid extends Error {
  override readonly name = 'ClientsDataInvalid';
}

const PLATFORMS: readonly string[] = ['darwin', 'linux', 'win32'];
const FORMATS: readonly string[] = ['json', 'toml', 'yaml'];
const SHAPES: readonly string[] = [
  'server_map',
  'claude_json',
  'codex_toml',
  'zed_settings',
  'continue_yaml',
  'continue_json',
  'goose_yaml',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isPlatform(v: string): v is Platform {
  return PLATFORMS.includes(v);
}
function isFormat(v: unknown): v is ConfigFormat {
  return typeof v === 'string' && FORMATS.includes(v);
}
function isShape(v: unknown): v is ConfigShape {
  return typeof v === 'string' && SHAPES.includes(v);
}
function str(o: Record<string, unknown>, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v === '') throw new ClientsDataInvalid(`${where}: ${k} must be a non-empty string`);
  return v;
}

function location(raw: unknown, where: string): ConfigLocation {
  if (!isRecord(raw)) throw new ClientsDataInvalid(`${where}: not an object`);
  const platformsRaw = raw['platforms'];
  if (!isStringArray(platformsRaw) || platformsRaw.length === 0) {
    throw new ClientsDataInvalid(`${where}: platforms must be a non-empty list`);
  }
  const platforms: Platform[] = [];
  for (const p of platformsRaw) {
    if (!isPlatform(p)) throw new ClientsDataInvalid(`${where}: unknown platform ${p}`);
    platforms.push(p);
  }
  const format = raw['format'];
  if (!isFormat(format)) throw new ClientsDataInvalid(`${where}: unknown format`);
  const shape = raw['shape'];
  if (!isShape(shape)) throw new ClientsDataInvalid(`${where}: unknown shape`);
  const scope = raw['scope'];
  if (scope !== 'user' && scope !== 'project') throw new ClientsDataInvalid(`${where}: scope must be user or project`);
  const verified = raw['verified'];
  if (verified !== 'upstream' && verified !== 'docs') {
    throw new ClientsDataInvalid(`${where}: verified must be upstream or docs`);
  }
  const path = str(raw, 'path', where);
  if (!/^(~\/|%APPDATA%\/|%USERPROFILE%\/|\.\/)/.test(path)) {
    throw new ClientsDataInvalid(`${where}: path ${path} starts with none of ~/ %APPDATA%/ %USERPROFILE%/ ./`);
  }
  if ((scope === 'project') !== path.startsWith('./')) {
    throw new ClientsDataInvalid(`${where}: a project path is exactly one that starts with ./`);
  }
  const loc: ConfigLocation = { platforms, path, format, shape, scope, verified };
  const key = raw['key'];
  if (shape === 'server_map') {
    if (!isStringArray(key) || key.length === 0) throw new ClientsDataInvalid(`${where}: server_map needs a key path`);
    loc.key = key;
  } else if (key !== undefined) {
    throw new ClientsDataInvalid(`${where}: key is read only for server_map`);
  }
  const prv = raw['plugin_root_var'];
  if (prv !== undefined) {
    if (typeof prv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(prv)) {
      throw new ClientsDataInvalid(`${where}: plugin_root_var must be an environment-variable name`);
    }
    loc.plugin_root_var = prv;
  }
  return loc;
}

export function parseClientsData(raw: unknown): ClientsData {
  if (!isRecord(raw)) throw new ClientsDataInvalid('clients.json: not an object');
  const up = raw['upstream'];
  if (!isRecord(up)) throw new ClientsDataInvalid('clients.json: upstream missing');
  const upstream = {
    repository: str(up, 'repository', 'upstream'),
    commit: str(up, 'commit', 'upstream'),
    file: str(up, 'file', 'upstream'),
    license: str(up, 'license', 'upstream'),
  };
  if (!/^[0-9a-f]{40}$/.test(upstream.commit)) throw new ClientsDataInvalid('upstream: commit must be a full SHA');
  const list = raw['clients'];
  if (!Array.isArray(list)) throw new ClientsDataInvalid('clients.json: clients must be a list');
  const seen = new Set<string>();
  const clients: ClientEntry[] = list.map((c: unknown, i: number) => {
    const where = `clients[${i}]`;
    if (!isRecord(c)) throw new ClientsDataInvalid(`${where}: not an object`);
    const name = str(c, 'name', where);
    if (seen.has(name)) throw new ClientsDataInvalid(`${where}: ${name} is listed twice`);
    seen.add(name);
    const status = c['status'];
    if (status !== 'covered' && status !== 'not covered') {
      throw new ClientsDataInvalid(`${where}: status must be covered or not covered`);
    }
    const paths = c['mcp_config_paths'];
    if (!Array.isArray(paths)) throw new ClientsDataInvalid(`${where}: mcp_config_paths must be a list`);
    const locations = paths.map((p: unknown, j: number) => location(p, `${name}.mcp_config_paths[${j}]`));
    if (status === 'covered' && locations.length === 0) {
      throw new ClientsDataInvalid(`${where}: ${name} is covered but names no path`);
    }
    if (status === 'not covered' && locations.length > 0) {
      throw new ClientsDataInvalid(`${where}: ${name} is not covered but names a path`);
    }
    const entry: ClientEntry = { name, status, mcp_config_paths: locations };
    const note = c['note'];
    if (note !== undefined) {
      if (typeof note !== 'string') throw new ClientsDataInvalid(`${where}: note must be a string`);
      entry.note = note;
    }
    const also = c['also_emit_as'];
    if (also !== undefined) {
      if (!isRecord(also)) throw new ClientsDataInvalid(`${where}: also_emit_as must be an object`);
      entry.also_emit_as = { client: str(also, 'client', where), via: str(also, 'via', where) };
    }
    return entry;
  });
  return { upstream, clients };
}

export const CLIENTS_DATA_URL = new URL('../../data/clients.json', import.meta.url);

export function loadClientsData(url: URL = CLIENTS_DATA_URL): ClientsData {
  const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'));
  return parseClientsData(parsed);
}
