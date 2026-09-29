/**
 * A `CodeSection` a renderer test can hold still (ACP-455 `--code`), in the
 * shape of the first application the mode was built for: one app-local tool
 * factory, tools exposed to the AI SDK in a loop gated by a database, and ONE
 * dispatcher every tool runs through, called from the model path and from two
 * human-confirmed paths.
 *
 * `counts.tools` is 88 and `verdicts` lists nine on purpose: the renderers
 * print the counts without recounting and must SAY the table is nine of
 * eighty-eight, so the fixture is the case that proves they do. The verdicts
 * are shaped as `decide` returns them (`CiVerdict`); nothing here was graded.
 *
 * Named `*.test.data.ts`, as `fixture.test.data.ts` is, so the published tarball
 * leaves it out and `node --test` does not run it. The
 * snippet is illustrative, the front end writes the real one.
 */

import type { CiVerdict } from '../ci/ci.js';
import type { CodeSection, CodeTool, CodeToolVerdict, SourceRef } from '../code/types.js';

const at = (file: string, line: number, col = 1): SourceRef => ({ file, line, col });

const HANDLERS = 'api/src/lib/agents/tools/handlers';
const VIA_LOCAL = 'defineTool() (app-local factory, returns an Anthropic Tool input schema)';
const EXECUTOR = at('api/src/lib/agents/tools/tool-executor.ts', 56, 23);

function handler(name: string, file: string, line: number, description: string, params: string[]): CodeTool {
  return {
    name,
    description,
    schema_kind: 'zod',
    params,
    sdk: 'local',
    via: VIA_LOCAL,
    defined_at: at(`${HANDLERS}/${file}`, line, 21),
    execute_at: at(`${HANDLERS}/${file}`, line + 14, 3),
    delegates_to: 'executeTool',
  };
}

const attest = (risk: 'LOW' | 'MEDIUM' | 'HIGH', reversibility: 'REVERSIBLE' | 'IRREVERSIBLE', tool: string): CiVerdict => ({
  verdict: 'ATTEST',
  risk,
  reversibility,
  effective_tier: 'T2',
  rule_id: `rule:${tool}`,
});
const allow = (tool: string): CiVerdict => ({
  verdict: 'ALLOW',
  risk: 'LOW',
  reversibility: 'REVERSIBLE',
  effective_tier: 'T1',
  rule_id: `rule:${tool}`,
});
const refused = (message: string): CiVerdict => ({ verdict: 'REFUSED', clause: '8.4-3', message });

const TOOLS: CodeTool[] = [
  handler('get_property', 'get-property.ts', 9, 'Read one property by id: name, address, rooms, rates.', ['property_id']),
  handler('cancel_reservation', 'cancel-reservation.ts', 12, 'Cancel a guest reservation and release the room.', ['reservation_id', 'reason']),
  handler('add_charge', 'add-charge.ts', 11, 'Add a charge to a guest folio.', ['reservation_id', 'amount', 'currency', 'label']),
  handler('delete_gbp_post', 'delete-gbp-post.ts', 10, 'Delete a post from the Google Business Profile.', ['location_id', 'post_id']),
  handler('send_guest_message', 'send-guest-message.ts', 14, 'Send a message to a guest by email or SMS.', ['reservation_id', 'channel', 'body']),
  handler('update_rate_plan', 'update-rate-plan.ts', 13, 'Change the nightly rate of a rate plan for a date range.', ['rate_plan_id', 'from', 'to', 'amount']),
  handler('list_reservations', 'list-reservations.ts', 9, 'List reservations for a date range.', ['from', 'to']),
  handler('update_note', 'update-note.ts', 10, 'Overwrite the internal note on a reservation.', ['reservation_id', 'note']),
  handler('refund_payment', 'refund-payment.ts', 12, 'Refund a captured card payment, fully or in part.', ['payment_id', 'amount']),
];

function tool(name: string): CodeTool {
  const t = TOOLS.find((x) => x.name === name);
  if (t === undefined) throw new Error(`fixture: no tool ${name}`);
  return t;
}

const VERDICTS: CodeToolVerdict[] = [
  { tool: tool('get_property'), verdict: allow('get_property'), what_ziffer_does: 'runs, recorded', untrusted_input: false, egress: false },
  {
    tool: tool('cancel_reservation'),
    verdict: attest('HIGH', 'IRREVERSIBLE', 'cancel_reservation'),
    what_ziffer_does: 'held for a human before it runs',
    draft_reason: 'name says "cancel"',
    untrusted_input: false, egress: false, irreversible_class: 2,
  },
  {
    tool: tool('add_charge'),
    verdict: attest('HIGH', 'REVERSIBLE', 'add_charge'),
    what_ziffer_does: 'held for a human before it runs',
    draft_reason: 'description says "Add a charge to a guest folio"',
    untrusted_input: false, egress: false, irreversible_class: 1,
  },
  {
    tool: tool('delete_gbp_post'),
    verdict: refused('no risk function applies to this task type'),
    what_ziffer_does: 'refused: no risk function drafted',
    draft_reason: 'name says "delete"',
    untrusted_input: false, egress: false, irreversible_class: 3,
  },
  {
    tool: tool('send_guest_message'),
    verdict: attest('MEDIUM', 'IRREVERSIBLE', 'send_guest_message'),
    what_ziffer_does: 'held for a human before it runs',
    draft_reason: 'description says "Send a message to a guest"; sends data off the application',
    untrusted_input: true, untrusted_words: ['message'], egress: true, irreversible_class: 1,
  },
  {
    tool: tool('update_note'),
    verdict: { verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: 'rule:update_note' },
    what_ziffer_does: 'runs after a notice to the notice addressee; nobody is asked first',
    draft_reason: 'description says "Overwrite"',
    untrusted_input: false, egress: false,
  },
  { tool: tool('update_rate_plan'), verdict: allow('update_rate_plan'), what_ziffer_does: 'recorded with a signed receipt', untrusted_input: false, egress: false },
  { tool: tool('list_reservations'), verdict: allow('list_reservations'), what_ziffer_does: 'runs, recorded', untrusted_input: false, egress: false },
  {
    tool: tool('refund_payment'),
    verdict: attest('HIGH', 'IRREVERSIBLE', 'refund_payment'),
    what_ziffer_does: 'held for a human before it runs',
    draft_reason: 'name says "refund"',
    untrusted_input: false, egress: false, irreversible_class: 1,
  },
];

const DISPATCHER = {
  name: 'executeTool',
  at: EXECUTOR,
  signature: '(name, input, ctx, abortSignal)',
  callers: [
    at('api/src/lib/orchestrator/tool-bridge.ts', 334, 20),
    at('api/src/routes/console/lodging-veo.ts', 1262, 28),
    at('api/src/lib/agents/decorators/prospector-decision-logger.ts', 67, 18),
  ],
  tools_delegating: 88,
};

/** Illustrative, as the grader writes it: the module `call` imports; `<` and `&&` for the escaping tests. */
const SNIPPET = [
  '// ziffer-gate.ts: every tool, on every caller of executeTool, is decided before it runs.',
  "import { ZifferClient, type WireProposal } from '@ziffer-io/client';",
  '',
  "const ziffer = new ZifferClient(process.env.ZIFFER_URL ?? '', process.env.ZIFFER_API_KEY ?? '');",
  '',
  'export class ZifferHeld extends Error {',
  '  constructor(readonly decisionId: string, readonly heldUntil: string) {',
  '    super(`held for approval until ${heldUntil}`);',
  '  }',
  '}',
  '',
  'export async function zifferGate(name: string, input: Record<string, unknown>): Promise<void> {',
  '  const proposal: WireProposal = {',
  "    schema_id: 'example-platform/tools',",
  "    schema_version: '1',",
  '    schema_hash: TOOL_SCHEMA_HASH,',
  "    fidelity: 'F-HIGH',",
  "    tenant_id: process.env.ZIFFER_TENANT ?? '',",
  '    payload: { task_type: name, operator: \'agent\', targets: [name], params: input, cidrs: [] },',
  '  };',
  '  const decision = await ziffer.propose(proposal);',
  '  if (decision.held_until !== undefined) throw new ZifferHeld(decision.decision_id, decision.held_until);',
  "  if (decision.outcome !== 'ALLOW' && decision.outcome !== 'ATTEST') {",
  '    throw new Error(`ZIFFER refused ${name}: ${decision.refusal_category ?? \'no rule\'}`);',
  '  }',
  '}',
].join('\n');

const TYPESCRIPT: 'typescript' = 'typescript';

/** A variable, so the `call` the int branch adds to `Insertion` is carried whichever contract this compiles against. */
const INSERTION = {
  dispatcher: DISPATCHER,
  per_tool: false,
  sentence:
    'One call at the top of executeTool (api/src/lib/agents/tools/tool-executor.ts:56) puts every one of the 88 tools under ZIFFER, on its 3 callers alike.',
  snippet: SNIPPET,
  snippet_language: TYPESCRIPT,
  call: 'await zifferGate(name, input);',
};

/** A variable, so `notified` (contract a765a13) is carried whichever contract this compiles against. 31 + 4 + 12 + 41 = 88. */
const COUNTS = { tools: 88, held: 31, notified: 4, refused: 12, allowed: 41, irreversible: 19 };

export const CODE: CodeSection = {
  catalog: {
    root: '/home/you/work/example-platform',
    package_name: 'example-platform',
    sdks: [
      { name: 'ai', version: '7.0.116' },
      { name: '@anthropic-ai/sdk', version: '0.128.0' },
      { name: '@ai-sdk/anthropic', version: '3.0.44' },
      { name: 'openai', version: '7.23.0' },
      { name: '@google/genai', version: '2.24.0' },
      { name: 'llamaindex', version: '0.12.1' },
      { name: 'zod', version: '4.1.12' },
    ],
    files_read: 412,
    tools: TOOLS,
    exposures: [
      {
        at: at('api/src/lib/orchestrator/tool-bridge.ts', 305, 7),
        via: 'dynamicTool() in a loop',
        kind: 'computed',
        tools: TOOLS.map((t) => t.name),
        note: 'exposure of these tools is decided per location by getActiveTools at runtime; the scan lists what CAN be exposed',
      },
    ],
    dispatchers: [DISPATCHER],
    gates: [
      {
        name: 'getToolsForLocation',
        at: at('api/src/lib/agents/tools/tool-registry.ts', 102, 17),
        note: 'intersects ALL_TOOLS with agentRepository.getActiveTools(locationId, context), a database table',
      },
    ],
    syntax_only: { found: 2, missed: 86 },
    not_seen: [
      'Exposure is decided by data: which of these tools a model gets is enabled per location in a database table, so the scan lists what can be exposed, not what is exposed today.',
      'Declared authority hints are claims: 31 tools carry requires_confirmation; the scan records the flag and the draft policy does not rely on it.',
    ],
  },
  verdicts: VERDICTS,
  insertion: INSERTION,
  counts: COUNTS,
};
