/**
 * ACP-483: the one place a generator learns it is running in the PUBLIC source
 * tree, where its inputs do not exist and its output is committed instead.
 *
 * WHY THIS EXISTS. Four build steps in these packages generate a file from
 * something outside the package: the engine's wire types and WebAssembly module
 * (from the pinned engine checkout), the scanner's annex and schema tables (the
 * same), and the MCP server's guides, template and wire schemas (from this
 * repository's docs/, templates/ and a vendored schema tree). None of those
 * inputs is in the public repository `tools/publish-public.sh` composes -- most
 * are private -- so in that tree each generated file is COMMITTED, and
 * `PREBUILT.json` at the tree's root lists every one with its sha256.
 *
 * WHAT THE SIGNAL IS, AND WHY IT IS NOT "THE INPUT IS MISSING". A generator that
 * fell back to a committed copy whenever its input was absent would, in this
 * repository, turn a broken engine checkout into a build that silently used
 * whatever copy lay around. So the signal is the presence of PREBUILT.json, a
 * file this repository never tracks (tools/publish-public.sh refuses to compose
 * from a tree that tracks one), and in its presence every listed file is
 * VERIFIED against its hash before the build goes on: a hand edit to a generated
 * file in the public repository stops its build by name (`PrebuiltMismatch`).
 *
 * Absent => `null`, and the caller regenerates exactly as before.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PREBUILT_FILE = 'PREBUILT.json';

export class PrebuiltError extends Error {
    constructor(name, message) {
        super(message);
        this.name = name;
    }
}

function refuse(name, detail) {
    throw new PrebuiltError(name, detail);
}

/**
 * `null` in this repository. In the public tree: the entries of PREBUILT.json
 * whose `package` is `pkg` (e.g. 'packages/scan'), each verified on disk, and
 * each `copy` performed -- a copy is a committed file placed where the build
 * expects it (the engine module under dist/, which is build output there).
 */
export function prebuilt(root, pkg) {
    const manifestPath = join(root, PREBUILT_FILE);
    if (!existsSync(manifestPath)) return null;
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        refuse('PrebuiltUnreadable', `${PREBUILT_FILE}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const entries = (manifest.files ?? []).filter((f) => f.package === pkg);
    if (entries.length === 0) {
        // A guarded generator with nothing listed means the composer missed a
        // package; building on would compile against no generated file at all.
        refuse('PrebuiltEmpty', `${PREBUILT_FILE} lists no generated file for ${pkg}`);
    }
    for (const entry of entries) {
        const abs = join(root, entry.path);
        if (!existsSync(abs)) refuse('PrebuiltAbsent', `${entry.path} is listed in ${PREBUILT_FILE} and is not in the tree`);
        const got = createHash('sha256').update(readFileSync(abs)).digest('hex');
        if (got !== entry.sha256) {
            refuse(
                'PrebuiltMismatch',
                `${entry.path} has sha256 ${got}; ${PREBUILT_FILE} says ${entry.sha256}. ` +
                    'A generated file was edited by hand: regenerate it in the private repository and republish.',
            );
        }
        if (entry.copy_to) {
            const dest = join(root, entry.copy_to);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(abs, dest);
        }
    }
    return { enginePin: manifest.engine_pin, entries };
}

/** The same, for a script: prints what was verified and exits 0, or halts by name. */
export function exitIfPrebuilt(root, pkg, label) {
    let found;
    try {
        found = prebuilt(root, pkg);
    } catch (e) {
        if (e instanceof PrebuiltError) {
            process.stderr.write(`${e.name}: ${e.message}\n`);
            process.exit(1);
        }
        throw e;
    }
    if (found === null) return;
    process.stdout.write(
        `${label}: ${found.entries.length} committed generated file(s) verified against ${PREBUILT_FILE} ` +
            `(engine ${String(found.enginePin).slice(0, 8)}); not regenerated -- their inputs are not in this tree\n`,
    );
    process.exit(0);
}
