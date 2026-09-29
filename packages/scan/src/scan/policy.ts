/**
 * The ONE draft policy a scan writes (ACP-455): generated from every tool the
 * run found, in the codebase and in the installed AI tools alike, and signed by
 * a key made for the run and dropped before this returns.
 *
 * Until 0.3.0 the MCP scan and `--code` each generated their own, and a person
 * who ran both got two draft policies to review for one application. There is
 * one generator call per run now, and every verdict the run prints is made
 * against the bundle this returns.
 */

import { BundleEngineFailed, generateBundle, type GeneratedBundle } from '../bundle/generate.js';
import { KeyNotDiscarded } from '../replay/index.js';
import type { CatalogTool, Classification } from '../types.js';
import type { Engine } from '../wasm/loader.js';
import { dropKey, keygen } from '../wasm/ops.js';

export async function draftBundle(
  catalog: readonly CatalogTool[],
  classifications: readonly Classification[],
  engine: Engine,
  now: Date,
): Promise<GeneratedBundle> {
  const runKey = await keygen(engine);
  if (!runKey.ok) throw new BundleEngineFailed(`keygen: ${runKey.error.message}`);
  try {
    return await generateBundle(catalog, classifications, engine, { runKey: runKey.result, now });
  } finally {
    // The run key signed the bundle and is named as its receipt identity; its
    // private half has no further use and does not outlive this block.
    const dropped = await dropKey(engine, runKey.result.handle);
    if (!dropped.ok) throw new KeyNotDiscarded(`the engine did not drop the run key: ${dropped.error.message}`);
  }
}
