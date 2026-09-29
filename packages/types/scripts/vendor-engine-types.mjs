/**
 * ACP-214: materialise the engine's wire types into src/ from the pinned commit.
 *
 * WHY A BUILD-TIME COPY AND WHY IT IS NOT A FORK. The engine repository's rule
 * is "never fork — import them", and `sdk/python/build.sh` carries the argument
 * for the Python half at length. The same argument holds here: the COMMITTED
 * source of this package is the packaging only, the engine's generated types are
 * copied in VERBATIM at build time from a tree asserted to be at the pin, and
 * the copy is regenerated on every build so there is no divergent lineage to
 * drift. A committed copy would be a second definition of the wire format, and
 * two definitions of one object is the encoding-split defect at the source
 * level -- the thing `spec/schemas` being the only normative source exists to
 * prevent.
 *
 * WHY THE PIN IS RECOMPUTED AND NOT READ. RES-8: a verifier never accepts a
 * derived security value from the party it is verifying. Applied here, the
 * party is the build, and the value is "which engine commit are these types".
 * There is exactly ONE authority for the pin in this repository -- the `rev` on
 * the engine git dependency in Cargo.toml, which is what tools/guard.sh reads
 * and calls "the pinned commit". Everything below is derived from that:
 *
 *   1. Cargo.toml's rev is read. Absent or malformed => halt.
 *   2. pnpm-lock.yaml's `resolution: {commit: ...}` for the @acp/types git
 *      entry must equal it. This is the RESOLVER'S OWN RECORD of the commit it
 *      actually fetched, not a second declaration of intent, so it is evidence
 *      about the bytes on disk rather than a claim beside them.
 *   3. Exactly one @acp/types directory may exist in pnpm's virtual store.
 *      Zero means `pnpm install` has not run; more than one means two pins are
 *      installed at once, and picking either would be this script choosing
 *      which engine the published package wraps. Both halt.
 *
 * What that chain does NOT prove is that the fetched tree's CONTENT is what the
 * engine has at that commit -- pnpm's integrity record covers the fetch, and no
 * hash of the engine's packages/acp-types is pinned here. Verifying that needs
 * the engine's signed manifest, which tools/guard.sh checks at the same commit
 * on every run. Stated rather than implied, because a chain is only as strong
 * as the link nobody wrote down.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enginePin, EnginePinError } from './engine-pin.mjs';
import { exitIfPrebuilt } from './prebuilt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const ROOT = resolve(PKG, '..', '..');
const DEST = join(PKG, 'src');

// ACP-483: in the public source tree src/ is committed and verified, not vendored.
exitIfPrebuilt(ROOT, 'packages/types', 'vendor-engine-types');

/** Every refusal is named, and the name is the finding. A build that fails with
 *  a stack trace over a missing directory tells a reader to look at this file;
 *  a build that fails with `EngineTypesAbsent` tells them to run pnpm install. */
function halt(name, detail) {
    process.stderr.write(`${name}: ${detail}\n`);
    process.exit(1);
}

// --- 1 + 2. the pin, from its one authority, confirmed by the resolver -------
// Moved to ./engine-pin.mjs (ACP-440) so packages/scan's wasm vendoring imports
// this derivation instead of writing a second one. Same steps, same names.
let pin;
try {
    pin = enginePin(ROOT);
} catch (e) {
    if (e instanceof EnginePinError) halt(e.name, e.message);
    throw e;
}

// --- 3. the tree on disk ----------------------------------------------------
// pnpm's virtual store, not a `require.resolve` through a declared dependency:
// this package deliberately declares no @acp/types dependency, because
// `pnpm pack` keeps devDependencies in the published package.json (measured, see
// the comment in package.json) and a git+ URL there would publish the private
// engine repository's address. The store is read the way
// tools/check-schemas-at-pin.py reads cargo's git checkout — an internal path,
// used because it is where the pinned bytes actually are, with a named refusal
// for every way of not finding exactly one.
const STORE = join(ROOT, 'node_modules', '.pnpm');
if (!existsSync(STORE)) {
    halt('EngineTypesAbsent', `${STORE} does not exist — run pnpm install`);
}
const candidates = readdirSync(STORE)
    .filter((d) => d.startsWith('@acp+types@'))
    .map((d) => join(STORE, d, 'node_modules', '@acp', 'types'))
    .filter((d) => existsSync(join(d, 'src')));
if (candidates.length === 0) {
    halt('EngineTypesAbsent', `no @acp/types checkout under ${STORE} — run pnpm install`);
}
if (candidates.length > 1) {
    halt(
        'EngineTypesAmbiguous',
        `${candidates.length} @acp/types checkouts are installed. Choosing one here would be ` +
            'this script deciding which engine the published package wraps. Prune the store ' +
            '(rm -rf node_modules && pnpm install) so exactly one pin is present.',
    );
}
const src = join(candidates[0], 'src');

// The engine's own package.json is read only to confirm this is the package we
// think it is. A directory named @acp/types that is not @acp/types is the
// ACP-207 shape (a key file that is not a key), and it is cheap to refuse.
const require_ = createRequire(import.meta.url);
const enginePkg = require_(join(candidates[0], 'package.json'));
if (enginePkg.name !== '@acp/types') {
    halt('EngineTypesNotTheTypes', `${candidates[0]}/package.json names '${enginePkg.name}', not '@acp/types'`);
}

// --- 4. copy, verbatim, stamped --------------------------------------------
const sources = readdirSync(src).filter((f) => f.endsWith('.ts')).sort();
if (sources.length === 0) {
    halt('EngineTypesEmpty', `${src} holds no .ts file — the engine's packages/acp-types/src moved`);
}
if (!sources.includes('index.ts')) {
    halt(
        'EngineTypesNoEntry',
        `${src} has no index.ts, so this package's main would point at nothing: [${sources.join(', ')}]`,
    );
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const f of sources) {
    // Header-stamped with the rev so a copy found on disk names its own
    // provenance instead of relying on whoever ran the build to remember
    // (sdk/python/build.sh does the same, for the same reason). A comment
    // block above the first line cannot change what TypeScript compiles.
    const body = readFileSync(join(src, f), 'utf8');
    writeFileSync(
        join(DEST, f),
        `// @ziffer-io/types build-time copy — DO NOT EDIT.\n` +
            `// Regenerated by packages/types/scripts/vendor-engine-types.mjs on every build.\n` +
            `// source: packages/acp-types/src/${f} @ ${pin} (the engine pin in Cargo.toml)\n` +
            body,
        'utf8',
    );
}

process.stdout.write(`engine wire types vendored: ${sources.join(', ')} @ ${pin.slice(0, 8)} -> packages/types/src/\n`);
