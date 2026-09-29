/**
 * The retry corpus, replayed by this SDK (ACP-355), plus the obligations the
 * corpus explicitly does NOT carry.
 *
 * `tools/fixtures/sdk-retry/cases.json` is ONE file, shared with the Python
 * SDK and recomputed from R1..R9 by `tools/check-sdk-retry-fixture.py`. It is
 * READ from the repository root and never copied in here: a corpus with two
 * copies is two corpora, and the whole point of it is that one set of sleeps,
 * counters and refusals binds both clients. If this file and its Python twin
 * ever disagree about a case, one of the two clients is wrong — and the
 * evaluator beside the corpus says which readings are the rules', so neither
 * suite can settle it by editing an expectation.
 *
 * THE CLOCK MODEL IS THE CORPUS'S, and it is not a convenience: time advances
 * ONLY by sleeps and every round trip takes 0 ms, so `deadline_ms` means the
 * same instant here as it does in Python. A harness whose stub took 3 ms per
 * trip would cross a deadline three milliseconds earlier than its twin and the
 * two SDKs would disagree about a case for a reason that is in neither client.
 *
 * WHAT THE CORPUS DOES NOT CLAIM, and is therefore asserted below by hand: the
 * 10-second timeout covers one ROUND TRIP (the corpus has no wall clock), that
 * `wait`'s polls go through the same retry path (the corpus scripts one call,
 * not a poll loop), that a `Retry-After` this client cannot read as integer
 * seconds becomes a computed retry (the corpus only ever scripts integers),
 * and where the counters start.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ApiRefusal,
  ResponseMalformed,
  WaitTimeout,
  ZifferClient,
  type FetchLike,
  type WireProposal,
} from './client.js';
import {
  DeadlineExceeded,
  isRetryable,
  parseRetryAfterSeconds,
  REQUEST_TIMEOUT_MS,
  RETRY_BUCKET_CAPACITY,
  RETRY_MAX_ATTEMPTS,
  RETRYABLE_STATUSES,
} from './retry.js';

// ================================================================= fixtures

const API_KEY = 'zfr_' + 'a'.repeat(43);
const ULID = '01j8z9k2c4d5e6f7g8h9j0k1m2';
const BASE_URL = 'http://gateway.invalid';

/** The same §1-shaped Proposal `client.test.ts` sends. Its exact values do not
 * matter to a retry rule; that its BYTES do not change between attempts does
 * (R7), and that is asserted per case. */
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

const PENDING_BODY = JSON.stringify({ decision_id: ULID, status: 'pending' });
const DECIDED_BODY = JSON.stringify({
  decision_id: ULID,
  status: 'decided',
  outcome: 'ALLOW',
});
/** Any §1-shaped refusal body: the corpus pins the STATUS, and the name it
 * arrives under is `client.test.ts`'s subject, not this file's. */
const REFUSAL_BODY = JSON.stringify({ error: 'AdmissionUnavailable' });

function jsonResponse(status: number, body: string, retryAfter?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (retryAfter !== undefined) {
    headers['retry-after'] = retryAfter;
  }
  return new Response(body, { status, headers });
}

/** A 2xx whose body is NOT JSON — an intermediary's page, a truncated write, a
 * gateway misconfigured to answer HTML. `jsonResponse` cannot produce one, and
 * a helper that cannot produce one cannot check what the client does with it. */
function unparseableResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

// ====================================================== reading the corpus

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REL = join('tools', 'fixtures', 'sdk-retry', 'cases.json');

/**
 * Walk up from THIS file to the repository root. The compiled test runs from
 * `dist/`, so the distance from here to the root is a build detail and
 * counting `..`s would encode it; the corpus's own path from the root is the
 * stable half, so that is what is searched for.
 */
function findFixture(): string {
  let dir = HERE;
  for (;;) {
    const candidate = join(dir, FIXTURE_REL);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `no ${FIXTURE_REL} at or above ${HERE}: the retry corpus is shared with the ` +
          'Python SDK and is read from the repository root, never copied into this package',
      );
    }
    dir = parent;
  }
}

const FIXTURE_PATH = findFixture();

/** Every refusal names the file, the place in it, and what was wrong — a
 * harness that threw `TypeError: undefined is not a function` over a corpus
 * key would send the reader into this file instead of into the corpus. */
function refuse(where: string, what: string): never {
  throw new Error(`${FIXTURE_PATH}: ${where}: ${what}`);
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function record(v: unknown, where: string): Readonly<Record<string, unknown>> {
  if (!isRecord(v)) {
    refuse(where, 'is not a JSON object');
  }
  return v;
}

function list(v: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(v)) {
    refuse(where, 'is not a JSON array');
  }
  return v;
}

function num(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    refuse(where, `is ${JSON.stringify(v)}, not a number`);
  }
  return v;
}

function int(v: unknown, where: string): number {
  const n = num(v, where);
  if (!Number.isSafeInteger(n)) {
    refuse(where, `is ${n}, not an integer`);
  }
  return n;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    refuse(where, `is ${JSON.stringify(v)}, not a non-empty string`);
  }
  return v;
}

type Outcome = 'ok' | 'Refused' | 'DeadlineExceeded';

function outcome(v: unknown, where: string): Outcome {
  if (v === 'ok' || v === 'Refused' || v === 'DeadlineExceeded') {
    return v;
  }
  refuse(where, `outcome ${JSON.stringify(v)} is not ok, Refused or DeadlineExceeded`);
}

/** One scripted answer, already normalised: a transport fault is status 0 with
 * no `Retry-After`, which is exactly how R1 reads it. */
interface Answer {
  readonly fault: 'timeout' | 'refused' | null;
  readonly status: number;
  readonly retryAfterS: number | null;
}

interface Expectation {
  readonly outcome: Outcome;
  readonly status: number;
  readonly attempts: number;
  readonly sleepsMs: readonly number[];
  readonly retriesDirected: number;
  readonly retriesComputed: number;
  readonly bucketLevelAfter: number;
  readonly bodiesIdentical: boolean;
}

interface Case {
  readonly name: string;
  readonly deadlineMs: number | null;
  readonly bucketInitial: number;
  readonly script: readonly Answer[];
  readonly draws: readonly number[];
  readonly expect: Expectation;
}

function parseAnswer(v: unknown, where: string): Answer {
  const o = record(v, where);
  const fault = o['fault'];
  if (fault !== undefined) {
    if (fault !== 'timeout' && fault !== 'refused') {
      refuse(where, `fault ${JSON.stringify(fault)} is not "timeout" or "refused"`);
    }
    return { fault, status: 0, retryAfterS: null };
  }
  const retryAfter = o['retry_after_s'];
  return {
    fault: null,
    status: int(o['status'], `${where}.status`),
    retryAfterS: retryAfter === null ? null : int(retryAfter, `${where}.retry_after_s`),
  };
}

function parseCase(v: unknown, index: number): Case {
  const o = record(v, `cases[${index}]`);
  const name = str(o['name'], `cases[${index}].name`);
  const method = str(o['method'], `${name}.method`);
  if (method !== 'POST') {
    // The corpus scripts `propose`; a `wait` poll is R8's other half and is
    // asserted further down by hand, not here.
    refuse(name, `method ${JSON.stringify(method)} is not POST`);
  }
  const deadline = o['deadline_ms'];
  const e = record(o['expect'], `${name}.expect`);
  return {
    name,
    deadlineMs: deadline === null ? null : int(deadline, `${name}.deadline_ms`),
    bucketInitial: int(o['bucket_initial'], `${name}.bucket_initial`),
    script: list(o['script'], `${name}.script`).map((a, i) =>
      parseAnswer(a, `${name}.script[${i}]`),
    ),
    draws: list(o['draws'], `${name}.draws`).map((u, i) => num(u, `${name}.draws[${i}]`)),
    expect: {
      outcome: outcome(e['outcome'], `${name}.expect`),
      status: int(e['status'], `${name}.expect.status`),
      attempts: int(e['attempts'], `${name}.expect.attempts`),
      sleepsMs: list(e['sleeps_ms'], `${name}.expect.sleeps_ms`).map((ms, i) =>
        int(ms, `${name}.expect.sleeps_ms[${i}]`),
      ),
      retriesDirected: int(e['retries_directed'], `${name}.expect.retries_directed`),
      retriesComputed: int(e['retries_computed'], `${name}.expect.retries_computed`),
      bucketLevelAfter: int(e['bucket_level_after'], `${name}.expect.bucket_level_after`),
      bodiesIdentical: e['bodies_identical'] === true,
    },
  };
}

function loadCases(): readonly Case[] {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const doc = record(parsed, 'the corpus');
  if (doc['schema_version'] !== 1) {
    refuse('schema_version', `is ${JSON.stringify(doc['schema_version'])}, not 1`);
  }
  const cases = list(doc['cases'], 'cases').map((c, i) => parseCase(c, i));
  if (cases.length === 0) {
    refuse('cases', 'is empty — a corpus over nothing proves nothing');
  }
  return cases;
}

const CASES = loadCases();

// =============================================================== the replay

/**
 * Replay one case. Every field of `expect` is asserted, including
 * `bodies_identical`, which is the harness's own obligation (R7): the corpus
 * cannot see the bytes, so it requires the field to be true and the harness
 * records what was actually sent on each attempt and compares.
 */
async function replay(c: Case): Promise<void> {
  let now = 0;
  let sent = 0;
  let lastStatus = 0;
  let drawn = 0;
  const sleeps: number[] = [];
  const bodies: string[] = [];

  const stubFetch: FetchLike = async (_url, init) => {
    const answer = c.script[sent];
    if (answer === undefined) {
      throw new Error(
        `${c.name}: the client made attempt ${sent + 1}; the case scripts ${c.script.length} answers`,
      );
    }
    sent += 1;
    bodies.push(init.body ?? '');
    if (answer.fault !== null) {
      lastStatus = 0;
      // A rejected fetch: refused, DNS, or an abort. R1 reads every one of
      // them as status 0 — no HTTP answer at all.
      const failure = new Error(`scripted transport fault: ${answer.fault}`);
      failure.name = answer.fault === 'timeout' ? 'TimeoutError' : 'TypeError';
      throw failure;
    }
    lastStatus = answer.status;
    const ok = answer.status >= 200 && answer.status < 300;
    return jsonResponse(
      answer.status,
      ok ? PENDING_BODY : REFUSAL_BODY,
      answer.retryAfterS === null ? undefined : String(answer.retryAfterS),
    );
  };

  const client = new ZifferClient(BASE_URL, API_KEY, {
    fetch: stubFetch,
    now: () => now,
    sleep: async (ms: number) => {
      // The clock model: the ONLY thing that moves time.
      sleeps.push(ms);
      now += ms;
    },
    random: () => {
      const u = c.draws[drawn];
      if (u === undefined) {
        throw new Error(
          `${c.name}: the client drew ${drawn + 1} values; the case carries ${c.draws.length}`,
        );
      }
      drawn += 1;
      return u;
    },
    retryBucketInitial: c.bucketInitial,
  });

  let got: Outcome;
  let status: number;
  try {
    const decision =
      c.deadlineMs === null
        ? await client.propose(PROPOSAL)
        : await client.propose(PROPOSAL, { deadlineMs: c.deadlineMs });
    // The `ok` outcome means the CALL RETURNED, not merely that nothing threw.
    assert.equal(decision.decision_id, ULID, `${c.name}: the resolved decision`);
    got = 'ok';
    status = lastStatus;
  } catch (thrown) {
    if (thrown instanceof ApiRefusal) {
      got = 'Refused';
      status = thrown.status;
    } else if (thrown instanceof DeadlineExceeded) {
      got = 'DeadlineExceeded';
      status = thrown.status;
    } else {
      const detail =
        thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
      throw new Error(`${c.name}: the client threw ${detail}, which is none of the three outcomes`);
    }
  }

  assert.equal(got, c.expect.outcome, `${c.name}: outcome`);
  assert.equal(status, c.expect.status, `${c.name}: status`);
  assert.equal(sent, c.expect.attempts, `${c.name}: attempts`);
  assert.deepStrictEqual(sleeps, [...c.expect.sleepsMs], `${c.name}: sleeps_ms`);

  const counters = client.retryCounters;
  assert.equal(counters.retries_directed, c.expect.retriesDirected, `${c.name}: retries_directed`);
  assert.equal(counters.retries_computed, c.expect.retriesComputed, `${c.name}: retries_computed`);
  assert.equal(
    counters.retry_bucket_level,
    c.expect.bucketLevelAfter,
    `${c.name}: retry_bucket_level after the call`,
  );

  // R7, the harness's own half: the bytes of every attempt, compared. And not
  // merely equal to each other — equal to the caller's proposal, because a
  // client that resent the same WRONG bytes every time would also pass an
  // identity check against itself.
  assert.equal(bodies.length, sent, `${c.name}: one recorded body per attempt`);
  const first = JSON.stringify(PROPOSAL);
  assert.equal(
    bodies.every((b) => b === first),
    c.expect.bodiesIdentical,
    `${c.name}: bodies_identical — the same serialised proposal on every attempt`,
  );

  // Draws are CONSUMED, not counted: a draw left over is an expectation about
  // a computed retry this client never computed.
  assert.equal(drawn, c.draws.length, `${c.name}: draws consumed`);
}

for (const c of CASES) {
  test(`corpus: ${c.name}`, async () => {
    await replay(c);
  });
}

test('corpus: every case in the shared file was replayed', () => {
  assert.ok(CASES.length > 0, 'the corpus is empty');
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'two cases share a name');
});

// ============================ the obligations the corpus does not carry ====

test('R1: the retryable list is one constant, and 500 is not on it', () => {
  // The list is a CONSTANT and this reads it, so the assertion is about the
  // one place the rule lives. 500 is the case the comment beside it explains:
  // ZIFFER names its own degradations 502/503, so a 500 is an unclassified
  // server fault and a resend repeats it.
  assert.deepStrictEqual([...RETRYABLE_STATUSES], [0, 429, 502, 503, 504]);
  for (const status of [0, 429, 502, 503, 504]) {
    assert.equal(isRetryable(status), true, `${status} should be retryable`);
  }
  for (const status of [200, 201, 400, 401, 403, 404, 409, 422, 500, 501, 505]) {
    assert.equal(isRetryable(status), false, `${status} should NOT be retryable`);
  }
});

test('R3: Retry-After is integer seconds only; everything else is read as absent', () => {
  assert.equal(parseRetryAfterSeconds('0'), 0);
  assert.equal(parseRetryAfterSeconds('1'), 1);
  assert.equal(parseRetryAfterSeconds('3600'), 3600);
  assert.equal(parseRetryAfterSeconds(' 7 '), 7);
  // Absent, empty, fractional, negative, signed, exponential, and the
  // HTTP-date spelling RFC 9110 also permits: every one of them becomes a
  // COMPUTED retry rather than a sleep of a length this client guessed at.
  assert.equal(parseRetryAfterSeconds(null), null);
  assert.equal(parseRetryAfterSeconds(''), null);
  assert.equal(parseRetryAfterSeconds('   '), null);
  assert.equal(parseRetryAfterSeconds('1.5'), null);
  assert.equal(parseRetryAfterSeconds('-1'), null);
  assert.equal(parseRetryAfterSeconds('+1'), null);
  assert.equal(parseRetryAfterSeconds('1e3'), null);
  assert.equal(parseRetryAfterSeconds('2 seconds'), null);
  assert.equal(parseRetryAfterSeconds('Wed, 21 Oct 2015 07:28:00 GMT'), null);
  assert.equal(parseRetryAfterSeconds('99999999999999999999'), null);
});

test('R3: a Retry-After this client cannot read falls back to a computed retry', async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  const client = new ZifferClient(BASE_URL, API_KEY, {
    fetch: async (_url, _init) => {
      attempt += 1;
      return attempt === 1
        ? jsonResponse(503, REFUSAL_BODY, '1.5')
        : jsonResponse(200, PENDING_BODY);
    },
    now: () => 0,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });

  const d = await client.propose(PROPOSAL);
  assert.equal(d.decision_id, ULID);
  // Computed, not directed: floor(0.5 * 500) and NOT 1500 ms.
  assert.deepStrictEqual(sleeps, [250]);
  assert.equal(client.retryCounters.retries_directed, 0);
  assert.equal(client.retryCounters.retries_computed, 1);
  assert.equal(client.retryCounters.retry_bucket_level, RETRY_BUCKET_CAPACITY);
});

test('R8: the default timeout is ten seconds, and it covers ONE round trip', () => {
  assert.equal(REQUEST_TIMEOUT_MS, 10_000);
});

test('R8: a round trip that outlives the timeout is a status-0 fault, and is retried', async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  let sawSignal = false;
  let abortReason = '';

  const client = new ZifferClient(BASE_URL, API_KEY, {
    // 20 ms rather than ten seconds, because the claim under test is that the
    // client aborts its own round trip at whatever that number is.
    timeoutMs: 20,
    fetch: (_url, init) => {
      attempt += 1;
      sawSignal = init.signal.aborted === false;
      if (attempt > 1) {
        return Promise.resolve(jsonResponse(200, PENDING_BODY));
      }
      return new Promise<Response>((resolve, reject) => {
        // The safety net is what makes this test FAIL rather than hang if the
        // client ever stops arming the signal: the answer would then arrive
        // on the first attempt, and `attempt` below would be 1. It is two
        // seconds rather than a hundred milliseconds because this test once
        // caught a REAL defect through it — `AbortSignal.timeout`'s weakly
        // held timer, which can be collected and then never fire — and a
        // narrow net would have read as ordinary flakiness.
        const safety = setTimeout(() => resolve(jsonResponse(200, PENDING_BODY)), 2_000);
        init.signal.addEventListener('abort', () => {
          clearTimeout(safety);
          const reason: unknown = init.signal.reason;
          abortReason = reason instanceof Error ? reason.name : String(reason);
          reject(reason instanceof Error ? reason : new Error('aborted'));
        });
      });
    },
    now: () => 0,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    random: () => 0,
  });

  const d = await client.propose(PROPOSAL);
  assert.equal(d.decision_id, ULID);
  assert.equal(sawSignal, true, 'the client armed an abort signal on the round trip');
  assert.equal(attempt, 2, 'the timed-out trip was retried, and the second one answered');
  // The abort says what it was: a client whose timeout surfaced as a bare
  // `Error` would report `DeadlineExceeded(lastError: "Error")` and tell the
  // operator nothing about which of their two timeouts fired.
  assert.equal(abortReason, 'TimeoutError');
  assert.deepStrictEqual(sleeps, [0], 'the retry was computed (u = 0)');
  // Status 0 carries no Retry-After, so a timeout is always a COMPUTED retry
  // and spends a token.
  assert.equal(client.retryCounters.retries_directed, 0);
  assert.equal(client.retryCounters.retries_computed, 1);
  assert.equal(client.retryCounters.retry_bucket_level, RETRY_BUCKET_CAPACITY - 1 + 1);
});

test('R8: wait polls through the same retry path and honours a directed retry', async () => {
  let now = 0;
  const sleeps: number[] = [];
  const answers: Response[] = [
    jsonResponse(503, REFUSAL_BODY, '1'), // the first poll's round trip fails
    jsonResponse(200, PENDING_BODY), //     it is retried, and the decision is not in yet
    jsonResponse(200, DECIDED_BODY), //     the second poll
  ];
  let index = 0;

  const client = new ZifferClient(BASE_URL, API_KEY, {
    fetch: async (_url, _init) => {
      const answer = answers[index];
      if (answer === undefined) {
        throw new Error(`wait made ${index + 1} round trips; this test scripts ${answers.length}`);
      }
      index += 1;
      return answer;
    },
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
  });

  const d = await client.wait(ULID, { timeoutMs: 30_000, intervalMs: 500 });
  assert.equal(d.status, 'decided');
  assert.equal(index, 3, 'three round trips: a directed retry inside the first poll');
  // 1000 is the server's direction inside poll one; 500 is wait's own polling
  // interval between the two polls. A retry and a poll are different sleeps.
  assert.deepStrictEqual(sleeps, [1000, 500]);
  assert.equal(client.retryCounters.retries_directed, 1);
  assert.equal(client.retryCounters.retries_computed, 0);
});

test('R9: the counters start at zero and the bucket starts full', () => {
  const client = new ZifferClient(BASE_URL, API_KEY);
  assert.deepStrictEqual(client.retryCounters, {
    retries_directed: 0,
    retries_computed: 0,
    retry_bucket_level: RETRY_BUCKET_CAPACITY,
  });
  assert.equal(RETRY_BUCKET_CAPACITY, 10);
});

test('R6/R9: the bucket is per CLIENT INSTANCE — two clients do not share it', async () => {
  const build = (): ZifferClient =>
    new ZifferClient(BASE_URL, API_KEY, {
      fetch: async (_url, _init) => jsonResponse(503, REFUSAL_BODY),
      now: () => 0,
      sleep: async () => {},
      random: () => 0,
      retryBucketInitial: 1,
    });

  const a = build();
  const b = build();
  await assert.rejects(a.propose(PROPOSAL), (e: unknown) => e instanceof ApiRefusal);
  assert.equal(a.retryCounters.retry_bucket_level, 0, 'the one token was spent');
  assert.equal(b.retryCounters.retry_bucket_level, 1, 'the other client still has its own');
  // And the counters are cumulative over the instance, not per call.
  await assert.rejects(a.propose(PROPOSAL), (e: unknown) => e instanceof ApiRefusal);
  assert.equal(a.retryCounters.retries_computed, 1, 'the second call had no token to spend');
});

test('R5: DeadlineExceeded names the last failure and is not an ApiRefusal', async () => {
  const client = new ZifferClient(BASE_URL, API_KEY, {
    fetch: async (_url, _init) => jsonResponse(503, REFUSAL_BODY, '30'),
    now: () => 0,
    sleep: async () => {
      throw new Error('a sleep was taken after the deadline had already passed');
    },
    random: () => 0,
  });

  await assert.rejects(
    client.propose(PROPOSAL, { deadlineMs: 1_000 }),
    (e: unknown) =>
      e instanceof DeadlineExceeded &&
      !(e instanceof ApiRefusal) &&
      e.status === 503 &&
      e.lastError === 'ApiRefusal' &&
      e.message.includes('503'),
  );
});

// ============================ the two points the corpus does not script =====
//
// ACP-355's addendum. The Python SDK carries a test of the SAME TITLE for each,
// because these are the two places the two SDKs drifted while both replayed the
// shared corpus green: the corpus scripts one `propose` against a parseable
// answer, so neither `wait`'s exception surface nor a 2xx this client cannot
// read is inside it. A shared title is what lets a reader line the two files up;
// see the README beside cases.json.

test('wait surfaces a poll deadline as WaitTimeout with the DeadlineExceeded as its cause', async () => {
  // A1. `wait` has ONE name for "no answer yet". Whether the last poll happened
  // to be mid-retry when the budget ran out is a fact about the gateway's load,
  // not about this API, so it must not decide which error type the caller
  // catches. The `DeadlineExceeded` rides on `cause` and keeps the last
  // failure's name and status reachable — the rename costs the caller nothing
  // it could otherwise have learned.
  let now = 0;
  const sleeps: number[] = [];
  const answers: Response[] = [
    jsonResponse(200, PENDING_BODY), //         the first poll: not in yet
    jsonResponse(503, REFUSAL_BODY, '3600'), // the second poll sheds, for an hour
  ];
  let index = 0;

  const client = new ZifferClient(BASE_URL, API_KEY, {
    fetch: async (_url, _init) => {
      const answer = answers[index];
      if (answer === undefined) {
        throw new Error(`wait made ${index + 1} round trips; this test scripts ${answers.length}`);
      }
      index += 1;
      return answer;
    },
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
  });

  await assert.rejects(
    client.wait(ULID, { timeoutMs: 30_000, intervalMs: 500 }),
    (e: unknown) => {
      // The surface is WaitTimeout and NOT DeadlineExceeded. Both halves are
      // asserted: a client that threw the deadline straight through would
      // satisfy neither, and one that swallowed the reason would satisfy only
      // the first.
      assert.ok(e instanceof WaitTimeout, `wait threw ${String(e)}, not a WaitTimeout`);
      assert.ok(!(e instanceof DeadlineExceeded));
      assert.equal(e.decisionId, ULID);
      const cause: unknown = e.cause;
      assert.ok(cause instanceof DeadlineExceeded, 'the DeadlineExceeded is the cause');
      assert.equal(cause.lastError, 'ApiRefusal');
      assert.equal(cause.status, 503);
      return true;
    },
  );
  // The hour was never slept: 500 ms is the poll interval and nothing else.
  assert.deepStrictEqual(sleeps, [500]);
  assert.equal(index, 2);
});

test('a 2xx refills the bucket even when its body does not parse', async () => {
  // A2. R6's refill is on the ANSWER, before the body is read. The bucket
  // measures whether the gateway is answering this client at all; a 2xx whose
  // body this client then refuses was still a round trip the gateway served.
  // Refilling after the parse instead makes the bucket a gauge of "answers I
  // could read", so a server sending well-formed-but-unreadable 200s drains it
  // and withholds the retries the next genuine 503 is owed.
  const build = (bucket: number): ZifferClient =>
    new ZifferClient(BASE_URL, API_KEY, {
      fetch: async (_url, _init) => unparseableResponse(200, '<html>not json</html>'),
      now: () => 0,
      sleep: async () => {
        throw new Error('a 2xx is not retryable; nothing should have slept');
      },
      random: () => 0,
      retryBucketInitial: bucket,
    });

  const client = build(3);
  // Still refused, and still by its own name: the refill is not leniency.
  await assert.rejects(
    client.propose(PROPOSAL),
    (e: unknown) => e instanceof ResponseMalformed && e.message.includes('non-JSON'),
  );
  assert.equal(client.retryCounters.retry_bucket_level, 4);
  assert.equal(client.retryCounters.retries_computed, 0, 'a 2xx is not retried');

  // The cap still holds on this path — the refill is `min(capacity, n + 1)`
  // here as on the good path, not an unbounded increment on a second one.
  const full = build(RETRY_BUCKET_CAPACITY);
  await assert.rejects(full.propose(PROPOSAL), (e: unknown) => e instanceof ResponseMalformed);
  assert.equal(full.retryCounters.retry_bucket_level, RETRY_BUCKET_CAPACITY);
});

// ====================================================== real sockets, no seam
//
// ACP-355, and the reason these three are here rather than in the corpus: the
// corpus scripts answers and faults BY NAME, and a socket that dies between
// the request and the answer has no name to script. Everything above injects
// `fetch` — low enough to run this client's whole retry loop, not low enough
// to produce these faults honestly, because to script one through that seam a
// test must construct the rejection itself, and constructing the rejection is
// assuming the answer to the question being asked.
//
// The Python SDK carries these same three titles, and it NEEDED them: there, a
// server that read the request and closed without answering raised
// `http.client.RemoteDisconnected` straight past the client — unclassified,
// unretried, and not an ApiError. These three ask whether this client has the
// same hole. It does not: `fetch` rejects on all three shapes and
// `roundTrip`'s catch maps every rejection to status 0 before `res.ok` is ever
// read, so the truncated answer cannot refill the bucket either. "It already
// works" is a claim, though, and a claim about a transport is worth exactly
// what was run against a real socket — which is why they are here anyway.

/** One whole HTTP/1.1 answer followed by a close. `Connection: close` on
 * purpose: undici pools sockets per origin, and a pooled connection would make
 * the server see fewer connections than the client made attempts. */
function rawAnswer(body: string): string {
  return (
    'HTTP/1.1 200 OK\r\n' +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n\r\n' +
    body
  );
}

/** A 200 that PROMISES 100 bytes, delivers 10 and closes. `jsonResponse`
 * cannot build one — there the body and its length are one value, and a
 * half-read answer is precisely the two of them disagreeing on the wire. */
const TRUNCATED_ANSWER =
  'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n' +
  'Content-Length: 100\r\nConnection: close\r\n\r\n0123456789';

interface RawServer {
  readonly url: string;
  /** The request body of every attempt, in order. R7 is `new Set(...).size === 1`. */
  readonly bodies: readonly string[];
  stop(): Promise<void>;
}

/**
 * A real TCP listener that answers BY SCRIPT, one entry per connection: a
 * string to write before closing, or `null` — accept, read the whole request,
 * and say nothing at all. `fallback` is what a connection past the end of the
 * script gets, so "this server never answers" is written without the test
 * having to guess how many attempts the rules permit.
 *
 * `mutate` runs after each request is recorded and is R7's instrument: the
 * caller's proposal object is changed between attempts, so a client that
 * re-serialised per attempt would send different bytes and `bodies` would stop
 * being one value. Comparing the bytes of an unchanged object proves nothing —
 * `JSON.stringify` returns the same string every time, so the assertion would
 * pass straight over the defect it claims to catch.
 */
function startRawServer(
  script: readonly (string | null)[],
  fallback: string | null,
  mutate?: (attempt: number) => void,
): Promise<RawServer> {
  const bodies: string[] = [];
  const live = new Set<Socket>();
  let served = 0;

  const server: Server = createServer((socket) => {
    live.add(socket);
    socket.on('close', () => {
      live.delete(socket);
    });
    // A reset from the client side is not this test's subject, and an
    // unhandled socket 'error' takes the whole test process down with it.
    socket.on('error', () => {});

    let buffer = Buffer.alloc(0);
    let bodyAt = -1;
    let bodyLength = 0;
    let answered = false;

    socket.on('data', (chunk: Buffer) => {
      if (answered) {
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      if (bodyAt < 0) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) {
          return;
        }
        bodyAt = end + 4;
        const head = buffer.subarray(0, end).toString('latin1');
        const declared = /\r\ncontent-length:[ \t]*(\d+)/i.exec(head)?.[1];
        bodyLength = declared === undefined ? 0 : Number(declared);
      }
      // READ TO THE LAST BYTE before closing. A socket closed with unread data
      // in its receive buffer sends an RST, and an RST is a different fault
      // reaching the same assertion — a test that would pass while exercising
      // a branch other than the one it names.
      if (buffer.length - bodyAt < bodyLength) {
        return;
      }
      answered = true;
      bodies.push(buffer.subarray(bodyAt, bodyAt + bodyLength).toString('utf8'));
      if (mutate !== undefined) {
        mutate(bodies.length);
      }
      const answer = served < script.length ? script[served] : fallback;
      served += 1;
      if (answer === undefined || answer === null) {
        socket.end(); // FIN, with nothing said at all
      } else {
        socket.end(answer);
      }
    });
  });

  return new Promise<RawServer>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the raw listener did not report a TCP port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        bodies,
        async stop(): Promise<void> {
          for (const socket of live) {
            socket.destroy();
          }
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

/**
 * The REAL `fetch` and the real transport against {@link startRawServer}; only
 * the sleep and the draw are injected, because R2's backoff is real
 * milliseconds and a suite that waits them out is a suite nobody runs. `fetch`
 * is deliberately NOT injected: it is the seam these three live below.
 */
function rawClient(server: RawServer, retryBucketInitial?: number): ZifferClient {
  return new ZifferClient(server.url, API_KEY, {
    timeoutMs: 5_000,
    sleep: async () => {},
    random: () => 0,
    ...(retryBucketInitial === undefined ? {} : { retryBucketInitial }),
  });
}

/** A copy of {@link PROPOSAL} whose fields can be assigned, so R7's instrument
 * has something to change. The mapped type STRIPS `readonly` and keeps every
 * field's domain indexed from {@link WireProposal} — retyping the shape here
 * would be a second definition of the wire object. */
type MutableProposal = { -readonly [K in keyof WireProposal]: WireProposal[K] };

test('a connection closed before any answer is status 0 and is retried', async () => {
  const proposal: MutableProposal = { ...PROPOSAL };
  const firstBytes = JSON.stringify(proposal);
  const server = await startRawServer([null, null], rawAnswer(PENDING_BODY), (n) => {
    proposal.tenant_id = `mutated-after-attempt-${n}`;
  });
  const client = rawClient(server);
  try {
    const d = await client.propose(proposal);
    assert.equal(d.decision_id, ULID);
  } finally {
    await server.stop();
  }

  assert.equal(server.bodies.length, 3, 'two silent closes, then the 200');
  assert.equal(client.retryCounters.retries_computed, 2);
  assert.equal(client.retryCounters.retries_directed, 0);
  // Two tokens spent, one put back by the 2xx.
  assert.equal(client.retryCounters.retry_bucket_level, RETRY_BUCKET_CAPACITY - 1);
  // R7 through a real socket: the same bytes reached the server on every
  // attempt, and they are the proposal as it was when the call began.
  assert.equal(new Set(server.bodies).size, 1, 'the resent bytes differ');
  assert.equal(server.bodies[0], firstBytes);
});

test('a server that never answers is refused at the cap with no HTTP status', async () => {
  // The NAME differs by SDK — Python's `GatewayUnreachable`, whatever `fetch`
  // rejected with here — so what both owe is the shape: five attempts, four
  // computed retries, and then a failure that is neither a refusal nor a
  // malformed answer, because no status ever arrived to make it one.
  const proposal: MutableProposal = { ...PROPOSAL };
  const firstBytes = JSON.stringify(proposal);
  const server = await startRawServer([], null, (n) => {
    proposal.tenant_id = `mutated-after-attempt-${n}`;
  });
  const client = rawClient(server);
  try {
    await assert.rejects(client.propose(proposal), (e: unknown) => {
      assert.ok(e instanceof Error, `a non-Error escaped: ${String(e)}`);
      assert.ok(!(e instanceof ApiRefusal), 'nothing was refused; nothing answered');
      assert.ok(!(e instanceof ResponseMalformed), 'there was no answer to malform');
      assert.ok(!(e instanceof DeadlineExceeded), 'no deadline was given');
      return true;
    });
  } finally {
    await server.stop();
  }

  assert.equal(RETRY_MAX_ATTEMPTS, 5);
  assert.equal(server.bodies.length, RETRY_MAX_ATTEMPTS, 'R4 bounds a silent server');
  assert.equal(client.retryCounters.retries_computed, RETRY_MAX_ATTEMPTS - 1);
  assert.equal(
    client.retryCounters.retry_bucket_level,
    RETRY_BUCKET_CAPACITY - (RETRY_MAX_ATTEMPTS - 1),
    'nothing answered, so nothing refilled',
  );
  assert.equal(new Set(server.bodies).size, 1, 'the resent bytes differ');
  assert.equal(server.bodies[0], firstBytes);
});

test('an answer cut off mid-body is status 0 and does not refill the bucket', async () => {
  // A2 says R6's refill is on the 2xx ANSWER, before the body is parsed — and
  // this is the edge that sentence does not reach. A body that stops early is
  // not an answer the gateway finished serving, so there is no completed round
  // trip for the bucket to credit. The status line said 200 and the outcome is
  // still status 0, because what R1 classifies is whether a usable answer
  // arrived, not what its first line claimed.
  //
  // THE BUCKET STARTS AT ONE, and that is the instrument. One token buys
  // exactly one computed retry, so a client that does not refill makes two
  // attempts and ends empty. A client that refilled on each 200 status line
  // would put a token back as fast as it spent one and run to R4's cap instead
  // — five attempts, gauge at 2 — so the defect moves the attempt COUNT as
  // well as the gauge. Starting the bucket empty would have hidden half of
  // that: with no retry to make, "did not refill" and "refilled into a budget
  // nobody spent" look the same from outside.
  const server = await startRawServer([], TRUNCATED_ANSWER);
  const client = rawClient(server, 1);
  try {
    await assert.rejects(client.propose(PROPOSAL), (e: unknown) => {
      assert.ok(e instanceof Error, `a non-Error escaped: ${String(e)}`);
      // NOT ResponseMalformed: a client that read `res.ok` first and refused
      // the short body as unparseable JSON would have refilled on the way,
      // which is the defect this test is about and not a spelling difference.
      assert.ok(!(e instanceof ResponseMalformed), 'a truncated read is not a bad body');
      assert.ok(!(e instanceof ApiRefusal), 'a 200 status line refused nothing');
      return true;
    });
  } finally {
    await server.stop();
  }
  // Two attempts: status 0 IS retryable, so the one token was spent — and then
  // the bucket was empty, because nothing put one back.
  assert.equal(server.bodies.length, 2);
  assert.equal(client.retryCounters.retries_computed, 1);
  assert.equal(client.retryCounters.retry_bucket_level, 0);

  // THE CONTROL, in the same test. The same client shape against a server that
  // FINISHES its answer does refill from 0 to 1 — so the assertion above is
  // about the truncation and not about a gauge that never moves.
  const whole = await startRawServer([], rawAnswer(PENDING_BODY));
  const control = rawClient(whole, 0);
  try {
    assert.equal((await control.propose(PROPOSAL)).decision_id, ULID);
  } finally {
    await whole.stop();
  }
  assert.equal(control.retryCounters.retry_bucket_level, 1);
});
