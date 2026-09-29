/**
 * Claude Agent SDK names (ACP-455, 2026-09-28): a custom tool reaches the model as
 * `mcp__<server>__<name>`, recorded as `CodeTool.model_name` beside the defined name, the
 * server read from the key it is registered under in `mcpServers` when the source shows it,
 * else from the server's own name; and a name written as a built-in tool that the SDK's
 * current version does not define (data/claude-agent-builtins.json) is listed as written
 * and said.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from './index.js';
import { findPython, scanPython } from './py/index.js';
import { ClaudeBuiltinsDataInvalid, loadClaudeBuiltins, parseClaudeBuiltins } from './ts/sig-claude-agent.js';
import type { CodeCatalog } from './types.js';

const fx = (d: string): string => fileURLToPath(new URL(`../../fixtures/code/${d}/`, import.meta.url));

describe('the data file', () => {
  it('names the current built-ins with the version and the date read, and halts by name when malformed', () => {
    const b = loadClaudeBuiltins();
    assert.equal(b.version, '0.3.284');
    assert.equal(b.read, '2026-09-28');
    for (const n of ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'TodoWrite', 'Agent', 'Task']) assert.ok(b.names.has(n), n);
    for (const n of ['Create', 'GrepTool', 'TodoEdit']) assert.ok(!b.names.has(n), n);
    assert.throws(() => parseClaudeBuiltins('{"version":"1","read":"x","names":[]}'), ClaudeBuiltinsDataInvalid);
  });
});

for (const [lang, dir, line] of [
  ['TypeScript', 'fw-claude-names-ts', "Claude Agent SDK: 3 name(s) in an allowed-tools or tools list are not a built-in tool the SDK's current version defines (src/stock.ts:14 (Create), src/stock.ts:14 (GrepTool), src/stock.ts:14 (TodoEdit); @anthropic-ai/claude-agent-sdk 0.3.284, read 2026-09-28): each is listed as written, and matches no tool, so it neither allows nor restricts one"],
  ['Python', 'fw-claude-names-py', "Claude Agent SDK: 3 name(s) in an allowed-tools or tools list are not a built-in tool the SDK's current version defines (stock.py:20 (Create), stock.py:20 (GrepTool), stock.py:21 (TodoEdit); @anthropic-ai/claude-agent-sdk 0.3.284, read 2026-09-28): each is listed as written, and matches no tool, so it neither allows nor restricts one"],
] as const) {
  describe(`${lang}: fixtures/code/${dir}`, () => {
    let c: CodeCatalog;
    before(async () => {
      if (lang === 'Python') assert.ok((await findPython()) !== null, 'no python3 >= 3.9 on PATH');
      c = lang === 'Python' ? await scanPython(fx(dir)) : await scanCode(fx(dir));
    });

    it('model_name: the registration key names the server when the source shows it, the server\'s own name otherwise; name stays the defined name', () => {
      const named = Object.fromEntries(c.tools.filter((t) => t.model_name !== undefined).map((t) => [t.name, t.model_name]));
      assert.deepEqual(named, { find_shelf: 'mcp__stock__find_shelf', count_stock: 'mcp__counts__count_stock' });
      assert.ok(c.tools.every((t) => t.model_name !== t.name), 'present only when it differs');
    });

    it('a built-in name the SDK does not define is listed as written, and said', () => {
      assert.deepEqual(c.tools.filter((t) => t.via.includes('does not define')).map((t) => t.name).sort(), ['Create', 'GrepTool', 'TodoEdit']);
      assert.ok(c.tools.some((t) => t.name === 'Read' && t.via.includes('built-in')));
      assert.deepEqual(c.not_seen.filter((l) => l.includes("SDK's current version defines")), [line]);
    });
  });
}
