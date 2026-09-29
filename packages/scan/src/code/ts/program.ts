/**
 * Walk the customer's tree and build one type-checked `ts.Program` per
 * tsconfig.json in it. Nothing is ever emitted and nothing is written into the
 * tree: every program is created with `noEmit`, and only the compiler's readers
 * are called.
 *
 * Programs share one parsed-source cache, because a monorepo's twenty tsconfigs
 * all reach the same `lib.*.d.ts` and the same dependency declarations, and
 * parsing them twenty times is most of the cost.
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import ts from 'typescript';

import { isTestFileName, judgeFolders, type FolderJudgement } from '../folders.js';
import { isTreeSource } from './util.js';

/**
 * Which directories are not walked is decided once per scan, by `judgeFolders`
 * (`../folders.ts`, over `data/code-folders.json`): a folder is skipped for what it
 * holds, never for its name alone (ACP-476). Everything else is walked, hidden
 * directories included: an application's `.agents/` or `.claude/hooks/` is its own
 * code, and an unread directory is a tool the report silently never names.
 *
 * Test FILES are walked past, counted, and reported: a test calls the application's
 * dispatcher twenty times and defines throwaway tools to exercise it, and neither
 * is what a model is given. Counting them made the first customer's dispatcher
 * read "21 callers" where production has 3. A test FOLDER is the judgement's.
 */
export const TEST_CODE = 'test code (a *.test.* or *.spec.* file)';
export const NESTED_CHECKOUT = 'a nested git worktree or submodule checkout (a directory holding a .git file)';
export const DECLARATION_FILE = 'a generated .d.ts declaration file';
export const BUNDLE_FILE = 'a minified or bundled file (over 1 MB, or named *.min.js)';

const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JS_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const MAX_SOURCE_BYTES = 1024 * 1024;
const OTHER_LANG_EXT = new Map([['.cs', 'C#'], ['.java', 'Java'], ['.go', 'Go'], ['.rs', 'Rust'], ['.kt', 'Kotlin']]);

export interface TreeWalk {
  tsconfigs: string[];
  packageJsons: string[];
  /** Every TypeScript and JavaScript source file the walk admits. */
  sourceFiles: string[];
  jsFiles: number;
  pyFiles: number;
  otherLang: Map<string, number>;
  /** What was not read one file at a time, and the nested checkouts, by reason. The folders skipped for what they hold are `folders`. */
  skipped: Map<string, { dirs: number; files: number }>;
  /** The one judgement of which folders are not read (`../folders.ts`), shared with the Python walker and the skill walk. */
  folders: FolderJudgement;
  /** Every text file (`TEXT_EXT`) under the walked directories, by the same exclusions: the candidates a skill load can name (ACP-460, `loads.ts`). */
  textFiles: string[];
  /** A coding assistant's own configuration in the tree (`isAssistantFile`): hook files and MCP server lists (record §3.20, `sig-hooks.ts`). */
  assistantFiles: string[];
}

/**
 * The files a coding assistant reads its hooks and MCP servers from, in a repository
 * (record §3.20): `.claude/settings.json` and `.claude/settings.local.json` (Claude Code),
 * `.cursor/hooks.json` and `.cursor/mcp.json` (Cursor), `.devin/hooks.json` and
 * `.windsurf/hooks.json` (Devin Desktop, formerly Windsurf), and `.mcp.json`.
 */
export function isAssistantFile(dir: string, name: string): boolean {
  const parent = dir.split(/[\\/]/).pop() ?? '';
  if (name === '.mcp.json') return true;
  if (parent === '.claude') return name === 'settings.json' || name === 'settings.local.json';
  if (parent === '.cursor') return name === 'hooks.json' || name === 'mcp.json';
  return (parent === '.devin' || parent === '.windsurf') && name === 'hooks.json';
}

/** The extensions a skill or instruction file is read from (ACP-460): the contract's list, `CodeCatalog.skill_loads`. */
export const TEXT_EXT: ReadonlySet<string> = new Set(['.md', '.mdx', '.mdc', '.txt', '.prompt']);

function isSource(name: string): boolean {
  const ext = extname(name);
  return TS_EXT.has(ext) || JS_EXT.has(ext);
}

function isDeclaration(name: string): boolean {
  return /\.d\.[mc]?ts$/.test(name) || /\.d\.[^.]+\.ts$/.test(name);
}

function countSources(dir: string, skips: (abs: string) => boolean): number {
  let n = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!skips(join(dir, e.name))) n += countSources(join(dir, e.name), skips);
    } else if (isSource(e.name) && !isDeclaration(e.name)) {
      n += 1;
    }
  }
  return n;
}

export function walkTree(root: string, folders: FolderJudgement = judgeFolders(root)): TreeWalk {
  const w: TreeWalk = { tsconfigs: [], packageJsons: [], sourceFiles: [], jsFiles: 0, pyFiles: 0, otherLang: new Map(), skipped: new Map(), textFiles: [], assistantFiles: [], folders };
  const skip = (reason: string, dirs: number, files: number): void => {
    const s = w.skipped.get(reason) ?? { dirs: 0, files: 0 };
    s.dirs += dirs;
    s.files += files;
    w.skipped.set(reason, s);
  };
  const visit = (dir: string, top: boolean): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // A directory holding a `.git` FILE is a linked worktree or a submodule: a second
    // copy of (some version of) the code, whose tools would be counted twice.
    if (!top && entries.some((e) => e.name === '.git' && e.isFile())) {
      skip(NESTED_CHECKOUT, 1, countSources(dir, folders.skips));
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (folders.skips(full)) continue;
        visit(full, false);
      } else if (e.isFile()) {
        const ext = extname(e.name);
        if (e.name === 'tsconfig.json') w.tsconfigs.push(full);
        else if (e.name === 'package.json') w.packageJsons.push(full);
        else if (isAssistantFile(dir, e.name)) w.assistantFiles.push(full);
        if (TS_EXT.has(ext) || JS_EXT.has(ext)) {
          if (isDeclaration(e.name)) {
            skip(DECLARATION_FILE, 0, 1);
            continue;
          }
          if (isTestFileName(e.name)) {
            skip(TEST_CODE, 0, 1);
            continue;
          }
          let size = 0;
          try {
            size = statSync(full).size;
          } catch {
            continue;
          }
          if (size > MAX_SOURCE_BYTES || /\.min\.[mc]?js$/.test(e.name)) {
            skip(BUNDLE_FILE, 0, 1);
            continue;
          }
          w.sourceFiles.push(full);
          if (JS_EXT.has(ext)) w.jsFiles += 1;
        } else if (ext === '.py') w.pyFiles += 1;
        else if (TEXT_EXT.has(ext)) w.textFiles.push(full);
        else {
          const lang = OTHER_LANG_EXT.get(ext);
          if (lang !== undefined) w.otherLang.set(lang, (w.otherLang.get(lang) ?? 0) + 1);
        }
      }
    }
  };
  visit(root, true);
  w.tsconfigs.sort();
  w.packageJsons.sort();
  w.sourceFiles.sort();
  w.textFiles.sort();
  return w;
}

export interface BuiltProgram {
  tsconfig: string | undefined;
  program: ts.Program;
  checker: ts.TypeChecker;
  /** The tree's own source files in this program (no dependency, no declaration file). */
  files: ts.SourceFile[];
  ms: number;
}

export interface ProgramSet {
  programs: BuiltProgram[];
  errors: string[];
}

function cachingHost(options: ts.CompilerOptions, cache: Map<string, ts.SourceFile>): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
    const version = typeof languageVersionOrOptions === 'object' ? `${languageVersionOrOptions.languageVersion}:${String(languageVersionOrOptions.impliedNodeFormat)}` : String(languageVersionOrOptions);
    const key = `${version}|${fileName}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const sf = original(fileName, languageVersionOrOptions, onError, shouldCreate);
    if (sf !== undefined) cache.set(key, sf);
    return sf;
  };
  host.writeFile = () => {
    // Never write into the customer's tree: noEmit is set, and this makes it structural.
  };
  return host;
}

function safeOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  return { ...options, noEmit: true, incremental: false, composite: false, declaration: false, declarationMap: false, sourceMap: false, emitDeclarationOnly: false, skipLibCheck: true };
}

/**
 * The options of the program that reads every source file no tsconfig.json
 * claims: JavaScript included and never checked (`allowJs`, `checkJs: false`),
 * bundler-style resolution because application code imports without extensions,
 * and no ambient `@types` pulled in, since none of them can define a tool.
 */
export const LOOSE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowJs: true,
  checkJs: false,
  maxNodeModuleJsDepth: 0,
  allowImportingTsExtensions: true,
  strict: false,
  esModuleInterop: true,
  types: [],
};

export function buildPrograms(walk: TreeWalk, log: (line: string) => void): ProgramSet {
  const cache = new Map<string, ts.SourceFile>();
  const programs: BuiltProgram[] = [];
  const errors: string[] = [];
  const admitted = new Set(walk.sourceFiles);
  const make = (tsconfig: string | undefined, rootNames: string[], options: ts.CompilerOptions): void => {
    const t0 = performance.now();
    const opts = safeOptions(options);
    const program = ts.createProgram({ rootNames, options: opts, host: cachingHost(opts, cache) });
    const checker = program.getTypeChecker();
    // A file is read when the walk admits it: a tsconfig's `include` can reach a
    // nested checkout or a build directory the walk skipped on purpose.
    const files = program.getSourceFiles().filter((sf) => isTreeSource(sf.fileName) && admitted.has(ts.sys.resolvePath(sf.fileName)));
    const ms = Math.round(performance.now() - t0);
    programs.push({ tsconfig, program, checker, files, ms });
    log(`code: program ${tsconfig ?? '(files no tsconfig.json claims)'}: ${files.length} source file(s), ${ms} ms`);
  };

  for (const tsconfig of walk.tsconfigs) {
    const read = ts.readConfigFile(tsconfig, (p) => ts.sys.readFile(p));
    if (read.error !== undefined) {
      errors.push(`${tsconfig}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
      continue;
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(tsconfig), undefined, tsconfig);
    const rootNames = parsed.fileNames.filter((f) => isTreeSource(f) && admitted.has(ts.sys.resolvePath(f)));
    if (rootNames.length === 0) continue;
    make(tsconfig, rootNames, parsed.options);
  }

  // Every admitted file no tsconfig program holds: JavaScript, scripts and tests a
  // tsconfig excludes, a package with no tsconfig at all. Read, not reported as unread.
  const held = new Set<string>();
  for (const bp of programs) for (const sf of bp.files) held.add(ts.sys.resolvePath(sf.fileName));
  const loose = walk.sourceFiles.filter((f) => !held.has(ts.sys.resolvePath(f)));
  if (loose.length > 0) make(undefined, loose, LOOSE_OPTIONS);
  return { programs, errors };
}
