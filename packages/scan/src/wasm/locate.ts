/**
 * Where the engine module comes from. It does NOT build anything.
 *
 * In order: the environment variable `ZIFFER_SCAN_WASM` (an explicit path wins,
 * and a path that does not exist is refused rather than skipped -- falling
 * through to the bundled copy would run a different engine from the one the
 * person asked for), then `<package>/dist/acp_wasm.wasm`, the copy
 * `scripts/vendor-wasm.mjs` places there from the pinned engine.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export class EngineWasmAbsent extends Error {
  override readonly name = 'EngineWasmAbsent';
}

export const WASM_ENV = 'ZIFFER_SCAN_WASM';
export const WASM_FILE = 'acp_wasm.wasm';

/** `<package>/dist`, from this file's own location (`dist/wasm/locate.js`). */
export function packageDist(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function locateWasm(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dist: string = packageDist(),
): string {
  const explicit = env[WASM_ENV];
  if (explicit !== undefined && explicit !== '') {
    if (!existsSync(explicit)) throw new EngineWasmAbsent(`${WASM_ENV}=${explicit} names no file`);
    return explicit;
  }
  const bundled = join(dist, WASM_FILE);
  if (!existsSync(bundled)) {
    throw new EngineWasmAbsent(
      `no engine module at ${bundled} and ${WASM_ENV} is unset. ` +
        'From a checkout: node scripts/vendor-wasm.mjs (it names the cargo command if the module is not built).',
    );
  }
  return bundled;
}
