import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { type Platform, loadClientsData } from './clients.js';
import { type DiscoveryResult, discover } from './discover.js';

const FIX = fileURLToPath(new URL('../../fixtures/clients/', import.meta.url));
const NOWHERE = join(FIX, '__no_such_dir__');
const DATA = loadClientsData();

function run(platform: Platform, home: string, cwd: string = NOWHERE, env: Record<string, string> = {}): DiscoveryResult {
  return discover(platform, join(FIX, home), cwd === NOWHERE ? cwd : join(FIX, cwd), env, DATA);
}

/** client/server/command/args/env/cwd/via, the fields a reader of the scan output sees. */
function brief(r: DiscoveryResult): string[] {
  return r.servers.map((s) =>
    [s.client, s.name, s.command, JSON.stringify(s.args), JSON.stringify(s.env), s.cwd ?? '-', s.via ?? '-'].join(' | '),
  );
}
function skipped(r: DiscoveryResult): string[] {
  return r.skipped.map((s) => `${s.client} | ${s.name} | ${s.reason}`);
}

const ALL: Platform[] = ['darwin', 'linux', 'win32'];

test('Windsurf: a local server is found and a remote one is skipped by name, on every platform', () => {
  for (const p of ALL) {
    const r = run(p, 'windsurf/home', NOWHERE, { APPDATA: NOWHERE });
    assert.deepEqual(brief(r), [
      'Windsurf | fs | npx | ["-y","@modelcontextprotocol/server-filesystem","/tmp"] | {} | - | -',
    ]);
    assert.deepEqual(skipped(r), [
      'Windsurf | remote-docs | a remote server at https://mcp.example.test/sse; this scan starts only servers that run on this machine',
    ]);
    assert.deepEqual(r.unreadable, []);
  }
});

test('Cursor: comments and trailing commas are read; the project file is read from the working directory', () => {
  const r = run('darwin', 'cursor/home', 'cursor/project');
  assert.deepEqual(brief(r), [
    'Cursor | mail | node | ["/opt/mail/server.js"] | {"MAIL_TOKEN":"fixture-value"} | - | -',
    'Cursor | repo-tools | uvx | ["repo-tools"] | {} | /work/repo | -',
  ]);
});

test('VS Code: each server is reported under VS Code and again under GitHub Copilot through VS Code', () => {
  const r = run('darwin', 'vs-code/darwin/home', 'vs-code/project');
  assert.deepEqual(brief(r), [
    'VS Code | sqlite | uvx | ["mcp-server-sqlite","--db-path","/tmp/x.db"] | {} | - | -',
    'GitHub Copilot | sqlite | uvx | ["mcp-server-sqlite","--db-path","/tmp/x.db"] | {} | - | VS Code',
    'VS Code | playwright | npx | ["-y","@microsoft/mcp-server-playwright"] | {} | - | -',
    'GitHub Copilot | playwright | npx | ["-y","@microsoft/mcp-server-playwright"] | {} | - | VS Code',
    'VS Code | tickets | node | ["tools/tickets.js"] | {"TICKETS_URL":"http://localhost:9000"} | - | -',
    'GitHub Copilot | tickets | node | ["tools/tickets.js"] | {"TICKETS_URL":"http://localhost:9000"} | - | VS Code',
  ]);
  assert.deepEqual(skipped(r), [
    'VS Code | github | a remote server at https://api.githubcopilot.com/mcp; this scan starts only servers that run on this machine',
    'GitHub Copilot | github | a remote server at https://api.githubcopilot.com/mcp; this scan starts only servers that run on this machine',
  ]);
  // Each file is read once, though its servers are reported twice.
  assert.equal(r.configs_read.length, 3);
});

test('VS Code: the Linux and Windows user files', () => {
  assert.deepEqual(brief(run('linux', 'vs-code/linux/home')), [
    'VS Code | playwright | npx | ["-y","@microsoft/mcp-server-playwright"] | {} | - | -',
    'GitHub Copilot | playwright | npx | ["-y","@microsoft/mcp-server-playwright"] | {} | - | VS Code',
  ]);
  assert.deepEqual(brief(run('win32', 'vs-code/win32/home')), [
    'VS Code | playwright | npx.cmd | ["-y","@microsoft/mcp-server-playwright"] | {} | - | -',
    'GitHub Copilot | playwright | npx.cmd | ["-y","@microsoft/mcp-server-playwright"] | {} | - | VS Code',
  ]);
});

test('GitHub Copilot CLI: its own file, its own client, no via; a disabled server is skipped', () => {
  const r = run('linux', 'github-copilot/home');
  assert.deepEqual(brief(r), ['GitHub Copilot | shell-helper | shell-helper-mcp | [] | {} | - | -']);
  assert.deepEqual(skipped(r), ["GitHub Copilot | off | turned off in the client's config"]);
});

test('Claude Desktop: one path per platform', () => {
  for (const p of ALL) {
    const r = run(p, `claude-desktop/${p}/home`);
    assert.deepEqual(brief(r), [
      'Claude Desktop | notes | notes-mcp | ["--vault","/data/notes"] | {"NOTES_KEY":"fixture-value"} | - | -',
    ]);
    // The other platforms' layouts are not read on this one.
    for (const other of ALL.filter((o) => o !== p)) {
      assert.deepEqual(run(other, `claude-desktop/${p}/home`).servers, []);
    }
  }
});

test('Claude Code: user scope, project scope with its directory, plugin cache with the plugin root, project .mcp.json', () => {
  const r = run('darwin', 'claude-code/home', 'claude-code/project');
  const pluginDir = join(FIX, 'claude-code/home/.claude/plugins/cache/market/deploy-plugin/1.0.0');
  assert.deepEqual(brief(r), [
    'Claude Code | user-search | search-mcp | [] | {} | - | -',
    'Claude Code | db | db-mcp | ["--ro"] | {} | /work/app | -',
    `Claude Code | deployer | ${pluginDir}/bin/deployer | ["--config","${pluginDir}/deployer.json"] | {} | - | -`,
    'Claude Code | team-wiki | wiki-mcp | ["serve"] | {} | - | -',
  ]);
});

test('Gemini CLI: user and project settings; a remote httpUrl is skipped', () => {
  const r = run('win32', 'gemini-cli/home', 'gemini-cli/project');
  assert.deepEqual(brief(r), [
    'Gemini CLI | weather | python | ["-m","weather_mcp"] | {"PORT":"8080"} | /opt/weather | -',
    'Gemini CLI | lint | lint-mcp | [] | {} | - | -',
  ]);
  assert.deepEqual(skipped(r), [
    'Gemini CLI | remote | a remote server at https://mcp.example.test/mcp; this scan starts only servers that run on this machine',
  ]);
});

test('Codex CLI: the TOML tables, a multi-line array, a quoted key, remote, disabled, and a table with no command', () => {
  const r = run('linux', 'codex-cli/home', 'codex-cli/project');
  assert.deepEqual(brief(r), [
    'Codex CLI | context7 | npx | ["-y","@upstash/context7-mcp"] | {"MY_ENV_VAR":"MY_ENV_VALUE"} | - | -',
    'Codex CLI | local tools | C:\\tools\\mcp.exe | ["--mode","strict"] | {} | - | -',
    'Codex CLI | project_db | db-mcp | ["--project"] | {} | /work/app | -',
  ]);
  assert.deepEqual(skipped(r), [
    'Codex CLI | figma | a remote server at https://mcp.figma.com/mcp; this scan starts only servers that run on this machine',
    "Codex CLI | parked | turned off in the client's config",
    'Codex CLI | chrome_devtools | names no command to start',
  ]);
});

test('Zed: the command/args/env form, a remote server, an extension-provided server', () => {
  for (const p of ['darwin', 'linux'] as const) {
    const r = run(p, 'zed/nix/home');
    assert.deepEqual(brief(r), ['Zed | local-mcp-server | some-command | ["arg-1","arg-2"] | {} | - | -']);
    assert.deepEqual(skipped(r), [
      'Zed | remote-mcp-server | a remote server at https://example.com/mcp; this scan starts only servers that run on this machine',
      'Zed | mcp-server-from-extension | provided by a Zed extension; the settings file names no command to start',
    ]);
  }
});

test('Zed on Windows: the older command { path, args, env } form, found through APPDATA', () => {
  const r = run('win32', 'zed/nix/home', NOWHERE, { APPDATA: join(FIX, 'zed/win32/appdata') });
  assert.deepEqual(brief(r), ['Zed | legacy-server | C:/tools/legacy.exe | ["--stdio"] | {"LEGACY_MODE":"1"} | - | -']);
});

test('Cline: the VS Code globalStorage file on each platform, and the Cline CLI file', () => {
  const expectServers = ['Cline | local-server | node | ["/path/to/server.js"] | {"API_KEY":"fixture-value"} | - | -'];
  const expectSkipped = [
    'Cline | remote-server | a remote server at https://example.com/mcp; this scan starts only servers that run on this machine',
    "Cline | switched-off | turned off in the client's config",
  ];
  const d = run('darwin', 'cline/darwin/home');
  assert.deepEqual(brief(d), expectServers);
  assert.deepEqual(skipped(d), expectSkipped);
  assert.deepEqual(brief(run('linux', 'cline/linux/home')), expectServers);
  const w = run('win32', 'cline/cli/home', NOWHERE, { APPDATA: join(FIX, 'cline/win32/appdata') });
  assert.deepEqual(brief(w), [...expectServers, 'Cline | cli-server | cli-mcp | ["--stdio"] | {} | - | -']);
});

test('Continue: config.yaml, a block file, the legacy config.json, and the workspace folder in YAML and JSON', () => {
  const r = run('darwin', 'continue/home', 'continue/project');
  assert.deepEqual(brief(r), [
    'Continue | SQLite MCP | npx | ["-y","mcp-sqlite","/path/to/your/database.db"] | {} | - | -',
    'Continue | GitHub | npx | ["-y","@modelcontextprotocol/server-github"] | {"GITHUB_PERSONAL_ACCESS_TOKEN":"${{ secrets.GITHUB_PERSONAL_ACCESS_TOKEN }}"} | - | -',
    'Continue | Browser search | npx | ["@playwright/mcp@latest"] | {} | - | -',
    'Continue | modelContextProtocolServers[0] | uvx | ["mcp-server-sqlite","--db-path","/tmp/legacy.db"] | {} | - | -',
    'Continue | Team docs | team-docs-mcp | [] | {} | - | -',
    'Continue | copied | copied-mcp | ["--x"] | {} | - | -',
  ]);
});

test('Goose: stdio extensions are servers; builtin, platform, remote and disabled ones are skipped by name', () => {
  const r = run('linux', 'goose/nix/home');
  assert.deepEqual(brief(r), [
    'Goose | filesystem | npx | ["-y","@modelcontextprotocol/server-filesystem","/tmp"] | {} | - | -',
  ]);
  assert.deepEqual(skipped(r), [
    'Goose | developer | runs inside Goose, not as a separate server',
    'Goose | computercontroller | runs inside Goose, not as a separate server',
    'Goose | remote-tools | a remote server at https://example.com/mcp; this scan starts only servers that run on this machine',
    "Goose | github | turned off in the client's config",
  ]);
});

test('Goose on Windows: found through APPDATA, block sequence arguments', () => {
  const r = run('win32', 'goose/nix/home', NOWHERE, { APPDATA: join(FIX, 'goose/win32/appdata') });
  assert.deepEqual(brief(r), [
    'Goose | filesystem | npx.cmd | ["-y","@modelcontextprotocol/server-filesystem","C:\\\\Users\\\\fixture\\\\Documents"] | {"FS_MODE":"read-only"} | - | -',
  ]);
});

test('JetBrains AI Assistant is listed as not covered, never left out', () => {
  for (const p of ALL) {
    const r = run(p, 'windsurf/home');
    assert.deepEqual(r.not_covered, ['JetBrains AI Assistant']);
    assert.ok(!r.clients_checked.includes('JetBrains AI Assistant'));
  }
});

test('twelve clients are checked on every platform', () => {
  for (const p of ALL) {
    assert.deepEqual(run(p, 'windsurf/home').clients_checked, [
      'Windsurf',
      'Cursor',
      'VS Code',
      'GitHub Copilot',
      'Claude Desktop',
      'Claude Code',
      'Gemini CLI',
      'Codex CLI',
      'Zed',
      'Cline',
      'Continue',
      'Goose',
    ]);
  }
});

test('an unreadable file is reported with its reason and the scan goes on', () => {
  const r = run('darwin', 'unreadable/home');
  assert.deepEqual(brief(r), ['Windsurf | still-read | ok-mcp | [] | {} | - | -']);
  const reasons = r.unreadable.map((u) => `${u.path.slice(FIX.length)} | ${u.reason.split(':')[0] ?? ''}`);
  assert.deepEqual(reasons, ['unreadable/home/.cursor/mcp.json | JsonUnreadable', 'unreadable/home/.continue/config.yaml | YamlShapeUnsupported']);
  const yaml = r.unreadable[1];
  assert.ok(yaml !== undefined && yaml.reason.includes('config.yaml:3: block scalars'));
});

test('a file the scan may not read is reported, not skipped as absent', () => {
  const home = mkdtempSync(join(tmpdir(), 'scan-discovery-'));
  try {
    mkdirSync(join(home, '.cursor'));
    const file = join(home, '.cursor', 'mcp.json');
    writeFileSync(file, '{}');
    chmodSync(file, 0o000);
    const r = discover('linux', home, NOWHERE, {}, DATA);
    if (process.getuid !== undefined && process.getuid() === 0) return; // root reads anything
    assert.deepEqual(
      r.unreadable.map((u) => [u.path, u.reason.split(':')[0]]),
      [[file, 'Error']],
    );
    assert.ok(r.unreadable[0]?.reason.includes('EACCES'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an %APPDATA% path with no APPDATA set is reported as unresolvable, not guessed', () => {
  const r = run('win32', 'windsurf/home');
  const appdata = r.unreadable.filter((u) => u.path.startsWith('%APPDATA%'));
  assert.equal(appdata.length, 3); // Zed, Cline, Goose: one Windows path each
  for (const u of appdata) assert.equal(u.reason, '%APPDATA% is not set, so this path cannot be resolved');
});

test('discovery reads the process neither for home nor environment', () => {
  // A fake home with nothing in it finds nothing, whatever the machine running the test has.
  const r = discover('darwin', NOWHERE, NOWHERE, {}, DATA);
  assert.deepEqual(r.servers, []);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.configs_read, []);
});

test('one server configured in three project blocks is ONE entry carrying its three places (ACP-450)', () => {
  const home = mkdtempSync(join(tmpdir(), 'ziffer-scan-group-'));
  try {
    const block = (extra: Record<string, unknown>) => ({
      mcpServers: {
        remote: { type: 'http', url: 'https://mcp.example.test/mcp' },
        local: { command: 'npx', args: ['-y', 'local-mcp'] },
        ...extra,
      },
    });
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        projects: {
          '/w/a': block({}),
          '/w/b': block({}),
          // Same name, different program: a different server, never folded in.
          '/w/c': block({ local: { command: 'npx', args: ['-y', 'other-mcp'] } }),
        },
      }),
    );
    const r = discover('darwin', home, NOWHERE, {}, DATA);
    const local = r.servers.filter((s) => s.client === 'Claude Code' && s.name === 'local');
    assert.equal(local.length, 2);
    assert.deepEqual(local[0]?.configured_in?.map((p) => p.project), ['/w/a', '/w/b']);
    assert.equal(local[1]?.configured_in, undefined);
    assert.deepEqual(local[1]?.args, ['-y', 'other-mcp']);
    const remote = r.skipped.filter((s) => s.client === 'Claude Code' && s.name === 'remote');
    assert.equal(remote.length, 1);
    assert.deepEqual(remote[0]?.configured_in?.map((p) => p.project), ['/w/a', '/w/b', '/w/c']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
