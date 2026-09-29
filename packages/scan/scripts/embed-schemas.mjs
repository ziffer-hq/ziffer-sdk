#!/usr/bin/env node
/**
 * ACP-436: embed the engine's bundle schemas into src/generated/schema-source.ts.
 *
 * WHY EMBED AND NOT READ AT RUN TIME. The scan runs from an npm tarball with no
 * engine checkout beside it, and it validates every member it generates BEFORE it
 * writes anything. The grammar it validates against must therefore travel inside
 * the package. It is copied VERBATIM, as the file's own text, with the sha256 of
 * those bytes and the engine commit they came from, so a test can recompute the
 * hash over the embedded text and a reader can compare it with the engine at that
 * commit. The output is gitignored and regenerated: a committed copy would be a
 * second definition of the bundle grammar, and the one that drifts is the one
 * nobody regenerates.
 *
 * WHICH FILES. The twelve `spec/schemas/bundle/*.schema.json`, plus every schema
 * they reach through a cross-file `$ref`, followed transitively. That is not a
 * widening of the brief: `adapters.schema.json` keys its map by
 * `https://acp.spec/schemas/wire/proposal.schema.json#/$defs/schema_id`, so the
 * twelve alone do not compile, and a validator that silently dropped the ref
 * would accept adapter keys the engine's own pattern refuses.
 *
 * WHICH ENGINE. `ZIFFER_ENGINE_CHECKOUT` if set; otherwise cargo's git checkout of
 * the pinned commit. The pin AND the checkout lookup come from
 * ../../types/scripts/engine-pin.mjs (`enginePin`, `engineCheckout`: one
 * derivation each, imported, the same two scripts/vendor-wasm.mjs uses). The
 * checkout's HEAD must equal the pin (`EngineCheckoutNotAtPin`).
 *
 * THE PB-10 CLASS LIST. Read from the engine's loader, `ALERT_CLASSES` in
 * crates/acp-bundle/src/verify.rs -- the list `bundle_verify` actually enforces --
 * and cross-checked against the class enumeration in alert_targets.schema.json's
 * own text. The two must name the same set or this halts (`AlertClassesSplit`):
 * a generator that believed one of them while the loader enforced the other would
 * produce a bundle the engine refuses, or one that silences a class.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { engineCheckout, enginePin, EnginePinError } from '../../types/scripts/engine-pin.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PKG, '..', '..');
const OUT = join(PKG, 'src', 'generated', 'schema-source.ts');
const ID_BASE = 'https://acp.spec/schemas/';
const BUNDLE_DIR = 'spec/schemas/bundle';
const VERIFY_RS = 'crates/acp-bundle/src/verify.rs';

function halt(name, detail) {
    process.stderr.write(`${name}: ${detail}\n`);
    process.exit(1);
}

let pin;
try {
    pin = enginePin(ROOT);
} catch (e) {
    if (e instanceof EnginePinError) halt(e.name, e.message);
    throw e;
}

let checkout;
try {
    checkout = engineCheckout(pin);
} catch (e) {
    if (e instanceof EnginePinError) halt(e.name, e.message);
    throw e;
}

// --- the schemas: the twelve, then the transitive closure of their cross-file refs
const bundleDir = join(checkout, BUNDLE_DIR);
if (!existsSync(bundleDir)) halt('EngineSchemasAbsent', `${bundleDir} does not exist`);
const twelve = readdirSync(bundleDir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((f) => `${BUNDLE_DIR}/${f}`);
if (twelve.length !== 12) {
    halt('BundleSchemaCountMoved', `${BUNDLE_DIR} holds ${twelve.length} schemas; this package generates twelve members`);
}

function refsOf(node, out) {
    if (Array.isArray(node)) node.forEach((n) => refsOf(n, out));
    else if (node !== null && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            if (k === '$ref' && typeof v === 'string' && v.startsWith(ID_BASE)) out.add(v.split('#')[0]);
            else refsOf(v, out);
        }
    }
    return out;
}

const embedded = new Map(); // path -> { text, sha256, id, bundle }
const queue = [...twelve];
while (queue.length > 0) {
    const path = queue.shift();
    if (embedded.has(path)) continue;
    const abs = join(checkout, path);
    if (!existsSync(abs)) halt('SchemaRefUnresolved', `${path} is referenced but absent at ${pin}`);
    const text = readFileSync(abs, 'utf8');
    const doc = JSON.parse(text);
    const expectedId = ID_BASE + path.slice('spec/schemas/'.length);
    if (doc.$id !== expectedId) halt('SchemaIdMismatch', `${path} declares $id ${doc.$id}; its path says ${expectedId}`);
    embedded.set(path, {
        path,
        sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
        bundle: twelve.includes(path),
        text,
    });
    for (const ref of refsOf(doc, new Set())) queue.push('spec/schemas/' + ref.slice(ID_BASE.length));
}

// --- the PB-10 class list, from the loader, cross-checked against the schema's text
const verifyRs = readFileSync(join(checkout, VERIFY_RS), 'utf8');
const constMatch = /pub const ALERT_CLASSES: \[&str; (\d+)\] = \[([\s\S]*?)\];/.exec(verifyRs);
if (!constMatch) halt('AlertClassesUnreadable', `${VERIFY_RS} has no \`pub const ALERT_CLASSES: [&str; N] = [...]\``);
const loaderClasses = [...constMatch[2].replace(/\/\/[^\n]*/g, '').matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
if (loaderClasses.length !== Number(constMatch[1])) {
    halt('AlertClassesUnreadable', `${VERIFY_RS} declares ${constMatch[1]} classes and ${loaderClasses.length} were read`);
}
const alertSchema = JSON.parse(embedded.get(`${BUNDLE_DIR}/alert_targets.schema.json`).text);
const described = alertSchema.properties?.alert_targets?.description ?? '';
const listMatch = /enumerates \(([A-Z_, ]+)\)/.exec(described);
if (!listMatch) halt('AlertClassesUnreadable', 'alert_targets.schema.json no longer enumerates the PB-10 classes in its text');
const schemaClasses = listMatch[1].split(',').map((s) => s.trim());
const a = [...loaderClasses].sort().join(',');
const b = [...schemaClasses].sort().join(',');
if (a !== b) halt('AlertClassesSplit', `the loader enforces [${a}] and the schema describes [${b}]`);

// --- emit
const entries = [...embedded.values()]
    .map(
        (e) =>
            `  {\n    path: ${JSON.stringify(e.path)},\n    sha256: ${JSON.stringify(e.sha256)},\n` +
            `    bundle: ${e.bundle},\n    text: ${JSON.stringify(e.text)},\n  },`,
    )
    .join('\n');
const ts = `// GENERATED by scripts/embed-schemas.mjs from the engine at ${pin}. Do not edit; gitignored.
// Each \`text\` is the schema file's bytes verbatim; \`sha256\` is over those bytes.

export interface EmbeddedSchema {
  /** The file's path in the engine repository. */
  readonly path: string;
  readonly sha256: string;
  /** One of the twelve bundle-member schemas (false: reached only through a \`$ref\`). */
  readonly bundle: boolean;
  readonly text: string;
}

export const ENGINE_COMMIT = ${JSON.stringify(pin)};

export const SCHEMAS: readonly EmbeddedSchema[] = [
${entries}
];

/** PB-10's classes as the engine's loader enforces them (${VERIFY_RS}), in the loader's order. */
export const ALERT_CLASSES: readonly string[] = ${JSON.stringify(loaderClasses)};
export const ALERT_CLASSES_SOURCE = ${JSON.stringify(`${VERIFY_RS} @ ${pin}`)};
`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, ts);
process.stdout.write(
    `schemas embedded: ${twelve.length} bundle + ${embedded.size - twelve.length} referenced, ` +
        `${loaderClasses.length} alert classes @ ${pin.slice(0, 8)} -> ${OUT.slice(ROOT.length + 1)}\n`,
);
