/**
 * The three files `--report` writes (ACP-443), and where.
 *
 * BESIDE the policy folder, never inside it. The policy folder is a signed
 * bundle, and the engine's tree hash covers every file in it (`walk_bundle`:
 * an unsigned file smuggled into a signed bundle must not be free), so a
 * report written into it would make the draft fail its own verification the
 * moment anybody checked it. With the default `--out ./ziffer-scan/ziffer-policy`
 * the three files land in `./ziffer-scan/`, the one folder a run writes into
 * (ACP-454), never loose in the directory the scan was run from.
 *
 * Nothing is overwritten: a file already there is refused by name before the
 * scan starts a server (see `reviewPaths` and `assertReviewFree`), and every
 * write is exclusive in case one appeared since.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ARCHIVE_FILE, ARCHIVE_POLICY_DIR, JSON_FILE, REPORT_FILE } from '../report/file.js';
import { type ArchiveEntry, tarGz } from './tar.js';

export class ReviewFileOccupied extends Error {
  override readonly name = 'ReviewFileOccupied';
}

export interface ReviewPaths {
  report: string;
  json: string;
  archive: string;
}

/** The three absolute paths for a policy folder at `out`. */
export function reviewPaths(out: string): ReviewPaths {
  const dir = dirname(resolve(out));
  return { report: join(dir, REPORT_FILE), json: join(dir, JSON_FILE), archive: join(dir, ARCHIVE_FILE) };
}

export function assertReviewFree(paths: ReviewPaths): void {
  for (const p of [paths.report, paths.json, paths.archive]) {
    if (existsSync(p)) throw new ReviewFileOccupied(`${p} already exists; move it or pass another --out`);
  }
}

export interface ReviewContent {
  html: string;
  json: string;
  /** The policy folder's files, path inside the folder and text, as written. */
  policy: readonly { path: string; text: string }[];
  /** The scan date: every archive member's mtime. */
  date: Date;
}

/** Write the report, the JSON document and the archive holding both and the policy. */
export function writeReview(paths: ReviewPaths, content: ReviewContent): ReviewPaths {
  const entries: ArchiveEntry[] = [
    { path: REPORT_FILE, data: content.html },
    { path: JSON_FILE, data: content.json },
    ...content.policy.map((f) => ({ path: `${ARCHIVE_POLICY_DIR}/${f.path}`, data: f.text })),
  ];
  const archive = tarGz(entries, content.date);
  writeFileSync(paths.report, content.html, { flag: 'wx' });
  writeFileSync(paths.json, content.json, { flag: 'wx' });
  writeFileSync(paths.archive, archive, { flag: 'wx' });
  return paths;
}
