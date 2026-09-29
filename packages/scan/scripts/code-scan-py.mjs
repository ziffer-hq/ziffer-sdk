#!/usr/bin/env node
/**
 * Dev only: print the Python half of `ziffer-scan --code` for a directory as JSON.
 * The CLI wiring belongs to the integrator (ACP-455); this runs the built module.
 *
 *   pnpm --filter ./packages/scan run build && node scripts/code-scan-py.mjs <dir>
 */
import { resolve } from 'node:path';

import { scanPython } from '../dist/code/py/index.js';

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write('usage: node scripts/code-scan-py.mjs <dir>\n');
  process.exit(2);
}
const catalog = await scanPython(resolve(dir), { log: (line) => process.stderr.write(`${line}\n`) });
process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
