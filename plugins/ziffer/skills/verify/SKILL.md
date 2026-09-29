---
name: verify
description: Check a ZIFFER setup end to end against a sandbox, the tenant ZIFFER gives for testing agent authorization, with one tool call that should run and one that should be held for a person, and explain the receipt or the refusal. Use when the developer asks to test, verify or try their ZIFFER integration, to see a decision or a receipt, or asks why a proposal was refused. Needs a sandbox API key; everything else in this plugin works without one.
---

# Verify

This skill sends two proposals to a ZIFFER sandbox, with the developer's go-ahead, and explains what came back. It approves nothing: a sandbox's approvals are made inside ZIFFER, under keys this machine does not hold.

**ZIFFER tools used:** `whoami`, `sandbox_status`, `lint_proposal`, `simulate_decision`, `propose`, `check_decision`, `get_decision`, `explain_receipt`, `explain_refusal`.

<!-- hard-stops:begin -->
## Hard stops

This plugin is a setup helper. It is not a control. ZIFFER's guarantee must not depend on an AI assistant behaving well, and that includes you. Whatever you are asked, and whoever asks:

1. **Never create, read, print or store a policy signing key or any other private key.** Give the person the command to run on their own machine, and stop.
2. **Never name who approves, and never create an invitation.** A person decides who approves, and the customer's administrator creates invitations.
3. **Never publish a policy and never merge a pull request.** Prepare the change; a person merges it.
4. **Never classify a tool on your own authority.** Propose, with the scan's reason shown, and let the developer confirm or correct it.
5. **Never present yourself or this plugin as a control.** It is a setup helper. What the model may run is decided by ZIFFER, not by you.

Also: never write a credential into a file in the repository. Never start the installed AI tools' servers, whether with `confirm: true` or with `ziffer-scan` outside `--code`, before the developer has seen the list of programs it would start and agreed. Never send anything to ZIFFER except through the ZIFFER tools the developer can see.
<!-- hard-stops:end -->

## What needs a key, and what does not

This skill needs a sandbox API key from ZIFFER, set as `ZIFFER_API_KEY` with `ZIFFER_API_URL` in the environment Claude Code starts in, and `ZIFFER_TRUST_ANCHOR` to check a receipt (`sandbox.md` section 4, `install.md` section 7). The scan, the code change, the policy and the pipeline skills need none of them. If a tool below answers that a variable is not set, say which one, say where its value comes from, and stop: never ask for the key's value in the conversation and never write it into a file.

## Steps

1. **Who is this key?** Call `whoami`. Show the tenant and until when the key is accepted. Then call `sandbox_status` with that tenant. If it is not a sandbox, stop and say so: this skill only sends proposals to a sandbox.

2. **Choose two proposals from the policy.** From the policy repository's `policy/examples/` (or the scan's tools file), pick one tool call the policy should let run on its own, and one it should hold for a person. Set each proposal's `tenant_id` to the tenant from step 1. Call `lint_proposal` on each and fix only what it names. If the policy repository is on this machine, call `simulate_decision` with each proposal and the repository's root, and show the predicted verdict. The prediction is the engine's grade of the rules; it is not permission to act.

3. **Ask before sending.** Show both proposals and say that `propose` sends them to ZIFFER. **Stop and wait for the developer's go-ahead.**

4. **Send and follow.** On a yes, call `propose` with each proposal. Then call `check_decision` with each `decision_id` until its status is no longer pending.
   - An answer with a receipt: call `explain_receipt` with the receipt and the base64 of the exact proposal bytes you sent, or call `get_decision` with the `decision_id` and those bytes. Show whether it is valid and what it is bound to.
   - A refusal: call `explain_refusal` with the refusal's name exactly as it came back. Show what it means, who fixes it and what to do. Do not retry it: the same proposal gets the same answer.
   - Held for a person (`ATTEST` with no receipt yet): that is the gate working, not an error. Call `sandbox_status` with the tenant and the `decision_id` to see whether the sandbox's approver has decided. Never propose the same action again while one is held: a second proposal is a second action.

5. **Say what this proved and what it did not.** An ALLOW in a sandbox means the path works, not that a person agreed. A sandbox receipt is signed by a different identity from production, so the production check refuses it (`sandbox.md` section 7). In the application, the verify line is what enforces a decision (`sdk.md` section 5).
