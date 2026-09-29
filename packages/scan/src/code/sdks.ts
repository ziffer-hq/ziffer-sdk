/**
 * `data/code-sdks.json`: the one list of tool-calling frameworks the code scan
 * knows by name, what each is declared as in a manifest, and whether a front end
 * reads it yet. Read once and checked against the shape relied on; a malformed
 * file HALTS by name (`CodeSdksDataInvalid`), because a framework silently
 * dropped from this list is a framework the report silently never names.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InterceptionKind, SourceRef } from './types.js';
import { packageMatches } from './ts/util.js';

export type Coverage = 'milestone-1' | 'not-yet';
export const COVERAGE_VALUES: readonly Coverage[] = ['milestone-1', 'not-yet'];

export interface CodeSdkEntry {
  id: string;
  framework: string;
  rows: string[];
  language: string[];
  packages: string[];
  covered: Coverage;
  kind: 'framework' | 'schema';
  /** Where a check can stand before the framework's tools run (`interception//` in the data file); absent when the table has none. */
  interception?: InterceptionPoint;
}

/** One framework's interception point as the data file declares it. */
export interface InterceptionPoint {
  kind: InterceptionKind;
  name: string;
  /** Names whose presence in the handing-over file reads as the hook registered there. */
  markers: string[];
  /** Per-tool approval names read on a definition (always K2). */
  tool_flags: string[];
}

const KINDS: readonly InterceptionKind[] = ['K1', 'K2', 'K3', 'K4', 'K5'];

function isKind(v: unknown): v is InterceptionKind {
  return typeof v === 'string' && KINDS.some((k) => k === v);
}

function parsePoint(v: unknown, where: string): InterceptionPoint | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) throw new CodeSdksDataInvalid(`${where} is not an object`);
  const { kind, name } = v;
  if (!isKind(kind)) throw new CodeSdksDataInvalid(`${where}.kind is not one of ${KINDS.join(', ')}`);
  if (typeof name !== 'string' || name === '') throw new CodeSdksDataInvalid(`${where}.name is missing`);
  return {
    kind,
    name,
    markers: v['markers'] === undefined ? [] : stringArray(v['markers'], `${where}.markers`),
    tool_flags: v['tool_flags'] === undefined ? [] : stringArray(v['tool_flags'], `${where}.tool_flags`),
  };
}

export class CodeSdksDataInvalid extends Error {
  constructor(detail: string) {
    super(`CodeSdksDataInvalid: data/code-sdks.json: ${detail}`);
    this.name = 'CodeSdksDataInvalid';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown, where: string): string[] {
  if (!Array.isArray(v)) throw new CodeSdksDataInvalid(`${where} is not an array`);
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') throw new CodeSdksDataInvalid(`${where} holds a non-string`);
    out.push(x);
  }
  return out;
}

function isCoverage(v: unknown): v is Coverage {
  return v === 'milestone-1' || v === 'not-yet';
}

export function parseCodeSdks(text: string): CodeSdkEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CodeSdksDataInvalid(`not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isRecord(raw) || !Array.isArray(raw['frameworks'])) throw new CodeSdksDataInvalid('no `frameworks` array');
  const seen = new Set<string>();
  const out: CodeSdkEntry[] = [];
  for (const [i, e] of raw['frameworks'].entries()) {
    const where = `frameworks[${i}]`;
    if (!isRecord(e)) throw new CodeSdksDataInvalid(`${where} is not an object`);
    const { id, framework, covered, kind } = e;
    if (typeof id !== 'string' || id === '') throw new CodeSdksDataInvalid(`${where}.id is missing`);
    if (seen.has(id)) throw new CodeSdksDataInvalid(`${where}.id "${id}" is declared twice`);
    seen.add(id);
    if (typeof framework !== 'string' || framework === '') throw new CodeSdksDataInvalid(`${where}.framework is missing`);
    if (!isCoverage(covered)) throw new CodeSdksDataInvalid(`${where}.covered is not one of ${COVERAGE_VALUES.join(', ')}`);
    if (kind !== 'framework' && kind !== 'schema') throw new CodeSdksDataInvalid(`${where}.kind is not framework|schema`);
    const interception = parsePoint(e['interception'], `${where}.interception`);
    out.push({
      id,
      framework,
      rows: stringArray(e['rows'], `${where}.rows`),
      language: stringArray(e['language'], `${where}.language`),
      packages: stringArray(e['packages'], `${where}.packages`),
      covered,
      kind,
      ...(interception === undefined ? {} : { interception }),
    });
  }
  return out;
}

export const CODE_SDKS_FILE = new URL('../../data/code-sdks.json', import.meta.url);

let cached: CodeSdkEntry[] | undefined;
export function loadCodeSdks(): CodeSdkEntry[] {
  if (cached === undefined) cached = parseCodeSdks(readFileSync(CODE_SDKS_FILE, 'utf8'));
  return cached;
}

export function sdkEntry(id: string): CodeSdkEntry | undefined {
  return loadCodeSdks().find((e) => e.id === id);
}

/** The two name lists of the 2026-09-28 checks (ACP-455): data, read from the same file by the same loader. */
export interface CodeNames {
  /** Property names on a tool definition that claim an authority rule (`CodeTool.authority_claims`). */
  authorityClaims: string[];
  /** Names a condition before a dispatcher call is read as a confirmation check by (`CallerCheck.check`). */
  confirmation: string[];
}

export function parseCodeNames(text: string): CodeNames {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CodeSdksDataInvalid(`not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isRecord(raw)) throw new CodeSdksDataInvalid('not an object');
  const authorityClaims = stringArray(raw['authority_claim_names'], '`authority_claim_names`');
  const confirmation = stringArray(raw['confirmation_names'], '`confirmation_names`');
  // An empty list would turn a check into one that can never fire, and read as "none found".
  if (authorityClaims.length === 0) throw new CodeSdksDataInvalid('`authority_claim_names` is empty');
  if (confirmation.length === 0) throw new CodeSdksDataInvalid('`confirmation_names` is empty');
  return { authorityClaims, confirmation };
}

let cachedNames: CodeNames | undefined;
export function loadCodeNames(): CodeNames {
  if (cachedNames === undefined) cachedNames = parseCodeNames(readFileSync(CODE_SDKS_FILE, 'utf8'));
  return cachedNames;
}

/** The npm packages of one framework id, for matching a declaration's package. */
export function packagesOf(id: string): string[] {
  return sdkEntry(id)?.packages ?? [];
}

/** The entry a dependency name belongs to, when it is one the file names. */
export function entryForPackage(name: string): CodeSdkEntry | undefined {
  return loadCodeSdks().find((e) => packageMatches(name, e.packages));
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

export interface ManifestRead {
  sdks: { name: string; version: string }[];
  /** Declared dependencies no entry matches whose names suggest a model or AI agent library (`model_library_names`, ACP-475). */
  unread: { name: string; version: string }[];
  packageName?: string;
}

// ---------------------------------------------------------------- a library the scan does not read (ACP-475)

export interface ModelLibraryNames {
  npm: string[];
  pypi: string[];
  words: string[];
  except: string[];
}

export function parseModelLibraryNames(text: string): ModelLibraryNames {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CodeSdksDataInvalid(`not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isRecord(raw) || !isRecord(raw['model_library_names'])) throw new CodeSdksDataInvalid('no `model_library_names` object');
  const m = raw['model_library_names'];
  const out = {
    npm: stringArray(m['npm'], '`model_library_names.npm`'),
    pypi: stringArray(m['pypi'], '`model_library_names.pypi`'),
    words: stringArray(m['words'], '`model_library_names.words`').map((w) => w.toLowerCase()),
    except: stringArray(m['except'], '`model_library_names.except`'),
  };
  // An empty list would make the line one that can never print, and silence read as "no other library".
  if (out.words.length === 0) throw new CodeSdksDataInvalid('`model_library_names.words` is empty');
  return out;
}

let cachedLibraries: ModelLibraryNames | undefined;
export function loadModelLibraryNames(): ModelLibraryNames {
  if (cachedLibraries === undefined) cachedLibraries = parseModelLibraryNames(readFileSync(CODE_SDKS_FILE, 'utf8'));
  return cachedLibraries;
}

/**
 * Whether a declared dependency no entry of `frameworks` matches has a name that suggests a model
 * or AI agent library: listed for its registry, or holding one of the words as a whole word, and
 * not excepted. A reading of the NAME only: nothing the package defines has been read.
 */
export function looksLikeModelLibrary(name: string, registry: 'npm' | 'pypi', names: ModelLibraryNames = loadModelLibraryNames()): boolean {
  if (entryForPackage(name) !== undefined) return false;
  if (packageMatches(name, names.except)) return false;
  if (packageMatches(name, names[registry])) return true;
  return name
    .toLowerCase()
    .split(/[@/._-]+/)
    .some((w) => names.words.includes(w));
}

/**
 * The line that names the declared libraries the scan does not read (ACP-475), so a report with no
 * tool from them never reads as "no tools". It says what was read and names the packages; it says
 * nothing about their tools. Undefined when there is none.
 */
export function unreadLibrariesLine(where: string, deps: readonly { name: string; version: string }[], sdks: readonly CodeSdkEntry[] = loadCodeSdks()): string | undefined {
  if (deps.length === 0) return undefined;
  const read = sdks.filter((e) => e.kind === 'framework' && e.covered === 'milestone-1').length;
  const shown = deps.slice(0, 10).map((d) => `${d.name} ${d.version}`);
  const more = deps.length > 10 ? ` and ${deps.length - 10} more` : '';
  const one = deps.length === 1;
  return `Declared in ${where} and not read by this scan: ${shown.join(', ')}${more}. ${one ? 'Its name suggests' : 'Their names suggest'} a model or AI agent library. This scan reads the ${read} frameworks it lists, and a tool defined through another library is not in these numbers.`;
}

/**
 * Every known framework dependency declared by the package.json files given
 * (the root one first, when present), deduplicated on name and version.
 */
export function readManifests(files: readonly string[], rootManifest: string | undefined): ManifestRead {
  const seen = new Set<string>();
  const sdks: { name: string; version: string }[] = [];
  const unread: { name: string; version: string }[] = [];
  const unreadSeen = new Set<string>();
  let packageName: string | undefined;
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!isRecord(raw)) continue;
    if (file === rootManifest && typeof raw['name'] === 'string') packageName = raw['name'];
    for (const field of DEP_FIELDS) {
      const deps = raw[field];
      if (!isRecord(deps)) continue;
      for (const [name, version] of Object.entries(deps)) {
        if (typeof version !== 'string') continue;
        if (entryForPackage(name) === undefined) {
          // Not a framework the scan reads: named in the report when its name suggests one (ACP-475).
          if (looksLikeModelLibrary(name, 'npm') && !unreadSeen.has(`${name}@${version}`)) {
            unreadSeen.add(`${name}@${version}`);
            unread.push({ name, version });
          }
          continue;
        }
        const key = `${name}@${version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sdks.push({ name, version });
      }
    }
  }
  const order = (a: { name: string; version: string }, b: { name: string; version: string }): number => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1);
  sdks.sort(order);
  unread.sort(order);
  return packageName === undefined ? { sdks, unread } : { sdks, unread, packageName };
}

// ---------------------------------------------------------------- the framework's own source

/** A directory segment under which a framework's repository keeps code written the way an application would write it. */
const APPLICATION_SEGMENTS = new Set(['examples', 'example', 'demo', 'demos', 'samples', 'sample', 'cookbook', 'cookbooks', 'playground', 'quickstarts']);

/** A PyPI name as the index compares it (PEP 503): lower case, runs of `-`, `_`, `.` as one `-`. */
function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/** The `name` a Python manifest declares: `[project]` or `[tool.poetry]` in pyproject.toml, `[metadata]` in setup.cfg, a literal `name=` in setup.py. */
export function pythonManifestName(file: string, text: string): string | undefined {
  if (file.endsWith('setup.py')) return /\bname\s*=\s*["']([^"']+)["']/.exec(text)?.[1];
  const sections = file.endsWith('setup.cfg') ? ['metadata'] : ['project', 'tool.poetry'];
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      current = (header[1] ?? '').trim();
      continue;
    }
    if (!sections.includes(current)) continue;
    const m = /^name\s*[=:]\s*["']?([^"'\s#]+)["']?/.exec(line);
    if (m !== null) return m[1];
  }
  return undefined;
}

export interface OwnSource {
  /** The framework package whose own source holds the file. */
  pkg: string;
  /** Its manifest, relative to the scanned root. */
  manifest: string;
}

const MANIFESTS = ['package.json', 'pyproject.toml', 'setup.cfg', 'setup.py'];

/**
 * A reader of "is this file the framework's OWN source?" over one scanned tree.
 *
 * A repository that publishes a tool-calling framework DEFINES `tool()` in its
 * source, and calls it in its tests; counting those as the customer's tools is a
 * false finding. The rule: a file whose nearest manifest (package.json,
 * pyproject.toml, setup.cfg, setup.py; within the scanned root) names a package
 * of a framework in data/code-sdks.json is that framework's own code -- unless
 * the file's path passes through an examples, demo, sample, cookbook or
 * playground directory, which holds code written as an
 * application would write it and IS counted. Cached per directory.
 */
export function ownSourceReader(root: string): (relFile: string) => OwnSource | undefined {
  const byDir = new Map<string, { name: string; manifest: string } | null>();
  const manifestOf = (dir: string): { name: string; manifest: string } | null => {
    const hit = byDir.get(dir);
    if (hit !== undefined) return hit;
    let found: { name: string; manifest: string } | null = null;
    for (const m of MANIFESTS) {
      const rel = dir === '' ? m : `${dir}/${m}`;
      let text: string;
      try {
        text = readFileSync(join(root, rel), 'utf8');
      } catch {
        continue;
      }
      let name: string | undefined;
      if (m === 'package.json') {
        try {
          const raw: unknown = JSON.parse(text);
          if (isRecord(raw) && typeof raw['name'] === 'string') name = raw['name'];
        } catch {
          name = undefined;
        }
      } else {
        name = pythonManifestName(m, text);
      }
      if (name !== undefined && name !== '') {
        found = { name, manifest: rel };
        break;
      }
    }
    if (found === null && dir !== '') {
      const i = dir.lastIndexOf('/');
      found = manifestOf(i < 0 ? '' : dir.slice(0, i));
    }
    byDir.set(dir, found);
    return found;
  };
  return (relFile: string): OwnSource | undefined => {
    const norm = relFile.split('\\').join('/');
    if (norm.startsWith('../')) return undefined;
    const i = norm.lastIndexOf('/');
    const m = manifestOf(i < 0 ? '' : norm.slice(0, i));
    if (m === null) return undefined;
    const pkg = frameworkPackage(m.name);
    if (pkg === undefined) return undefined;
    // Any examples/demo/... directory on the way, above the manifest or below it: an
    // example package can be NAMED like the framework (`examples/mcp`, name "mcp").
    if (norm.split('/').slice(0, -1).some((seg) => APPLICATION_SEGMENTS.has(seg.toLowerCase()))) return undefined;
    return { pkg, manifest: m.manifest };
  };
}

/** The package name when it is one a framework (not a schema library, not `local`) publishes; npm names as written, PyPI names normalised. */
export function frameworkPackage(name: string): string | undefined {
  const e = entryForPackage(name) ?? entryForPackage(normaliseName(name));
  return e !== undefined && e.kind === 'framework' ? name : undefined;
}

function listOf(xs: string[], max = 5): string {
  return xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`;
}

/**
 * Split what the code says into the application's and the framework's own: a
 * definition in the source of a package that publishes a tool-calling framework
 * (`ownSourceReader`) is the framework's, and never the customer's tool.
 */
export function partitionOwnSource<T>(items: T[], at: (x: T) => SourceRef, own: (file: string) => OwnSource | undefined): { kept: T[]; dropped: Map<string, number> } {
  const kept: T[] = [];
  const dropped = new Map<string, number>();
  for (const x of items) {
    const o = own(at(x).file);
    if (o === undefined) kept.push(x);
    else dropped.set(o.pkg, (dropped.get(o.pkg) ?? 0) + 1);
  }
  return { kept, dropped };
}

/** The sentence a report prints for the framework-own definitions a run left out. */
export function ownSourceLine(dropped: ReadonlyMap<string, number>): string | undefined {
  const n = [...dropped.values()].reduce((a, b) => a + b, 0);
  if (n === 0) return undefined;
  const pkgs = [...dropped.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p, c]) => `${p} ${c}`);
  return `${n} tool definition(s) sit in the source of a tool-calling framework this tree publishes (${listOf(pkgs)}) and are not counted: a framework's own code and tests are not an application; its examples and apps are.`;
}

