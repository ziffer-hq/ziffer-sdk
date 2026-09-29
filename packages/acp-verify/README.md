# @ziffer-io/verify

Verify a ZIFFER decision receipt in your own process, against a key you configured yourself.

## Install

```bash
npm install @ziffer-io/verify
```

Node 22 or later. If you also call the ZIFFER API, install `@ziffer-io/client` instead. It
depends on this package and re-exports `verifyReceipt` and the two file readers below, so one
verifier is in your tree.

## Quickstart

```ts
import { loadTrustAnchor, verifyReceipt } from '@ziffer-io/verify';

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

const anchor = await loadTrustAnchor(env('ZIFFER_TRUST_ANCHOR'), env('ZIFFER_SUITE_FLOOR'));

const proposalBytes = new TextEncoder().encode(JSON.stringify(proposal));
const verified = verifyReceipt(receipt, proposalBytes, anchor);
// It returned, so the receipt holds. verified.proposalHash is this verifier's own hash.
await bank.transfer(amount, toAccount);   // your line, unchanged
```

It reaches no network and trusts nothing it was not handed. The keys and the suite floor are
arguments you pass in. The proposal hash is recomputed from your bytes, never read from the
receipt.
Key order and spacing do not matter, because the verifier canonicalises your bytes itself.

`verifyReceipt` checks the answer. Your own `if` is what stops the action.

`loadTrustAnchor` reads the file `ziffer pubkey` wrote and refuses a missing, malformed or
secret-key file by name (`AnchorError`). A receipt for an action someone approved carries the
approvals and verifies only against your own approver registry: `loadAttesterRegistry(path)`
reads `attesters/registry.json` from your policy repository, refusing a malformed registry, one
key holder enrolled twice, or a weak key by name, and you hand it to the anchor as `quorum`
together with the policy version the approvals were given under. The SDK guide shows the whole
of it.

## Configuration

| Variable | What it is | Where the value comes from |
| --- | --- | --- |
| `ZIFFER_TRUST_ANCHOR` | Path to the public key file your receipts are signed under. | We give you the file. Take it from us, never from the API you are checking. |
| `ZIFFER_SUITE_FLOOR` | The weakest signature suite you will accept. | You choose it. There is no default. |
| `ZIFFER_ATTESTER_REGISTRY` | Path to `attesters/registry.json`: the people allowed to approve a held action, and their keys. | Your own policy repository. Without it, a receipt that carries approvals is refused. |

## When a request is refused

Every refusal is a thrown `Refusal` whose `name` says what is wrong with the receipt (for example
`ReceiptNotBoundToProposal`), whose `clause` is the rule it was refused under (`9.3-3`), and whose
`action` says what to do; it prints as `Name: what it means (rule)`. The table of every refusal is
at https://ziffer.io/docs/refusals. Narrow with `instanceof Refusal`, record the name and the rule,
and do not retry it.

## Checking an audit chain download

The console's *Download the audit chain for this window* file checks here too:
`verifyChain(fileBytes, parseAnchorKey(anchorKeyBytes))` recomputes every record's hash, checks
each anchor's signature under the audit anchor key you hold (never the copy inside the file), and
reports which records no anchor covers yet. A break throws `ChainRefusal`, whose `refusal` and
`seq` name what broke and where. Integrating the SDK, section 6, has the whole of it.

## Documentation

- Quickstart: https://ziffer.io/docs/quickstart
- Integrating the SDK: https://ziffer.io/docs/developers/sdk
- Every refusal: https://ziffer.io/docs/refusals
- The specification: https://ziffer.io/docs/specification
- Glossary: https://ziffer.io/docs/glossary

## Support

Write to hello@ziffer.io. Your trust anchor file and your suite floor come from us. So does an
answer about a refusal you cannot explain.

## License

Apache License 2.0: see `LICENSE` beside this file, and `NOTICE`. Copyright 2026 code75 SASU.
ZIFFER is a registered trademark of code75 SASU, and the licence does not grant it. The
open-source components this package redistributes are listed in `THIRD-PARTY-NOTICES`, under
their own licences.
