/**
 * `ziffer-scan --code`'s front end (ACP-455): read the customer's own
 * TypeScript application and return what its code says about the tools it
 * defines for a model -- before the engine has said anything about them.
 *
 * Read-only by construction: the tree is walked and parsed, one type-checked
 * program per tsconfig.json, and nothing is emitted or written into it.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { claimValues, notSeen } from './notseen.js';
import { ownSourceLine, ownSourceReader, partitionOwnSource, readManifests, sdkEntry } from './sdks.js';
import { computedNameLines, whereOf } from './ts/common.js';
import type { CodeCatalog, SourceRef } from './types.js';
import { emptyFacts, type Facts } from './ts/facts.js';
import { extractFile } from './ts/extract.js';
import { join as joinFacts } from './ts/join.js';
import { findSkillLoads } from './ts/loads.js';
import { buildPrograms, walkTree, type BuiltProgram } from './ts/program.js';
import { REACH_DEPTH } from './ts/reach.js';
import { syntaxOnlyFile } from './ts/syntax.js';
import { vscodeManifests } from './ts/sig-vscode.js';
import { assistantFiles } from './ts/sig-hooks.js';
import { unknownBuiltinsLine } from './ts/sig-claude-agent.js';
import { genkitPromptFiles } from './ts/sig-genkit.js';
import { refKey } from './ts/util.js';

export type { CodeCatalog } from './types.js';

/** Every `CodeTool.sdk` value this front end can emit; each is an `id` in data/code-sdks.json (asserted by test). */
export const EMITTED_SDKS: readonly string[] = ['ai', 'anthropic', 'cohere', 'gemini', 'langchain', 'local', 'mcp', 'mistral', 'openai', 'openai-agents', 'vscode-lm-tools', 'claude-agent-sdk', 'bedrock', 'mastra', 'genkit', 'llamaindex'];

/**
 * Framework ids this front end reads without emitting a tool for them: structured output
 * (Instructor) is recognised in order to be excluded, so its dependency is not "not yet read".
 */
const READ_NOT_EMITTED: readonly string[] = ['instructor'];

/** What one run read and did not read, in numbers, for a caller that tabulates runs (the corpus script). */
export interface CodeScanStats {
  sourceFiles: number;
  jsFiles: number;
  filesRead: number;
  skipped: { reason: string; dirs: number; files: number }[];
  unresolvedFiles: number;
  unresolvedFrameworkFiles: number;
  /** Definitions dropped because they sit in a framework's own source, by package. */
  ownSource: { pkg: string; tools: number }[];
}

export interface ScanCodeOptions {
  /** Skip the type-checked pass and report only what import-name matching finds. */
  syntaxOnly?: boolean;
  log?: (line: string) => void;
  onStats?: (stats: CodeScanStats) => void;
}

/**
 * The recognisers' honesty lines under the own-source rule: a line whose every place sits in
 * a framework's own source is dropped; a counting line (`noteAt`) is recounted over the places
 * left; a line with no place is kept.
 */
function ownNotes(facts: Facts, mine: (r: SourceRef) => boolean): { lines: string[]; assistant: string[] } {
  const out: string[] = [];
  const assistant: string[] = [];
  for (const [key, sentence] of facts.notes) {
    const refs = facts.noteRefs.get(key);
    let line: string | undefined;
    if (refs === undefined) line = sentence;
    else {
      const kept = refs.filter(mine);
      if (kept.length === 0) continue;
      const make = facts.noteMakers.get(key);
      line = kept.length === refs.length || make === undefined ? sentence : make(kept.length, whereOf(kept));
    }
    out.push(line);
    if (facts.noteKinds.get(key) === 'assistant-config') assistant.push(line);
  }
  return { lines: out, assistant };
}

export async function scanCode(root: string, opts: ScanCodeOptions = {}): Promise<CodeCatalog> {
  const log = opts.log ?? (() => undefined);
  const abs = resolve(root);
  const t0 = performance.now();
  const walk = walkTree(abs);
  const skippedFiles = [...walk.skipped.values()].reduce((a, s) => a + s.files, 0);
  log(`code: walked ${abs}: ${walk.tsconfigs.length} tsconfig.json, ${walk.sourceFiles.length} TypeScript/JavaScript file(s) (${walk.jsFiles} JavaScript), ${walk.packageJsons.length} package.json; skipped ${skippedFiles} source file(s) and ${[...walk.skipped.values()].reduce((a, s) => a + s.dirs, 0)} director(ies) by rule`);

  const rootManifest = join(abs, 'package.json');
  const manifests = readManifests(walk.packageJsons, existsSync(rootManifest) ? rootManifest : undefined);

  const { programs, errors } = buildPrograms(walk, log);
  const tProg = performance.now();

  // Each tree file is read once, by the first program that holds it.
  const owner = new Map<string, BuiltProgram>();
  for (const bp of programs) for (const sf of bp.files) if (!owner.has(sf.fileName)) owner.set(sf.fileName, bp);

  const facts = emptyFacts();
  const syntaxKeys = new Set<string>();
  for (const bp of programs) {
    const ctx = { root: abs, checker: bp.checker, facts };
    for (const sf of bp.files) {
      if (owner.get(sf.fileName) !== bp) continue;
      for (const k of syntaxOnlyFile(abs, sf)) syntaxKeys.add(k);
      if (opts.syntaxOnly === true) {
        facts.filesRead += 1;
        continue;
      }
      extractFile(ctx, sf);
    }
  }
  // Data-declared tools (a VS Code extension's package.json), joined to the registrations the pass found.
  if (opts.syntaxOnly !== true) vscodeManifests({ root: abs, facts }, walk.packageJsons);
  // A coding assistant's hook files and MCP lists: interception points already present, never tools.
  if (opts.syntaxOnly !== true) assistantFiles({ root: abs, facts }, walk.assistantFiles);
  // Genkit's .prompt files: a tools list in front matter, said when the tree uses Genkit.
  if (opts.syntaxOnly !== true) genkitPromptFiles({ root: abs, facts }, walk.textFiles);
  const tExtract = performance.now();

  const joined = joinFacts(facts, programs, abs, owner);
  const own = ownSourceReader(abs);
  const tools = partitionOwnSource(joined.tools, (t) => t.defined_at, own);
  const exposures = partitionOwnSource(joined.exposures, (e) => e.at, own).kept;
  const dispatchers = partitionOwnSource(joined.dispatchers, (d) => d.at, own).kept;
  const gates = partitionOwnSource(joined.gates, (g) => g.at, own).kept;
  const missed = tools.kept.filter((t) => !syntaxKeys.has(refKey(t.defined_at))).length;
  // One source for the count and the per-tool field: the kept tools' `authority_claims`.
  const hinted = tools.kept.filter((t) => (t.authority_claims?.length ?? 0) > 0);

  const mine = (r: SourceRef): boolean => own(r.file) === undefined;
  const extra: string[] = [];
  // A name for the model the scan could not resolve: said per framework, never a silent fallback.
  // A definition in a framework's own source is the framework's, by the same rule as its tools.
  extra.push(...computedNameLines(facts.computedNames.filter((n) => own(n.at.file) === undefined), (id) => (sdkEntry(id)?.framework ?? id).split(' (')[0] ?? id));
  const unknownBuiltins = unknownBuiltinsLine(facts.claudeUnknownBuiltins.filter((u) => mine(u.at)));
  if (unknownBuiltins !== undefined) extra.push(unknownBuiltins);
  const ownLine = ownSourceLine(tools.dropped);
  if (ownLine !== undefined) extra.push(ownLine);
  if (facts.unresolvedFiles.size > 0) {
    extra.push(`${facts.unresolvedFiles.size} file(s) import packages the type checker could not resolve (not installed, as in a fresh clone or a CI checkout, or resolved only by a bundler)${facts.unresolvedFrameworkFiles.size > 0 ? `, ${facts.unresolvedFrameworkFiles.size} of them a tool-calling framework` : ''}; their framework calls were recognised through the import declarations, and readings that need the framework's types (a literal typed only by an SDK type, a factory's return type) are not made there. Install the dependencies and re-run for the full reading.`);
  }
  const skips = [...walk.skipped.entries()].filter(([r]) => r !== 'dependencies' && r !== 'version control' && r !== 'build output or cache').filter(([, v]) => v.files > 0);
  if (skips.length > 0) {
    extra.push(`Not read by rule: ${skips.map(([r, v]) => `${v.files} source file(s) in ${r}`).join('; ')}.`);
  }

  const notes = ownNotes(facts, mine);
  const catalog: CodeCatalog = {
    root,
    sdks: manifests.sdks,
    files_read: facts.filesRead,
    tools: tools.kept,
    exposures,
    dispatchers,
    gates,
    // Measured over the same definitions: a syntax find in a framework's own source is dropped as the checked one is.
    syntax_only: { found: [...syntaxKeys].filter((k) => own(k.slice(0, k.lastIndexOf(':', k.lastIndexOf(':') - 1))) === undefined).length, missed },
    not_seen: [
      ...notSeen({
        exposures,
        gates,
        // The own-source rule, as for the tools: an attach point or a place written in a
        // framework's own source is the framework's, not the application's.
        mcpClients: facts.mcpClients.filter(mine),
        mcpLowLevel: facts.mcpLowLevel.filter(mine),
        providerTools: facts.providerTools.filter((p) => mine(p.at)),
        dynamicFiles: [...facts.dynamicFiles].map((f) => f.slice(abs.length + 1)).filter((f) => own(f) === undefined).sort(),
        hints: {
          tools: hinted.length,
          names: [...new Set(hinted.flatMap((t) => (t.authority_claims ?? []).map((c) => c.name)))],
          values: claimValues(hinted),
        },
        sdks: manifests.sdks,
        readIds: new Set([...EMITTED_SDKS, ...READ_NOT_EMITTED]),
        pyFiles: walk.pyFiles,
        otherLang: walk.otherLang,
        configErrors: errors,
        ...(opts.syntaxOnly === true || !tools.kept.some((t) => t.execute_at !== undefined) ? {} : { reachDepth: REACH_DEPTH }),
      }),
      ...extra,
      ...notes.lines,
    ],
    ...(notes.assistant.length === 0 ? {} : { assistant_config: notes.assistant }),
  };
  // The syntax-only pass reads no run function and no dispatcher caller: neither check ran.
  const ran = opts.syntaxOnly !== true;
  catalog.checks = [{ language: 'typescript', tool_calls: ran, caller_checks: ran, skill_loads: ran }];
  // The third signal (ACP-460): where the application's code loads a skill or instruction file.
  if (ran) {
    const tLoads = performance.now();
    catalog.skill_loads = findSkillLoads({ root: abs, programs, owner, textFiles: walk.textFiles, exposures, tools: tools.kept });
    log(`code: ${catalog.skill_loads.length} skill load(s) from ${walk.textFiles.length} text file(s), ${Math.round(performance.now() - tLoads)} ms`);
  }
  // Structured output recognised and not counted (record §3.17); a schema in a framework's own source is the framework's.
  if (ran) catalog.structured_output = partitionOwnSource(facts.structured, (x) => x.at, own).kept;
  if (manifests.packageName !== undefined) catalog.package_name = manifests.packageName;
  const tEnd = performance.now();
  log(`code: ${programs.length} program(s) in ${Math.round(tProg - t0)} ms, extraction ${Math.round(tExtract - tProg)} ms, join ${Math.round(tEnd - tExtract)} ms, wall ${Math.round(tEnd - t0)} ms`);
  log(`code: ${catalog.tools.length} tool(s) (${[...tools.dropped.values()].reduce((a, b) => a + b, 0)} more in a framework's own source, not counted), ${catalog.exposures.length} exposure(s), ${catalog.dispatchers.length} dispatcher(s), ${catalog.gates.length} gate(s); syntax-only found ${catalog.syntax_only.found}, missed ${catalog.syntax_only.missed}`);
  opts.onStats?.({
    sourceFiles: walk.sourceFiles.length,
    jsFiles: walk.jsFiles,
    filesRead: facts.filesRead,
    skipped: [...walk.skipped.entries()].map(([reason, v]) => ({ reason, ...v })),
    unresolvedFiles: facts.unresolvedFiles.size,
    unresolvedFrameworkFiles: facts.unresolvedFrameworkFiles.size,
    ownSource: [...tools.dropped.entries()].map(([pkg, n]) => ({ pkg, tools: n })),
  });
  return catalog;
}
