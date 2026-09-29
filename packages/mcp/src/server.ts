/**
 * The MCP surface: twenty-one tools, their schemas, and the three guided flows
 * registered as prompts beside them (ACP-467; `prompts.ts`) (ACP-197
 * section 6b; ACP-213 section 9.2 added `sandbox_status`; ACP-389 added the
 * three that serve the policy repository; ACP-390 added the five that carry a
 * developer from nothing to a verified receipt; ACP-391 added the three that
 * answer who the key is and run the grader over a draft tree; ACP-392 added the
 * three that learn and feed back; ACP-446 added `scan`; ACP-455 taught it the
 * codebase and added `explain_scan_finding`).
 *
 * This module is the adapter between the protocol and the handlers. It owns the
 * tool names, the argument schemas and the content framing; it owns no
 * behaviour. Anything a test would want to assert about what a tool DOES is one
 * file over, called directly.
 *
 * # What this server does on the developer's machine, exactly
 *
 * It writes nothing and it approves nothing. Those two are the boundary and
 * neither has moved: there is no approve tool, no simulated approval, and no
 * code path in this package that creates, edits or deletes a file —
 * `sandbox_status` REPORTS, and the sandbox's approvals are made by a service
 * inside the deployment under keys this machine does not hold.
 *
 * ACP-390 widened the READING half again and not the writing one:
 * `check_integration` opens the source files under a path the caller names and
 * reads them as text. It runs nothing, and `integration-check.ts` states that
 * boundary where the code is.
 * ACP-392 moved the boundary a SECOND time and in the other direction, so it
 * is written here rather than found: `send_feedback` SENDS TEXT A MODEL WROTE
 * TO US. Every other outward call in this package carries a Proposal the
 * developer's own code assembled; this one carries a sentence about their
 * work, to be read by a person. It is one route, it is named in the tool's
 * description and again in its answer, and there is nothing else in this
 * package that posts anything anywhere.
 *
 * What DID move, with ACP-389, is that it now reads. `check_policy_repo` opens
 * files under a path the caller names and runs `ziffer list` and `ziffer decide
 * --unsigned` — the two keyless, read-only subcommands the customer's own pull
 * request workflow runs — through `execFile` and never a shell. Until then
 * `tools.ts` could say the server had no hands on the machine at all, and that
 * sentence is now true of the five tools it describes rather than of this
 * server. `repo-check.ts` states the narrowed boundary where the code is, and
 * `README.md` states it to the developer.
 *
 * ACP-391 moved it once more, by exactly one directory and no further:
 * `simulate_decision` has to hand the CLI a FILE, because `--proposal` takes a
 * path, so it writes one into a fresh `mkdtemp` directory and removes it. It
 * never writes inside the tree it was pointed at, and neither does
 * `explain_policy` — a tool that dropped an example into a customer's
 * `policy/examples/` would be committing policy on their behalf. `decide.ts`
 * states that boundary where the code is.
 *
 * ACP-446 moved it furthest, and in both halves, so it is written here first:
 * `scan` STARTS PROGRAMS and WRITES A FOLDER. It runs `@ziffer-io/scan` in
 * process, which starts the MCP servers the developer's AI agent clients are
 * configured to start, asks each for its tool list, and writes a draft agent
 * authorization policy. It does the first only when called with
 * `confirm: true`, after a first call that returned the list of what would be
 * started and started nothing; it writes into a fresh directory under the
 * system temporary directory unless told where. Nothing it does leaves the
 * machine. `scan.ts` states that boundary where the code is. Every sentence
 * above that says this server writes nothing is now true of every tool but
 * that one.
 *
 * ACP-455 widened `scan`'s READING half and not its starting half: it also
 * reads the source of the project the agent works in (the `cwd` argument, or
 * the client's first root) and grades every tool that code gives a model.
 * That part starts no tool server (to read Python it runs this machine's own
 * Python on the reader shipped in the package), so it needs no confirmation; it writes its draft
 * policy, report and `ziffer-tools.json` into its own fresh temporary
 * directory, never into the project. The confirmed call is ONE run over both
 * halves, one draft policy, as `npx @ziffer-io/scan` does. `scan-code.ts`
 * states that boundary.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { zifferClientFactory } from './client.js';
import { VARS, type Env } from './config.js';
import { simulateDecision } from './decide.js';
import { LANGUAGES } from './guide.js';
import { checkIntegrationTool } from './integration-check.js';
import { lintProposal } from './proposal-lint.js';
import { DEFAULT_LIMIT, MAX_LIMIT, searchDocs } from './docs.js';
import { ONBOARDING_DOCS } from './generated/docs-source.js';
import { explainPolicyTool } from './policy-explain.js';
import { explainPublishFailure } from './publish-explain.js';
import { explainRefusal } from './refusals.js';
import { checkPolicyRepoTool } from './repo-check.js';
import { policyRepoGuide } from './repo-guide.js';
import { SCAN_DEFAULT_TIMEOUT_SECONDS, scanTool, type ScanSetup } from './scan.js';
import type { CodebaseScan } from './scan-code.js';
import { explainScanFinding } from './scan-explain.js';
import { DOCS } from './scan-remedy.js';
import { nextLine } from './next.js';
import { PROMPT_ARGS, PROMPT_NAMES, PROMPTS } from './prompts.js';
import { getStarted } from './started.js';
import {
  checkDecision,
  explainReceipt,
  getDecision,
  getIntegrationGuide,
  listDecisions,
  propose,
  sandboxStatus,
  sendFeedback,
  whoami,
  type ClientFactory,
  type ToolOutcome,
} from './tools.js';

/** The version this package's manifest declares, read from the one place it is
 * declared. `SERVER_INFO` carried a literal `'0.0.0'` through two releases and
 * nothing read it back against the manifest, so every MCP client that showed the
 * server's version showed a version nobody published. A literal here would be a
 * second declaration of the package version, and `tools/release-npm.sh` already
 * checks that the four manifests agree; a fifth copy in source is what it cannot
 * see. `createRequire` rather than a JSON import because `package.json` sits
 * outside `rootDir` and the manifest ships in every tarball regardless of
 * `files`, so `dist/../package.json` resolves in the checkout and under `npx`. */
function manifestVersion(manifest: unknown): string {
  if (
    typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string' &&
    manifest.version !== ''
  ) {
    return manifest.version;
  }
  throw new Error('packages/mcp/package.json declares no string "version"; the server will not report one it does not have');
}

/** The name and version an MCP client sees. */
export const SERVER_INFO = {
  name: 'ziffer',
  version: manifestVersion(createRequire(import.meta.url)('../package.json')),
} as const;

/** Every tool this server registers, named once so the tests assert the set
 * rather than a list retyped beside it. A tool added here without a test is
 * visible as a diff on this constant. */
export const TOOL_NAMES = [
  'get_started',
  'scan',
  'explain_scan_finding',
  'check_integration',
  'lint_proposal',
  'get_decision',
  'list_decisions',
  'propose',
  'check_decision',
  'get_integration_guide',
  'explain_receipt',
  'sandbox_status',
  'get_policy_repo_guide',
  'check_policy_repo',
  'explain_publish_failure',
  'search_docs',
  'explain_refusal',
  'send_feedback',
  'whoami',
  'explain_policy',
  'simulate_decision',
] as const;

/** One registered tool's name. */
export type ToolName = (typeof TOOL_NAMES)[number];

/** What `createServer` needs, injectable so tests drive it without a process. */
export interface ServerDeps {
  /** The environment. A parameter, never `process.env` read in here: this
   * module would otherwise be the second reader of the environment that
   * `config.ts` exists to be the only one of. */
  readonly env: Env;
  /** How to reach the gateway. Injected so a test can supply a stub client. */
  readonly clientFor: ClientFactory;
  /** Where `scan` looks: this process's home and working directory unless a
   * test points it at a fixture home. The environment is `env` above, never
   * read a second time. */
  readonly scan?: Omit<ScanSetup, 'env'>;
}

/**
 * The MCP client's first `file:` root, when it offers roots at all. A client
 * that does not is answered by the tool's `cwd` argument instead; a failure to
 * list is the same as no roots, never a guess at this process's directory,
 * which under `npx` is wherever the client happened to start the server.
 */
async function firstRoot(server: McpServer): Promise<string | undefined> {
  if (server.server.getClientCapabilities()?.roots === undefined) return undefined;
  try {
    const { roots } = await server.server.listRoots();
    const root = roots.find((r) => r.uri.startsWith('file:'));
    return root === undefined ? undefined : fileURLToPath(root.uri);
  } catch {
    return undefined;
  }
}

/** A text answer and the same answer as data: the agent reads the text first,
 * and the JSON is also sent as a second text block for a client that shows no
 * structured content, as the protocol asks. */
function structuredReply(
  tool: ToolName,
  outcome: ToolOutcome,
  structured: Record<string, unknown>,
): { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown>; isError: boolean } {
  return {
    content: [
      { type: 'text', text: outcome.text },
      { type: 'text', text: JSON.stringify(structured, null, 2) },
      ...nextBlock(tool, outcome),
    ],
    structuredContent: structured,
    isError: outcome.isError,
  };
}

/** A prompt's answer: one user message carrying the script. */
function promptReply(
  description: string,
  text: string,
): { description: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] } {
  return { description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}

/** The answer's last block: its next step ({@link nextLine}), so a developer
 * is never left to know which tool comes after this one. */
function nextBlock(tool: ToolName, outcome: ToolOutcome): { type: 'text'; text: string }[] {
  const line = nextLine(tool, outcome);
  return line === undefined ? [] : [{ type: 'text', text: line }];
}

/** MCP's content shape, from one place, so no handler assembles it by hand:
 * the tool's answer as it came, then its next step. */
function reply(tool: ToolName, outcome: ToolOutcome): {
  content: { type: 'text'; text: string }[];
  isError: boolean;
} {
  return { content: [{ type: 'text', text: outcome.text }, ...nextBlock(tool, outcome)], isError: outcome.isError };
}

/**
 * Build the server with its twenty-one tools registered.
 *
 * Descriptions are written for a model, so each one says what the tool does AND
 * the thing a model would otherwise assume. `propose` says the tenant comes
 * from the key; `explain_receipt` says key order does NOT matter, because a
 * model told only "canonical bytes" will invent a canonicaliser it does not
 * need. A description that only names the happy path is a description that
 * gets the argument wrong.
 */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'get_started',
    {
      title: 'Set up ZIFFER in this project, from nothing to a verified receipt',
      description:
        'Call this FIRST when a developer wants to add ZIFFER and nothing exists yet. It is the entry point ' +
        'of the setup_ziffer prompt and returns its steps in order: the scan, the one change in the code with ' +
        'the install command for each language at the version ZIFFER publishes, the policy repository, the ' +
        'pipeline, how to get the API key and what comes with it, the first proposal, and the verified ' +
        'receipt. Needs no configuration and takes no arguments, so it answers before any key exists.',
      inputSchema: {},
    },
    () => reply('get_started', getStarted()),
  );

  // The last codebase scan of this session, for `explain_scan_finding`. Held
  // in memory only: the findings are about the developer's own code, and a
  // second call should explain the scan the agent just showed them.
  let lastCodebase: CodebaseScan | undefined;

  server.registerTool(
    'scan',
    {
      title: 'Scan this codebase and this machine: what a model can run, and the one fix',
      description:
        'Step zero of get_started. Reads the project in cwd (or the client\'s first root) and finds every tool the ' +
        'application\'s code gives a model (TypeScript and Python), where it is exposed and the dispatcher they run ' +
        'through; the ZIFFER engine grades each under a draft policy the scan writes (signed by a key made for this ' +
        'run and discarded). Reading code starts no tool server (to read Python it runs this machine\'s own Python on the reader shipped in the package), so the codebase result comes back on the FIRST call. With ' +
        'include_installed (default true) it also covers the MCP servers the AI agent clients on this machine start; ' +
        'that part STARTS PROGRAMS, so without confirm it starts NOTHING and lists what it would start (credentials ' +
        'redacted) — show that list, and call again with confirm: true only once the developer agrees. Nothing leaves ' +
        'this machine and no model is asked anything. The same scan runs as npx @ziffer-io/scan. ' +
        'PRESENT IT: lead with the numbers and the held or notified irreversible tools, then the ONE fix in ' +
        'remediation: the finding is that the model holds the authority to run these tools directly; the remedy is to ' +
        'remove that authority from the model path and route every call through ZIFFER — add the call line at the top ' +
        'of the dispatcher (file:line in the result), save the snippet module beside it, deploy ziffer-tools.json, ' +
        `then review, sign and publish the draft policy (${DOCS.quickstart}, ${DOCS.sdk}). You may offer to make ` +
        'that change with the developer\'s approval. NOT a fix: prompt filters, output classifiers, asking the model ' +
        'to be careful, model-side guardrails, or requires_confirmation-style flags in the application\'s own code — ' +
        'the architecture assumes the model is manipulable and the guarantee must not depend on it (§5.1a). The ' +
        'verdicts are the engine\'s under a draft, never yours: do not re-grade tools; explain_scan_finding says why ' +
        'the engine decided each one.',
      inputSchema: {
        cwd: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The project directory you are working in, absolute. Required when this MCP client offers no roots; ' +
              'otherwise the client\'s first root is read.',
          ),
        include_installed: z
          .boolean()
          .optional()
          .describe(
            'Default true: also scan the MCP servers the AI agent clients on this machine start, behind the ' +
              'two-call confirmation. false scans the codebase only, in one call.',
          ),
        report: z
          .boolean()
          .optional()
          .describe(
            'Default true: also write the forwardable HTML report and the review archive and return their paths. ' +
              'A confirmed scan of the installed servers always writes them: its result is read back from beside them.',
          ),
        confirm: z
          .boolean()
          .optional()
          .describe(
            'true starts the servers the first call listed. Leave it out on the first call, and set ' +
              'it only after the developer has seen that list and agreed.',
          ),
        out: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Where the confirmed scan writes its ONE draft policy folder (codebase and installed servers together). ' +
              'It must not exist yet. Default: a fresh directory under the system temporary directory, named ' +
              'ziffer-policy-<date>. A codebase-only scan (the first call, or include_installed false) always goes ' +
              'into its own fresh temporary directory, never into the project.',
          ),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(99999)
          .optional()
          .describe(
            `Seconds each server has to start and list its tools (default ${SCAN_DEFAULT_TIMEOUT_SECONDS}). A server fetched by ` +
              'npx or uvx can need longer the first time.',
          ),
      },
    },
    async ({ cwd, include_installed, report, confirm, out, timeout_seconds }) => {
      const root = cwd === undefined ? await firstRoot(server) : resolve(cwd);
      const outcome = await scanTool(
        { env: deps.env, ...deps.scan },
        { root, include_installed, report, confirm, out, timeout_seconds },
      );
      if (outcome.codebase !== undefined) lastCodebase = outcome.codebase;
      return structuredReply('scan', outcome, outcome.structured);
    },
  );

  server.registerTool(
    'explain_scan_finding',
    {
      title: 'Why the engine decided what it did about one tool from the last scan, and the fix',
      description:
        'Takes one tool name from the last scan\'s codebase result and returns the engine\'s verdict for it (risk, ' +
        'reversibility, effective tier), the draft policy member and entry it came from, each linked to its section ' +
        `of ${DOCS.byExample}, how to change the verdict (edit the draft policy, not the code), and the same one fix ` +
        'the scan gives: remove the model\'s authority to run the tool and route every call through ZIFFER. It grades ' +
        'nothing itself and neither should you: the verdict is the engine\'s. It also accepts a caller of the dispatcher, by its ' +
        'function name or its file:line, and says what the source shows before that call (a confirmation check found, or none ' +
        'found); and for a tool that runs another tool without passing the dispatcher, it explains that path, which a ZIFFER call ' +
        'at the dispatcher does not see. A tool whose description carries instruction-like text gets that text quoted with the fix. ' +
        'It also accepts the path of a skill or instruction file the scan read (skills.files[].path): what it declares, what it can do, and where. Call scan first.',
      inputSchema: {
        tool: z.string().min(1).describe('The tool name exactly as the scan result lists it (tools[].name), or its policy_key, or a skill file path (skills.files[].path).'),
      },
    },
    ({ tool }) => {
      const outcome = explainScanFinding(lastCodebase, tool);
      return structuredReply('explain_scan_finding', outcome, outcome.structured);
    },
  );

  server.registerTool(
    'check_integration',
    {
      title: 'Check a repository for propose calls with no verify beside them',
      description:
        'Read the source under a path and report, per propose call site (file:line), whether a ' +
        'verify runs in the same function over the same proposal. This is the one thing worth ' +
        'checking in integration code: the verify line is what enforces anything, and deleting it ' +
        'leaves an integration that still appears to work. It READS ONLY — it writes nothing, runs ' +
        'nothing and opens no connection. A FAIL is this tool having looked, not an error. It is a ' +
        'text scan: a verify in a helper the handler calls, in another file, or over bytes it ' +
        'cannot match to this proposal is reported NOT CHECKED, which never means PASS.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Path to the repository, or the directory holding your agent's tool handlers."),
      },
    },
    async ({ path }) => reply('check_integration', await checkIntegrationTool(path)),
  );

  server.registerTool(
    'lint_proposal',
    {
      title: 'Validate a proposal against the wire schema, locally',
      description:
        'Check one proposal object against the published wire Proposal schema and name the bad ' +
        'field, before any call is made. No network, no configuration, no key. Every property at ' +
        'both levels is required and both objects are closed: `params` and `cidrs` are EMPTY ' +
        'objects when an action has none, never absent, because an optional field would give one ' +
        'action two encodings and therefore two hashes. A PASS here is about SHAPE only — it says ' +
        'nothing about whether the schema triple is registered, whether the tenant is your key\'s, ' +
        'or what the decision will be.',
      inputSchema: {
        proposal: z
          .record(z.string(), z.unknown())
          .describe('The wire Proposal object to check. Passed to the schema untouched and sent nowhere.'),
      },
    },
    ({ proposal }) => reply('lint_proposal', lintProposal(proposal)),
  );

  server.registerTool(
    'get_decision',
    {
      title: 'Fetch a decision and verify its receipt',
      description:
        'Return one decision AND verify its receipt under the configured trust anchor before you ' +
        'see it: a receipt that comes out of this tool is a verified receipt, or you get the ' +
        'refusal by name, with the rule that refused it. Pass proposal_b64 — the verifier recomputes the binding ' +
        'from the bytes YOUR code hashed, never from the receipt\'s own claim, so without them ' +
        'there is nothing to verify and the receipt is WITHHELD rather than handed back ' +
        'unchecked. check_decision is the same fetch served verbatim and unverified.',
      inputSchema: {
        decision_id: z.string().min(1).describe('The decision_id returned by propose.'),
        proposal_b64: z
          .string()
          .optional()
          .describe(
            'Base64 of the proposal bytes the receipt should be bound to (any JSON spelling — the ' +
              'verifier canonicalises them itself). Omit it and the receipt is withheld.',
          ),
      },
    },
    async ({ decision_id, proposal_b64 }) =>
      reply('get_decision',
        await getDecision(deps.clientFor, deps.env, {
          decisionId: decision_id,
          // exactOptionalPropertyTypes, as in explain_receipt: an omitted
          // argument must be an ABSENT property, not one holding undefined.
          ...(proposal_b64 === undefined ? {} : { proposalB64: proposal_b64 }),
        }),
      ),
  );

  server.registerTool(
    'list_decisions',
    {
      title: 'List the decisions for this key',
      description:
        'Every decision in the window and every request still waiting for approval (with when its ' +
        'hold ends), newest first. The tenant is the API key\'s and cannot be named any other ' +
        'way. A row carries no clause and no receipt document, deliberately: the list answers ' +
        'WHAT was decided and never WHY, and receipts are served by get_decision alone. Every bad ' +
        'parameter is one refusal, ListQueryMalformed, which does not say which parameter.',
      inputSchema: {
        since: z
          .string()
          .optional()
          .describe(
            'Strict RFC 3339 UTC, exactly 2026-09-21T18:00:00Z — no offset, no fraction, no ' +
              'lowercase z. Default: 24 hours ago. May not reach back more than 730 days.',
          ),
        limit: z.number().int().optional().describe('1..200. Default 50.'),
        cursor: z
          .string()
          .optional()
          .describe('next_cursor from a previous page, handed back unchanged. It is opaque; do not build one.'),
      },
    },
    async ({ since, limit, cursor }) =>
      reply('list_decisions',
        await listDecisions(deps.clientFor, deps.env, {
          ...(since === undefined ? {} : { since }),
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
  );

  server.registerTool(
    'propose',
    {
      title: 'Propose an action to Ziffer',
      description:
        'Submit one wire Proposal for a decision and return the gateway response verbatim ' +
        '(decision_id, status, and outcome/clause when already decided). The tenant comes ' +
        `from ${VARS.API_KEY}: do not add or change tenant_id to match something else, as a ` +
        'mismatched tenant_id is refused (TenantMismatch), never rewritten. The receipt is ' +
        'never in this response — fetch it with check_decision.',
      inputSchema: {
        proposal: z
          .record(z.string(), z.unknown())
          .describe(
            'The wire Proposal object: schema_id, schema_version, schema_hash, fidelity, ' +
              'tenant_id, payload. Passed through untouched.',
          ),
      },
    },
    async ({ proposal }) => reply('propose', await propose(deps.clientFor, deps.env, proposal)),
  );

  server.registerTool(
    'check_decision',
    {
      title: 'Fetch a decision by id',
      description:
        'Return the decision for one decision_id, verbatim, including the signed receipt ' +
        'when one exists. Poll this while status is "pending". An id belonging to another ' +
        'tenant reads as unknown (DecisionUnknown): existence is tenant-scoped.',
      inputSchema: {
        decision_id: z.string().min(1).describe('The decision_id returned by propose.'),
      },
    },
    async ({ decision_id }) => reply('check_decision', await checkDecision(deps.clientFor, deps.env, decision_id)),
  );

  server.registerTool(
    'get_integration_guide',
    {
      title: 'Read the Ziffer SDK integration guide',
      description:
        'Return the SDK integration guide for one language, as ZIFFER publishes it. Needs no ' +
        'configuration, so it answers before any API key ' +
        'exists. Read it before writing integration code: the guide states which line ' +
        'actually enforces anything, and what this SDK does not do.',
      inputSchema: {
        language: z.enum(LANGUAGES).describe('Which language walkthrough to return.'),
      },
    },
    ({ language }) => reply('get_integration_guide', getIntegrationGuide(language)),
  );

  server.registerTool(
    'explain_receipt',
    {
      title: 'Verify a decision receipt',
      description:
        'Verify a receipt against the configured trust anchor and report "valid: bound to ' +
        '<hash>" or the refusal: its name, what it means, the rule it was refused under and what ' +
        'to do. proposal_b64 is base64 of the proposal bytes ' +
        'your code passes to verify. Key order and whitespace do not matter — the verifier ' +
        'parses and canonicalises them — but it must be the same object, and it must be ' +
        'UTF-8 JSON. Verifying a receipt says nothing about whether it was already used.',
      inputSchema: {
        receipt: z.unknown().describe('The receipt as parsed JSON, exactly as served.'),
        proposal_b64: z
          .string()
          .min(1)
          .describe('Base64 of the proposal bytes the receipt should be bound to (any JSON spelling).'),
        trust_anchor_path: z
          .string()
          .optional()
          .describe(
            `Overrides ${VARS.TRUST_ANCHOR} for this call. Omit to use the configured anchor.`,
          ),
      },
    },
    async ({ receipt, proposal_b64, trust_anchor_path }) =>
      reply('explain_receipt',
        await explainReceipt(deps.env, {
          receipt,
          proposalB64: proposal_b64,
          // exactOptionalPropertyTypes is on: an absent override must be an
          // ABSENT property, not one present and holding undefined. Spreading
          // conditionally is the honest way to say "there is no override" --
          // the same distinction codegen enforces on the wire root, where an
          // absent optional must not reach a preimage as null.
          ...(trust_anchor_path === undefined ? {} : { trustAnchorPath: trust_anchor_path }),
        }),
      ),
  );

  server.registerTool(
    'sandbox_status',
    {
      title: 'Report whether a tenant is a Ziffer sandbox',
      description:
        'Say whether a tenant id is a sandbox tenant, what that does and does not mean, and — ' +
        'when given a decision_id — whether that decision has been decided or is still waiting ' +
        'on the robot approver. This tool APPROVES NOTHING and verifies nothing: a sandbox is a ' +
        'separate tenant inside the deployment, approvals are made there under keys this machine ' +
        'does not hold, and a sandbox receipt is signed by a different identity so production ' +
        'verification refuses it. An ALLOW in a sandbox means the path worked, not that a person ' +
        'agreed.',
      inputSchema: {
        tenant_id: z
          .string()
          .min(1)
          .describe(
            'The tenant_id your proposals carry. This server holds no tenant of its own: the API ' +
              'key determines the tenant, and a proposal naming a different one is refused.',
          ),
        decision_id: z
          .string()
          .optional()
          .describe('A decision to check for the approver s liveness. Omit to answer on the name alone.'),
      },
    },
    async ({ tenant_id, decision_id }) =>
      reply('sandbox_status',
        await sandboxStatus(deps.clientFor, deps.env, {
          tenantId: tenant_id,
          // exactOptionalPropertyTypes, as in explain_receipt: an omitted
          // argument must be an ABSENT property, not one holding undefined.
          ...(decision_id === undefined ? {} : { decisionId: decision_id }),
        }),
      ),
  );

  server.registerTool(
    'get_policy_repo_guide',
    {
      title: 'Read the ZIFFER policy repository guide',
      description:
        'Return the policy repository template README and the first-hour guide, verbatim: the ' +
        'six steps, the three files ZIFFER provisions, the four repository variables, the four ' +
        'secrets by name, and the branch protection rule. Needs no configuration and takes no ' +
        'arguments. Read it before editing a customer policy repository — it is the same text ' +
        'the repository itself carries, so an instruction here is an instruction there. It is ' +
        'about the POLICY repository; get_integration_guide is about their application code.',
      inputSchema: {},
    },
    () => reply('get_policy_repo_guide', { text: policyRepoGuide(), isError: false }),
  );

  server.registerTool(
    'check_policy_repo',
    {
      title: 'Check a policy repository clone against the template',
      description:
        'Read a local clone of the policy repository and report PASS, FAIL or NOT CHECKED for ' +
        'each check, with one fix per line: every workflow identical to the shipped one except ' +
        'its policy folder (POLICY_DIR, and the paths: filter beside it), which must be a plain ' +
        'relative folder named the same in every workflow and is the folder every later check ' +
        "reads, and the validate workflow's NO_EXAMPLE_PROPOSALS ('true' or 'false'), which decides " +
        "whether no examples fails or is reported NOT CHECKED, as that workflow does; every bundle " +
        "member present, the bundle and examples read by the ziffer CLI, the " +
        "three provisioned files no longer the demonstration tenant's, one example per graded " +
        'action, the signing key pair, author and reviewer, and the branch protection settings ' +
        'to confirm by hand. It READS ONLY: it writes nothing, signs nothing, verifies no ' +
        'signature and opens no connection. A FAIL is this tool having looked, not an error. ' +
        'NOT CHECKED means it could not look and never means PASS.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Path to the root of the cloned policy repository — the directory holding policy/.'),
      },
    },
    async ({ path }) => reply('check_policy_repo', await checkPolicyRepoTool(path)),
  );

  server.registerTool(
    'explain_publish_failure',
    {
      title: 'Explain a failed policy publish run',
      description:
        'Paste the log of a failed publish-policy run and get the step, the named refusal and ' +
        'what the workflow itself says to do about it — the epoch that did not rise, a committed ' +
        "public key that is not the signing key's, a CLI checksum mismatch, a refused client " +
        'certificate, an expired bundle, and every other failure that workflow can emit. Every ' +
        'word of the answer is quoted from the workflow file, so it cannot disagree with the ' +
        'pipeline. A refusal is deterministic: fix what it names rather than re-running.',
      inputSchema: {
        log: z
          .string()
          .min(1)
          .describe("The failed run's log, or the failed step's output. Either is read."),
      },
    },
    ({ log }) => reply('explain_publish_failure', explainPublishFailure(log)),
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Search the ZIFFER documentation',
      description:
        'Search every ZIFFER onboarding document and return the matching SECTIONS whole, each ' +
        'under the file path and heading it has in the repository — the install guide, the SDK ' +
        'guide, the policy repository and its CI, the Executor, approvers, sandboxes, the ' +
        'customer checklist and the support page. Nothing is summarised: what comes back is the ' +
        'document. It matches literal terms, so ask with the words we use — a refusal name, an ' +
        'environment variable, a file name, a CLI subcommand — and it says how many sections it ' +
        'did not show. Needs no configuration and opens no connection.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('The words to look for. Clause ids and variable names stay whole: "8.4-3", "ZIFFER_SUITE_FLOOR".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`How many sections to return. Default ${DEFAULT_LIMIT}, most ${MAX_LIMIT}.`),
      },
    },
    ({ query, limit }) => reply('search_docs', searchDocs(query, limit ?? DEFAULT_LIMIT)),
  );

  server.registerTool(
    'explain_refusal',
    {
      title: 'Explain one refusal by name',
      description:
        'Give one refusal name — a decision\'s `refusal_category` like "PolicyRefused", the ' +
        '`error` member of a 4xx body like "TenantMismatch", a rule the console or your audit ' +
        'chain names like "8.4-3", a clause id from an Executor alert like "AU-7", or a receipt ' +
        'refusal from your SDK\'s verify by its name like "ReceiptNotBoundToProposal" or its rule ' +
        'like "9.3-3" — and ' +
        'get what it means, who fixes it and what to do now, quoted from the support table. A ' +
        'name we emit that the table does not carry is answered with the sections that ' +
        'mention it; a name nothing knows is refused rather than matched to the nearest one, ' +
        'because the row for a name you did not ask about is an answer to a different question. ' +
        'A refusal is deterministic: fix what it names rather than retrying.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe('The refusal name exactly as you were handed it. Matching is exact and case sensitive.'),
      },
    },
    ({ name }) => reply('explain_refusal', explainRefusal(name)),
  );

  server.registerTool(
    'send_feedback',
    {
      title: 'Tell Ziffer what the documentation did not answer',
      description:
        'THIS SENDS TEXT OFF THIS MACHINE. What you write in question and context is posted to ' +
        'the Ziffer deployment, stored under the tenant your API key carries, and read by an ' +
        'operator; it is not filtered, summarised or redacted on the way, and nothing answers ' +
        'back through this tool. Send only the question and what is needed to understand it — ' +
        'never a key, a token, a customer name or anything from a private file. Use it when ' +
        `search_docs and explain_refusal found nothing across the ${ONBOARDING_DOCS.length} ` +
        'documents: an unanswered question is the one thing we cannot see from here. The ' +
        'deployment bounds the size and the rate, and over either is a named refusal.',
      inputSchema: {
        tool: z
          .string()
          .min(1)
          .describe('Which tool could not answer, e.g. "search_docs".'),
        question: z
          .string()
          .min(1)
          .describe('What you were trying to find out, in your own words. This is read by a person.'),
        context: z
          .string()
          .optional()
          .describe(
            'Anything else worth knowing — what you tried, which document you expected it in. ' +
              'No credentials and no private file contents: this is stored as written.',
          ),
      },
    },
    async ({ tool, question, context }) =>
      reply('send_feedback',
        await sendFeedback(deps.clientFor, deps.env, {
          tool,
          question,
          // exactOptionalPropertyTypes, as in explain_receipt and
          // sandbox_status: an omitted argument must be an ABSENT property.
          ...(context === undefined ? {} : { context }),
        }),
      ),
  );

  server.registerTool(
    'whoami',
    {
      title: 'Which Ziffer tenant this API key belongs to',
      description:
        'Ask the gateway which tenant the configured API key is bound to and until when the key ' +
        'is accepted, and return the answer verbatim. Two facts and no more: it serves no policy, ' +
        'no epoch and no attester names, because nothing an SDK call does needs them. Use it ' +
        'before writing a tenant_id into a proposal — the KEY determines the tenant and a ' +
        'proposal naming a different one is refused (TenantMismatch), never rewritten. A 401 ' +
        'ApiKeyUnknown here covers expired, revoked and never-minted alike and does NOT mean the ' +
        'key expired.',
      inputSchema: {},
    },
    async () => reply('whoami', await whoami(deps.clientFor, deps.env)),
  );

  server.registerTool(
    'explain_policy',
    {
      title: 'Explain what a policy tree actually does',
      description:
        'Read a policy tree and report, per action, whether it runs alone, runs with somebody ' +
        'told, is held for a quorum, or is refused with the clause that refuses it — plus which ' +
        'targets your examples name that floors.json does not declare. Every verdict is the ' +
        'ziffer CLI\'s own, from one `ziffer decide --unsigned` run per row: this tool never ' +
        'grades anything itself, because a second reading of your risk functions would be a ' +
        'second definition of your rules. It READS ONLY — it writes nothing inside your tree, ' +
        'signs nothing and opens no connection. NOT CHECKED means it could not look and never ' +
        'means PASS.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            'Your policy tree: the directory holding risk_functions.json, or the repository root ' +
              'holding policy/. Either spelling is accepted.',
          ),
      },
    },
    async ({ path }) => reply('explain_policy', await explainPolicyTool(path)),
  );

  server.registerTool(
    'simulate_decision',
    {
      title: 'Grade one proposal against a draft policy tree',
      description:
        'Grade one wire Proposal against a policy tree on this machine and return the verdict ' +
        'and the clause — the same §8.4 fold the gateway runs, through `ziffer decide ' +
        '--unsigned`. Nothing is signed, uploaded or sent: the proposal is written to a ' +
        'temporary file, graded offline and the file is removed. A REFUSED answer is a real ' +
        'answer, not a tool failure. PASSED means the grade found nothing — no receipt was ' +
        'checked, no quorum counted and no approval door run, so it is not permission to act.',
      inputSchema: {
        proposal: z
          .record(z.string(), z.unknown())
          .describe(
            'The wire Proposal object: schema_id, schema_version, schema_hash, fidelity, ' +
              'tenant_id, payload. Graded exactly as written.',
          ),
        path: z
          .string()
          .min(1)
          .describe(
            'The policy tree to grade against: the directory holding risk_functions.json, or the ' +
              'repository root holding policy/.',
          ),
      },
    },
    async ({ proposal, path }) => reply('simulate_decision', await simulateDecision(path, proposal)),
  );

  // The guided flows. Registered beside the tools so they appear in the AI
  // assistant's prompt menu: a developer picks "Set up ZIFFER in this project"
  // and never needs a tool's name. Each is a script over the tools above and
  // carries no rule of its own (`prompts.ts`).
  for (const name of PROMPT_NAMES) {
    const spec = PROMPTS[name];
    server.registerPrompt(
      name,
      { title: spec.title, description: spec.description, argsSchema: PROMPT_ARGS[name] },
      (args: Readonly<Record<string, string | undefined>>) => promptReply(spec.description, spec.render(args).text()),
    );
  }

  return server;
}

/** The production wiring: the real environment and the real client factory. */
export function createDefaultServer(): McpServer {
  return createServer({ env: process.env, clientFor: zifferClientFactory });
}
