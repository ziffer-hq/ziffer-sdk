#!/usr/bin/env node
/**
 * ACP-483: pack one of the five npm packages so that packing it twice gives the
 * same bytes. Used by tools/release-npm.sh (the private gated build) and by the
 * public repository's release workflow, so that the tarball the public pipeline
 * publishes can be compared, hash for hash, with the one the private gate tested.
 *
 *   node tools/pack-npm.mjs <package-dir> <destination-dir>
 *   node tools/pack-npm.mjs --digest <tarball.tgz>
 *
 * The first form prints the tarball's path as its last line, as `pnpm pack`
 * does. The second prints the tarball's RELEASE DIGEST: the sha256 of the tar
 * archive inside the gzip, which is what release/expected-checksums.txt holds
 * and what the public release workflow compares (see "THE DIGEST" below).
 *
 * WHY NOT `pnpm pack` IN THE WORKSPACE, WHICH IS WHAT RAN UNTIL THIS. It is not
 * reproducible. Measured 2026-09-29 with pnpm 10.12.1: packing the MCP package
 * four times in a row from one unchanged tree gave three different tarballs.
 * pnpm rewrites each `workspace:*` dependency to the depended-on package's
 * version asynchronously and appends the rewritten entries to `dependencies` in
 * the order the lookups COMPLETE, so its scan and verify dependencies trade
 * places from one run to the next. Every other byte was identical (files,
 * order, the 1985 mtime pnpm stamps on every member). A package with one or no
 * workspace dependency cannot show it, which is why four of five looked stable.
 *
 * WHAT THIS DOES INSTEAD. The same rewrite, done here, synchronously, in the
 * manifest's own order, on a COPY of the package directory outside the
 * workspace -- then `pnpm pack` on the copy, where no `workspace:` specifier is
 * left for it to rewrite. The rewrite is the one pnpm documents: `workspace:*`
 * becomes the exact version, `workspace:^` and `workspace:~` the version with
 * that prefix; any other `workspace:` form halts by name rather than being
 * guessed at. The copy leaves out node_modules and nothing else; `files` in the
 * manifest still decides what is packed.
 *
 * AND THEN THIS WRITES THE ARCHIVE ITSELF (2026-09-29, measured in Docker). The
 * same public tree packed on the Mac and in node:22-bookworm gave five tarballs
 * with five different sha256s although every member had the same bytes. pnpm
 * decides WHAT is packed; everything else it left to the machine:
 *   - the gzip header's OS byte: 0x13 on the Mac, 0xff on Linux (Node's own
 *     zlib writes 0x13 on macOS and 0x03 on Linux: it is zlib's compiled-in
 *     OS_CODE, a property of the build, not of the data);
 *   - the tar headers' uid and gid: the packing user's (501/20) on the Mac,
 *     empty fields as root in the container;
 *   - the member order, in the one package with enough directories to show it:
 *     the order the file system lists a directory in (APFS sorts, ext4 and
 *     overlayfs do not).
 * So pnpm's tarball is now only read: its members are taken out and written
 * again in one canonical form -- bytewise-sorted paths, mode 0644 (0755 when
 * pnpm packed the file executable), npm's fixed 1985-10-26 mtime, uid and gid
 * 0, empty uname and gname, ustar headers, two zero blocks at the end -- and
 * gzipped with the header's mtime, XFL and OS bytes set here (0, 0, 0xff =
 * "unknown", RFC 1952). The tar is therefore byte-identical on every machine.
 *
 * THE DIGEST, AND WHY IT IS NOT THE .tgz's sha256. The deflate stream is still
 * zlib's, and zlib's output is not a function of its input alone: Node 22.16.0
 * bundles zlib 1.3.0.1 and 22.23.2 bundles 1.3.1 (both Chromium's fork, which
 * also picks CPU-specific code paths at run time). A comparison over the
 * compressed bytes would hold only on a machine that happens to match. The
 * release digest is therefore the sha256 of the UNCOMPRESSED tar: every path,
 * mode and content byte of every member, in canonical order, and nothing the
 * compressor chose. `--digest` refuses a tarball that is not in the canonical
 * form this file writes, so the digest cannot be computed over an archive that
 * a different tool produced and that merely unpacks to the same files.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

function halt(name, detail) {
    process.stderr.write(`${name}: ${detail}\n`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// The canonical archive.

const BLOCK = 512;
// npm's and pnpm's fixed member mtime, 1985-10-26T08:15:00Z: kept so that the
// archive's dates read exactly as every other npm tarball's do.
const MTIME = 499162500;
// Gzip header bytes this file owns: ID1 ID2 CM FLG, MTIME (4), XFL, OS.
const GZIP_HEADER = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff]);

function octal(n, width) {
    // width includes the terminating NUL
    const s = n.toString(8);
    if (s.length > width - 1) halt('FieldOverflow', `${n} does not fit a ${width}-byte tar field`);
    return s.padStart(width - 1, '0') + '\0';
}

function readString(buf, at, len) {
    const end = buf.indexOf(0, at);
    return buf.toString('utf8', at, end === -1 || end > at + len ? at + len : end);
}

function readOctal(buf, at, len) {
    const s = readString(buf, at, len).trim();
    if (s === '') return 0;
    if (!/^[0-7]+$/.test(s)) halt('TarUnreadable', `numeric field '${s}' is not octal`);
    return parseInt(s, 8);
}

/** Every regular file in a tar archive: [{ path, mode, data }]. Directory
 * entries are dropped (npm needs none); pax and GNU long-name records are
 * honoured; any other member type halts by name. */
function readTar(tar) {
    const out = [];
    let at = 0;
    let longName = null;
    let paxPath = null;
    while (at + BLOCK <= tar.length) {
        const h = tar.subarray(at, at + BLOCK);
        if (h.every((b) => b === 0)) break;
        const size = readOctal(h, 124, 12);
        const type = String.fromCharCode(h[156] || 0x30);
        const dataAt = at + BLOCK;
        const data = tar.subarray(dataAt, dataAt + size);
        if (data.length !== size) halt('TarUnreadable', 'a member runs past the end of the archive');
        at = dataAt + Math.ceil(size / BLOCK) * BLOCK;
        if (type === 'L') { longName = data.toString('utf8').replace(/\0+$/, ''); continue; }
        if (type === 'x') {
            for (const rec of data.toString('utf8').split('\n')) {
                const m = /^\d+ path=(.*)$/.exec(rec);
                if (m) paxPath = m[1];
            }
            continue;
        }
        if (type === 'g') continue;
        const prefix = readString(h, 345, 155);
        const name = readString(h, 0, 100);
        const path = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
        longName = null;
        paxPath = null;
        if (type === '5') continue;
        if (type !== '0' && type !== '\0') halt('MemberTypeUnsupported', `${path} is tar type '${type}'; a package carries regular files only`);
        out.push({ path, mode: readOctal(h, 100, 8), data: Buffer.from(data) });
    }
    return out;
}

function header(path, mode, size) {
    const h = Buffer.alloc(BLOCK);
    const bytes = Buffer.from(path, 'utf8');
    let name = bytes;
    let prefix = Buffer.alloc(0);
    if (bytes.length > 100) {
        // ustar: split at a '/' so the prefix is at most 155 bytes and the name at most 100.
        let cut = -1;
        for (let i = bytes.length - 1; i > 0; i--) {
            if (bytes[i] === 0x2f && i <= 155 && bytes.length - i - 1 <= 100) { cut = i; break; }
        }
        if (cut === -1) halt('PathTooLong', `${path} does not fit a ustar header`);
        prefix = bytes.subarray(0, cut);
        name = bytes.subarray(cut + 1);
    }
    name.copy(h, 0);
    h.write(octal(mode, 8), 100, 'ascii');
    h.write(octal(0, 8), 108, 'ascii');
    h.write(octal(0, 8), 116, 'ascii');
    h.write(octal(size, 12), 124, 'ascii');
    h.write(octal(MTIME, 12), 136, 'ascii');
    h.write('        ', 148, 'ascii');
    h[156] = 0x30;
    h.write('ustar\0', 257, 'ascii');
    h.write('00', 263, 'ascii');
    prefix.copy(h, 345);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(octal(sum, 7) + ' ', 148, 'ascii');
    return h;
}

/** The canonical tar of a member list: bytewise-sorted paths, fixed attributes. */
function writeTar(members) {
    const sorted = [...members].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
    const parts = [];
    let prev = null;
    for (const m of sorted) {
        if (!m.path.startsWith('package/')) halt('MemberOutsidePackage', `${m.path} is not under package/`);
        if (m.path === prev) halt('MemberDuplicated', `${m.path} appears twice`);
        prev = m.path;
        parts.push(header(m.path, (m.mode & 0o111) !== 0 ? 0o755 : 0o644, m.data.length), m.data);
        const pad = (BLOCK - (m.data.length % BLOCK)) % BLOCK;
        if (pad) parts.push(Buffer.alloc(pad));
    }
    parts.push(Buffer.alloc(2 * BLOCK));
    return Buffer.concat(parts);
}

function writeGzip(tar) {
    const gz = gzipSync(tar, { level: 9 });
    if (gz[3] !== 0) halt('GzipHeaderUnexpected', `zlib set FLG=${gz[3]}; this file owns a header with no optional fields`);
    GZIP_HEADER.copy(gz, 0);
    return gz;
}

/** The release digest of a tarball this file wrote; halts on any other. */
function digest(tgzPath) {
    const gz = readFileSync(tgzPath);
    if (!gz.subarray(0, 10).equals(GZIP_HEADER)) {
        halt('TarballNotCanonical', `${tgzPath}: gzip header ${gz.subarray(0, 10).toString('hex')} is not ${GZIP_HEADER.toString('hex')} -- not written by tools/pack-npm.mjs`);
    }
    let tar;
    try {
        tar = gunzipSync(gz);
    } catch (e) {
        halt('TarballNotCanonical', `${tgzPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!writeTar(readTar(tar)).equals(tar)) {
        halt('TarballNotCanonical', `${tgzPath}: the tar inside is not in the canonical form (order, attributes or padding) -- not written by tools/pack-npm.mjs`);
    }
    return createHash('sha256').update(tar).digest('hex');
}

if (process.argv[2] === '--digest') {
    const t = process.argv[3];
    if (!t || process.argv.length !== 4) halt('Usage', 'node tools/pack-npm.mjs --digest <tarball.tgz>');
    if (!existsSync(t)) halt('TarballAbsent', `${t} does not exist`);
    process.stdout.write(`${digest(t)}\n`);
    process.exit(0);
}

const [pkgArg, destArg] = process.argv.slice(2);
if (!pkgArg || !destArg) halt('Usage', 'node tools/pack-npm.mjs <package-dir> <destination-dir>');
const pkgDir = resolve(pkgArg);
const dest = resolve(destArg);
const manifestPath = join(pkgDir, 'package.json');
if (!existsSync(manifestPath)) halt('ManifestAbsent', `${manifestPath} does not exist`);

// The workspace's packages, by name, from the directory the package sits in.
const siblings = new Map();
const packagesDir = resolve(pkgDir, '..');
for (const d of readdirSync(packagesDir)) {
    const p = join(packagesDir, d, 'package.json');
    if (!existsSync(p)) continue;
    const m = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof m.name === 'string') siblings.set(m.name, m.version);
}

let text = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(text);
for (const block of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[block] ?? {})) {
        if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
        const version = siblings.get(name);
        if (version === undefined) halt('WorkspacePackageAbsent', `${name} (${block}) is not a package beside ${basename(pkgDir)}`);
        const range = spec.slice('workspace:'.length);
        const to = range === '*' ? version : range === '^' ? `^${version}` : range === '~' ? `~${version}` : null;
        if (to === null) halt('WorkspaceRangeUnsupported', `${name}: "${spec}" -- only workspace:*, ^ and ~ are rewritten here`);
        const from = `"${name}": "${spec}"`;
        if (text.split(from).length !== 2) halt('ManifestShapeUnexpected', `${from} does not appear exactly once in ${manifestPath}`);
        text = text.replace(from, `"${name}": "${to}"`);
    }
}
if (text.includes('"workspace:')) halt('WorkspaceLeft', `a workspace: specifier survived the rewrite in ${manifestPath}`);

// The copy sits outside the workspace, so nothing tells corepack which pnpm to
// run there, and corepack then runs the newest it knows of. Measured 2026-09-29
// in node:22-bookworm with Node 22.16.0 (the release workflow's pin, corepack
// 0.32.0): that was pnpm 12.6.0, whose layout that corepack cannot start --
// `Cannot find module .../pnpm/12.6.0/bin/pnpm.cjs`, every pack failed. With
// Node 22.23.2 it happened to work. So the copy's parent directory carries the
// workspace root's own `packageManager` pin, which corepack finds by walking
// up; the package's own manifest, which is what gets packed, is not touched.
const rootManifestPath = resolve(pkgDir, '..', '..', 'package.json');
const packageManager = existsSync(rootManifestPath) ? JSON.parse(readFileSync(rootManifestPath, 'utf8')).packageManager : undefined;
if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) {
    halt('PackageManagerUnpinned', `${rootManifestPath} names no pnpm@<version> packageManager; the pack would run whichever pnpm corepack picks`);
}

const work = mkdtempSync(join(tmpdir(), 'pack-npm-'));
const copy = join(work, basename(pkgDir));
try {
    writeFileSync(join(work, 'package.json'), `${JSON.stringify({ private: true, packageManager })}\n`);
    cpSync(pkgDir, copy, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes('node_modules') });
    writeFileSync(join(copy, 'package.json'), text);
    const raw = join(work, 'raw');
    mkdirSync(raw);
    const r = spawnSync('pnpm', ['pack', '--pack-destination', raw], { cwd: copy, encoding: 'utf8' });
    if (r.status !== 0) halt('PackFailed', (r.stdout + r.stderr).trim().split('\n').slice(-8).join('\n'));
    const packed = r.stdout.trim().split('\n').pop().trim();
    if (!existsSync(packed)) halt('PackFailed', `pnpm pack printed '${packed}', which is not a file`);
    // pnpm decided what is in the package; this writes how it is archived.
    const members = readTar(gunzipSync(readFileSync(packed)));
    if (!members.some((m) => m.path === 'package/package.json')) halt('PackFailed', `${packed} has no package/package.json`);
    mkdirSync(dest, { recursive: true });
    const out = join(dest, basename(packed));
    writeFileSync(out, writeGzip(writeTar(members)));
    process.stdout.write(`${out}\n`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
