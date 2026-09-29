/**
 * The last line of every tool's answer: the next step, naming the next tool or
 * prompt and why.
 *
 * A developer who installs this server should never have to know a tool's name
 * to continue. Each answer therefore ends by saying what comes next, in one line,
 * with a second line for when the tool refused, because the next step after a
 * refusal is a different tool. The lines follow the order of the `setup_ziffer`
 * prompt, so a model that reads only the tools' answers walks the same path the
 * prompt describes.
 *
 * The lines name tools by string. `next.test.ts` asserts every tool has both
 * lines and that every backticked name in them is a registered tool or a
 * prompt, over a real client, so a renamed tool cannot leave a line pointing at
 * a name that is no longer there.
 */

import type { ToolOutcome } from './tools.js';

/** One tool's two next steps. */
export interface NextStep {
  /** After an answer. */
  readonly ok: string;
  /** After a refusal (`isError`). */
  readonly refused: string;
}

const EXPLAIN = 'call `explain_refusal` with the name at the start of this answer, exactly as written: it says who fixes it and what to do. A refusal repeats for the same input, so fix what it names rather than retrying.';

/** Every tool's next step, keyed by tool name. */
export const NEXT_STEPS: Readonly<Record<string, NextStep>> = {
  get_started: {
    ok: 'call `scan` with `cwd` set to the project\'s absolute path (step 0), or run the `setup_ziffer` prompt to be walked through every step in order.',
    refused: 'call `search_docs` with the words of the question.',
  },
  scan: {
    ok: 'show the numbers, the held tools and the one change; call `explain_scan_finding` for any tool the developer asks about; then `get_integration_guide` for the change in the code (the `setup_ziffer` prompt walks the whole path).',
    refused: 'fix what the refusal names and call `scan` again; `search_docs` with the refusal name explains it.',
  },
  explain_scan_finding: {
    ok: 'a verdict the developer disagrees with changes in the draft policy, not in the code; to make the one change in the code, call `get_integration_guide`.',
    refused: 'call `scan` first: this tool explains a tool from the last scan of this session.',
  },
  check_integration: {
    ok: 'each FAIL or NOT CHECKED is a place the verify line is missing (`get_integration_guide` shows it); once every call site passes, call `get_policy_repo_guide` to set up the policy repository.',
    refused: 'call `check_integration` again with the absolute path of the repository.',
  },
  lint_proposal: {
    ok: 'call `simulate_decision` to grade it against the policy on this machine, then `propose` to send it to ZIFFER once the developer says go.',
    refused: 'fix the field it names and call `lint_proposal` again.',
  },
  get_decision: {
    ok: 'a verified receipt is what the verify line in the application checks before the action runs; call `check_integration` to confirm every propose call site has one. A held decision gets its receipt once a person approves: call `get_decision` again then.',
    refused: 'for a receipt refusal, call `explain_receipt` with the receipt and the same proposal bytes for the rule that refused it; for any other, ' + EXPLAIN,
  },
  list_decisions: {
    ok: 'call `get_decision` with one `decision_id` and the base64 of its proposal to verify that receipt.',
    refused: EXPLAIN,
  },
  propose: {
    ok: 'call `get_decision` with this `decision_id` and `proposal_b64` set to the base64 of the exact JSON you sent: it returns the receipt verified on this machine.',
    refused: EXPLAIN,
  },
  check_decision: {
    ok: 'call `get_decision` with the same `decision_id` and the proposal bytes to verify the receipt. With no receipt yet, the action is held for a person: `list_decisions` shows until when.',
    refused: EXPLAIN,
  },
  get_integration_guide: {
    ok: 'make the change the guide shows, with the developer\'s approval, then call `check_integration` with the repository\'s path.',
    refused: 'call `get_integration_guide` again with python or typescript.',
  },
  explain_receipt: {
    ok: 'the application\'s verify line makes this same check before every action; `check_integration` confirms it is there.',
    refused: 'call `explain_refusal` with the refusal name above for who fixes it; check that the proposal bytes are the ones that were sent.',
  },
  sandbox_status: {
    ok: 'call `whoami` to see which tenant the API key belongs to, then `propose` once the developer says go.',
    refused: EXPLAIN,
  },
  get_policy_repo_guide: {
    ok: 'make the repository from the template, bring in the scan\'s draft rule files, then call `check_policy_repo` with its path.',
    refused: 'call `search_docs` with the words of the question.',
  },
  check_policy_repo: {
    ok: 'fix each FAIL line as it says; then call `explain_policy` with the same path to see what each action does.',
    refused: 'call `check_policy_repo` again with the root of the policy repository, the folder holding policy/.',
  },
  explain_publish_failure: {
    ok: 'fix what it names, commit, and let the pipeline run again on the merge; `check_policy_repo` on the clone catches most of these before a push.',
    refused: 'paste the failed step\'s output into `explain_publish_failure` again, whole.',
  },
  search_docs: {
    ok: 'if nothing here answers the question, `send_feedback` puts it in front of a person at ZIFFER once the developer agrees to send it.',
    refused: 'call `search_docs` with the words the guides use: a refusal name, a variable, a file name.',
  },
  explain_refusal: {
    ok: 'fix what it names; for a receipt refusal, call `explain_receipt` with the receipt and the proposal bytes.',
    refused: 'call `search_docs` with the same name as the query.',
  },
  send_feedback: {
    ok: 'carry on with the step you were on; `get_started` lists the steps in order. The answer reaches the documentation, and hello@ziffer.io reaches the same people.',
    refused: EXPLAIN,
  },
  whoami: {
    ok: 'put this tenant in the proposal\'s `tenant_id`, call `lint_proposal` on it, then `propose` once the developer says go.',
    refused: EXPLAIN,
  },
  explain_policy: {
    ok: 'call `simulate_decision` with one example proposal and the same path to see its verdict.',
    refused: 'call `explain_policy` again with the folder holding risk_functions.json, or the repository root.',
  },
  simulate_decision: {
    ok: 'call `propose` with the same proposal, once the developer says go, for a real decision and a signed receipt.',
    refused: 'fix what it names, or call `lint_proposal` on the proposal to find the field.',
  },
};

/** The next step for one tool's answer, as its own text: `Next: ...`. It is
 * sent as the LAST content block of the answer rather than appended to the
 * first, so the first block stays exactly what the tool returned (the gateway's
 * JSON verbatim, for `propose`), and a client that parses it still can. An
 * unknown tool gets no line, never a generic one. */
export function nextLine(tool: string, outcome: ToolOutcome): string | undefined {
  const step = NEXT_STEPS[tool];
  if (step === undefined) return undefined;
  if (outcome.isError) {
    // Two refusals are about this machine rather than about the input, and the
    // next step for both is the same whichever tool raised them.
    if (/^(?:ApiKey|TrustAnchor|SuiteFloor)Unconfigured: /.test(outcome.text)) return `Next: ${WHILE_WAITING}`;
    if (/^Service(?:Unreachable|AnswerUnreadable): /.test(outcome.text)) return `Next: ${UNREACHABLE}`;
  }
  if (!outcome.isError) {
    const read = fromDecision(tool, outcome.text);
    if (read !== undefined) return `Next: ${read}`;
  }
  return `Next: ${outcome.isError ? step.refused : step.ok}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The next step read off a decision, for the three tools that return one. A
 * DENY, a held action and a verified receipt each lead somewhere different, and
 * the static line cannot know which it is. The answer is read, never trusted:
 * the fields only choose which instruction to show, and every instruction is
 * one of the fixed lines below.
 */
function fromDecision(tool: string, text: string): string | undefined {
  if (tool !== 'propose' && tool !== 'check_decision' && tool !== 'get_decision') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const decision = tool === 'get_decision' && isRecord(parsed['decision']) ? parsed['decision'] : parsed;
  const verification = tool === 'get_decision' && isRecord(parsed['verification']) ? parsed['verification'] : undefined;
  const outcome = decision['outcome'];
  const category = decision['refusal_category'];
  if (outcome === 'DENY') {
    const name = typeof category === 'string' ? category : 'DENY';
    return `the policy refused this action (${name}), and a refusal carries no receipt. Call \`explain_refusal\` with ${name}: it says what it means and who fixes it. The same proposal gets the same answer, so change the proposal or the policy rather than sending it again.`;
  }
  if (decision['status'] === 'pending') {
    return 'no decision yet: call `check_decision` with the same `decision_id` again in a few seconds. Never propose it again: a second proposal is a second action.';
  }
  const hasReceipt = tool === 'get_decision' ? verification?.['status'] !== 'absent' : decision['receipt'] !== undefined;
  if (outcome === 'ATTEST' && !hasReceipt) {
    return 'the action is held for a person the policy names, and its receipt comes once they approve. Call `list_decisions` to see until when it waits, then `get_decision` again with the same `decision_id` and bytes. Never propose it again: a second proposal is a second action.';
  }
  if (tool === 'get_decision' && verification?.['status'] === 'verified') {
    return 'the receipt verified on this machine, bound to the exact bytes you sent: the application may act. The verify line in its own code makes this same check before every action; call `check_integration` to confirm every propose call site has it.';
  }
  return undefined;
}

/** After a refusal for a value ZIFFER issues and this machine has not set. */
const WHILE_WAITING =
  'ask ZIFFER for the values as the answer above says; meanwhile carry on with the steps that need none, from `scan` through `simulate_decision` (the `setup_ziffer` prompt lists them in order), and call this tool again once the values are set.';

/** After the service did not answer. */
const UNREACHABLE =
  'check the three things listed above, then call this tool again; `whoami` is the smallest call to try it with.';
