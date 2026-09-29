/**
 * The skills and instruction files under the scanned root (2026-09-28, ACP-460): an INVENTORY,
 * read as text, never run.
 *
 * THREE SIGNALS find a file, and `found_by` lists every one that applies, in this order:
 * - `name`: a file called `SKILL.md`, in ANY folder (an application's own skills sit in its source,
 *   `src/agent/skills/order-desk/SKILL.md`, not only under a coding assistant's folder), and the
 *   instruction files an assistant loads by name (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
 *   `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`).
 * - `shape`: a `.md`, `.mdx`, `.mdc`, `.txt` or `.prompt` file whose front matter carries BOTH a
 *   non-empty `name` and a non-empty `description`, whatever it is called. EXCLUDED BY RULE (see
 *   `SHAPE_EXCLUDED_DIRS`): a file under a documentation, blog or content-site folder, where a page's
 *   front matter can carry the same two keys and the file is a page a site renders, not text a
 *   model is given. The exclusion applies to `shape` alone: a `SKILL.md` or a file the code loads
 *   is read wherever it sits.
 * - `code`: the application's code reads, embeds or imports the file (`CodeCatalog.skill_loads`,
 *   attached as `loaded_by`). A loaded file the walk did not find is read too.
 *
 * WHO LOADS IT (`home`): `assistant` when the file sits under a coding assistant's folder
 * (`SKILL_HOMES`, at any depth), under the scanned root's OWN top-level `skills/` folder, or is an
 * instruction file loaded by name; `application` otherwise. The top-level `skills/` rule: in the
 * repositories read, a root `skills/` folder is a collection published for assistants, while an
 * application keeps its skills inside its source (`api/src/.../skills/`, which stays
 * `application`); only the root's own `skills/` counts, never one deeper in the tree. A file the
 * application's code loads is `application` whatever folder holds it, the root `skills/` included.
 *
 * The walk leaves out what the code walk leaves out (`code/ts/program.ts`): dependencies, build
 * output, version control, test code, and a nested git worktree or submodule checkout, so a second
 * copy of the tree is not counted twice. It does not follow a symbolic link, so a skill folder
 * linked into a second assistant's folder is read once, where it really is.
 *
 * For each file: what it DECLARES (front matter `allowed-tools` or `tools`, as written), what it
 * EXERCISES (shell, network, a write outside its folder, a credential read), each with file, line
 * and the text, and instruction-like text by the patterns of `data/poisoned.json`
 * (`instructionHits`, the installed half's matcher). The scripts in a skill's folder are read only
 * for a file named `SKILL.md`: that format gives a skill its own folder, and a skill-shaped file
 * loose in a source folder does not own the source beside it. The words it looks for are
 * `data/keywords.json`'s `skill_exercises`; this file holds the grammar only (where code is in a
 * markdown file, where a shell command starts, what a redirect looks like).
 *
 * A skill that declares no tool list is NOT a finding: a declaration is optional in every format
 * read. The one thing reported as a finding is an instruction hit.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { instructionHits } from '../classify/index.js';
import { parseSkillWords, readDataFile, type SkillWords } from '../classify/data.js';
import { NESTED_CHECKOUT, SKIP_REASONS, TEST_DIRS, TEST_FILE_RE, TEXT_EXT } from '../code/ts/program.js';
import { redactText } from '../redact/index.js';
import type { SkillLoad, SkillRead } from '../types.js';

export type Exercise = SkillRead['exercises'][number];
export type Capability = Exercise['capability'];

/** The instruction files an assistant loads by their name, wherever they sit. */
export const INSTRUCTION_FILES: readonly string[] = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', '.windsurfrules'];
/** Read only at this path (relative to any folder): GitHub Copilot's repository instructions. */
export const COPILOT_FILE = '.github/copilot-instructions.md';
/**
 * The coding assistants' own folders: a skill, rule or instruction file under one of these (at any
 * depth) is read by the developer's assistant, not by the application (`home: 'assistant'`). Each
 * with the source that justifies it; "corpus" is a folder seen in the scan's test corpus
 * (~/ziffer-deploy/corpus, fourteen public repositories) or in the first customer's tree.
 */
export const SKILL_HOMES: readonly string[] = [
  '.claude', //     Claude Code: `.claude/skills/`, `.claude/agents/`, `.claude/commands/` (code.claude.com/docs, Skills and Subagents); corpus
  '.agents', //     the Agent Skills convention, `.agents/skills/` (OpenAI Codex docs, Agent Skills); corpus
  '.cursor', //     Cursor: `.cursor/rules/` (cursor.com/docs, Rules); corpus
  '.gemini', //     Gemini CLI: `.gemini/` settings, commands and extensions (geminicli.com/docs); Gemini Code Assist `.gemini/styleguide.md`; corpus
  '.codebuddy', //  CodeBuddy: `.codebuddy/skills/` (CodeBuddy Code docs, Skills); corpus
  '.windsurf', //   Windsurf: `.windsurf/rules/`, `.windsurf/workflows/` (docs.windsurf.com, Memories and Rules); corpus
  '.github', //     GitHub Copilot: `.github/instructions/`, `.github/prompts/`, `.github/agents/`, `.github/skills/` (docs.github.com, Copilot customization)
  '.codex', //      OpenAI Codex: `.codex/` project configuration (developers.openai.com/codex); corpus
  '.roo', //        Roo Code: `.roo/rules/`, `.roo/rules-{mode}/` (docs.roocode.com, Custom Instructions)
  '.kiro', //       Kiro: `.kiro/steering/`, `.kiro/specs/` (kiro.dev/docs, Steering)
  '.opencode', //   OpenCode: `.opencode/agent/`, `.opencode/command/` (opencode.ai/docs, Agents)
  '.continue', //   Continue: `.continue/rules/`, `.continue/prompts/` (docs.continue.dev, Rules)
  '.clinerules', // Cline: a `.clinerules/` folder of rule files (docs.cline.bot, Cline Rules)
  '.amazonq', //    Amazon Q Developer: `.amazonq/rules/` (AWS docs, Q Developer project rules)
  '.trae', //       Trae: `.trae/rules/` (docs.trae.ai, Rules); corpus `.trae/skills/`
  '.qoder', //      Qoder: `.qoder/rules/` (docs.qoder.com, Rules); corpus `.qoder/skills/`
  '.junie', //      JetBrains Junie: `.junie/guidelines.md` (jetbrains.com/help/junie, Guidelines)
];
/** The file extensions the `shape` signal reads: text a model can be given. The same list the tree walk collects for a load to name (`TEXT_EXT`, one owner). */
export const SHAPE_EXTENSIONS: readonly string[] = [...TEXT_EXT];
/**
 * The folders whose files the `shape` signal leaves out (the header's rule), compared lowercased at
 * any depth: documentation (`docs`, `doc`, `documentation`), a blog (`blog`, `blogs`, `posts`,
 * `_posts`), and a content site's collections (`content`, where Astro, Nuxt Content and Hugo keep
 * pages, and an author or team page's front matter is `name` and `description`).
 *
 * THE EVIDENCE (2026-09-28): without this rule, `shape` alone added 24 files over the first
 * customer's tree and the fourteen repositories of ~/ziffer-deploy/corpus (plus none over six
 * further site and product repositories read to look for a false entry), and every one was a real
 * skill-like file: a Claude Code subagent, nine Claude Managed Agents definitions, thirteen GitHub
 * Agentic Workflows prompts, one `.agents/agents/` subagent. NONE sat in a folder this rule names,
 * so the rule removed nothing that was found; it is kept for the pages the corpus does not hold.
 * THE RESIDUAL: a prompt kept under a folder of one of these names is found only by its name
 * (`SKILL.md`) or by the code that loads it, never by its shape alone.
 */
export const SHAPE_EXCLUDED_DIRS: readonly string[] = ['docs', 'doc', 'documentation', 'blog', 'blogs', 'posts', '_posts', 'content'];
/** The capabilities in the order a report lists them. */
export const CAPABILITIES: readonly Capability[] = ['shell', 'network', 'file_write', 'credentials'];

/** A file larger than this is not read: a skill or an instruction file is prose, and a bigger file is generated. Counted, never silent. */
const MAX_BYTES = 1024 * 1024;
const EVIDENCE_CHARS = 160;

let loaded: SkillWords | undefined;
function skillWords(): SkillWords {
  loaded ??= parseSkillWords(readDataFile('keywords.json'));
  return loaded;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A literal as an expression: a word boundary on a side where it starts or ends with a letter,
 * digit or underscore ('curl' never matches 'curly'). `pathLike` adds the credential paths' left
 * rule: not after a letter, a digit, an underscore or a dot, so `process.env` is not `.env`.
 */
function literal(text: string, pathLike = false): RegExp {
  const left = pathLike ? '(?<![\\w.])' : /^\w/.test(text) ? '\\b' : '';
  const right = /\w$/.test(text) ? '\\b' : '';
  return new RegExp(`${left}${escapeRe(text)}${right}`);
}

/** One line of code the file holds, with where it came from. */
interface CodeLine {
  line: number;
  text: string;
  /** A shell line: a shell fence, a `.sh` script, or an inline code span that starts with a command. */
  shell: boolean;
  /** A line of a script in another language (`.py`, `.js`, ...): its write calls are read. */
  script: boolean;
}

/** The front matter's lines and where the body starts; empty when the file has none. */
function frontMatter(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = text.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return out;
  let key: string | undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').replace(/\r$/, '');
    if (raw.trim() === '---') break;
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (kv !== null) {
      key = kv[1] ?? '';
      const v = (kv[2] ?? '').trim();
      out.set(key, v === '' ? [] : [v]);
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item !== null && key !== undefined) out.get(key)?.push(`- ${(item[1] ?? '').trim()}`);
  }
  return out;
}

const unquote = (s: string): string => s.replace(/^(['"])(.*)\1$/, '$2').trim();

/** Split at `sep` outside parentheses and brackets: `Bash(git add:*), Read` is two tools. */
function splitTop(s: string, isSep: (ch: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && isSep(ch)) {
      if (cur.trim() !== '') out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/**
 * The tool list as written: a YAML list, an inline `[a, b]` list, or one string of names separated
 * by commas (or, with no comma, by spaces outside parentheses). Each item unquoted, nothing else
 * changed. Undefined when the key is absent or empty.
 */
export function declaredTools(fm: Map<string, string[]>): string[] | undefined {
  const raw = fm.get('allowed-tools') ?? fm.get('tools');
  if (raw === undefined || raw.length === 0) return undefined;
  const items: string[] = [];
  for (const v of raw) {
    if (v.startsWith('- ')) {
      items.push(unquote(v.slice(2)));
      continue;
    }
    const inner = /^\[(.*)\]$/.exec(v);
    const s = inner === null ? unquote(v) : (inner[1] ?? '');
    const parts = splitTop(s, (ch) => ch === ',');
    const list = parts.length > 1 || inner !== null ? parts : splitTop(s, (ch) => /\s/.test(ch));
    items.push(...list.map(unquote));
  }
  const out = items.filter((x) => x !== '');
  return out.length === 0 ? undefined : out;
}

/** A shell line's first word is one of these: an inline span that starts with one is a command. */
function startsWithCommand(text: string, w: SkillWords): boolean {
  const first = /^\s*(?:\$\s+)?(\S+)/.exec(text)?.[1] ?? '';
  // A known command word, or a lowercase word followed by a flag (`pnpm -r build`).
  return [...w.network, ...w.write_commands].some((c) => c.split(' ')[0] === first) || (/^[a-z][\w.-]*$/.test(first) && /\s-/.test(text));
}

/**
 * The code a markdown file holds: every line of a fenced block, and every inline code span. A
 * fence whose language is a shell's makes its lines shell lines; an inline span is a shell line
 * when it starts with a command word. Prose is never returned.
 */
function markdownCode(text: string, w: SkillWords): { code: CodeLine[]; shellBlocks: CodeLine[] } {
  const lines = text.split('\n');
  const code: CodeLine[] = [];
  const shellBlocks: CodeLine[] = [];
  let fence: { mark: string; lang: string; first: boolean } | undefined;
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, '');
    const n = i + 1;
    const open = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/.exec(line);
    if (fence === undefined && open !== null) {
      fence = { mark: open[1] ?? '```', lang: (open[2] ?? '').toLowerCase(), first: true };
      continue;
    }
    if (fence !== undefined) {
      if (line.trim().startsWith(fence.mark) && line.trim().replace(/[`~]/g, '') === '') {
        fence = undefined;
        continue;
      }
      const shell = w.shell_fences.includes(fence.lang);
      if (shell && fence.first && line.trim() !== '') {
        shellBlocks.push({ line: n, text: line, shell: true, script: false });
        fence.first = false;
      }
      code.push({ line: n, text: line, shell, script: !shell && fence.lang !== '' });
      continue;
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const span = m[1] ?? '';
      code.push({ line: n, text: span, shell: startsWithCommand(span, w) && !span.includes('<'), script: false });
    }
  }
  return { code, shellBlocks };
}

const clip = (s: string): string => {
  const t = s.trim().replace(/\s+/g, ' ');
  return redactText(t.length > EVIDENCE_CHARS ? `${t.slice(0, EVIDENCE_CHARS - 3)}...` : t);
};

/** Whether a write target stays in the skill's own folder (see the data note). */
function inside(target: string, folder: string | undefined, w: SkillWords): boolean {
  const t = target.replace(/^['"]|['"]$/g, '');
  if (t.startsWith('/dev/') || t.startsWith('&')) return true;
  if (folder !== undefined && folder !== '' && (t === folder || t.startsWith(`${folder}/`) || t.startsWith(`./${folder}/`))) return true;
  return !t.includes('..') && w.inside_markers.some((m) => t.includes(m));
}

/** The write targets a shell line names: redirects, and the last argument of a write command at a command position. */
function shellWrites(text: string, w: SkillWords): string[] {
  const out: string[] = [];
  // A redirect: `>` or `>>` at the start or after a space (never `2>`, `&>`, `->`, `=>`, a `SQL>` prompt or
  // a `<placeholder>`), then a target that names a path (a letter, `.`, `/`, `~` or `$` in it; `>0` is a comparison).
  for (const m of text.matchAll(/(?:^|\s)>>?\s*([^\s&|;<>()]+)/g)) {
    const target = m[1] ?? '';
    if (/[A-Za-z_./~$]/.test(target)) out.push(target);
  }
  // A command position: the line's start (after a `$ ` prompt), or after `&&`, `||`, `;`, `|`, `sudo`.
  for (const segment of text.split(/&&|\|\||;|\|/)) {
    const s = segment.trim().replace(/^\$\s+/, '').replace(/^sudo\s+/, '');
    for (const c of w.write_commands) {
      if (!(s === c || s.startsWith(`${c} `))) continue;
      const args = s.slice(c.length).trim().split(/\s+/).filter((a) => a !== '' && !a.startsWith('-') && !a.startsWith('>'));
      const last = args[args.length - 1];
      if (last !== undefined) out.push(last);
    }
  }
  return out;
}

/** Python's `open(..., 'w')` and its append and exclusive modes: the grammar of a write in that language. */
const PY_OPEN_WRITE = /\bopen\([^)]*['"][wax]b?\+?['"]/;

/** Every exercise one code line shows. */
function lineExercises(c: CodeLine, file: string, folder: string | undefined, w: SkillWords): Exercise[] {
  const out: Exercise[] = [];
  const add = (capability: Capability): void => {
    out.push({ capability, file, line: c.line, evidence: clip(c.text) });
  };
  if (w.network.some((x) => literal(x).test(c.text)) || (c.shell && /^\s*(?:\$\s+)?[A-Za-z][\w.-]*\s.*\bhttps?:\/\//.test(c.text))) add('network');
  const writes = c.shell ? shellWrites(c.text, w).filter((t) => !inside(t, folder, w)) : [];
  const scriptWrite = c.script && (w.write_calls.some((x) => literal(x).test(c.text)) || PY_OPEN_WRITE.test(c.text)) && !inside(c.text, folder, w);
  if (writes.length > 0 || scriptWrite) add('file_write');
  if (credentialRead(c.text, w)) add('credentials');
  return out;
}

/** A credential file named, or a variable whose name has a part equal to or ending with a credential word. */
function credentialRead(text: string, w: SkillWords): boolean {
  for (const p of w.credential_paths) {
    const re = new RegExp(literal(p, true).source, 'g');
    for (const m of text.matchAll(re)) {
      const rest = text.slice(m.index);
      if (!w.not_credential_paths.some((n) => rest.startsWith(n))) return true;
    }
  }
  const names = [
    ...[...text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? ''),
    ...[...text.matchAll(/(?:process\.env\.|process\.env\[\s*['"]|os\.environ\[\s*['"]|os\.environ\.get\(\s*['"]|os\.getenv\(\s*['"]|env\.get\(\s*['"])([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? ''),
  ];
  return names.some((n) =>
    n
      .toUpperCase()
      .split('_')
      .some((part) => w.credential_name_words.some((word) => part === word || part.endsWith(word))),
  );
}

/** A path relative to the root, POSIX separators. */
const posix = (root: string, p: string): string => relative(root, p).split(sep).join('/');

/** Test code, left out as the code walk leaves it out: a test of a skill's script is not what the skill runs. */
const isTestFile = (name: string): boolean => TEST_FILE_RE.test(name) || /^test_.*\.py$|_test\.py$/.test(name);

/** The script files in a skill's folder, walked with the same exclusions. */
function scriptsIn(dir: string, w: SkillWords): string[] {
  const out: string[] = [];
  const visit = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_REASONS.has(e.name) && !TEST_DIRS.has(e.name)) visit(full);
      } else if (e.isFile() && w.script_extensions.includes(extname(e.name)) && !/\.d\.[mc]?ts$/.test(e.name) && !isTestFile(e.name)) out.push(full);
    }
  };
  visit(dir);
  return out.sort();
}

function readText(p: string): string | undefined {
  try {
    if (statSync(p).size > MAX_BYTES) return undefined;
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** Read ONE skill or instruction file, and the scripts in a `SKILL.md`'s folder (`opts.scripts` overrides). */
export function readSkillFile(root: string, abs: string, kind: SkillRead['kind'], opts: { scripts?: boolean } = {}): SkillRead | undefined {
  const w = skillWords();
  const text = readText(abs);
  if (text === undefined) return undefined;
  const path = posix(root, abs);
  const folder = kind === 'skill' ? posix(root, dirname(abs)) : undefined;
  const fm = frontMatter(text);
  const fmName = unquote(fm.get('name')?.[0] ?? '');
  const name = fmName !== '' ? fmName : kind === 'skill' ? basename(dirname(abs)) : basename(abs);
  const { code, shellBlocks } = markdownCode(text, w);
  const exercises: Exercise[] = shellBlocks.map((b) => ({ capability: 'shell', file: path, line: b.line, evidence: clip(b.text) }));
  for (const c of code) exercises.push(...lineExercises(c, path, folder, w));
  if (kind === 'skill' && (opts.scripts ?? basename(abs) === SKILL_FILE)) {
    for (const script of scriptsIn(dirname(abs), w)) {
      const body = readText(script);
      const sp = posix(root, script);
      exercises.push({ capability: 'shell', file: sp, line: 1, evidence: clip(`${basename(script)}: a script in the skill's folder`) });
      if (body === undefined) continue;
      const shell = extname(script) === '.sh';
      for (const [i, line] of body.split('\n').entries()) {
        exercises.push(...lineExercises({ line: i + 1, text: line, shell, script: !shell }, sp, folder, w));
      }
    }
  }
  // One entry per capability and line: two spans on one line are one piece of evidence.
  const seen = new Set<string>();
  const unique = exercises.filter((x) => {
    const k = `${x.capability}\u0000${x.file}\u0000${x.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const declares = declaredTools(fm);
  const out: SkillRead = { path, kind, name: redactText(name), exercises: unique, instruction_hits: instructionHits(text, { file: true }) };
  if (declares !== undefined) out.declares = declares.map((d) => redactText(d));
  return out;
}

/** The file name the Agent Skills format gives a skill. */
export const SKILL_FILE = 'SKILL.md';

/**
 * The front matter keys that carry a value: a non-empty value on the key's line (quotes removed),
 * or indented lines under it (a YAML list, or a `|` / `>` block's continuation). The `shape` test.
 */
export function filledKeys(text: string): Set<string> {
  const out = new Set<string>();
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  if ((lines[0] ?? '').trim() !== '---') return out;
  let key: string | undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').replace(/\r$/, '');
    if (raw.trim() === '---') return out;
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (kv !== null) {
      key = kv[1] ?? '';
      if (unquote((kv[2] ?? '').trim()) !== '') out.add(key);
      continue;
    }
    if (key !== undefined && /^\s+\S/.test(raw)) out.add(key);
  }
  // No closing line: not front matter.
  return new Set<string>();
}

/** Whether a file is an instruction file an assistant loads by its name (`segments`: the folders above it, root first). */
export function isInstructionFile(segments: readonly string[], file: string): boolean {
  return INSTRUCTION_FILES.includes(file) || `${segments[segments.length - 1] ?? ''}/${file}` === COPILOT_FILE;
}

/** Whether the `shape` signal applies: a text extension, outside a documentation or content folder, front matter with both keys. */
export function hasSkillShape(segments: readonly string[], file: string, text: string): boolean {
  if (!SHAPE_EXTENSIONS.includes(extname(file).toLowerCase())) return false;
  if (segments.some((d) => SHAPE_EXCLUDED_DIRS.includes(d.toLowerCase()))) return false;
  const keys = filledKeys(text);
  return keys.has('name') && keys.has('description');
}

/** The scanned root's own skills folder: a collection published for assistants (the header's rule). */
export const ROOT_SKILLS_DIR = 'skills';

/** `assistant` under a coding assistant's folder, under the root's own `skills/`, or for an instruction file loaded by name, else `application`; a file the code loads is always `application`. */
export function skillHome(segments: readonly string[], file: string, loaded: boolean): NonNullable<SkillRead['home']> {
  if (loaded) return 'application';
  if (segments[0] === ROOT_SKILLS_DIR) return 'assistant';
  return segments.some((d) => SKILL_HOMES.includes(d)) || isInstructionFile(segments, file) ? 'assistant' : 'application';
}

type Signal = NonNullable<SkillRead['found_by']>[number];
const SIGNAL_ORDER: readonly Signal[] = ['name', 'shape', 'code'];

/** A path from `skill_loads` as a file under `root`, or undefined when it leaves the root or is not a file. */
function loadedFile(root: string, rel: string): string | undefined {
  const abs = resolve(root, rel);
  const back = relative(root, abs);
  if (back === '' || back.startsWith('..') || isAbsolute(back)) return undefined;
  try {
    return statSync(abs).isFile() ? abs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every skill and instruction file under `root`, sorted by path. Reads only; runs nothing.
 * `loads` is the code catalog's `skill_loads` (absent when no front end looked): each is attached
 * to the file it names as `loaded_by`, and a loaded file the walk did not find is read as well.
 */
export function readSkills(root: string, loads?: readonly SkillLoad[]): SkillRead[] {
  const found = new Map<string, { abs: string; segments: string[]; kind: SkillRead['kind']; signals: Signal[] }>();
  const visit = (dir: string, segments: string[]): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // The code walk's rule: a directory holding a `.git` FILE is a second checkout.
    if (segments.length > 0 && entries.some((e) => e.name === '.git' && e.isFile())) return;
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_REASONS.has(e.name) || TEST_DIRS.has(e.name)) continue;
        visit(full, [...segments, e.name]);
        continue;
      }
      if (!e.isFile()) continue;
      const signals: Signal[] = [];
      let kind: SkillRead['kind'] = 'skill';
      if (e.name === SKILL_FILE) signals.push('name');
      else if (isInstructionFile(segments, e.name)) {
        signals.push('name');
        kind = 'instructions';
      }
      if (SHAPE_EXTENSIONS.includes(extname(e.name).toLowerCase())) {
        const text = readText(full);
        if (text !== undefined && hasSkillShape(segments, e.name, text)) signals.push('shape');
      }
      if (signals.length > 0) found.set(posix(root, full), { abs: full, segments, kind, signals });
    }
  };
  visit(root, []);
  const byPath = new Map<string, SkillLoad[]>();
  for (const l of loads ?? []) byPath.set(l.path, [...(byPath.get(l.path) ?? []), l]);
  for (const path of byPath.keys()) {
    if (found.has(path)) continue;
    const abs = loadedFile(root, path);
    const text = abs === undefined ? undefined : readText(abs);
    if (abs === undefined || text === undefined) continue;
    const kind: SkillRead['kind'] = unquote(frontMatter(text).get('name')?.[0] ?? '') !== '' ? 'skill' : 'instructions';
    found.set(path, { abs, segments: path.split('/').slice(0, -1), kind, signals: [] });
  }
  const out: SkillRead[] = [];
  for (const [path, f] of found) {
    const s = readSkillFile(root, f.abs, f.kind);
    if (s === undefined) continue;
    const loadedBy = byPath.get(path) ?? [];
    const signals: Signal[] = loadedBy.length > 0 ? [...f.signals, 'code'] : f.signals;
    s.found_by = SIGNAL_ORDER.filter((x) => signals.includes(x));
    s.home = skillHome(f.segments, basename(f.abs), loadedBy.length > 0);
    if (loadedBy.length > 0) s.loaded_by = loadedBy;
    out.push(s);
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Why the walk leaves a directory out, for a report that says so: the code walk's own reasons. */
export const SKILL_WALK_SKIPS: readonly string[] = ['dependencies', 'build output or cache', 'version control', 'test code', NESTED_CHECKOUT];

/** Each capability's count for one file, in `CAPABILITIES` order, zeros left out. */
export function capabilityCounts(s: Pick<SkillRead, 'exercises'>): { capability: Capability; n: number }[] {
  return CAPABILITIES.map((capability) => ({ capability, n: s.exercises.filter((x) => x.capability === capability).length })).filter((x) => x.n > 0);
}
