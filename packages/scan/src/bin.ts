#!/usr/bin/env node
/**
 * `npx @ziffer-io/scan` -- the entry point (ACP-433). All behaviour is in
 * `cli.ts`, so the tests drive exactly what this runs.
 */

import { run } from './cli.js';

const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
process.exitCode = code;
