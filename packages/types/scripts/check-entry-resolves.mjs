/**
 * ACP-214: the published entry point resolves to a built file that exports
 * something.
 *
 * WHY THIS TEST AND NOT A TYPE TEST. The defect it is written against is on the
 * record in tools/bump-pin.sh: v1.3.15's @acp/types carried no `prepare` script,
 * pnpm runs `prepare` and never `build` for a git dependency, so `main:
 * ./dist/index.js` pointed at a file that was never built -- and `pnpm install`
 * reported success the whole time. `pnpm -r typecheck` could not see it either,
 * because no .ts file in this repository imports the package (README.md, "the
 * @acp/types pin is wired but UNEXERCISED").
 *
 * That is the exact failure this package exists to make impossible for a
 * customer, so it is the thing asserted: import the entry point the package.json
 * publishes, from the built dist, and require at least one runtime export. Not a
 * hardcoded count -- a count is a claim that goes stale at the next codegen run
 * in the engine, and a test that fails when the engine legitimately adds an
 * accessor is a test that gets its expected value edited, which is the habit
 * this repository refuses.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));

let failures = 0;
function ok(msg) {
    process.stdout.write(`  OK   ${msg}\n`);
}
function bad(msg) {
    process.stdout.write(`  FAIL ${msg}\n`);
    failures += 1;
}

// The path is read out of package.json rather than written here twice: a test
// that hardcodes ./dist/index.js goes on passing after someone changes `main`.
const entry = join(PKG, pkg.main);
if (existsSync(entry)) {
    ok(`main (${pkg.main}) exists on disk`);
} else {
    bad(`main (${pkg.main}) does not exist — the build did not run, or it wrote elsewhere`);
}

const types = join(PKG, pkg.types);
if (existsSync(types) && readFileSync(types, 'utf8').length > 0) {
    ok(`types (${pkg.types}) exists and is non-empty`);
} else {
    bad(`types (${pkg.types}) is missing or empty — a consumer would get \`any\``);
}

if (failures === 0) {
    const mod = await import(entry);
    const exports_ = Object.keys(mod).filter((k) => k !== 'default');
    if (exports_.length > 0) {
        ok(`the entry point imports and exports ${exports_.length} runtime name(s)`);
    } else {
        bad('the entry point imports but exports no runtime name — types only, so `main` serves nothing');
    }
}

if (failures !== 0) {
    process.stderr.write(
        `\n${failures} check(s) failed: the tarball this package would publish does not resolve.\n`,
    );
    process.exit(1);
}
process.stdout.write('\nthe published entry point resolves to a built file with runtime exports.\n');
