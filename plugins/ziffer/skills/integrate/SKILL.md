---
name: integrate
description: Put ZIFFER, the agent authorization service, into the application's code at the one place the scan found, so every tool call the AI model asks for is decided by ZIFFER before it runs. Use when the developer asks to add ZIFFER to their code, to wire the scan's fix in, to route their AI agent's tool calls through ZIFFER, or to check an existing ZIFFER integration. Shows the exact change and waits for approval before writing.
---

# Put ZIFFER in the code

This skill makes the one code change the scan named, with the developer's approval, and then checks it. It needs no ZIFFER account to make the change; the application needs one to run it.

**ZIFFER tools used:** `scan`, `get_started`, `get_integration_guide`, `check_integration`.

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

1. **Have the scan's result.** If this conversation has no result from `scan` for this project, call `scan` with `cwd` set to the project's absolute path and `confirm` left out, as `/ziffer:scan` does. You need these fields from its codebase result: `dispatcher`, `insertion` (`sentence`, `call`, `snippet`, `snippet_language`, `tools_file`), `remediation.steps`, and `bypass_paths` if present.

2. **Find the place, from the result only.**
   - If `dispatcher` is not null: the change goes at the top of that function, at the `file:line` the result gives.
   - If `dispatcher` is null: say so, quoting `insertion.sentence`. The change is then one line at the top of each tool's execute, as `remediation.steps` lists them. Never invent a dispatcher, never create one, and never move the application's tools into a new function to make one.
   - Each entry in `bypass_paths` is a place the dispatcher does not see. Its `fix` says what goes there; include it.
   - `insertion.snippet_language` is the language of the module the scan wrote. If the project is written in another language, stop, say so, and read the guide for the project's language with `get_integration_guide`; propose the change that guide shows instead, still through step 3.

3. **Prepare the whole change and show it as a diff. Write nothing yet.** The change is exactly what the scan returned, and nothing else:
   - the import line and the call line, from the comment at the head of `insertion.snippet`, at the top of the dispatcher (or of each tool's execute);
   - the snippet saved, unchanged, as the file its own first lines name, beside the dispatcher's file;
   - the tools file (`insertion.tools_file`, written by the scan in its temporary folder) copied into the project at `ziffer-scan/ziffer-tools.json`, the path the snippet reads by default (or leave it where the developer prefers and say that `ZIFFER_TOOLS_FILE` must then name it);
   - the client package the snippet imports, added with the install command `get_started` returns for this language. Call `get_started` to read that command; never type a version from memory, and never swap in another version. If that version cannot be installed, say so and stop: it is ZIFFER's to fix, not yours.

   Point out the one choice that is the developer's: which field of the dispatcher's context names the signed-in person (the snippet's operator function says where). Leave it as the snippet has it until they answer.

   Then list the environment variables the snippet reads (its header comment names them) and say where each value comes from, as `get_started` gives it. Never write a value for any of them into a file.

   **Stop here. Show the diff and wait for the developer to approve it.** A request to change it is not approval: show the changed diff and wait again.

4. **Write exactly the approved change.** Nothing more: no prompt change, no output filter, no "be careful" instruction, no confirmation flag in the application's own tool definitions. Those leave the model holding the authority and are not the fix; the scan's `not_a_fix` says why.

5. **Check it.** Call `check_integration` with the project's absolute path. Show each call site and its result as the tool reports it. A FAIL or NOT CHECKED is a finding, never a PASS. The saved snippet verifies every receipt itself, against the trust anchor, the suite floor and the approver registry its header names, so its own call site reports PASS. If the saved snippet reports FAIL, it is not the file the scan wrote (it was edited, or it came from an older scan): say so, and propose saving the snippet again unchanged from the scan result, through the same stop as step 3. If a propose call elsewhere in the project reports no verify beside it, show that, read the verify step for this language with `get_integration_guide`, and propose the lines that guide shows as a second diff, through the same stop as step 3. Propose only what the guide shows: if a line in it calls something the installed package does not provide, say which, and stop. Never write your own replacement for receipt checking, for loading the trust anchor or for loading the approver registry; the packages provide all three, and a home-made check is exactly what the verify line exists to rule out.

6. **Next.** The code now asks ZIFFER; the policy decides the answer. Offer `/ziffer:policy` to build the policy from the same scan: it is step 4 of the `setup_ziffer` flow. The `Next:` line at the end of the check's answer says the same.
