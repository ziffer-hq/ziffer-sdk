#!/usr/bin/env node
/**
 * The corpus check (ACP-455): `node scripts/corpus.mjs <corpus-dir> [--only a,b] [--json <file>]`.
 *
 * Runs the BUILT code front ends -- TypeScript (`scanCode`) and Python (`scanPython`),
 * merged by `mergeCatalogs`, the three the CLI's `--code` runs, imported and never
 * copied -- over every public repository `scripts/corpus.json` pins, each a shallow clone
 * in `<corpus-dir>/<id>` at the pinned commit with NO dependencies installed (a fresh
 * clone is what a customer's CI checkout looks like). Prints one row per repository and
 * exits non-zero on any miss (`--dump <dir>` also writes each merged catalog's tools there): fewer tools than `min_tools`, a named tool not found in its
 * file, a tool found where `must_not_find` says none may be (a framework's own source),
 * or a clone at another commit than the one pinned.
 *
 * It is a script, not a gate stage: it needs the clones, which the gate does not have.
 * It reads the clones and writes nothing into them. Build the package first.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanCode } from '../dist/code/index.js';
import { mergeCatalogs } from '../dist/code/merge.js';
import { scanPython } from '../dist/code/py/index.js';
import { instructionHits } from '../dist/classify/index.js';
import { readSkills } from '../dist/skills/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const VALUED = ['--only', '--json', '--dump'];
const dir = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1] ?? ''));
if (dir === undefined) {
  process.stderr.write('usage: node scripts/corpus.mjs <corpus-dir> [--only id,id] [--json rows.json] [--dump dir]\n');
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag('--only')?.split(',');
const jsonOut = flag('--json');
const dumpDir = flag('--dump');

const corpus = JSON.parse(readFileSync(join(here, 'corpus.json'), 'utf8'));

/** A tool's file: a notebook's reference names its cell (`nb.ipynb#cell-3`), the file is before `#`. */
const fileOf = (t) => t.defined_at.file.split('#')[0];

function head(repo) {
  try {
    return execFileSync('git', ['-C', repo, 'log', '-1', '--format=%H'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

const rows = [];
let failed = false;
for (const r of corpus.repos) {
  if (only !== undefined && !only.includes(r.id)) continue;
  const repo = resolve(dir, r.id);
  const problems = [];
  if (!existsSync(repo)) {
    rows.push({ id: r.id, tools: '-', files: '-', skipped: '-', wall: '-', named: '-', problems: ['clone absent'] });
    failed = true;
    continue;
  }
  const at = head(repo);
  if (at !== r.commit) problems.push(`clone is at ${at ?? '(no git)'}, pinned ${r.commit}`);
  let tsStats;
  let pyStats;
  const t0 = performance.now();
  const ts = await scanCode(repo, { onStats: (s) => { tsStats = s; } });
  const py = await scanPython(repo, { onStats: (s) => { pyStats = s; } });
  const merged = mergeCatalogs(ts, py);
  const wall = (performance.now() - t0) / 1000;
  // The skills inventory and the instruction hits (2026-09-28), read as the CLI reads them: the skills
  // under the root, and each code tool's description by the installed half's patterns. Counts only;
  // `--dump` writes every HIGH hit with its place.
  const skills = readSkills(repo);
  const highSkill = skills.flatMap((k) => k.instruction_hits.filter((h) => h.severity === 'high').map((h) => ({ at: `${k.path}:${h.line}`, pattern: h.pattern, excerpt: h.excerpt })));
  const highTool = merged.tools.flatMap((t) => instructionHits(t.description, { file: false }).filter((h) => h.severity === 'high').map((h) => ({ at: `${t.defined_at.file}:${t.defined_at.line}`, tool: t.name, pattern: h.pattern, excerpt: h.excerpt })));

  const tools = merged.tools;
  if (dumpDir !== undefined) writeFileSync(join(dumpDir, `${r.id}.json`), `${JSON.stringify({ tools, not_seen: merged.not_seen, exposures: merged.exposures.length, dispatchers: merged.dispatchers, skills: skills.map((k) => ({ path: k.path, kind: k.kind })), high: [...highTool, ...highSkill] }, null, 1)}\n`);
  if (tools.length < r.min_tools) problems.push(`${tools.length} tools, fewer than min_tools ${r.min_tools}`);
  let named = 0;
  for (const m of r.must_find) {
    if (tools.some((t) => t.name === m.name && fileOf(t) === m.file)) named += 1;
    else problems.push(`not found: ${m.name} in ${m.file}`);
  }
  for (const n of r.must_not_find ?? []) {
    const hits = tools.filter((t) => fileOf(t).startsWith(n.file_prefix) && (n.name === undefined || t.name === n.name));
    if (hits.length > 0) problems.push(`found where none may be (${n.why}): ${hits.length} under ${n.file_prefix}, e.g. ${hits[0].name} at ${hits[0].defined_at.file}:${hits[0].defined_at.line}`);
  }
  // Source files not read by rule (test code, nested checkouts, declarations, bundles), both front ends.
  const skipped = (tsStats?.skipped ?? []).filter((s) => s.reason !== 'dependencies' && s.reason !== 'version control').reduce((a, s) => a + s.files, 0) + (pyStats?.testFiles ?? 0);
  const ownTs = (tsStats?.ownSource ?? []).reduce((a, s) => a + s.tools, 0);
  const ownPy = (pyStats?.ownSource ?? []).reduce((a, s) => a + s.tools, 0);
  const bySdk = {};
  for (const t of tools) bySdk[t.sdk] = (bySdk[t.sdk] ?? 0) + 1;
  const row = {
    id: r.id,
    tools: tools.length,
    own: ownTs + ownPy,
    files: merged.files_read,
    notebooks: pyStats?.notebooks ?? 0,
    skipped,
    unresolved: tsStats?.unresolvedFiles ?? 0,
    wall: wall.toFixed(1),
    named: `${named}/${r.must_find.length}`,
    by_sdk: bySdk,
    skills: skills.filter((k) => k.kind === 'skill').length,
    instruction_files: skills.filter((k) => k.kind === 'instructions').length,
    high_skill: highSkill.length,
    high_tool: highTool.length,
    problems,
  };
  rows.push(row);
  if (problems.length > 0) failed = true;
  process.stderr.write(`${r.id}: ${tools.length} tools in ${wall.toFixed(1)} s${problems.length > 0 ? `, ${problems.length} problem(s)` : ''}\n`);
}

const cols = [
  ['repo', (r) => r.id],
  ['tools', (r) => String(r.tools)],
  ['own src', (r) => String(r.own ?? '-')],
  ['files', (r) => String(r.files)],
  ['nb', (r) => String(r.notebooks ?? '-')],
  ['skipped', (r) => String(r.skipped)],
  ['unresolved', (r) => String(r.unresolved ?? '-')],
  ['wall s', (r) => String(r.wall)],
  ['named', (r) => r.named],
  ['skills', (r) => String(r.skills ?? '-')],
  ['instr files', (r) => String(r.instruction_files ?? '-')],
  ['HIGH skill', (r) => String(r.high_skill ?? '-')],
  ['HIGH tool', (r) => String(r.high_tool ?? '-')],
  ['violations', (r) => String(r.problems.length)],
];
const widths = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => f(r).length)));
const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ')} |`;
process.stdout.write(`${line(cols.map(([h]) => h))}\n`);
process.stdout.write(`${line(widths.map((w) => '-'.repeat(w)))}\n`);
for (const r of rows) process.stdout.write(`${line(cols.map(([, f]) => f(r)))}\n`);
for (const r of rows) for (const p of r.problems) process.stdout.write(`${r.id}: ${p}\n`);
if (jsonOut !== undefined) writeFileSync(jsonOut, `${JSON.stringify(rows, null, 2)}\n`);
process.exit(failed ? 1 : 0);
