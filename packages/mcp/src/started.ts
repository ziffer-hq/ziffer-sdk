/**
 * `get_started` — the first answer, for an agent that has been handed this
 * server and nothing else (ACP-390).
 *
 * # It is a router, and everything it routes to is read rather than written
 *
 * The only sentences this module owns are the ones joining the pieces: which
 * order to do things in, and which tool to call next. Every FACT in the answer
 * comes from somewhere that already had to be right —
 *
 *   * the install command's VERSION is read out of the manifest that publishes
 *     it (`sdk/python/pyproject.toml`, `packages/acp-client/package.json`) at
 *     build time, so the number here cannot be the one that was true when this
 *     file was written;
 *   * the four variables are {@link VARS}, the single reader of the
 *     environment, and where each one comes from is `README.md`'s own table,
 *     SLICED — `started.test.ts` asserts the two name the same four, so a
 *     variable added to one and not the other is a red suite;
 *   * the shape of the change is `docs/onboarding/sdk.md`'s six-line wrap,
 *     sliced from the same document `get_integration_guide` serves whole.
 *
 * A second copy of any of those would be the copy that goes stale, and the one
 * that goes stale is the one an agent reads instead of the document.
 *
 * # Why it points at an account and never at a way around getting one
 *
 * Because there is no way around it, and a starting page that implied one would
 * be selling a demo. The first step is the first-hour guide, which is a real
 * enrolment with a real policy repository and a real approver. This package
 * does have a tool that reports on a Ziffer sandbox — `sandbox_status` — and it
 * is deliberately NOT in the order below and its name does not appear in this
 * answer: a sandbox is a separate tenant you are given, not a starting point
 * you choose, and an agent told about one at step zero would plan an
 * integration around approvals nobody made. `started.test.ts` asserts the word
 * is absent from the served text, which is a small check on a claim that would
 * otherwise rot into prose.
 *
 * Step zero is the local scan (`@ziffer-io/scan`, ACP-446), and it is not a way
 * around an account either: it reads this machine's MCP configuration, drafts a
 * policy signed by a key it discards, and sends nothing, so it can come before
 * step 1 without promising anything step 1 does not deliver. Since ACP-446 step 2
 * it is a tool of this server, `scan`, and step zero names the tool first: an
 * agent that is already talking to this server should not be sent to a terminal
 * for a command it can call. `npx @ziffer-io/scan` stays beside it as the
 * alternative, for a developer who wants to run it themselves.
 */

import { DEFAULT_API_URL, HOW_TO_GET_A_KEY, VARS } from './config.js';
import { INSTALLS, START_HERE_PATH, STARTED_SPANS, type StartedSpan } from './generated/started-source.js';
import type { ToolOutcome } from './tools.js';

/** The languages `get_started` prints an install command for, in order. Read
 * from the generated module rather than declared: the set is whatever the
 * build found a manifest for. */
export const STARTED_INSTALLS = INSTALLS;

/** The spans this module serves, for the staleness assertions in the tests. */
export const STARTED_SPAN_LIST: readonly StartedSpan[] = STARTED_SPANS;

/**
 * Where a document this module cites is published, by its path in this
 * repository. A developer has the published page and never our repository, so
 * the served text names the page. `started.test.ts` holds each URL to the row
 * `tools/publish-docs.sh` publishes that document under, so a moved page is a
 * red suite rather than a dead link; a path with no entry here is served with no
 * source line at all, never with the path.
 */
export const PUBLISHED: Readonly<Record<string, string>> = {
  'docs/onboarding/start-here.md': 'https://ziffer.io/docs/onboarding/start-here',
  'docs/onboarding/sdk.md': 'https://ziffer.io/docs/developers/sdk',
  'packages/mcp/README.md': 'https://www.npmjs.com/package/@ziffer-io/mcp',
};

/** The first-hour guide, as a developer reaches it. */
export const STARTED_START_HERE = PUBLISHED[START_HERE_PATH] ?? 'https://ziffer.io/docs/onboarding/start-here';

/**
 * The order the steps call the tools in, and why each one. It is the order of
 * the `setup_ziffer` prompt, so the entry point and the guided flow cannot send
 * a model two different ways.
 *
 * Retyped names, not imported: `server.ts` imports THIS module, so importing
 * `TOOL_NAMES` back out of it would be a cycle. `started.test.ts` asserts every
 * name below is registered.
 */
export const TOOL_ORDER: readonly { readonly tool: string; readonly why: string }[] = [
  { tool: 'scan', why: 'Every tool the code gives a model, the engine\'s verdict for each under a draft policy, and the one place to put ZIFFER.' },
  { tool: 'explain_scan_finding', why: 'Why one held tool is held, the draft policy entry that decided it, and how to change it.' },
  { tool: 'get_integration_guide', why: 'The whole walkthrough for the project\'s language, including the line that enforces the decision.' },
  { tool: 'check_integration', why: 'Every propose call site in the project, with PASS where a verify runs beside it.' },
  { tool: 'get_policy_repo_guide', why: 'The policy repository template\'s instructions and the first-hour guide, word for word.' },
  { tool: 'check_policy_repo', why: 'What is left to do in the policy repository, one line and one fix per check.' },
  { tool: 'explain_policy', why: 'Per action, whether it runs alone, runs with somebody told, is held for a person, or is refused.' },
  { tool: 'simulate_decision', why: 'What the policy decides about one proposal, graded on this machine before anything is sent.' },
  { tool: 'whoami', why: 'Which tenant the API key belongs to: the tenant_id every proposal carries.' },
  { tool: 'lint_proposal', why: 'Whether the proposal has the shape ZIFFER accepts, naming the field that is wrong.' },
  { tool: 'propose', why: 'Sends the proposal, once the developer says go, and returns its decision_id.' },
  { tool: 'get_decision', why: 'The decision with its receipt VERIFIED on this machine, bound to the exact bytes that were sent.' },
];

function span(name: string): string {
  for (const carried of STARTED_SPANS) {
    if (carried.name === name) {
      const page = PUBLISHED[carried.path];
      return page === undefined ? carried.markdown : `${carried.markdown}\n\n(from ${page})`;
    }
  }
  // Unreachable through a build: `scripts/embed-guide.mjs` halts on a document
  // that lost a marker. Kept and named for `guide.ts`'s reason — this module is
  // also imported by tests, and the alternative to a refusal is a section that
  // renders empty and reads as an answer.
  return `GuideSectionMissing: this build carries no guide:${name} span, so that section is absent rather than empty.`;
}

/**
 * `get_started` — no arguments, no configuration, no network. The entry point of
 * the `setup_ziffer` flow, step by step.
 *
 * It is the one tool that is useful before anything at all exists, which is the
 * same inversion `config.ts` argues for one file over: a server that could not
 * answer until it held a key could not answer the question a developer asks first.
 */
export function getStarted(): ToolOutcome {
  const lines: string[] = [
    'get_started: set up ZIFFER in this project, from nothing to a first decision with a verified receipt.',
    '',
    'The setup_ziffer prompt, in your AI assistant\'s prompt menu as "Set up ZIFFER in this project", walks',
    'these steps in order and says after each one which tool comes next. The steps:',
    '',
    '0. Call the scan tool first, with cwd set to the project: it lists every tool the application\'s',
    '   code gives a model and the ZIFFER engine\'s verdict for each under a draft policy, and the',
    '   one fix: the model holds the authority to run those tools directly, so remove it from the',
    '   model path and route every call through ZIFFER with one line at the top of the dispatcher.',
    '   Prompt filters, output classifiers and asking the model to be careful are not that fix. It',
    '   also lists the tool servers your AI assistants would start and starts none; call it again',
    '   with confirm: true once the developer agrees. Nothing leaves the machine. The same scan runs as',
    '   npx @ziffer-io/scan in your project, for a developer who would rather run it themselves.',
    '   Then explain_scan_finding, for each held tool: why it is held, and where to change that.',
    '',
    '1. Put ZIFFER in the code, at the one place the scan names. Install the client at the version',
    '   ZIFFER publishes with this server:',
    '',
  ];
  for (const install of STARTED_INSTALLS) {
    lines.push(`   ${install.language.padEnd(10)} ${install.command}`);
  }
  lines.push(
    '',
    '   Wrap the line that acts. This is the whole of the change:',
    '',
    span('six-line-wrap'),
    '',
    '   Line 5 is the product. Delete it and you are back to believing the outcome field: nothing',
    '   warns you, no test fails, and the integration still appears to work. The proposal is passed',
    '   to verify a SECOND time on purpose: the hash is recomputed from your own bytes, because a',
    '   transmitted identifier is a name for a binding and not evidence of one.',
    '   Line 3 waits for the receipt, not for the decision: an action held for approval keeps it',
    '   waiting until a person approves, and that receipt verifies only with your own approver',
    '   registry (attesters/registry.json in your policy repository, ZIFFER_ATTESTER_REGISTRY).',
    '   The module the scan writes (insertion.snippet in its result) does all of this already.',
    '   Show the developer the change as a diff and write it once they approve; then call',
    '   check_integration with the project\'s path: every propose call site should read PASS.',
    '',
    '2. Build the policy repository from the scan\'s draft. Call get_policy_repo_guide and follow it;',
    '   then check_policy_repo, explain_policy and simulate_decision with the repository\'s path. The',
    '   developer confirms every tool that cannot be undone; the policy signing key is theirs, made on',
    '   their own machine with bin/new-signing-key.sh.',
    '',
    '3. Set up the pipeline: the template\'s workflows check every pull request without a key, and on',
    '   every merge sign with the developer\'s key and publish. explain_publish_failure reads a failed',
    '   run\'s log.',
    '',
    `4. Get your key. ${HOW_TO_GET_A_KEY.join(' ')}`,
    `   The first hour, with its onboarding sheet, is ${STARTED_START_HERE}.`,
    '',
    span('configuration'),
    '',
    `   ${VARS.API_URL} defaults to ${DEFAULT_API_URL}, the hosted ZIFFER service. ${VARS.TRUST_ANCHOR} and`,
    `   ${VARS.SUITE_FLOOR} have no default: a default trust anchor would verify receipts under a key`,
    '   nobody enrolled, and a default suite floor would be a minimum signature strength nobody',
    '   agreed to. Then call whoami: it names the tenant every proposal carries.',
    '',
    '5. The first proposal. Take an example proposal the policy lets run on its own, with tenant_id',
    '   from whoami; lint_proposal it, show it to the developer, and on their go-ahead call propose.',
    '',
    '6. The verified receipt. Call get_decision with the decision_id and proposal_b64, the base64 of',
    '   the exact JSON you sent: the receipt comes back verified on this machine under your trust',
    '   anchor. That is the check the verify line makes in the application before every action.',
    '',
    'The tools, in the order the steps call them:',
    '',
  );
  for (const { tool, why } of TOOL_ORDER) {
    lines.push(`   ${tool}`, `     ${why}`);
  }
  lines.push(
    '',
    'What this server will not do for you: it edits none of your code, runs no action and approves',
    'nothing. The one thing it writes is the draft policy folder the scan tool makes. Your AI assistant',
    'edits your code, with your approval, and the verify line in your own handler is what stops an action.',
  );
  return { text: lines.join('\n'), isError: false };
}
