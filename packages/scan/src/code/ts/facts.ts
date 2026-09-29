/**
 * The raw facts one pass over one program collects, before the joins across
 * programs (tool names through a type, dispatchers through call bodies, gates
 * through the tool type) are made in `join.ts`.
 */

import type { CodeTool, Interception, SourceRef } from '../types.js';

/** A call made inside an execute body to a function declared in the tree. */
export interface ExecCall {
  calleeId: string;
  calleeName: string;
  /** The first argument carries the tool's name: the literal name, the loop's key variable, or an identifier spelled like a name. */
  nameArg: boolean;
  argc: number;
}

/** A function declared in the tree that an execute body calls: a dispatcher candidate. */
export interface FunctionInfo {
  name: string;
  at: SourceRef;
  signature: string;
}

export interface FoundTool {
  tool: CodeTool;
  key: string;
  /** Declaration id of the variable the definition is assigned to, so an exposure's key can rename it. */
  varId?: string;
  /** Declaration id of the tree function that returns this definition, joined to an exposure entry calling it. */
  factoryId?: string;
  /** Declaration id of the factory's return type (S-LOCAL), the key a loop bridge is joined back through. */
  typeId?: string;
  calls: ExecCall[];
  /** Declaration id of the MCP server a registration is made on, joined to that server's `connect`. */
  serverId?: string;
  /** Authority claims the definition writes (`requires_confirmation`, `needsApproval`, ...), with the value as written: claims, recorded, never relied on. */
  hints: AuthorityClaim[];
  /** Declaration ids that ARE this tool's run function: the execute member, and the function it names. */
  execIds?: string[];
  /** Candidate calls to other tools' run functions, read from the run function and what it reaches; resolved in the join. */
  reach?: RawToolCall[];
}

export interface AuthorityClaim {
  name: string;
  value: string;
}

/**
 * A call site reached from a tool's run function that may run another tool (ACP-455).
 * `targets` are the ids a DIRECT call resolves through (`def:<refKey>` of a definition,
 * `exec:<declId>` of a run function); a LOOKUP carries the map's element type instead.
 */
export interface RawToolCall {
  at: SourceRef;
  via: 'direct' | 'lookup';
  targets: string[];
  /** Lookup: the declaration id of the looked-up value's type, joined to the tool types. */
  elemTypeId?: string;
  /** Lookup: the element type is declared by a tool SDK. */
  elemSdkTool?: boolean;
  /** Lookup: the key, when it is a string literal. */
  literalKey?: string;
  through: string[];
  /** Declaration ids of the tree functions entered on the way, to drop a path that enters a dispatcher. */
  pathIds: string[];
}

/** A tool built in a loop or under a computed key: `tools[name] = dynamicTool({...})`. */
export interface FoundBridge {
  at: SourceRef;
  via: string;
  sdk: string;
  keyName?: string;
  /** The type of the value the loop reads the definition from (`handler.description`), joined to S-LOCAL tools. */
  handlerTypeId?: string;
  handlerTypeName?: string;
  /** Declaration id of the map the bridge writes into, so an exposure passing that map is joined too. */
  targetId?: string;
  calls: ExecCall[];
}

/**
 * A call to a function of the tree that hands it the name and the input of one tool
 * request read from the model's reply (`runTool(block.name, block.input)`, sig-reply.ts):
 * the callee runs that SDK's tools that have no execute body of their own.
 */
export interface ReplyCall {
  at: SourceRef;
  sdk: string;
  calleeId: string;
}

export interface ExposureEntry {
  key?: string;
  valueId?: string;
  toolKey?: string;
  /** Declaration id of the tree function an entry's value is a call to (a tool factory). */
  calleeId?: string;
}

export interface FoundExposure {
  at: SourceRef;
  via: string;
  sdk: string;
  isStatic: boolean;
  entries: ExposureEntry[];
  /** Names readable without a join: literal keys, literal array element names, a type's named properties. */
  names: string[];
  valueTargetId?: string;
  /** An MCP server's `connect`: its tools are the registrations on the same server. */
  serverId?: string;
  /** Why the set is computed, for the note. */
  reason?: string;
  /** Where a check can stand before these tools run, in the record's words (K1..K5), appended to the note. */
  interception?: string;
  /** The same place as data (`Exposure.interception`), when the recogniser read it more closely than the framework's markers can (the hook object on this call). */
  point?: Interception;
  /** A Claude Agent SDK in-process server (`createSdkMcpServer({ name })`): its name, and the declaration it is assigned to, joined to the key `mcpServers` registers it under. */
  mcpServer?: { name?: string; declId?: string };
}

export interface GateCandidate {
  fnName: string;
  at: SourceRef;
  callee: string;
  listText: string;
  elemTypeId: string;
  elemPackage?: string;
  retElemTypeId: string;
  retElemPackage?: string;
}

/**
 * What a note is about when it is not the application: `assistant-config` is a developer's coding
 * assistant configured in the scanned repository (its hook files, permission rules and MCP server
 * lists). A report places such a note by this kind, never by the file name it quotes.
 */
export type NoteKind = 'assistant-config';

export interface Facts {
  filesRead: number;
  tools: FoundTool[];
  bridges: FoundBridge[];
  replyCalls: ReplyCall[];
  exposures: FoundExposure[];
  gates: GateCandidate[];
  functions: Map<string, FunctionInfo>;
  mcpClients: SourceRef[];
  providerTools: { at: SourceRef; text: string }[];
  dynamicFiles: Set<string>;
  /** MCP servers with a registration whose name is not a literal. */
  mcpDynamicServers: Set<string>;
  /** Low-level MCP tool handlers (`setRequestHandler(CallToolRequestSchema, ...)`) whose tool lists are not read. */
  mcpLowLevel: SourceRef[];
  /** Files with a bare import the checker could not resolve, and those among them importing a known framework. */
  unresolvedFiles: Set<string>;
  unresolvedFrameworkFiles: Set<string>;
  /**
   * Sentences a framework recogniser adds to the honesty lines (`not_seen`): where the
   * framework runs a tool and where a check can stand (K1..K5), what it cannot read.
   * Keyed by the recogniser, so a framework seen in twenty files says its sentence once
   * (`note`, `noteAt` in common.ts).
   */
  notes: Map<string, string>;
  /** The places a keyed note counts (`noteAt`), or the one place a sentence was said about (`note` with `at`), in the order found. */
  noteRefs: Map<string, SourceRef[]>;
  /** How a counting note is rewritten (`noteAt`), so the own-source rule can recount it (`code/index.ts`). */
  noteMakers: Map<string, (count: number, where: string) => string>;
  /** The KIND of a keyed note, when it is not about the application: carried to `CodeCatalog.assistant_config` (ACP-464). */
  noteKinds: Map<string, NoteKind>;
  /** VS Code `vscode.lm.registerTool(name, impl)` calls, joined to `contributes.languageModelTools` after the pass (`sig-vscode.ts`). */
  vscodeRegistrations: VscodeRegistration[];
  /** Structured-output schemas recognised and not counted as tools (`CodeCatalog.structured_output`), in the order found. */
  structured: { name: string; at: SourceRef }[];
  /** Tool definitions whose name for the model is an expression the scan could not resolve (`modelName` in common.ts): `listed` is the name the tool is listed under instead, absent when it is not listed. */
  computedNames: { sdk: string; listed?: string; at: SourceRef; expr: string }[];
  /** Claude Agent SDK: the key each in-process server is registered under in a `query()`'s `mcpServers`, by the server's declaration id. */
  claudeServerKeys: Map<string, string>;
  /** Claude Agent SDK: names written as built-in tools that the SDK's current version does not define, where. */
  claudeUnknownBuiltins: { name: string; at: SourceRef }[];
}

export interface VscodeRegistration {
  name: string;
  at: SourceRef;
  /** The implementation's `invoke` method, when the second argument resolves to one. */
  invokeAt?: SourceRef;
  calls: ExecCall[];
  hints: AuthorityClaim[];
}

export function emptyFacts(): Facts {
  return {
    filesRead: 0,
    tools: [],
    bridges: [],
    replyCalls: [],
    exposures: [],
    gates: [],
    functions: new Map(),
    mcpClients: [],
    providerTools: [],
    dynamicFiles: new Set(),
    mcpDynamicServers: new Set(),
    mcpLowLevel: [],
    unresolvedFiles: new Set(),
    unresolvedFrameworkFiles: new Set(),
    notes: new Map(),
    noteRefs: new Map(),
    noteMakers: new Map(),
    noteKinds: new Map(),
    vscodeRegistrations: [],
    structured: [],
    computedNames: [],
    claudeServerKeys: new Map(),
    claudeUnknownBuiltins: [],
  };
}
