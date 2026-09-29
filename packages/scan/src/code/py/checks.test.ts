/**
 * The three checks the Python front end reads from source (ACP-455, 2026-09-28), over
 * `fixtures/code/checks-py/`, an invented billing assistant:
 *
 * - `CodeTool.calls`: a tool that runs another tool without passing the dispatcher, by
 *   name through two helpers and an import, through its own method, through a tool
 *   class's run method, and through a tools map; and the decoys that must NOT be
 *   reported -- a call through the dispatcher, a call to a helper that is not a tool, a
 *   tool class built and never run.
 * - `Dispatcher.caller_checks`: the caller that tests `confirmed` before it calls, and
 *   the decoys -- a caller that tests nothing, and one that writes `confirmed_at` and
 *   tests `confirmed` only AFTER the call.
 * - `CodeTool.authority_claims` and `declared_stub`: a decorator keyword and a class
 *   attribute that claim a rule, a PARAMETER of the same name that does not, "Stub:" in
 *   a docstring and "stubborn" that is not the word.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { CodeCatalog, CodeTool } from '../types.js';
import { PY_SCRIPT, findPython, isPyScanOutput, scanPython } from './index.js';

const FIX = fileURLToPath(new URL('../../../fixtures/code/checks-py/', import.meta.url));

let catalog: CodeCatalog;

before(async () => {
  const py = await findPython();
  assert.ok(py !== null, 'no python3 >= 3.9 on PATH: these tests exercise the real walker and cannot run without one');
  catalog = await scanPython(FIX);
});

function tool(name: string): CodeTool {
  const t = catalog.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, `${name} missing from the catalog`);
  return t;
}

describe('scanPython over fixtures/code/checks-py', () => {
  it('reads every tool of the fixture, and says which checks ran', () => {
    assert.deepEqual(
      catalog.tools.map((t) => t.name).sort(),
      ['Rotate keys', 'archive_notes', 'build_only', 'close_account', 'escalate', 'grant_role', 'nightly_sweep', 'purge_all', 'refund_invoice', 'run_named', 'wipe_cache'],
    );
    assert.deepEqual(catalog.checks, [{ language: 'python', tool_calls: true, caller_checks: true, skill_loads: true }]);
    assert.ok(catalog.not_seen.some((l) => l.includes('at most 4 calls deep')), 'the stated depth is a not_seen line');
  });

  it('calls: a tool runs another tool through two helpers and an import, its own method, a class-named function, a tool class, a tools map', () => {
    assert.deepEqual(tool('refund_invoice').calls, [
      { at: { file: 'ledger_helpers.py', line: 10, col: 12 }, via: 'direct', through: ['settle', '_post'], tool: 'close_account' },
    ]);
    assert.deepEqual(tool('wipe_cache').calls, [
      { at: { file: 'cache_tools.py', line: 16, col: 16 }, via: 'direct', through: ['_flush'], tool: 'close_account' },
    ]);
    assert.deepEqual(tool('Rotate keys').calls, [
      { at: { file: 'ops_tools.py', line: 15, col: 16 }, via: 'direct', through: ['revoke'], tool: 'close_account' },
    ]);
    assert.deepEqual(tool('purge_all').calls, [
      { at: { file: 'cache_tools.py', line: 24, col: 16 }, via: 'direct', through: [], tool: 'wipe_cache' },
    ]);
    assert.deepEqual(tool('nightly_sweep').calls, [
      { at: { file: 'billing_tools.py', line: 42, col: 12 }, via: 'lookup', through: [], tool: 'close_account' },
    ]);
    // A computed key: ANY tool in the map may be the one run, so no name is given.
    assert.deepEqual(tool('run_named').calls, [
      { at: { file: 'billing_tools.py', line: 36, col: 12 }, via: 'lookup', through: [] },
    ]);
  });

  it('calls, decoys: through the dispatcher, to a helper that is not a tool, a tool class built and never run', () => {
    assert.equal(tool('escalate').calls, undefined, 'a call through the dispatcher is decided there: not a ToolCall');
    assert.equal(tool('escalate').delegates_to, undefined);
    assert.equal(tool('archive_notes').calls, undefined, 'format_notes is not a tool');
    assert.equal(tool('build_only').calls, undefined, 'building a tool class does not run it');
    assert.equal(tool('close_account').calls, undefined);
    assert.equal(tool('grant_role').calls, undefined);
  });

  it('caller_checks: the caller that tests `confirmed` first; not the one that tests nothing or tests after', () => {
    assert.equal(catalog.dispatchers.length, 1);
    const d = catalog.dispatchers[0];
    assert.ok(d !== undefined);
    assert.equal(d.name, 'dispatch');
    assert.deepEqual(d.caller_checks, [
      { caller: { file: 'billing_tools.py', line: 48, col: 12 }, in_function: 'escalate' },
      {
        caller: { file: 'routing.py', line: 18, col: 12 },
        in_function: 'approve_and_run',
        check: { at: { file: 'routing.py', line: 16, col: 12 }, reads: 'confirmed' },
      },
      // `confirmed_at` is assigned after the call and `session.confirmed` is tested after it.
      { caller: { file: 'routing.py', line: 22, col: 11 }, in_function: 'model_turn' },
    ]);
    assert.deepEqual(d.caller_checks.map((c) => c.caller), d.callers, 'one entry per caller, same order');
  });

  it('authority_claims: a decorator keyword and a class attribute; a parameter of the same name is not a claim', () => {
    assert.deepEqual(tool('refund_invoice').authority_claims, [{ name: 'needs_approval', value: 'True' }]);
    assert.deepEqual(tool('wipe_cache').authority_claims, [{ name: 'requires_confirmation', value: 'True' }]);
    assert.deepEqual(tool('grant_role').params, ['needs_approval', 'role']);
    assert.equal(tool('grant_role').authority_claims, undefined, 'needs_approval is a parameter the model fills');
    assert.equal(tool('close_account').authority_claims, undefined);
  });

  it('declared_stub: "Stub:" in a docstring is the word; "stubborn" is not', () => {
    assert.equal(tool('close_account').declared_stub, true);
    assert.equal(tool('archive_notes').declared_stub, undefined);
    assert.equal(catalog.tools.filter((t) => t.declared_stub === true).length, 1);
  });
});

describe('the guard over the new fields is not vacuous', () => {
  it('refuses a malformed call, claim, stub flag, or a caller check that is not its caller', async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('python3', [PY_SCRIPT, FIX], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err === null ? resolve(out) : reject(err)));
    });
    assert.ok(isPyScanOutput(JSON.parse(stdout)));
    const breaks: [string, string][] = [
      ['"via": "lookup"', '"via": "dispatcher"'],
      ['"through": ["settle", "_post"]', '"through": "settle"'],
      ['"value": "True"', '"value": true'],
      ['"declared_stub": true', '"declared_stub": "yes"'],
      ['"reads": "confirmed"', '"reads": 1'],
      ['"in_function": "model_turn"', '"in_function": null'],
      ['"caller_checks": true', '"caller_checks": "yes"'],
    ];
    for (const [from, to] of breaks) {
      assert.ok(stdout.includes(from), `the fixture output carries ${from}`);
      assert.equal(isPyScanOutput(JSON.parse(stdout.replace(from, to))), false, `${from} -> ${to} must be refused`);
    }
    // A caller check whose caller is not the dispatcher's caller at the same index.
    const swapped = stdout.replace('"caller": {"file": "routing.py", "line": 22', '"caller": {"file": "routing.py", "line": 23');
    assert.notEqual(swapped, stdout);
    assert.equal(isPyScanOutput(JSON.parse(swapped)), false);
  });
});
