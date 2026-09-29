/**
 * The MCP surface itself: that the twenty-one tools are registered, reachable over
 * a real transport, and that the shapes this server is not allowed to have are
 * absent.
 *
 * `tools.test.ts` asserts what the handlers DO. This file asserts that a client
 * speaking the protocol can reach them — the registration, the schemas and the
 * content framing — because a correct handler that is registered under the
 * wrong name, or whose schema rejects the argument an agent will send, is a
 * server that does nothing and passes every unit test beside it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { VARS, type Env } from './config.js';
import { integrationGuide } from './guide.js';
import { zifferClientFactory } from './client.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { searchDocs } from './docs.js';
import { explainPublishFailure } from './publish-explain.js';
import { explainRefusal, refusalTable } from './refusals.js';
import { policyRepoGuide } from './repo-guide.js';
import { createServer, SERVER_INFO, TOOL_NAMES } from './server.js';
import { readFileSync } from 'node:fs';
import { getStarted } from './started.js';
import { lintProposal } from './proposal-lint.js';
import type { ClientFactory } from './tools.js';

const ENV: Env = {
  [VARS.API_URL]: 'https://api.example.test',
  [VARS.API_KEY]: 'zfr_' + 'a'.repeat(43),
};

const STUB: ClientFactory = async () => ({
  propose: async () => ({ decision_id: '01j0abc', status: 'pending' as const }),
  decision: async () => ({ decision_id: '01j0abc', status: 'decided' as const, outcome: 'ALLOW' }),
  list: async () => ({
    items: [
      {
        decision_id: '01j0abc',
        status: 'decided' as const,
        receipt: 'attached' as const,
        created_at: '2026-09-21T18:00:00Z',
        waiting: false,
        outcome: 'ALLOW',
      },
    ],
    next_cursor: null,
  }),
  feedback: async () => ({ stored: true, tenant: 'acme' }),
  whoami: async () => ({ tenant_id: 'acme-corp', key_expires_at: '2026-12-01T00:00:00Z' }),
});

/** A connected client/server pair over the SDK's in-process transport. */
async function connect(env: Env = ENV, clientFor: ClientFactory = STUB): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ env, clientFor });
  const client = new Client({ name: 'ziffer-mcp-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** One text block's text, with its framing checked. */
function blockText(block: unknown): string {
  assert.ok(typeof block === 'object' && block !== null, 'content block is not an object');
  const fields: Record<string, unknown> = { ...block };
  assert.equal(fields['type'], 'text');
  const text = fields['text'];
  assert.equal(typeof text, 'string');
  return String(text);
}

/** A call the SDK refused against the tool's input schema, before the handler
 * ran. Its answer is the SDK's own validation message in one block, and it
 * carries no next step, because no tool answered. */
function rejectedBySchema(result: unknown): boolean {
  assert.ok(typeof result === 'object' && result !== null, 'result is not an object');
  const record: Record<string, unknown> = { ...result };
  const content = record['content'];
  assert.ok(Array.isArray(content) && content.length === 1, 'a schema refusal is one block');
  assert.match(blockText(content[0]), /validation|Invalid/i, 'the one block is not a schema refusal');
  return record['isError'] === true;
}

/** The text of a tool result, with the framing checked on the way through: the
 * tool's own answer in the first block, exactly as the handler returned it, and
 * its next step in the second and last (ACP-467). A tool whose answer had no
 * next step, or had it folded into the first block, fails here by name. */
function textOf(result: unknown): { text: string; isError: boolean; next: string } {
  assert.ok(typeof result === 'object' && result !== null, 'result is not an object');
  const record: Record<string, unknown> = { ...result };
  const content = record['content'];
  assert.ok(
    Array.isArray(content) && content.length === 2,
    'expected two content blocks: the answer, then its next step',
  );
  const text = blockText(content[0]);
  const next = blockText(content[1]);
  assert.match(next, /^Next: \S/, 'the last block is not a next step');
  assert.doesNotMatch(text, /\n\nNext: /, 'the next step was folded into the answer');
  return { text, isError: record['isError'] === true, next };
}

test('the version a client sees is the one the manifest publishes, not a literal', async () => {
  // The manifest is read from disk here, independently of how server.ts reads
  // it, so a regression to a literal in either place is a mismatch this test
  // names. `0.0.0` is asserted against by value as well: it is the literal the
  // server shipped with through 0.1.1, and a manifest that said `0.0.0` would
  // make the first assertion pass for the wrong reason.
  const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.ok(typeof parsed === 'object' && parsed !== null, 'package.json is not an object');
  const fields: Record<string, unknown> = { ...parsed };
  const declared = fields['version'];
  assert.equal(typeof declared, 'string');
  assert.notEqual(declared, '0.0.0');
  assert.equal(SERVER_INFO.version, declared);
  const client = await connect();
  const seen = client.getServerVersion();
  assert.ok(seen !== undefined, 'the server announced no implementation');
  assert.equal(seen.name, 'ziffer');
  assert.equal(seen.version, declared);
});

test('exactly the twenty-one tools are registered, under the names the runbook fixes', async () => {
  const client = await connect();
  const listed = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(listed, [...TOOL_NAMES].sort());
});

test('no tool is named as one that writes, executes or approves', async () => {
  // Read the name of this test literally: it is a check on the NAMES, and it
  // was called "no tool writes files, runs commands, or approves anything"
  // until ACP-389, which was a claim a name check never made. Writing and
  // approving are still absent from this package outright; running a command
  // is not, because `check_policy_repo` runs `ziffer list` and `ziffer decide
  // --unsigned` through execFile. The forbidden shapes are unchanged and so is
  // every assertion below; the sentence describing them was wrong the moment
  // the third tool landed, and a false comment above a true assertion is how a
  // reader comes away believing the wrong boundary. `repo-check.ts` states the
  // real one where the code is.
  //
  // An auto-approve tool would be a fake receipt factory on a developer's
  // laptop, which is the artifact this product exists to prevent; a
  // file-writing tool would make this process an editor with none of an
  // editor's review surface. A name check is what would notice one being added
  // back.
  //
  // `sandbox` left this list when ACP-213 landed, and the reason is not that
  // the rule relaxed: a Ziffer sandbox is a SEPARATE TENANT approved by a
  // service inside the deployment, so there is a truthful thing for a client to
  // report and still nothing for it to approve. The forbidden shape is
  // approval, so that is what is asserted -- plus the narrower rule that
  // anything naming the sandbox may only ever be a `_status` reader whose
  // description says it approves nothing. A blanket ban on the word would have
  // been easier to keep and would have stopped saying anything true.
  //
  // `simulat` left the blanket list when ACP-391 landed, and the reason is the
  // one `sandbox` left it for. The forbidden artifact is a SIMULATED APPROVAL
  // -- a verdict this laptop invented and an agent treats as a decision --
  // and `simulate_decision` is not one: it runs the customer's own `ziffer
  // decide --unsigned`, which is the same §8.4 fold the gateway runs, over a
  // tree on this machine. It mints nothing. What replaces the word ban is a
  // NARROWER rule asserted below, and it says more rather than less: anything
  // named `simulat*` must be the grader, must say in its own description that
  // it signs, uploads and sends nothing, and must say that PASSED is not
  // permission to act. A tool that quietly stopped saying either of those is a
  // red suite.
  const client = await connect();
  for (const tool of (await client.listTools()).tools) {
    assert.doesNotMatch(
      tool.name,
      /approve|attest|write|edit|exec|shell|file/i,
      `${tool.name} looks like a tool this server is not allowed to have`,
    );
    if (/sandbox/i.test(tool.name)) {
      assert.match(tool.name, /_status$/, `${tool.name} is a sandbox tool that is not a reader`);
      assert.match(
        tool.description ?? '',
        /APPROVES NOTHING/,
        `${tool.name} does not tell a model that it approves nothing`,
      );
    }
    if (/simulat/i.test(tool.name)) {
      assert.equal(
        tool.name,
        'simulate_decision',
        `${tool.name} is a second simulating tool, and one grader is the rule`,
      );
      assert.match(
        tool.description ?? '',
        /Nothing is signed, uploaded or sent/,
        `${tool.name} does not tell a model that it mints nothing`,
      );
      assert.match(
        tool.description ?? '',
        /not permission to act/,
        `${tool.name} does not tell a model that a PASSED grade is not an approval`,
      );
    }
  }
});

test('every tool advertises a description an agent can act on', async () => {
  const client = await connect();
  for (const tool of (await client.listTools()).tools) {
    assert.ok((tool.description ?? '').length > 80, `${tool.name} has no usable description`);
  }
});

test('get_integration_guide serves the doc over the protocol', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'get_integration_guide', arguments: { language: 'typescript' } }),
  );
  assert.equal(out.isError, false);
  assert.equal(out.text, integrationGuide('typescript'));
});

test('an unknown language is rejected by the schema, before the handler', async () => {
  // z.enum is the contract: an agent that guesses "rust" should be told by the
  // protocol rather than reaching a handler that has to re-check the same
  // thing. Both layers refuse -- this asserts the outer one exists.
  const client = await connect();
  const result = await client.callTool({
    name: 'get_integration_guide',
    arguments: { language: 'rust' },
  });
  assert.ok(
    rejectedBySchema(result),
    'an unknown language reached the handler without the schema objecting',
  );
});

test('propose reaches the handler and its response comes back verbatim', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({
      name: 'propose',
      arguments: { proposal: { schema_id: 'x', tenant_id: 't1', payload: {} } },
    }),
  );
  assert.equal(out.isError, false);
  assert.deepEqual(JSON.parse(out.text), { decision_id: '01j0abc', status: 'pending' });
});

test('check_decision reaches the handler with its id', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'check_decision', arguments: { decision_id: '01j0abc' } }),
  );
  assert.equal(out.isError, false);
  assert.equal(JSON.parse(out.text).outcome, 'ALLOW');
});

test('the server starts and answers with NOTHING configured', async () => {
  // The inversion `config.ts` argues for, asserted rather than described: an
  // MCP server that exits during the handshake tells the agent only that it
  // failed to start, and the missing variable dies on a stderr nobody reads.
  // The PRODUCTION factory, not the stub: the stub answers without consulting
  // the environment, so using it here would assert nothing about what an
  // unconfigured server does -- it would test the stub.
  const client = await connect({}, zifferClientFactory);
  assert.equal((await client.listTools()).tools.length, TOOL_NAMES.length);

  // The tool needing nothing still works...
  const guide = textOf(
    await client.callTool({ name: 'get_integration_guide', arguments: { language: 'python' } }),
  );
  assert.equal(guide.isError, false);

  // ...and the ones needing configuration name the variable to set instead of
  // proceeding. Failing closed did not become failing open.
  const proposed = textOf(
    await client.callTool({ name: 'propose', arguments: { proposal: {} } }),
  );
  assert.equal(proposed.isError, true);
  // The address has a default (ACP-467); the key does not, and nothing was sent.
  assert.match(proposed.text, new RegExp(`Set ${VARS.API_KEY}\\.`));
  assert.match(proposed.text, /hello@ziffer\.io/, 'the refusal does not say how to get a key');
  assert.match(proposed.next, /steps that need none, from `scan`/, 'an unconfigured propose does not say what to do meanwhile');

  const explained = textOf(
    await client.callTool({
      name: 'explain_receipt',
      arguments: { receipt: {}, proposal_b64: 'AAAA' },
    }),
  );
  assert.equal(explained.isError, true);
  assert.match(explained.text, new RegExp(`Set ${VARS.TRUST_ANCHOR}\\.`));
  assert.match(explained.text, /hello@ziffer\.io/, 'the anchor refusal does not say where the file comes from');
});

test('explain_receipt accepts an omitted trust_anchor_path as absent, not undefined', async () => {
  // exactOptionalPropertyTypes is on, and the handler spreads the override in
  // conditionally. If it passed `undefined` as a present property instead, the
  // config layer would see a set-but-empty override; this call is what would
  // notice.
  const client = await connect({ [VARS.SUITE_FLOOR]: 'ed25519' });
  const out = textOf(
    await client.callTool({
      name: 'explain_receipt',
      arguments: { receipt: {}, proposal_b64: 'AAAA' },
    }),
  );
  assert.equal(out.isError, true);
  assert.match(out.text, /TrustAnchorUnconfigured/);
});

test('sandbox_status reaches the handler and answers without a decision_id', async () => {
  // The optional argument is genuinely optional over the protocol, and the
  // handler must treat an omitted one as ABSENT rather than as a present
  // undefined (exactOptionalPropertyTypes, as in explain_receipt). If it did
  // not, this call would try to fetch a decision named `undefined`.
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'sandbox_status', arguments: { tenant_id: 'acme-sandbox' } }),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /sandbox: yes, by name/);
  assert.match(out.text, /approver: not checked/);
});

test('sandbox_status passes decision_id through to the gateway leg', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({
      name: 'sandbox_status',
      arguments: { tenant_id: 'acme-sandbox', decision_id: '01j0abc' },
    }),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /decision 01j0abc is decided/);
});

test('get_policy_repo_guide serves the two documents over the protocol, with no arguments', async () => {
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'get_policy_repo_guide', arguments: {} }));
  assert.equal(out.isError, false);
  assert.equal(out.text, policyRepoGuide());
});

test('check_policy_repo reads a real tree over the protocol and reports rather than errors', async () => {
  // Against the shipped template, read only, through the PRODUCTION runner --
  // so this exercises `execFile`'s ENOENT branch on a machine with no `ziffer`
  // and the real one on a machine that has it. Neither outcome is asserted
  // here: what is asserted is that a report comes back and that a report full
  // of findings is not framed as a tool error.
  const client = await connect();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'templates', 'policy-repo');
  const out = textOf(await client.callTool({ name: 'check_policy_repo', arguments: { path: root } }));
  assert.equal(out.isError, false);
  assert.match(out.text, /^check_policy_repo /);
  assert.match(out.text, /RC-1 {2}the workflows are the ones ZIFFER shipped/);
  assert.match(out.text, /\d+ PASS, \d+ FAIL, \d+ NOT CHECKED\./);
});

test('check_policy_repo refuses a path that is not a directory, as a tool error', async () => {
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'check_policy_repo', arguments: { path: '/no/such/tree' } }));
  assert.equal(out.isError, true);
  assert.match(out.text, /^RepoPathUnreadable: /);
});

test('explain_publish_failure reaches the handler with the pasted log', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({
      name: 'explain_publish_failure',
      arguments: { log: 'Answer      : {"refusal":"EPOCH_ROLLBACK"}' },
    }),
  );
  assert.equal(out.isError, false);
  assert.equal(out.text, explainPublishFailure('Answer      : {"refusal":"EPOCH_ROLLBACK"}').text);
  assert.match(out.text, /EPOCH_ROLLBACK/);
});

// ------------------------------------------------------ ACP-390's five tools

test('get_started answers over the protocol, with no arguments and nothing configured', async () => {
  const client = await connect({}, zifferClientFactory);
  const out = textOf(await client.callTool({ name: 'get_started', arguments: {} }));
  assert.equal(out.isError, false);
  assert.equal(out.text, getStarted().text);
});

test('lint_proposal reaches the handler and names the bad field', async () => {
  const client = await connect();
  const proposal = {
    schema_id: 'transfer',
    schema_version: '1.0.0',
    schema_hash: `sha256:${'ab'.repeat(32)}`,
    fidelity: 'F-MAXIMUM',
    tenant_id: 'ten-example',
    payload: {
      task_type: 'transfer',
      operator: 'jane.o',
      targets: ['bank-api'],
      params: {},
      cidrs: {},
    },
  };
  const out = textOf(await client.callTool({ name: 'lint_proposal', arguments: { proposal } }));
  // A finding is the tool working: it was asked to check a proposal and it
  // checked one. Framing it as a tool error teaches an agent to route around
  // the check -- `tools.ts`'s reasoning about a DENY.
  assert.equal(out.isError, false);
  assert.equal(out.text, lintProposal(proposal).text);
  assert.match(out.text, /proposal\.fidelity: "F-MAXIMUM" is not one of/);
});

test('check_integration reads a real tree over the protocol and reports rather than errors', async () => {
  // Against THIS package's own source, deliberately: `integration-check.test.ts`
  // drives the shapes against fixtures, and pointing a finished tool at a real
  // tree is what found the defect that a multi-line signature left every
  // handler undelimited. No outcome is asserted here -- what is asserted is
  // that a report comes back over the transport, that a report full of findings
  // is not framed as a tool error, and that the disclaimer travels with it.
  const client = await connect();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const out = textOf(await client.callTool({ name: 'check_integration', arguments: { path: root } }));
  assert.equal(out.isError, false);
  assert.match(out.text, /^check_integration /);
  assert.match(out.text, /\d+ source file\(s\) read, \d+ of them importing the SDK\./);
  assert.match(out.text, /NOT CHECKED means it could not look\./);
});

test('check_integration refuses a path that is not a directory, as a tool error', async () => {
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'check_integration', arguments: { path: '/no/such/tree' } }));
  assert.equal(out.isError, true);
  assert.match(out.text, /^RepoPathUnreadable: /);
});

test('list_decisions reaches the handler and its page comes back verbatim', async () => {
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'list_decisions', arguments: {} }));
  assert.equal(out.isError, false);
  const parsed: unknown = JSON.parse(out.text);
  assert.ok(typeof parsed === 'object' && parsed !== null);
  const page: Record<string, unknown> = { ...parsed };
  assert.equal(page['next_cursor'], null);
  assert.ok(Array.isArray(page['items']) && page['items'].length === 1);
});

test('list_decisions passes since and limit through without inventing either', async () => {
  // The optional arguments must reach the handler as ABSENT when omitted
  // (exactOptionalPropertyTypes), which is what this call would break if the
  // schema or the handler started spreading `undefined` in.
  const client = await connect();
  const out = textOf(
    await client.callTool({
      name: 'list_decisions',
      arguments: { since: '2026-09-21T18:00:00Z', limit: 5 },
    }),
  );
  assert.equal(out.isError, false);
});

test('get_decision withholds a receipt it could not verify, over the protocol', async () => {
  // The stub answers a decision with no receipt, so the shape asserted here is
  // the composite envelope rather than §1's object: `check_decision` is the
  // verbatim tool and this one is not.
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'get_decision', arguments: { decision_id: '01j0abc' } }));
  assert.equal(out.isError, false);
  const parsed: unknown = JSON.parse(out.text);
  assert.ok(typeof parsed === 'object' && parsed !== null);
  const envelope: Record<string, unknown> = { ...parsed };
  assert.equal('receipt' in envelope, false);
  assert.ok(typeof envelope['verification'] === 'object' && envelope['verification'] !== null);
  const verification: Record<string, unknown> = { ...envelope['verification'] };
  assert.equal(verification['status'], 'absent');
});

test('get_decision accepts an omitted proposal_b64 as absent, not undefined', async () => {
  // exactOptionalPropertyTypes again, and a real consequence: a present
  // `undefined` would reach `decodeProposalB64` as a value to decode.
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'get_decision', arguments: { decision_id: '01j0abc', proposal_b64: 'AAAA' } }),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /"status": "absent"/);
});

test('search_docs serves a whole section over the protocol', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'search_docs', arguments: { query: 'ZIFFER_SUITE_FLOOR', limit: 1 } }),
  );
  assert.equal(out.isError, false);
  assert.equal(out.text, searchDocs('ZIFFER_SUITE_FLOOR', 1).text);
  assert.match(out.text, /docs\/onboarding\/[a-z-]+\.md/);
});

test('search_docs takes its limit as optional, and the schema bounds it', async () => {
  // The default is the handler's, and an omitted argument must reach it as an
  // ABSENT one rather than as a present undefined -- explain_receipt's rule.
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'search_docs', arguments: { query: 'receipt' } }));
  assert.equal(out.isError, false);
  assert.match(out.text, /showing 3\./);

  // And a limit outside the schema's range is refused by the protocol rather
  // than silently clamped by a handler nobody can see.
  const over = await client.callTool({ name: 'search_docs', arguments: { query: 'receipt', limit: 99 } });
  assert.ok(rejectedBySchema(over), 'a limit of 99 reached the handler without the schema objecting');
});

test('explain_refusal serves one row over the protocol', async () => {
  const client = await connect();
  const row = refusalTable()[0];
  assert.ok(row !== undefined);
  const out = textOf(await client.callTool({ name: 'explain_refusal', arguments: { name: row.name } }));
  assert.equal(out.isError, false);
  assert.equal(out.text, explainRefusal(row.name).text);
  assert.ok(out.text.includes(row.whatToDo));
});

test('explain_refusal refuses a name nothing knows, as a tool error', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'explain_refusal', arguments: { name: 'NoSuchRefusal' } }),
  );
  assert.equal(out.isError, true);
  assert.match(out.text, /^RefusalUnknown: /);
});

test('send_feedback reaches the client and reports the tenant the key carried', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({
      name: 'send_feedback',
      arguments: { tool: 'search_docs', question: 'how do I rotate the signing key?' },
    }),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /stored for tenant acme\./);
});

test('send_feedback tells a model, before it calls, that the text leaves the machine', async () => {
  // The description is what a model reads BEFORE deciding to call a tool, so
  // this is the control and the answer's wording is the reminder. A tool that
  // posts a developer's words with a description that does not say so is the
  // defect, whatever the handler does.
  const client = await connect();
  const tool = (await client.listTools()).tools.find((candidate) => candidate.name === 'send_feedback');
  assert.ok(tool !== undefined, 'send_feedback is not registered');
  assert.match(tool.description ?? '', /SENDS TEXT OFF THIS MACHINE/);
  assert.match(tool.description ?? '', /never a key, a token/);
});

test('send_feedback refuses an empty question over the protocol, before any client is built', async () => {
  const client = await connect({}, zifferClientFactory);
  const out = await client.callTool({ name: 'send_feedback', arguments: { tool: 't', question: '' } });
  assert.ok(rejectedBySchema(out), 'an empty question was accepted');
});

test('whoami reaches the handler and the gateway answer comes back verbatim', async () => {
  const client = await connect();
  const out = textOf(await client.callTool({ name: 'whoami', arguments: {} }));
  assert.equal(out.isError, false);
  // The JSON is the gateway's object, unedited, and the prose beneath it names
  // both facts. An agent that reads only the first block still gets the pair.
  assert.deepEqual(JSON.parse(out.text.split('\n\n')[0] ?? ''), {
    tenant_id: 'acme-corp',
    key_expires_at: '2026-12-01T00:00:00Z',
  });
  assert.match(out.text, /bound to acme-corp/);
  assert.match(out.text, /until 2026-12-01T00:00:00Z/);
});

test('whoami takes no arguments at all, so a model cannot name a tenant', async () => {
  // The route has no parameter for a tenant and this schema has none either:
  // an argument an agent could supply here would read as "ask about this
  // customer", and the answer would still be about the key.
  const client = await connect();
  const tool = (await client.listTools()).tools.find((t) => t.name === 'whoami');
  assert.ok(tool !== undefined);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), []);
});

test('explain_policy reads the shipped template over the protocol and reports rather than errors', async () => {
  // The real tree and the PRODUCTION runner, as check_policy_repo's own
  // protocol test does: on a machine with no `ziffer` this exercises the
  // NOT CHECKED branch and on one with it the graded branch. Neither outcome is
  // asserted here -- what is asserted is that a report comes back and that a
  // report full of findings is not framed as a tool error.
  const client = await connect();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'templates', 'policy-repo');
  const out = textOf(await client.callTool({ name: 'explain_policy', arguments: { path: root } }));
  assert.equal(out.isError, false);
  assert.match(out.text, /^explain_policy /);
  assert.match(out.text, /TARGETS/);
});

test('explain_policy refuses a path that holds no policy tree, as a tool error', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({ name: 'explain_policy', arguments: { path: '/no/such/tree' } }),
  );
  assert.equal(out.isError, true);
  assert.match(out.text, /^PolicyPathUnreadable: /);
});

test('simulate_decision reaches the handler with both arguments', async () => {
  const client = await connect();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'templates', 'policy-repo');
  const out = textOf(
    await client.callTool({
      name: 'simulate_decision',
      arguments: {
        path: root,
        proposal: {
          schema_id: 'finance_agent_v1',
          schema_version: '1.0.0',
          schema_hash: `sha256:${'0'.repeat(64)}`,
          fidelity: 'F-HIGH',
          tenant_id: 'ten-example',
          payload: {
            task_type: 'wire_transfer',
            operator: 'finance-agent',
            targets: ['bank-api'],
            params: { amount_eur: 9000, currency: 'EUR', to_account: '48812' },
            cidrs: {},
          },
        },
      },
    }),
  );
  assert.equal(out.isError, false);
  assert.match(out.text, /^simulate_decision /);
});

test('simulate_decision refuses a path that holds no policy tree, as a tool error', async () => {
  const client = await connect();
  const out = textOf(
    await client.callTool({
      name: 'simulate_decision',
      arguments: { path: '/no/such/tree', proposal: {} },
    }),
  );
  assert.equal(out.isError, true);
  assert.match(out.text, /^PolicyPathUnreadable: /);
});
