#!/usr/bin/env node
/**
 * ACP-483: run a package's compiled tests -- the compiled file of every
 * src/**\/*.test.ts (ACP-485, below) -- with one difference, and only in the
 * PUBLIC source tree.
 *
 * WHY. Some test files compare a generated embed with its source, or read an
 * input that is not in the public repository `tools/publish-public.sh`
 * composes: the ZIFFER guides under docs/, the policy repository template, the
 * private services' Rust source, the Python SDK's manifest, the engine's
 * checkout. In the public tree those files cannot even import. They are listed,
 * each with the input it reads, in PREBUILT.json's `tests_not_run`, and this
 * runner leaves exactly those files out and SAYS so, file by file.
 *
 * WHAT KEEPS THIS FROM BEING A WAY TO SKIP TESTS. The signal is PREBUILT.json,
 * which this repository never tracks (tools/publish-public.sh refuses a tree
 * that does), so in this repository every file runs, as before. A listed file
 * that does not exist refuses (`TestListStale`): a list that names nothing is a
 * list nobody reconciles. And the composer runs every listed file on its own in
 * the public tree and refuses one that PASSES there (`ExclusionUnneeded`), so
 * the list holds exactly the files that need what the tree does not carry.
 *
 * WHICH FILES, AND WHY THEY ARE READ FROM src/ (ACP-485). `tsc -b` never
 * deletes what it once emitted: a test renamed or deleted in src/ leaves its
 * compiled copy in dist/, and a glob over dist/ runs it -- measured on
 * 2026-09-29, when a renamed fixture's old compiled test failed ten tests from
 * a dist/ nothing had rebuilt. So the list is every `src/**\/*.test.ts`, mapped
 * through the package's own rootDir/outDir to the file tsc writes for it; a
 * compiled test with no source behind it is NOT run, and is named on the way
 * past so a stale dist/ is visible rather than silently tolerated. A source
 * test whose compiled file is missing refuses (`TestNotBuilt`): a list that
 * names a file that did not build is a run that would skip it.
 *
 * Usage, from a package directory: node ../types/scripts/run-tests.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { PREBUILT_FILE } from './prebuilt.mjs';

const PKG = process.cwd();
const ROOT = resolve(PKG, '..', '..');
const pkgRel = relative(ROOT, PKG).split('\\').join('/');

function walk(dir, suffix) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p, suffix));
        else if (entry.name.endsWith(suffix)) out.push(p);
    }
    return out;
}

// The package's own rootDir and outDir: the one mapping from a source to the
// file tsc writes for it. No default is guessed -- a tsconfig without both is
// refused, because a guessed mapping is a second definition of the build.
const tsconfig = JSON.parse(readFileSync(join(PKG, 'tsconfig.json'), 'utf8'));
const rootDir = tsconfig.compilerOptions?.rootDir;
const outDir = tsconfig.compilerOptions?.outDir;
if (typeof rootDir !== 'string' || typeof outDir !== 'string') {
    process.stderr.write(`TsconfigUnmapped: ${pkgRel}/tsconfig.json declares no rootDir and outDir\n`);
    process.exit(1);
}
const src = resolve(PKG, rootDir);
const dist = resolve(PKG, outDir);
if (!existsSync(dist)) {
    process.stderr.write(`TestsNotBuilt: ${relative(ROOT, dist)} does not exist\n`);
    process.exit(1);
}
let files = walk(src, '.test.ts').map((f) => join(dist, relative(src, f)).replace(/\.ts$/, '.js')).sort();
const unbuilt = files.filter((f) => !existsSync(f));
if (unbuilt.length > 0) {
    for (const f of unbuilt) process.stderr.write(`TestNotBuilt: ${relative(ROOT, f)} has a source and was not compiled\n`);
    process.exit(1);
}
const wanted = new Set(files);
for (const f of walk(dist, '.test.js').sort()) {
    if (!wanted.has(f)) process.stdout.write(`# not run: ${relative(ROOT, f)} is a compiled test with no source in ${relative(ROOT, src)}/ (stale output; the package's clean script removes it)\n`);
}

const manifestPath = join(ROOT, PREBUILT_FILE);
if (existsSync(manifestPath)) {
    const listed = (JSON.parse(readFileSync(manifestPath, 'utf8')).tests_not_run ?? []).filter(
        (t) => t.path.startsWith(pkgRel + '/'),
    );
    for (const t of listed) {
        if (!existsSync(join(ROOT, t.path))) {
            process.stderr.write(`TestListStale: ${PREBUILT_FILE} lists ${t.path}, which does not exist\n`);
            process.exit(1);
        }
    }
    const skip = new Set(listed.map((t) => join(ROOT, t.path)));
    for (const t of listed) {
        process.stdout.write(`# not run in the public source tree: ${t.path} -- reads ${t.reads}\n`);
    }
    files = files.filter((f) => !skip.has(f));
}

if (files.length === 0) {
    process.stderr.write(`NoTests: no compiled test file under ${pkgRel}/dist\n`);
    process.exit(1);
}
// HOW MANY TEST FILES AT ONCE (ACP-483). `node --test` runs one process per
// file, as many at once as the machine has CPUs less one, and never asks how
// much memory there is. Measured 2026-09-29 in node:22-bookworm on a Docker VM
// with 8 CPUs and 2.9 GiB: seven scan test processes at once, the largest
// (dist/code/coverage.test.js, which reads every code fixture with both front
// ends) at 634 MB, filled memory and swap; the kernel killed that file after
// 1050 s and the run reported it as a failed test. Alone it passes in 32 s at
// 533 MB. So the count is also bounded by memory: one process per GiB of the
// machine's total, at least one. Where memory is not the limit (8 CPUs and
// 16 GiB, 4 CPUs and 16 GiB on a hosted runner) the count is exactly node's
// own default, so nothing changes there.
const GIB = 1024 ** 3;
const concurrency = Math.max(1, Math.min(availableParallelism() - 1, Math.floor(totalmem() / GIB)));
const r = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
