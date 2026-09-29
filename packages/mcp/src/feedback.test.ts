/**
 * That `send_feedback` sends what it says it sends, and nothing else.
 *
 * This is the one tool in this package whose text leaves the developer's
 * machine, so the assertions here are about the BOUNDARY rather than about a
 * format: what reaches the client, what does not, and that a refusal from the
 * far side comes back under the gateway's own name rather than as "something
 * went wrong".
 *
 * The stub is a client, not an HTTP server, for `tools.test.ts`'s reason: the
 * §1 shapes a stub server makes awkward to produce — a 429 with its seconds,
 * a 413 — are exactly the ones this tool has to report correctly, and
 * `ApiRefusal` is `@ziffer-io/client`'s own class rather than a stand-in.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiRefusal } from '@ziffer-io/client';

import { VARS, type Env } from './config.js';
import { sendFeedback, type ClientFactory, type FeedbackMessage } from './tools.js';

const ENV: Env = {
  [VARS.API_URL]: 'https://api.example.test',
  [VARS.API_KEY]: 'zfr_' + 'a'.repeat(43),
};

/** A client that records what it was handed. */
function recording(): { sent: FeedbackMessage[]; factory: ClientFactory } {
  const sent: FeedbackMessage[] = [];
  const factory: ClientFactory = async () => ({
    propose: () => Promise.reject(new Error('propose not stubbed')),
    decision: () => Promise.reject(new Error('decision not stubbed')),
    list: () => Promise.reject(new Error('list not stubbed')),
    whoami: () => Promise.reject(new Error('whoami not stubbed')),
    feedback: async (message) => {
      sent.push(message);
      return { stored: true, tenant: 'acme' };
    },
  });
  return { sent, factory };
}

/** A client that refuses the way the gateway does. */
function refusing(status: number, name: string): ClientFactory {
  const error = new ApiRefusal(status, name);
  return async () => ({
    propose: () => Promise.reject(error),
    decision: () => Promise.reject(error),
    list: () => Promise.reject(error),
    whoami: () => Promise.reject(error),
    feedback: () => Promise.reject(error),
  });
}

/** A factory that fails the test if a client is built at all. */
const forbidden: ClientFactory = async () => {
  throw new Error('a client was built for a call that should never have left this process');
};

test('a message is sent and the answer says the text left the machine', async () => {
  const { sent, factory } = recording();
  const out = await sendFeedback(factory, ENV, {
    tool: 'search_docs',
    question: 'how do I rotate the receipt signing key?',
  });
  assert.equal(out.isError, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.tool, 'search_docs');
  assert.equal(sent[0]?.question, 'how do I rotate the receipt signing key?');
  // The tenant comes back from the key, and the answer says what was done to
  // the text: an agent that reads "stored" and nothing else does not know a
  // person will read it.
  assert.match(out.text, /stored for tenant acme\./);
  assert.match(out.text, /a line in a file an operator reads/);
  assert.match(out.text, /not filtered, summarised or redacted/);
  // And that nothing comes back this way: an agent waiting for an answer here
  // would wait for ever.
  assert.match(out.text, /Nothing answers back through this tool/);
});

test('an omitted context is an ABSENT member, not one holding undefined', () => {
  // exactOptionalPropertyTypes is on and the gateway's shape is CLOSED, so a
  // present-and-undefined `context` would be serialised by some callers as a
  // member the route refuses. This is the assertion that would notice.
  const { sent, factory } = recording();
  return sendFeedback(factory, ENV, { tool: 't', question: 'q' }).then(() => {
    assert.equal(sent.length, 1);
    assert.ok(sent[0] !== undefined);
    assert.equal('context' in sent[0], false, 'an omitted context reached the client as a member');
  });
});

test('a context that is only whitespace is dropped rather than sent as blank', async () => {
  const { sent, factory } = recording();
  await sendFeedback(factory, ENV, { tool: 't', question: 'q', context: '   ' });
  assert.equal('context' in (sent[0] ?? {}), false);
});

test('a context that says something is carried, trimmed', async () => {
  const { sent, factory } = recording();
  await sendFeedback(factory, ENV, { tool: 't', question: 'q', context: '  tried install.md  ' });
  assert.equal(sent[0]?.context, 'tried install.md');
});

test('an empty tool or question is refused HERE, and nothing is sent', async () => {
  for (const bad of [
    { tool: '', question: 'q' },
    { tool: 't', question: '' },
    { tool: '   ', question: 'q' },
    { tool: 't', question: '\n\t ' },
  ]) {
    const out = await sendFeedback(forbidden, ENV, bad);
    assert.equal(out.isError, true, `${JSON.stringify(bad)} was sent`);
    assert.match(out.text, /^FeedbackIncomplete: /);
  }
});

test('an over-size body comes back as the gateway s own name', async () => {
  // The cap is the gateway's and is enforced there -- a copy of the number in
  // this package would be a second definition of a limit the server owns. So
  // what is asserted here is the REPORTING: a 413 arrives as FeedbackTooLarge
  // and not as "ApiRefusal" or as a generic failure.
  const out = await sendFeedback(refusing(413, 'FeedbackTooLarge'), ENV, {
    tool: 'search_docs',
    question: 'x'.repeat(10),
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /^FeedbackTooLarge/);
});

test('an over-rate message comes back as the gateway s own name', async () => {
  const out = await sendFeedback(refusing(429, 'FeedbackRateLimited'), ENV, {
    tool: 'search_docs',
    question: 'again',
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /^FeedbackRateLimited/);
});

test('a deployment with nowhere to store feedback says so, and is not read as an outage', async () => {
  const out = await sendFeedback(refusing(503, 'FeedbackUnavailable'), ENV, {
    tool: 'search_docs',
    question: 'anything',
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /^FeedbackUnavailable/);
  // Distinct from GatewayUnavailable, which would tell a developer the whole
  // deployment is down.
  assert.doesNotMatch(out.text, /GatewayUnavailable/);
});

test('an unconfigured server names the variable and sends nothing', async () => {
  // `config.ts`'s inversion: the refusal moved from process exit to tool
  // result, and it did not become a default. A feedback tool that posted to a
  // host nobody chose would be the worst possible version of that.
  const out = await sendFeedback(
    async (env) => {
      assert.equal(env[VARS.API_URL], undefined);
      throw new (await import('./config.js')).ConfigError(
        'ApiUrlUnconfigured',
        VARS.API_URL,
        'this server does not know which Ziffer gateway to call.',
      );
    },
    {},
    { tool: 't', question: 'q' },
  );
  assert.equal(out.isError, true);
  assert.match(out.text, /^ApiUrlUnconfigured: /);
  assert.match(out.text, new RegExp(`Set ${VARS.API_URL}\\.`));
});
