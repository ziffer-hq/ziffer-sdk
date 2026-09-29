# @ziffer-io/scan

Find the tools a model can call: the ones your own code gives a model, and the ones the AI tools
installed on this machine can reach. See which of them cannot be undone, and what ZIFFER, the
agent authorization service, would do with each call under an agent authorization policy
generated from what was found. Everything runs locally: nothing leaves the machine, and no AI
model is involved.

```bash
npx @ziffer-io/scan
```

Node.js 22 or later. Python 3.9 or later only if your project has Python files. Tested on macOS.
Linux: the configuration readers are tested, the whole run is not. Windows: untested.

## What it reads

One run reads two halves, in this order, and writes one draft policy over both.

**Your code first**, under `--cwd` (default: the current folder). TypeScript and JavaScript are
read with the TypeScript compiler, following types, so a tool your application defines through its
own helper function is found. Python files, and the code cells of Jupyter notebooks, are read with
this machine's own Python (`python3` or `python`, 3.9 or later) running the reader shipped in the
package; without one, the Python files are counted and reported as not read. The frameworks it
knows are listed in `data/code-sdks.json`. It also reads skills and instruction files (`SKILL.md`,
`CLAUDE.md`, `AGENTS.md` and the like) as text, never running them. Dependencies, build output,
version control, test code and hidden folders are skipped by folder name, and counted. Reading code
starts no tool server. Run from your home folder or `/`, the code half is skipped with one line
saying so; `--code` refuses instead.

**Then the AI tools installed on this machine.** The MCP configuration files of the AI agent
clients it knows: Claude Code, Claude Desktop, Cursor, VS Code, GitHub Copilot, Windsurf, Gemini
CLI, Codex CLI, Zed, Cline, Continue and Goose, in your home directory and in the current project.
The report names every client it looked for, and every client it cannot read at all (JetBrains AI
Assistant today).

To learn which tools each server offers, it has to start the server. Before it starts anything it
prints the exact list (client, server, command) and asks. A credential in that list is shown as
`[redacted]`: every environment value, a flag whose name says key, token, secret, password or
auth, and a value shaped like a known API key or token. The report and `--json` redact the same
way. The server is still started with the real values. The rules are `data/redact.json`. `--yes`
skips the question for someone who has read the list another way. With no terminal to ask on and
no `--yes`, it refuses and starts nothing. The only request it sends a server is "list your tools";
it never calls one. A server gets the environment its own configuration declares plus PATH, HOME,
USER, LOGNAME, SHELL and TERM, never the rest of yours.

A server configured in several places, as `~/.claude.json` does once per project, is started
once and reported once, with the number of projects it is configured in. A server configured in
several AI agent clients is one program too: entries that run the same command with the same
arguments and the same environment variable names (whatever their values), or name the same
remote address, are listed on one line naming every client, started once, and counted once;
its tools still appear under each client, because each client's AI agent can reach them. At most four servers
start at a time, and each has 60 seconds to list its tools; `--timeout <seconds>` gives more. A
server fetched by `npx` or `uvx` can need longer the first time, and the report says so.

A remote server, one that is turned off, or one whose command is not installed is reported as not
scanned, with the reason. A tool the scan cannot classify is reported as such and gets no rule in
the policy, so the policy refuses it; it is never guessed at.

`--code` reads only your code; `--no-code` reads only the installed AI tools.

## What it never sends

Nothing. The scan, the policy and the replay make no network request. The processes it starts are
this machine's Python, to read Python files, and the tool servers you agreed to; the servers are
your own programs, started as your configuration starts them, and do whatever they do when your AI
agent starts them.

## What it writes

One folder, `./ziffer-scan/`. In it, `ziffer-policy/` (or the folder `--out` names, with everything
else beside it): a draft agent authorization policy of twelve files plus `tool-names.json`, which
maps each key in the policy back to the tool name the server uses. Beside the policy:

- `ziffer-tools.json`, when your code was read: each code tool's key as the draft names it. The
  ZIFFER call the report gives you to paste reads it at startup; deploy it with your application,
  or set `ZIFFER_TOOLS_FILE`.
- `ziffer-scan.json`, when your code was read or with `--report`: the `--json` document, redacted,
  home paths shown from `~`.
- `ziffer-replay-own.json`, when the replay ran: the replay case the scan wrote from one of your
  own tools.
- with `--report`, the HTML report and the review archive below.

The first line after the report's header says what was written and that it is yours to delete.
Run inside a git repository, the report says to add `ziffer-scan/` to `.gitignore` or to pass
`--out` elsewhere. It never overwrites: a path that already exists is refused by name, so a second
run needs the first folder moved or deleted.

Every classification in it is a draft, read from the tools' names and descriptions. It is a
starting point to review, not a policy to deploy.

## What the report shows

Before anything starts, a few lines say what the scan will read and that nothing starts before
you say yes. While servers start, a progress line on stderr counts the ones that answered and the
ones that did not.

Then one screen, in colour on a terminal and as wide as the terminal (80 to 120 columns): what a
model in your application can call and which of those tools cannot be undone, the grade, the one
place to put the ZIFFER call in your code, what the scan did not see in the code, what the AI agents
you code with can reach and the findings about it (two tools one AI agent can chain, a tool
description that speaks to the AI agent, a tool that can send data out), what the scan could not
see on this machine, the replay in two lines, and NEXT: what to open, the draft policy, and the
review link. The last line is the one thing to do next.

Colour is on when stdout is a terminal and `NO_COLOR` is unset; `--no-color` turns it off and
`--color` forces it on for a pipe. Colour never changes the text.

`--full` prints the complete report after that screen: every client, server and tool with its
draft classification, every finding with the controls it cites, the counts per client, and the
replay case by case. `--json` prints everything as one document.

## What UNSIGNED DEMO means

The policy is signed, and the replay shows signed receipts, but the key that signs them is made
for that one run and thrown away before the run ends. The first line of the replay says so:

```
UNSIGNED DEMO: the receipts below are signed by a throwaway key made for this run; ...
```

A receipt from a scan proves only that the policy produced it on your machine, that day. It is not
evidence for anyone else, because no deployed policy names that key.

## The replay

Eight injected instructions, each one making an AI agent that obeys them completely call a tool.
Without an agent authorization policy each call runs as written. Beside that, the report shows
what the policy the scan just generated does with each: refused, held for approvers, or allowed
with a receipt. A case whose tool the generated policy does not name is refused before anything
is graded, and the report says which cases the policy does not stop. `--code` has no replay: the
instructions are injected into an installed AI tool's session, and `--code` reads none.

`ziffer-scan replay` runs the same eight against the test harness's own policy instead.

## Options

```
ziffer-scan [scan|replay] [options]
ziffer-scan --code [--cwd <dir>] [--report] [--json] [--out <dir>]
ziffer-scan --ci <policy-dir> [--json] [--cwd <dir>] [--timeout <seconds>]
```

- `--code`: your code only; starts no tool server.
- `--no-code`: the installed AI tools only; the code is not read.
- `--cwd <dir>`: the code to read, and the project whose AI tool configuration is read.
- `--full`: the complete report and the replay table after the one screen.
- `--json`: one document on stdout for a program to read.
- `--yes`: start the tool servers found without asking.
- `--out <dir>`: the draft policy folder (default `./ziffer-scan/ziffer-policy`).
- `--no-replay`: write the policy, skip the replay.
- `--timeout <seconds>`: seconds each tool server has to start and list its tools (default 60).
- `--home <dir>`: read the AI tool configuration under this home directory.
- `--platform <p>`: `darwin`, `linux` or `win32`.
- `--color`, `--no-color`: force colour on or off.
- `--report`: also write the HTML report, the JSON document and the review archive.
- `--ci <policy-dir>`: the pull-request check below.
- `--help`, `--version`.

A refusal prints one line naming what was refused and exits 2.

## --report

`ziffer-scan --report` also writes three files next to the policy folder (in `./ziffer-scan/`,
with the default `--out`), and the report's NEXT names the page to open first:

- `ziffer-scan-report.html`: the report to forward. One self-contained page: what a model in your
  application can call, what can do damage that cannot be undone, where to put the ZIFFER call,
  the findings with the control references they cite, what the scan could not see, the replay,
  and the draft policy with the placeholders to replace (approvers, notice addressee, signing
  key). Fonts and styles are inside the file, and its content security policy lets it load
  nothing from anywhere. It runs one inline script, pinned by its hash in that policy, for the
  copy buttons and the dialogs. Credentials are shown as `[redacted]`, paths under your home
  start with `~`, and the machine is named by its host name only.
- `ziffer-scan.json`: the `--json` document, with the same redaction and home paths from `~`.
- `ziffer-review.tar.gz`: the report, the JSON document and the policy folder in one archive.
  **The archive is what the review email from https://ziffer.io/review asks you to attach.**

They are written beside the policy folder, not inside it: the policy is signed, and its
signature covers every file in the folder. `--report` refuses to overwrite any of the three.

## --ci

`ziffer-scan --ci <policy-dir>` is for a pull request in your policy repository. No network, no
account, no model:

1. It reads the MCP servers configured **in the repository** under `--cwd` (default: the current
   directory): `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`,
   `.codex/config.toml` and `.continue/mcpServers/`. Nothing in any home directory. A CI runner
   has no one to ask, so `--ci` starts them without asking (as `--yes`); the list of what it starts
   is printed first, on stderr, credentials `[redacted]`.
2. It asks each server for its tools, and asks the engine's own `decide` -- the one this package
   embeds -- what the policy in `<policy-dir>` decides for each tool. The policy in a pull request
   is a draft, so it is read **unsigned**, and the first line printed says so: this checks what the
   rules decide, not that the bundle verifies.
3. It prints the engine's verdicts, one line per tool, and adds none of its own: a tool with no
   risk function is `REFUSED [8.4-3]`; an action absent from `reversibility.json` is graded
   `IRREVERSIBLE`; a resource absent from `floors.json` is at `T3`. Each line cites the Annex E rows
   the finding maps to.

```
UNSIGNED: the policy was read without checking a signature, because a pull request carries a draft; this checks what the rules decide, not that the bundle verifies.
Policy: policy
mail read_email → ALLOW LOW REVERSIBLE T1 [read_email]
mail send_email → REFUSED [8.4-3] no risk function for task_type "send_email" (risk_functions) (NIS2 Art. 21(2)(a); DORA Art. 8(1))
2 tools graded: 1 allowed, 0 held for approval, 1 refused; 0 not checked. Exit 1.
To grade the refused tools, add to policy:
  risk_functions.json: {"applies_to":"send_email","base":"HIGH","raise_to":[{"if":"resource.effective_tier >= T2","then":"HIGH"}]}
  These are drafts from the scan: review each level before you merge.
```

The fix lines are the entries the scan's own policy generator drafts for that tool: review the
level before you merge it. A server that cannot start or list its tools (one that needs a
credential the job does not have, say) is printed `NOT CHECKED` and does not fail the run.

Exit codes: **0** every tool listed was graded and none was refused; **1** the engine refused at
least one tool; **2** the run itself was refused, by name (a policy member absent or invalid, the
engine module absent). `--json` prints the same result as one document.

In GitHub Actions (the policy repository template carries this file as
`.github/workflows/policy-scan.yml`):

```yaml
name: policy-scan
on:
  pull_request:
permissions:
  contents: read
env:
  POLICY_DIR: policy/
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npx -y @ziffer-io/scan@0 --ci "$POLICY_DIR"
```

## License

Functional Source License, Version 1.1, ALv2 Future License (`FSL-1.1-ALv2`): see `LICENSE`
beside this file. It covers the compiled ZIFFER engine this package ships as well. Copyright 2026
code75 SASU. ZIFFER is a registered trademark of code75 SASU, and the licence does not grant it.
The open-source components this package redistributes are listed in `THIRD-PARTY-NOTICES`, under
their own licences.
