# The SDK retry corpus (ACP-355)

`cases.json` beside this file is ONE corpus that both SDKs replay — `sdk/python`
and `packages/acp-client`. It exists because retry is the part of a client that
is easy to write twice and impossible to notice diverging: a Python client that
backs off 500 ms where the TypeScript one backs off 1000 ms passes both test
suites and gives one customer a gateway that recovers and another a gateway that
gives up. Two implementations of one rule are two rules unless something holds
them to the same bytes.

`tools/check-sdk-retry-fixture.py` is the reference evaluator. It recomputes
every `expect` from `script` + `draws` + `deadline_ms` + `bucket_initial` under
R1..R9 and refuses a case whose expectation disagrees, naming the case, the
field, the expected value and the recomputed one. So a corpus edited to agree
with a broken implementation goes red here before it can be green there.
`--selfcheck` plants wrong expectations in a copy and requires each to be
refused, because a corpus checker that cannot refuse is a corpus with no checker.

## R1..R10, verbatim

> R1. Retryable answers: no HTTP status at all (status 0: refused, DNS, timeout), 429, 502, 503, 504.
>     Never any other 4xx. **500 is deliberately NOT retryable**; write the reason beside the list:
>     ZIFFER names its own degradations 502/503, so a 500 is an unclassified server fault and a
>     resend repeats it.
> R2. Computed sleep: full jitter. `sleep_ms = floor(u * min(30000, 500 * 2^k))`, `u` in [0,1),
>     `k` = 0 for the first computed retry, incremented per computed retry.
> R3. Directed sleep: a retryable answer carrying `Retry-After: N` (integer seconds) sleeps exactly
>     `N * 1000` ms. The client adds NO jitter (the server already drew it) and `k` does not advance.
> R4. Cap: at most 5 attempts in total when the caller gave no deadline. With a deadline, computed
>     retries are still capped at 5 attempts; directed retries are bounded by the deadline only.
> R5. Deadline: `propose(..., deadline=<seconds from now>)` / `{deadlineMs}`. Before every sleep:
>     if `now + sleep > deadline`, do not sleep, raise/throw `DeadlineExceeded` carrying the last
>     error's name and status. No deadline = no such check.
> R6. Token bucket, per client instance: capacity 10, starts full. A computed retry spends 1; an
>     empty bucket means no computed retry and the last error is raised as it is. A directed retry
>     spends 0. Every successful call (2xx) adds 1, up to capacity.
> R7. Hash stability: the request body is serialized ONCE above the retry loop and the same bytes
>     are resent. The gateway keys the pending hold on the hash of the bytes it receives.
> R8. The 10 s timeout covers one round trip. `propose` returns the locator at once; waiting for a
>     human is `wait`, which polls and honours R1..R6 per poll.
> R9. Counters on the client instance: `retries_directed`, `retries_computed`, gauge
>     `retry_bucket_level`. Readable by the caller (a property / getter returning a plain object).
> R10. The MCP server (`packages/mcp`) wraps the SDK and adds no retry of its own.

## The clock model, which both replay harnesses MUST share

**Time advances ONLY by sleeps. Every round trip takes 0 ms in the fixture.**
`now` starts at 0 and `deadline_ms` is an absolute instant on that same clock, so
a case with `deadline_ms: 700` means the whole call — sleeps only — must finish
by 700 ms.

This is not a simplification for convenience, it is what makes the corpus
portable. A harness whose stub server takes 3 ms per round trip would cross
`deadline_ms` three milliseconds earlier than one that takes 0, and the two SDKs
would then disagree about a case for a reason that is in neither client. The
injected clock returns `now`; only the injected sleep moves it.

## R1..R9 made exact

The rules above are prose, and a corpus cannot be ambiguous. These are the
readings the evaluator implements and both SDKs must implement.

**The loop.** Per attempt: send the bytes, read the answer. A 2xx returns (R6
refills first). A non-retryable answer raises. A retryable answer is a candidate
for a retry, and whether the retry happens is R4, then R6, then R5, in that
order.

**R1.** Retryable is exactly `{0, 429, 502, 503, 504}`, where 0 is `{"fault":
"timeout"}` or `{"fault": "refused"}` — no HTTP answer at all. Everything else
raises, 500 included, and **R1 beats R3**: a 500 carrying `Retry-After` is not
retried (`r1-500-with-retry-after-is-still-not-retried`).

**R2.** `k` starts at 0 and is incremented **only** by a computed retry that
actually happened. A computed sleep that was blocked by R4, R6 or R5 does not
advance it — there was no computed retry. `floor` truncates and does not round
(`r2-floor-truncates-it-does-not-round`).

*A bound no case can reach, said out loud.* `min(30000, 500 * 2^k)` clamps at
30 000 ms from `k = 6`, and R4 caps computed retries at four, so `k` never
exceeds 3 and the largest base this corpus can produce is `500 * 2^3 = 4000`.
**The 30 000 ms clamp is therefore unreachable and no case exercises it.** It
becomes live only if the cap in R4 moves. It is written here rather than dropped
because a bound that changes no outcome is documentation and not a control, and
the next person to raise the cap needs to know which of the two it is today.

**R3.** `Retry-After` is an integer number of seconds; the sleep is exactly
`N * 1000` ms, `N = 0` included (`r3-retry-after-zero-sleeps-zero`). It consumes
no draw, spends no token and does not advance `k`.

**R4, made exact in one counter each.** The sentence is two rules:

  * a **computed** retry requires `1 + retries_computed < 5` — at most four
    computed retries, which is five attempts when every retry was computed.
    This holds whether or not there is a deadline
    (`r4-computed-still-capped-under-a-long-deadline`).
  * with **no deadline**, a retry of either kind additionally requires
    `attempts < 5`, which is the "at most 5 attempts in total" half
    (`r4-cap-counts-directed-retries-when-there-is-no-deadline`).

So under a deadline a run can pass five attempts on directed retries alone
(`r4-directed-runs-past-five-attempts-under-a-deadline`, 8 attempts) while the
computed budget is still four
(`r4-computed-cap-fires-after-directed-pushed-attempts-past-five`).

**R5.** The check is `now + sleep > deadline`, strictly greater: a sleep that
lands exactly on the deadline is taken
(`r5-deadline-exactly-equal-to-the-sleep-is-allowed`). It runs **before every
sleep**, directed and computed alike, and **after** R4 and R6 — if no retry was
going to happen there is no sleep to check, so an empty bucket raises the last
error and not `DeadlineExceeded`. `expect.status` on a `DeadlineExceeded` case is
the **last error's** status, which is 0 when the last error was a transport fault
(`r5-deadline-carries-the-last-errors-status-zero`).

**R6.** Capacity 10. A computed retry spends 1 **when it happens**; a blocked
one spends nothing. A directed retry spends 0. A 2xx adds 1, clamped at capacity
(`r6-refill-caps-at-capacity`). Nothing else refills — a refusal after a spent
token leaves the bucket down (`r6-no-refill-on-a-refusal`).

**R7.** `bodies_identical` is the harness's assertion, not the evaluator's: the
replay harness records the bytes it sent on every attempt and compares them. The
evaluator requires the field to be `true` and refuses a case that says otherwise,
because a corpus case expecting the bytes to change is a case expecting the
defect R7 exists to prevent.

**R8.** Only half of R8 is observable here, and the corpus claims only that half:
a round-trip timeout surfaces as a status-0 fault and is **retried** like any
other one (`r1-fault-timeout-is-retried`), rather than ending the call. The 10 s
number itself, and `wait`'s polling, are per-implementation obligations — the
fixture's clock has no wall time and the corpus scripts one call, not a poll
loop. Both SDKs own a test for them; this corpus does not.

**R9.** Every case pins `retries_directed`, `retries_computed` and
`bucket_level_after` (the `retry_bucket_level` gauge after the call), so the
counters are asserted by the whole corpus. The cases tagged `R9` are the ones
where both counters are non-zero or the bucket moved, which are the cases that
would catch a counter attributed to the wrong kind of retry.

**R10** is not a fixture case. `packages/mcp` adds no retry, which is an absence,
and an absence is asserted where the code is.

## The field shapes

Top level: `schema_version`, `note`, `cases`. Nothing else — the evaluator
refuses an unknown key by name, on purpose, because a key a reader adds and no
implementation reads is a claim with no executable consumer.

Per case, all eight keys required and no others:

| key | meaning |
| --- | --- |
| `name` | unique, and the string the evaluator and both harnesses report failures under |
| `rules` | the rules this case is DESIGNED to exercise — the ones whose deletion moves this expectation. The evaluator asserts the union over all cases is exactly R1..R9, so the corpus cannot shrink past a rule in silence |
| `deadline_ms` | absolute instant on the fixture clock, or `null` for no deadline |
| `bucket_initial` | 0..10, the token bucket at the start of the call |
| `method` | `"POST"`. The corpus scripts `propose`; a `wait` poll is R8's other half and is not expressed here |
| `script` | ordered answers, one per attempt: `{"status": N, "retry_after_s": N\|null}` or `{"fault": "timeout"\|"refused"}` |
| `draws` | the `u` values the injected random returns, in order |
| `expect` | `outcome`, `status`, `attempts`, `sleeps_ms`, `retries_directed`, `retries_computed`, `bucket_level_after`, `bodies_identical` |

`outcome` is one of three **language-neutral** names, because the two SDKs do not
share a type name — Python raises `ApiError`, TypeScript throws `ApiRefusal` —
and a corpus that named one of them would be a corpus for one SDK:

| `outcome` | Python | TypeScript |
| --- | --- | --- |
| `ok` | the call returned | the call resolved |
| `Refused` | `ApiError(name, status)` | `ApiRefusal` |
| `DeadlineExceeded` | `DeadlineExceeded` | `DeadlineExceeded` |

`DeadlineExceeded` is named in R5 itself, so both SDKs owe a type of that name.

**`draws` are CONSUMED, not counted.** A case carries exactly as many draws as
the replay consumes and no more; the evaluator refuses a case that runs out and a
case with draws left over. Note the one place the two differ: a computed sleep
blocked by the **deadline** was computed before it was refused, so it consumed
its draw and produced no retry — `r5-deadline-hit-before-a-computed-sleep` has
one draw and `retries_computed: 0`. A computed retry blocked by R4's cap or R6's
empty bucket was never computed at all and consumes nothing.

## What the corpus does not script

The corpus scripts ONE `propose` against answers whose bodies parse, on a clock
with no wall time. Two things therefore fall outside it, and both are places the
two SDKs had already drifted while every case replayed green in both — which is
the corpus's own limit, not an argument against it: a shared corpus proves the
rules it expresses and says nothing about the ones it cannot.

Each is settled the same way in both SDKs, and each owes a **per-implementation
test carrying the SAME TITLE in both suites**, so the two files line up by
reading. A third SDK owes these two tests with these two titles.

**A1. `wait` surfaces a poll's deadline as `WaitTimeout`, never as
`DeadlineExceeded`.** Every poll runs under the wait's own deadline (R8 + R5),
so a poll that runs out of retry budget and the wait running out of time are the
same event; which of the two names a caller saw depended only on whether the
last poll happened to be mid-retry, which is a fact about the gateway's load and
not about the API. The `DeadlineExceeded` is carried as the `cause`
(`__cause__` in Python, `cause` in TypeScript), so the last failure's name and
status stay reachable — the rename costs the caller nothing it could otherwise
have learned. `propose` and `decision` called directly are unchanged: there is
no wait to time out, and `DeadlineExceeded` is the answer.

> test title, both SDKs:
> `wait surfaces a poll deadline as WaitTimeout with the DeadlineExceeded as its cause`

**A2. R6's refill happens on the 2xx ANSWER, before the body is parsed.** The
bucket measures whether the gateway is answering this client at all, and a 2xx
whose body the client then refuses as `UnexpectedResponse` / `ResponseMalformed`
was still a round trip the gateway served. Refilling after a successful parse
instead makes the bucket a gauge of "answers I could read": a server sending
well-formed-but-unreadable 200s drains it and then withholds the computed
retries the next genuine 503 is entitled to. The answer is still refused by
name — the refill is not leniency about the body — and the cap still applies.

> test title, both SDKs:
> `a 2xx refills the bucket even when its body does not parse`

**A3. A socket that dies between the request and the answer.** The corpus
scripts answers and faults BY NAME (`{"fault": "timeout"}`, a status), so it
cannot express a connection the server accepted, read and then closed, nor a
200 whose body stops short of its own `Content-Length` — to script either, a
harness has to construct the exception itself, and constructing it is assuming
the answer. All three are R1's "no HTTP status at all": status 0, retryable,
and no refill, because a half-read answer is not a round trip the gateway
finished serving. Both SDKs owe these three against a REAL socket, and Python
needed them — `http.client.RemoteDisconnected` is neither a `URLError` nor a
timeout, so it escaped that client entirely until ACP-355.

> test titles, both SDKs:
> `a connection closed before any answer is status 0 and is retried`
> `a server that never answers is refused at the cap with no HTTP status`
> `an answer cut off mid-body is status 0 and does not refill the bucket`

## Adding a case

Write the `expect` by hand, then run the evaluator. Do not generate the
expectation from the evaluator and then check it with the same code: a corpus
derived from its own checker agrees with itself by construction and asserts
nothing. If the evaluator names your case, one of the two of you is wrong, and
which one is a question you answer by reading R1..R9 — not by editing the number
until it is green.
