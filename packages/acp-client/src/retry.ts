/**
 * The retry rules, in one place, for the one request path (ACP-355).
 *
 * A client that resends is a client that decides, on the customer's behalf,
 * which failures are worth another try — and the wrong answer is expensive in
 * both directions: a resend of something the gateway already accepted is a
 * second hold on the same action, and a give-up on a degradation the gateway
 * named is an outage the customer did not have. So the rules are written once,
 * here, and the shared corpus `tools/fixtures/sdk-retry/cases.json` holds this
 * SDK and the Python one to the same sleeps, the same counters and the same
 * refusals. Two implementations of one rule are two rules unless something
 * holds them to the same bytes.
 *
 * Nothing in this module talks to the network, reads a clock or draws a random
 * number: it is handed `now`, the draw and the caller's deadline, and it
 * returns what should happen next. That is what makes the corpus replayable —
 * see `retry.test.ts`, where time advances only by sleeps.
 */

/**
 * R1. The answers a resend can help with, as ONE list.
 *
 * `0` is not an HTTP status: it is this client's spelling of "no HTTP answer at
 * all" — the connection was refused, DNS failed, or the round trip outlived
 * {@link REQUEST_TIMEOUT_MS}. The request may or may not have reached the
 * gateway, and that is precisely why it is retryable: the gateway keys a
 * pending hold on the hash of the bytes it received (R7), so a resend of the
 * SAME bytes lands on the same hold rather than opening a second one.
 *
 * **500 is deliberately not on this list.** ZIFFER names its own degradations
 * 502 and 503, so a 500 is an unclassified server fault — something the
 * gateway did not expect and did not classify — and a resend repeats it. Every
 * other 4xx is absent for the plainer reason: the request was refused on its
 * merits and the same bytes will be refused again.
 */
export const RETRYABLE_STATUSES: readonly number[] = [0, 429, 502, 503, 504];

/** R2. The first computed backoff window, doubled per computed retry. */
export const RETRY_BASE_MS = 500;

/**
 * R2. The ceiling on the computed window. Unreachable today: R4 caps computed
 * retries at four, so `k` never exceeds 3 and the largest window this client
 * can produce is `500 * 2^3 = 4000` ms. It is written here rather than dropped
 * because a bound that changes no outcome is documentation and not a control,
 * and the next person to raise the cap needs to know which of the two it is.
 */
export const RETRY_MAX_BACKOFF_MS = 30_000;

/** R4. At most five attempts in total when the caller gave no deadline; and,
 * deadline or not, at most four of those may be computed retries. */
export const RETRY_MAX_ATTEMPTS = 5;

/** R6. The token bucket's capacity, and the level a fresh client starts at. */
export const RETRY_BUCKET_CAPACITY = 10;

/**
 * R8. The timeout on ONE ROUND TRIP — send, and read the answer's body. It is
 * not a budget for the call: a call that retries four times may take far
 * longer than this and is not wrong for doing so. Waiting for a human to
 * approve is not a round trip either; that is `ZifferClient.wait`, which polls.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** The header R3 reads. Lowercase because that is how `Headers.get` matches. */
export const RETRY_AFTER_HEADER = 'retry-after';

/**
 * R9. What the caller can read off the client instance: two counters and one
 * gauge. Snake_case because these are the names R1..R10 gives them and the
 * shared corpus pins them — a second spelling here would be a second name for
 * one number, and the Python SDK's reader would be reading a different object.
 *
 * `retries_directed` and `retries_computed` are cumulative over the client's
 * whole life; `retry_bucket_level` is a level, not a count, and moves both ways.
 */
export interface RetryCounters {
  /** Retries the SERVER asked for, by sending `Retry-After` (R3). */
  readonly retries_directed: number;
  /** Retries this client decided on its own, with jittered backoff (R2). */
  readonly retries_computed: number;
  /** R6's bucket, 0..{@link RETRY_BUCKET_CAPACITY}. */
  readonly retry_bucket_level: number;
}

/**
 * R5. The call's deadline arrived before the next sleep could be taken.
 *
 * Distinct from every other failure on purpose: it says the RETRY was
 * abandoned, not that the gateway refused. It carries the last failure's name
 * and status so the operator learns what was actually going wrong — a
 * `DeadlineExceeded` that did not say "the last thing we saw was a 503" would
 * send the reader looking at their own timeout instead of at the gateway.
 *
 * Thrown only when the caller gave a deadline. No deadline means no such
 * check, and a directed sleep of an hour is then taken as directed.
 */
export class DeadlineExceeded extends Error {
  /** The name of the last failure before the deadline — `ApiRefusal`,
   * `ResponseMalformed`, `TimeoutError`, whatever the transport threw. */
  readonly lastError: string;
  /** The last failure's HTTP status; `0` when there was no HTTP answer. */
  readonly status: number;

  constructor(lastError: string, status: number) {
    super(
      `the deadline passed before the next retry could be taken; the last failure was ` +
        `${lastError}${status === 0 ? ' with no HTTP answer' : ` (HTTP ${status})`}`,
    );
    this.name = 'DeadlineExceeded';
    this.lastError = lastError;
    this.status = status;
  }
}

/** R1. `status` is an HTTP status, or 0 for no HTTP answer at all. */
export function isRetryable(status: number): boolean {
  return RETRYABLE_STATUSES.includes(status);
}

/**
 * R2. Full jitter: `floor(u * min(30000, 500 * 2^k))`, `u` in [0,1).
 *
 * Full jitter and not "backoff plus a little noise", because the failure this
 * defends against is a fleet of clients that all saw the same 503 and all come
 * back at the same instant. Sleeping a uniform draw from the whole window is
 * what spreads them; a narrow band around the window keeps the herd together.
 * `floor` truncates and does not round.
 */
export function computedSleepMs(u: number, k: number): number {
  return Math.floor(u * Math.min(RETRY_MAX_BACKOFF_MS, RETRY_BASE_MS * 2 ** k));
}

/**
 * R3. `Retry-After` as an INTEGER NUMBER OF SECONDS, or `null` for "no
 * direction given".
 *
 * Integer seconds only. HTTP also permits an HTTP-date here, and `1.5`, `-1`
 * and an empty value all exist in the wild; every one of them is read as
 * ABSENT and the retry becomes a computed one. That is deliberate and it is
 * the fail-safe direction: a misparsed date is a sleep of the wrong length
 * (`Date.parse` of a malformed date yields NaN, and a NaN sleep is either
 * instant or forever), while falling back to the computed path yields a sleep
 * this client already knows how to bound. A value this client cannot read is
 * not a direction it should follow.
 */
export function parseRetryAfterSeconds(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const text = raw.trim();
  // Digits only: this refuses '', '1.5', '-1', '+1', '1e3' and every HTTP-date
  // spelling, each of which becomes a computed retry.
  if (!/^[0-9]+$/.test(text)) {
    return null;
  }
  const seconds = Number.parseInt(text, 10);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/** What {@link RetryPolicy.decide} says to do next. */
export type RetryStep =
  /** No retry. The caller throws the failure it already has, as it is. */
  | { readonly kind: 'stop' }
  /** R5: a retry was due, but its sleep would cross the deadline. */
  | { readonly kind: 'deadline' }
  /** Sleep this long, then send the same bytes again. */
  | { readonly kind: 'sleep'; readonly ms: number; readonly directed: boolean };

const STOP: RetryStep = { kind: 'stop' };
const DEADLINE: RetryStep = { kind: 'deadline' };

/**
 * The state of ONE call: attempts made, R2's `k`, and how many of this call's
 * retries were computed.
 *
 * It is handed in rather than kept on the policy because one client may have
 * two calls in flight — `propose` and a `wait` poll, say — and a `k` living on
 * the client would be two calls sharing one backoff window, each doubling the
 * other's. The bucket and the counters are per client (R6, R9); everything
 * that resets per call is here.
 */
export interface CallState {
  /** Round trips made so far in this call, including the one just answered. */
  attempts: number;
  /** R2's exponent. Advanced ONLY by a computed retry that actually happened. */
  k: number;
  /** R4's computed budget for this call. */
  computed: number;
}

/** A fresh call's state. */
export function newCall(): CallState {
  return { attempts: 0, k: 0, computed: 0 };
}

/**
 * R1..R6 for one client instance: the token bucket, the two counters, and the
 * decision.
 *
 * The bucket (R6) is the part that is easy to leave out and expensive to be
 * without. Backoff alone still lets a client retry every call it makes, so a
 * gateway that is down stays under the full retried load of every customer
 * process at once. The bucket makes retrying a SHARED, exhaustible budget: ten
 * computed retries, refilled one per successful call, so a client whose calls
 * are all failing stops retrying and a client that is mostly healthy keeps its
 * headroom. A directed retry spends nothing, because the server asked for it
 * and it already knows its own load.
 */
export class RetryPolicy {
  private bucket: number;
  private directed = 0;
  private computed = 0;

  constructor(initialBucket: number = RETRY_BUCKET_CAPACITY) {
    if (
      !Number.isInteger(initialBucket) ||
      initialBucket < 0 ||
      initialBucket > RETRY_BUCKET_CAPACITY
    ) {
      throw new TypeError(
        `RetryPolicy: the initial bucket must be an integer 0..${RETRY_BUCKET_CAPACITY}`,
      );
    }
    this.bucket = initialBucket;
  }

  /** R9, as a plain object: a snapshot, not a live view. */
  get counters(): RetryCounters {
    return {
      retries_directed: this.directed,
      retries_computed: this.computed,
      retry_bucket_level: this.bucket,
    };
  }

  /** R6: every successful call (2xx) adds one token, capped at capacity. */
  refill(): void {
    this.bucket = Math.min(RETRY_BUCKET_CAPACITY, this.bucket + 1);
  }

  /**
   * The whole of R1..R6 for one answer, in the order the corpus's README
   * states: **R4, then R6, then R5**.
   *
   * That order is load-bearing. R5 runs last because it is a question about a
   * SLEEP — if R4's cap or R6's empty bucket already said there is no retry,
   * there is no sleep to measure and the caller gets the gateway's own last
   * error rather than a `DeadlineExceeded` that names the wrong problem.
   *
   * Counters and the bucket move only on the branch that returns `sleep`: a
   * retry that was computed and then refused by the deadline is not a retry,
   * and counting it would inflate the only numbers an operator has. The draw
   * IS consumed on that path, because it was drawn before the deadline
   * refused it.
   *
   * `deadlineAtMs` is an absolute instant on the same clock as `nowMs`;
   * `undefined` means the caller gave no deadline, and then R5 does not run.
   */
  decide(
    status: number,
    retryAfterS: number | null,
    call: CallState,
    nowMs: number,
    deadlineAtMs: number | undefined,
    draw: () => number,
  ): RetryStep {
    // R1, and it beats R3: a 500 carrying `Retry-After` is still not retried.
    // The status decides; a header cannot promote an answer into the list.
    if (!isRetryable(status)) {
      return STOP;
    }

    // R4, half one: with NO deadline the cap counts attempts of either kind.
    // Under a deadline the deadline is the bound on directed retries, because
    // the server asking for a tenth try is the server telling us it is coming
    // back — and the caller said how long it is prepared to wait.
    if (deadlineAtMs === undefined && call.attempts >= RETRY_MAX_ATTEMPTS) {
      return STOP;
    }

    let ms: number;
    if (retryAfterS !== null) {
      // R3: exactly N seconds. No jitter — the server already drew it, and a
      // client adding its own would smear the window the server chose.
      ms = retryAfterS * 1000;
    } else {
      // R4, half two: the computed budget is four retries, deadline or not.
      // A deadline buys patience with a server that is answering, not licence
      // to hammer one that is not.
      if (call.computed >= RETRY_MAX_ATTEMPTS - 1) {
        return STOP;
      }
      // R6: an empty bucket means no computed retry, and the last error is
      // raised exactly as it is.
      if (this.bucket <= 0) {
        return STOP;
      }
      ms = computedSleepMs(draw(), call.k);
    }

    // R5, strictly greater: a sleep that lands exactly on the deadline is taken.
    if (deadlineAtMs !== undefined && nowMs + ms > deadlineAtMs) {
      return DEADLINE;
    }

    if (retryAfterS !== null) {
      // R3/R6: spends no token, and `k` does not advance — the server's
      // direction is not evidence about how loaded WE think it is.
      this.directed += 1;
    } else {
      this.computed += 1;
      this.bucket -= 1;
      call.computed += 1;
      call.k += 1;
    }
    return { kind: 'sleep', ms, directed: retryAfterS !== null };
  }
}
