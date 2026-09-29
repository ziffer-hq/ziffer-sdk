---
name: start
description: Set up ZIFFER, the agent authorization service, in this project, step by step, picking up where the project already is. Use when the developer asks to set up, add, install or get started with ZIFFER, asks what this plugin does, or asks what to do next with ZIFFER.
---

# Set up ZIFFER

ZIFFER is the agent authorization service: the application asks ZIFFER before an AI agent's tool call runs, risky calls are held for a named person, and every decision leaves a signed receipt. This plugin helps a developer set that up, in five steps. It is a setup helper; ZIFFER itself decides what runs.

**ZIFFER tools used:** `get_started`.

**ZIFFER prompts used:** `setup_ziffer`.

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

## The five steps

| | Step | Skill | Needs a ZIFFER account |
|---|---|---|---|
| 1 | Scan the code and explain what it found | `/ziffer:scan` | no |
| 2 | Put ZIFFER in the code, at the one place the scan found | `/ziffer:integrate` | no |
| 3 | Build the policy from the scan | `/ziffer:policy` | no |
| 4 | Set up the policy pipeline | `/ziffer:pipeline` | no |
| 5 | Check it end to end against a sandbox | `/ziffer:verify` | a sandbox key |

## Steps

1. **Say what this does**, in two sentences, from the paragraph at the top of this skill. Then say the five steps above, and that nothing is written, sent or started without the developer seeing it first.

2. **Find where the project already is.** Look, without changing anything:
   - Does the application's code already call ZIFFER? Search the project for `zifferGate`, `@ziffer-io/client` or `ziffer` imports.
   - Is there a policy repository? Ask the developer, or look for a folder with `policy/risk_functions.json` and `.github/workflows/publish-policy.yml` that they point you to.
   - Are its workflows in place? (`.github/workflows/policy-validate.yml` and `publish-policy.yml` in it.)
   - Is a sandbox key set? Only check whether `ZIFFER_API_KEY` is set in the environment (for example `test -n "$ZIFFER_API_KEY" && echo set`); never print it.

3. **Offer the first step still to do**, and the rest in order after it. A project that already calls ZIFFER starts at step 3; one with a policy repository and its workflows starts at step 5. Wait for the developer to choose; then follow that skill.

4. **When the developer asks for the whole path in one go**, follow the `setup_ziffer` flow: the ZIFFER tools carry it as "Set up ZIFFER in this project" in the `/` menu, eight steps from the scan to a first proposal whose receipt is verified on this machine, and it names after each step the tool that comes next. Still stop at every stop each skill names. Call `get_started` if they want the steps as ZIFFER's own guide gives them.

5. **Next.** Every ZIFFER tool's answer ends with a line starting `Next:`. Follow it, and say it to the developer, so they always know what comes after the step they are on.
