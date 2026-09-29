#!/usr/bin/env node
/**
 * ACP-440: copy the engine's WebAssembly module into dist/acp_wasm.wasm.
 *
 * It copies; it never builds. Building the module needs cargo and the
 * wasm32-unknown-unknown target, and a package script that ran cargo would make
 * `pnpm build` of a Node package depend on a Rust toolchain in silence. When the
 * module is absent this refuses by name (`EngineWasmAbsent`) and prints the
 * cargo command, so the person reading the failure knows the one thing to run.
 *
 * FROM WHERE, IN ORDER.
 *
 * 1. `ZIFFER_SCAN_WASM`, when set: the module at THAT path is copied, and a path
 *    that names no file is refused (`EngineWasmAbsent`) -- never skipped, never
 *    fallen through to the pinned checkout, because the person named a module and
 *    a build that quietly packaged another one would ship an engine nobody chose.
 *    This path is NOT checked against the pin: it is whatever file was named, and
 *    the line this script prints says so.
 * 2. Otherwise the pinned engine checkout, `<checkout>/target/wasm32-unknown-unknown/
 *    release/acp_wasm.wasm`. The pin and the checkout lookup come from
 *    ../../types/scripts/engine-pin.mjs (`enginePin`, `engineCheckout`) -- the same
 *    derivation packages/types vendors the wire types by, imported rather than
 *    written a second time -- and the pin is checked against this package's own
 *    `ziffer.enginePin`, because that field is what the published package claims
 *    to wrap. The checkout's HEAD must equal the pin (`EngineCheckoutNotAtPin`).
 *
 * TODAY THE PINNED ENGINE COMMIT PREDATES THE acp-wasm CRATE, so step 2 has no
 * module to copy and every local build sets ZIFFER_SCAN_WASM to an engine
 * worktree's build of it. After the pin moves to a commit that carries the crate,
 * the default works and the variable is only an override.
 *
 * WHAT THIS DOES NOT PROVE. That the .wasm under target/ was built from the
 * checkout's current HEAD: cargo leaves a stale artifact in place across a
 * checkout. The pin check covers the tree, not the build. Stated, not implied.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { engineCheckout, enginePin, EnginePinError } from '../../types/scripts/engine-pin.mjs';
import { exitIfPrebuilt } from '../../types/scripts/prebuilt.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PKG, '..', '..');
const REL = join('target', 'wasm32-unknown-unknown', 'release', 'acp_wasm.wasm');
const DEST = join(PKG, 'dist', 'acp_wasm.wasm');

// ACP-483: in the public source tree the module is committed (the engine's
// source is not public) and PREBUILT.json's `copy_to` places it at DEST.
exitIfPrebuilt(ROOT, 'packages/scan', 'vendor-wasm');

function halt(name, detail) {
    process.stderr.write(`${name}: ${detail}\n`);
    process.exit(1);
}

function orHalt(fn) {
    try {
        return fn();
    } catch (e) {
        if (e instanceof EnginePinError) halt(e.name, e.message);
        throw e;
    }
}

const pin = orHalt(() => enginePin(ROOT));
const declared = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).ziffer?.enginePin;
if (declared !== pin) {
    halt('EnginePinMismatch', `packages/scan/package.json declares ziffer.enginePin ${declared}; the engine pin is ${pin}`);
}

const explicit = process.env.ZIFFER_SCAN_WASM;
let source;
let said;
if (explicit !== undefined && explicit !== '') {
    if (!existsSync(explicit)) halt('EngineWasmAbsent', `ZIFFER_SCAN_WASM=${explicit} names no file`);
    source = explicit;
    said = `engine module vendored from ZIFFER_SCAN_WASM (${explicit}; NOT checked against the pin ${pin.slice(0, 8)})`;
} else {
    const checkout = orHalt(() => engineCheckout(pin));
    source = join(checkout, REL);
    if (!existsSync(source)) {
        halt(
            'EngineWasmAbsent',
            `${source} does not exist. Build it in the engine checkout:\n` +
                `  rustup target add wasm32-unknown-unknown\n` +
                `  cargo build --manifest-path ${join(checkout, 'Cargo.toml')} -p acp-wasm --release --target wasm32-unknown-unknown\n` +
                'or set ZIFFER_SCAN_WASM to a built acp_wasm.wasm.',
        );
    }
    said = `engine module vendored: ${REL} @ ${pin.slice(0, 8)}`;
}

mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(source, DEST);
process.stdout.write(`${said} -> packages/scan/dist/acp_wasm.wasm\n`);
