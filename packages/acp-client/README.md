# @ziffer-io/client

The ZIFFER client for TypeScript. Propose an action, wait for the decision, and verify the signed
receipt in your own process before you act.

## Install

```bash
npm install @ziffer-io/client
```

Node 22 or later. The wire types and the receipt verifier are installed with it.

## Quickstart

```ts
import { ZifferClient, loadTrustAnchor, verifyReceipt } from '@ziffer-io/client';

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

const anchor = await loadTrustAnchor(env('ZIFFER_TRUST_ANCHOR'), env('ZIFFER_SUITE_FLOOR'));
const client = new ZifferClient(env('ZIFFER_API_URL'), env('ZIFFER_API_KEY'));

const submitted = await client.propose(proposal);
const decision = await client.waitForReceipt(submitted.decision_id, { timeoutMs: 30_000 });
if (decision.receipt === undefined) throw new Error(`ziffer refused: ${decision.refusal_category}`);

verifyReceipt(decision.receipt, new TextEncoder().encode(JSON.stringify(proposal)), anchor);
await bank.transfer(amount, toAccount);   // your line, unchanged
```

You pass the proposal twice on purpose. The verifier hashes the bytes you hand it and compares
them with the receipt's claim. The check is against your copy, not against ours. Key order and
spacing do not matter.

`verifyReceipt` checks the answer. Your own `if` is what stops the action.

`waitForReceipt` returns once the receipt can be read, or with the refusal, and never proposes
again. `wait` returns earlier, at the decision, which can come before the receipt.

An action that needs human approval keeps `waitForReceipt` waiting until a person approves, so
give it minutes rather than seconds; past the deadline it throws `WaitTimeout` and the decision
stays open. Its receipt carries the approvals, and verifies only against your own approver
registry: read it with `loadAttesterRegistry(path)` and hand it to the anchor as `quorum`. The SDK
guide shows the whole of it.

`loadTrustAnchor` reads the file `ziffer pubkey` wrote and refuses a missing, malformed or
secret-key file by name. Under TypeScript's strict settings `process.env` values are typed
`string | undefined`, which is why they go through `env`.

## Configuration

| Variable | What it is | Where the value comes from |
| --- | --- | --- |
| `ZIFFER_API_KEY` | Your API key. It carries your tenant, so no request names a tenant. | We issue it. It expires after 90 days unless you ask for another lifetime. |
| `ZIFFER_TRUST_ANCHOR` | Path to the public key file your receipts are signed under. | We give you the file. Take it from us, never from the API you are checking. |
| `ZIFFER_SUITE_FLOOR` | The weakest signature suite you will accept. | You choose it. There is no default. |
| `ZIFFER_API_URL` | The base URL of the ZIFFER deployment you call. | We give it to you with your key. |
| `ZIFFER_ATTESTER_REGISTRY` | Path to `attesters/registry.json`: the people allowed to approve a held action, and their keys. | Your own policy repository. Without it, a receipt that carries approvals is refused. |

## When a request is refused

Every refusal is a thrown `Refusal` whose `name` says what is wrong with the receipt (for example
`ReceiptNotBoundToProposal`), whose `clause` is the rule it was refused under (`9.3-3`), and whose
`action` says what to do; it prints as `Name: what it means (rule)`. The table of every refusal is
at https://ziffer.io/docs/refusals. Narrow with `instanceof Refusal`, record the name and the rule,
and do not retry it.

## When a call does not get through

The client resends a request only when resending can help. That is: when the call got no answer at
all — the connection was refused, DNS failed, or the round trip took longer than 10 seconds — and
when the answer was 429, 502, 503 or 504.

Everything else reaches you as it is. A 400, 401, 403 or 404 means the request was refused on its
merits, and the same bytes will be refused the same way. A 500 is not resent either, and that one
is deliberate: ZIFFER reports its own degradations as 502 and 503, so a 500 is a fault it did not
expect, and repeating it repeats the fault.

Your bytes are sent again unchanged. A resent proposal lands on the hold the first attempt already
opened, so a retry never asks a second person to approve the same action.

There are at most five attempts. The wait between them doubles and is randomised, up to four
seconds before the last one — randomised so that a fleet of your processes that all saw the same
outage does not come back at the same instant. When an answer asks for a specific wait, in whole
seconds, the client waits exactly that long and adds nothing of its own. Retrying is also a
budget: ten retries the client decides for itself, one earned back per call that succeeds. A
client whose calls are all failing stops resending instead of adding to the load.

**The 10-second timeout is per attempt, not per call.** A call that retries can take longer than
10 seconds and is not wrong for doing so. Waiting for a person to approve is not an attempt at
all: that is `client.wait`, which polls, and each poll is its own attempt with its own timeout.

### Putting a bound on the whole call

```ts
await client.propose(proposal, { deadlineMs: 5_000 });
```

With a deadline the client never starts a wait that would end after it. It throws
`DeadlineExceeded` instead, and that error tells you what was actually failing — `lastError` and
`status` — so you can tell "the gateway was down" from "my bound was too short". Without a
deadline there is no such check, and a server that asks for a long wait gets it.

### What the client has been doing

```ts
const { retries_directed, retries_computed, retry_bucket_level } = client.retryCounters;
```

How many resends the server asked for, how many the client decided on itself, and how much of the
retry budget is left (10 when full). The two counts run for the life of the client; read them
before and after a call for that call's own numbers. They are worth a gauge in your own metrics:
a `retries_computed` that climbs while `retry_bucket_level` sits at zero is the shape of an
outage you are riding out rather than one you are told about.

## Documentation

- Quickstart: https://ziffer.io/docs/quickstart
- Integrating the SDK: https://ziffer.io/docs/developers/sdk
- Sandbox tenants: https://ziffer.io/docs/developers/sandbox
- Every refusal: https://ziffer.io/docs/refusals
- Policy by example: https://ziffer.io/docs/policy/by-example
- Glossary: https://ziffer.io/docs/glossary

## Support

Write to hello@ziffer.io. Your API key, your trust anchor file and your suite floor come from us.
So does an answer about a refusal you cannot explain.

## License

Apache License 2.0: see `LICENSE` beside this file, and `NOTICE`. Copyright 2026 code75 SASU.
ZIFFER is a registered trademark of code75 SASU, and the licence does not grant it. The
open-source components this package redistributes are listed in `THIRD-PARTY-NOTICES`, under
their own licences.
