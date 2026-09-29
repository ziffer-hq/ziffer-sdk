#!/usr/bin/env node
/**
 * Dev driver for `scanCode` (ACP-455): `node scripts/code-scan.mjs <dir> [--syntax-only]`.
 * Prints the CodeCatalog as JSON on stdout and the log lines on stderr. Runs the
 * BUILT module (run the package's `build` or `typecheck` script first).
 * Reads the directory; writes nothing into it. The CLI's `--code` is wired elsewhere.
 */

import { scanCode } from '../dist/code/index.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (dir === undefined) {
  process.stderr.write('usage: node scripts/code-scan.mjs <dir> [--syntax-only]\n');
  process.exit(2);
}
const catalog = await scanCode(dir, {
  syntaxOnly: args.includes('--syntax-only'),
  log: (line) => process.stderr.write(`${line}\n`),
});
process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
