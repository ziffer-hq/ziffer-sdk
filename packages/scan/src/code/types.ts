/**
 * `ziffer-scan --code` (ACP-455): the ONE contract between the code front end
 * (`code/ts/`), the grader (`code/grade.ts`) and the two reports.
 *
 * The scan's first half read MCP servers a machine's AI tools are configured
 * with. This half reads the customer's OWN application: the tools its code
 * defines for a model, where they are exposed, the one function they all run
 * through, and -- graded by the ENGINE, never by a keyword -- what ZIFFER would
 * do to each. Every finding here ends in ONE call to action: the ZIFFER call
 * pasted at the dispatcher, the draft policy to review and sign.
 *
 * Nothing else in this package may declare a type of these shapes.
 */

import type { CiVerdict } from '../ci/ci.js';

/** Where in the customer's tree something is; `file` is relative to `--cwd`, POSIX separators. */
export interface SourceRef {
  file: string;
  line: number;   // 1-based
  col: number;    // 1-based
}

/**
 * Which detection signature found a tool: a framework `id` from `data/code-sdks.json`
 * (`ai`, `anthropic`, `openai`, `gemini`, `mcp`, `langchain`, `openai-agents`,
 * `pydantic-ai`, `crewai`, ...), or `local` for an application-local factory found by
 * type. The data file is the one list of what is covered and what is not; a value here
 * that is not in it is a defect the tests catch.
 */
export type CodeSdk = string;

/**
 * A tool's run function running ANOTHER tool's run function without passing the dispatcher
 * (ACP-455, 2026-09-28). A ZIFFER call placed at the dispatcher does not see these: the
 * outer tool is decided, the inner one runs unseen. Read from the source text, never by
 * running anything. `tool` is absent when the inner tool is chosen by a computed name
 * (a lookup in a tools map by a variable): then ANY tool may be the one run.
 */
export interface ToolCall {
  tool?: string;             // the inner tool's name (`CodeTool.name`) when the source names it
  at: SourceRef;             // the call site, possibly in a helper the run function reaches
  via: 'direct' | 'lookup';  // direct: the inner tool's run function is imported or referenced and called; lookup: taken from a tools map and called
  through: string[];         // the functions between the outer run function and the call site, outermost first; empty when the call is in the run function itself
}

/**
 * What the source shows before ONE call to the dispatcher (ACP-455, 2026-09-28): whether the
 * enclosing function tests something named like a confirmation before it calls. A check that
 * was FOUND is a line of code, not proof it stops anything; a check NOT found is what the
 * scan read, not proof nobody is asked.
 */
export interface CallerCheck {
  caller: SourceRef;         // one of `Dispatcher.callers`, same value
  in_function: string;       // the enclosing function's or route's name as written; '' when anonymous
  /** The test found before the call, when one was: where, and the name it reads (`requires_confirmation`, `confirmed`, ...), in the source's spelling. */
  check?: { at: SourceRef; reads: string };
  /**
   * The tools this caller can hand to the dispatcher, when the source says so (2026-09-28, second
   * review): the tool list or map given to the calling function is a literal, an import of one, or
   * a filter of the catalog readable from the source (a name prefix, a folder). `CodeTool.name`s.
   * ABSENT when the name reaches the call as a value the source does not bound: then the caller
   * can reach any tool the dispatcher knows, and a report says exactly that, never a guess.
   */
  reaches?: string[];
  /** How `reaches` was read, in one reader phrase (`the tool list built in registerProspectorTools`); present with `reaches`. */
  reaches_from?: string;
  /**
   * The tools the MODEL IS TOLD ABOUT on this path, when the source says so (2026-09-28, third
   * reading): the place that installs this caller builds the tool list it gives the model from a
   * literal, an import, or a filter of the catalog readable from the source (a name prefix).
   * NOT the same fact as `reaches`: a list offered to a model bounds what an honest model asks
   * for; it bounds what a manipulated model can run only if something on the path refuses a name
   * that is not on the list. A report states both, in that order, and never merges them.
   */
  offered?: string[];
  /** Where and how `offered` was read (`scripts/prospector-canary.ts:65, ALL_TOOLS filtered by the name prefix "prospector_"`); present with `offered`. */
  offered_from?: string;
}

/**
 * What a tool's own words, or the tool list, say about undoing it (ACP-455, 2026-09-28).
 * EVIDENCE FOR A PERSON, with one asymmetry that is the whole rule: `cannot_be_undone`
 * may make the draft stricter; `can_be_undone` and `reads_only` NEVER change the draft
 * (RV-1: an absent entry is IRREVERSIBLE, and a guess must not relax it). The report
 * proposes the entry; a person confirms it.
 */
export interface UndoHint {
  says: 'can_be_undone' | 'cannot_be_undone' | 'reads_only';
  source: 'description' | 'inverse_tool';
  evidence: string;          // the phrase as written in the description, or the inverse tool's name
}

/**
 * The kind of place a check can stand before a tool runs (acp docs/design/acp-455-tool-calling-surfaces.md §0).
 * Internal vocabulary: a report says it in plain words, never by these codes.
 * - K1: the framework runs a documented hook after the model's call is read and before the tool runs, and the hook can refuse the call.
 * - K2: the framework stops the run and hands a pending approval back to the application, which resumes it.
 * - K3: no hook exists, but the framework calls the tool's own function, so a check wrapped around that function before it is registered is exact.
 * - K4: the SDK returns the model's call and runs nothing: the application's own dispatcher runs every tool, and that is where the check stands.
 * - K5: the provider runs the tool on its own servers, so nothing in the application can stop one call; only offering the tool at all can be decided.
 */
export type InterceptionKind = 'K1' | 'K2' | 'K3' | 'K4' | 'K5';

/**
 * Where a check can stand before these tools run, as the framework offers it (ACP-455,
 * 2026-09-28): the kind, and the framework's own name for the place (`a PreToolUse hook`,
 * `requireApproval on this tool`). `present` is true when this hook, filter, middleware or
 * approval is registered at this call or in this file, false when the framework offers it
 * and the code does not use it. K3 and K4 name a place in the application's own code rather
 * than a framework feature: K4 is always present (the application's code runs every call),
 * K3 is present only when the scan saw the wrap, which it does not look for yet, so false.
 * A reading of the source: a hook registered is a line of code, not proof it refuses anything.
 */
export interface Interception {
  kind: InterceptionKind;
  name: string;
  present: boolean;
  /** Where the registration was read, when `present` and the source shows one place. */
  at?: SourceRef;
}

/** One tool the application defines for a model. */
export interface CodeTool {
  name: string;              // the literal name the model sees
  description: string;       // may be empty when not a literal
  schema_kind: 'json_schema' | 'zod' | 'unknown';
  params: string[];          // top-level parameter names when recoverable (JSON schema `properties`, or a `z.object({...})` literal's keys); may be empty
  sdk: CodeSdk;
  via: string;               // one phrase a reader understands: `tool() from "ai"`, `dynamicTool() from "ai"`, `tools[] on messages.create`, `defineTool() (app-local factory, returns an Anthropic Tool input schema)`
  defined_at: SourceRef;
  execute_at?: SourceRef;    // the execute body when the definition carries one
  delegates_to?: string;     // the dispatcher the execute body calls, when it calls one (by `Dispatcher.name`)
  /** Other tools this tool's run function runs without passing the dispatcher; absent when none was found or the check did not run (see `CodeCatalog.checks`). */
  calls?: ToolCall[];
  /** Properties on the definition that claim an authority rule, by the names in `data/code-sdks.json` (`requires_confirmation`, `needsApproval`, ...), each with the literal value written. A CLAIM by the application, never relied on by the draft. */
  authority_claims?: { name: string; value: string }[];
  /** The description says the tool is not wired yet (the whole word "stub", any case). A reading of the description. */
  declared_stub?: boolean;
  /**
   * The name the MODEL sees, present only when it differs from `name` (ACP-455, 2026-09-28): a
   * Claude Agent SDK custom tool reaches the model as `mcp__<server>__<name>`, where `<server>`
   * is the key the in-process server is registered under in `mcpServers` when the source shows
   * it, else the server's own name (`createSdkMcpServer({ name })`, `create_sdk_mcp_server(name=)`).
   * Absent when the server name is not readable. `name` stays the defined name.
   */
  model_name?: string;
  /**
   * The tool's own approval step, when the definition carries the framework's per-tool flag
   * (`needsApproval`, `requireApproval`, `requires_approval`, `approval_mode`, `require_confirmation`,
   * a VS Code `confirmationMessages`): always K2, `present` false when the flag is written off.
   * Absent when the framework has no per-tool flag or the definition does not write one.
   */
  interception?: Interception;
}

/** A place tools are handed to a model. */
export interface Exposure {
  at: SourceRef;
  via: string;               // `generateText({ tools })`, `streamText({ tools })`, `messages.create({ tools })`, `dynamicTool() in a loop`
  kind: 'static' | 'computed';   // static: the tool set is readable from the source; computed: keys or list come from a value
  tools: string[];           // names exposed here when `static`; when `computed`, the names joined back through the type, possibly empty
  note: string;              // one sentence, e.g. "exposure of these tools is decided per location by getActiveTools at runtime; the scan lists what CAN be exposed"
  /** Where a check can stand before the tools handed over here run, by the framework's table (`data/code-sdks.json` `interception`); absent when the framework has none. */
  interception?: Interception;
}

/** A function every discovered execute body delegates to: the ZIFFER insertion point. */
export interface Dispatcher {
  name: string;
  at: SourceRef;
  signature: string;         // the declaration's parameter list as written, e.g. `(name, input, ctx, abortSignal)`
  callers: SourceRef[];      // every call site in the tree, model path and human paths alike
  tools_delegating: number;  // how many CodeTool.execute bodies reach it
  /** One entry per `callers` entry, same order; absent when the check did not run (see `CodeCatalog.checks`). */
  caller_checks?: CallerCheck[];
}

/** A runtime condition that narrows which tools a model can reach (a database, a permission table). */
export interface RuntimeGate {
  name: string;
  at: SourceRef;
  note: string;
}

/** The front end's output: what the code says, before the engine has said anything. */
export interface CodeCatalog {
  root: string;              // the directory scanned, as given
  package_name?: string;     // package.json `name` at root, when present
  sdks: { name: string; version: string }[];   // the known tool-calling SDKs found in package.json dependencies (any depth of workspace), with the declared version
  files_read: number;
  tools: CodeTool[];
  exposures: Exposure[];
  dispatchers: Dispatcher[];
  gates: RuntimeGate[];
  /** The syntax-only pass over the same tree. `missed` is the number that justifies the type checker's cost; it is measured, never asserted. */
  syntax_only: { found: number; missed: number };
  /** The lines of the record's honesty list (acp docs/design/acp-455-tool-calling-surfaces.md §6) that apply to THIS tree: what was not seen and why. */
  not_seen: string[];
  /**
   * The lines of `not_seen` whose KIND is a developer's coding assistant configured in this
   * repository (its hook files, permission rules and MCP server lists, `code/ts/sig-hooks.ts`), not
   * the application's own model (ACP-464). Each is also in `not_seen`, which stays the whole honesty
   * list; this field says which of them a report places with the coding assistants. Absent when
   * there is none, and on a catalog made before it.
   */
  assistant_config?: string[];
  /** Which of the 2026-09-28 checks ran, per language read, so a report can tell "none found" from "not looked for". Absent on a catalog made before them. */
  checks?: { language: 'typescript' | 'python'; tool_calls: boolean; caller_checks: boolean; skill_loads?: boolean }[];
  /**
   * Every place the code loads a text file that is, or may be, a skill or an instruction file
   * (ACP-460): see `SkillLoad` in `../types.ts`. Each language's front end emits its own; `merge.ts`
   * concatenates and sorts by `path`, then `at.file`, then `at.line`. A text file here is a `.md`,
   * `.mdx`, `.mdc`, `.txt` or `.prompt` file, and nothing else (a `.json` or `.yaml` a program reads
   * is configuration). A `read` or `imported` entry is emitted for any text file whose text
   * `reaches` a model's instructions or a tool result, and for any skill-shaped file whether or not
   * `reaches` could be followed; an `embedded` entry only for a skill-shaped file. Absent when no front end looked
   * (`checks[].skill_loads` is not true); empty when they looked and found none.
   */
  skill_loads?: import('../types.js').SkillLoad[];
  /**
   * Schemas the code hands a model to shape its ANSWER (Instructor `response_model`, AI SDK
   * `generateObject`, OpenAI `zodResponseFormat` / `parse(response_format=)`): recognised and
   * NOT counted as tools, because nothing runs (record §3.17). `name` is the schema as written.
   * The honesty line stays beside it. Absent when no front end looked; empty when none was found.
   */
  structured_output?: { name: string; at: SourceRef }[];
}

/** One tool with the engine's verdict beside it. The verdict is `decide`'s, verbatim, as in `ci/ci.ts`. */
export interface CodeToolVerdict {
  tool: CodeTool;
  verdict: CiVerdict;
  /** What ZIFFER does to this tool under the draft policy, in one reader sentence: "held for a human before it runs", "recorded with a signed receipt", "runs, recorded", "refused: no risk function drafted". */
  what_ziffer_does: string;
  /** The classifier's reason when the draft graded it irreversible or egress (`Classification.reason`); absent otherwise. */
  draft_reason?: string;
  /** The draft policy's key for this tool when it differs from `tool.name` (the generator's `toolId`). */
  key?: string;
  /**
   * The draft marks this tool as bringing text outsiders can write into the model's context
   * (`Classification.untrusted_input`: a message, an email, a web page, a review...). A DRAFT,
   * from the tool's name, parameters and description; the executive summary names it as a
   * path an outsider can use, never as an attack that happened.
   */
  untrusted_input: boolean;
  /** The `untrusted_input` keywords of `data/keywords.json` that fired (`Classification.matched`), in the data file's words. */
  untrusted_words?: string[];
  /** The draft marks this tool as sending data out of the application (`Classification.egress`). */
  egress: boolean;
  /**
   * The highest `irreversible_class` (`data/keywords.json`) among the irreversible keywords the
   * draft matched as the tool's own action: 3 runs or destroys, 2 changes shared state, 1 sends
   * or pays; absent when the draft did not read the tool as irreversible.
   */
  irreversible_class?: 1 | 2 | 3;
  /**
   * The tool's name or parameters name a secret or an access value (a door code, a payment
   * link, a password): the word that matched, from `data/keywords.json`. A property of the
   * DATA the tool touches, never of whether it can be undone: a tool that only READS such a
   * value stays a read in the draft (it changes nothing, so there is nothing to undo) and is
   * named as a source in the exfiltration finding; a tool that WRITES one is drafted HIGH.
   * (Corrected 2026-09-28: the first version raised reads into the irreversible count, which
   * counted two tools that change nothing among the tools that cannot be undone.)
   */
  sensitive_value?: string;
  /** Instruction-like text in this tool's own description, by the patterns of `data/poisoned.json` (`InstructionHit` in `../types.ts`); absent when none matched. In the application's OWN code this is usually the author's prompt writing, so a report words it as "your description tells the model to ...", never as an attack. */
  instruction_hits?: import('../types.js').InstructionHit[];
  /** What the description and the tool list say about undoing this tool; absent when nothing was found. */
  undo_hints?: UndoHint[];
  /**
   * The draft graded this tool at least as strictly as a tool it runs unseen (`CodeTool.calls`):
   * the inner tool's name, or '*' when the inner tool is chosen by a computed name and the
   * strictest tool in the catalog was taken. Absent when the tool runs no other tool.
   */
  raised_by?: string;
}

/** The call to action: the one place to put ZIFFER, and the code to put there. */
export interface Insertion {
  /** The dispatcher chosen (most tools delegating, then most callers); null when the tree has none, then `per_tool` is true. */
  dispatcher: Dispatcher | null;
  per_tool: boolean;
  /** One sentence: "One call at the top of executeTool (api/src/lib/agents/tools/tool-executor.ts:56) puts every one of the 88 tools under ZIFFER, on its 3 callers alike." */
  sentence: string;
  /** The TypeScript to paste, complete and compilable against `@ziffer-io/client`: construct `ZifferClient`, build the `WireProposal` from `(name, input)`, `propose`, `waitForReceipt`, then `verifyReceipt` against the trust anchor, the suite floor and the approver registry, over the exact bytes sent; return only when it verifies. Real identifiers from the tree (the dispatcher's parameter names), never placeholders where the tree has a name. */
  snippet: string;
  snippet_language: 'typescript';
  /** The ONE line to paste at the top of the dispatcher (the snippet is the module it imports), e.g. `await zifferGate(name, input);`. */
  call: string;
}

/**
 * Two of the application's own tools that are dangerous when ONE model can call both
 * (2026-09-28): a rule of `data/pairs.json`, by the same function the installed half uses.
 * In the result, not recomputed by a report, so the JSON, the page and the MCP text say the
 * same pairs. A tool whose name says it returns numbers about text (statistics, counts) is
 * never a reader: it carries no sentence anybody wrote.
 */
export interface CodePair {
  id: string;                // the rule's `id` in data/pairs.json
  why: string;               // the rule's `why`
  reader: string;            // `CodeTool.name`
  sender: string;            // `CodeTool.name`
  basis: string;             // what made the reader a reader, in the source's words: `name says "inbox"`, `returns an access value ("payment link")`
  /** The caller (`CallerCheck.in_function`) whose `offered` list holds BOTH tools, when one does; absent when no path's list is readable or none holds both. */
  same_path?: string;
}

/** The section both reports render when `--code` ran. Absent from a `ScanResult` made without it. */
export interface CodeSection {
  catalog: CodeCatalog;
  verdicts: CodeToolVerdict[];
  insertion: Insertion;
  /** The data-leaving pairs among the application's own tools; absent on a result made before them, empty when none fires. */
  pairs?: CodePair[];
  /**
   * The exposure grade as every report prints it (ACP-464 item 8), written by `gradeRecord` from the
   * one function that computes it (`gradeNow` in report/code.ts): `today` is the grade shown, the worst
   * case, because a tool with no reversibility entry counts as not undoable until it is classified;
   * `reachable` is the best case, present only when it differs; `best` and `worst` are both cases as the
   * grade computes them; `unclassified` is how many tools separate them; `provisional_files` is how many
   * files import packages the scan could not resolve (the grade is provisional above 0). Absent when the
   * application defines no tool, and on a result made before it.
   */
  grade?: {
    today: 'A' | 'B' | 'C' | 'D' | 'F';
    reachable?: 'A' | 'B' | 'C' | 'D' | 'F';
    best: 'A' | 'B' | 'C' | 'D' | 'F';
    worst: 'A' | 'B' | 'C' | 'D' | 'F';
    unclassified: number;
    provisional_files: number;
  };
  /** Counts the reports print without recounting. */
  counts: {
    tools: number;
    held: number;       // ATTEST or HIGH-graded: a human before it runs
    refused: number;    // REFUSED by the engine (no risk function drafted, etc.)
    notified: number;   // ALLOW but engine reversibility IRREVERSIBLE below HIGH: runs after a notice, nobody asked (DR-13); never read as harmless
    allowed: number;    // ALLOW and not counted in `notified`
    irreversible: number;   // engine reversibility IRREVERSIBLE (held or notified)
  };
}
