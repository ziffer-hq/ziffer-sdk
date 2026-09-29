/**
 * Which folders `ziffer-scan --code` does not read, and why (ACP-476, 0.3.1).
 *
 * A folder is skipped for what it IS, never for its name alone. Until 0.3.0 every folder
 * named `build`, `dist`, `out` or `test` was skipped by name, so a tool an application
 * defined in `src/build/` was absent from the report, and the reader was told only
 * "build output". Now a listed name is where the question starts: the folder is skipped
 * when the evidence `data/code-folders.json` names for it holds (the project's own
 * .gitignore, a tsconfig's `outDir`, a marker file inside it, a lockfile beside it, the
 * TypeScript it was compiled from, a test inside it), and read otherwise.
 *
 * ONE walk decides, for both front ends and the skill walk: `judgeFolders` runs once per
 * scan, and the TypeScript walk, the Python walker (handed the list on its standard
 * input) and the skill walk each obey the same `FolderJudgement`. Three walkers deciding
 * for themselves was how the Python half came to skip `build` by a list of its own.
 *
 * Read-only: files are listed and read as text, and nothing is run. In particular git is
 * not run to ask what it ignores: a repository's own git configuration can name a program
 * git starts (`core.fsmonitor`), and the scan never starts a program the tree names. The
 * .gitignore files are read and matched here instead.
 *
 * WHAT IT DOES NOT SEE. Ignore rules outside the scanned folder (a .gitignore above it,
 * `.git/info/exclude`, a global excludes file) are not read, so scanning a sub-folder of a
 * repository sees fewer rules than scanning its root. A folder whose name is not listed is
 * never skipped here, whatever it holds. A test folder that holds one test and other source
 * besides is test code as a whole.
 */

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------- the data file

export type FolderKind = 'dependencies' | 'build' | 'vcs' | 'test';
const KINDS: readonly FolderKind[] = ['dependencies', 'build', 'vcs', 'test'];

export interface FolderRule {
  names: string[];
  kind: FolderKind;
  countFiles: boolean;
  ignored: boolean;
  outDir: boolean;
  compiledTwin: boolean;
  holdsTests: boolean;
  inside: string[];
  beside: string[];
}

export interface FolderRules {
  kinds: Record<FolderKind, string>;
  tsconfigNames: RegExp;
  folders: FolderRule[];
  testFileNames: RegExp[];
  testRunners: string[];
  testCode: RegExp[];
}

export class CodeFoldersDataInvalid extends Error {
  constructor(detail: string) {
    super(`CodeFoldersDataInvalid: data/code-folders.json: ${detail}`);
    this.name = 'CodeFoldersDataInvalid';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strings(v: unknown, where: string, optional = false): string[] {
  if (v === undefined && optional) return [];
  if (!Array.isArray(v)) throw new CodeFoldersDataInvalid(`${where} is not an array`);
  return v.map((x) => {
    if (typeof x !== 'string' || x === '') throw new CodeFoldersDataInvalid(`${where} holds a value that is not a non-empty string`);
    return x;
  });
}

function flag(v: unknown, where: string): boolean {
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw new CodeFoldersDataInvalid(`${where} is not true or false`);
  return v;
}

function regex(s: string, where: string, flags = ''): RegExp {
  try {
    return new RegExp(s, flags);
  } catch (e) {
    throw new CodeFoldersDataInvalid(`${where} is not a regular expression (${e instanceof Error ? e.message : String(e)})`);
  }
}

export function parseCodeFolders(text: string): FolderRules {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CodeFoldersDataInvalid(`not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isRecord(raw)) throw new CodeFoldersDataInvalid('not an object');
  const k = raw['kinds'];
  if (!isRecord(k)) throw new CodeFoldersDataInvalid('no `kinds` object');
  const kinds = {} as Record<FolderKind, string>;
  for (const kind of KINDS) {
    const words = k[kind];
    if (typeof words !== 'string' || words === '') throw new CodeFoldersDataInvalid(`kinds.${kind} is missing`);
    kinds[kind] = words;
  }
  if (typeof raw['tsconfig_names'] !== 'string') throw new CodeFoldersDataInvalid('`tsconfig_names` is missing');
  if (!Array.isArray(raw['folders'])) throw new CodeFoldersDataInvalid('no `folders` array');
  const folders: FolderRule[] = raw['folders'].map((f: unknown, i: number) => {
    const where = `folders[${i}]`;
    if (!isRecord(f)) throw new CodeFoldersDataInvalid(`${where} is not an object`);
    const kind = f['kind'];
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw new CodeFoldersDataInvalid(`${where}.kind is not one of ${KINDS.join(', ')}`);
    const rule: FolderRule = {
      names: strings(f['names'], `${where}.names`),
      kind: kind as FolderKind,
      countFiles: flag(f['count_files'], `${where}.count_files`),
      ignored: flag(f['ignored'], `${where}.ignored`),
      outDir: flag(f['out_dir'], `${where}.out_dir`),
      compiledTwin: flag(f['compiled_twin'], `${where}.compiled_twin`),
      holdsTests: flag(f['holds_tests'], `${where}.holds_tests`),
      inside: strings(f['inside'], `${where}.inside`, true),
      beside: strings(f['beside'], `${where}.beside`, true),
    };
    // An entry with no evidence would skip nothing, and read as a rule that does.
    if (!rule.ignored && !rule.outDir && !rule.compiledTwin && !rule.holdsTests && rule.inside.length === 0 && rule.beside.length === 0) {
      throw new CodeFoldersDataInvalid(`${where} names no evidence: a folder would be skipped by its name alone`);
    }
    return rule;
  });
  const testFileNames = strings(raw['test_file_names'], '`test_file_names`').map((s, i) => regex(s, `test_file_names[${i}]`));
  const testRunners = strings(raw['test_runners'], '`test_runners`');
  const testCode = strings(raw['test_code'], '`test_code`').map((s, i) => regex(s, `test_code[${i}]`, 'm'));
  return { kinds, tsconfigNames: regex(raw['tsconfig_names'], '`tsconfig_names`'), folders, testFileNames, testRunners, testCode };
}

export const CODE_FOLDERS_FILE = new URL('../../data/code-folders.json', import.meta.url);

let cached: FolderRules | undefined;
export function loadCodeFolders(): FolderRules {
  if (cached === undefined) cached = parseCodeFolders(readFileSync(CODE_FOLDERS_FILE, 'utf8'));
  return cached;
}

// ---------------------------------------------------------------- globs

/** One path segment's glob (`*`, `?`, `[...]`) as a regular expression over that segment. */
function segmentRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) re += '\\[';
      else {
        const body = glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\');
        re += `[${body}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < glob.length) {
      re += (glob[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 1;
    } else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Whether a folder name matches one of the rule's names (exact, or a one-segment glob). */
function nameMatches(name: string, names: readonly string[]): boolean {
  return names.some((n) => (/[*?[]/.test(n) ? segmentRe(n).test(name) : n === name));
}

/** Whether `rel` (under `dir`) exists, where a segment may be a glob over one level. */
function existsGlob(dir: string, rel: string): boolean {
  const [head, ...rest] = rel.split('/');
  if (head === undefined || head === '') return false;
  if (!/[*?[]/.test(head)) {
    const p = join(dir, head);
    return rest.length === 0 ? existsSync(p) : existsGlob(p, rest.join('/'));
  }
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const re = segmentRe(head);
  for (const e of entries) {
    if (!re.test(e.name)) continue;
    if (rest.length === 0) return true;
    if (e.isDirectory() && existsGlob(join(dir, e.name), rest.join('/'))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- .gitignore

interface IgnoreRule {
  /** The folder the .gitignore sits in. */
  base: string;
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

/** One .gitignore line as a rule, per gitignore(5); undefined for a blank line or a comment. */
export function gitignoreRule(base: string, line: string): IgnoreRule | undefined {
  let p = line.replace(/(?<!\\)\s+$/, '');
  if (p === '' || p.startsWith('#')) return undefined;
  let negate = false;
  if (p.startsWith('!')) {
    negate = true;
    p = p.slice(1);
  } else if (p.startsWith('\\!') || p.startsWith('\\#')) p = p.slice(1);
  let dirOnly = false;
  if (p.endsWith('/')) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  if (p === '') return undefined;
  // A pattern with a slash before its end is relative to the .gitignore's folder; one
  // without matches a name at any depth under it.
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const parts = p.split('/');
  let re = '';
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    if (part === '**') {
      re += last ? '.*' : '(?:.*/)?';
      return;
    }
    const seg = segmentRe(part).source.slice(1, -1);
    re += seg + (last ? '' : '/');
  });
  const full = anchored ? `^${re}$` : `^(?:.*/)?${re}$`;
  return { base, re: new RegExp(full), negate, dirOnly };
}

// ---------------------------------------------------------------- the judgement

export interface SkippedFolder {
  /** Relative to the scanned root, POSIX separators. */
  path: string;
  kind: FolderKind;
  /** What showed the folder is what it is, in a few words (`.gitignore`, `tsconfig.json outDir`, `holds pyvenv.cfg`). */
  evidence: string;
  /** Source files in it (TypeScript, JavaScript, Python) when the rule counts them; 0 otherwise. */
  files: number;
}

export interface FolderJudgement {
  root: string;
  /** Every folder not read, in walk order. */
  skipped: SkippedFolder[];
  /** Whether a folder (absolute) is one of them. */
  skips(abs: string): boolean;
  /** The judged folder for an absolute path, when skipped. */
  get(abs: string): SkippedFolder | undefined;
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.ipynb']);
const TS_OWN = /\.(ts|tsx|mts|cts)$/;
const DECLARATION = /\.d\.[mc]?ts$|\.d\.[^.]+\.ts$/;
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;
const MAX_TEST_READ = 256 * 1024;

function listDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Every file under `dir` (absolute), folders holding a `.git` file left out, at most `cap`. */
function filesUnder(dir: string, cap = Infinity): string[] {
  const out: string[] = [];
  const visit = (d: string): void => {
    for (const e of listDir(d)) {
      if (out.length >= cap) return;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!existsFile(join(full, '.git'))) visit(full);
      } else if (e.isFile()) out.push(full);
    }
  };
  visit(dir);
  return out;
}

function existsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function runnerRe(runners: readonly string[]): RegExp {
  const alt = runners.map((r) => r.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  // `import ... from 'x'`, `import 'x'`, `require('x')`, `from x import`, `import x` (Python), each also for a path under x.
  return new RegExp(`(?:from\\s+['"](?:${alt})(?:/[^'"]*)?['"]|import\\s+['"](?:${alt})(?:/[^'"]*)?['"]|require\\s*\\(\\s*['"](?:${alt})(?:/[^'"]*)?['"]\\s*\\)|^\\s*from\\s+(?:${alt})(?:\\.[\\w.]+)?\\s+import\\b|^\\s*import\\s+(?:${alt})\\b)`, 'm');
}

/** Judge every folder under `root` once. Reads only; runs nothing. */
export function judgeFolders(root: string, rules: FolderRules = loadCodeFolders()): FolderJudgement {
  const abs = resolve(root);
  const skipped: SkippedFolder[] = [];
  const byPath = new Map<string, SkippedFolder>();
  const runners = runnerRe(rules.testRunners);
  const outDirs = new Map<string, Set<string>>();

  const rel = (p: string): string => relative(abs, p).split(sep).join('/');

  /** The ignore rules that apply under `dir`: every .gitignore from the root down to it. */
  const ignoreCache = new Map<string, IgnoreRule[]>();
  const ignoreRules = (dir: string): IgnoreRule[] => {
    const hit = ignoreCache.get(dir);
    if (hit !== undefined) return hit;
    const parent = dir === abs ? [] : ignoreRules(dirname(dir));
    let own: IgnoreRule[] = [];
    try {
      own = readFileSync(join(dir, '.gitignore'), 'utf8')
        .split(/\r?\n/)
        .map((l) => gitignoreRule(dir, l))
        .filter((r): r is IgnoreRule => r !== undefined);
    } catch {
      // no .gitignore here
    }
    const all = [...parent, ...own];
    ignoreCache.set(dir, all);
    return all;
  };
  const ignored = (folder: string): string | undefined => {
    let result: IgnoreRule | undefined;
    for (const r of ignoreRules(dirname(folder))) {
      const p = relative(r.base, folder).split(sep).join('/');
      if (p.startsWith('..') || !r.re.test(p)) continue;
      result = r.negate ? undefined : r;
    }
    return result === undefined ? undefined : `${rel(join(result.base, '.gitignore'))} ignores it`;
  };

  /** The outDir and declarationDir every tsconfig file in `dir` names, absolute, `extends` followed where it is a relative path. */
  const outDirsOf = (dir: string): Set<string> => {
    const hit = outDirs.get(dir);
    if (hit !== undefined) return hit;
    const found = new Set<string>();
    const readOne = (file: string, depth: number): void => {
      if (depth > 8) return;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        return;
      }
      const parsed = ts.parseConfigFileTextToJson(file, text);
      if (!isRecord(parsed.config)) return;
      const co = parsed.config['compilerOptions'];
      if (isRecord(co)) {
        for (const key of ['outDir', 'declarationDir']) {
          const v = co[key];
          if (typeof v === 'string' && v !== '') found.add(resolve(dirname(file), v));
        }
      }
      const ext = parsed.config['extends'];
      for (const x of typeof ext === 'string' ? [ext] : Array.isArray(ext) ? ext : []) {
        if (typeof x !== 'string' || !x.startsWith('.')) continue;
        const target = resolve(dirname(file), x);
        readOne(existsFile(target) ? target : `${target}.json`, depth + 1);
      }
    };
    for (const e of listDir(dir)) if (e.isFile() && rules.tsconfigNames.test(e.name)) readOne(join(dir, e.name), 0);
    outDirs.set(dir, found);
    return found;
  };
  const namedOutDir = (folder: string): string | undefined => {
    for (let d = dirname(folder); ; d = dirname(d)) {
      if (outDirsOf(d).has(folder)) return `a tsconfig file in ${rel(d) === '' ? 'the root' : rel(d)} names it as output`;
      if (d === abs || dirname(d) === d) return undefined;
    }
  };

  /** A JavaScript file in `folder` with a TypeScript file of the same path in a folder beside it; undefined when it holds its own TypeScript. */
  const compiledTwin = (folder: string): string | undefined => {
    const files = filesUnder(folder, 2000);
    if (files.some((f) => TS_OWN.test(f) && !DECLARATION.test(f))) return undefined;
    const parent = dirname(folder);
    const siblings = listDir(parent)
      .filter((e) => e.isDirectory() && join(parent, e.name) !== folder)
      .map((e) => join(parent, e.name));
    for (const f of files.filter((x) => JS_EXT.test(x)).slice(0, 200)) {
      const stem = relative(folder, f).replace(JS_EXT, '');
      for (const s of [parent, ...siblings]) {
        for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
          if (existsFile(join(s, stem + ext))) return `compiled from ${rel(join(s, stem + ext))}`;
        }
      }
    }
    return undefined;
  };

  /** A test among the source files in `folder`, by name or by what it imports or declares. */
  const holdsTest = (folder: string): string | undefined => {
    for (const f of filesUnder(folder)) {
      if (!SOURCE_EXT.has(extname(f))) continue;
      const name = f.slice(f.lastIndexOf(sep) + 1);
      if (rules.testFileNames.some((re) => re.test(name))) return `holds the test ${rel(f)}`;
      let text: string;
      try {
        if (statSync(f).size > MAX_TEST_READ) continue;
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      if (runners.test(text) || rules.testCode.some((re) => re.test(text))) return `holds the test ${rel(f)}`;
    }
    return undefined;
  };

  const evidence = (folder: string, rule: FolderRule): string | undefined => {
    for (const p of rule.inside) if (existsGlob(folder, p)) return `holds ${p}`;
    const parent = dirname(folder);
    for (const b of rule.beside) if (existsFile(join(parent, b))) return `sits beside ${b}`;
    if (rule.ignored) {
      const why = ignored(folder);
      if (why !== undefined) return why;
    }
    if (rule.outDir) {
      const why = namedOutDir(folder);
      if (why !== undefined) return why;
    }
    if (rule.compiledTwin) {
      const why = compiledTwin(folder);
      if (why !== undefined) return why;
    }
    if (rule.holdsTests) {
      const why = holdsTest(folder);
      if (why !== undefined) return why;
    }
    return undefined;
  };

  const countSources = (folder: string): number => filesUnder(folder).filter((f) => SOURCE_EXT.has(extname(f)) && !DECLARATION.test(f)).length;

  const visit = (dir: string): void => {
    // In name order, so the report names the same folders first on every machine.
    for (const e of listDir(dir).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      // A second checkout is the walkers' own rule (a directory holding a `.git` FILE): not descended here either.
      if (existsFile(join(full, '.git'))) continue;
      const rule = rules.folders.find((r) => nameMatches(e.name, r.names));
      const why = rule === undefined ? undefined : evidence(full, rule);
      if (rule !== undefined && why !== undefined) {
        const s: SkippedFolder = { path: rel(full), kind: rule.kind, evidence: why, files: rule.countFiles ? countSources(full) : 0 };
        skipped.push(s);
        byPath.set(full, s);
        continue;
      }
      visit(full);
    }
  };
  visit(abs);
  return {
    root: abs,
    skipped,
    skips: (p: string) => byPath.has(resolve(p)),
    get: (p: string) => byPath.get(resolve(p)),
  };
}

/** Whether a file's name is a test's (`test_file_names`): the walkers' per-file rule, from the same data. */
export function isTestFileName(name: string, rules: FolderRules = loadCodeFolders()): boolean {
  return rules.testFileNames.some((re) => re.test(name));
}

// ---------------------------------------------------------------- the report's line

/**
 * The one line that says which folders were not read and why (ACP-476): how many, and per
 * kind the first few by path with the evidence that showed what each is, and the source
 * files in them where the rule counts them. Undefined when no folder was skipped.
 */
export function skippedFoldersLine(j: Pick<FolderJudgement, 'skipped'>, rules: FolderRules = loadCodeFolders(), max = 3): string | undefined {
  if (j.skipped.length === 0) return undefined;
  const parts: string[] = [];
  for (const kind of KINDS) {
    const of = j.skipped.filter((s) => s.kind === kind);
    if (of.length === 0) continue;
    const words = rules.kinds[kind];
    const shown = of.slice(0, max).map((s) => `${s.path} (${s.evidence})`);
    const more = of.length > max ? ` and ${of.length - max} more` : '';
    const counted = rules.folders.some((r) => r.kind === kind && r.countFiles);
    const files = of.reduce((a, s) => a + s.files, 0);
    parts.push(`${words.charAt(0).toUpperCase()}${words.slice(1)}: ${shown.join(', ')}${more}${counted ? `, ${files} source ${files === 1 ? 'file' : 'files'}` : ''}.`);
  }
  const n = j.skipped.length;
  return `${n} ${n === 1 ? 'folder was' : 'folders were'} not read. ${parts.join(' ')} A folder is skipped for what it holds, never for its name alone.`;
}
