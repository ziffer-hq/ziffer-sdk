---
name: pipeline
description: Set up the ZIFFER policy pipeline in the developer's policy repository, the workflows that check every pull request without a key and sign and publish on merge, and list every variable and secret to set with where each value comes from. Use when the developer asks to set up CI or CD for their ZIFFER policy, to publish their agent authorization policy from GitHub, which variables or secrets ZIFFER needs, or why a publish run failed.
---

# Set up the pipeline

This skill puts the template's workflows in the policy repository unchanged, tells the developer what to set and where each value comes from, and explains a failed run. It sets no value, holds no key and publishes nothing. It needs no ZIFFER account.

**ZIFFER tools used:** `get_policy_repo_guide`, `check_policy_repo`, `explain_publish_failure`, `search_docs`.

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

1. **Have the policy repository.** Ask where it is if this conversation does not say. If it has no `policy/` folder yet, offer `/ziffer:policy` first and stop.

2. **Put the workflows in, unchanged.** The repository needs these three files, copied byte for byte from the policy repository template in the developer's ZIFFER onboarding pack (ask where it is on this machine if you do not know):
   - `.github/workflows/policy-validate.yml` (from the template)
   - `.github/workflows/publish-policy.yml` (from the template)
   - `.github/workflows/policy-scan.yml` (from the template)

   Never edit them, and never write one from memory or from a document. Each file's header names the values in it the developer may change. In all three it is the policy folder, `POLICY_DIR`, which `policy-validate.yml` and `publish-policy.yml` also spell in their `paths:` filter, so it is one value in up to two places per file, the same folder in all three files. `policy-validate.yml` has a second one, `NO_EXAMPLE_PROPOSALS`, set to `'true'` only when the repository has no example proposals. Leave even those to the developer. Call `check_policy_repo` with the repository's root: it says whether each workflow is identical to the one ZIFFER shipped apart from those values, and which values it found.

3. **List what to set, from the files themselves.** Run this in the repository's root to find every variable and secret the workflows read (comment lines are left out, because the headers quote names as examples):

   ```bash
   grep -hv '^[[:space:]]*#' .github/workflows/*.yml | grep -oE '(vars|secrets)\.[A-Z0-9_]+' | sort -u
   ```

   Then, for each name, read where its value comes from: first in the header comments of the workflow that reads it, then with `search_docs` using the name itself as the query (it returns the sections of `policy-ci.md`, `install.md` and the rest that mention it; `install.md` section 7 is the table of where every value comes from). Show one table: the name, whether it is a variable or a secret, where the value comes from (the hand-over sheet ZIFFER gives, the checksum file of the release, or something the developer makes themselves, such as their own key), and the guide section you read it in. Say where to set each one only as the files and guides say it; do not add advice of your own about where a secret should live. Do not restate a value or a source from memory; if the files and guides do not say, write "ask ZIFFER" in that row. `ZIFFER_SECRETS_TOKEN`, `POLICY_SIGNING_KEY` and any other secret are set by the developer in the repository's settings; never ask for their values and never write one anywhere.

4. **The signing key is the developer's alone.** If `policy-signing.pub.json` is not in the repository yet, give the command below for the person to run on their own machine, and stop. They put the private key's text into the `POLICY_SIGNING_KEY` secret themselves. Never run it, never read the file it writes, and never offer to "just generate it".

   ```bash
   bin/new-signing-key.sh
   ```

5. **The two locks, set by a person.** Call `get_policy_repo_guide` and show the developer two things from it, as written: the `ziffer-production` environment the publish job needs, and the section "Lock the branch" (branch protection on `main`). Say that no tool here can see either setting; the developer sets and confirms them.

6. **How the first publish works.** Say this plainly: the first signed policy for a new customer is handed to ZIFFER as part of enrolment; from then on, every merge to `main` is signed and published by the customer's own pipeline, with the customer's own key. A pull request runs the keyless checks (`policy-validate.yml`, `policy-scan.yml`); a merge runs `publish-policy.yml`, which signs and publishes and prints `active` when the new rules are in force (`start-here.md` section 4, `policy-ci.md` section 5). Nothing here merges; a person does.

7. **When a run fails.** Ask the developer to paste the failed run's log, and call `explain_publish_failure` with it. Show the step, the named refusal and what to do, as the tool gives them. A refusal is deterministic: fix what it names rather than re-running.

8. **Next.** Offer `/ziffer:verify` once the developer has a sandbox key, to see a decision end to end: steps 6 to 8 of the `setup_ziffer` flow. Without a key yet, `whoami` answers with how to get one; everything before the first proposal needs none.
