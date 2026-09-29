/**
 * The guided flows: MCP prompts this server registers beside its tools, so they
 * appear in the AI assistant's prompt menu and a developer never needs to know a
 * tool's name to be walked from install to a verified receipt.
 *
 * # A prompt guides a model; it enforces nothing
 *
 * Each prompt is an ordered script over tools this server already registers,
 * and it says after every step which tool comes next and what the developer
 * should see. It carries no rule of its own. Every security property stays where
 * it was: in the tools (the scan's two-call confirmation, `get_decision`
 * withholding a receipt it could not verify) and in the `verify` line in the
 * developer's own code. A model that ignores a prompt skips a step of the setup;
 * it gains no authority, because there is none here to gain.
 *
 * # The tool names are declared, and a test reads them against the registry
 *
 * A script that names a tool the server does not register sends a model to
 * improvise, and an improvised step in a setup that ends in a signed policy is the
 * one place improvisation must not happen. So every tool a script names is
 * written through {@link Script.tool}, which records it; `prompts.test.ts` lists
 * the server's tools over a real client and asserts each recorded name is one of
 * them, AND that every backticked lower-case name in the rendered text is a
 * registered tool, an argument some tool declares, a prompt, or one of the few
 * other words {@link PLAIN_WORDS} names. A tool name typed into the prose past the
 * helper is therefore caught too.
 */

import { z } from 'zod';

/** The prompts, named once. */
export const PROMPT_NAMES = ['setup_ziffer', 'scan_and_explain', 'why_refused'] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

/** Backticked words the scripts use that are neither a tool, a tool argument
 * nor a prompt: field names in the scan's result, file names and values. Each is
 * something the developer or the model reads in a tool's own answer. */
export const PLAIN_WORDS: readonly string[] = [
  'dispatcher',
  'insertion',
  'remediation',
  'not_a_fix',
  'draft_policy',
  'draft_reason',
  'tools_file',
  'decision_id',
  'status',
  'outcome',
  'receipt',
  'tenant_id',
  'refusal_category',
  'error',
  'verify',
  'true',
  'false',
];

/** A script under construction: the lines, and the tools it named. */
class Script {
  readonly lines: string[] = [];
  readonly tools = new Set<string>();

  /** A tool name, backticked, and recorded for the registry test. */
  tool(name: string): string {
    this.tools.add(name);
    return `\`${name}\``;
  }

  /** A prompt name, backticked. */
  prompt(name: PromptName): string {
    return `\`${name}\``;
  }

  add(...lines: string[]): void {
    this.lines.push(...lines);
  }

  text(): string {
    return this.lines.join('\n');
  }
}

/** The rules every script carries. They restate the tools' own boundaries so a
 * model reads them before the first call, not after it. */
function groundRules(s: Script): void {
  s.add(
    '',
    'Ground rules, for every step:',
    '- Show the developer each tool\'s answer as it comes. The verdicts are the ZIFFER engine\'s; never grade, re-grade or classify a tool yourself.',
    '- Never create, read, print or store a policy signing key or any private key. Give the developer the command to run on their own machine, and stop.',
    '- Never name who approves, never approve anything, never publish a policy and never merge a pull request. A person does each of those.',
    '- Write nothing in the project until the developer has seen the exact change and approved it. Never write a key or any credential into a file.',
    '- Start no program the developer has not agreed to, and send nothing to ZIFFER before the developer says go.',
    '- End every step by saying what comes next, and which tool you will call.',
  );
}

export interface SetupArgs {
  readonly project_path?: string | undefined;
}

/** Flow (a): set up ZIFFER in this project, from nothing to a verified receipt. */
export function setupScript(args: SetupArgs): Script {
  const s = new Script();
  const where =
    args.project_path === undefined || args.project_path.trim() === ''
      ? 'the absolute path of the project you are working in'
      : `\`${args.project_path.trim()}\``;
  s.add(
    'Set up ZIFFER in this project, from nothing to a first decision with a verified receipt.',
    '',
    'ZIFFER is the agent authorization service: the application asks ZIFFER before a tool call the AI model',
    'asked for runs, a risky call is held for a named person, and every decision leaves a signed receipt that',
    'the application checks itself. Walk the developer through the eight steps below, in order. Say at the',
    'start that there are eight steps, and that nothing is written, started or sent without them seeing it first.',
  );
  groundRules(s);
  s.add(
    '',
    `Step 1. Scan. Call ${s.tool('scan')} with \`cwd\` set to ${where}, and \`confirm\` left out.`,
    '  The developer should see: the first line of numbers (tools the model can call, held for a person, run',
    '  after a notice, refused, allowed, and how many cannot be undone), then each tool that cannot be undone',
    '  and is held or notified, with its file:line and its `draft_reason`.',
    '  If the answer also lists programs it would start for the AI tools installed on this machine, show that',
    `  list and ask. Call ${s.tool('scan')} again with \`confirm\` set to \`true\` only on a clear yes.`,
    `  Next: step 2, ${s.tool('explain_scan_finding')}.`,
    '',
    `Step 2. The held tools, explained. For each held or notified tool, call ${s.tool('explain_scan_finding')}`,
    '  with its name exactly as the scan listed it.',
    '  The developer should see: the engine\'s verdict for the tool, the draft policy file and entry it came',
    '  from, and how to change it. A change belongs in the draft policy, never in the code.',
    `  Next: step 3, ${s.tool('get_started')} and ${s.tool('get_integration_guide')}.`,
    '',
    'Step 3. The one change in the code. The scan\'s `remediation` names it: one call line at the top of the',
    '  `dispatcher` (the file:line is in the result), the snippet module from `insertion` saved beside it,',
    '  and the tools file (`tools_file`) copied into the project at ziffer-scan/ziffer-tools.json.',
    `  Call ${s.tool('get_started')} for the install command of the client package at the version ZIFFER`,
    `  publishes, and ${s.tool('get_integration_guide')} for the project's language.`,
    '  Show the whole change as a diff and wait for approval. Then write exactly that change, and call',
    `  ${s.tool('check_integration')} with the project's path.`,
    '  The developer should see: the diff, then every propose call site with PASS beside it. A FAIL or',
    '  NOT CHECKED is a place the verify line is missing; fix it through the same approval.',
    '  What is not the fix: a prompt filter, an output classifier, asking the model to be careful, or a',
    '  confirmation flag in the application\'s own tool definitions. Each leaves the model holding the',
    '  authority; the scan\'s `not_a_fix` says why.',
    `  Next: step 4, ${s.tool('get_policy_repo_guide')}.`,
    '',
    `Step 4. The policy repository. Call ${s.tool('get_policy_repo_guide')} and follow it: a private`,
    '  repository made from the policy repository template in the developer\'s onboarding pack, with the',
    '  rule files from the scan\'s `draft_policy` copied into its policy folder. For every tool that cannot',
    '  be undone or that the scan could not classify, show the scan\'s reason and ask the developer to',
    '  confirm or correct it; change a rule file only to what they said. Write one example proposal per',
    `  tool in policy/examples/, built from the tools file, and call ${s.tool('lint_proposal')} on each.`,
    `  Then call ${s.tool('check_policy_repo')}, ${s.tool('explain_policy')} and`,
    `  ${s.tool('simulate_decision')} with the repository's path.`,
    '  The developer should see: one line per check, then per action whether it runs alone, runs with',
    '  somebody told, is held for a person, or is refused. NOT CHECKED is never a pass.',
    '  The policy signing key is the developer\'s: give them bin/new-signing-key.sh to run on their own',
    '  machine, and never run it.',
    `  Next: step 5, ${s.tool('get_policy_repo_guide')} again, for the pipeline.`,
    '',
    'Step 5. The pipeline. The three workflow files come from the template unchanged: the pull request',
    '  check, the scan check, and the publish job that signs with the developer\'s key on every merge to',
    '  main and prints active when the new rules are in force. List every variable and secret the',
    `  workflows read, and where each value comes from, with ${s.tool('search_docs')} on each name. The`,
    '  developer sets the secrets and the branch protection; a person merges.',
    `  If a publish run fails, call ${s.tool('explain_publish_failure')} with its log.`,
    `  Next: step 6, ${s.tool('whoami')}.`,
    '',
    `Step 6. The key. Call ${s.tool('whoami')}.`,
    '  The developer should see: the tenant their API key belongs to, and until when the key is accepted.',
    '  If the answer says the key is not set, show its instruction as written: it says where to write, what',
    '  to send and what comes back. Steps 1 to 5 need no key; step 7 waits for it.',
    `  Next: step 7, ${s.tool('lint_proposal')} and ${s.tool('propose')}.`,
    '',
    'Step 7. The first proposal. Take one example proposal from step 4 that the policy lets run on its own,',
    `  with \`tenant_id\` set to the tenant from step 6. Call ${s.tool('lint_proposal')} on it, and`,
    `  ${s.tool('simulate_decision')} if the policy repository is on this machine. Show the proposal and say`,
    `  that ${s.tool('propose')} sends it to ZIFFER. Wait for the developer's go-ahead; then call`,
    `  ${s.tool('propose')} with it, exactly as shown.`,
    '  The developer should see: a `decision_id` and a `status`.',
    `  Next: step 8, ${s.tool('get_decision')}.`,
    '',
    `Step 8. The verified receipt. Call ${s.tool('get_decision')} with the \`decision_id\` and`,
    '  `proposal_b64` set to the base64 of the exact JSON you passed to propose.',
    '  The developer should see: valid, bound to the proposal\'s hash, with the receipt. That is the check the',
    '  verify line in their application makes before every action runs.',
    '  If the action is held for a person, the receipt comes once they approve: call',
    `  ${s.tool('list_decisions')} to see until when it waits, and ${s.tool('get_decision')} again after.`,
    `  If it is refused, run the ${s.prompt('why_refused')} prompt, or call ${s.tool('explain_refusal')}`,
    '  with the name exactly as it came back. A refusal repeats for the same proposal: fix what it names.',
    '',
    'Done: the application asks ZIFFER before every tool call, the policy decides, and each decision leaves',
    'a receipt the application verified itself.',
  );
  return s;
}

/** Flow (b): scan this project and explain what it found. */
export function scanScript(args: SetupArgs): Script {
  const s = new Script();
  const where =
    args.project_path === undefined || args.project_path.trim() === ''
      ? 'the absolute path of the project you are working in'
      : `\`${args.project_path.trim()}\``;
  s.add(
    'Scan this project with ZIFFER and explain what it found. The scan reads the code, writes its files',
    'into a temporary folder outside the project, starts nothing and sends nothing.',
  );
  groundRules(s);
  s.add(
    '',
    `Step 1. Call ${s.tool('scan')} with \`cwd\` set to ${where}, and \`confirm\` left out.`,
    '  The developer should see the result in this order:',
    '  - the numbers from its first line;',
    '  - each tool that cannot be undone and is held or notified, with its file:line and `draft_reason`;',
    '  - the one place to put ZIFFER: the `dispatcher` and its file:line, and the call line from `insertion`;',
    '  - anything the scan says one call does not see, passed on as written;',
    '  - where it wrote the draft policy, the report and the tools file.',
    `  Next: step 2, ${s.tool('explain_scan_finding')}.`,
    '',
    `Step 2. For each held or notified tool, call ${s.tool('explain_scan_finding')} with its name exactly as the`,
    '  scan listed it. The developer should see the verdict, the draft policy entry it came from, and how to',
    '  change it: in the draft policy, never in the code.',
    '  Next: step 3.',
    '',
    'Step 3. The finding and the fix, from the scan\'s `remediation`: the model holds the authority to run',
    '  these tools directly; the fix takes that authority off the model path and routes every call through',
    '  ZIFFER. A prompt filter, an output classifier, asking the model to be careful, or a confirmation flag',
    '  inside the application\'s own tool definitions is not the fix; `not_a_fix` says why.',
    '',
    'Step 4. If the scan lists programs it would start for the AI tools installed on this machine, show the',
    `  list and ask. Call ${s.tool('scan')} again with \`confirm\` set to \`true\` only on a clear yes.`,
    '',
    `Next: offer the ${s.prompt('setup_ziffer')} prompt, which makes the change in the code, builds the`,
    'policy from this scan and takes the project to a first decision with a verified receipt.',
  );
  return s;
}

export interface WhyArgs {
  readonly what: string;
  readonly proposal_b64?: string | undefined;
}

/** Flow (c): why was this refused. `what` is a refusal name, a rule, a
 * decision id or a receipt. */
export function whyScript(args: WhyArgs): Script {
  const s = new Script();
  const what = args.what.trim();
  const bytes =
    args.proposal_b64 === undefined || args.proposal_b64.trim() === ''
      ? 'Ask the developer for the exact proposal that was sent, and pass the base64 of its JSON as `proposal_b64`.'
      : 'Pass the `proposal_b64` given with this prompt.';
  s.add(
    'Explain why ZIFFER refused this, and what to do about it:',
    '',
    what,
  );
  groundRules(s);
  s.add(
    '',
    'Step 1. Decide what it is, by its shape, and call exactly one tool:',
    `  - a JSON object with a signature: it is a receipt. Call ${s.tool('explain_receipt')} with it as \`receipt\`.`,
    `    ${bytes}`,
    `  - an id returned by propose: call ${s.tool('get_decision')} with it as \`decision_id\`.`,
    `    ${bytes}`,
    `  - anything else (a name such as TenantMismatch, or a rule number): call ${s.tool('explain_refusal')}`,
    '    with it as `name`, exactly as written, case and all.',
    '  The developer should see: what the refusal means, who fixes it (them, or ZIFFER), and what to do now.',
    '',
    `Step 2. If ${s.tool('explain_refusal')} answers that it does not know the name, call`,
    `  ${s.tool('search_docs')} with the name as \`query\`, and show the sections it returns, whole.`,
    '',
    'Step 3. If neither answers it, say so, and offer to send the question to ZIFFER with',
    `  ${s.tool('send_feedback')}. That sends text off this machine to be read by a person: show the exact text`,
    '  first, put no key, token, customer name or private file content in it, and send only on a clear yes.',
    '',
    'A refusal is the same every time for the same input: fix what it names rather than sending the same',
    'proposal again. A held action is not a refusal: it waits for a person, and a second proposal would be a',
    'second action.',
  );
  return s;
}

/** What `server.ts` registers, per prompt: its title, its description, its
 * arguments and its script. */
export interface PromptSpec {
  readonly title: string;
  readonly description: string;
  readonly render: (args: Readonly<Record<string, string | undefined>>) => Script;
}

export const PROMPTS: Readonly<Record<PromptName, PromptSpec>> = {
  setup_ziffer: {
    title: 'Set up ZIFFER in this project',
    description:
      'The whole setup, in order: scan the code, explain the held tools, make the one change in the code, ' +
      'build the policy repository and its pipeline, then send a first proposal and verify its receipt.',
    render: (args) => setupScript({ project_path: args['project_path'] }),
  },
  scan_and_explain: {
    title: 'Scan this project and explain what it found',
    description:
      'Scan the code for every tool it gives an AI model, explain the tools that are held or cannot be ' +
      'undone, and name the one place to put ZIFFER. Starts nothing and sends nothing.',
    render: (args) => scanScript({ project_path: args['project_path'] }),
  },
  why_refused: {
    title: 'Why was this refused',
    description:
      'Paste a refusal name, a rule, a decision id or a receipt: what it means, who fixes it and what to do now.',
    render: (args) => whyScript({ what: args['what'] ?? '', proposal_b64: args['proposal_b64'] }),
  },
};

/** The argument shapes, as the MCP SDK takes them. Prompt arguments are strings. */
export const PROMPT_ARGS = {
  setup_ziffer: {
    project_path: z
      .string()
      .optional()
      .describe('The project to set ZIFFER up in, as an absolute path. Default: the project you are working in.'),
  },
  scan_and_explain: {
    project_path: z
      .string()
      .optional()
      .describe('The project to scan, as an absolute path. Default: the project you are working in.'),
  },
  why_refused: {
    what: z
      .string()
      .min(1)
      .describe('A refusal name (TenantMismatch), a rule, a decision id, or a receipt as JSON.'),
    proposal_b64: z
      .string()
      .optional()
      .describe('For a receipt or a decision id: base64 of the exact proposal JSON that was sent.'),
  },
} as const;
