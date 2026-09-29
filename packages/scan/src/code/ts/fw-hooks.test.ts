/**
 * Coding-assistant hook files (record §3.20): reported as interception points already
 * present, or absent, in the honesty lines -- never as tools. Shapes from the Claude
 * Code, Cursor and Devin Desktop hook documentation (2026-09-28).
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../index.js';
import type { CodeCatalog } from '../types.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/code/fw-coding-assistant-hooks-ts/', import.meta.url));

let catalog: CodeCatalog;
before(async () => {
  catalog = await scanCode(FIXTURE);
});

function line(prefix: string): string {
  const l = catalog.not_seen.find((x) => x.startsWith(prefix));
  assert.ok(l !== undefined, prefix);
  return l;
}

test('hooks: none of it is a tool', () => {
  assert.deepEqual(catalog.tools, []);
  assert.deepEqual(catalog.exposures, []);
});

test('hooks: a Claude Code PreToolUse hook is a K1 interception point already present, with its matcher and the permission rules', () => {
  const l = line('.claude/settings.json (Claude Code) registers hooks that run before');
  assert.match(l, /PreToolUse for "Bash" at line 4/);
  assert.match(l, /\(K1\)/);
  assert.match(l, /let 2 tool pattern\(s\) run without asking, on Bash, Read\./);
  assert.doesNotMatch(l, /npm test/, 'a rule as written can hold a command line: only the tool it names is said');
  assert.doesNotMatch(l, /PostToolUse/);
});

test('hooks: a settings file with no hook, and hooks that only run after, say that nothing can refuse a call', () => {
  assert.match(line('admin/.claude/settings.json (Claude Code) registers no hook'), /let 1 tool pattern\(s\) run without asking, on Edit\./);
  assert.match(line('.cursor/hooks.json:3 (Cursor) registers hooks only around or after'), /afterFileEdit\): none runs before a tool call/);
});

test('hooks: a Devin Desktop pre-hook and an MCP server list', () => {
  assert.match(line('.windsurf/hooks.json (Devin Desktop (formerly Windsurf))'), /pre_mcp_tool_use at line 3/);
  assert.equal(line('.mcp.json configures'), '.mcp.json configures 1 MCP server(s) for a coding assistant (bookshop-ledger): their tools are reachable from the assistant and are listed at runtime, not here.');
});

test('hooks: every coding-assistant note carries its KIND as data, and stays in the honesty list (ACP-464)', () => {
  const kinded = catalog.assistant_config ?? [];
  const assistantLines = catalog.not_seen.filter((l) => /\) registers (no hook|hooks)|configures \d+ MCP server\(s\) for a coding assistant/.test(l));
  assert.ok(assistantLines.length >= 3, catalog.not_seen.join('\n'));
  assert.deepEqual([...kinded].sort(), [...assistantLines].sort(), 'a coding-assistant note without its kind, or a kind on another note');
  for (const l of kinded) assert.ok(catalog.not_seen.includes(l), `a kinded note left not_seen: ${l}`);
});
