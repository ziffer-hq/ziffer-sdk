/**
 * `ziffer-scan --code`, the grading half (ACP-455): the tools an application
 * defines for a model, each with the ENGINE's verdict, and the ONE place to put
 * ZIFFER with the code to paste there.
 *
 * THE SAME SHAPE AS `ci/ci.ts`, OVER A DIFFERENT CATALOG. The classifier DRAFTS
 * (`classify`), the generator writes the draft policy from the drafts
 * (`generateBundle`, the same signed folder an MCP scan writes, because that
 * folder is what the customer reviews and signs), and every verdict is what the
 * engine's `decide` answers for the tool's Proposal against that policy,
 * verbatim. Nothing here grades: a tool with no risk function is refused at
 * `8.4-3` because the engine refuses it, an irreversible tool is held because
 * the engine holds it. A second reading of those rules here would be the second
 * definition this package refuses everywhere else.
 *
 * ONE PROGRAM, ONE NAME. A code scan reads one application, so the catalog's
 * `client` and `server` are both the application's id: `package.json`'s `name`
 * when there is one, else `application`. `server` becomes the Proposal's
 * `schema_id` and its one target, and the floor's resource, after
 * `bundle/names.ts` normalises it, exactly as an MCP server's name does. Using
 * the package name (not the directory, not the host) keeps the key stable
 * across machines and checkouts, so the draft a developer signs names the same
 * resource the CI run and the pasted snippet name.
 *
 * THE SNIPPET DECIDES NOTHING. It asks (`propose`), waits (`wait`, then the
 * decision until its receipt attaches), and obeys: the dispatcher's own body
 * runs only when the decision carries a receipt and is not `DENY`, else a named
 * error is thrown. Every identifier the tree has is used verbatim; the keys the
 * draft policy uses are stated as the draft states them.
 */

import { toolId } from '../bundle/names.js';
import type { GeneratedBundle } from '../bundle/generate.js';
import { classify, instructionHits, pairsAmong, undoHints, type ToolPair } from '../classify/index.js';
import { parseKeywords, readDataFile, type KeywordData } from '../classify/data.js';
import { words } from '../classify/words.js';
import type { CiVerdict } from '../ci/ci.js';
import { packageEnginePin } from '../package-info.js';
import { generatedReplayData } from '../replay/generated.js';
import { loadReplayData } from '../replay/data.js';
import type { Grammar, JsonObject } from '../replay/data.js';
import { toProposal } from '../replay/proposal.js';
import type { CatalogTool, Classification } from '../types.js';
import type { Engine } from '../wasm/loader.js';
import { isRecord } from '../wasm/json.js';
import { decide, type Policy } from '../wasm/ops.js';
import { basename, resolve } from 'node:path';

import type { CodeCatalog, CodePair, CodeSection, CodeTool, CodeToolVerdict, Dispatcher, Insertion, UndoHint } from './types.js';

/** An engine call failed for a reason other than a refusal of the Proposal. */
export class CodeEngineFailed extends Error {
  override readonly name = 'CodeEngineFailed';
}

/** The application's id when `package.json` names none. */
export const APPLICATION = 'application';

/**
 * The one id a code scan gives the program it read: client and server alike. The
 * manifest's name, else the scanned folder's name (a monorepo root often has no
 * `name`: the first customer's does not, and "application" named nothing), else
 * the generic word.
 */
export function applicationId(catalog: Pick<CodeCatalog, 'package_name' | 'root'>): string {
  const name = catalog.package_name;
  if (name !== undefined && name !== '') return name;
  const folder = basename(resolve(catalog.root));
  return folder === '' || folder === '.' || folder === '/' ? APPLICATION : folder;
}

/**
 * The resource a code tool is graded as: the application and the tool, one
 * resource per TOOL. The generator draws one floor per resource, raised by any
 * tool on it; one resource for the whole application would lift every write to
 * the floor its most destructive sibling implies. `bundle/names.ts` normalises
 * this name into the key the policy uses, and `ziffer-tools.json` records that
 * key per tool, so nothing downstream re-derives it.
 */
export function resourceOf(app: string, tool: string): string {
  return `${app}/${tool}`;
}

/** Each `CodeTool` as the catalog row the classifier and the generator read. */
export function catalogTools(catalog: CodeCatalog): CatalogTool[] {
  const app = applicationId(catalog);
  return catalog.tools.map((t) => ({
    client: app,
    server: resourceOf(app, t.name),
    tool: t.name,
    description: t.description,
    params: t.params,
    source_path: t.defined_at.file,
  }));
}

/** What the grader needs from the generated policy: the members `decide` reads and the adapter's grammar. */
export interface DraftPolicy {
  policy: Policy;
  grammar: Grammar;
  tenantId: string;
  operator: string;
}

/** The draft policy's members and grammar, read from the bundle as the MCP replay reads them. */
export function draftPolicy(bundle: GeneratedBundle, tools: readonly CatalogTool[], where: { path: string; date: string }): DraftPolicy {
  const base = loadReplayData();
  const data = generatedReplayData(base, bundle, tools, { path: where.path, engine_pin: packageEnginePin(), date: where.date });
  return { policy: data.bundle.policy, grammar: data.bundle.grammar, tenantId: bundle.tenantId, operator: base.operator };
}

/** The key the draft policy names a tool by: its Proposal's `task_type`. */
export function toolKey(bundle: GeneratedBundle, tool: CatalogTool): string {
  const key = bundle.tools.map.get(toolId(tool.server, tool.tool));
  if (key === undefined) throw new CodeEngineFailed(`the draft policy assigned no key to "${tool.tool}"`);
  return key;
}

/** The server's key: the Proposal's `schema_id` and its one target. */
export function serverKey(bundle: GeneratedBundle, server: string): string {
  const key = bundle.servers.map.get(server);
  if (key === undefined) throw new CodeEngineFailed(`the draft policy assigned no key to "${server}"`);
  return key;
}

/**
 * The Proposal the engine grades for one tool: `replay/proposal.ts`'s, as
 * `ci/ci.ts` builds it, with no parameters (a scan sees a tool, not a call).
 * Exported so a test can hand the same Proposal to `decide` itself.
 */
export function codeProposal(bundle: GeneratedBundle, draft: DraftPolicy, tool: CatalogTool): JsonObject {
  return toProposal({ tool: toolKey(bundle, tool), resource: '', params: {} }, draft.grammar, draft.operator, draft.tenantId);
}

/** `decide`'s answer, as `ci/ci.ts` records it: the engine's words and nothing else. */
async function verdictOf(engine: Engine, draft: DraftPolicy, proposal: JsonObject, tool: string): Promise<CiVerdict> {
  const answer = await decide(engine, { proposal, policy: draft.policy });
  if (answer.ok) {
    const g = answer.result;
    return { verdict: g.decision, risk: g.risk_floor_only, reversibility: g.reversibility, effective_tier: g.effective_tier, rule_id: g.rule_id };
  }
  if (answer.error.kind === 'refusal') return { verdict: 'REFUSED', clause: answer.error.clause, message: answer.error.message };
  throw new CodeEngineFailed(`decide for "${tool}": ${answer.error.message}`);
}

/** Held: the engine answered ATTEST, or graded the action HIGH (a human before it runs). */
export function isHeld(v: CiVerdict): boolean {
  return v.verdict === 'ATTEST' || (v.verdict === 'ALLOW' && v.risk === 'HIGH');
}

/** One reader sentence, from the verdict's fields only. */
export function whatZifferDoes(v: CiVerdict): string {
  if (v.verdict === 'REFUSED') {
    if (v.clause === '8.4-3') return 'refused: the draft policy has no risk function for it; add one or the engine will not let it run';
    return `refused: ${v.message}`;
  }
  if (isHeld(v)) return 'held for a human before it runs, then recorded with a signed receipt';
  if (v.reversibility === 'IRREVERSIBLE') return NOTICE_ONLY;
  return 'runs, recorded with a signed receipt';
}

/**
 * The sentence for one verdict, told whether the draft's `reversibility.json`
 * lists the tool. The listing is read from the member the engine graded
 * against; it changes the ADVICE, never the verdict.
 */
export function whatZifferDoesUnder(v: CiVerdict, listed: boolean): string {
  if (v.verdict === 'REFUSED' || v.reversibility !== 'IRREVERSIBLE' || listed) return whatZifferDoes(v);
  return isHeld(v) ? NO_REVERSIBILITY_ENTRY : NOTICE_ONLY_UNLISTED;
}

/** IRREVERSIBLE below HIGH: the engine's DR-13 path. People are told before it runs; nobody is asked. */
export const NOTICE_ONLY =
  'runs without a human: the people the draft policy names are notified before it runs, not asked; recorded with a signed receipt';

export const NO_REVERSIBILITY_ENTRY =
  'held: the draft has no reversibility entry for it, so the engine treats it as irreversible; add one to `reversibility.json` if it can be undone';

export const NOTICE_ONLY_UNLISTED =
  'runs without a human, after a notice: the draft has no reversibility entry for it, so the engine treats it as irreversible, ' +
  'and grades it below HIGH, so it notifies rather than holds; add it to `reversibility.json` if it can be undone, or raise its risk function to hold it';

export function countsOf(verdicts: readonly CodeToolVerdict[]): CodeSection['counts'] {
  const v = verdicts.map((x) => x.verdict);
  return {
    tools: verdicts.length,
    held: v.filter(isHeld).length,
    refused: v.filter((x) => x.verdict === 'REFUSED').length,
    notified: v.filter((x) => x.verdict === 'ALLOW' && !isHeld(x) && x.reversibility === 'IRREVERSIBLE').length,
    allowed: v.filter((x) => x.verdict === 'ALLOW' && !isHeld(x) && x.reversibility !== 'IRREVERSIBLE').length,
    irreversible: v.filter((x) => x.verdict !== 'REFUSED' && x.reversibility === 'IRREVERSIBLE').length,
  };
}

// ---------------------------------------------------------------- insertion

/** The dispatcher to recommend: most tools delegating, then most callers, then the first found. */
export function chooseDispatcher(dispatchers: readonly Dispatcher[]): Dispatcher | null {
  let best: Dispatcher | null = null;
  for (const d of dispatchers) {
    if (
      best === null ||
      d.tools_delegating > best.tools_delegating ||
      (d.tools_delegating === best.tools_delegating && d.callers.length > best.callers.length)
    ) {
      best = d;
    }
  }
  return best;
}

/** The identifiers of a parameter list as written, `(name: string, { a }, ...rest)` -> `['name', null, 'rest']`. */
export function parameterNames(signature: string): (string | null)[] {
  const inner = signature.trim().replace(/^\(/, '').replace(/\)$/, '');
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if ('([{<'.includes(ch)) depth += 1;
    if (')]}>'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((p) => /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(p)?.[1] ?? null);
}

const NAME_PARAM = /^(name|toolName|tool_name|tool|toolId|tool_id)$/i;
const INPUT_PARAM = /^(input|args|arguments|params|parameters|toolInput|tool_input|payload)$/i;

/**
 * Which of the dispatcher's own parameters carry the tool's name and its input:
 * by name when one is spelt like it, else the first and the second. `null` when
 * the list does not have two readable identifiers.
 */
export function dispatcherArguments(d: Dispatcher): { name: string; input: string } | null {
  const names = parameterNames(d.signature);
  const idents = names.filter((n): n is string => n !== null);
  const name = idents.find((n) => NAME_PARAM.test(n)) ?? names[0] ?? null;
  const input = idents.find((n) => n !== name && INPUT_PARAM.test(n)) ?? names.find((n, i) => i > 0 && n !== name) ?? null;
  if (name === null || input === null || input === undefined) return null;
  return { name, input };
}

const GATE = 'zifferGate';
const GATE_FILE = 'ziffer-gate';
/** The snippet's function that turns the dispatcher's context object into the proposal's operator. */
export const OPERATOR_OF = 'zifferOperator';

const CONTEXT_PARAM = /^(ctx|context|[A-Za-z_$][\w$]*Context|[A-Za-z_$][\w$]*_context|[A-Za-z_$][\w$]*Ctx)$/;

/**
 * The dispatcher's own parameter that is a context object (`ctx`, `context`, `toolContext`, ...),
 * by its name as written, and never the parameter that carries the tool's name or its input.
 * `null` when there is none: then every proposal names the application, not a person.
 */
export function contextParameter(d: Dispatcher): string | null {
  const args = dispatcherArguments(d);
  const found = parameterNames(d.signature).find((n) => n !== null && n !== args?.name && n !== args?.input && CONTEXT_PARAM.test(n));
  return found ?? null;
}

/** The import the insertion line needs, from the module the snippet is saved as. */
export function gateImport(insertion: Pick<Insertion, 'dispatcher'>): string {
  const ctx = insertion.dispatcher === null ? null : contextParameter(insertion.dispatcher);
  return `import { ${GATE}${ctx === null ? '' : `, ${OPERATOR_OF}`} } from './${GATE_FILE}.js';`;
}

/** The line pasted at the insertion point; the snippet's module exports what it calls. */
export function insertionCall(insertion: Pick<Insertion, 'dispatcher' | 'per_tool'>, firstTool?: string): string {
  if (insertion.dispatcher !== null) {
    // An unreadable parameter list (destructured, or fewer than two) falls back to the usual spelling.
    const args = dispatcherArguments(insertion.dispatcher) ?? { name: 'name', input: 'input' };
    // The operator is the person on whose behalf the model acts: passed from the dispatcher's context object when it has one.
    const ctx = contextParameter(insertion.dispatcher);
    return ctx === null ? `await ${GATE}(${args.name}, ${args.input});` : `await ${GATE}(${args.name}, ${args.input}, ${OPERATOR_OF}(${ctx}));`;
  }
  return `await ${GATE}(${JSON.stringify(firstTool ?? '')}, input);`;
}

const at = (r: { file: string; line: number }): string => `${r.file}:${r.line}`;
const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * The call sites where a tool runs another tool without passing the dispatcher (`CodeTool.calls`):
 * the one call at the dispatcher decides the outer tool and does not see these, so the sentence
 * that counts what the call covers says so, with the outer tools' names.
 */
function unseenClause(d: Dispatcher, tools: readonly CodeTool[]): string {
  const outer = tools.filter((t) => (t.calls ?? []).length > 0);
  const sites = outer.reduce((n, t) => n + (t.calls ?? []).length, 0);
  if (sites === 0) return '';
  const names = outer.map((t) => t.name);
  const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return (
    ` It would not see the ${sites === 1 ? 'place' : `${sites} places`} where a tool runs another tool without passing ${d.name} (in ${list}): ` +
    `${sites === 1 ? 'that place needs' : 'each needs'} the same call, or to be routed through ${d.name}.`
  );
}

function sentenceFor(d: Dispatcher | null, tools: readonly CodeTool[]): string {
  const total = tools.length;
  if (d === null) {
    const first = tools[0];
    const where = first === undefined ? '' : `, starting with ${first.name} (${at(first.execute_at ?? first.defined_at)})`;
    return (
      `No one function every tool runs through was found, so ZIFFER goes at the top of each tool's execute: ` +
      `${plural(total, 'wrap')} for ${plural(total, 'tool')}${where}.`
    );
  }
  const covered = Math.min(d.tools_delegating, total);
  const callers = plural(d.callers.length, 'caller');
  const head = `One call at the top of ${d.name} (${at(d.at)})`;
  const unseen = unseenClause(d, tools);
  if (covered >= total) return `${head} would put every one of the ${plural(total, 'tool')} under ZIFFER, on its ${callers} alike.${unseen}`;
  const rest = total - covered;
  return (
    `${head} would put ${covered} of the ${plural(total, 'tool')} under ZIFFER, on its ${callers} alike; ` +
    (rest === 1 ? 'the other one does not run through it and needs its own call at the top of its execute.' : `the other ${rest} do not run through it and each needs its own call at the top of its execute.`) +
    unseen
  );
}

/** The file `runCode` writes beside the policy folder, and the snippet reads at startup. */
export const TOOLS_FILE = 'ziffer-tools.json';
/** Where the snippet looks for it when `ZIFFER_TOOLS_FILE` is unset: the scan's default output folder. */
export const TOOLS_FILE_DEFAULT = `ziffer-scan/${TOOLS_FILE}`;

/** One tool as the draft policy names it: every value read from the generated bundle and its grammar. */
export interface CodeToolKeys {
  /** The Proposal's `task_type`: the tool's key in the draft policy. */
  task_type: string;
  /** The Proposal's `schema_id` and its one target: the tool's resource key. */
  resource: string;
  schema_hash: string;
}

/** `ziffer-tools.json`: tool name (as the model sees it) -> its keys in the draft policy. */
export interface CodeToolsFile {
  note: string;
  schema_version: string;
  tools: Record<string, CodeToolKeys>;
}

function snippetFor(insertion: Pick<Insertion, 'dispatcher' | 'per_tool'>, app: string, fidelity: string, tools: readonly CodeTool[]): string {
  const q = (s: string): string => JSON.stringify(s);
  const d = insertion.dispatcher;
  const first = tools[0];
  const call = insertionCall(insertion, first?.name);
  const ctx = d === null ? null : contextParameter(d);
  const where =
    d !== null
      ? [
          `// Save as ${GATE_FILE}.ts beside ${d.at.file}, then add ONE line at the top of ${d.name} (${at(d.at)}):`,
          `//`,
          `//   ${gateImport(insertion)}`,
          `//   ${call}`,
          `//`,
          `// Every caller of ${d.name} goes through it, whichever path the call comes from.`,
          ...(ctx === null
            ? [`// ${d.name} has no context parameter, so every proposal names the application as its operator, not a person.`]
            : [`// Which field of ${ctx} identifies the signed-in person is yours to choose: see ${OPERATOR_OF} below.`]),
        ]
      : [
          `// Save as ${GATE_FILE}.ts, then add ONE line at the top of each tool's execute, e.g. ${first === undefined ? '' : `${first.name} (${at(first.execute_at ?? first.defined_at)})`}:`,
          `//`,
          `//   import { ${GATE} } from './${GATE_FILE}.js';`,
          `//   ${call}   // \`input\`: the execute's first parameter`,
          `//`,
          `// The tree has no one function every tool runs through, so this is one line per tool.`,
        ];
  return [
    `// ZIFFER for ${app}, generated by ziffer-scan --code.`,
    ...where,
    `//`,
    `// ZIFFER decides; this file asks, checks the answer, and obeys. The action runs only when the`,
    `// decision carries a signed receipt AND that receipt verifies here, in your process, against your`,
    `// own keys and the exact proposal this call sent. A DENY, a receipt that does not verify, or a`,
    `// hold nobody answered in time throws instead, and the tool does not run.`,
    `//`,
    `// What it reads from the environment, and where each value comes from:`,
    `//   ZIFFER_API_URL            the decision API's address: your handover sheet.`,
    `//   ZIFFER_API_KEY            your API key: your handover sheet.`,
    `//   ZIFFER_TRUST_ANCHOR       path to the anchor file \`ziffer pubkey\` wrote: the public half of the`,
    `//                             key that signs your receipts. Take it from your handover sheet, never`,
    `//                             from the API it checks.`,
    `//   ZIFFER_SUITE_FLOOR        the weakest signature suite you accept: your handover sheet. No default.`,
    `//   ZIFFER_ATTESTER_REGISTRY  path to attesters/registry.json in your own policy repository: the`,
    `//                             people allowed to approve a held action, and their keys. Optional:`,
    `//                             without it, a receipt carrying approvals is refused, never passed.`,
    `//   ZIFFER_TOOLS_FILE         the ${TOOLS_FILE} the scan wrote beside the draft policy (default`,
    `//                             ${TOOLS_FILE_DEFAULT}): each tool's key and resource, as the draft names them.`,
    `// The files are read once, at the first call, and reused. One that cannot be read refuses that call`,
    `// by name; nothing is passed without it.`,
    '',
    `import { readFileSync } from 'node:fs';`,
    '',
    `import {`,
    `  AnchorError,`,
    `  Refusal,`,
    `  ZifferClient,`,
    `  loadAttesterRegistry,`,
    `  loadTrustAnchor,`,
    `  verifyReceipt,`,
    `  type AttesterRegistry,`,
    `  type Decision,`,
    `  type QuorumPolicy,`,
    `  type TrustAnchor,`,
    `  type WireProposal,`,
    `} from '@ziffer-io/client';`,
    '',
    `/** The operator when none is passed: the application. An operator is the person or service on whose behalf the model acts. */`,
    `const OPERATOR = ${q(app)};`,
    `/** The adapter's fidelity class, as the draft policy's adapters.json names every resource. */`,
    `const FIDELITY = ${q(fidelity)};`,
    `/** How long a held action may wait for a person before this call throws WaitTimeout (the hold itself stays open). */`,
    `const HOLD_LIMIT_MS = 15 * 60_000;`,
    `const POLL_MS = 2_000;`,
    '',
    `export class ZifferNotConfigured extends Error {`,
    `  override readonly name = 'ZifferNotConfigured';`,
    `}`,
    '',
    `/**`,
    ` * The engine refused the action, the hold ended without a receipt, or the receipt did not verify.`,
    ` * When the receipt is the reason, \`receiptRefusal\` names what is wrong with it (for example`,
    ` * ReceiptNotBoundToProposal) and \`receiptClause\` the rule it was refused under (9.3-3).`,
    ` */`,
    `export class ZifferRefused extends Error {`,
    `  override readonly name = 'ZifferRefused';`,
    `  readonly receiptRefusal: string | undefined;`,
    `  readonly receiptClause: string | undefined;`,
    `  constructor(readonly tool: string, readonly decision: Decision, refusal?: Refusal) {`,
    '    super(refusal === undefined',
    '      ? `ZIFFER did not allow ${tool}: decision ${decision.decision_id} ${decision.outcome ?? decision.status}${decision.refusal_category === undefined ? \'\' : ` (${decision.refusal_category})`}`',
    '      : `ZIFFER did not allow ${tool}: the receipt for decision ${decision.decision_id} did not verify. ${String(refusal)}`,',
    `      refusal === undefined ? undefined : { cause: refusal });`,
    `    this.receiptRefusal = refusal?.name;`,
    `    this.receiptClause = refusal?.clause;`,
    `  }`,
    `}`,
    '',
    `function required(variable: string): string {`,
    `  const value = process.env[variable];`,
    '  if (value === undefined || value === \'\') throw new ZifferNotConfigured(`${variable} is not set`);',
    `  return value;`,
    `}`,
    '',
    `interface ToolKeys {`,
    `  task_type: string;`,
    `  resource: string;`,
    `  schema_hash: string;`,
    `}`,
    '',
    `interface Tools {`,
    `  schema_version: string;`,
    `  tools: Map<string, ToolKeys>;`,
    `}`,
    '',
    `function isObject(v: unknown): v is Record<string, unknown> {`,
    `  return typeof v === 'object' && v !== null && !Array.isArray(v);`,
    `}`,
    '',
    `/** ${TOOLS_FILE}, read once. Absent or malformed, every call refuses: there is no default resource. */`,
    `function readTools(): Tools {`,
    `  const path = process.env['ZIFFER_TOOLS_FILE'] ?? ${q(TOOLS_FILE_DEFAULT)};`,
    `  let doc: unknown;`,
    `  try {`,
    `    doc = JSON.parse(readFileSync(path, 'utf8'));`,
    `  } catch (error) {`,
    '    throw new ZifferNotConfigured(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);',
    `  }`,
    `  const version = isObject(doc) ? doc['schema_version'] : undefined;`,
    `  const table = isObject(doc) ? doc['tools'] : undefined;`,
    '  if (typeof version !== \'string\' || !isObject(table)) throw new ZifferNotConfigured(`${path} is not a ziffer-scan tools file`);',
    `  const tools = new Map<string, ToolKeys>();`,
    `  for (const [name, entry] of Object.entries(table)) {`,
    `    if (!isObject(entry)) continue;`,
    `    const { task_type, resource, schema_hash } = entry;`,
    `    if (typeof task_type === 'string' && typeof resource === 'string' && typeof schema_hash === 'string') {`,
    `      tools.set(name, { task_type, resource, schema_hash });`,
    `    }`,
    `  }`,
    `  return { schema_version: version, tools };`,
    `}`,
    '',
    `let client: ZifferClient | undefined;`,
    `let tenant: string | undefined;`,
    `let known: Tools | undefined;`,
    `let keys: Promise<{ anchor: TrustAnchor; registry: AttesterRegistry | undefined }> | undefined;`,
    '',
    `/** The trust anchor and the approver registry, read once. A file that cannot be read refuses, by name. */`,
    `async function readKeys(): Promise<{ anchor: TrustAnchor; registry: AttesterRegistry | undefined }> {`,
    `  const registryPath = process.env['ZIFFER_ATTESTER_REGISTRY'];`,
    `  try {`,
    `    const anchor = await loadTrustAnchor(required('ZIFFER_TRUST_ANCHOR'), required('ZIFFER_SUITE_FLOOR'));`,
    `    const registry = registryPath === undefined || registryPath === '' ? undefined : await loadAttesterRegistry(registryPath);`,
    `    return { anchor, registry };`,
    `  } catch (error) {`,
    `    if (error instanceof AnchorError) throw new ZifferNotConfigured(error.message, { cause: error });`,
    `    throw error;`,
    `  }`,
    `}`,
    '',
    `async function verifierKeys(): Promise<{ anchor: TrustAnchor; registry: AttesterRegistry | undefined }> {`,
    `  keys ??= readKeys();`,
    `  try {`,
    `    return await keys;`,
    `  } catch (error) {`,
    `    keys = undefined; // read again at the next call, once the file is fixed`,
    `    throw error;`,
    `  }`,
    `}`,
    '',
    `/**`,
    ` * The approvers a held action's receipt is checked against: your registry, and the policy version the`,
    ` * receipt names. The registry file does not carry the version, so it is read from the receipt's own`,
    ` * signed body: this proves the approvals and the receipt name one policy version, not that it is your`,
    ` * latest one (the Python SDK checks the same). A receipt that names none refuses.`,
    ` */`,
    `function approversFor(registry: AttesterRegistry, receipt: unknown): QuorumPolicy {`,
    `  const hash = isObject(receipt) ? receipt['policy_bundle_hash'] : undefined;`,
    `  const epoch = isObject(receipt) ? receipt['bundle_epoch'] : undefined;`,
    `  return {`,
    `    ...registry,`,
    `    policyBundleHash: typeof hash === 'string' ? hash : '',`,
    `    bundleEpoch: typeof epoch === 'number' ? epoch : -1,`,
    `  };`,
    `}`,
    '',
    `function zifferClient(): ZifferClient {`,
    `  client ??= new ZifferClient(required('ZIFFER_API_URL'), required('ZIFFER_API_KEY'));`,
    `  return client;`,
    `}`,
    '',
    `/** A value as canonical JSON: object keys sorted, arrays in order. */`,
    `function canonical(value: unknown): string {`,
    `  if (Array.isArray(value)) return \`[\${value.map(canonical).join(',')}]\`;`,
    `  if (isObject(value)) {`,
    `    const keys = Object.keys(value).sort();`,
    `    return \`{\${keys.map((k) => \`\${JSON.stringify(k)}:\${canonical(value[k])}\`).join(',')}}\`;`,
    `  }`,
    `  return JSON.stringify(value) ?? 'null';`,
    `}`,
    '',
    `/**`,
    ` * The call's parameters in the wire's value domain, a string or an integer. Every other value (a`,
    ` * fractional amount, a boolean, an object, a list) travels as its canonical JSON string: the engine`,
    ` * grades the tool and its grammar, not the value's type, and the draft policy's schema was drafted`,
    ` * with these parameters as strings. A rule over one of them reads that string.`,
    ` */`,
    `export function zifferParams(input: unknown): Record<string, string | number> {`,
    `  if (input === undefined || input === null) return {};`,
    `  if (!isObject(input)) return { input: canonical(input) };`,
    `  const out: Record<string, string | number> = {};`,
    `  for (const [key, value] of Object.entries(input)) {`,
    `    out[key] = typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)) ? value : canonical(value);`,
    `  }`,
    `  return out;`,
    `}`,
    '',
    ...(ctx === null
      ? []
      : [
          `/**`,
          ` * The operator of a proposal: the person on whose behalf the model acts, read from ${d?.name ?? 'the dispatcher'}'s ${ctx}.`,
          ` * Which field of ${ctx} identifies the signed-in person is yours to choose; until you choose, this returns`,
          ` * the application's name and every proposal names the application, not a person.`,
          ` */`,
          `export function ${OPERATOR_OF}(${ctx}: unknown): string {`,
          `  // e.g. if (isObject(${ctx}) && typeof ${ctx}['userId'] === 'string') return ${ctx}['userId'];`,
          `  void ${ctx};`,
          `  return OPERATOR;`,
          `}`,
          '',
        ]),
    `/** Propose the tool call to ZIFFER, on behalf of \`operator\`, and return only when it may run. */`,
    `export async function ${GATE}(name: string, input: unknown, operator: string = OPERATOR): Promise<void> {`,
    `  known ??= readTools();`,
    `  const { anchor, registry } = await verifierKeys();`,
    `  const keys = known.tools.get(name);`,
    '  if (keys === undefined) throw new ZifferNotConfigured(`${name} is not in the tools file: re-run ziffer-scan --code and sign the draft it writes`);',
    `  const api = zifferClient();`,
    `  tenant ??= (await api.whoami()).tenant_id;`,
    `  const proposal: WireProposal = {`,
    `    schema_id: keys.resource,`,
    `    schema_version: known.schema_version,`,
    `    schema_hash: keys.schema_hash,`,
    `    fidelity: FIDELITY,`,
    `    tenant_id: tenant,`,
    `    payload: {`,
    `      task_type: keys.task_type,`,
    `      operator,`,
    `      targets: [keys.resource],`,
    `      params: zifferParams(input),`,
    `      cidrs: {},`,
    `    },`,
    `  };`,
    `  const submitted = await api.propose(proposal);`,
    `  // Returns once the receipt is readable, or refused; a held action waits here for a person, and`,
    `  // throws WaitTimeout after HOLD_LIMIT_MS. It never proposes again: a second proposal is a second action.`,
    `  const decision = await api.waitForReceipt(submitted.decision_id, { timeoutMs: HOLD_LIMIT_MS, intervalMs: POLL_MS });`,
    `  if (decision.receipt === undefined) throw new ZifferRefused(name, decision);`,
    `  // The receipt is checked against the exact bytes propose() sent: JSON.stringify of this same object.`,
    `  const quorum = registry === undefined ? undefined : approversFor(registry, decision.receipt);`,
    `  try {`,
    `    verifyReceipt(decision.receipt, new TextEncoder().encode(JSON.stringify(proposal)), quorum === undefined ? anchor : { ...anchor, quorum });`,
    `  } catch (error) {`,
    `    if (error instanceof Refusal) throw new ZifferRefused(name, decision, error);`,
    `    throw error;`,
    `  }`,
    `}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- grading

/** The keys `reversibility.json` lists, read from the member the engine graded against. */
function reversibilityKeys(policy: Policy): Set<string> {
  const doc = policy.reversibility;
  const table = isRecord(doc) ? doc['reversibility'] : undefined;
  return new Set(isRecord(table) ? Object.keys(table) : []);
}

/** The keyword data the classifier read: `irreversible_class` is looked up in it, never retyped here. */
let keywordData: KeywordData | undefined;
function keywords(): KeywordData {
  keywordData ??= parseKeywords(readDataFile('keywords.json'), words);
  return keywordData;
}

/** The keywords a classification matched under one data-file key (`untrusted_input:message` -> `message`). */
export function matchedUnder(c: Pick<Classification, 'matched'>, key: string): string[] {
  const prefix = `${key}:`;
  return [...new Set(c.matched.filter((m) => m.startsWith(prefix)).map((m) => m.slice(prefix.length)))];
}

/**
 * The highest `irreversible_class` among the irreversible keywords the draft matched as the
 * tool's own action, as the classifier's `effectClass` ranks the replay's own case; undefined
 * when the draft did not read the tool as irreversible.
 */
export function irreversibleClass(c: Pick<Classification, 'effect' | 'matched'>): 1 | 2 | 3 | undefined {
  if (c.effect !== 'irreversible') return undefined;
  const table = keywords().irreversible_class;
  let best = 0;
  for (const k of matchedUnder(c, 'effect.irreversible')) best = Math.max(best, table[k] ?? 0);
  return best === 3 ? 3 : best === 2 ? 2 : best === 1 ? 1 : undefined;
}

/** The code half's catalog rows and the classifier's drafts for them. The classifier's findings are not kept: a code tool's reading is in its verdict. */
export interface CodeDrafts {
  rows: CatalogTool[];
  classifications: Classification[];
  /** Parallel to `rows`: what the description and the tool list say about undoing each tool. Read by no draft. */
  hints: UndoHint[][];
  /** Parallel to `rows`: the tool whose draft this one was raised to at least (`CodeToolVerdict.raised_by`), when it runs one. */
  raisedBy: (string | undefined)[];
}

const EFFECTS: readonly Classification['effect'][] = ['read', 'write', 'irreversible'];

/** Stricter first: effect, then egress. The order a raise may only climb. */
function strictness(c: Pick<Classification, 'effect' | 'egress'>): number {
  return EFFECTS.indexOf(c.effect) * 2 + (c.egress ? 1 : 0);
}

/** The ANY tool a computed-name call may run. */
export const ANY_TOOL = '*';

/**
 * A tool that runs another tool unseen (`CodeTool.calls`) is drafted at least as strictly as
 * it (ACP-455): a ZIFFER call at the dispatcher decides the outer tool and never sees the inner
 * one, so the outer decision is the only one the inner action gets. Effect and egress each
 * climb to the inner tool's, never fall. A call with no name (a lookup by a computed name) may
 * run ANY tool: the strictest drafted tool in the catalog is taken, `raised_by: '*'`. A named
 * tool the catalog does not hold is read the same way: the draft cannot grade what it cannot
 * find. Repeated to a fixed point, so a tool running a tool that runs a third is raised to the
 * third. A catalog with no `calls` is returned untouched, the same objects.
 */
export function raiseCallers(tools: readonly CodeTool[], classifications: readonly Classification[]): { classifications: Classification[]; raisedBy: (string | undefined)[] } {
  const out = [...classifications];
  const raisedBy: (string | undefined)[] = tools.map(() => undefined);
  if (!tools.some((t) => (t.calls ?? []).length > 0)) return { classifications: out, raisedBy };
  const byName = new Map<string, number[]>();
  for (const [i, t] of tools.entries()) byName.set(t.name, [...(byName.get(t.name) ?? []), i]);
  const reasons: string[][] = tools.map(() => []);
  for (let round = 0; round <= tools.length; round += 1) {
    let changed = false;
    for (const [i, t] of tools.entries()) {
      const calls = t.calls ?? [];
      const own = out[i];
      if (calls.length === 0 || own === undefined) continue;
      // The strictest inner tool of this tool's calls, and the name it is raised by.
      let best: { c: Classification; by: string; reason: string } | undefined;
      for (const call of calls) {
        const named = call.tool === undefined ? undefined : byName.get(call.tool);
        const candidates = named ?? out.map((_, k) => k);
        const by = named === undefined ? ANY_TOOL : (call.tool ?? ANY_TOOL);
        const reason = by === ANY_TOOL ? 'runs a tool chosen at run time' : `also runs ${by}`;
        for (const k of candidates) {
          const c = out[k];
          if (c === undefined || k === i) continue;
          if (best === undefined || strictness(c) > strictness(best.c)) best = { c, by, reason };
        }
      }
      if (best === undefined) continue;
      raisedBy[i] = best.by;
      reasons[i] = [best.reason];
      const effect = EFFECTS.indexOf(best.c.effect) > EFFECTS.indexOf(own.effect) ? best.c.effect : own.effect;
      const egress = own.egress || best.c.egress;
      if (effect !== own.effect || egress !== own.egress) {
        out[i] = { ...own, effect, egress };
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const [i, c] of out.entries()) {
    const extra = reasons[i] ?? [];
    if (c === undefined || extra.length === 0) continue;
    const prior = classifications[i]?.reason;
    out[i] = { ...c, reason: [...(prior === undefined ? [] : [prior]), ...extra].join('; ') };
  }
  return { classifications: out, raisedBy };
}

export function codeDrafts(catalog: CodeCatalog): CodeDrafts {
  const rows = catalogTools(catalog);
  const raised = raiseCallers(catalog.tools, classify(rows).classifications);
  return { rows, classifications: raised.classifications, hints: undoHints(rows), raisedBy: raised.raisedBy };
}

/**
 * The pairs of `data/pairs.json` among the application's own tools (2026-09-28), by the installed
 * half's pair logic (`pairsAmong`) over the same drafts the policy was written from. By TOOL
 * NAMES only: a code tool's server is `<application>/<tool>`, a resource the draft invents, and the
 * application's own name is not a word of any tool (an application named for mail would otherwise
 * put every read on the mail side).
 */
export function codePairs(catalog: CodeCatalog): ToolPair[] {
  const d = codeDrafts(catalog);
  return pairsAmong(
    d.rows.map((r) => ({ ...r, server: '' })),
    d.classifications,
  );
}

/**
 * The data-leaving pairs a `CodeSection` carries (2026-09-28): the pairs of `codePairs` whose rule's
 * second side asks for a tool that sends data out, one per (reader, sender), in `codePairs`' order.
 * The ONE place they are computed: the page, the JSON, the terminal and the MCP text read the field.
 * `same_path` names the caller whose `offered` list holds both tools, when one does.
 */
export function dataLeavingPairs(catalog: CodeCatalog): CodePair[] {
  const offered = catalog.dispatchers.flatMap((d) => d.caller_checks ?? []).filter((c) => c.offered !== undefined && c.offered.length > 0);
  const seen = new Set<string>();
  const out: CodePair[] = [];
  for (const p of codePairs(catalog)) {
    if (!p.egress) continue;
    const key = `${p.reader}\u0000${p.sender}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const both = offered.find((c) => (c.offered ?? []).includes(p.reader) && (c.offered ?? []).includes(p.sender));
    out.push({
      id: p.rule,
      why: p.why,
      reader: p.reader,
      sender: p.sender,
      basis: p.reads === '' ? 'its draft reads it as a read' : `name says "${p.reads}"`,
      ...(both === undefined ? {} : { same_path: both.in_function }),
    });
  }
  return out;
}

/**
 * Grade the code half against a GIVEN draft policy: the engine's verdict per
 * tool, the insertion and its snippet, and `ziffer-tools.json`. The policy is
 * the one the run writes and the customer signs; when the run also read the
 * installed tools it names them too, and `draft` is read from that same bundle,
 * so every verdict here is made against the policy on disk. Writes nothing.
 */
export async function gradeAgainst(
  catalog: CodeCatalog,
  drafts: CodeDrafts,
  bundle: GeneratedBundle,
  draft: DraftPolicy,
  engine: Engine,
): Promise<{ section: CodeSection; toolsFile: CodeToolsFile }> {
  const tools = drafts.rows;
  const reasons = new Map<string, string>();
  for (const c of drafts.classifications) if (c.reason !== undefined) reasons.set(toolId(c.server, c.tool), c.reason);
  const drafted = new Map<string, Classification>();
  for (const c of drafts.classifications) drafted.set(toolId(c.server, c.tool), c);
  const listed = reversibilityKeys(draft.policy);

  const table: Record<string, CodeToolKeys> = {};
  const verdicts: CodeToolVerdict[] = [];
  for (const [i, t] of catalog.tools.entries()) {
    const row = tools[i];
    if (row === undefined) throw new CodeEngineFailed(`no catalog row for "${t.name}"`);
    const key = toolKey(bundle, row);
    const resource = serverKey(bundle, row.server);
    const schemaHash = draft.grammar.schema_hashes[resource];
    if (schemaHash === undefined) throw new CodeEngineFailed(`the draft grammar has no schema hash for "${resource}"`);
    table[t.name] ??= { task_type: key, resource, schema_hash: schemaHash };

    const verdict = await verdictOf(engine, draft, codeProposal(bundle, draft, row), t.name);
    const c = drafted.get(toolId(row.server, row.tool));
    const v: CodeToolVerdict = {
      tool: t,
      verdict,
      what_ziffer_does: whatZifferDoesUnder(verdict, listed.has(key)),
      untrusted_input: c?.untrusted_input ?? false,
      egress: c?.egress ?? false,
    };
    const reason = reasons.get(toolId(row.server, row.tool));
    if (reason !== undefined) v.draft_reason = reason;
    if (c !== undefined) {
      const heard = matchedUnder(c, 'untrusted_input');
      if (c.untrusted_input && heard.length > 0) v.untrusted_words = heard;
      const cls = irreversibleClass(c);
      if (cls !== undefined) v.irreversible_class = cls;
      // The access value the name or a parameter names: a property of the data, set for a read and a write alike.
      const secret = matchedUnder(c, 'sensitive_values')[0];
      if (secret !== undefined) v.sensitive_value = secret;
    }
    if (key !== t.name) v.key = key;
    // The installed half's patterns and matcher, on the application's own description.
    const said = instructionHits(t.description, { file: false });
    if (said.length > 0) v.instruction_hits = said;
    const hints = drafts.hints[i] ?? [];
    if (hints.length > 0) v.undo_hints = hints;
    const by = drafts.raisedBy[i];
    if (by !== undefined) v.raised_by = by;
    verdicts.push(v);
  }

  const app = applicationId(catalog);
  const dispatcher = chooseDispatcher(catalog.dispatchers);
  const shape = { dispatcher, per_tool: dispatcher === null };
  const insertion: Insertion = {
    ...shape,
    sentence: sentenceFor(dispatcher, catalog.tools),
    snippet: snippetFor(shape, app, draft.grammar.fidelity, catalog.tools),
    snippet_language: 'typescript',
    call: insertionCall(shape, catalog.tools[0]?.name),
  };

  return {
    section: { catalog, verdicts, insertion, pairs: dataLeavingPairs(catalog), counts: countsOf(verdicts) },
    toolsFile: {
      note:
        'Written by ziffer-scan beside the draft policy: each tool as the draft names it. ' +
        `${GATE_FILE}.ts reads it at startup and refuses every call when it is absent. Re-run the scan when a tool changes.`,
      schema_version: draft.grammar.schema_version,
      tools: table,
    },
  };
}
