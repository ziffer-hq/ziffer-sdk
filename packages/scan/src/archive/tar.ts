/**
 * A POSIX ustar archive, gzipped, with no dependency but `node:zlib` (ACP-443).
 *
 * The review page asks for one attachment: the policy folder, the report and
 * the JSON document in one file. A dependency for that would be one more
 * package this tool ships to every machine it scans; the format is a 512-byte
 * header per member, small enough to write here and to check with the system
 * `tar` (archive.test.ts does).
 *
 * DETERMINISTIC. Two runs over the same inputs produce the same bytes: members
 * are sorted by path, every parent directory gets its own entry, the mtime of
 * every entry is the one the caller passes (the scan date, never the clock),
 * uid and gid are 0 with no user or group name, modes are 0644 for a file and
 * 0755 for a directory, and the gzip header carries no name and no time. A
 * reviewer who re-runs the scan on the same machine state can compare hashes.
 */

import { gzipSync } from 'node:zlib';

export class ArchivePathInvalid extends Error {
  override readonly name = 'ArchivePathInvalid';
}

export interface ArchiveEntry {
  /** Relative, `/`-separated, no `.` or `..` segment, no leading `/`. */
  path: string;
  data: string | Uint8Array;
}

const BLOCK = 512;
const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function checkPath(path: string): void {
  const segments = path.split('/');
  const bad =
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\u0000') ||
    segments.some((s) => s === '' || s === '.' || s === '..');
  if (bad) throw new ArchivePathInvalid(`"${path}" is not a relative archive path`);
}

/** `value` as `width - 1` octal digits and a NUL, the ustar numeric field. */
function octal(value: number, width: number): string {
  const digits = value.toString(8);
  if (digits.length > width - 1) throw new ArchivePathInvalid(`${value} does not fit a ${width}-byte field`);
  return `${digits.padStart(width - 1, '0')}\u0000`;
}

/** ustar keeps 100 bytes of name and 155 of prefix, split at a `/`. */
function splitName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  for (let i = name.lastIndexOf('/'); i > 0; i = name.lastIndexOf('/', i - 1)) {
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return { name: rest, prefix };
  }
  throw new ArchivePathInvalid(`"${name}" is too long for a ustar header`);
}

function header(path: string, size: number, mode: number, type: '0' | '5', mtime: number): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { name, prefix } = splitName(path);
  const put = (text: string, offset: number): void => {
    h.write(text, offset, 'utf8');
  };
  put(name, 0);
  put(octal(mode, 8), 100);
  put(octal(0, 8), 108); // uid
  put(octal(0, 8), 116); // gid
  put(octal(size, 12), 124);
  put(octal(mtime, 12), 136);
  put('        ', 148); // checksum, as spaces while it is summed
  put(type, 156);
  put('ustar\u0000', 257);
  put('00', 263);
  put(prefix, 345);
  let sum = 0;
  for (const byte of h) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148);
  return h;
}

function pad(size: number): Buffer {
  const rest = size % BLOCK;
  return Buffer.alloc(rest === 0 ? 0 : BLOCK - rest);
}

/** The uncompressed archive. Exported for the tests; callers want `tarGz`. */
export function tar(entries: readonly ArchiveEntry[], mtime: Date): Buffer {
  const seconds = Math.floor(mtime.getTime() / 1000);
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  for (const e of entries) {
    checkPath(e.path);
    if (files.has(e.path)) throw new ArchivePathInvalid(`"${e.path}" is named twice`);
    files.set(e.path, typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data));
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  for (const d of dirs) {
    if (files.has(d.slice(0, -1))) throw new ArchivePathInvalid(`"${d.slice(0, -1)}" is both a file and a directory`);
  }
  const names = [...files.keys(), ...dirs].sort(cmp);
  const blocks: Buffer[] = [];
  for (const n of names) {
    const data = files.get(n);
    if (data === undefined) {
      blocks.push(header(n, 0, DIR_MODE, '5', seconds));
      continue;
    }
    blocks.push(header(n, data.length, FILE_MODE, '0', seconds), data, pad(data.length));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

/** The archive, gzipped. The gzip header carries no file name and no time. */
export function tarGz(entries: readonly ArchiveEntry[], mtime: Date): Buffer {
  return gzipSync(tar(entries, mtime), { level: 9 });
}
