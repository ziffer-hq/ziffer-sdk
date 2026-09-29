# @ziffer-io/mcp

A local MCP server that gives your AI assistant ZIFFER's tools: it scans your code, helps you
integrate the ZIFFER SDK, checks your policy, and tries a decision against your sandbox.

## Install

You need Node.js 22 or later. The server runs over stdio from `npx`.

```bash
npx @ziffer-io/mcp
```

## Start with a guided flow

Once the server is added to your AI assistant (below), pick **Set up ZIFFER in this project** from
its prompt menu (in Claude Code, the `/` menu). It is the `setup_ziffer` flow, and it takes you
from nothing to a first decision whose receipt is verified on your machine, in eight steps: scan
the code, explain the held tools, make the one change in the code and check it, build the policy
repository, set up its pipeline, get your key, send a first proposal, and verify its receipt. After
each step it says which tool comes next and what you should see.

| Flow | What it takes you through |
| --- | --- |
| Set up ZIFFER in this project (`setup_ziffer`) | The whole path above, in order. |
| Scan this project and explain what it found (`scan_and_explain`) | The scan, the numbers, each held tool and the one place to put ZIFFER. |
| Why was this refused (`why_refused`) | A refusal name, a rule, a decision id or a receipt in; what it means, who fixes it and what to do out. |

Every tool's answer also ends with a line starting `Next:` naming the tool to call next and why.
The flows guide your AI assistant; what is decided and what is verified stays in the tools and in
the `verify` line in your code.

**Your key.** Everything before the first proposal needs no key. When a tool needs one and it is
not set, the tool says how to get it: write to hello@ziffer.io with your name, your company and the
language your application is written in, and ZIFFER answers with your API key, your trust anchor
file and your suite floor. The server calls the hosted service at `https://api.ziffer.io` unless
you set `ZIFFER_API_URL`.

## Scan your codebase from your AI assistant

With the server added to your AI assistant (below), ask it:

> Scan this repository with ZIFFER and tell me what to fix.

Your AI assistant calls `scan` on the project it is working in. The scan reads your source, finds
every tool your code gives a model, and has the ZIFFER engine grade each one under a draft policy
it writes for you: which would be held for a person, which would run after a notice, which cannot
be undone. Reading your code starts no tool server and sends nothing anywhere; the draft policy, the
HTML report and `ziffer-tools.json` go into a fresh temporary directory, never into your
repository unless you name a folder.

Your AI assistant then tells you the finding and the one fix. The finding: the model holds the
authority to run these tools directly. The fix: take that authority off the model path and route
every call through ZIFFER. That means one line at the top of your dispatcher (the scan names the
file and line), the module the scan generated saved beside it, `ziffer-tools.json` deployed with
your application, and the draft policy reviewed, signed and published
([quickstart](https://ziffer.io/docs/quickstart), [SDK](https://ziffer.io/docs/developers/sdk)).
It can make that change for you, with your approval. A prompt filter, an output classifier, asking
the model to be careful, or a `requires_confirmation` flag in your own code is not that fix: each
leaves the model holding the authority. Ask it "why is `<tool>` held?" and it calls
`explain_scan_finding`, which names the policy entry the engine's verdict came from. The verdicts
are the engine's, never your AI assistant's own judgement.

`npx @ziffer-io/scan --code` is the same scan from a terminal.

## Add it to your AI assistant

Claude Code:

```bash
claude mcp add ziffer -- npx -y @ziffer-io/mcp
```

Cursor, or any AI assistant that starts an MCP server over stdio:

```json
{
  "mcpServers": {
    "ziffer": { "command": "npx", "args": ["-y", "@ziffer-io/mcp"] }
  }
}
```

## What it can and cannot do

It has twenty-one tools.

| Tool | What it does |
| --- | --- |
| `get_started` | The steps from nothing, in order: the scan, where an account comes from, the install command per language, the values to set, and which tool to call next. |
| `scan` | Step zero: every tool your application's code gives a model, the engine's verdict for each under a draft policy, and the one place to put ZIFFER; plus which tools your AI agents can reach. Reading your code starts no tool server; the installed servers are listed first and started only when called again with `confirm: true`. Nothing leaves your machine. |
| `explain_scan_finding` | One tool from the last scan: why the engine decided what it did, the draft policy entry it came from, and the fix. |
| `get_integration_guide` | The SDK integration guide, for one language. |
| `check_integration` | Reads a repository and reports, per propose call site, whether a verify sits in the same handler. |
| `lint_proposal` | Validates one proposal against the wire schema locally and names the bad field before any call. |
| `propose` | Submits one Proposal and returns the answer verbatim. |
| `check_decision` | One decision by id, with its receipt when there is one, not verified. |
| `get_decision` | One decision by id whose receipt is VERIFIED before it is returned, or a named refusal. |
| `list_decisions` | Every decision and held request for your key, newest first. |
| `explain_receipt` | Verifies a receipt and reports `valid` or the clause that refused it. |
| `sandbox_status` | Whether a tenant is a sandbox and what that means; with a `decision_id`, whether that decision is decided or still waiting. |
| `whoami` | Which tenant your API key is bound to, and until when the key is accepted. |
| `get_policy_repo_guide` | The policy repository template README and the first-hour guide, verbatim. |
| `check_policy_repo` | Reads a clone of your policy repository and reports what is left to do in it, one line and one fix per check. |
| `explain_policy` | Reads a policy tree and says, per action, whether it runs alone, runs with somebody told, is held, or is refused. |
| `simulate_decision` | Grades one Proposal against a draft policy tree, on your machine: the verdict and the clause. |
| `explain_publish_failure` | Reads a failed publish run's log and names the step, the refusal and the fix. |
| `search_docs` | Searches the ZIFFER guides and returns the sections that use your words, whole. |
| `explain_refusal` | One refusal name in; what it means, who fixes it and what to do out. |
| `send_feedback` | Sends us a question our documentation did not answer. **This sends text off your machine.** |

**Seven tools send to ZIFFER**, at `ZIFFER_API_URL`: `whoami`, `propose`, `check_decision`,
`get_decision`, `list_decisions`, `send_feedback`, and `sandbox_status` when you pass a
`decision_id`. Every other tool works on your machine alone.

**`send_feedback` sends text your AI assistant wrote.** What goes into its `question` and
`context` is stored under the tenant your API key carries and read by a person at ZIFFER, as
written. It is not filtered, summarised or redacted on the way, so it must never carry a key, a
token, a customer's name or anything from a private file. Nothing answers back through the tool.

**It approves nothing.** There is no approve tool and no simulated approval: a receipt minted on a
developer's laptop is the one artifact this product exists to make impossible. `simulate_decision`
is not one: it runs the grader, which answers what your rules say and signs nothing. A `PASSED`
from it is a grade, never permission to act.

**It reads, and it runs one binary.** `check_integration` opens the source files under a path you
name and reads them as text; it runs nothing. `check_policy_repo` runs `ziffer list` and `ziffer
decide --unsigned`, the two commands your policy repository's own pull request check runs;
`explain_policy` and `simulate_decision` run `ziffer decide --unsigned`. They run it directly, with
an argument vector and never through a shell, so that every verdict comes from the same program
your pipeline uses. If `ziffer` is not on your PATH, those tools report NOT CHECKED and name it;
they never report PASS for something they could not look at.

**It writes nothing in your work, with one exception you ask for.** Nothing in this package edits
or deletes a file in your repository, in your policy tree or anywhere else you keep work.
`simulate_decision` has to hand the CLI a *file*, because that is what `--proposal` takes, so it
writes one into a fresh temporary directory and removes it again. `scan` writes the draft policy
folder, and beside it the report, `ziffer-scan.json` and the review archive, into a fresh
temporary directory, or where its `out` argument says once you have agreed to start the installed
servers, and for your codebase `ziffer-tools.json` beside them.

**`scan` starts programs, and only after a second call.** It runs `@ziffer-io/scan` inside this
server: it starts the MCP servers your AI tools are configured to start and asks each for its list
of tools, which is all it asks them. The first call starts nothing and returns the list of what it
would start, credentials redacted; only a call with `confirm: true` starts them. The confirmed
call is one scan, as `npx @ziffer-io/scan` is: one draft policy naming your codebase's tools and
the installed servers' tools together. No model is asked anything and nothing leaves your machine.

Your AI assistant edits your code. The `verify` line in your handler is what gates the action.

## Configuration

<!-- guide:configuration -->
| Variable | What it is | Where the value comes from |
| --- | --- | --- |
| `ZIFFER_API_KEY` | Your API key. It carries your tenant, so no request names a tenant. | We issue it. It expires after 90 days unless you ask for another lifetime. |
| `ZIFFER_TRUST_ANCHOR` | Path to the public key file your receipts are signed under. | We give you the file. Take it from us, never from the API you are checking. |
| `ZIFFER_SUITE_FLOOR` | The weakest signature suite you will accept. | You choose it. There is no default. |
| `ZIFFER_API_URL` | The address of the ZIFFER service you call. | Unset, it is `https://api.ziffer.io`, the hosted service. Set it only to an address we give you. |

<!-- guide:/configuration -->
Set them in your MCP client's own configuration, never in a file inside your repository. The
server starts without any of them, and a tool that needs a value names the variable to set and
how to get it. When the service does not answer, the tool names the address it called and what
to check.

- **None of the four:** `get_started`, `scan`, `explain_scan_finding`, `get_integration_guide`,
  `check_integration`, `lint_proposal`, `get_policy_repo_guide`, `explain_publish_failure`,
  `search_docs` and `explain_refusal`. Your AI assistant can read how to integrate, check the
  integration it just wrote, validate a proposal, set up your policy repository, debug its
  pipeline and look a refusal up before you have a key.
- **The `ziffer` command line tool on your PATH:** `check_policy_repo`, `explain_policy` and
  `simulate_decision`, which grade on your machine and need no key either.
- **`ZIFFER_API_KEY` (and `ZIFFER_API_URL` when it is not the hosted service):** `whoami`, `propose`, `check_decision`,
  `list_decisions` and `send_feedback`, and `sandbox_status` when you pass a `decision_id`.
- **The trust anchor and the suite floor:** `explain_receipt`, and `get_decision` beside the URL
  and the key.

## Good to know

- `check_policy_repo` checks that the three files ZIFFER provisions are no longer the
  demonstration tenant's. Your first publish checks that they are the right ones for your tenant.
- It prints your repository's branch protection settings for you to confirm in GitHub: this server
  holds no credential and opens no connection.
- `explain_publish_failure` explains the workflow the template ships. Keep yours as shipped, but
  for your policy folder.
- `explain_refusal` serves the support table: the refusals your own SDK's `verify` raises, by
  name such as `ReceiptNotBoundToProposal` or by the rule it prints in brackets such as `9.3-3`;
  what your Executor alerts about; and the names the ZIFFER API and Policy Engine answer with, such
  as `TenantMismatch`, `ProposalMalformed` and a rule like `8.4-3`.
- `search_docs` matches literal terms: search with the words the guides use.
- `explain_policy` and `simulate_decision` read your policy without checking its signature. They
  answer what your rules decide. A policy can read clean there and still be refused when it is
  published, for example because its signature does not verify or it has expired.
- `explain_policy` names every target your examples use that `floors.json` does not declare.
  Declare each one: an undeclared target is graded at the highest tier.
- An action your rules name but `policy/examples/` has no proposal for is graded from a
  *synthetic* proposal, built from one of your own examples with the action swapped, and the row
  says `synthetic` and names the file it came from. Add an example proposal for that action to
  grade it as you would really send it.

## When a request is refused

Every refusal names the rule that fired; the table of every refusal, what it means and what to do
is at https://ziffer.io/docs/refusals. A refusal is deterministic, so do not retry it.

## Documentation

- Quickstart: https://ziffer.io/docs/quickstart
- Integrating the SDK: https://ziffer.io/docs/developers/sdk
- Sandbox tenants: https://ziffer.io/docs/developers/sandbox
- Every refusal: https://ziffer.io/docs/refusals
- Glossary: https://ziffer.io/docs/glossary

## Support

Write to hello@ziffer.io. Your API key, your trust anchor file and your suite floor come from us.
So does an answer about a refusal you cannot explain.

If your AI assistant could not find something, `send_feedback` puts the question in front of the
same people: it reaches us, and it is how the documentation gets the answer you needed.

## License

Apache License 2.0: see `LICENSE` beside this file, and `NOTICE`. Copyright 2026 code75 SASU.
ZIFFER is a registered trademark of code75 SASU, and the licence does not grant it. The
open-source components this package redistributes are listed in `THIRD-PARTY-NOTICES`, under
their own licences.
