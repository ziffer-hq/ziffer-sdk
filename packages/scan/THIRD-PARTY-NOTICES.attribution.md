## agent-scan: where AI agent clients keep their MCP configuration

`data/clients.json` contains configuration file paths taken from **agent-scan**
(https://github.com/snyk/agent-scan, formerly `invariantlabs-ai/mcp-scan`).

- File read: `src/agent_scan/well_known_clients.py`
- Commit read: `2527530b842e681404a8daad06c65f1973fc90c8`
- Copyright 2025 Invariant Labs AG
- Licence: Apache License, Version 2.0. The full text is at
  https://www.apache.org/licenses/LICENSE-2.0 and in that repository's `LICENSE` file at the
  commit above. The repository carries no `NOTICE` file at that commit.

Taken from it, for macOS, Linux and Windows, as `mcp_config_paths` (every entry marked
`"verified": "upstream"` in `data/clients.json`): Windsurf, Cursor, VS Code, GitHub Copilot
(`~/.copilot/mcp-config.json`), Claude Desktop, Claude Code (`~/.claude.json` and the
`~/.claude/plugins/cache/**/.mcp.json` pattern), and Gemini CLI.

Changed from it: the Copilot file agent-scan also lists under VS Code is read once, under
GitHub Copilot, and each VS Code server is reported a second time as GitHub Copilot through
VS Code. The paths were re-expressed in this package's own data format; no agent-scan code is
included, and the file readers are this package's own.

Not taken from it: Codex CLI, Zed, Cline, Continue, Goose and the project-local files
(`./.mcp.json`, `./.cursor/mcp.json`, `./.vscode/mcp.json`, `./.gemini/settings.json`,
`./.codex/config.toml`, `./.continue/mcpServers/`) were written from each client's own
documentation and are marked `"verified": "docs"`.

## Fonts in the HTML report: Schibsted Grotesk and IBM Plex Mono

`assets/fonts/` contains three font files that `ziffer-scan --report` writes into the report's
stylesheet as base64 `@font-face` sources, so the report loads nothing. They are distributed
unmodified. `assets/fonts/README` says which file is which; `assets/fonts/OFL.txt` is the licence.

- **Schibsted Grotesk**, variable, weights 400 to 900, Latin subset, version 1.100
  (`assets/fonts/schibsted-grotesk-400-900.woff2`). Copyright 2023 The Schibsted-Grotesk Project
  Authors (https://github.com/schibsted/schibsted-grotesk). Licence: SIL Open Font License,
  Version 1.1.
- **IBM Plex Mono**, Regular and Medium, Latin subset, version 2.3
  (`assets/fonts/ibm-plex-mono-400.woff2`, `assets/fonts/ibm-plex-mono-500.woff2`). Copyright 2017
  IBM Corp., with Reserved Font Name "Plex" (https://github.com/IBM/plex). Licence: SIL Open Font
  License, Version 1.1.

The version and copyright of each are read from the font file's own name table.
