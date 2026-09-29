/**
 * The write path of ONE scan (ACP-455, 0.3.0): everything a run writes, into
 * the one `./ziffer-scan/` folder, whichever halves ran.
 *
 * - the draft policy folder, by `writeBundle` (the twelve members and the
 *   sidecar, signed by a key made for the run and dropped): ONE policy naming
 *   the codebase's tools and the installed tools alike;
 * - `ziffer-tools.json` beside it when the codebase half ran: each code tool's
 *   key, resource and schema hash as the draft names them, read by the pasted
 *   snippet at startup. It sits BESIDE the policy folder, never in it, for the
 *   reason `archive/review.ts` gives: the tree hash covers every file in a
 *   signed bundle;
 * - the replay's own case beside it, when the replay runs (`replay/own.ts`);
 * - `ziffer-scan.json` beside it when the codebase half ran or `--report` was
 *   given: the `ScanResult`, wrapped as the `--json` document is (`policy`,
 *   `replay`, `tools_file`), redacted, home paths shown from `~`;
 * - with `--report`, the HTML report and the review archive through
 *   `writeReview`.
 *
 * Every path is checked free BEFORE anything is read or started
 * (`assertOutputsFree`), and every write is exclusive: nothing written by an
 * earlier run is overwritten.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { assertReviewFree, ReviewFileOccupied, reviewPaths, writeReview } from '../archive/review.js';
import { writeBundle } from '../bundle/generate.js';
import { redactDeep, redactResult } from '../redact/index.js';
import { loadReplayData } from '../replay/data.js';
import { generatedReplayData, replay, type ReplayResult } from '../replay/index.js';
import { homelessDeep, renderReportHtml } from '../report/file.js';
import { sortedJson } from '../report/json.js';
import type { OneScan } from '../scan/one.js';
import type { Engine } from '../wasm/loader.js';
import { TOOLS_FILE } from './grade.js';

/** Where a run writes, from the policy folder (`--out`). */
export function outputPaths(out: string): { review: ReturnType<typeof reviewPaths>; tools: string } {
  const abs = resolve(out);
  return { review: reviewPaths(abs), tools: join(dirname(abs), TOOLS_FILE) };
}

/**
 * Refuse an occupied output path before the engine is asked anything and
 * before a server starts. The policy folder itself is refused by
 * `writeBundle` (`BundleDirectoryOccupied`).
 */
export function assertOutputsFree(out: string, what: { code: boolean; report: boolean }): void {
  const p = outputPaths(out);
  if (what.code && existsSync(p.tools)) throw new ReviewFileOccupied(`${p.tools} already exists; move it or pass another --out`);
  if (what.report) assertReviewFree(p.review);
  else if (what.code && existsSync(p.review.json)) throw new ReviewFileOccupied(`${p.review.json} already exists; move it or pass another --out`);
}

export interface WriteOptions {
  engine: Engine;
  /** The draft policy folder (`--out`, default `ziffer-scan/ziffer-policy`); the other files land beside it. */
  out: string;
  now: Date;
  /** `--report`: also the HTML report and the review archive. */
  report?: boolean;
  /** Replay the eight injected cases against the policy just written. */
  replay: boolean;
  /** Directories shown from `~` in the report file and the JSON file (the scanned home, the user's). */
  homes: readonly string[];
}

export interface PolicySummary {
  path: string;
  files: string[];
  tree_hash: string;
  tenant_id: string;
  unclassified: readonly { server: string; tool: string }[];
}

export interface Written {
  policy: PolicySummary;
  /** The `--json` document: the result, `policy`, `replay`, and `tools_file` when the codebase half ran. Redacted. */
  document: unknown;
  replayed?: ReplayResult;
  /** `ziffer-scan.json`, when written. */
  json?: string;
  /** `ziffer-tools.json`, when written. */
  tools?: string;
  report?: { report: string; archive: string };
}

export async function writeScan(one: OneScan, opts: WriteOptions): Promise<Written> {
  const out = resolve(opts.out);
  const paths = outputPaths(out);
  const { result, bundle } = one;
  writeBundle(bundle, out);

  let tools: string | undefined;
  if (one.toolsFile !== undefined) {
    writeFileSync(paths.tools, sortedJson(one.toolsFile), { flag: 'wx' });
    tools = paths.tools;
  }

  let replayed: ReplayResult | undefined;
  if (opts.replay) {
    const data = generatedReplayData(loadReplayData(), bundle, one.union, { path: out, engine_pin: result.engine_pin, date: result.date });
    replayed = await replay(opts.engine, { now: Math.floor(opts.now.getTime() / 1000), data });
  }

  const policy: PolicySummary = {
    path: out,
    files: bundle.files.map((f) => f.path),
    tree_hash: bundle.treeHash,
    tenant_id: bundle.tenantId,
    unclassified: bundle.unclassified,
  };
  const document = redactDeep({ ...result, policy, replay: replayed ?? null, ...(tools === undefined ? {} : { tools_file: tools }) });
  const homes = opts.homes;

  const written: Written = { policy, document, ...(replayed === undefined ? {} : { replayed }), ...(tools === undefined ? {} : { tools }) };
  if (opts.report === true) {
    const html = renderReportHtml(redactResult(result), replayed, {
      machine: hostname(),
      homes,
      policy: { files: bundle.files, treeHash: bundle.treeHash, tenantId: bundle.tenantId, unclassified: bundle.unclassified },
      words: loadReplayData().words,
    });
    const r = writeReview(paths.review, { html, json: sortedJson(homelessDeep(document, homes)), policy: bundle.files, date: opts.now });
    written.report = { report: r.report, archive: r.archive };
    written.json = paths.review.json;
  } else if (result.code !== undefined) {
    writeFileSync(paths.review.json, sortedJson(homelessDeep(document, homes)), { flag: 'wx' });
    written.json = paths.review.json;
  }
  return written;
}
