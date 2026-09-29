#!/usr/bin/env node
/**
 * ACP-439: read the framework mapping OUT OF THE DOSSIER at the engine pin, and
 * emit it as typed data in `src/generated/annex-source.ts`.
 *
 * # Why the mapping is read, never typed
 *
 * Every framework citation `ziffer-scan` prints (NIS2 Art. 21(2)(i), NIST SP
 * 800-53 SC-7, MITRE ATLAS AML.T0086 ...) and the status word beside it is a
 * row of Annex E (`dossier/annexes/E-control-mapping.md`) or of the MITRE
 * chapter (`dossier/02-THREAT-MODEL-MITRE.md`). A second copy of those rows in
 * this package would agree with the dossier on the day it was typed and with
 * nothing after: the annex re-grades a row from *partial* to *built*, the copy
 * does not, and the tool goes on telling a stranger something the dossier has
 * withdrawn. So the rows are parsed on every build, and the generated file is
 * gitignored so a stale one cannot be committed.
 *
 * `data/finding-controls.json` is embedded beside them VERBATIM (it is this
 * package's data file, not the dossier's): the published package runs from an
 * npm tarball, and a runtime read of a path relative to a module is the shape
 * `packages/mcp/scripts/embed-guide.mjs` explains breaking under `npx`.
 *
 * # Where the dossier comes from
 *
 * The pin has ONE authority in this repository: the `rev` on the engine's
 * `acp-core` git dependency in Cargo.toml. It is read with the same pattern
 * `packages/types/scripts/vendor-engine-types.mjs` (step 1) and
 * `tools/check-schemas-at-pin.py` read it.
 *
 * The TREE is not the one vendor-engine-types reads, and that is measured, not
 * chosen: pnpm's store materialises only `packages/acp-types` of the engine
 * (its git dependency names that path), so it holds no `dossier/`. The whole
 * engine tree at the pin is cargo's git checkout,
 * `~/.cargo/git/checkouts/agent-control-plane-<hash>/<rev[:7]>/`, located the
 * way `tools/check-schemas-at-pin.py` locates it. `ZIFFER_ENGINE_CHECKOUT`
 * overrides that for development (an engine worktree). Either way the tree's
 * HEAD must BE the pin when it is a git tree: a dossier read from another
 * commit is a mapping the pinned engine does not state, and it halts
 * (`EngineCheckoutNotAtPin`) rather than being stamped with a pin it is not at.
 *
 * # Halts, each by name
 *
 * A status word outside the annex's own vocabulary halts `AnnexStatusUnknown`
 * with the row. The annex's checker guards its side; a silent skip here would
 * ship a mapping the annex does not have. The vocabulary itself is read from
 * the annex's "How to read a row", and it must equal the six words the shared
 * `ControlRef` type admits (`AnnexVocabularyChanged` otherwise), because a
 * seventh word in the annex is a type change, not a data change.
 *
 * `ZIFFER_ANNEX_OUT` redirects the output file; the tests use it so a planted
 * bad annex never overwrites the real generated module.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const ROOT = resolve(PKG, '..', '..');
const OUT = process.env.ZIFFER_ANNEX_OUT ?? join(PKG, 'src', 'generated', 'annex-source.ts');

const ANNEX_PATH = 'dossier/annexes/E-control-mapping.md';
const MITRE_PATH = 'dossier/02-THREAT-MODEL-MITRE.md';

/** The six status words `ControlRef['status']` admits, in the annex's order.
 *  Compared against the annex's own list, never used in its place. */
const CONTRACT_STATUSES = ['built', 'partial', 'not checked', 'lands in', 'customer obligation', 'not covered'];

const ANNEX_COLUMNS = ['framework clause', 'what it asks', 'answered by', 'status', 'evidence'];

/** The two MITRE-chapter tables this package reads, by their headings. The
 *  framework name is the one a reader searches for; the chapter's headings say
 *  "ATLAS mapping" and "OWASP LLM Top 10 correspondence". */
const MITRE_TABLES = [
  { heading: 'ATLAS mapping (corroborated identifiers only)', framework: 'MITRE ATLAS', columns: 3 },
  { heading: 'OWASP LLM Top 10 correspondence', framework: 'OWASP LLM Top 10', columns: 2 },
];

function halt(name, detail) {
  process.stderr.write(`embed-annex: ${name}: ${detail}\n`);
  process.exit(1);
}

// --- 1. the pin, from its one authority -------------------------------------
const cargo = readFileSync(join(ROOT, 'Cargo.toml'), 'utf8');
const revMatch = /acp-core = \{[^}]*rev = "([0-9a-f]{40})"/.exec(cargo);
if (!revMatch) {
  halt('EnginePinUnreadable', 'Cargo.toml has no `acp-core = { git = ..., rev = "<40 hex>" }`');
}
const pin = revMatch[1];

// --- 2. the tree ------------------------------------------------------------
function cargoCheckouts() {
  const base = join(homedir(), '.cargo', 'git', 'checkouts');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((d) => d.startsWith('agent-control-plane-'))
    .map((d) => join(base, d, pin.slice(0, 7)))
    .filter((d) => existsSync(join(d, ANNEX_PATH)));
}

let tree = process.env.ZIFFER_ENGINE_CHECKOUT;
if (tree === undefined || tree === '') {
  const hits = cargoCheckouts();
  if (hits.length === 0) {
    halt(
      'EngineCheckoutAbsent',
      `no engine tree at the pin ${pin.slice(0, 7)} with ${ANNEX_PATH} under ~/.cargo/git/checkouts/. ` +
        'Build the workspace once (cargo fetches the engine there), or set ZIFFER_ENGINE_CHECKOUT ' +
        'to an engine checkout at the pin.',
    );
  }
  tree = hits[0];
}
tree = resolve(tree);

function headOf(dir) {
  if (!existsSync(join(dir, '.git'))) return null;
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const head = headOf(tree);
if (head !== null && head !== pin) {
  halt(
    'EngineCheckoutNotAtPin',
    `${tree} is at ${head}, the pin in Cargo.toml is ${pin}. The mapping would be stamped with a ` +
      'pin it was not read at.',
  );
}

function readSource(rel) {
  try {
    return readFileSync(join(tree, rel), 'utf8');
  } catch (error) {
    halt('AnnexSourceUnreadable', `${join(tree, rel)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- 3. markdown tables -----------------------------------------------------
function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Every table under every `## ` heading, as { heading, header, rows: [{line, cells}] }. */
function tables(markdown) {
  const out = [];
  let heading = null;
  let current = null;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      heading = line.slice(3).trim();
      current = null;
      continue;
    }
    if (!line.startsWith('|')) {
      current = null;
      continue;
    }
    const c = cells(line);
    if (current === null) {
      current = { heading, header: c, rows: [] };
      out.push(current);
    } else if (c.every((x) => /^:?-{3,}:?$/.test(x))) {
      continue;
    } else {
      current.rows.push({ line: i + 1, cells: c });
    }
  }
  return out;
}

function bold(cell) {
  const m = /^\*\*(.+?)\*\*/.exec(cell);
  return m ? m[1] : null;
}

// --- 4. Annex E -------------------------------------------------------------
const annexText = readSource(ANNEX_PATH);

// The vocabulary, from "How to read a row": the bullets under **Status vocabulary.**
const vocabStart = annexText.indexOf('**Status vocabulary.**');
if (vocabStart === -1) halt('AnnexVocabularyAbsent', `${ANNEX_PATH} has no **Status vocabulary.** paragraph`);
const vocabEnd = annexText.indexOf('\n---', vocabStart);
const vocab = [...annexText.slice(vocabStart, vocabEnd === -1 ? undefined : vocabEnd).matchAll(/^- \*\*(.+?)\*\* —/gm)].map(
  (m) => m[1].replace(/ M\*x\*$/, '').replace(/\*/g, '').trim(),
);
if (vocab.length !== CONTRACT_STATUSES.length || vocab.some((w, i) => w !== CONTRACT_STATUSES[i])) {
  halt(
    'AnnexVocabularyChanged',
    `the annex's status vocabulary is [${vocab.join(', ')}]; ControlRef admits ` +
      `[${CONTRACT_STATUSES.join(', ')}]. A new word is a change to src/types.ts, not to this script.`,
  );
}

function parseStatus(cell, where) {
  const word = bold(cell);
  if (word === null || cell !== `**${word}**`) {
    halt('AnnexStatusUnknown', `${where}: status cell ${JSON.stringify(cell)} is not one bold vocabulary word`);
  }
  const landsIn = /^lands in (M\d+)$/.exec(word);
  if (landsIn) return { status: 'lands in', milestone: landsIn[1] };
  if (word === 'lands in' || !vocab.includes(word)) {
    halt('AnnexStatusUnknown', `${where}: ${JSON.stringify(word)} is not in [${vocab.join(', ')}]`);
  }
  return { status: word, milestone: null };
}

const rows = [];
for (const t of tables(annexText)) {
  const isAnnexTable = t.header.includes('framework clause');
  if (!isAnnexTable) continue;
  if (t.header.length !== ANNEX_COLUMNS.length || t.header.some((h, i) => h !== ANNEX_COLUMNS[i])) {
    halt(
      'AnnexTableShapeUnknown',
      `under "## ${t.heading}" the header is [${t.header.join(' | ')}], expected [${ANNEX_COLUMNS.join(' | ')}]`,
    );
  }
  if (t.heading === null) halt('AnnexTableShapeUnknown', 'a mapping table sits above any ## heading');
  const framework = t.heading.split(' — ')[0].trim();
  for (const r of t.rows) {
    const where = `${ANNEX_PATH}:${r.line}`;
    if (r.cells.length !== ANNEX_COLUMNS.length) {
      halt('AnnexRowShape', `${where}: ${r.cells.length} cells, expected ${ANNEX_COLUMNS.length}`);
    }
    const [clause, asks, answeredBy, statusCell, evidence] = r.cells;
    const { status, milestone } = parseStatus(statusCell, where);
    rows.push({ framework, heading: t.heading, clause, asks, answered_by: answeredBy, status, milestone, evidence, line: r.line });
  }
}
if (rows.length === 0) halt('AnnexEmpty', `${ANNEX_PATH} yielded no mapping row`);

const seen = new Set();
for (const r of rows) {
  const key = `${r.framework}\u0000${r.clause}`;
  if (seen.has(key)) halt('AnnexRowDuplicate', `${r.framework} ${r.clause} appears twice (line ${r.line})`);
  seen.add(key);
}

// --- 5. the MITRE chapter ---------------------------------------------------
const mitreText = readSource(MITRE_PATH);
const mitreTables = tables(mitreText);
const atlas = [];
for (const spec of MITRE_TABLES) {
  const t = mitreTables.find((x) => x.heading === spec.heading);
  if (!t) halt('MitreTableAbsent', `${MITRE_PATH} has no table under "## ${spec.heading}"`);
  if (t.header.length !== spec.columns) {
    halt('MitreTableShapeUnknown', `"## ${spec.heading}" has [${t.header.join(' | ')}], expected ${spec.columns} columns`);
  }
  let previous = null;
  for (const r of t.rows) {
    const where = `${MITRE_PATH}:${r.line}`;
    if (r.cells.length !== spec.columns) halt('MitreRowShape', `${where}: ${r.cells.length} cells`);
    const [technique, positionCell, mechanism = ''] = r.cells;
    // ATLAS: `**AML.T0051** — LLM Prompt Injection`; OWASP: `LLM01 Prompt Injection`.
    const m = spec.framework === 'MITRE ATLAS'
      ? /^\*\*(AML\.T\d{4}(?:\.\d{3})?)\*\*\s+—\s+(.+)$/.exec(technique)
      : /^(LLM\d{2})\s+(.+)$/.exec(technique);
    if (!m) halt('MitreTechniqueUnreadable', `${where}: ${JSON.stringify(technique)}`);
    // The position's bold lead is its verdict; a cell with no bold lead is all verdict.
    let label = bold(positionCell) ?? positionCell;
    let inherited = null;
    // "**Same.**" means the row above's position, literally; it is resolved
    // here so a reader of the output is never shown the word "Same".
    if (label === 'Same.') {
      if (previous === null) halt('MitreSameWithoutPrevious', `${where}: "Same." on the first row`);
      label = previous.position_label;
      inherited = previous.id;
    }
    const row = {
      framework: spec.framework,
      id: m[1],
      name: m[2].trim(),
      position_label: label,
      position_inherited_from: inherited,
      position: positionCell,
      mechanism,
      line: r.line,
    };
    atlas.push(row);
    previous = row;
  }
}

// --- 6. this package's own mapping file, embedded verbatim --------------------
const controlsPath = join(PKG, 'data', 'finding-controls.json');
let findingControls;
try {
  findingControls = JSON.parse(readFileSync(controlsPath, 'utf8'));
} catch (error) {
  halt('FindingControlsUnreadable', `${controlsPath}: ${error instanceof Error ? error.message : String(error)}`);
}

// --- 7. emit ----------------------------------------------------------------
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const source = {
  rows,
  atlas,
  generated_from: [
    { path: ANNEX_PATH, sha256: sha(annexText), engine_pin: pin },
    { path: MITRE_PATH, sha256: sha(mitreText), engine_pin: pin },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  '// GENERATED by scripts/embed-annex.mjs from the engine dossier at the pin. Do not edit.\n' +
    '// Gitignored and rewritten on every build: see that script for why the rows are read, never typed.\n' +
    "import type { AnnexSource } from '../report/annex.js';\n\n" +
    `export const ANNEX_SOURCE: AnnexSource = ${JSON.stringify(source, null, 2)};\n\n` +
    `/** data/finding-controls.json, verbatim; validated by src/report/controls.ts. */\n` +
    `export const FINDING_CONTROLS_RAW: unknown = ${JSON.stringify(findingControls, null, 2)};\n`,
  'utf8',
);
process.stderr.write(
  `embed-annex: ${rows.length} annex rows, ${atlas.length} ATLAS/OWASP rows @ ${pin.slice(0, 8)} from ${tree}\n`,
);
