---
name: scan
description: Scan this project with ZIFFER, the agent authorization service, and explain what it found. Use when the developer asks to scan their code for the tools it gives an AI model, asks which of their AI agent's tools are risky or cannot be undone, asks where ZIFFER should go in their code, or asks why ZIFFER would hold a tool. Reads the code only, starts nothing, sends nothing.
---

# Scan and explain

This skill runs the ZIFFER scan on the project and explains the result. It writes nothing in the project. It needs no ZIFFER account and no key.

**ZIFFER tools used:** `scan`, `explain_scan_finding`.

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

## Steps

1. **Scan the code.** Take the absolute path of the project you are working in. Call `scan` with `cwd` set to that path and nothing else: leave `confirm` out. Reading the code starts nothing. The same call also returns the list of programs a second call would start for the installed AI tools; it does not start them.

2. **Show the result, in this order.**
   - The numbers from the first line of the result: tools the model can call, held for a person, run after a notice, refused, allowed, and how many cannot be undone.
   - Each tool the engine treats as impossible to undo that is held or notified: its name, its `file:line`, and its `draft_reason`, as the result gives them.
   - The one place to put ZIFFER: the dispatcher's name and `file:line`, and the call line from `insertion.call`. If `dispatcher` is null, say what `insertion.sentence` says, word for word.
   - Anything under "WHAT ONE CALL DOES NOT SEE" or "TEXT THAT SPEAKS TO THE MODEL", passed on as written.
   - Where the scan wrote its files (`draft_policy`, the report, `insertion.tools_file`). Say that they sit in a temporary folder, outside the project, and that the draft policy is signed by a key made for this run and thrown away: it is a draft to review, never a policy to deploy.

   Every verdict is the ZIFFER engine's, under a draft policy. Never call a tool safe or dangerous on your own reading, and never re-grade one.

3. **The installed AI tools, only if the developer wants them.** If the result lists programs it would start, show that list exactly as returned (it is already stripped of credentials) and ask whether to start them to read their tool lists. **Stop here and wait for the answer.** Only on a clear yes, call `scan` again with the same `cwd` and `confirm: true`. On anything else, do not.

4. **Explain a tool on request.** When the developer asks about one tool ("why is this one held?"), call `explain_scan_finding` with the tool's name exactly as the scan listed it. Show the verdict, the draft policy file and entry it came from, and how to change it: the change belongs in the draft policy, not in the code. `explain_scan_finding` only knows the last scan of this session; if it says there is none, go back to step 1.

5. **What is not the fix.** If the developer proposes a prompt filter, an output classifier, asking the model to be careful, a model-side guardrail, or a confirmation flag inside the application's own tool definitions, say it is not the fix and give the reason from the result's `not_a_fix`. The fix is the one in `remediation`: take the authority off the model path and route every call through ZIFFER.

6. **Next.** Offer, in this order: putting ZIFFER in the code (`/ziffer:integrate`), then building the policy from this scan (`/ziffer:policy`). Keep the scan's result in the conversation: both need the paths it returned.

## The same scan from a terminal

The developer can run the same code scan themselves. It writes into `./ziffer-scan/` under the folder it runs in.

```bash
npx @ziffer-io/scan@0.3.0 --code
```
