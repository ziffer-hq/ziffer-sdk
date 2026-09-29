/**
 * ONE scan (ACP-455, 0.3.0): the customer's codebase and the AI tools
 * installed on the machine, drafted into ONE policy and graded by the engine
 * against it.
 *
 * Either half may be absent (`--code` reads only the codebase, `--no-code` only
 * the installed tools, and a run from the home directory has no codebase to
 * read), and the steps are the same whichever ran:
 *
 * 1. the classifier drafts each half's tools: the installed tools with their
 *    findings, as the MCP scan always did; the code tools with their drafts
 *    only, because a code tool's reading is carried by its engine verdict;
 * 2. ONE `generateBundle` over the union: code tools with a resource per tool,
 *    installed tools with their server's resource;
 * 3. the code tools graded by `decide` against THAT bundle, read through the
 *    same replay data the replay reads, so the verdicts printed, the replay
 *    and the policy on disk are one policy.
 *
 * Writes nothing: `code/run.ts` writes.
 */

import type { GeneratedBundle } from '../bundle/generate.js';
import { classify } from '../classify/index.js';
import { codeDrafts, draftPolicy, gradeAgainst, type CodeToolsFile } from '../code/grade.js';
import type { CodeCatalog } from '../code/types.js';
import { packageEnginePin, packageVersion } from '../package-info.js';
import { attachControls } from '../report/index.js';
import { gradeRecord } from '../report/code.js';
import type { CatalogTool, Finding, Reach, ScanResult, SkillRead } from '../types.js';
import type { Engine } from '../wasm/loader.js';
import { draftBundle } from './policy.js';

/** What the installed-tools half found: discovery, the servers' tool lists, and what could not be read. */
export interface InstalledHalf {
  clients_scanned: string[];
  clients_not_covered: string[];
  catalog: CatalogTool[];
  /** Findings made before classification: servers not started, files not read. */
  findings: Finding[];
  reach: Reach;
}

export interface OneScanInput {
  /** The codebase half, when it ran. */
  code?: CodeCatalog;
  /** The installed-tools half, when it ran. */
  installed?: InstalledHalf;
  /** Why the codebase half did not run, when it did not. */
  codeSkipped?: 'skipped-flag' | 'no-codebase';
  /** The skills and instruction files under the codebase's root (`skills/`), when the codebase half ran. */
  skills?: SkillRead[];
}

export interface OneScan {
  result: ScanResult;
  /** The one draft policy, over every tool in `union`. */
  bundle: GeneratedBundle;
  /** Every catalog row the policy names: the installed tools, then the code tools. The replay reads the policy through it. */
  union: CatalogTool[];
  /** `ziffer-tools.json`, when the codebase half ran. */
  toolsFile?: CodeToolsFile;
}

/** RFC 3339 UTC to the second. */
const instant = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function oneScan(input: OneScanInput, engine: Engine, opts: { now: Date; out: string }): Promise<OneScan> {
  const installed = input.installed;
  const catalog = installed?.catalog ?? [];
  const drafted = classify(catalog);
  const code = input.code === undefined ? undefined : { catalog: input.code, drafts: codeDrafts(input.code) };
  const union = [...catalog, ...(code?.drafts.rows ?? [])];
  const bundle = await draftBundle(union, [...drafted.classifications, ...(code?.drafts.classifications ?? [])], engine, opts.now);

  const result: ScanResult = {
    scan_version: packageVersion(),
    engine_pin: packageEnginePin(),
    date: instant(opts.now),
    clients_scanned: installed?.clients_scanned ?? [],
    clients_not_covered: installed?.clients_not_covered ?? [],
    catalog,
    classifications: drafted.classifications,
    findings: installed === undefined ? [] : attachControls([...installed.findings, ...drafted.findings]),
  };
  if (installed !== undefined) result.reach = installed.reach;
  result.scope = { code: input.code !== undefined ? 'read' : (input.codeSkipped ?? 'skipped-flag'), installed: installed !== undefined };
  if (code === undefined) return { result, bundle, union };

  const draft = draftPolicy(bundle, union, { path: opts.out, date: opts.now.toISOString() });
  const graded = await gradeAgainst(code.catalog, code.drafts, bundle, draft, engine);
  // The grade the reports print, written once into the JSON by the function that computes it (ACP-464 item 8).
  const grade = gradeRecord(graded.section);
  result.code = grade === undefined ? graded.section : { ...graded.section, grade };
  // Read beside the code half and only with it: absent when it did not run, empty when it found none.
  result.skills = input.skills ?? [];
  return { result, bundle, union, toolsFile: graded.toolsFile };
}
