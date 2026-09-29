---
name: policy
description: Build the ZIFFER policy repository from the scan's draft policy, walking the developer through every tool that cannot be undone or that the scan could not classify, and validate it without a key. Use when the developer asks to write, set up, review or check their ZIFFER policy, their agent authorization rules, or their policy repository, or asks what their rules would decide for a tool call.
---

# Build the policy from the scan

This skill turns the scan's draft into the developer's policy repository, one confirmed decision at a time, and checks it with the tools that exist. It signs nothing and publishes nothing. It needs no ZIFFER account.

**ZIFFER tools used:** `scan`, `get_policy_repo_guide`, `check_policy_repo`, `explain_policy`, `simulate_decision`, `lint_proposal`, `explain_scan_finding`.

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

1. **Find the draft.** Use `draft_policy` and `insertion.tools_file` from this conversation's scan result. If there is none, call `scan` with `cwd` set to the project's absolute path and `confirm` left out.

2. **Find or make the policy repository.** Ask the developer two things, and **stop until both are answered**:
   - where the policy repository is, or where to create it (a separate repository from the application, private to their organisation);
   - where the policy repository template from their ZIFFER onboarding pack is on this machine.

   If a policy repository already exists there, skip to step 4 with it. Otherwise, call `get_policy_repo_guide` and follow its step 1 ("Take a copy"): copy the template's whole tree into the new folder as it is, including these files:
   - `README.md` (from the template)
   - `.gitignore` (from the template)
   - `bin/new-signing-key.sh` (from the template)
   - `policy/manifest.json` (from the template)
   - `.github/workflows/policy-validate.yml` (from the template)
   - `.github/workflows/publish-policy.yml` (from the template)
   - `.github/workflows/policy-scan.yml` (from the template)

   Copy them from the template the developer has, never from memory, and never edit the workflow files. You may run `git init` in the new folder. Never create a remote repository.

3. **Bring the scan's rules in.** From the draft folder, copy into the repository's `policy/` folder: `floors.json`, `risk_functions.json`, `reversibility.json`, `adapters.json`, `notice_targets.json`, `alert_targets.json` and `tool-names.json`. Do not copy the draft's `SIGNATURE`, `manifest.json`, `receipt_identity.json`, `door_identities.json` or `attesters/registry.json`: the draft's are made for one scan, and the repository's come from the template now and from ZIFFER's hand-over later. Remove the template's example proposals from `policy/examples/`; step 6 writes new ones.

4. **Walk the decisions that matter, with the developer.** For every tool the scan marks as not undoable (`reversibility` of `IRREVERSIBLE`), and every tool the scan could not classify from its name or description, show:
   - the tool's name and `file:line`;
   - the scan's `draft_reason` and the engine's verdict, as the scan gave them (call `explain_scan_finding` with the tool's name for the draft entry it came from);
   - what the draft now says in `reversibility.json`, `floors.json` and `risk_functions.json` for it.

   Ask the developer to confirm each one or say what it should be. **Stop here and end your turn.** Do not go on to step 5, write examples or run any check until the developer has answered for every tool you listed; the answers can change what the later steps produce. Change a rule file only to what the developer said, and show the change. Never decide a classification yourself, and never soften one because it looks strict: a tool left out of `reversibility.json` is treated as impossible to undo, and a resource left out of `floors.json` as the most sensitive there is. Both are deliberate (`policy-by-example.md` section 3).

5. **List what only a person can fill, and leave each as a placeholder.** Show this list, each with the guide section that explains it, and change none of them:
   - who approves: `policy/attesters/registry.json` stays as the template has it until the customer's administrator enrols each person and hands over their entry (`approvers.md` section 3, `policy-by-example.md` section 14);
   - who is told when a tool that cannot be undone runs, and who is paged on a refusal: the addresses in `notice_targets.json` and `alert_targets.json` (`policy-by-example.md` sections 8 and 9);
   - the three files ZIFFER hands over at onboarding: `receipt_identity.json`, `door_identities.json` and `attesters/registry.json` (`policy-by-example.md` sections 12, 13 and 14; `start-here.md` section 2);
   - the tenant and the two people in `policy/manifest.json` who write and review the policy; they must be two different people (`policy-by-example.md` section 4);
   - the policy signing key. Give the person this command to run on their own machine, from the repository's root, and stop. Never run it yourself, and never read what it writes.

   ```bash
   bin/new-signing-key.sh
   ```

6. **Write one example proposal per tool.** For each tool in the tools file, write `policy/examples/<tool>.json` as a wire proposal, built the way the scan's snippet builds one: `schema_id` is the tool's `resource`; `schema_version` is the tools file's `schema_version`; `schema_hash` is the tool's `schema_hash`; `fidelity` is the one `adapters.json` names for that resource; `tenant_id` is the one in `policy/manifest.json`; the payload's `task_type` is the tool's `task_type`, `targets` is a list holding its `resource`, `operator` is a placeholder the developer can read, and `params` and `cidrs` are empty objects unless the developer gives real ones. Call `lint_proposal` on each, and fix only what it names.

7. **Check it, with the tools that exist.**
   - Call `check_policy_repo` with the repository's root. Show every line; NOT CHECKED is never a PASS.
   - Call `explain_policy` with the repository's root. Show, per action, whether it runs alone, runs with somebody told, is held, or is refused.
   - Call `simulate_decision` with each example and the repository's root, and show the verdict.
   - If the `ziffer` command line tool is installed (`command -v ziffer`), you may run the two commands the pull request workflow runs. They need no key and change nothing:

   ```bash
   ziffer list policy
   ziffer decide policy --unsigned --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --proposal policy/examples/<tool>.json
   ```

   If it is not installed, say so and point at `install.md` section 1. Every verdict you show is the tool's; never add one of your own.

8. **Hand it back.** Show the list of files changed and prepare a commit if the developer asks. Never push, never open a pull request on their behalf unless they ask, and never merge one. Offer `/ziffer:pipeline` next.
