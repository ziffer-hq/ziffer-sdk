/**
 * The third signal (ACP-460): the application's own TypeScript or JavaScript LOADS a skill or an
 * instruction file. One `SkillLoad` per (file loaded, place that loads it), read from source text;
 * nothing is run. ONE RULE GOVERNS ALL OF IT: a guess may only ADD an entry to the inventory.
 * Nothing here relaxes a grade or a policy, and a load not seen removes nothing.
 *
 * Three ways a file is loaded:
 *  - `read`: a call of `text_read_calls` (data/code-sdks.json) whose path argument resolves, from
 *    literals, `path.join`/`path.resolve`, `new URL(..., import.meta.url)`, `__dirname` and
 *    `import.meta.dirname`, to a text file under the root -- or to a folder or a one-name pattern
 *    (`skills/${name}/SKILL.md`, a `readdir` loop variable, a glob), one entry per matching file;
 *  - `imported`: `import x from './a.md?raw'`, `import x from './a.md'` (any import attributes),
 *    `require('./a.md')`, `import('./a.md')`;
 *  - `embedded`: a string or template literal of at least 200 characters that holds a SKILL-SHAPED
 *    text file's body (front matter excluded, whitespace runs collapsed to one space on both sides): two
 *    of the body's three 200-character windows (its start, its middle, its end), or the whole body
 *    when it is shorter than 200 (and at least 40, so trivia never matches). This is the generated
 *    registry case: a build script copies SKILL.md bodies into a `.ts` file the application imports.
 *
 * Where the loaded text GOES (`reaches`) is followed backwards from two kinds of sink, with the
 * depth limit `reach.ts` uses (`REACH_DEPTH` application functions entered):
 *  - `instructions`: an argument property of `instruction_params` on a model call the front end
 *    already recognises (an exposure), or the `content` of a message literal whose `role` is
 *    `system` or `developer` in that call's `messages`;
 *  - `tool_result`: the value a tool's run function returns.
 * From a sink the value is followed through variables, assignments, `push`, returns of the
 * application's own functions (with their arguments bound), callers of a function whose
 * parameter carries it, array callbacks (`map`, `find`, ...), string methods, object and array
 * literals and their properties. A library call's result is read as carrying its arguments and
 * receiver: an over-reading on purpose, since `reaches` can only add. NOT followed: a call
 * through a function-typed value or an interface (a handler taken from a map), a class field, a
 * value stored outside a variable of the application (a database, a cache, a module-level `let`
 * assigned from another file), and anything deeper than `REACH_DEPTH`. Absent `reaches` means
 * "not followed", never "goes nowhere".
 */

import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, join, posix, relative, sep } from 'node:path';
import ts from 'typescript';

import { hasSkillShape, isInstructionFile, SKILL_FILE } from '../../skills/index.js';
import type { SkillLoad } from '../../types.js';
import { CODE_SDKS_FILE } from '../sdks.js';
import type { CodeTool, Exposure } from '../types.js';
import type { BuiltProgram } from './program.js';
import { REACH_DEPTH } from './reach.js';
import { calleeName, calleeSymbol, dottedName, firstDecl, functionName, isTreeSource, propValue, propertyNameText, refKey, refOf, resolveAlias, stringValue, unwrap } from './util.js';

// ---------------------------------------------------------------- data

/** The three lists `loads.ts` reads from data/code-sdks.json. */
export interface LoadNames {
  readCalls: string[];
  globCalls: string[];
  instructionParams: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || !v.every((x): x is string => typeof x === 'string' && x !== '')) {
    throw new Error(`data/code-sdks.json: \`${key}\` is not a non-empty list of names`);
  }
  return v;
}

export function parseLoadNames(text: string): LoadNames {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error('data/code-sdks.json: not an object');
  return {
    readCalls: stringList(raw['text_read_calls'], 'text_read_calls'),
    globCalls: stringList(raw['text_glob_calls'], 'text_glob_calls'),
    instructionParams: stringList(raw['instruction_params'], 'instruction_params'),
  };
}

let cachedNames: LoadNames | undefined;
export function loadNames(): LoadNames {
  if (cachedNames === undefined) cachedNames = parseLoadNames(readFileSync(CODE_SDKS_FILE, 'utf8'));
  return cachedNames;
}

// ---------------------------------------------------------------- text files

const MAX_TEXT_BYTES = 1024 * 1024;
/** The embedded window: this many characters of a normalised body, and literals at least this long are indexed. */
export const EMBED_WINDOW = 200;
/** A body shorter than the window is matched whole, and only when it is at least this long. */
export const EMBED_MIN_BODY = 40;

interface TextFile {
  abs: string;
  rel: string;
  /** A skill by name or shape: emitted whether or not `reaches` was followed. */
  skillShaped: boolean;
  /** The body (front matter excluded), whitespace runs collapsed to one space, trimmed; empty unless the file is skill-shaped (only those can be embedded). */
  norm: string;
}

/** Front matter keys, when the text opens with a `---` block; and where the body starts. */
function splitFrontMatter(text: string): { keys: Set<string>; body: string } {
  const keys = new Set<string>();
  const lines = text.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return { keys, body: text };
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').replace(/\r$/, '');
    if (line.trim() === '---') return { keys, body: lines.slice(i + 1).join('\n') };
    const kv = /^([A-Za-z][\w-]*)\s*:/.exec(line);
    if (kv !== null) keys.add(kv[1] ?? '');
  }
  return { keys: new Set(), body: text };
}

/**
 * Whether a text file is a skill by name or by shape (`SkillRead.found_by` 'name' | 'shape'): a
 * `SKILL.md`, an instruction file loaded by name, or front matter filling both `name` and
 * `description` outside a documentation or content folder. The rule is src/skills/index.ts's,
 * imported, so the walk and this pass cannot disagree on what a skill is.
 */
function skillShaped(rel: string, text: string): boolean {
  const parts = rel.split('/');
  const file = parts.pop() ?? '';
  return file === SKILL_FILE || isInstructionFile(parts, file) || hasSkillShape(parts, file, text);
}

export function normaliseText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const HEAD_BYTES = 8192;

/**
 * Every candidate text file, by its head: a file's shape is decided from its name and its front
 * matter, which sits at the top, and only a skill-shaped file is read whole (its body is what an
 * embedding is matched against). Most text files in an application are documentation, and reading
 * them whole was most of this pass's cost on the first customer's tree.
 */
function readTextFiles(root: string, files: readonly string[]): TextFile[] {
  const out: TextFile[] = [];
  const buf = Buffer.alloc(HEAD_BYTES);
  for (const abs of files) {
    let head: string;
    let size: number;
    try {
      const fd = openSync(abs, 'r');
      try {
        size = fstatSync(fd).size;
        head = buf.toString('utf8', 0, readSync(fd, buf, 0, HEAD_BYTES, 0));
      } finally {
        closeSync(fd);
      }
    } catch {
      continue;
    }
    const rel = relative(root, abs).split(sep).join('/');
    let fm = splitFrontMatter(head);
    let text = size <= HEAD_BYTES ? head : undefined;
    // Front matter longer than the head: read on, within the size bound.
    if (text === undefined && fm.keys.size === 0 && head.startsWith('---') && size <= MAX_TEXT_BYTES) {
      text = readFileSync(abs, 'utf8');
      fm = splitFrontMatter(text);
    }
    const shaped = skillShaped(rel, text ?? head);
    if (shaped && text === undefined && size <= MAX_TEXT_BYTES) {
      text = readFileSync(abs, 'utf8');
      fm = splitFrontMatter(text);
    }
    // Only a skill-shaped file can be EMBEDDED (ruling of 2026-09-28, both languages): a plain
    // document sharing 200 characters with a literal may have copied the source as easily as the
    // source copied it (a tutorial quoting an inline prompt). Its body stays empty, so it matches nothing.
    out.push({ abs, rel, skillShaped: shaped, norm: shaped && text !== undefined ? normaliseText(fm.body) : '' });
  }
  return out;
}

// ---------------------------------------------------------------- embedded: a rolling hash over literals

const MOD = 2147483647;
const BASE = 257;

function hashOf(s: string, from: number, len: number): number {
  let h = 0;
  for (let i = from; i < from + len; i += 1) h = (h * BASE + s.charCodeAt(i)) % MOD;
  return h;
}

function powMod(len: number): number {
  let p = 1;
  for (let i = 1; i < len; i += 1) p = (p * BASE) % MOD;
  return p;
}

interface EmbedKey {
  file: number;
  /** Which of the file's windows this is (start, middle, end), counted per literal. */
  window: number;
  /** The text a literal must contain at the hashed position. */
  key: string;
}

/**
 * The index of every text file's body windows: 200 characters at the body's start, middle and end
 * when the body is at least 200 long; the body's first 40 characters (verified against the whole
 * body) when it is 40 to 199 long. Two rolling passes over a literal find every file whose windows
 * it contains: linear in the literal's length. A long body is held by a literal when at least TWO
 * of its distinct windows are in it (all of them when it has one): one window alone is what two
 * skills sharing a closing paragraph have in common, and a generator that trims a heading still
 * leaves two.
 */
export class EmbedIndex {
  private readonly long = new Map<number, EmbedKey[]>();
  private readonly short = new Map<number, EmbedKey[]>();
  private readonly needed: number[] = [];
  private readonly powLong = powMod(EMBED_WINDOW);
  private readonly powShort = powMod(EMBED_MIN_BODY);

  constructor(bodies: readonly string[]) {
    bodies.forEach((norm, file) => {
      if (norm.length >= EMBED_WINDOW) {
        const keys = new Map<string, number>();
        for (const s of [0, Math.floor((norm.length - EMBED_WINDOW) / 2), norm.length - EMBED_WINDOW]) {
          const key = norm.slice(s, s + EMBED_WINDOW);
          if (!keys.has(key)) keys.set(key, keys.size);
        }
        for (const [key, window] of keys) this.add(this.long, hashOf(key, 0, EMBED_WINDOW), { file, window, key });
        this.needed[file] = Math.min(2, keys.size);
      } else if (norm.length >= EMBED_MIN_BODY) {
        this.add(this.short, hashOf(norm, 0, EMBED_MIN_BODY), { file, window: 0, key: norm });
        this.needed[file] = 1;
      }
    });
  }

  private add(m: Map<number, EmbedKey[]>, h: number, k: EmbedKey): void {
    const list = m.get(h);
    if (list === undefined) m.set(h, [k]);
    else list.push(k);
  }

  get empty(): boolean {
    return this.long.size === 0 && this.short.size === 0;
  }

  /** The files whose body a normalised literal holds. */
  match(lit: string): Set<number> {
    const seen = new Map<number, Set<number>>();
    this.roll(lit, EMBED_WINDOW, this.powLong, this.long, seen);
    this.roll(lit, EMBED_MIN_BODY, this.powShort, this.short, seen);
    const out = new Set<number>();
    for (const [file, windows] of seen) if (windows.size >= (this.needed[file] ?? Number.POSITIVE_INFINITY)) out.add(file);
    return out;
  }

  private roll(lit: string, w: number, pow: number, m: Map<number, EmbedKey[]>, seen: Map<number, Set<number>>): void {
    if (m.size === 0 || lit.length < w) return;
    let h = hashOf(lit, 0, w);
    for (let i = 0; ; i += 1) {
      const hits = m.get(h);
      if (hits !== undefined) {
        for (const k of hits) {
          if (!lit.startsWith(k.key, i)) continue;
          const s = seen.get(k.file);
          if (s === undefined) seen.set(k.file, new Set([k.window]));
          else s.add(k.window);
        }
      }
      if (i + w >= lit.length) break;
      h = (h - ((lit.charCodeAt(i) * pow) % MOD) + MOD) % MOD;
      h = (h * BASE + lit.charCodeAt(i + w)) % MOD;
    }
  }
}

// ---------------------------------------------------------------- read: resolving a path argument

/** One path name the source does not fix (`${name}`, a loop variable): one folder or file name. */
const WILD = '\u0001';
/** `**` in a glob: any number of folders. */
const DEEP = '\u0002';
/** A path that starts from the process's working directory (`process.cwd()`, or relative). */
const CWD = '\u0003';
/** One name listed from a folder (`readdir`): the folder case, where every file in it is read. */
const LISTED = '\u0004';
const MAX_VARIANTS = 8;
const PATH_DEPTH = 6;

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);
}

function cartesian(parts: string[][], join2: (a: string, b: string) => string): string[] {
  let acc = [''];
  for (const p of parts) {
    const next: string[] = [];
    for (const a of acc) for (const b of p) next.push(join2(a, b));
    acc = next.slice(0, MAX_VARIANTS);
  }
  return acc;
}

function globToPattern(g: string): string {
  return g.replace(/\*\*\/?/g, DEEP).replace(/\*/g, WILD);
}

const PATH_MODULES = new Set(['path', 'node:path', 'path/posix', 'node:path/posix', 'pathe', 'upath']);

/** `path.join(...)`, `join(...)` imported from `node:path`, and the like; never an application function of that name. */
function isNodePathCall(checker: ts.TypeChecker, call: ts.CallExpression, name: string): boolean {
  if (calleeName(call.expression) !== name) return false;
  const d = firstDecl(calleeSymbol(checker, call.expression));
  if (d !== undefined) return !isTreeSource(d.getSourceFile().fileName);
  // Unresolved (no type declarations installed): read the import the name comes from.
  const head = ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : call.expression;
  if (!ts.isIdentifier(head)) return false;
  for (const decl of checker.getSymbolAtLocation(head)?.declarations ?? []) {
    let n: ts.Node | undefined = decl;
    while (n !== undefined && !ts.isImportDeclaration(n) && !ts.isSourceFile(n)) n = n.parent;
    if (n !== undefined && ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) return PATH_MODULES.has(n.moduleSpecifier.text);
  }
  return ts.isPropertyAccessExpression(call.expression) && /^(path|posix|nodePath)$/.test(head.text);
}

class PathReader {
  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly names: LoadNames,
  ) {}

  /**
   * The names a list of paths can hold, when the source says where the list comes from: a glob
   * call's pattern, or one name (`WILD`) for a `readdir`; through a `const`, `await` and the array
   * methods that keep elements (`sort`, `filter`, ...). Undefined for any other list: a loop over an
   * unknown list reads no path, so it can never widen a pattern to a whole folder.
   */
  listOf(e: ts.Expression, file: string, depth: number): string[] | undefined {
    let u = unwrap(e);
    while (ts.isAwaitExpression(u)) u = unwrap(u.expression);
    if (depth > PATH_DEPTH) return undefined;
    if (ts.isIdentifier(u)) {
      const d = firstDecl(this.symbolOf(u));
      if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
      return this.listOf(d.initializer, file, depth + 1);
    }
    if (!ts.isCallExpression(u)) return undefined;
    const n = calleeName(u.expression);
    if (n === undefined) return undefined;
    if (ts.isPropertyAccessExpression(u.expression) && ARRAY_KEEP.has(n)) return this.listOf(u.expression.expression, file, depth + 1);
    if (n === 'readdir' || n === 'readdirSync') return [LISTED];
    if (!this.names.globCalls.includes(n)) return undefined;
    const a0 = u.arguments[0];
    if (a0 === undefined) return undefined;
    const pats = this.patterns(a0, file, depth + 1);
    if (pats === undefined) return undefined;
    // `{ cwd }` names the folder the pattern is relative to.
    const opts = u.arguments[1];
    let bases = [CWD];
    const o = opts === undefined ? undefined : unwrap(opts);
    if (o !== undefined && ts.isObjectLiteralExpression(o)) {
      const v = propValue(o.properties.find((p) => !ts.isSpreadAssignment(p) && propertyNameText(p.name) === 'cwd'));
      if (v !== undefined && ts.isExpression(v)) bases = this.patterns(v, file, depth + 1) ?? bases;
    }
    return cartesian([bases, pats.map(globToPattern)], (a, b) => (a === '' ? b : posix.join(a, b)));
  }

  private symbolOf(id: ts.Identifier): ts.Symbol | undefined {
    const s = this.checker.getSymbolAtLocation(id);
    return s === undefined ? undefined : resolveAlias(this.checker, s);
  }

  /** The paths an expression can be, with `WILD` where the source does not fix a name; undefined when nothing is readable. */
  patterns(e: ts.Expression, file: string, depth = 0): string[] | undefined {
    if (depth > PATH_DEPTH) return undefined;
    const u = unwrap(e);
    const dir = posix.dirname(file.split(sep).join('/'));
    if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return [u.text];
    if (ts.isTemplateExpression(u)) {
      const parts: string[][] = [[u.head.text]];
      for (const s of u.templateSpans) {
        const p = this.patterns(s.expression, file, depth + 1);
        if (p === undefined) return undefined;
        parts.push(p, [s.literal.text]);
      }
      return cartesian(parts, (a, b) => a + b);
    }
    if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = this.patterns(u.left, file, depth + 1);
      const r = this.patterns(u.right, file, depth + 1);
      return l === undefined || r === undefined ? undefined : cartesian([l, r], (a, b) => a + b);
    }
    if (ts.isConditionalExpression(u)) {
      const out = [...(this.patterns(u.whenTrue, file, depth + 1) ?? []), ...(this.patterns(u.whenFalse, file, depth + 1) ?? [])];
      return out.length === 0 ? undefined : out.slice(0, MAX_VARIANTS);
    }
    if (ts.isPropertyAccessExpression(u)) {
      if (ts.isMetaProperty(u.expression)) {
        if (u.name.text === 'dirname') return [dir];
        if (u.name.text === 'filename') return [file.split(sep).join('/')];
        if (u.name.text === 'url') return [`file://${file.split(sep).join('/')}`];
        return undefined;
      }
      return [WILD];
    }
    if (ts.isIdentifier(u)) {
      if (u.text === '__dirname' || u.text === '__filename') {
        const d = firstDecl(this.symbolOf(u));
        if (d === undefined || !isTreeSource(d.getSourceFile().fileName)) return [u.text === '__dirname' ? dir : file.split(sep).join('/')];
      }
      const d = firstDecl(this.symbolOf(u));
      if (d === undefined) return undefined;
      if (ts.isVariableDeclaration(d)) {
        const loop = d.parent.parent;
        if (ts.isForOfStatement(loop) && d.parent === loop.initializer) return this.listOf(loop.expression, file, depth + 1);
        if (d.initializer !== undefined && isTreeSource(d.getSourceFile().fileName)) return this.patterns(d.initializer, d.getSourceFile().fileName, depth + 1);
        return undefined;
      }
      if (ts.isParameter(d)) {
        // A callback parameter of an array method is an element of its list; any other parameter is one name.
        const fn = d.parent;
        const call = fn.parent;
        if (isFunctionLike(fn) && call !== undefined && ts.isCallExpression(call) && call.arguments[0] === fn && ts.isPropertyAccessExpression(call.expression) && ARRAY_CALLBACK.has(call.expression.name.text)) {
          return this.listOf(call.expression.expression, file, depth + 1);
        }
        return [WILD];
      }
      return [WILD];
    }
    if (ts.isNewExpression(u) && ts.isIdentifier(u.expression) && u.expression.text === 'URL') {
      const rel = u.arguments?.[0];
      const base = u.arguments?.[1];
      if (rel === undefined) return undefined;
      const relP = this.patterns(rel, file, depth + 1);
      if (relP === undefined) return undefined;
      if (base === undefined) return relP.filter((p) => p.startsWith('file://'));
      const baseP = this.patterns(base, file, depth + 1);
      if (baseP === undefined) return undefined;
      const out: string[] = [];
      for (const b of baseP) if (b.startsWith('file://')) for (const r of relP) out.push(r.startsWith('file://') ? r : `file://${posix.join(posix.dirname(b.slice('file://'.length)), r)}`);
      return out.slice(0, MAX_VARIANTS);
    }
    if (ts.isCallExpression(u)) {
      const args = u.arguments;
      if (isNodePathCall(this.checker, u, 'join') || isNodePathCall(this.checker, u, 'resolve')) {
        const resolve = calleeName(u.expression) === 'resolve';
        const parts: string[][] = [];
        for (const a of args) {
          const p = this.patterns(a, file, depth + 1);
          if (p === undefined) return undefined;
          parts.push(p);
        }
        return cartesian(parts, (a, b) => {
          if (a === '') return b;
          if (resolve && b.startsWith('/')) return b;
          return posix.join(a, b);
        });
      }
      if (isNodePathCall(this.checker, u, 'dirname')) {
        const a0 = args[0];
        const p = a0 === undefined ? undefined : this.patterns(a0, file, depth + 1);
        return p?.map((x) => posix.dirname(x));
      }
      const n = calleeName(u.expression);
      if (n === 'fileURLToPath' && args[0] !== undefined) {
        return this.patterns(args[0], file, depth + 1)?.map((x) => (x.startsWith('file://') ? x.slice('file://'.length) : x));
      }
      if (n === 'cwd' && dottedName(u.expression) === 'process.cwd') return [CWD];
      if ((n === 'toString' || n === 'String') && (ts.isPropertyAccessExpression(u.expression) || args[0] !== undefined)) {
        const inner = ts.isPropertyAccessExpression(u.expression) ? u.expression.expression : args[0];
        return inner === undefined ? undefined : this.patterns(inner, file, depth + 1);
      }
      return undefined;
    }
    return undefined;
  }
}

/** A path pattern as a regular expression over absolute POSIX paths. */
function patternRegex(p: string): RegExp {
  let re = '';
  for (const ch of p) {
    if (ch === WILD || ch === LISTED) re += '[^/]*';
    else if (ch === DEEP) re += '(?:[^/]*/)*';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// ---------------------------------------------------------------- where the text goes

/** A selector: a property name, any element or property, or "the content of a system/developer message". */
type Sel = string;
const ANY = '\u0000*';
const ROLE = '\u0000role';
const INSTRUCTION_ROLES = new Set(['system', 'developer']);
const ARRAY_MAP = new Set(['map', 'flatMap']);
const ARRAY_PICK = new Set(['find', 'findLast', 'at', 'pop', 'shift']);
const ARRAY_KEEP = new Set(['filter', 'slice', 'concat', 'sort', 'reverse', 'toSorted', 'toReversed', 'flat', 'toSpliced']);
const ARRAY_CALLBACK = new Set(['map', 'flatMap', 'forEach', 'filter', 'find', 'findLast', 'findIndex', 'some', 'every', 'reduce', 'sort']);
const STRING_METHODS = new Set(['join', 'trim', 'trimStart', 'trimEnd', 'toString', 'toLowerCase', 'toUpperCase', 'normalize', 'padStart', 'padEnd', 'substring', 'substr', 'split', 'replace', 'replaceAll', 'repeat', 'valueOf', 'concat', 'slice']);
/** A step budget per sink, so a pathological tree costs a bounded time and says less, never more. */
const STEP_BUDGET = 200_000;

type Env = ReadonlyMap<ts.Node, Binding>;
interface Frame {
  env: Env;
  depth: number;
  checker: ts.TypeChecker;
}
type Binding = { kind: 'args'; args: readonly ts.Expression[]; frame: Frame } | { kind: 'elem'; expr: ts.Expression; frame: Frame };

interface CallSite {
  call: ts.CallExpression;
  checker: ts.TypeChecker;
}

function nodeId(n: ts.Node): string {
  return `${n.getSourceFile().fileName}#${n.getStart()}`;
}

function ownReturns(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (isFunctionLike(n) || ts.isClassLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression !== undefined) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

/** The function node a declaration names, when it is one of the application's own. */
function functionOfDecl(d: ts.Declaration | undefined): ts.FunctionLikeDeclaration | undefined {
  if (d === undefined || !isTreeSource(d.getSourceFile().fileName)) return undefined;
  if (isFunctionLike(d)) return d.body === undefined ? undefined : d;
  const init = ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) ? d.initializer : undefined;
  if (init === undefined) return undefined;
  const u = unwrap(init);
  return isFunctionLike(u) ? u : undefined;
}

class Follower {
  private hits = new Set<string>();
  private steps = 0;
  private readonly visiting = new Set<string>();
  private readonly envIds = new WeakMap<Env, number>();
  private nextEnv = 0;
  private readonly writes = new Map<ts.TypeChecker, Map<string, Map<ts.Symbol, { assign: ts.Expression[]; push: ts.Expression[] }>>>();

  constructor(
    private readonly sources: ReadonlySet<string>,
    private readonly importSites: ReadonlySet<string>,
    private readonly callers: ReadonlyMap<string, CallSite[]>,
  ) {}

  /** The load sites (node ids) whose text a sink's value carries. */
  follow(e: ts.Expression, sel: Sel[], checker: ts.TypeChecker): Set<string> {
    this.hits = new Set();
    this.steps = 0;
    this.visiting.clear();
    this.carry(e, sel, { env: new Map(), depth: 0, checker });
    return this.hits;
  }

  private envId(env: Env): number {
    let id = this.envIds.get(env);
    if (id === undefined) {
      id = this.nextEnv;
      this.nextEnv += 1;
      this.envIds.set(env, id);
    }
    return id;
  }

  private carry(e0: ts.Expression, sel: Sel[], f: Frame): void {
    this.steps += 1;
    if (this.steps > STEP_BUDGET) return;
    let e = unwrap(e0);
    while (ts.isAwaitExpression(e)) e = unwrap(e.expression);
    // A call and its receiver start at one position: the kind and the end tell them apart.
    const key = `${nodeId(e)}:${e.end}:${e.kind}|${sel.join('\u0004')}|${this.envId(f.env)}|${f.depth}`;
    if (this.visiting.has(key)) return;
    this.visiting.add(key);
    const id = nodeId(e);
    if (this.sources.has(id)) this.hits.add(id);

    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return;
    if (ts.isTemplateExpression(e)) {
      if (sel.length > 0) return;
      for (const s of e.templateSpans) {
        const lit = nodeId(s.literal);
        if (this.sources.has(lit)) this.hits.add(lit);
        this.carry(s.expression, [], f);
      }
      const head = nodeId(e.head);
      if (this.sources.has(head)) this.hits.add(head);
      return;
    }
    if (ts.isTaggedTemplateExpression(e)) return this.carry(e.template, sel, f);
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken) {
        if (sel.length > 0) return;
        this.carry(e.left, [], f);
        this.carry(e.right, [], f);
      } else if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
        this.carry(e.left, sel, f);
        this.carry(e.right, sel, f);
      } else if (op === ts.SyntaxKind.CommaToken || op === ts.SyntaxKind.EqualsToken) {
        this.carry(e.right, sel, f);
      }
      return;
    }
    if (ts.isConditionalExpression(e)) {
      this.carry(e.whenTrue, sel, f);
      this.carry(e.whenFalse, sel, f);
      return;
    }
    if (ts.isArrayLiteralExpression(e)) return this.arrayLiteral(e, sel, f);
    if (ts.isObjectLiteralExpression(e)) return this.objectLiteral(e, sel, f);
    if (ts.isIdentifier(e)) return this.identifier(e, sel, f);
    if (ts.isPropertyAccessExpression(e)) {
      if (e.expression.kind === ts.SyntaxKind.ThisKeyword || ts.isMetaProperty(e.expression)) return;
      return this.carry(e.expression, [e.name.text, ...sel], f);
    }
    if (ts.isElementAccessExpression(e)) {
      const k = stringValue(e.argumentExpression);
      return this.carry(e.expression, [k ?? ANY, ...sel], f);
    }
    if (ts.isCallExpression(e)) return this.call(e, sel, f);
  }

  private arrayLiteral(e: ts.ArrayLiteralExpression, sel: Sel[], f: Frame): void {
    const head = sel[0];
    if (head !== undefined && head !== ANY && head !== ROLE) return;
    const rest = head === ANY ? sel.slice(1) : sel;
    for (const el of e.elements) {
      if (ts.isSpreadElement(el)) this.carry(el.expression, sel, f);
      else this.carry(el, rest, f);
    }
  }

  private objectLiteral(e: ts.ObjectLiteralExpression, sel: Sel[], f: Frame): void {
    const head = sel[0];
    const rest = sel.slice(1);
    const value = (p: ts.ObjectLiteralElementLike): ts.Expression | undefined => {
      if (ts.isPropertyAssignment(p)) return p.initializer;
      if (ts.isShorthandPropertyAssignment(p)) return p.name;
      return undefined;
    };
    if (head === ROLE) {
      const role = e.properties.find((p) => !ts.isSpreadAssignment(p) && propertyNameText(p.name) === 'role');
      const r = role === undefined ? undefined : value(role);
      const roleText = r === undefined ? undefined : stringValue(r, f.checker);
      if (roleText === undefined || !INSTRUCTION_ROLES.has(roleText)) return;
      for (const p of e.properties) if (!ts.isSpreadAssignment(p) && propertyNameText(p.name) === 'content') {
        const v = value(p);
        if (v !== undefined) this.carry(v, rest, f);
      }
      return;
    }
    for (const p of e.properties) {
      if (ts.isSpreadAssignment(p)) {
        this.carry(p.expression, sel, f);
        continue;
      }
      const v = value(p);
      if (v === undefined) continue;
      if (head === undefined) this.carry(v, [], f);
      else if (head === ANY || propertyNameText(p.name) === head) this.carry(v, rest, f);
    }
  }

  private identifier(e: ts.Identifier, sel: Sel[], f: Frame): void {
    const p = e.parent;
    const raw = ts.isShorthandPropertyAssignment(p) && p.name === e ? f.checker.getShorthandAssignmentValueSymbol(p) : f.checker.getSymbolAtLocation(e);
    if (raw === undefined) return;
    // An import of a text file is its own load site.
    for (const d of raw.declarations ?? []) {
      let n: ts.Node | undefined = d;
      while (n !== undefined && !ts.isImportDeclaration(n) && !ts.isSourceFile(n)) n = n.parent;
      if (n !== undefined && ts.isImportDeclaration(n)) {
        const id = nodeId(n);
        if (this.importSites.has(id)) {
          this.hits.add(id);
          return;
        }
      }
    }
    const sym = resolveAlias(f.checker, raw);
    const d = firstDecl(sym);
    if (d === undefined || !isTreeSource(d.getSourceFile().fileName)) return;
    if (ts.isVariableDeclaration(d)) {
      const loop = d.parent.parent;
      if (ts.isForOfStatement(loop) && loop.initializer === d.parent) this.carry(loop.expression, [ANY, ...sel], f);
      else if (d.initializer !== undefined) this.carry(d.initializer, sel, f);
      const w = this.writesOf(f.checker, d.getSourceFile()).get(sym);
      if (w !== undefined) {
        for (const a of w.assign) this.carry(a, sel, f);
        const head = sel[0];
        if (head === undefined || head === ANY || head === ROLE) for (const a of w.push) this.carry(a, head === ANY ? sel.slice(1) : sel, f);
      }
      return;
    }
    if (ts.isBindingElement(d)) return this.bindingElement(d, sel, f);
    if (ts.isParameter(d)) return this.parameter(d, sel, f);
    if (ts.isPropertyAssignment(d)) return this.carry(d.initializer, sel, f);
  }

  private bindingElement(d: ts.BindingElement, sel: Sel[], f: Frame): void {
    const chain: Sel[] = [];
    let n: ts.Node = d;
    while (ts.isBindingElement(n)) {
      const pattern: ts.Node = n.parent;
      if (ts.isArrayBindingPattern(pattern)) chain.unshift(ANY);
      else {
        const k = propertyNameText(n.propertyName) ?? (ts.isIdentifier(n.name) ? n.name.text : undefined);
        if (k === undefined) return;
        chain.unshift(k);
      }
      n = pattern.parent;
    }
    const full = [...chain, ...sel];
    if (ts.isVariableDeclaration(n)) {
      const loop = n.parent.parent;
      if (ts.isForOfStatement(loop) && loop.initializer === n.parent) this.carry(loop.expression, [ANY, ...full], f);
      else if (n.initializer !== undefined) this.carry(n.initializer, full, f);
    } else if (ts.isParameter(n)) {
      this.parameter(n, full, f);
    }
  }

  private parameter(d: ts.ParameterDeclaration, sel: Sel[], f: Frame): void {
    const fn = d.parent;
    if (!isFunctionLike(fn)) return;
    const index = fn.parameters.indexOf(d);
    const b = f.env.get(fn);
    if (b !== undefined) {
      if (b.kind === 'elem') {
        if (index === 0) this.carry(b.expr, [ANY, ...sel], b.frame);
        return;
      }
      const arg = b.args[index];
      if (arg !== undefined) this.carry(arg, sel, b.frame);
      else if (d.initializer !== undefined) this.carry(d.initializer, sel, f);
      return;
    }
    // A callback of an array method: its first parameter is an element of the receiver.
    const call = fn.parent;
    if (call !== undefined && ts.isCallExpression(call) && call.arguments[0] === fn && ts.isPropertyAccessExpression(call.expression) && ARRAY_CALLBACK.has(call.expression.name.text)) {
      if (index === 0 && call.expression.name.text !== 'reduce') this.carry(call.expression.expression, [ANY, ...sel], f);
      return;
    }
    // Otherwise: every caller of this function in the application, one function further.
    if (f.depth >= REACH_DEPTH) return;
    const name = functionName(fn);
    if (name === undefined) return;
    const fnIds = new Set([nodeId(fn), ...(ts.isVariableDeclaration(fn.parent) || ts.isPropertyAssignment(fn.parent) ? [nodeId(fn.parent)] : [])]);
    for (const site of this.callers.get(name) ?? []) {
      const decl = firstDecl(calleeSymbol(site.checker, site.call.expression));
      if (decl === undefined || !fnIds.has(nodeId(decl))) continue;
      const arg = site.call.arguments[index];
      if (arg === undefined || site.call.arguments.slice(0, index + 1).some(ts.isSpreadElement)) continue;
      this.carry(arg, sel, { env: new Map(), depth: f.depth + 1, checker: site.checker });
    }
  }

  private call(e: ts.CallExpression, sel: Sel[], f: Frame): void {
    const callee = unwrap(e.expression);
    const head = sel[0];
    const whole = head === undefined;
    if (ts.isPropertyAccessExpression(callee)) {
      const m = callee.name.text;
      const recv = callee.expression;
      const obj = dottedName(recv);
      if (obj === 'Promise' && (m === 'all' || m === 'resolve' || m === 'allSettled')) {
        const a0 = e.arguments[0];
        if (a0 !== undefined) this.carry(a0, sel, f);
        return;
      }
      if (obj === 'Object') {
        const a0 = e.arguments[0];
        if (a0 === undefined) return;
        if (m === 'values' || m === 'entries') this.carry(a0, whole ? [] : [ANY, ...sel.slice(1)], f);
        else if (m === 'freeze' || m === 'assign' || m === 'fromEntries') for (const a of e.arguments) this.carry(a, sel, f);
        return;
      }
      if (obj === 'JSON' && m === 'stringify') {
        const a0 = e.arguments[0];
        if (a0 !== undefined && whole) this.carry(a0, [], f);
        return;
      }
      if (ARRAY_MAP.has(m)) {
        const cb = e.arguments[0];
        const fn = cb === undefined ? undefined : unwrap(cb);
        if (fn !== undefined && isFunctionLike(fn) && (whole || head === ANY || head === ROLE)) {
          const env = new Map(f.env);
          env.set(fn, { kind: 'elem', expr: recv, frame: f });
          const inner: Frame = { env, depth: f.depth, checker: f.checker };
          const rest = head === ANY ? sel.slice(1) : sel;
          for (const r of ownReturns(fn)) this.carry(r, rest, inner);
          return;
        }
      }
      if (ARRAY_PICK.has(m)) {
        this.carry(recv, [ANY, ...sel], f);
        return;
      }
      if (ARRAY_KEEP.has(m) && !whole) {
        this.carry(recv, sel, f);
        if (m === 'concat') for (const a of e.arguments) this.carry(a, sel, f);
        return;
      }
      if (STRING_METHODS.has(m) && (whole || head === ANY)) {
        this.carry(recv, [], f);
        if (m === 'replace' || m === 'replaceAll' || m === 'concat') for (const a of e.arguments.slice(m === 'concat' ? 0 : 1)) this.carry(a, [], f);
        return;
      }
    }
    if (ts.isIdentifier(callee) && (callee.text === 'String' || callee.text === 'require')) {
      const a0 = e.arguments[0];
      if (callee.text === 'String' && a0 !== undefined && whole) this.carry(a0, [], f);
      return;
    }
    // The application's own function: its returns, with its parameters bound to these arguments.
    const decl = firstDecl(calleeSymbol(f.checker, callee));
    const fn = functionOfDecl(decl);
    if (fn !== undefined) {
      if (f.depth >= REACH_DEPTH) return;
      const env = new Map(f.env);
      env.set(fn, { kind: 'args', args: e.arguments, frame: f });
      const inner: Frame = { env, depth: f.depth + 1, checker: f.checker };
      for (const r of ownReturns(fn)) this.carry(r, sel, inner);
      return;
    }
    if (decl !== undefined && isTreeSource(decl.getSourceFile().fileName)) return; // the application's, but not a body the reading follows
    // A library call: its result is read as carrying its arguments and its receiver.
    if (!whole) return;
    if (ts.isPropertyAccessExpression(callee)) this.carry(callee.expression, [], f);
    for (const a of e.arguments) if (!isFunctionLike(unwrap(a))) this.carry(a, [], f);
  }

  /** Every `x = ...`, `x += ...` and `x.push(...)` of a variable in one file, by symbol. */
  private writesOf(checker: ts.TypeChecker, sf: ts.SourceFile): Map<ts.Symbol, { assign: ts.Expression[]; push: ts.Expression[] }> {
    let perFile = this.writes.get(checker);
    if (perFile === undefined) {
      perFile = new Map();
      this.writes.set(checker, perFile);
    }
    const hit = perFile.get(sf.fileName);
    if (hit !== undefined) return hit;
    const out = new Map<ts.Symbol, { assign: ts.Expression[]; push: ts.Expression[] }>();
    const slot = (id: ts.Identifier): { assign: ts.Expression[]; push: ts.Expression[] } | undefined => {
      const s = checker.getSymbolAtLocation(id);
      if (s === undefined) return undefined;
      let w = out.get(s);
      if (w === undefined) {
        w = { assign: [], push: [] };
        out.set(s, w);
      }
      return w;
    };
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && ts.isIdentifier(n.left) && (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        slot(n.left)?.assign.push(n.right);
      } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && (n.expression.name.text === 'push' || n.expression.name.text === 'unshift')) {
        const w = slot(n.expression.expression);
        if (w !== undefined) for (const a of n.arguments) w.push.push(ts.isSpreadElement(a) ? a.expression : a);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    perFile.set(sf.fileName, out);
    return out;
  }
}

// ---------------------------------------------------------------- the pass

export interface SkillLoadsInput {
  root: string;
  programs: readonly BuiltProgram[];
  /** Which program reads each tree file (`index.ts`'s map): each file is read once. */
  owner: ReadonlyMap<string, BuiltProgram>;
  textFiles: readonly string[];
  exposures: readonly Exposure[];
  tools: readonly CodeTool[];
  names?: LoadNames;
}

interface Site {
  id: string;
  how: SkillLoad['how'];
  at: { file: string; line: number };
  files: number[];
}

interface Sink {
  kind: 'instructions' | 'tool_result';
  expr: ts.Expression;
  sel: Sel[];
  checker: ts.TypeChecker;
  at: { file: string; line: number };
  via: string;
}

function isReadCall(names: LoadNames, call: ts.CallExpression): ts.Expression | undefined {
  const dn = dottedName(call.expression);
  const last = calleeName(call.expression);
  for (const entry of names.readCalls) {
    const chained = /^(.*)\(\)\.(\w+)$/.exec(entry);
    if (chained !== null) {
      // `Bun.file().text`: `.text()` called on the result of `Bun.file(path)`.
      const inner = ts.isPropertyAccessExpression(call.expression) ? unwrap(call.expression.expression) : undefined;
      if (last === chained[2] && inner !== undefined && ts.isCallExpression(inner) && dottedName(inner.expression) === chained[1]) return inner.arguments[0];
      continue;
    }
    if (!entry.includes('.') ? last === entry : dn !== undefined && (dn === entry || dn.endsWith(`.${entry}`))) return call.arguments[0];
  }
  return undefined;
}

function textSpecifier(spec: string, fromFile: string, byAbs: ReadonlyMap<string, number>): number | undefined {
  const bare = spec.replace(/[?#].*$/, '');
  if (!bare.startsWith('.') && !bare.startsWith('/')) return undefined;
  return byAbs.get(join(dirname(fromFile), bare));
}

function shortCallee(n: ts.CallExpression | ts.NewExpression): string {
  const dn = dottedName(n.expression) ?? calleeName(n.expression) ?? 'call';
  const parts = dn.split('.');
  const s = parts.length > 3 ? parts.slice(-3).join('.') : dn;
  return ts.isNewExpression(n) ? `new ${s}` : s;
}

export function findSkillLoads(input: SkillLoadsInput): SkillLoad[] {
  const { root } = input;
  const names = input.names ?? loadNames();
  const texts = readTextFiles(root, input.textFiles);
  const byAbs = new Map<string, number>();
  texts.forEach((t, i) => byAbs.set(t.abs, i));
  const embed = new EmbedIndex(texts.map((t) => t.norm));
  const textRegexCache = new Map<string, number[]>();
  const matchPattern = (pat: string): number[] => {
    const hit = textRegexCache.get(pat);
    if (hit !== undefined) return hit;
    const re = patternRegex(pat);
    const out: number[] = [];
    texts.forEach((t, i) => {
      if (re.test(t.abs.split(sep).join('/'))) out.push(i);
    });
    // A path that is a folder holding text files reads as the folder's files (the folder case).
    if (out.length === 0 && !pat.includes(WILD) && !pat.includes(LISTED) && !pat.includes(DEEP)) {
      const dirRe = patternRegex(`${pat.replace(/\/$/, '')}/${WILD}`);
      texts.forEach((t, i) => {
        if (dirRe.test(t.abs.split(sep).join('/'))) out.push(i);
      });
    }
    textRegexCache.set(pat, out);
    return out;
  };
  const rootPosix = root.split(sep).join('/');
  const packageDirOf = (file: string): string => {
    let d = dirname(file);
    while (d.length >= root.length) {
      try {
        if (statSync(join(d, 'package.json')).isFile()) return d;
      } catch {
        // not here
      }
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
    return root;
  };

  const exposureKeys = new Set(input.exposures.map((e) => refKey(e.at)));
  const exposureFiles = new Set(input.exposures.map((e) => e.at.file));
  const sites: Site[] = [];
  const sources = new Set<string>();
  const importSites = new Set<string>();
  const callers = new Map<string, CallSite[]>();
  const sinks: Sink[] = [];
  const instructionParams = new Set(names.instructionParams);

  const addSite = (node: ts.Node, how: SkillLoad['how'], files: number[]): void => {
    if (files.length === 0) return;
    const r = refOf(root, node);
    const id = nodeId(node);
    sites.push({ id, how, at: { file: r.file, line: r.line }, files });
    sources.add(id);
    if (how === 'imported' && ts.isImportDeclaration(node)) importSites.add(id);
  };

  const modelCallSinks = (node: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): void => {
    const a0 = node.arguments?.[0];
    if (a0 === undefined) return;
    let obj = unwrap(a0);
    if (ts.isIdentifier(obj)) {
      const d = firstDecl(checker.getSymbolAtLocation(obj));
      if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) obj = unwrap(d.initializer);
    }
    if (!ts.isObjectLiteralExpression(obj)) return;
    const callee = shortCallee(node);
    const read = (o: ts.ObjectLiteralExpression, nested: boolean): void => {
      for (const p of o.properties) {
        if (ts.isSpreadAssignment(p)) continue;
        const k = propertyNameText(p.name);
        const v = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : undefined;
        if (k === undefined || v === undefined) continue;
        const r = refOf(root, p);
        const at = { file: r.file, line: r.line };
        if (instructionParams.has(k)) sinks.push({ kind: 'instructions', expr: v, sel: [], checker, at, via: `${callee}({ ${k} })` });
        else if (!nested && (k === 'messages' || k === 'input' || k === 'contents')) sinks.push({ kind: 'instructions', expr: v, sel: [ROLE], checker, at, via: `${callee}({ ${k}: [{ role: 'system' }] })` });
        else if (!nested && ts.isObjectLiteralExpression(unwrap(v))) {
          const inner = unwrap(v);
          if (ts.isObjectLiteralExpression(inner)) read(inner, true);
        }
      }
    };
    read(obj, false);
  };

  for (const bp of input.programs) {
    const checker = bp.checker;
    const paths = new PathReader(checker, names);
    for (const sf of bp.files) {
      if (input.owner.get(sf.fileName) !== bp) continue;
      const hasExposure = exposureFiles.has(relative(root, sf.fileName).split(sep).join('/'));
      const isExposure = (node: ts.Node): boolean => hasExposure && exposureKeys.has(refKey(refOf(root, node)));
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const i = textSpecifier(node.moduleSpecifier.text, sf.fileName, byAbs);
          if (i !== undefined) addSite(node, 'imported', [i]);
        } else if (ts.isCallExpression(node)) {
          const a0 = node.arguments[0];
          const isRequire = (ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword;
          if (isRequire && a0 !== undefined) {
            const spec = stringValue(a0);
            const i = spec === undefined ? undefined : textSpecifier(spec, sf.fileName, byAbs);
            if (i !== undefined) addSite(node, 'imported', [i]);
          } else {
            const pathArg = isReadCall(names, node);
            if (pathArg !== undefined) {
              const pats = paths.patterns(pathArg, sf.fileName) ?? [];
              const files = new Set<number>();
              for (const spelled of pats) {
                // `fs.readFile(new URL(...))` reads the URL's path.
                const raw = spelled.startsWith('file://') ? spelled.slice('file://'.length) : spelled;
                const bases = raw.startsWith('/') ? [''] : [packageDirOf(sf.fileName).split(sep).join('/'), rootPosix];
                const rel = raw.startsWith(CWD) ? raw.slice(1).replace(/^\//, '') : raw;
                // A path with no fixed start (`${dir}/x.md` from an unread value) is no path.
                if (rel.startsWith(WILD) || rel.startsWith(DEEP) || rel === '') continue;
                for (const b of new Set(bases)) {
                  const abs = b === '' ? posix.normalize(rel) : posix.join(b, rel);
                  // A file name the source does not fix at all (`../${path}`) names no file: only a
                  // name listed from the folder itself (the readdir case) may stand for all of them.
                  if (!abs.startsWith(`${rootPosix}/`) || abs.split('/').pop() === WILD) continue;
                  for (const i of matchPattern(abs)) files.add(i);
                }
              }
              addSite(node, 'read', [...files].sort((a, b) => a - b));
            }
          }
          const n = calleeName(node.expression);
          if (n !== undefined) {
            const list = callers.get(n);
            const site = { call: node, checker };
            if (list === undefined) callers.set(n, [site]);
            else list.push(site);
          }
          if (isExposure(node)) modelCallSinks(node, checker);
        } else if (ts.isNewExpression(node)) {
          if (isExposure(node)) modelCallSinks(node, checker);
        } else if (!embed.empty && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && node.text.length >= EMBED_WINDOW) {
          const norm = normaliseText(node.text);
          if (norm.length >= EMBED_WINDOW) addSite(node, 'embedded', [...embed.match(norm)].sort((a, b) => a - b));
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  // The tools' run functions: what each returns is a tool result.
  for (const t of input.tools) {
    const e = t.execute_at;
    if (e === undefined) continue;
    const abs = join(root, e.file);
    const bp = input.owner.get(abs) ?? input.programs.find((p) => p.program.getSourceFile(abs) !== undefined);
    const sf = bp?.program.getSourceFile(abs);
    if (bp === undefined || sf === undefined) continue;
    const pos = sf.getPositionOfLineAndCharacter(e.line - 1, e.col - 1);
    let found: ts.Node | undefined;
    const visit = (n: ts.Node): void => {
      if (found !== undefined || n.end < pos) return;
      if (n.getStart(sf) === pos) {
        found = n;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (found === undefined) continue;
    let fn: ts.Node | undefined = found;
    if (ts.isPropertyAssignment(found)) fn = unwrap(found.initializer);
    else if (ts.isShorthandPropertyAssignment(found)) fn = found.name;
    if (fn !== undefined && ts.isIdentifier(fn)) {
      const s = bp.checker.getSymbolAtLocation(fn);
      fn = functionOfDecl(firstDecl(s === undefined ? undefined : resolveAlias(bp.checker, s)));
    }
    if (fn === undefined || !isFunctionLike(fn)) continue;
    for (const r of ownReturns(fn)) {
      const at = refOf(root, r.parent !== undefined && ts.isReturnStatement(r.parent) ? r.parent : r);
      sinks.push({ kind: 'tool_result', expr: r, sel: [], checker: bp.checker, at: { file: at.file, line: at.line }, via: `${t.name}: execute() returns it` });
    }
  }

  // Follow each sink; the first one (instructions before tool results, then by place) names `reaches`.
  sinks.sort((a, b) => (a.kind === b.kind ? (a.at.file === b.at.file ? a.at.line - b.at.line : a.at.file.localeCompare(b.at.file)) : a.kind === 'instructions' ? -1 : 1));
  const follower = new Follower(sources, importSites, callers);
  const reaches = new Map<string, NonNullable<SkillLoad['reaches']>>();
  for (const s of sinks) {
    for (const id of follower.follow(s.expr, s.sel, s.checker)) {
      if (!reaches.has(id)) reaches.set(id, { kind: s.kind, at: s.at, via: s.via });
    }
  }

  const out = new Map<string, SkillLoad>();
  for (const site of sites) {
    const r = reaches.get(site.id);
    for (const i of site.files) {
      const t = texts[i];
      if (t === undefined) continue;
      // A read or import of a file with no skill shape is a load only when its text was followed to a model.
      if (site.how !== 'embedded' && !t.skillShaped && r === undefined) continue;
      const load: SkillLoad = { path: t.rel, how: site.how, at: site.at };
      if (r !== undefined) load.reaches = r;
      const k = `${t.rel}\u0000${site.at.file}\u0000${site.at.line}\u0000${site.how}`;
      if (!out.has(k)) out.set(k, load);
    }
  }
  return sortLoads([...out.values()]);
}

/** The contract's order: by `path`, then `at.file`, then `at.line` (then `how`, so the order is total). */
export function sortLoads(loads: SkillLoad[]): SkillLoad[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return loads.sort((a, b) => cmp(a.path, b.path) || cmp(a.at.file, b.at.file) || a.at.line - b.at.line || cmp(a.how, b.how));
}
