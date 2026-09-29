/**
 * The client against a stub gateway on a real socket — every §1 shape and
 * every §1 error (ACP-197 §6). Nothing here calls a handler directly: the
 * claim is about HTTP a peer would see, and a test that bypasses the socket
 * bypasses the layer under test (`services/approval/src/server.test.ts` says
 * the same about its own transport).
 *
 * THE POSITIVE PATH IS ASSERTED FIRST AND HARDEST — a client suite that only
 * proves refusals is green against a client that can never succeed. The
 * first tests pin the full request the client emits (method, path, bearer,
 * content type, body VALUES equal to the caller's proposal — the "carries,
 * never authors" half of §1's tenant-rewrite rule) and the full §1 answer it
 * returns.
 *
 * ZERO crypto here, by contract: signature and receipt verification live in
 * @ziffer-io/verify and are tested there. The one verification-shaped assertion in
 * this file is IDENTITY — the re-exported `verifyReceipt` is the same
 * function object as @ziffer-io/verify's — which is exactly the "client adds no
 * verification logic" claim made testable: a local copy or wrapper would
 * turn that `Object.is` red.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  AnchorError as VerifyAnchorError,
  loadAttesterRegistry as registryFromVerify,
  loadTrustAnchor as anchorFromVerify,
  Refusal as VerifyRefusal,
  verifyReceipt as verifyFromVerify,
} from '@ziffer-io/verify';

import {
  _resetApiKeyExpiryWarning,
  ApiRefusal,
  ERROR_ADMISSION_UNAVAILABLE,
  ERROR_API_KEY_UNKNOWN,
  ERROR_DECISION_UNKNOWN,
  ERROR_FEEDBACK_RATE_LIMITED,
  ERROR_FEEDBACK_TOO_LARGE,
  ERROR_LIST_QUERY_MALFORMED,
  ERROR_PROPOSAL_MALFORMED,
  ERROR_TENANT_MISMATCH,
  ResponseMalformed,
  WaitTimeout,
  ZifferClient,
  type Decision,
  type WireProposal,
  type ZifferClientOptions,
} from './client.js';
import {
  AnchorError as AnchorErrorViaClient,
  loadAttesterRegistry as registryViaClient,
  loadTrustAnchor as anchorViaClient,
  Refusal as VerifyRefusalViaClient,
  verifyReceipt as verifyViaClient,
} from './index.js';

// ================================================================= fixtures

const API_KEY = 'zfr_' + 'a'.repeat(43);
const ULID = '01j8z9k2c4d5e6f7g8h9j0k1m2';

/** One §1-shaped Proposal, values from the corpus every suite shares. */
const PROPOSAL: WireProposal = {
  schema_id: 'fw.v1',
  schema_version: '1.0.0',
  schema_hash: 'sha256:' + '0'.repeat(64),
  fidelity: 'F-HIGH',
  tenant_id: 't1',
  payload: {
    task_type: 'modify_firewall_rule',
    operator: 'op-1',
    targets: ['prod-db'],
    params: { action: 'allow', port: 22 },
    cidrs: {},
  },
};

// ============================================================== stub server

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

interface Scripted {
  readonly status: number;
  readonly body: string;
  /** Content type of the ANSWER; defaults to JSON. Overridden to text/html
   * to play the intermediary that answers instead of the gateway. */
  readonly contentType?: string;
  /** Extra answer headers -- the gateway's expiry header rides on a 2xx, and
   * the test that it is ignored on a refusal needs a stub that sends it
   * there too. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A gateway that answers from a script, in order, and records what it was
 * asked. Answers are exhausted strictly: a client that makes more requests
 * than the test scripted gets a 599 the guards will refuse loudly, so an
 * extra request cannot pass silently.
 */
class StubGateway {
  private server: Server | undefined;
  private script: Scripted[] = [];
  readonly requests: RecordedRequest[] = [];
  private port = 0;

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        this.requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          authorization: req.headers.authorization,
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const next = this.script.shift();
        if (next === undefined) {
          res.writeHead(599, { 'content-type': 'text/plain' });
          res.end('stub: unscripted request');
          return;
        }
        res.writeHead(next.status, {
          'content-type': next.contentType ?? 'application/json',
          ...(next.headers ?? {}),
        });
        res.end(next.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error('stub: no bound port');
    }
    this.port = addr.port;
    this.server = server;
  }

  answer(...responses: Scripted[]): void {
    this.script.push(...responses);
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }
}

/** Run one test body against a fresh stub, always torn down.
 *
 * `options` is for the RETRYABLE statuses only (ACP-355): 429, 502, 503, 504
 * and a dead socket are resent by the one request path, so a test about one of
 * those has to script every attempt and would otherwise spend the real backoff
 * sleeping. Everything else — every 4xx but 429, every 2xx, every malformed
 * answer — is answered once and asserted once, against a client built exactly
 * as a customer builds it. The retry rules themselves are `retry.test.ts`'s
 * subject, replayed from the corpus both SDKs share. */
async function withStub(
  fn: (stub: StubGateway, client: ZifferClient) => Promise<void>,
  options?: ZifferClientOptions,
): Promise<void> {
  const stub = new StubGateway();
  await stub.start();
  try {
    await fn(
      stub,
      options === undefined
        ? new ZifferClient(stub.baseUrl, API_KEY)
        : new ZifferClient(stub.baseUrl, API_KEY, options),
    );
  } finally {
    await stub.stop();
  }
}

/** A client that retries instantly and with no jitter, so a test about a
 * retryable status runs in microseconds instead of the 3.75 s of real backoff.
 * It changes WHEN the attempts happen, never how many or whether. */
const INSTANT_RETRIES: ZifferClientOptions = {
  sleep: async () => {},
  random: () => 0,
};

/** R4's cap: five attempts in total when the caller gave no deadline. A test
 * about a retryable refusal has to script all five, or the stub's own "no more
 * answers" 599 becomes the error under assertion. */
function repeat(answer: Scripted, times: number): Scripted[] {
  return Array.from({ length: times }, () => answer);
}

function json(status: number, value: unknown): Scripted {
  return { status, body: JSON.stringify(value) };
}

// ============================================================== key expiry

test('expiry: the header warns once in the last fourteen days, names the date and the rotation, and is never read off a refusal', async () => {
  await withStub(async (stub, client) => {
    const seen: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => {
      seen.push(args.map(String).join(' '));
    };
    try {
      const day = 86_400_000;
      const spell = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const far = spell(Date.now() + 60 * day);
      const near = spell(Date.now() + 3 * day);
      const pending = json(200, { decision_id: ULID, status: 'pending' });

      // A far-off end says nothing.
      _resetApiKeyExpiryWarning();
      stub.answer({ ...pending, headers: { 'x-ziffer-api-key-expires': far } });
      await client.propose(PROPOSAL);
      // `assert.equal` on the length and not `deepStrictEqual(seen, [])`: the
      // latter is an assertion signature that narrows `seen` to `never[]` for
      // the rest of the block, and every `.includes` below stops compiling.
      assert.equal(seen.length, 0, seen.join('\n'));

      // Inside fourteen days: ONCE, naming the date, the days and the rotation.
      stub.answer({ ...pending, headers: { 'x-ziffer-api-key-expires': near } });
      await client.propose(PROPOSAL);
      assert.equal(seen.length, 1, seen.join('\n'));
      const first = seen[0];
      assert.ok(first !== undefined);
      assert.ok(first.includes(near), first);
      assert.ok(first.includes('--rotate'), first);
      assert.ok(first.includes('3 day(s)'), first);

      // Once per process: the same dying key on the next call adds nothing.
      stub.answer({ ...pending, headers: { 'x-ziffer-api-key-expires': near } });
      await client.propose(PROPOSAL);
      assert.equal(seen.length, 1);

      // A refusal is never read for it, even when a stub puts it there.
      _resetApiKeyExpiryWarning();
      stub.answer({
        ...json(401, { error: ERROR_API_KEY_UNKNOWN }),
        headers: { 'x-ziffer-api-key-expires': near },
      });
      await assert.rejects(client.propose(PROPOSAL), ApiRefusal);
      assert.equal(seen.length, 1);

      // A header that is not the store's rendering is reported once by name,
      // not ignored: silence is how the warning would stop without notice.
      _resetApiKeyExpiryWarning();
      stub.answer({ ...pending, headers: { 'x-ziffer-api-key-expires': 'next Tuesday' } });
      await client.propose(PROPOSAL);
      assert.equal(seen.length, 2, seen.join('\n'));
      const second = seen[1];
      assert.ok(second !== undefined);
      assert.ok(second.includes('next Tuesday'), second);

      // And no header at all -- an older gateway -- says nothing.
      _resetApiKeyExpiryWarning();
      stub.answer(pending);
      await client.propose(PROPOSAL);
      assert.equal(seen.length, 2);
    } finally {
      console.warn = original;
    }
  });
});

// ======================================================= positive path first

test('propose: emits the §1 request exactly and returns a pending decision', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'pending' }));
    const d = await client.propose(PROPOSAL);

    assert.equal(d.decision_id, ULID);
    assert.equal(d.status, 'pending');
    assert.ok(!('outcome' in d));
    assert.ok(!('receipt' in d));

    const req = stub.requests[0];
    assert.ok(req !== undefined);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/proposals');
    assert.equal(req.authorization, `Bearer ${API_KEY}`);
    assert.equal(req.contentType, 'application/json');
    // Carries, never authors: the body's VALUES are the caller's proposal,
    // every field, nothing added — the client-side half of §1's rule that a
    // proposal is signed material downstream and the carrier is not its
    // author. deepStrictEqual over parsed values, not bytes, because the
    // wire encoding is not canonical (the gateway canonicalises); the claim
    // is about values.
    assert.deepStrictEqual(JSON.parse(req.body), PROPOSAL);
  });
});

test('propose: a decided answer carries outcome and refusal_category through verbatim', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'decided', outcome: 'DENY', refusal_category: 'RateBounded' }),
    );
    const d = await client.propose(PROPOSAL);
    assert.equal(d.status, 'decided');
    assert.equal(d.outcome, 'DENY');
    assert.equal(d.refusal_category, 'RateBounded');
  });
});

test('RF-2: a category outside RF-4\'s four is refused, never repaired', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'decided', outcome: 'DENY', refusal_category: '8.4-3' }));
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('decision: a held decision carries held_until and no receipt', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST', held_until: '2030-03-17T17:47:40Z' }),
    );
    const d = await client.decision(ULID);
    assert.equal(d.held_until, '2030-03-17T17:47:40Z');
    assert.ok(!('receipt' in d));
  });
});

test('propose: a decided ALLOW has refusal_category ABSENT, not null', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'decided', outcome: 'ALLOW' }));
    const d = await client.propose(PROPOSAL);
    assert.equal(d.outcome, 'ALLOW');
    // One object, one encoding (§1's parity with ingress-low): absence is
    // the spelling, so the key must not exist at all.
    assert.ok(!('refusal_category' in d));
    assert.ok(!('clause' in d));
  });
});

test('decision: emits the §1 GET and returns pending without a receipt', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'pending' }));
    const d = await client.decision(ULID);
    assert.equal(d.status, 'pending');
    assert.ok(!('receipt' in d));

    const req = stub.requests[0];
    assert.ok(req !== undefined);
    assert.equal(req.method, 'GET');
    assert.equal(req.url, `/v1/decisions/${ULID}`);
    assert.equal(req.authorization, `Bearer ${API_KEY}`);
    assert.equal(req.body, '');
  });
});

test('decision: a stored receipt comes back as the value served, unmodified', async () => {
  await withStub(async (stub, client) => {
    // A receipt-shaped value with nesting, an empty object and a unicode
    // string: enough structure that any normalisation the client secretly
    // performed (key sorting, null-stripping, re-encoding) would show.
    const receipt = {
      receipt_version: 3,
      alg: 'hybrid-ed25519-mldsa65',
      decision: 'ALLOW',
      proposal_hash: 'sha256:' + 'b'.repeat(64),
      nested: { z: 1, a: [true, null, 'héllo'], empty: {} },
      sig: { classical: 'AAAA', pq: 'BBBB' },
    };
    stub.answer(
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ALLOW', receipt }),
    );
    const d = await client.decision(ULID);
    // The client necessarily parses the enclosing response; the claim it CAN
    // make — and the one asserted — is that the parsed receipt VALUE is
    // handed back with nothing touched. Byte-verbatim storage is the
    // gateway's claim, tested gateway-side.
    assert.deepStrictEqual(d.receipt, receipt);
  });
});

test('wait: polls until decided and returns the decided answer', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'pending' }),
      json(200, { decision_id: ULID, status: 'pending' }),
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST' }),
    );
    const d = await client.wait(ULID, { timeoutMs: 2_000, intervalMs: 10 });
    assert.equal(d.status, 'decided');
    assert.equal(d.outcome, 'ATTEST');
    assert.equal(stub.requests.length, 3);
  });
});

test('WaitTimeout says the state it last read and what to do: the same line as the Python SDK', () => {
  // tools/fixtures/sdk-retry/wait-timeout-lines.json, read by both SDKs' suites.
  let dir = dirname(fileURLToPath(import.meta.url));
  const rel = join('tools', 'fixtures', 'sdk-retry', 'wait-timeout-lines.json');
  while (!existsSync(join(dir, rel))) {
    const up = dirname(dir);
    assert.notEqual(up, dir, `no ${rel} above this test`);
    dir = up;
  }
  const raw: unknown = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
  const cases = typeof raw === 'object' && raw !== null && 'cases' in raw ? raw.cases : undefined;
  assert.ok(Array.isArray(cases) && cases.length > 0);
  for (const c of cases) {
    assert.ok(typeof c === 'object' && c !== null && 'decision_id' in c && 'timeout_seconds' in c && 'last' in c && 'line' in c);
    const { decision_id: id, timeout_seconds: seconds, last, line } = c;
    assert.ok(typeof id === 'string' && typeof seconds === 'number' && typeof line === 'string');
    let decision: Decision | undefined;
    if (last !== null) {
      assert.ok(typeof last === 'object' && 'status' in last && (last.status === 'pending' || last.status === 'decided'));
      const outcome = 'outcome' in last && (last.outcome === 'ALLOW' || last.outcome === 'ATTEST' || last.outcome === 'DENY') ? last.outcome : undefined;
      const heldUntil = 'held_until' in last && typeof last.held_until === 'string' ? last.held_until : undefined;
      decision = {
        decision_id: id,
        status: last.status,
        ...(outcome === undefined ? {} : { outcome }),
        ...(heldUntil === undefined ? {} : { held_until: heldUntil }),
      };
    }
    const error = decision === undefined ? new WaitTimeout(id, seconds * 1000) : new WaitTimeout(id, seconds * 1000, { last: decision });
    assert.equal(error.message, line);
  }
});

test('wait: a deadline with the decision still pending names WaitTimeout, not a verdict', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'pending' }),
      json(200, { decision_id: ULID, status: 'pending' }),
      json(200, { decision_id: ULID, status: 'pending' }),
      json(200, { decision_id: ULID, status: 'pending' }),
    );
    await assert.rejects(
      client.wait(ULID, { timeoutMs: 30, intervalMs: 10 }),
      (e: unknown) => e instanceof WaitTimeout && e.decisionId === ULID,
    );
  });
});

// ============================================= waitForReceipt (ACP-473)

/** A fake clock the client's sleep advances, so a deadline test is exact and instant. */
function fakeClock(): ZifferClientOptions & { readonly slept: number[] } {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    random: () => 0,
    slept,
  };
}

const RECEIPT_STAND_IN = { receipt_version: 3, stand_in: true };

test('waitForReceipt: a decided ALLOW whose receipt is not yet readable is polled until it is', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'pending' }),
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ALLOW' }),
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ALLOW', receipt: RECEIPT_STAND_IN }),
    );
    const d = await client.waitForReceipt(ULID, { timeoutMs: 2_000, intervalMs: 10 });
    assert.deepStrictEqual(d.receipt, RECEIPT_STAND_IN);
    assert.equal(stub.requests.length, 3);
    // It only reads: every request is a GET of this decision, none a proposal.
    assert.ok(stub.requests.every((r) => r.method === 'GET' && r.url === `/v1/decisions/${ULID}`));
  });
});

test('waitForReceipt: a held action keeps waiting through ATTEST until the approved receipt is readable', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST' }),
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST', held_until: '2026-09-29T10:00:00Z' }),
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST', receipt: RECEIPT_STAND_IN }),
    );
    const d = await client.waitForReceipt(ULID, { timeoutMs: 2_000, intervalMs: 10 });
    assert.equal(d.outcome, 'ATTEST');
    assert.deepStrictEqual(d.receipt, RECEIPT_STAND_IN);
    assert.equal(stub.requests.length, 3);
  });
});

test('waitForReceipt: a DENY comes back as a value, exactly as wait returns it', async () => {
  await withStub(async (stub, client) => {
    const deny = { decision_id: ULID, status: 'decided', outcome: 'DENY', refusal_category: 'PolicyRefused' };
    stub.answer(json(200, deny), json(200, deny));
    const viaReceipt = await client.waitForReceipt(ULID, { timeoutMs: 2_000, intervalMs: 10 });
    const viaWait = await client.wait(ULID, { timeoutMs: 2_000, intervalMs: 10 });
    assert.deepStrictEqual(viaReceipt, viaWait);
    assert.equal(viaReceipt.outcome, 'DENY');
    assert.equal(viaReceipt.receipt, undefined);
  });
});

test('waitForReceipt: a held action whose release was refused returns with its category, not a wait to the deadline', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST' }),
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST', refusal_category: 'PolicyRefused' }),
    );
    const d = await client.waitForReceipt(ULID, { timeoutMs: 2_000, intervalMs: 10 });
    assert.equal(d.refusal_category, 'PolicyRefused');
    assert.equal(stub.requests.length, 2);
  });
});

test('waitForReceipt: no receipt by the deadline is WaitTimeout, wait\'s own refusal, at wait\'s own pacing', async () => {
  const clock = fakeClock();
  await withStub(async (stub, client) => {
    const held = json(200, { decision_id: ULID, status: 'decided', outcome: 'ATTEST' });
    stub.answer(...repeat(held, 4));
    await assert.rejects(
      client.waitForReceipt(ULID, { timeoutMs: 1_500 }),
      (e: unknown) => e instanceof WaitTimeout && e.decisionId === ULID,
    );
    // The default interval is wait's 500 ms: polls at 0, 500, 1000, 1500, then the deadline.
    assert.deepStrictEqual(clock.slept, [500, 500, 500]);
    assert.equal(stub.requests.length, 4);
  }, clock);
});

// ==================================================== every §1 named refusal

/** Each §1 error, asserted BY NAME — the name is the contract, the status is
 * carried. One helper so no case can drift to "it threw". */
function isRefusal(status: number, name: string): (e: unknown) => boolean {
  return (e: unknown) => e instanceof ApiRefusal && e.status === status && e.error === name;
}

test('401 ApiKeyUnknown surfaces by name', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(401, { error: ERROR_API_KEY_UNKNOWN }));
    await assert.rejects(client.propose(PROPOSAL), isRefusal(401, 'ApiKeyUnknown'));
  });
});

test('403 TenantMismatch surfaces by name — the gateway refuses, never rewrites', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(403, { error: ERROR_TENANT_MISMATCH }));
    await assert.rejects(client.propose(PROPOSAL), isRefusal(403, 'TenantMismatch'));
  });
});

test('400 ProposalMalformed surfaces by name', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(400, { error: ERROR_PROPOSAL_MALFORMED }));
    await assert.rejects(client.propose(PROPOSAL), isRefusal(400, 'ProposalMalformed'));
  });
});

test('502 AdmissionUnavailable surfaces by name once the retries are spent', async () => {
  await withStub(async (stub, client) => {
    // 502 is retryable (R1), so the NAME has to survive four resends to reach
    // the caller — a client that dropped it on the way would report the last
    // attempt as an anonymous failure and the operator would never learn that
    // admission was the thing that was down.
    stub.answer(...repeat(json(502, { error: ERROR_ADMISSION_UNAVAILABLE }), 5));
    await assert.rejects(client.propose(PROPOSAL), isRefusal(502, 'AdmissionUnavailable'));
    assert.equal(stub.requests.length, 5);
  }, INSTANT_RETRIES);
});

test('404 DecisionUnknown surfaces by name on GET', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(404, { error: ERROR_DECISION_UNKNOWN }));
    await assert.rejects(client.decision(ULID), isRefusal(404, 'DecisionUnknown'));
  });
});

test('a refusal name this client has never heard of surfaces verbatim — the set is open', async () => {
  await withStub(async (stub, client) => {
    // 429 is retryable too, and carries no `Retry-After` here, so these are
    // four computed retries and then the name, verbatim.
    stub.answer(...repeat(json(429, { error: 'RateLimited' }), 5));
    await assert.rejects(client.propose(PROPOSAL), isRefusal(429, 'RateLimited'));
    assert.equal(stub.requests.length, 5);
  }, INSTANT_RETRIES);
});

test('wait: a named refusal mid-poll propagates immediately, no retry', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'pending' }),
      json(404, { error: ERROR_DECISION_UNKNOWN }),
    );
    await assert.rejects(
      client.wait(ULID, { timeoutMs: 2_000, intervalMs: 10 }),
      isRefusal(404, 'DecisionUnknown'),
    );
    // Exactly two requests: retrying DecisionUnknown would be the client
    // deciding the server was wrong about its own rows.
    assert.equal(stub.requests.length, 2);
  });
});

// =========================================== fail closed on off-§1 answers

function isMalformed(e: unknown): boolean {
  return e instanceof ResponseMalformed;
}

test('a 200 that is not JSON is refused as malformed, never guessed at', async () => {
  await withStub(async (stub, client) => {
    stub.answer({ status: 200, body: '<html>ok</html>', contentType: 'text/html' });
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test("an intermediary's HTML 502 is not the gateway's answer and is not dressed up as one", async () => {
  await withStub(async (stub, client) => {
    // Retried, because 502 is retryable whoever wrote it — but never promoted
    // to a refusal: an intermediary's HTML is not the gateway naming anything.
    stub.answer(
      ...repeat({ status: 502, body: '<html>bad gateway</html>', contentType: 'text/html' }, 5),
    );
    await assert.rejects(
      client.propose(PROPOSAL),
      (e: unknown) => isMalformed(e) && !(e instanceof ApiRefusal),
    );
    assert.equal(stub.requests.length, 5);
  }, INSTANT_RETRIES);
});

test('an error body naming no error is malformed, not an anonymous refusal', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(400, { message: 'nope' }));
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('a status outside {pending, decided} is refused by the guard', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'maybe' }));
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('an outcome outside the engine three is refused, not carried', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'decided', outcome: 'PERMIT' }));
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('a null refusal_category is refused: absence is the one spelling of "none"', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'decided', outcome: 'DENY', refusal_category: null }));
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('a missing decision_id is refused', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { status: 'pending' }));
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('a receipt in a POST response is refused: one place serves receipts', async () => {
  await withStub(async (stub, client) => {
    stub.answer(
      json(200, { decision_id: ULID, status: 'decided', outcome: 'ALLOW', receipt: { receipt_version: 3 } }),
    );
    await assert.rejects(client.propose(PROPOSAL), isMalformed);
  });
});

test('a GET answer about a different decision_id is refused, not returned', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: '01j8z9k2c4d5e6f7g8h9j0other', status: 'pending' }));
    await assert.rejects(client.decision(ULID), isMalformed);
  });
});

// ============================================== construction-time refusals

test('an empty apiKey is refused locally, never mailed to the server', () => {
  assert.throws(() => new ZifferClient('http://127.0.0.1:1', ''), TypeError);
  assert.throws(() => new ZifferClient('', API_KEY), TypeError);
});

// ================================================== one home for verification

test('the re-exported verifyReceipt IS @ziffer-io/verify\'s — same object, zero local logic', () => {
  // Object.is, not behavioural equivalence: a re-implementation that agreed
  // on every current vector would still be a second verifier, and this is
  // the assertion that turns red the day one appears here.
  assert.ok(Object.is(verifyViaClient, verifyFromVerify));
  assert.ok(Object.is(VerifyRefusalViaClient, VerifyRefusal));
});

test('the re-exported readers ARE @ziffer-io/verify\'s — one reader of each file, not two', () => {
  assert.ok(Object.is(anchorViaClient, anchorFromVerify));
  assert.ok(Object.is(registryViaClient, registryFromVerify));
  assert.ok(Object.is(AnchorErrorViaClient, VerifyAnchorError));
});

// ================================== the SDK writes nothing and dials nobody

/**
 * ACP-251 item 2. `sdk.md` promises this library "does not store, forward or
 * log receipts", and until this block the promise was held by the absence of
 * code and asserted by nothing — which is not a control, because nothing
 * catches a check that was never written. `packages/mcp/src/server.test.ts`
 * asserts the same forbidden shape for the MCP server; this is that
 * assertion for the client, and `sdk/python/tests/test_no_side_effects.py`
 * is its Python half.
 *
 * TWO HALVES, because neither is sufficient alone:
 *
 *  (a) a RUNTIME spy over `fetch` and over the CommonJS `fs` object. A module
 *      that does `import fs from 'node:fs'` and calls `fs.writeFileSync`
 *      reaches the same object this patches, so the spy sees it. A module
 *      that does `import { writeFileSync } from 'node:fs'` binds the
 *      function at link time and the spy would NOT — stated here rather than
 *      left as a hole a reader has to find, and closed by (b).
 *
 *  (b) a STATIC assertion over this package's own compiled output: no module
 *      of it names `node:fs`, `node:child_process`, `node:net`, `node:http`
 *      or `node:https` at all. That one is immune to how an import is
 *      spelled, and it is what turns red when someone adds a cache, a log
 *      file or a second HTTP client.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

const FS_WRITE_METHODS = [
  'writeFileSync',
  'appendFileSync',
  'openSync',
  'createWriteStream',
  'mkdirSync',
  'renameSync',
  'rmSync',
  'unlinkSync',
] as const;

interface Recorded {
  readonly fetches: string[];
  readonly writes: string[];
}

/** Run `body` with fetch and the CJS fs write surface under observation. */
async function watched(body: () => Promise<void>): Promise<Recorded> {
  const fetches: string[] = [];
  const writes: string[] = [];
  const realFetch = globalThis.fetch;
  const fs: Record<string, unknown> = createRequire(import.meta.url)('node:fs');
  const saved = new Map<string, unknown>();

  // `Parameters<typeof fetch>` rather than the DOM's `RequestInfo`: this
  // package compiles against ES2022 with no DOM lib, and naming a global type
  // it does not have would be a second declaration of the runtime's own.
  globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    fetches.push(String(args[0]));
    return realFetch(...args);
  };
  for (const name of FS_WRITE_METHODS) {
    const original = fs[name];
    saved.set(name, original);
    if (typeof original === 'function') {
      fs[name] = (...args: unknown[]): unknown => {
        writes.push(`${name}(${String(args[0])})`);
        return Reflect.apply(original, fs, args);
      };
    }
  }
  try {
    await body();
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, original] of saved) fs[name] = original;
  }
  return { fetches, writes };
}

test('one client call is one outbound request and no file write', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { decision_id: ULID, status: 'pending' }));
    const seen = await watched(async () => {
      const d = await client.propose(PROPOSAL);
      assert.equal(d.decision_id, ULID);
    });
    // Exactly one, and to the gateway the caller named: "zero outbound calls
    // beyond the one gateway request" is only checkable as a count plus an
    // address.
    assert.deepEqual(seen.fetches, [`${stub.baseUrl}/v1/proposals`]);
    assert.deepEqual(seen.writes, []);
    assert.equal(stub.requests.length, 1);
  });
});

test('verifying a receipt writes nothing and dials nothing', async () => {
  // The re-exported verifier, called the way a caller calls it. A refusal is
  // the interesting case to keep a copy of, which is exactly why keeping one
  // must not happen here: the caller decides what to record.
  const seen = await watched(async () => {
    const anchor = { classical: new Uint8Array(32), pq: new Uint8Array(1952), minSuite: 'ed25519' };
    assert.throws(() => verifyViaClient({ receipt_version: 2 }, new Uint8Array(), anchor));
  });
  assert.deepEqual(seen.writes, []);
  assert.deepEqual(seen.fetches, []);
});

test('the spy itself can see a write and a fetch', async () => {
  // Falsified on every green run: a spy that recorded nothing would make
  // both assertions above vacuous, and would pass.
  await withStub(async (stub) => {
    stub.answer(json(200, { decision_id: ULID, status: 'pending' }));
    const seen = await watched(async () => {
      const fs: Record<string, unknown> = createRequire(import.meta.url)('node:fs');
      const write = fs['writeFileSync'];
      assert.ok(typeof write === 'function');
      const probe = `${process.env['TMPDIR'] ?? '/tmp'}/lq-sdk-client-spy-probe.txt`;
      Reflect.apply(write, fs, [probe, 'x']);
      const unlink = fs['unlinkSync'];
      assert.ok(typeof unlink === 'function');
      await fetch(`${stub.baseUrl}/v1/proposals`, { method: 'POST', body: '{}' });
      Reflect.apply(unlink, fs, [probe]);
    });
    assert.equal(seen.writes.length, 2, `spy saw ${JSON.stringify(seen.writes)}`);
    assert.equal(seen.fetches.length, 1, `spy saw ${JSON.stringify(seen.fetches)}`);
  });
});

test('this package names no filesystem, process or transport module anywhere', () => {
  // The half a binding trick cannot dodge, and the shape server.test.ts:65
  // asserts for the MCP server: a forbidden thing, named, so that adding it
  // back turns something red. `node:http` is on the list too -- the client
  // uses the runtime's own `fetch`, and a second HTTP stack here would be a
  // dependency with no claim behind it.
  const dist = new URL('../dist/', import.meta.url);
  const modules = readdirSync(dist).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  assert.ok(modules.length >= 2, `expected compiled modules, found ${modules.join(', ')}`);
  for (const file of modules) {
    const source = readFileSync(new URL(file, dist), 'utf8');
    for (const forbidden of [
      'node:fs',
      'node:child_process',
      'node:net',
      'node:http',
      'node:https',
      'node:worker_threads',
    ]) {
      assert.ok(
        !source.includes(forbidden),
        `${file} names ${forbidden}; this package reads and writes nothing and opens no transport of its own`,
      );
    }
  }
});

// ================================================ the list (ACP-356)

/** One §1 list item: the held shape, which is the one with every member. */
const HELD_ITEM = {
  decision_id: '01bravo',
  status: 'decided',
  outcome: 'ATTEST',
  receipt: 'absent',
  created_at: '2026-09-21T18:00:00Z',
  waiting: true,
  expires_at: '2026-09-21T19:00:00Z',
};

const DONE_ITEM = {
  decision_id: '01alpha',
  status: 'decided',
  outcome: 'ALLOW',
  receipt: 'attached',
  created_at: '2026-09-21T17:55:00Z',
  waiting: false,
};

test('list: a page is narrowed into items and a cursor, and carries no clause', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { items: [HELD_ITEM, DONE_ITEM], next_cursor: null }));
    const page = await client.list();

    assert.equal(page.next_cursor, null);
    assert.deepEqual(
      page.items.map((i) => i.decision_id),
      ['01bravo', '01alpha'],
    );
    const held = page.items[0];
    assert.ok(held !== undefined);
    assert.equal(held.waiting, true);
    assert.equal(held.expires_at, '2026-09-21T19:00:00Z');
    assert.equal(held.receipt, 'absent');
    assert.equal(held.outcome, 'ATTEST');
    const done = page.items[1];
    assert.ok(done !== undefined);
    assert.equal(done.waiting, false);
    assert.equal(done.expires_at, undefined, 'nothing waiting names no window');
    assert.equal(done.receipt, 'attached');
    // The type has no `clause` member, so a server that sent one would have
    // nowhere to put it — the API says WHAT, never WHY.
    assert.ok(!Object.keys(held).includes('clause'));

    const request = stub.requests[0];
    assert.ok(request !== undefined);
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/v1/decisions');
    assert.equal(request.authorization, `Bearer ${API_KEY}`);
    // The key determines the customer. There is nothing tenant-shaped to send
    // and the gateway refuses a `tenant=` parameter by name.
    assert.ok(!request.url.includes('tenant'));
  });
});

test('list: the three parameters are escaped onto the query string and the cursor is handed back unchanged', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { items: [], next_cursor: 'ab01cd' }));
    const first = await client.list({ since: '2026-09-21T18:00:00Z', limit: 10 });
    assert.equal(first.next_cursor, 'ab01cd');
    const one = stub.requests[0];
    assert.ok(one !== undefined);
    // `URLSearchParams` escapes the colons; the gateway decodes `%XX` and
    // answers the escaped and bare spellings identically.
    assert.equal(one.url, '/v1/decisions?since=2026-09-21T18%3A00%3A00Z&limit=10');

    stub.answer(json(200, { items: [], next_cursor: null }));
    await client.list({ cursor: first.next_cursor ?? '' });
    const two = stub.requests[1];
    assert.ok(two !== undefined);
    assert.equal(two.url, '/v1/decisions?cursor=ab01cd');
  });
});

test('list: a malformed query surfaces the gateway one name, verbatim', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(400, { error: ERROR_LIST_QUERY_MALFORMED }));
    await assert.rejects(
      () => client.list({ limit: 0 }),
      (e: unknown) =>
        e instanceof ApiRefusal &&
        e.error === ERROR_LIST_QUERY_MALFORMED &&
        e.status === 400,
    );
  });
});

test('list: a shape violation is refused by name and never repaired', async () => {
  const departures: readonly unknown[] = [
    { items: [] }, // no next_cursor AT ALL
    { next_cursor: null }, // no items
    { items: [], next_cursor: 7 },
    { items: [{ ...HELD_ITEM, receipt: 'maybe' }], next_cursor: null },
    { items: [{ ...HELD_ITEM, status: 'unknown' }], next_cursor: null },
    { items: [{ ...HELD_ITEM, waiting: 'yes' }], next_cursor: null },
    { items: [{ ...HELD_ITEM, outcome: 'MAYBE' }], next_cursor: null },
    { items: [{ ...HELD_ITEM, expires_at: null }], next_cursor: null },
    { items: [{ decision_id: '', status: 'decided', receipt: 'absent', created_at: 'x', waiting: false }], next_cursor: null },
  ];
  for (const body of departures) {
    await withStub(async (stub, client) => {
      stub.answer(json(200, body));
      await assert.rejects(
        () => client.list(),
        (e: unknown) => e instanceof ResponseMalformed,
        `an SDK that repaired ${JSON.stringify(body)} would invent decision state`,
      );
    });
  }
});

test('list: an absent next_cursor is not the end — null is an answer and silence is not', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { items: [], next_cursor: null }));
    assert.equal((await client.list()).next_cursor, null);
  });
  await withStub(async (stub, client) => {
    stub.answer(json(200, { items: [] }));
    await assert.rejects(() => client.list(), (e: unknown) => e instanceof ResponseMalformed);
  });
});

test('list: a list is a request like any other and rides the one retry path (R8)', async () => {
  await withStub(
    async (stub, client) => {
      stub.answer(
        json(502, { error: ERROR_ADMISSION_UNAVAILABLE }),
        json(200, { items: [DONE_ITEM], next_cursor: null }),
      );
      const page = await client.list();
      assert.equal(page.items.length, 1);
      assert.equal(stub.requests.length, 2, 'the shed answer was resent');
    },
    INSTANT_RETRIES,
  );
});

// ================================================================ feedback
//
// ACP-392. The one call on this client that is not about a decision, and the
// one that behaves differently from every other: ONE round trip, no retry.
// Both halves are asserted, because "it does not retry" is exactly the kind of
// claim that is true until somebody routes the call through `request` for
// tidiness.

test('feedback posts the closed shape to /v1/feedback under the bearer key', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { stored: true, tenant: 'acme' }));
    const stored = await client.feedback({
      tool: 'search_docs',
      question: 'how do I rotate the receipt key?',
    });
    assert.deepEqual(stored, { stored: true, tenant: 'acme' });

    assert.equal(stub.requests.length, 1);
    const sent = stub.requests[0];
    assert.ok(sent !== undefined);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, '/v1/feedback');
    assert.equal(sent.authorization, `Bearer ${API_KEY}`);
    assert.equal(sent.contentType, 'application/json');
    // The CLOSED set, on the wire: three members at most and no tenant. A
    // tenant member here would be this client naming the customer it is
    // attributed as, which is the one thing the key is for.
    assert.deepEqual(JSON.parse(sent.body), {
      tool: 'search_docs',
      question: 'how do I rotate the receipt key?',
    });
  });
});

test('an omitted context is absent on the wire, not present and null', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { stored: true, tenant: 'acme' }), json(200, { stored: true, tenant: 'acme' }));
    await client.feedback({ tool: 't', question: 'q' });
    await client.feedback({ tool: 't', question: 'q', context: 'tried install.md' });
    assert.equal('context' in JSON.parse(stub.requests[0]?.body ?? '{}'), false);
    assert.equal(JSON.parse(stub.requests[1]?.body ?? '{}').context, 'tried install.md');
  });
});

test('a rate-limited feedback is raised at once and NOT retried', async () => {
  // The difference from every other call on this client, asserted by counting
  // requests. `request` would have resent this four more times and slept on
  // the gateway's Retry-After; a coding agent calling a tool would have
  // blocked for a minute to deliver a sentence.
  await withStub(async (stub, client) => {
    stub.answer({
      status: 429,
      body: JSON.stringify({ error: ERROR_FEEDBACK_RATE_LIMITED, retry_after: 42 }),
      headers: { 'retry-after': '42' },
    });
    await assert.rejects(
      client.feedback({ tool: 't', question: 'q' }),
      (error: unknown) =>
        error instanceof ApiRefusal &&
        error.error === ERROR_FEEDBACK_RATE_LIMITED &&
        error.status === 429,
    );
    assert.equal(stub.requests.length, 1, 'the rate-limited message was resent');
  }, INSTANT_RETRIES);
});

test('an over-size feedback comes back as the gateway s own name', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(413, { error: ERROR_FEEDBACK_TOO_LARGE }));
    await assert.rejects(
      client.feedback({ tool: 't', question: 'x'.repeat(10) }),
      (error: unknown) =>
        error instanceof ApiRefusal && error.error === ERROR_FEEDBACK_TOO_LARGE,
    );
    assert.equal(stub.requests.length, 1);
  });
});

test('a 200 that does not say the message was stored is NOT reported as stored', async () => {
  // "The gateway answered something" and "your message is on a disk an
  // operator reads" are different facts, and only the second is what the
  // caller asked for.
  for (const body of [{}, { stored: false, tenant: 'acme' }, { stored: true }, { stored: true, tenant: '' }]) {
    await withStub(async (stub, client) => {
      stub.answer(json(200, body));
      await assert.rejects(
        client.feedback({ tool: 't', question: 'q' }),
        (error: unknown) => error instanceof ResponseMalformed,
        `${JSON.stringify(body)} was read as stored`,
      );
    });
  }
});

// ================================================================== whoami

test('whoami: GET /v1/whoami with the bearer, no body, and both members returned', async () => {
  await withStub(async (stub, client) => {
    stub.answer(json(200, { tenant_id: 'acme-corp', key_expires_at: '2026-12-01T00:00:00Z' }));
    const identity = await client.whoami();
    assert.deepEqual(identity, {
      tenant_id: 'acme-corp',
      key_expires_at: '2026-12-01T00:00:00Z',
    });
    const sent = stub.requests[0];
    assert.ok(sent !== undefined);
    assert.equal(sent.method, 'GET');
    assert.equal(sent.url, '/v1/whoami');
    assert.equal(sent.authorization, `Bearer ${API_KEY}`);
    // No body and no content type: there is nothing to name on this route, and
    // a body would be a second place a caller could put a tenant.
    assert.equal(sent.body, '');
    assert.equal(sent.contentType, undefined);
  });
});

test('whoami: a dead key is one ApiRefusal and the three cannot be told apart', async () => {
  // The gateway collapses expired, revoked and never-minted into one answer;
  // this asserts the client carries that name through rather than inventing a
  // distinction the wire does not make.
  await withStub(async (stub, client) => {
    stub.answer(json(401, { error: ERROR_API_KEY_UNKNOWN }));
    await assert.rejects(
      () => client.whoami(),
      (error: unknown) =>
        error instanceof ApiRefusal &&
        error.error === ERROR_API_KEY_UNKNOWN &&
        error.status === 401,
    );
  });
});

test('whoami: a half-answer is ResponseMalformed, never an identity with a hole in it', async () => {
  // `undefined` printed where a date belongs reads as "no expiry", which is
  // the one wrong reading of a credential that ends.
  for (const body of [
    {},
    { tenant_id: 'acme-corp' },
    { key_expires_at: '2026-12-01T00:00:00Z' },
    { tenant_id: '', key_expires_at: '2026-12-01T00:00:00Z' },
    { tenant_id: 'acme-corp', key_expires_at: '' },
    { tenant_id: 'acme-corp', key_expires_at: 17 },
    { tenant_id: 42, key_expires_at: '2026-12-01T00:00:00Z' },
    [],
  ]) {
    await withStub(async (stub, client) => {
      stub.answer(json(200, body));
      await assert.rejects(
        () => client.whoami(),
        (error: unknown) => error instanceof ResponseMalformed,
        JSON.stringify(body),
      );
    });
  }
});

test('an empty tool or question is refused here, and no request is made', async () => {
  await withStub(async (stub, client) => {
    await assert.rejects(client.feedback({ tool: '', question: 'q' }), TypeError);
    await assert.rejects(client.feedback({ tool: 't', question: '' }), TypeError);
    assert.equal(stub.requests.length, 0, 'an incomplete message left this process');
  });
});
