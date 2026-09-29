#!/usr/bin/env node
/**
 * Run the embed steps that write src/generated/ before tsc (the packages/mcp
 * pattern): embed-annex.mjs, then embed-schemas.mjs.
 *
 * A MISSING SCRIPT IS REFUSED BY NAME, NEVER SKIPPED. The two scripts land on
 * other branches of the ACP-433 build, so a tree can exist that has one and not
 * the other. Skipping the absent one would let tsc compile against a stale or
 * empty src/generated/ and the build would go green over tables it never
 * embedded; so this halts with `EmbedScriptAbsent: scripts/<name>` and the build
 * stops there.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exitIfPrebuilt } from '../../types/scripts/prebuilt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STEPS = ['embed-annex.mjs', 'embed-schemas.mjs'];

// ACP-483: in the public source tree src/generated/ is committed and verified;
// the engine checkout both steps read is not there.
exitIfPrebuilt(join(HERE, '..', '..', '..'), 'packages/scan', 'embed');

for (const step of STEPS) {
    const path = join(HERE, step);
    if (!existsSync(path)) {
        process.stderr.write(`EmbedScriptAbsent: scripts/${step} -- src/generated/ cannot be built without it\n`);
        process.exit(1);
    }
    const r = spawnSync(process.execPath, [path], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
}
