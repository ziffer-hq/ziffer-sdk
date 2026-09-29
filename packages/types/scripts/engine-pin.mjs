/**
 * The engine pin, derived from its ONE authority and checked against the
 * resolver's record -- steps 1 and 2 of vendor-engine-types.mjs, moved here
 * unchanged so a second vendoring script (packages/scan/scripts/vendor-wasm.mjs,
 * ACP-440) imports the derivation rather than writing a second one. The
 * argument for why the pin is recomputed and not read is in
 * vendor-engine-types.mjs's header and still applies word for word.
 *
 * Refusals are thrown as `EnginePinError` carrying the same names the script
 * halted with; each caller halts with `name: message`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class EnginePinError extends Error {
    constructor(name, message) {
        super(message);
        this.name = name;
    }
}

function halt(name, detail) {
    throw new EnginePinError(name, detail);
}

/** The 40-hex engine commit, from `<root>/Cargo.toml`, confirmed by `<root>/pnpm-lock.yaml`. */
export function enginePin(root) {
    // --- 1. the pin, from its one authority ------------------------------------
    const cargo = readFileSync(join(root, 'Cargo.toml'), 'utf8');
    const revMatch = /acp-core = \{[^}]*rev = "([0-9a-f]{40})"/.exec(cargo);
    if (!revMatch) {
        halt(
            'EnginePinUnreadable',
            'Cargo.toml has no `acp-core = { git = ..., rev = "<40 hex>" }` — the pin is a commit ' +
                'and this is where it lives (docs/plans/zero-to-one.md §2c row 11)',
        );
    }
    const pin = revMatch[1];

    // --- 2. the resolver's own record of what it fetched ------------------------
    const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
    const lockCommits = new Set(
        [...lock.matchAll(/resolution: \{commit: ([0-9a-f]{40}), path: \/packages\/acp-types,/g)].map((m) => m[1]),
    );
    if (lockCommits.size === 0) {
        halt(
            'EnginePinUnresolved',
            'pnpm-lock.yaml records no resolved commit for @acp/types. Either no workspace package ' +
                'declares the engine git dependency any more — in which case this package has no ' +
                'source and tools/guard.sh\'s cross-pin check has gone vacuous with it — or the ' +
                'lockfile is stale. Run pnpm install.',
        );
    }
    if (lockCommits.size > 1) {
        halt(
            'EnginePinSplit',
            `pnpm-lock.yaml resolved @acp/types at ${lockCommits.size} different commits ` +
                `(${[...lockCommits].join(', ')}). Two pins are two wire formats.`,
        );
    }
    const resolved = [...lockCommits][0];
    if (resolved !== pin) {
        halt(
            'EnginePinMismatch',
            `Cargo.toml pins ${pin} but pnpm resolved @acp/types at ${resolved}. ` +
                'Run ./tools/bump-pin.sh <sha> rather than editing either by hand.',
        );
    }
    return pin;
}

/**
 * The whole engine tree at `pin`, for a script that reads files pnpm's copy does
 * not hold (packages/scan's schemas and wasm module; ACP-440 moved this here from
 * the two copies in packages/scan/scripts). `ZIFFER_ENGINE_CHECKOUT` if set;
 * otherwise cargo's own git checkout of the pinned commit,
 * `$CARGO_HOME/git/checkouts/agent-control-plane-<hash>/<rev7>` -- NOT the tree
 * pnpm materialises for @acp/types, which is the `packages/acp-types`
 * subdirectory alone. Either way the tree's HEAD must equal the pin
 * (`EngineCheckoutNotAtPin`). Two cargo checkouts of one commit halt
 * (`EngineCheckoutAmbiguous`): choosing one would be this function deciding which
 * engine a package wraps.
 */
export function engineCheckout(pin, env = process.env) {
    let checkout = env.ZIFFER_ENGINE_CHECKOUT;
    if (!checkout) {
        const base = join(env.CARGO_HOME ?? join(homedir(), '.cargo'), 'git', 'checkouts');
        const short = pin.slice(0, 7);
        const hits = existsSync(base)
            ? readdirSync(base)
                  .filter((d) => d.startsWith('agent-control-plane-'))
                  .map((d) => join(base, d, short))
                  .filter((d) => existsSync(d))
            : [];
        if (hits.length === 0) {
            halt(
                'EngineCheckoutAbsent',
                `no cargo checkout of the engine at ${short} under ${base}. Run \`cargo fetch\` at the ` +
                    'repository root, or set ZIFFER_ENGINE_CHECKOUT to an engine checkout at the pin.',
            );
        }
        if (hits.length > 1) {
            halt(
                'EngineCheckoutAmbiguous',
                `${hits.length} cargo checkouts of ${short}: ${hits.join(', ')}. Choosing one here would be ` +
                    'this script deciding which engine the package wraps; set ZIFFER_ENGINE_CHECKOUT.',
            );
        }
        checkout = hits[0];
    }
    let head;
    try {
        head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        halt('EngineCheckoutUnreadable', `${checkout} is not a git checkout (git rev-parse HEAD failed)`);
    }
    if (head !== pin) halt('EngineCheckoutNotAtPin', `${checkout} is at ${head}; the engine pin is ${pin}`);
    return checkout;
}
