# ZIFFER packages and plugin: the source

ZIFFER is the agent authorization service. Your application asks ZIFFER before an AI agent's tool call runs; a risky call is held for a named person; every decision leaves a signed receipt. More at [ziffer.io](https://ziffer.io), and the documentation is at [ziffer.io/docs](https://ziffer.io/docs).

This repository holds the source of what you already download from npm, and the ZIFFER plugin for Claude Code. It is published so that you can read what runs on your machine. It is not where ZIFFER itself is built: the service, and the engine that decides, are not here.

## What is in each folder

| Folder | What it is | Install |
|---|---|---|
| `packages/scan` | `@ziffer-io/scan`: scans the AI agents on your machine and the tools your code gives a model, and replays an injected call against a policy it drafts. Nothing leaves the machine. | `npx @ziffer-io/scan` |
| `packages/mcp` | `@ziffer-io/mcp`: a local MCP server, so a coding agent can put ZIFFER in your code and drive a decision. | `npx @ziffer-io/mcp` |
| `packages/acp-client` | `@ziffer-io/client`: propose an action, wait for the decision, verify the receipt before you act. | `npm install @ziffer-io/client` |
| `packages/acp-verify` | `@ziffer-io/verify`: verify a decision receipt in your own process, against a key you configured. | `npm install @ziffer-io/verify` |
| `packages/types` | `@ziffer-io/types`: the TypeScript types of the wire format. | `npm install @ziffer-io/types` |
| `plugins/ziffer` | The ZIFFER plugin for Claude Code: the ZIFFER tools and six setup skills. | see below |

Each package has its own README, with what it does and how to use it.

### The plugin

In Claude Code:

```
/plugin marketplace add ziffer-hq/ziffer-sdk
/plugin install ziffer@ziffer
```

From a shell, the same two steps are `claude plugin marketplace add ziffer-hq/ziffer-sdk` and `claude plugin install ziffer@ziffer`. The plugin starts the ZIFFER tools with `npx`, by package name and exact version, written out in `plugins/ziffer/.mcp.json`.

## Building it yourself

You need Node.js 22 or later and pnpm 10 (`corepack enable` gives you the version `package.json` names).

```
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r --workspace-concurrency=1 test
```

Four build steps normally generate a file from something that is not in this repository. Here the generated file is committed instead, and the build checks it rather than regenerating it. `PREBUILT.json` lists every such file with its sha256, and a build refuses a file that no longer matches.

| Generated file | Made from | Here |
|---|---|---|
| `packages/types/src/*.ts` | the wire schemas of the ZIFFER specification, through the engine's generator | committed, verified |
| `packages/scan/src/generated/*.ts` | the engine's control mapping and policy schemas | committed, verified |
| `packages/scan/engine/acp_wasm.wasm` | the engine, compiled to WebAssembly; its source is not public | committed, verified, copied to `dist/` by the build |
| `packages/mcp/src/generated/*.ts` | the ZIFFER guides, the policy repository template and the wire schemas | committed, verified |

`PROVENANCE.json` names the commit of the private repository this tree was composed from, and the sha256 of every file. Nothing here is edited by hand.

Releases are published by `.github/workflows/release.yml`, from a tag, with npm provenance. It builds and tests every package, packs each one with `tools/pack-npm.mjs`, and publishes nothing unless every tarball's release digest equals the line `release/expected-checksums.txt` holds for it, recorded where the packages were tested before this tree was composed. The release digest is the sha256 of the tar inside the tarball, as `node tools/pack-npm.mjs --digest <file.tgz>` prints it: the packer writes that tar in one form on every machine (members sorted by path, fixed modes, dates and owners), while the gzip around it is whatever the machine's zlib produces.

## Licence

Each folder's own `LICENSE` governs it:

- the root, and everything not under a folder with its own `LICENSE`: the Apache License 2.0 (`LICENSE`, with `NOTICE`);
- `packages/types`, `packages/acp-verify`, `packages/acp-client`, `packages/mcp` and `plugins/ziffer`: the Apache License 2.0, with a `NOTICE` beside it;
- `packages/scan`: the Functional Source License, Version 1.1, ALv2 Future License (`FSL-1.1-ALv2`), which covers the compiled engine the scanner ships as well.

ZIFFER is a registered trademark of code75 SASU, and neither licence grants it.

## Reporting a problem

A defect: open an issue here, or write to hello@ziffer.io. A security vulnerability: see `SECURITY.md`, and please do not open a public issue for it.
