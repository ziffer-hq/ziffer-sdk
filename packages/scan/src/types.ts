/**
 * The shared types of `@ziffer-io/scan` (ACP-433) -- the ONE definition.
 *
 * Three modules import these: `discovery/` produces `CatalogTool`, `classify/`
 * produces `Classification`, and `report/` attaches `ControlRef` to each
 * `Finding` and assembles the `ScanResult`. They are transcribed verbatim from
 * the build's shared contract, plus one amendment made during the build:
 * `Classification` carries `client` and `server` beside `tool`, because two
 * servers can expose the same tool name. Nothing else in this package may declare a
 * type of the same shape: a second declaration is a second definition, and the
 * one that drifts is the one nobody edits.
 */

import type { CodeSection } from './code/types.js';

/** One tool as a discovered MCP client would present it. */
export interface CatalogTool {
  client: string;          // "Claude Code", "VS Code", "GitHub Copilot", ... exactly as data/clients.json spells it
  server: string;          // the server's name in that client's config
  tool: string;            // the tool name as the server lists it (original spelling)
  description: string;     // may be empty
  params: string[];        // parameter names from the input schema, may be empty
  source_path: string;     // the config file the server came from
  configured_in?: ConfiguredIn[]; // set only when one server is configured in more than one place (ACP-450)
}

/**
 * One place a server is configured. `~/.claude.json` holds one server block per
 * project directory, so one server can be configured thirteen times in one file;
 * the scan starts it once and says where it is configured instead (ACP-450).
 */
export interface ConfiguredIn {
  file: string;            // the config file
  project?: string;        // the project directory, when the file keeps one block per project
}

/** The classifier's DRAFT for one tool. Never the engine's opinion. */
export interface Classification {
  client: string;          // as CatalogTool.client: two servers can expose the same tool name
  server: string;          // as CatalogTool.server: so a classification maps back to one server
  tool: string;
  effect: 'read' | 'write' | 'irreversible';
  egress: boolean;
  untrusted_input: boolean;
  matched: string[];       // the data-file keys that fired, so a reader can see why
  reason?: string;         // set when effect is irreversible or egress is true: the phrase and where it was, e.g. 'name says "execute"' (ACP-454)
  draft: true;             // literally true, always; the type forbids anything else
}

export type FindingKind =
  | 'pair' | 'poisoned' | 'unclassified' | 'irreversible' | 'egress'
  | 'client_not_covered' | 'server_not_started' | 'runtime_missing';

export interface ControlRef {
  framework: string;       // "NIS2", "EU AI Act", "NIST SP 800-53", "DORA", "ISO/IEC 42001", "MITRE ATLAS", ...
  clause: string;          // the framework's own citation, as the annex spells it
  status: 'built' | 'partial' | 'not checked' | 'lands in' | 'customer obligation' | 'not covered';
  source: 'E-control-mapping.md' | '02-THREAT-MODEL-MITRE.md';
}

export interface Finding {
  id: string;              // stable, e.g. "pair:read_email+send_email"
  kind: FindingKind;
  severity: 'info' | 'warn' | 'high';
  tools: string[];
  client?: string;
  server?: string;         // set on a finding about one configured server (not started, runtime missing), so the report can name it
  message: string;         // one sentence a person reads; no clause ids
  configured_in?: ConfiguredIn[]; // as CatalogTool.configured_in, on a finding about one server
  controls: ControlRef[];  // attached by the report module from data/finding-controls.json
}

/**
 * Instruction-like text found in a description or an instruction file (2026-09-28): one
 * pattern of `data/poisoned.json` that matched. The installed-tools half has reported these
 * as `poisoned` findings since ACP-433; this is the same reading, by the same patterns and
 * the same loader, applied to the tools an application defines in its own code and to skill
 * files. `excerpt` is the matched text with at most 60 characters around it, redacted by
 * `redact/` like every other string the report prints.
 */
export interface InstructionHit {
  pattern: string;         // the pattern's `id` in data/poisoned.json
  why: string;             // that pattern's `why`, the sentence a reader sees
  severity: 'info' | 'warn' | 'high';
  excerpt: string;
  line?: number;           // 1-based line in the file, when the text is a file
}

/**
 * One skill or instruction file found under the scanned root (2026-09-28, ACP-460), by any of three
 * ways (`found_by`): its name (a `SKILL.md` in ANY folder, or an instruction file an assistant
 * loads by name: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`,
 * `.github/copilot-instructions.md`), its shape (front matter filling both `name` and
 * `description`), or the application's code loading it (`loaded_by`). Each is placed with its
 * reader (`home`): the application's own model, or a developer's coding assistant. The scanned
 * root's OWN top-level `skills/` folder is a collection published for assistants and is
 * `assistant`, unless the application's code loads the file; a `skills/` folder deeper in the tree
 * is not covered by that rule. READ AS TEXT; nothing is run. AN INVENTORY, NOT A VERDICT: what the
 * skill's words and the scripts beside it can do, and what it declares. A skill that declares
 * nothing is not a defect by itself (a declaration is optional in every format read); the one
 * thing reported as a finding is an `InstructionHit`.
 */
export interface SkillRead {
  path: string;            // relative to the scanned root, POSIX separators
  kind: 'skill' | 'instructions';
  name: string;            // the front matter `name`, else the folder or file name
  /** The tools the skill says it may use (front matter `allowed-tools` or `tools`), as written; absent when it declares none. */
  declares?: string[];
  /** What the skill's text and the scripts in its folder do, each with where: a shell command, a network call, a write outside its folder, a read of a credential file or variable. */
  exercises: { capability: 'shell' | 'network' | 'file_write' | 'credentials'; file: string; line: number; evidence: string }[];
  instruction_hits: InstructionHit[];
  /**
   * WHO LOADS IT (ACP-460). `application`: the file sits in the application's own source, or the
   * application's code loads it (`loaded_by` is not empty). `assistant`: it sits under a coding
   * assistant's folder (`.claude`, `.agents`, `.cursor`, `.gemini`, `.codebuddy`, ...: the list is
   * `skills/index.ts` `SKILL_HOMES`) or is an instruction file an assistant loads by name, AND no
   * code was seen loading it. The two are different readers: a model in the application is given
   * the first, the developer's own coding assistant the second. Absent on a result made before it.
   */
  home?: 'application' | 'assistant';
  /**
   * WHICH SIGNAL FOUND IT (ACP-460), every one that applies, in this order:
   * `name`  the file is called `SKILL.md` (any folder) or is an instruction file loaded by name;
   * `shape` a text file whose front matter carries BOTH `name` and `description`;
   * `code`  the application's code reads the file or carries its text (`loaded_by`).
   * A report words its certainty from this: `code` is "loaded by your code at <line>", `name` or
   * `shape` alone is "looks like a skill; the scan did not see what loads it".
   */
  found_by?: ('name' | 'shape' | 'code')[];
  /** Where the application's code loads this file, from `CodeCatalog.skill_loads`; absent when none was seen. */
  loaded_by?: SkillLoad[];
  /**
   * The cross-check (ACP-460): each name of `declares`, as written, against the tools the code scan
   * found. `in_code`: a `CodeTool` of that name exists. `held`: the draft policy holds that tool for
   * a person (its verdict is ATTEST); absent when `in_code` is false or the code half gave no
   * verdict. A declared name with `in_code: false` is reported as it is: the skill names a tool the
   * scan found no definition for. Absent when the skill declares nothing or the code half did not run.
   */
  declared_tools?: { name: string; in_code: boolean; held?: boolean }[];
}

/**
 * One place the application's code loads a skill or instruction file (ACP-460, the third signal).
 * Read from source text; nothing is run. A GUESS MAY ONLY ADD AN ENTRY TO THE INVENTORY: a load
 * that is not seen removes nothing and relaxes nothing.
 */
export interface SkillLoad {
  /** The file loaded, relative to the scanned root, POSIX separators. */
  path: string;
  /**
   * `read`      a file read (`readFile`, `readFileSync`, `open`, `Path.read_text`, ...) whose path
   *             argument resolves, from literals and `path.join`/`os.path.join` of literals, to this
   *             file, or to a folder or pattern that contains it;
   * `embedded`  a string literal in source holds this file's text (a generated registry). ONLY for a
   *             skill-shaped file: a `SKILL.md`, an instruction file loaded by name, or front matter
   *             with both `name` and `description`. The literal must hold two of the body's three
   *             200-character windows (its start, middle and end; whitespace runs collapsed to one
   *             space on both sides), or the whole body when it is shorter. A plain document that
   *             shares text with a literal is never listed: either could have copied the other;
   * `imported`  the file itself is imported as text (`import x from './a.md?raw'`, a bundler text
   *             loader, `importlib.resources`).
   * A load may happen at build time (a script that generates source from the file); the entry
   * does not say when.
   */
  how: 'read' | 'embedded' | 'imported';
  /** The line that reads, embeds or imports it. */
  at: { file: string; line: number };
  /**
   * Where the loaded text goes, WHEN THE WALK COULD FOLLOW IT, else absent (absent is "not
   * followed", never "goes nowhere"). ONE place: when the text reaches both, `instructions` is the
   * one kept.
   * `instructions` it reaches the instructions of a model call (`system`, `instructions`,
   *                `systemInstruction`, a message whose role is `system` or `developer`);
   * `tool_result`  a tool's run function returns it, so the model reads it as a tool result.
   */
  reaches?: { kind: 'instructions' | 'tool_result'; at: { file: string; line: number }; via: string };
}

export interface ScanResult {
  scan_version: string;
  engine_pin: string;
  date: string;            // RFC 3339
  clients_scanned: string[];
  clients_not_covered: string[];   // e.g. ["JetBrains AI Assistant"]
  catalog: CatalogTool[];
  classifications: Classification[];
  findings: Finding[];
  reach?: Reach;           // counted once per program, not once per client (ACP-454); absent from a result made before it
  code?: CodeSection;
  /** The skills and instruction files found under the scanned root (2026-09-28); absent when the code half did not run, empty when it ran and found none. */
  skills?: SkillRead[];
  /**
   * What this run read (ACP-455), so a report can tell "not run" from "found nothing":
   * `code` — 'read' (the codebase was walked), 'skipped-flag' (--no-code), 'no-codebase'
   * (run from the home directory or /); `installed` — whether the installed tools were scanned.
   * Absent from a result made before it.
   */
  scope?: { code: 'read' | 'skipped-flag' | 'no-codebase'; installed: boolean };      // the customer's own application's tools, graded by the engine (ACP-455 `--code`); absent when --code did not run
}

/**
 * What the AI agents can reach, each program counted once (ACP-454). The
 * catalog keeps one row per client, server and tool, because a pair finding is
 * per client; these counts are per START SIGNATURE (`discovery/group.ts`), so
 * one server configured in seven clients is one server, and its tools are
 * counted once.
 */
export interface Reach {
  servers: number;         // distinct signatures that listed their tools
  tools: number;           // distinct (signature, tool) pairs among them
  clients: number;         // distinct clients with at least one of those servers
  not_started: {           // distinct signatures (an unreadable file counts once) the picture leaves out
    remote: number;        // remote servers, which this scan does not start
    timed_out: number;     // started, and gave no tool list within the timeout
    other: number;         // everything else that could not be started or read
  };
}
