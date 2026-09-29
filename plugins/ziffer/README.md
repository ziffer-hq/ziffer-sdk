# ZIFFER plugin for Claude Code

ZIFFER is the agent authorization service. Your application asks ZIFFER before an AI agent's tool call runs; a risky call is held for a named person; every decision leaves a signed receipt.

This plugin helps a developer set ZIFFER up from Claude Code. It carries the ZIFFER tools (the `@ziffer-io/mcp` server) and six skills, each a written procedure Claude follows with those tools. It is a setup helper. It is not a control, and nothing ZIFFER guarantees depends on it.

## The skills

| Skill | What it does | Needs a ZIFFER account |
|---|---|---|
| `/ziffer:start` | Says what the plugin does and offers the next step, picking up where the project already is. | no |
| `/ziffer:scan` | Scans the code for the tools it gives an AI model, and explains the result and any one tool. | no |
| `/ziffer:integrate` | Puts ZIFFER in the code at the one place the scan found, after you approve the exact change, then checks it. | no |
| `/ziffer:policy` | Builds your policy repository from the scan's draft, asking you about every tool that cannot be undone. | no |
| `/ziffer:pipeline` | Adds the policy workflows unchanged and lists every variable and secret, with where each value comes from. | no |
| `/ziffer:verify` | Sends one call that should run and one that should be held to a sandbox, and explains the answers. | a sandbox key |

Claude also picks the right one when you ask in your own words, for example "scan this project with ZIFFER".

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

The block above is written to Claude, and every skill carries it word for word. `hard-stops.md` is its one source.

## The ZIFFER tools

`.mcp.json` starts the ZIFFER tools with `npx`, by package name and exact version: `@ziffer-io/mcp@0.3.0`. The name and the version are written out in the file. No setting on your machine can change which package runs. The file holds no secret.

Before you load the plugin, run `npm view @ziffer-io/mcp@0.3.0 version`. The ZIFFER tools start when it prints `0.3.0`. Keep the pin as it is: the skills need the code scan and `explain_scan_finding`, which an earlier version of the package does not have.

The server reads four environment variables, all optional at start: `ZIFFER_API_URL`, `ZIFFER_API_KEY`, `ZIFFER_TRUST_ANCHOR` and `ZIFFER_SUITE_FLOOR`. Set them in the shell you start Claude Code from, never in a file in your repository. Only `/ziffer:verify` needs them.

## Install

Load it from a folder.

For one session:

```bash
claude --plugin-dir /path/to/plugins/ziffer
```

To keep it installed, this folder is also a one-plugin marketplace:

```bash
claude plugin marketplace add /path/to/plugins/ziffer
```

```bash
claude plugin install ziffer@ziffer-local
```

## Remove

```bash
claude plugin uninstall ziffer@ziffer-local
```

```bash
claude plugin marketplace remove ziffer-local
```

## What it does not cover

- Claude Code only. Other coding assistants can use the ZIFFER tools directly (`@ziffer-io/mcp`), without these skills.
- It writes no key, names no approver, publishes no policy and merges nothing: those are a person's.
- It cannot see your repository's settings (the `ziffer-production` environment, branch protection). You set and confirm them.
- `/ziffer:verify` works against a sandbox only.

## Documentation

The guide for this plugin:

https://ziffer.io/docs/developers/plugin

## License

Apache License 2.0: see `LICENSE` and `NOTICE` in this folder. Copyright 2026 code75 SASU. ZIFFER
is a registered trademark of code75 SASU, and the licence does not grant it.
