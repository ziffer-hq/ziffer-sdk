#!/usr/bin/env node
/**
 * Refuse to run the suite unless every test file in `src/` reached `dist/`.
 *
 * # The green run that meant nothing
 *
 * `node --test "dist/**\/*.test.js"` exits **0** when the glob matches nothing.
 * That is not hypothetical here: deleting `dist/` without also deleting
 * `tsconfig.tsbuildinfo` leaves `tsc -b` believing it is up to date, so it emits
 * nothing, and the suite then reports `# pass 0 # fail 0` and succeeds. It was
 * observed exactly that way while building this package.
 *
 * A test run that can report success while executing no tests is the worst
 * shape available in this repository, because the passing run is what gets
 * quoted as evidence. So this refuses instead, and it refuses by comparing
 * against `src/` rather than against a hard-coded count: a count in this file
 * would be a second statement of how many tests exist, and the one that goes
 * stale is the one nobody edits when a test file is added.
 */

import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Recursive, unlike the copy in packages/mcp: this package keeps its modules in
// subdirectories (src/wasm, src/mcp, src/discovery, ...), and a flat readdir would
// see only the top level and report a missing test in a subdirectory as nothing.
// Names are compared as paths relative to src/ and dist/.
function testFiles(dir, suffix, prefix = '') {
  let entries;
  try {
    entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  } catch {
    return prefix === '' ? null : [];
  }
  const out = [];
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...testFiles(dir, suffix, rel));
    else if (entry.name.endsWith(suffix)) out.push(rel.slice(0, -suffix.length));
  }
  return out.sort();
}

const sources = testFiles(join(packageRoot, 'src'), '.test.ts');
if (sources === null || sources.length === 0) {
  process.stderr.write('check-tests-built: NoTestsInSource: src/ carries no *.test.ts at all.\n');
  process.exit(1);
}

const built = testFiles(join(packageRoot, 'dist'), '.test.js');
const missing = built === null ? sources : sources.filter((name) => !built.includes(name));
if (missing.length > 0) {
  process.stderr.write(
    `check-tests-built: TestsNotBuilt: ${missing.length} of ${sources.length} test files did not reach dist/: ` +
      `${missing.join(', ')}.\n` +
      '  node --test exits 0 on a glob that matches nothing, so running the suite now would\n' +
      '  report success having executed nothing. If dist/ was removed by hand, remove\n' +
      '  tsconfig.tsbuildinfo too -- tsc -b emits nothing while it believes it is up to date.\n',
  );
  process.exit(1);
}

process.stderr.write(`check-tests-built: ${sources.length} test files built\n`);
