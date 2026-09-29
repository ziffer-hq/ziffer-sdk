/**
 * ACP-454: an irreversible effect keyword counts only where it names the
 * tool's OWN action -- its name, or the head verb of a clause of the
 * description's first sentence. The false positives are the 0.2.3 run's own
 * (a security reader stops at "whoami can revoke, irreversible"); the true
 * positives are the shapes the rule must keep.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { CatalogTool, Classification } from '../types.js';
import { tool } from './fixtures/tool.js';
import { classify, effectClass } from './index.js';

const DASH = String.fromCodePoint(0x2014);
const SECTION = String.fromCodePoint(0x00a7);

function one(t: CatalogTool): Classification | undefined {
  return classify([t]).classifications[0];
}

interface FalsePositive {
  label: string;
  entry: CatalogTool;
  /** The verb the 0.2.3 report wrongly graded the tool as doing. */
  verb: string;
  /** The draft after the rule: write and read keywords still match the whole text, so a later "written" or "added" is a write. */
  effect: 'read' | 'write' | null;
  /** Set only where an EGRESS keyword legitimately fires in the name, a parameter or the first sentence. */
  reason?: string;
}

const FALSE_POSITIVES: FalsePositive[] = [
  {
    label: 'ziffer . whoami ("can revoke")',
    verb: 'revok',
    effect: 'read',
    // Copied from packages/mcp/src/server.ts, the `whoami` registration.
    entry: tool(
      'Claude Code',
      'ziffer',
      'whoami',
      'Ask the gateway which tenant the configured API key is bound to and until when the key ' +
        'is accepted, and return the answer verbatim. Two facts and no more: it serves no policy, ' +
        'no epoch and no attester names, because nothing an SDK call does needs them. Use it ' +
        `before writing a tenant_id into a proposal ${DASH} the KEY determines the tenant and a ` +
        'proposal naming a different one is refused (TenantMismatch), never rewritten. A 401 ' +
        'ApiKeyUnknown here covers expired, revoked and never-minted alike and does NOT mean the ' +
        'key expired.',
      [],
    ),
  },
  {
    label: 'ziffer . get_started ("can publish")',
    verb: 'publish',
    effect: 'read',
    // Copied from packages/mcp/src/server.ts, the `get_started` registration.
    entry: tool(
      'Claude Code',
      'ziffer',
      'get_started',
      'Call this FIRST when a developer wants to add ZIFFER and nothing exists yet. Returns the ' +
        'steps in the order they happen: the local scan to run first, where an account comes from, the install command for ' +
        'each language at the version we publish, the environment variables and where each value ' +
        'comes from, the six-line wrap around the line that acts, and which tool to call next. ' +
        'Needs no configuration and takes no arguments, so it answers before any key exists. The ' +
        'install versions and the variable table are read out of this repository at build time ' +
        'rather than written here, so they cannot be the ones that were true last release.',
      [],
    ),
  },
  {
    label: 'ziffer . simulate_decision ("can remove")',
    verb: 'remov',
    effect: 'read',
    // Copied from packages/mcp/src/server.ts, the `simulate_decision` registration.
    entry: tool(
      'Claude Code',
      'ziffer',
      'simulate_decision',
      'Grade one wire Proposal against a policy tree on this machine and return the verdict ' +
        `and the clause ${DASH} the same ${SECTION}8.4 fold the gateway runs, through \`ziffer decide ` +
        '--unsigned`. Nothing is signed, uploaded or sent: the proposal is written to a ' +
        'temporary file, graded offline and the file is removed. A REFUSED answer is a real ' +
        'answer, not a tool failure. PASSED means the grade found nothing ' +
        `${DASH} no receipt was ` +
        'checked, no quorum counted and no approval door run, so it is not permission to act.',
      ['proposal', 'path'],
    ),
  },
  {
    label: 'stripe . stripe_analytics ("can charge")',
    verb: 'charg',
    effect: 'read',
    // The head of the Stripe MCP server's own `stripe_analytics` description, as its tool list shows it.
    entry: tool(
      'Claude Code',
      'stripe',
      'stripe_analytics',
      'This tool is for analyzing Stripe Sigma and Metrics data (e.g. about revenue, charges, products, invoices, ' +
        'subscriptions, disputes, transactions, tax tables, payments etc) and running SQL-based reporting queries. ' +
        'Use it for historical analytics, aggregations, and business intelligence questions (e.g. MRR, churn, ' +
        'cohorts, revenue trends). Prefer this tool over making multiple Stripe API calls that would need to be ' +
        'joined or aggregated client-side.\n## SQL Query Runs\n\n**execute_query_run**: Runs a SQL query (Trino) ' +
        'against reporting tables. Requires `sql`. Returns a QueryRun object; use retrieve_query_run to poll.',
      ['intent', 'params'],
    ),
  },
  {
    label: 'awspricing . get_pricing ("can remove")',
    verb: 'remov',
    effect: 'read',
    // The head of the AWS pricing MCP server's `get_pricing` description (it opens with a newline), plus a
    // later sentence of the same shape naming the verb the 0.2.3 run matched further down.
    entry: tool(
      'Claude Code',
      'awspricing',
      'get_pricing',
      '\n    Get detailed pricing information from AWS Price List API with optional filters.\n\n' +
        '    **PARAMETERS:**\n    - service_code (required): AWS service code\n' +
        '    - output_options (optional): removes free products and unused terms to reduce response size',
      ['service_code', 'region', 'filters', 'max_allowed_characters', 'output_options', 'max_results', 'next_token'],
    ),
  },
  {
    label: 'code-review-graph . query_graph_tool ("can publish")',
    verb: 'publish',
    effect: 'read',
    // Written in the shape of the real one: the server's tool list was not at hand.
    entry: tool(
      'Claude Code',
      'code-review-graph',
      'query_graph_tool',
      'Query the code graph for the callers, callees and tests of a symbol. Use it before you publish a ' +
        'change, to see what the change can break.',
      ['pattern', 'target'],
    ),
  },
  {
    label: 'sentry . get_sentry_resource ("can remove")',
    verb: 'remov',
    effect: 'read',
    reason: 'description says "Fetch a Sentry"',
    // The head of the Sentry MCP server's own `get_sentry_resource` description, as its tool list shows it.
    entry: tool(
      'Claude Code',
      'sentry',
      'get_sentry_resource',
      'Fetch a Sentry resource by URL, or by resourceType plus resourceId.\nPass a Sentry URL directly when ' +
        'possible; the resource type is auto-detected.\n\nFor preprod snapshot URLs:\n- Without ?selectedSnapshot=: ' +
        'returns the snapshot diff summary (changed, added, removed images)',
      ['organizationSlug', 'resourceId', 'resourceType', 'url'],
    ),
  },
  {
    label: 'aws-pricing-calculator . build_estimate ("can transfer")',
    verb: 'transfer',
    effect: 'write',
    reason: 'description says "URL"',
    // The head of the AWS pricing calculator MCP server's own `build_estimate` description.
    entry: tool(
      'Claude Code',
      'aws-pricing-calculator',
      'build_estimate',
      'One-shot: create an estimate, add services, lint-preflight, save, and return the calculator URL. Replaces ' +
        'three separate calls (create_estimate + add_service + export_estimate).\n\nIMPORTANT: For EC2 Dedicated ' +
        'Hosts, use service code "ec2Enhancement" with tenancy: "host" in the config. This produces the full ' +
        'Dedicated Host estimate with EBS storage, pricing strategies, and data transfer.',
      ['name', 'partition', 'services'],
    ),
  },
];

for (const fp of FALSE_POSITIVES) {
  test(`false positive: ${fp.label} is not irreversible`, () => {
    const out = classify([fp.entry]);
    const c = out.classifications[0];
    assert.equal(c?.effect ?? null, fp.effect, JSON.stringify(c));
    assert.ok(!(c?.matched ?? []).some((m) => m.startsWith('effect.irreversible:')), JSON.stringify(c?.matched));
    assert.equal(c?.reason, fp.reason);
    assert.ok(!(c?.reason ?? '').toLowerCase().includes(fp.verb), `reason names "${fp.verb}": ${c?.reason}`);
    assert.deepEqual(out.findings.filter((f) => f.kind === 'irreversible'), []);
    assert.equal(effectClass(fp.entry), 0);
  });
}

const TRUE_POSITIVES: { entry: CatalogTool; reason: string; cls: number }[] = [
  {
    entry: tool('Claude Code', 'db-prod-pgvector', 'execute_sql', 'Execute a SQL statement against the database.', ['sql']),
    reason: 'name says "execute"',
    cls: 3,
  },
  { entry: tool('Claude Code', 'backup', 'delete_backups', 'Deletes the selected backups.', ['backup_ids']), reason: 'name says "delete"', cls: 3 },
  {
    entry: tool('Claude Code', 'gmail', 'send_email', 'Send an email to the given recipients.', ['to', 'subject', 'body']),
    reason: 'name says "send"',
    cls: 1,
  },
  {
    entry: tool('Claude Code', 'github', 'merge_pull_request', 'Merges a pull request into its base branch.', ['owner', 'repo', 'pull_number']),
    reason: 'name says "merge"',
    cls: 2,
  },
  { entry: tool('Claude Code', 'crm', 'records', 'Deletes the record permanently.', ['id']), reason: 'description says "Deletes the record"', cls: 3 },
  { entry: tool('Claude Code', 'mailer', 'compose', 'Send an email to one recipient.', ['to']), reason: 'description says "Send an email"', cls: 1 },
  { entry: tool('Claude Code', 'files', 'file_tool', 'Permanently removes the file at a path.', ['path']), reason: 'description says "Permanently removes the"', cls: 3 },
  { entry: tool('Cursor', 'terminal', 'console', 'Run a shell command on this machine.', ['command']), reason: 'description says "Run a shell command"', cls: 3 },
  {
    entry: tool('Claude Code', 'auth', 'session_tool', 'Looks up the user, and deletes the session.', ['user']),
    reason: 'description says "deletes the session"',
    cls: 3,
  },
];

for (const tp of TRUE_POSITIVES) {
  test(`true positive: ${tp.entry.server} . ${tp.entry.tool} is irreversible, and says why`, () => {
    const c = one(tp.entry);
    assert.equal(c?.effect, 'irreversible', JSON.stringify(c));
    assert.equal(c?.reason, tp.reason);
    assert.equal(effectClass(tp.entry), tp.cls);
  });
}

test('the fixture home\'s send_email (echo-server.mjs: no description, no parameters) on inbox, mail and notes', () => {
  // fixtures/mcp/echo-server.mjs lists `send_email` with no description and an empty input schema.
  const out = classify(['inbox', 'mail', 'notes'].map((s) => tool('Claude Code', s, 'send_email', '', [])));
  assert.equal(out.classifications.length, 3);
  for (const c of out.classifications) {
    assert.equal(c.effect, 'irreversible');
    assert.equal(c.egress, true);
    assert.equal(c.reason, 'name says "send"');
  }
});

test('a parameter name alone never makes a tool irreversible', () => {
  const c = one(tool('Claude Code', 'ziffer', 'whoami', 'Return the tenant this key is bound to.', ['revoke_reason', 'delete_after']));
  assert.notEqual(c?.effect, 'irreversible');
  assert.equal(c?.reason, undefined);
});

test('an irreversible verb that is not a clause head does not count', () => {
  // "delete" is the object of "before", not the tool's action.
  const c = one(tool('Claude Code', 'repo', 'list_branches', 'Lists branches you may want to delete.', []));
  assert.equal(c?.effect, 'read');
  assert.equal(c?.reason, undefined);
});

test('an egress keyword in a later sentence raises no egress flag; in a parameter name it does, and says where', () => {
  const later = one(tool('Claude Code', 'reports', 'get_report', 'Returns the report. Upload it to the portal yourself afterwards.', ['id']));
  assert.equal(later?.egress, false);
  assert.equal(later?.reason, undefined);
  const param = one(tool('Claude Code', 'vault', 'read_secret', 'Returns a secret.', ['webhook_url']));
  assert.equal(param?.egress, true);
  assert.equal(param?.reason, 'parameter "webhook_url" says "webhook"');
});

test('a keyword after a read verb in the NAME is its object, not its action', () => {
  for (const name of ['explain_publish_failure', 'get_publish_status', 'list_deploy_targets', 'simulate_send']) {
    const c = one(tool('Claude Code', 'ziffer', name, '', []));
    assert.notEqual(c?.effect, 'irreversible', `${name}: ${JSON.stringify(c)}`);
    assert.equal(c?.reason, undefined, name);
  }
});

test('a keyword at the name\'s first word, or after a word that is not a read verb, still counts', () => {
  const cases: [string, string][] = [
    ['admin_delete_user', 'name says "delete"'],
    // "push" is also an egress keyword, so the egress reason is joined to the irreversible one.
    ['force_push', 'name says "force push"; name says "push"'],
    ['execute_sql', 'name says "execute"'],
  ];
  for (const [name, reason] of cases) {
    const c = one(tool('Claude Code', 'ops', name, '', []));
    assert.equal(c?.effect, 'irreversible', name);
    assert.equal(c?.reason, reason, name);
  }
});

// ACP-455: a write keyword counts only as the tool's own action, like an irreversible one.
// These descriptions are the first customer's shape: prompts that quote what a person
// might say ("set", "reply", "edit") while the tool itself only reads.
const PROMPT_READS: { tool: string; description: string; params: string[] }[] = [
  { tool: 'getRevenueTrend', description: 'Get revenue for a rolling window. Use when the manager asks "how did we do?", then reply with the numbers.', params: ['period'] },
  { tool: 'listConversations', description: 'List recent guest conversations in the inbox. Use when asked "any unanswered messages?"; set status to filter.', params: ['status'] },
  { tool: 'getVerificationStatus', description: 'Check whether the listing is verified. Explain how to edit the profile if it is not.', params: [] },
];
for (const r of PROMPT_READS) {
  test(`a read tool whose description quotes write words is a read: ${r.tool}`, () => {
    const c = classify([{ client: 'app', server: 'app', tool: r.tool, description: r.description, params: r.params, source_path: 'x.ts' }]).classifications[0];
    assert.equal(c?.effect, 'read', JSON.stringify(c));
  });
}
test('a tool whose name or first head verb writes is still a write', () => {
  const byName = classify([{ client: 'app', server: 'app', tool: 'updateGuestCount', description: 'Change the number of guests.', params: ['count'], source_path: 'x.ts' }]).classifications[0];
  assert.equal(byName?.effect, 'write');
  const byHead = classify([{ client: 'app', server: 'app', tool: 'guest_note', description: 'Add a private note to a conversation.', params: ['note'], source_path: 'x.ts' }]).classifications[0];
  assert.equal(byHead?.effect, 'write');
});

// ACP-455: the first customer's `prospector_*` tools. `prospector` is a namespace, not a
// verb; the action starts at `classify` / `route`, which are neutral: the rest of the name
// is their object. `classify_reply` classifies a reply, it does not reply.
test('a namespace prefix gives way to the first verb, and a neutral verb makes the rest of the name its object', () => {
  const classifyReply = one(tool('app', 'app', 'prospector_classify_reply',
    'Classify an inbound reply as positive / not_interested / ooo / unsubscribe / wrong_person / spam with confidence 0.0-1.0. Writes outreach_replies.classification.',
    ['reply_id']));
  assert.ok(classifyReply !== undefined);
  assert.notEqual(classifyReply.effect, 'irreversible');
  assert.equal(classifyReply.effect, 'write', 'the description says it writes the classification');
  assert.ok(!classifyReply.matched.includes('effect.write:reply') || !(classifyReply.reason ?? '').includes('name says'), JSON.stringify(classifyReply));
  assert.equal(classifyReply.egress, false, `reply_id names a reply, it sends nothing: ${classifyReply.reason ?? ''}`);
  const route = one(tool('app', 'app', 'prospector_route_positive_reply', '', ['reply_id', 'action']));
  assert.ok(!(route?.reason ?? '').includes('name says "reply"'), JSON.stringify(route));
  assert.equal(route?.egress, false);
  // A namespace before a read verb reads.
  assert.equal(one(tool('app', 'app', 'acme_get_status', '', []))?.effect, 'read');
  // A namespace before an irreversible verb is still irreversible, as is a non-read first word.
  assert.equal(one(tool('app', 'app', 'prospector_delete_lead', '', []))?.effect, 'irreversible');
  assert.equal(one(tool('ops', 'ops', 'admin_delete_user', '', []))?.reason, 'name says "delete"');
  // No object after the verb: the first word stays the head (`build` is a verb no list holds).
  assert.notEqual(one(tool('app', 'app', 'build_estimate', '', []))?.effect, 'read');
});

test('a parameter naming an identifier makes no egress; a parameter naming a destination still does', () => {
  assert.equal(one(tool('app', 'app', 'lookup_thread', 'Look up a thread.', ['reply_id']))?.egress, false);
  assert.equal(one(tool('app', 'app', 'lookup_thread', 'Look up a thread.', ['webhook_url']))?.egress, true);
});

// ACP-455 second pass: a verb the draft does not know is never a read, whatever its
// description quotes (P-4: unknown is never LOW). The first customer's application had
// these four graded LOW and run with nobody asked.
const UNKNOWN_VERBS: { tool: string; description: string }[] = [
  { tool: 'changeReservationRoom', description: 'Move a booking to another room. Check availability first and show the guest the new room.' },
  { tool: 'extendOtaStay', description: 'Extend a stay booked through an OTA; get the new checkout date from the guest.' },
  { tool: 'reportNoShowToOta', description: 'Tell the channel the guest did not arrive. Check the booking status first.' },
  { tool: 'runWorkflow', description: 'Runs a saved workflow by name and returns its status.' },
];
for (const u of UNKNOWN_VERBS) {
  test(`an unknown verb is never a read, whatever the description quotes: ${u.tool}`, () => {
    const c = classify([{ client: 'app', server: 'app', tool: u.tool, description: u.description, params: [], source_path: 'x.ts' }]).classifications[0];
    assert.notEqual(c?.effect, 'read', JSON.stringify(c));
  });
}
