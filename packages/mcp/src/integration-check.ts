/**
 * `check_integration` — read a repository and say, per propose call site,
 * whether a verify sits beside it (ACP-390).
 *
 * # The one thing worth checking, and why it needs a tool at all
 *
 * `docs/onboarding/sdk.md` section 4 says it in as many words: **line 5 is the
 * whole product.** Delete the verify call and you have rung 1 wearing rung 2's
 * dependency — you are back to believing the `outcome` field. Nothing warns
 * you, no test fails, and the integration still works. That is precisely the
 * defect class nothing else in this repository can see, because it is in the
 * CUSTOMER's code and it is an absence.
 *
 * So this tool looks for the absence.
 *
 * # It is a text scan, and it says what it cannot see
 *
 * There is no parser here and no type information. It masks comments and string
 * literals, finds `.propose(` call sites, works out the enclosing function by
 * indentation (Python) or by brace balance (TypeScript), and looks for a verify
 * call inside it over the same identifier.
 *
 * Everything that reaches past that is **NOT CHECKED**, never PASS:
 *
 *   * a verify in a helper this handler calls. A wrapper is a perfectly good
 *     integration and this scan cannot follow a call;
 *   * a verify in another file, or in a base class, or behind a decorator;
 *   * a proposal that is not a bare identifier at the call site — an inline
 *     object literal, a function call, a member expression — because then there
 *     is no name to look for in the verify call;
 *   * a file that does not import the SDK at all. Those are skipped outright:
 *     `.propose(` on some other object is somebody else's method, and reporting
 *     it would bury the real findings under a repository's own vocabulary.
 *
 * A NOT CHECKED line never means the same thing as a PASS line, and the report
 * says so at the bottom — `repo-check.ts`'s rule, for the same reason: a check
 * that answers "fine" because it could not look is the worst line in any
 * report.
 *
 * # What it does to the machine
 *
 * It opens files under the path it is given and reads them as text. It writes
 * nothing, runs nothing, and opens no connection. A directory a build put there
 * is skipped by name ({@link SKIPPED}) rather than read, because a vendored
 * copy of somebody else's SDK is not this customer's integration.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative as relativeTo, sep } from 'node:path';

import { PACKAGES } from './generated/started-source.js';
import type { ToolOutcome } from './tools.js';

/** PASS, FAIL or NOT CHECKED, and there is no fourth — `repo-check.ts`'s
 * type, deliberately the same three words, because a developer reading both
 * reports should not have to learn two vocabularies. */
export type SiteStatus = 'PASS' | 'FAIL' | 'NOT CHECKED';

/** One propose call site. */
export interface Site {
  /** Repository-relative, POSIX-spelled, so the report is the same on every
   * machine. */
  readonly file: string;
  /** 1-based, as an editor counts. */
  readonly line: number;
  readonly status: SiteStatus;
  /** What the scan saw. */
  readonly detail: string;
  /** The single next action. A finding without one is a finding that gets
   * ignored. */
  readonly fix: string;
}

/** Directory names never descended into. Named, not derived from a
 * `.gitignore`: reading one would make this tool a second implementation of
 * git's matching rules, which `repo-check.ts` already refused to be once. */
export const SKIPPED: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.next',
  'coverage',
];

/** Files larger than this are reported as unread rather than scanned. A
 * generated bundle is not an integration and holding one in memory to find out
 * is a cost for nothing. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** At most this many files are opened. A path naming a whole home directory
 * must stop, and it must stop SAYING it stopped — a silent truncation would be
 * a report about part of a tree presented as a report about the tree. */
export const MAX_FILES = 5000;

type Language = 'python' | 'typescript';

const EXTENSIONS: Readonly<Record<string, Language>> = {
  '.py': 'python',
  '.pyi': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
};

function languageOf(name: string): Language | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const found = EXTENSIONS[name.slice(dot)];
  return found ?? null;
}

// ------------------------------------------------------------------- masking

/**
 * Blank out comments and string bodies, KEEPING LENGTH AND NEWLINES.
 *
 * Length-preserving on purpose: every offset this module computes afterwards —
 * the line a call site is on, the brace that opens its function — is an offset
 * into the original file, and a mask that shortened the text would report a
 * line number off by however much it removed. The alternative, scanning the raw
 * source, counts a `{` inside a template literal and a `.propose(` inside a
 * comment, and both have been seen in real code.
 */
export function maskTypescript(source: string): string {
  const out = source.split('');
  const blank = (at: number): void => {
    if (out[at] !== '\n') out[at] = ' ';
  };
  // Template literals nest: `${ `inner` }` is legal. The stack holds one entry
  // per template we are inside, so the closing brace of an interpolation
  // returns to the template rather than to code.
  const templates: number[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '/' && next === '*') {
      blank(i++);
      blank(i++);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) blank(i++);
      if (i < source.length) {
        blank(i++);
        blank(i++);
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      blank(i++);
      while (i < source.length && source[i] !== quote && source[i] !== '\n') {
        if (source[i] === '\\') blank(i++);
        if (i < source.length) blank(i++);
      }
      if (i < source.length && source[i] === quote) blank(i++);
      continue;
    }
    if (c === '`') {
      blank(i++);
      templates.push(0);
      while (i < source.length && templates.length > 0) {
        if (source[i] === '\\') {
          blank(i++);
          if (i < source.length) blank(i++);
          continue;
        }
        if (source[i] === '`') {
          blank(i++);
          templates.pop();
          continue;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          // Back to code until the matching brace: an interpolation holds
          // expressions, and blanking them would hide a `.propose(` that is
          // genuinely there.
          blank(i++);
          i += 1;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            i += 1;
          }
          continue;
        }
        blank(i++);
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** The same for Python: `#` comments and every string literal, triple-quoted
 * ones included, blanked in place. */
export function maskPython(source: string): string {
  const out = source.split('');
  const blank = (at: number): void => {
    if (out[at] !== '\n') out[at] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') blank(i++);
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = source.slice(i, i + 3);
      const delimiter = triple === c.repeat(3) ? triple : c;
      for (let k = 0; k < delimiter.length; k += 1) blank(i++);
      while (i < source.length && source.slice(i, i + delimiter.length) !== delimiter) {
        if (source[i] === '\\') blank(i++);
        if (i < source.length) blank(i++);
      }
      for (let k = 0; k < delimiter.length && i < source.length; k += 1) blank(i++);
      continue;
    }
    i += 1;
  }
  return out.join('');
}

// --------------------------------------------------------------- the matchers

/**
 * Does this file have anything to do with ZIFFER?
 *
 * The distribution NAMES come from the manifests that publish them
 * (`scripts/embed-guide.mjs`), never from a literal here — a name typed into
 * this module would keep the old spelling through a rename, which is the whole
 * shape `tools/check-org-name.py` exists for one organisation up.
 *
 * Python is asked of the MASK, because an `import ziffer` is code. TypeScript
 * is asked of the ORIGINAL, because the module specifier is a string literal
 * and the mask blanked it — that is the one question in this module put to the
 * raw text, and it is a question about a literal rather than about structure.
 */
function importsSdk(source: string, masked: string, language: Language): boolean {
  if (language === 'python') {
    const name = PACKAGES.python;
    return new RegExp(`(^|\\n)\\s*(import\\s+${name}\\b|from\\s+${name}[\\w.]*\\s+import\\b)`).test(masked);
  }
  return source.includes(PACKAGES.client) || source.includes(PACKAGES.verify);
}

/** Balanced-paren argument text starting at the `(` that follows `at`. `null`
 * when the parentheses do not close in this file. */
function argumentsAfter(masked: string, at: number): string | null {
  const open = masked.indexOf('(', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) return masked.slice(open + 1, i);
    }
  }
  return null;
}

/** The first argument, trimmed. */
function firstArgument(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) return args.slice(0, i).trim();
  }
  return args.trim();
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** The character offset at which each line starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

// --------------------------------------------------------------- the handlers

/** The block a Python call site sits in: the nearest enclosing `def`, and where
 * its body ends by indentation. `null` when the call is not inside one — a
 * module-level propose, which is a real shape and is reported as such rather
 * than guessed at. */
function pythonHandler(masked: string, offset: number): { name: string; from: number; to: number } | null {
  const starts = lineStarts(masked);
  const lines = masked.split('\n');
  const at = lineOf(masked, offset) - 1;
  const indentOf = (index: number): number => {
    const line = lines[index] ?? '';
    return line.length - line.trimStart().length;
  };
  const callIndent = indentOf(at);
  for (let i = at; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    const found = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (found === null) continue;
    // Both groups are mandatory in the pattern, so a match has them. Read
    // through `??` rather than `!`: the non-null assertion is forbidden here
    // (`.claude/rules/typescript.md`) and the honest reason is that a regex
    // edit could make a group optional without this line changing.
    const indent = found[1] ?? '';
    const name = found[2] ?? '(anonymous)';
    const defIndent = indent.length;
    if (defIndent >= callIndent && i !== at) continue;
    let end = lines.length;
    for (let k = i + 1; k < lines.length; k += 1) {
      const body = lines[k] ?? '';
      if (body.trim() === '') continue;
      if (indentOf(k) <= defIndent) {
        end = k;
        break;
      }
    }
    const from = starts[i] ?? 0;
    const to = starts[end] ?? masked.length;
    return { name, from, to };
  }
  return null;
}

/**
 * The name of the function whose body opens at `open`, or `null` when that
 * brace opens something else.
 *
 * Walked BACKWARD with the parentheses balanced, rather than matched against
 * the line the brace sits on. The line version was written first and it was
 * wrong in the most ordinary way there is: a signature broken across lines
 * leaves `): Promise<void> {` as the "header", which matches nothing, so every
 * handler with more than two parameters was reported NOT CHECKED. It was found
 * by pointing the finished tool at this package's own `tools.ts`, which is why
 * `server.test.ts` points it at a real tree rather than only at fixtures.
 *
 * `(anonymous)` is a real answer: `(a, b) => { ... }` is a function and its
 * body is a body, whether or not anybody named it.
 */
function headerName(masked: string, open: number): string | null {
  const isSpace = (at: number): boolean => /\s/.test(masked[at] ?? '');
  const skipBack = (at: number): number => {
    let i = at;
    while (i >= 0 && isSpace(i)) i -= 1;
    return i;
  };
  // Neither a statement keyword's block nor a bare one is a function body, and
  // widening past them is how the search reaches the function that holds them.
  const NOT_A_FUNCTION = ['if', 'for', 'while', 'switch', 'catch', 'do', 'try', 'else', 'finally', 'return'];

  let i = skipBack(open - 1);
  if (i < 0) return null;

  if (masked[i] === '>' && masked[i - 1] === '=') {
    i = skipBack(i - 2);
    if (i >= 0 && /[\w$]/.test(masked[i] ?? '')) {
      // `param => { ... }`, one parameter and no parentheses.
      return '(anonymous)';
    }
  } else if (masked[i] !== ')') {
    // A return-type annotation sits between the parameter list and the brace.
    // Only the characters a type can hold are walked over, and the `:` that
    // introduced it must be there — otherwise this is `try {`, `else {` or a
    // bare block, and the caller widens.
    while (i >= 0 && /[\w$.<>[\]|&,\s]/.test(masked[i] ?? '')) i -= 1;
    if (i < 0 || masked[i] !== ':') return null;
    i = skipBack(i - 1);
  }
  if (i < 0 || masked[i] !== ')') return null;

  let depth = 0;
  let paren = -1;
  for (let k = i; k >= 0; k -= 1) {
    if (masked[k] === ')') depth += 1;
    else if (masked[k] === '(') {
      depth -= 1;
      if (depth === 0) {
        paren = k;
        break;
      }
    }
  }
  if (paren === -1) return null;

  let k = skipBack(paren - 1);
  const wordEnd = k + 1;
  while (k >= 0 && /[\w$]/.test(masked[k] ?? '')) k -= 1;
  const word = masked.slice(k + 1, wordEnd);
  if (word !== '') {
    if (NOT_A_FUNCTION.includes(word)) return null;
    if (word === 'function') return '(anonymous)';
    return word;
  }
  // `(a, b) => {}` or `function (a) {}`: look back for the binding it is
  // being given a name by, and settle for anonymous when there is none.
  const before = masked.slice(Math.max(0, k - 160), k + 1);
  const bound =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\s*\*?\s*)?$/.exec(before) ??
    /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\s*\*?\s*)?$/.exec(before);
  return bound === null ? '(anonymous)' : bound[1] ?? '(anonymous)';
}

/** The innermost brace block a TypeScript call site sits in, widened outward
 * until the block is a function body. `null` when no enclosing block is one —
 * which is reported, never assumed away. */
function typescriptHandler(masked: string, offset: number): { name: string; from: number; to: number } | null {
  let search = offset;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let depth = 0;
    let open = -1;
    for (let i = search - 1; i >= 0; i -= 1) {
      if (masked[i] === '}') depth += 1;
      else if (masked[i] === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth -= 1;
      }
    }
    if (open === -1) return null;
    let close = masked.length;
    let inner = 0;
    for (let i = open; i < masked.length; i += 1) {
      if (masked[i] === '{') inner += 1;
      else if (masked[i] === '}') {
        inner -= 1;
        if (inner === 0) {
          close = i + 1;
          break;
        }
      }
    }
    const name = headerName(masked, open);
    if (name !== null) return { name, from: open, to: close };
    search = open;
  }
  return null;
}

// ------------------------------------------------------------------ the scan

/** One file's call sites, and whether it was scanned at all. */
interface FileScan {
  readonly sites: readonly Site[];
  readonly scanned: boolean;
}

function scanSource(file: string, source: string, language: Language): FileScan {
  const masked = language === 'python' ? maskPython(source) : maskTypescript(source);
  if (!importsSdk(source, masked, language)) return { sites: [], scanned: false };

  const verifyCall = language === 'python' ? /\bverify\s*\(/g : /\bverifyReceipt\s*\(/g;
  const verifyName = language === 'python' ? 'verify()' : 'verifyReceipt()';
  const sites: Site[] = [];
  const propose = /\.propose\s*\(/g;
  let found: RegExpExecArray | null;
  while ((found = propose.exec(masked)) !== null) {
    const offset = found.index;
    const line = lineOf(masked, offset);
    const args = argumentsAfter(masked, offset);
    const proposalName = args === null ? '' : firstArgument(args);
    const handler = language === 'python' ? pythonHandler(masked, offset) : typescriptHandler(masked, offset);

    if (handler === null) {
      sites.push({
        file,
        line,
        status: 'NOT CHECKED',
        detail:
          'this propose call is not inside a function this scan can delimit, so there is no body to look in.',
        fix: `Read the call yourself and confirm a ${verifyName} runs over the same proposal before the action does.`,
      });
      continue;
    }

    const body = masked.slice(handler.from, handler.to);
    verifyCall.lastIndex = 0;
    const verifies: string[] = [];
    let seen: RegExpExecArray | null;
    while ((seen = verifyCall.exec(body)) !== null) {
      const inner = argumentsAfter(body, seen.index);
      if (inner !== null) verifies.push(inner);
    }

    if (verifies.length === 0) {
      sites.push({
        file,
        line,
        status: 'FAIL',
        detail: `${handler.name}() proposes and never verifies: no ${verifyName} anywhere in this function.`,
        fix:
          `Add ${verifyName} over the receipt and the proposal bytes, and act only if it returns. ` +
          'If the verify is in a helper this function calls, this scan cannot follow the call and ' +
          'this line is what that looks like from here — check it and move on.',
      });
      continue;
    }

    if (!IDENTIFIER.test(proposalName)) {
      sites.push({
        file,
        line,
        status: 'NOT CHECKED',
        detail:
          `${handler.name}() does call ${verifyName}, but this propose was handed ` +
          `${proposalName === '' ? 'nothing this scan could read' : `\`${proposalName.replace(/\s+/g, ' ').slice(0, 40)}\``} ` +
          'rather than a named variable, so there is no name to look for in the verify call.',
        fix: 'Bind the proposal to a variable and pass that same variable to verify, so the two are visibly the same object.',
      });
      continue;
    }

    const name = new RegExp(`\\b${proposalName}\\b`);
    if (verifies.some((inner) => name.test(inner))) {
      sites.push({
        file,
        line,
        status: 'PASS',
        detail: `${handler.name}() verifies: ${verifyName} in the same function names \`${proposalName}\`.`,
        fix: 'Nothing. Confirm by hand that the verify runs BEFORE the action and that a refusal stops it.',
      });
      continue;
    }

    sites.push({
      file,
      line,
      status: 'NOT CHECKED',
      detail:
        `${handler.name}() calls ${verifyName}, but over something other than \`${proposalName}\`. ` +
        'A wrapper, a re-encoding or a different proposal all look like this from a text scan.',
      fix: `Confirm the bytes handed to ${verifyName} are the bytes this proposal was built from. The hash is recomputed from them, so a different object is a 9.3-3 refusal.`,
    });
  }
  return { sites, scanned: true };
}

/** What one walk of a tree found. Exported because `formatSites` takes it. */
export interface Walked {
  readonly sites: readonly Site[];
  readonly read: number;
  readonly withSdk: number;
  readonly unread: readonly string[];
  readonly truncated: boolean;
}

async function walk(root: string): Promise<Walked> {
  const sites: Site[] = [];
  const unread: string[] = [];
  let read = 0;
  let withSdk = 0;
  let truncated = false;
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (dir === undefined) break;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      unread.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.includes(entry.name)) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const language = languageOf(entry.name);
      if (language === null) continue;
      if (read >= MAX_FILES) {
        truncated = true;
        continue;
      }
      const shown = relativeTo(root, full).split(sep).join('/');
      let info;
      try {
        info = await stat(full);
      } catch (error) {
        unread.push(`${shown}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (info.size > MAX_FILE_BYTES) {
        unread.push(`${shown}: ${info.size} bytes, over the ${MAX_FILE_BYTES}-byte cap`);
        continue;
      }
      let source: string;
      try {
        source = await readFile(full, 'utf8');
      } catch (error) {
        unread.push(`${shown}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      read += 1;
      const scan = scanSource(shown, source, language);
      if (scan.scanned) withSdk += 1;
      sites.push(...scan.sites);
    }
  }
  sites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { sites, read, withSdk, unread, truncated };
}

/** The report, as an agent reads it. Exported so the tests assert the text a
 * caller gets rather than a structure only the tests see. */
export function formatSites(root: string, walked: Walked): string {
  const lines: string[] = [`check_integration ${root}`, ''];
  const count = (status: SiteStatus): number => walked.sites.filter((s) => s.status === status).length;

  if (walked.sites.length === 0) {
    lines.push(
      walked.withSdk === 0
        ? `No file under this path imports ${PACKAGES.python} or ${PACKAGES.client}, so there is no ZIFFER integration here to check.`
        : `${walked.withSdk} file(s) import the SDK and none of them calls propose, so there is no call site to check.`,
      '',
      'This is NOT a pass. It is this tool having found nothing to look at — point it at the',
      'directory holding the handlers that run your agent\'s tool calls.',
    );
  } else {
    for (const site of walked.sites) {
      lines.push(`${site.status.padEnd(11)} ${site.file}:${site.line}`, `    ${site.detail}`, `    fix: ${site.fix}`, '');
    }
    lines.push(`${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('NOT CHECKED')} NOT CHECKED.`);
  }

  lines.push(
    '',
    `${walked.read} source file(s) read, ${walked.withSdk} of them importing the SDK.`,
  );
  if (walked.truncated) {
    lines.push(
      `Stopped at ${MAX_FILES} files: this report is about part of the tree. Point the tool at a`,
      'narrower path and run it again.',
    );
  }
  for (const problem of walked.unread) lines.push(`not read: ${problem}`);
  lines.push(
    '',
    'What this scan cannot see, and therefore never reports as PASS:',
    '  * a verify inside a helper the handler calls. A wrapper is a good integration and a text',
    '    scan cannot follow a call;',
    '  * a verify in another file, a base class, or behind a decorator;',
    '  * whether the verify runs BEFORE the action, or whether a refusal actually stops it. Both',
    '    are the two lines that matter and neither is visible from here;',
    '  * a file that imports no ZIFFER package. Those are skipped, because `.propose(` on some',
    '    other object is somebody else\'s method.',
    'NOT CHECKED means it could not look. It never means the same thing as PASS.',
  );
  return lines.join('\n');
}

/**
 * `check_integration`, as `server.ts` calls it.
 *
 * The only refusal is a path that is not a readable directory, because that is
 * the only case in which nothing was checked. A FAIL is the tool having looked
 * and found something — `repo-check.ts`'s rule, and `tools.ts`'s reasoning
 * about a DENY one step further out: an agent taught that "the check found
 * something" is a malfunction will route around the check.
 */
export async function checkIntegrationTool(root: string): Promise<ToolOutcome> {
  const path = root.trim();
  if (path === '') {
    return {
      text: 'RepoPathUnnamed: pass the path to the repository holding your agent\'s tool handlers; this tool reads it where it is.',
      isError: true,
    };
  }
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return { text: `RepoPathNotADirectory: ${path} is not a directory.`, isError: true };
    }
  } catch (error) {
    return {
      text: `RepoPathUnreadable: ${path}: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
  return { text: formatSites(path, await walk(path)), isError: false };
}
