/**
 * The archive writer (ACP-443), checked by the system `tar`, not by a reader
 * written beside it: a reader here would agree with the writer by construction.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { ArchivePathInvalid, type ArchiveEntry, tar, tarGz } from './tar.js';

const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-tar-'));
after(() => rmSync(WORK, { recursive: true, force: true }));

const MTIME = new Date('2026-09-25T12:00:00Z');
const LONG = `ziffer-policy/${'d'.repeat(90)}/${'f'.repeat(60)}.json`;
const ENTRIES: ArchiveEntry[] = [
  { path: 'ziffer-scan.json', data: '{"a": 1}\n' },
  { path: 'ziffer-policy/manifest.json', data: '{}\n' },
  { path: 'ziffer-policy/attesters/registry.json', data: '{"quorum_k": 2}\n' },
  { path: 'ziffer-scan-report.html', data: '<!doctype html>\n<p>café</p>\n' },
  { path: LONG, data: new Uint8Array(513).fill(7) },
];

function write(name: string, bytes: Buffer): string {
  const p = join(WORK, name);
  writeFileSync(p, bytes);
  return p;
}

test('the system tar lists exactly the members, parents first, in sorted order', () => {
  const listing = execFileSync('tar', ['-tzf', write('a.tar.gz', tarGz(ENTRIES, MTIME))], { encoding: 'utf8' });
  assert.deepEqual(listing.trimEnd().split('\n'), [
    'ziffer-policy/',
    'ziffer-policy/attesters/',
    'ziffer-policy/attesters/registry.json',
    `ziffer-policy/${'d'.repeat(90)}/`,
    LONG,
    'ziffer-policy/manifest.json',
    'ziffer-scan-report.html',
    'ziffer-scan.json',
  ]);
});

test('the system tar extracts every member byte for byte, with the scan date and 0644/0755', () => {
  const archive = write('b.tar.gz', tarGz(ENTRIES, MTIME));
  const into = mkdtempSync(join(WORK, 'x-'));
  execFileSync('tar', ['-xzf', archive, '-C', into]);
  for (const e of ENTRIES) {
    const want = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data);
    assert.ok(readFileSync(join(into, e.path)).equals(want), e.path);
  }
  const verbose = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  for (const line of verbose.trimEnd().split('\n')) {
    assert.match(line, line.startsWith('d') ? /^drwxr-xr-x / : /^-rw-r--r-- /, line);
  }
  for (const line of verbose.trimEnd().split('\n')) assert.match(line, /Sep 25 12:00|2026-09-25 12:00/, line);
});

test('two runs over the same inputs are byte-identical, and the input order does not matter', () => {
  const one = tarGz(ENTRIES, MTIME);
  const two = tarGz([...ENTRIES].reverse(), MTIME);
  assert.ok(one.equals(two));
  assert.ok(!one.equals(tarGz(ENTRIES, new Date('2026-09-26T12:00:00Z'))), 'the mtime is not in the archive');
  assert.equal(tar(ENTRIES, MTIME).length % 512, 0);
});

test('a path that could escape the extraction directory, or is named twice, is refused by name', () => {
  for (const path of ['/etc/passwd', '../up', 'a/../b', 'a//b', 'a/./b', '', 'a\\b']) {
    assert.throws(() => tar([{ path, data: '' }], MTIME), ArchivePathInvalid, path);
  }
  assert.throws(() => tar([{ path: 'a', data: '' }, { path: 'a', data: '' }], MTIME), ArchivePathInvalid);
  assert.throws(() => tar([{ path: 'a', data: '' }, { path: 'a/b', data: '' }], MTIME), ArchivePathInvalid);
});
