import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { EngineWasmAbsent, locateWasm } from './locate.js';

test('the env var wins, and a path it names that does not exist is refused, not skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-locate-'));
  writeFileSync(join(dir, 'acp_wasm.wasm'), '');
  const other = join(dir, 'other.wasm');
  writeFileSync(other, '');
  assert.equal(locateWasm({ ZIFFER_SCAN_WASM: other }, dir), other);
  assert.throws(() => locateWasm({ ZIFFER_SCAN_WASM: join(dir, 'absent.wasm') }, dir), EngineWasmAbsent);
});

test('without the env var, dist/acp_wasm.wasm; without that, EngineWasmAbsent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-locate-'));
  assert.throws(() => locateWasm({}, dir), (e: unknown) => e instanceof EngineWasmAbsent && e.name === 'EngineWasmAbsent');
  writeFileSync(join(dir, 'acp_wasm.wasm'), '');
  assert.equal(locateWasm({}, dir), join(dir, 'acp_wasm.wasm'));
});
