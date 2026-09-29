/**
 * The Python half of `CodeCatalog.package_name` and `CodeCatalog.sdks` (ACP-455).
 *
 * LINE READERS, NOT PARSERS: pyproject.toml, requirements*.txt, Pipfile, environment.yml,
 * setup.cfg and setup.py are read for exactly two facts -- the project's name, and the
 * declared requirement on each known tool-calling SDK. A shape they do not recognise is
 * skipped, never guessed at, so an SDK can be missed (and the tools scan still finds its
 * tools through the imports) but never invented.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { judgeFolders, type FolderJudgement } from '../folders.js';
import { looksLikeModelLibrary } from '../sdks.js';

/**
 * PyPI names of the SDKs the Python front end reads, normalised per PEP 503.
 * `instructor` is here although it defines no tools: the scan names it so the reader
 * sees why its response models were NOT reported as tools.
 */
export const PY_SDK_PACKAGES: readonly string[] = [
  'anthropic',
  'openai',
  'google-genai',
  'google-generativeai',
  'langchain',
  'langchain-core',
  'langchain-community',
  'langgraph',
  'openai-agents',
  'pydantic-ai',
  'pydantic-ai-slim',
  'crewai',
  'crewai-tools',
  'mcp',
  'fastmcp',
  'mistralai',
  'cohere',
  'instructor',
  // ACP-455, the frameworks after milestone 1 (record 3.3 onward).
  'claude-agent-sdk',
  'agent-framework',
  'agent-framework-core',
  'autogen-agentchat',
  'autogen-core',
  'ag2',
  'autogen',
  'pyautogen',
  'semantic-kernel',
  'haystack-ai',
  'google-adk',
  'strands-agents',
  'strands-agents-tools',
  'llama-index',
  'llama-index-core',
  'smolagents',
  'dspy',
  'dspy-ai',
];

// The folders not read are the scan's one judgement (`../folders.ts`, ACP-476): the manifest
// walk, the file count and `py/ziffer_scan_code.py` all obey it; none keeps a list of names.

const MAX_DEPTH = 8;

export interface PyManifests {
  package_name?: string;
  sdks: { name: string; version: string }[];
  /** Declared requirements neither the walker nor `code-sdks.json` reads whose names suggest a model or AI agent library (ACP-475). */
  unread: { name: string; version: string }[];
}

export function normalisePyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** `name[extras] spec ; marker` -> [normalised name, spec or "*"]; null for anything else. */
export function parseRequirement(line: string): [string, string] | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([^;#]*)/.exec(line);
  if (m === null) return null;
  const name = m[1];
  if (name === undefined) return null;
  const spec = (m[3] ?? '').trim();
  return [normalisePyName(name), spec === '' ? '*' : spec];
}

function quotedStrings(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    out.push(m[1] ?? m[2] ?? '');
  }
  return out;
}

function stripComment(line: string): string {
  // Strings first, so a `#` inside a requirement URL does not end the line.
  // Blanked to the same length, so an index in the blanked line is an index in `line`.
  const blanked = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (s) => ' '.repeat(s.length));
  const hash = blanked.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

interface Collected {
  name?: string;
  reqs: [string, string][];
}

/** pyproject.toml and Pipfile: PEP 621 arrays, optional-dependencies, dependency-groups, Poetry and Pipfile tables. */
function readTomlRequirements(text: string, pipfile: boolean): Collected {
  const out: Collected = { reqs: [] };
  let section = '';
  let inArray = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (inArray) {
      for (const s of quotedStrings(line)) {
        const r = parseRequirement(s);
        if (r !== null) out.reqs.push(r);
      }
      if (line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').includes(']')) inArray = false;
      continue;
    }
    const header = /^\s*\[\s*([^\]]+?)\s*\]\s*$/.exec(line);
    if (header !== null) {
      section = (header[1] ?? '').replace(/["']/g, '');
      continue;
    }
    const kv = /^\s*("?[A-Za-z0-9_.-]+"?)\s*=\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const key = (kv[1] ?? '').replace(/"/g, '');
    const value = (kv[2] ?? '').trim();
    const nameSection = section === 'project' || section === 'tool.poetry';
    if (nameSection && key === 'name') {
      const s = quotedStrings(value)[0];
      if (s !== undefined && out.name === undefined) out.name = s;
      continue;
    }
    const arraySection =
      (section === 'project' && key === 'dependencies') ||
      section === 'project.optional-dependencies' ||
      section === 'dependency-groups';
    if (arraySection && value.startsWith('[')) {
      for (const s of quotedStrings(value)) {
        const r = parseRequirement(s);
        if (r !== null) out.reqs.push(r);
      }
      if (!value.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').includes(']')) inArray = true;
      continue;
    }
    const tableSection = pipfile
      ? section === 'packages' || section === 'dev-packages'
      : section === 'tool.poetry.dependencies' || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section);
    if (tableSection && key !== 'python') {
      let spec: string | undefined;
      if (value.startsWith('{')) {
        const v = /version\s*=\s*["']([^"']*)["']/.exec(value);
        spec = v?.[1];
      } else {
        spec = quotedStrings(value)[0];
      }
      out.reqs.push([normalisePyName(key), spec === undefined || spec === '' ? '*' : spec]);
    }
  }
  return out;
}

function readRequirementsTxt(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('-')) continue;
    const r = parseRequirement(line);
    if (r !== null) out.push(r);
  }
  return out;
}

function readEnvironmentYml(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*-\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([=<>!~][^#]*)?\s*(#.*)?$/.exec(raw);
    if (m === null || m[1] === undefined || m[1] === 'pip') continue;
    const spec = (m[3] ?? '').trim();
    out.push([normalisePyName(m[1]), spec === '' ? '*' : spec]);
  }
  return out;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function nameFromSetup(root: string): string | undefined {
  const cfg = readText(join(root, 'setup.cfg'));
  if (cfg !== null) {
    let section = '';
    for (const line of cfg.split(/\r?\n/)) {
      const h = /^\s*\[([^\]]+)\]/.exec(line);
      if (h !== null) {
        section = (h[1] ?? '').trim();
        continue;
      }
      const m = /^\s*name\s*=\s*(\S+)\s*$/.exec(line);
      if (section === 'metadata' && m !== null && m[1] !== undefined) return m[1];
    }
  }
  const py = readText(join(root, 'setup.py'));
  if (py !== null) {
    const m = /\bsetup\s*\([\s\S]*?\bname\s*=\s*["']([^"']+)["']/.exec(py);
    if (m !== null && m[1] !== undefined) return m[1];
  }
  return undefined;
}

function isManifest(name: string): 'pyproject' | 'pipfile' | 'requirements' | 'environment' | null {
  if (name === 'pyproject.toml') return 'pyproject';
  if (name === 'Pipfile') return 'pipfile';
  if (/^requirements.*\.(txt|in)$/.test(name)) return 'requirements';
  if (name === 'environment.yml' || name === 'environment.yaml') return 'environment';
  return null;
}

/** Every manifest under `root` (skipping the same directories the walker skips), root first. */
function manifestPaths(root: string, folders: FolderJudgement): { path: string; kind: 'pyproject' | 'pipfile' | 'requirements' | 'environment'; atRoot: boolean }[] {
  const out: { path: string; kind: 'pyproject' | 'pipfile' | 'requirements' | 'environment'; atRoot: boolean }[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of sorted) {
      if (!e.isFile()) continue;
      const kind = isManifest(e.name);
      if (kind !== null) out.push({ path: join(dir, e.name), kind, atRoot: depth === 0 });
    }
    if (depth >= MAX_DEPTH) return;
    for (const e of sorted) {
      if (e.isDirectory() && !folders.skips(join(dir, e.name))) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The project name at `root` and the known SDKs any manifest in the tree declares, first declaration wins. */
export function readPythonManifests(root: string, folders: FolderJudgement = judgeFolders(root)): PyManifests {
  const known = new Set(PY_SDK_PACKAGES);
  const sdks: { name: string; version: string }[] = [];
  const seen = new Set<string>();
  let packageName: string | undefined;
  const unread: { name: string; version: string }[] = [];
  for (const m of manifestPaths(root, folders)) {
    const text = readText(m.path);
    if (text === null) continue;
    let reqs: [string, string][];
    if (m.kind === 'pyproject' || m.kind === 'pipfile') {
      const c = readTomlRequirements(text, m.kind === 'pipfile');
      if (m.atRoot && m.kind === 'pyproject' && c.name !== undefined && packageName === undefined) packageName = c.name;
      reqs = c.reqs;
    } else if (m.kind === 'requirements') {
      reqs = readRequirementsTxt(text);
    } else {
      reqs = readEnvironmentYml(text);
    }
    for (const [name, version] of reqs) {
      if (!known.has(name)) {
        // Not a library the walker reads: named in the report when its name suggests one (ACP-475).
        if (looksLikeModelLibrary(name, 'pypi') && !seen.has(name)) {
          seen.add(name);
          unread.push({ name, version });
        }
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      sdks.push({ name, version });
    }
  }
  if (packageName === undefined) packageName = nameFromSetup(root);
  unread.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return packageName === undefined ? { sdks, unread } : { package_name: packageName, sdks, unread };
}

/** How many `.py` files the walker would read: the count the report gives when no interpreter exists. */
export function countPythonFiles(root: string, folders: FolderJudgement = judgeFolders(root)): number {
  let n = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!folders.skips(join(dir, e.name))) walk(join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith('.py')) {
        n += 1;
      }
    }
  };
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    return 0;
  }
  return n;
}
