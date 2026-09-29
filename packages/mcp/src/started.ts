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

import { VARS } from './config.js';
import { INSTALLS, START_HERE_PATH, STARTED_SPANS, type StartedSpan } from './generated/started-source.js';
import type { ToolOutcome } from './tools.js';

/** The languages `get_started` prints an install command for, in order. Read
 * from the generated module rather than declared: the set is whatever the
 * build found a manifest for. */
export const STARTED_INSTALLS = INSTALLS;

/** The spans this module serves, for the staleness assertions in the tests. */
export const STARTED_SPAN_LIST: readonly StartedSpan[] = STARTED_SPANS;

/** Where an account comes from. */
export const STARTED_START_HERE = START_HERE_PATH;

/**
 * The order an agent should call the tools in, and why each one.
 *
 * Retyped names, not imported: `server.ts` imports THIS module, so importing
 * `TOOL_NAMES` back out of it would be a cycle. `started.test.ts` asserts every
 * name below is registered, which is the executable consumer that a comment
 * promising to keep them in step would not be — a tool renamed without this
 * list moving is a red suite rather than an answer sending an agent to a tool
 * that is not there.
 */
export const TOOL_ORDER: readonly { readonly tool: string; readonly why: string }[] = [
  {
    tool: 'get_integration_guide',
    why: 'Read the whole walkthrough for your language first. It states which line enforces anything and what this SDK does not do.',
  },
  {
    tool: 'lint_proposal',
    why: 'Check the proposal object you built against the wire schema, locally. A bad field is named here rather than by the gateway.',
  },
  {
    tool: 'propose',
    why: 'Submit it. The answer is a decision_id; the receipt is never in this response.',
  },
  {
    tool: 'get_decision',
    why: 'Fetch the decision and have its receipt VERIFIED under your anchor before you see it. check_decision is the same fetch without the verification.',
  },
  {
    tool: 'check_integration',
    why: 'Point it at your repository once the code is written: it reports every propose call site that has no verify beside it.',
  },
  {
    tool: 'list_decisions',
    why: 'What ZIFFER is holding and what it decided, for your key. Useful when a decision is waiting on an approver.',
  },
  {
    tool: 'explain_receipt',
    why: 'When a receipt does not verify in your own code, hand it here with the bytes you hashed and get the clause that refused it.',
  },
];

function span(name: string): string {
  for (const carried of STARTED_SPANS) {
    if (carried.name === name) return `${carried.markdown}\n\n(from ${carried.path})`;
  }
  // Unreachable through a build: `scripts/embed-guide.mjs` halts on a document
  // that lost a marker. Kept and named for `guide.ts`'s reason — this module is
  // also imported by tests, and the alternative to a refusal is a section that
  // renders empty and reads as an answer.
  return `GuideSectionMissing: this build carries no guide:${name} span, so that section is absent rather than empty.`;
}

/**
 * `get_started` — no arguments, no configuration, no network.
 *
 * It is the one tool that is useful before anything at all exists, which is the
 * same inversion `config.ts` argues for one file over: a server that could not
 * answer until it held a key could not answer the question a developer asks
 * first.
 */
export function getStarted(): ToolOutcome {
  const lines: string[] = [
    'get_started — integrating ZIFFER, in the order the steps actually happen.',
    '',
    '0. Call the scan tool first, with cwd set to the project: it lists every tool the application\'s',
    '   code gives a model and the ZIFFER engine\'s verdict for each under a draft policy, and the',
    '   one fix: the model holds the authority to run those tools directly, so remove it from the',
    '   model path and route every call through ZIFFER with one line at the top of the dispatcher.',
    '   Prompt filters, output classifiers and asking the model to be careful are not that fix. It',
    '   also lists the tool servers your AI agent clients would start and starts none; call it again',
    '   with confirm: true once the developer agrees. Nothing leaves the machine. The same scan runs as',
    '   npx @ziffer-io/scan in your project, for a developer who would rather run it themselves.',
    '',
    '1. Get an account. Nothing from here on works without it.',
    `   The first hour is ${STARTED_START_HERE}: install the CLI, make your policy repository`,
    '   and your signing key, enrol yourself as an approver, publish your first policy. Call',
    '   get_policy_repo_guide to read that document and the repository template README in full.',
    '   You will be given an API key, a trust anchor file and the URL of your deployment.',
    '',
    '2. Install the SDK, at the version we publish:',
    '',
  ];
  for (const install of STARTED_INSTALLS) {
    lines.push(`   ${install.language.padEnd(10)} ${install.command}`);
  }
  lines.push(
    '',
    `   The versions are read from ${STARTED_INSTALLS.map((i) => i.source).join(' and ')} when this`,
    '   package is built, so they are the ones we published rather than the ones someone typed.',
    '',
    `3. Set ${Object.keys(VARS).length} environment variables. Every tool here that needs one refuses by naming it,`,
    '   and none of them has a default — a default trust anchor would verify receipts under a key',
    '   nobody enrolled, and a default suite floor would be a minimum signature strength nobody',
    '   agreed to.',
    '',
    span('configuration'),
    '',
    '4. Wrap the line that acts. This is the whole of the change:',
    '',
    span('six-line-wrap'),
    '',
    '   Line 5 is the product. Delete it and you are back to believing the outcome field: nothing',
    '   warns you, no test fails, and the integration still appears to work. The proposal is passed',
    '   to verify a SECOND time on purpose — the hash is recomputed from your own bytes, because a',
    '   transmitted identifier is a name for a binding and not evidence of one.',
    '   Line 3 waits for the receipt, not for the decision: an action held for approval keeps it',
    '   waiting until a person approves, and that receipt verifies only with your own approver',
    '   registry (attesters/registry.json in your policy repository, ZIFFER_ATTESTER_REGISTRY).',
    '   The module ziffer-scan --code writes does all of this already.',
    '',
    '5. Then call these, in this order:',
    '',
  );
  for (const { tool, why } of TOOL_ORDER) {
    lines.push(`   ${tool}`, `     ${why}`);
  }
  lines.push(
    '',
    'What this server will not do for you: it edits none of your code, runs no action and approves',
    'nothing. The one thing it writes is the draft policy folder the scan tool makes. Your coding',
    'agent edits your code, and the verify line in your own handler is what stops an action.',
    'Nothing here is a gate.',
  );
  return { text: lines.join('\n'), isError: false };
}
