/**
 * ACP-460: the three signals that find a skill (`name`, `shape`, `code`), who loads it (`home`),
 * and the code's loads attached as `loaded_by`. Each rule has a case that finds it and a decoy
 * where it must not fire. The tree is an invented application, `corner-bookshop`, written to a
 * temporary folder.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';

import type { SkillLoad, SkillRead } from '../types.js';
import { readSkills } from './index.js';

const FENCE = '```';

const TREE: Record<string, string> = {
  // The application's own skills, in its source: read by name, home application.
  'api/src/agent/skills/order-desk/SKILL.md': [
    '---',
    'name: order-desk',
    "description: 'Activates when the bookseller asks about an order.'",
    'tools: findOrder, refund_order, shipParcel',
    '---',
    '# Order desk',
  ].join('\n'),
  'api/src/agent/skills/order-desk/scripts/label.sh': '#!/bin/sh\ncurl -s https://labels.invalid/print\n',
  'api/src/agent/skills/returns/SKILL.md': '# Returns\n\nTake a return at the counter.\n',
  // Skill-shaped files that are not called SKILL.md: read by shape. The shell script beside a loose
  // file is not the file's own: a loose prompt does not own its source folder.
  'api/src/agent/prompts/greeter.md': ['---', 'name: greeter', 'description: >', '  Greets a customer at the door.', '---', 'Say hello.'].join('\n'),
  'api/src/agent/prompts/send.sh': '#!/bin/sh\ncurl -s https://mail.invalid/send\n',
  'api/src/agent/prompts/till.prompt': ['---', 'name: till', 'description: Rings up a sale.', '---', 'Ring it up.'].join('\n'),
  // Decoys for shape: one key only, an empty name, no closing line, a file type that is not text a model is given.
  'api/src/agent/prompts/tone.txt': ['---', 'description: The shop voice.', '---', 'Warm.'].join('\n'),
  'api/src/agent/prompts/blank.md': ['---', "name: ''", 'description: A blank.', '---'].join('\n'),
  'api/src/agent/prompts/open.md': ['---', 'name: open', 'description: never closed'].join('\n'),
  'api/src/agent/prompts/shelf.yaml': ['---', 'name: shelf', 'description: A YAML file.', '---'].join('\n'),
  // Read only because the code loads them: one with a name (a skill), one without (instructions).
  'api/src/agent/prompts/house-rules.md': '# House rules\n\nNever sell a signed first edition below list.\n',
  'api/src/agent/prompts/closing.md': ['---', 'name: closing', '---', 'Close the till.'].join('\n'),
  // Under a coding assistant's folder: home assistant.
  '.claude/agents/reviewer.md': ['---', 'name: reviewer', 'description: Reviews a change.', 'tools: Read, Grep', '---', 'Review.'].join('\n'),
  '.gemini/skills/stock-count/SKILL.md': '# Stock count\n',
  '.codebuddy/skills/stock-count/SKILL.md': '# Stock count\n',
  '.windsurf/rules/style.md': ['---', 'name: style', 'description: House style.', '---'].join('\n'),
  // Under an assistant's folder, but the application's code loads it: home application.
  '.claude/skills/catalogue/SKILL.md': ['---', 'name: catalogue', 'description: The catalogue.', '---', `${FENCE}bash`, 'ls', FENCE].join('\n'),
  'CLAUDE.md': '# Corner bookshop\n',
  // The root's own skills folder is a collection published for assistants; the same file loaded by the code is the application's.
  'skills/gift-wrap/SKILL.md': '# Gift wrap\n',
  'skills/loyalty/SKILL.md': '# Loyalty\n',
  // The shape rule leaves out documentation, blog and content-site folders; a SKILL.md there is still read by name.
  'docs/authors/pat.md': ['---', 'name: Pat', 'description: Writes the newsletter.', '---'].join('\n'),
  'blog/2026/new-shelves.md': ['---', 'name: new-shelves', 'description: We have new shelves.', '---'].join('\n'),
  'site/content/team/lee.mdx': ['---', 'name: Lee', 'description: Runs the till.', '---'].join('\n'),
  'docs/skills/help/SKILL.md': ['---', 'name: help', 'description: Help pages.', '---'].join('\n'),
  // The walk's exclusions stay: dependencies, build output, test code, a nested checkout.
  // Each carries what shows it is one (ACP-476: a folder is skipped for what it holds, not its name).
  'node_modules/shelf-kit/skills/dep/SKILL.md': '# A dependency\n',
  'node_modules/shelf-kit/package.json': '{ "name": "shelf-kit" }\n',
  'dist/skills/built/SKILL.md': '# Build output\n',
  'dist/index.js.map': '{}\n',
  'api/tests/skills/fixture/SKILL.md': '# Test code\n',
  'api/tests/load.test.ts': "import { test } from 'node:test';\n",
  'api/src/agent/prompts/__tests__/case.md': ['---', 'name: case', 'description: A test case.', '---'].join('\n'),
  'api/src/agent/prompts/__tests__/case.test.ts': "import { test } from 'node:test';\n",
  'old-copy/.git': 'gitdir: /elsewhere/.git/worktrees/old-copy\n',
  'old-copy/api/src/agent/skills/order-desk/SKILL.md': '# A nested checkout\n',
};

const at = (file: string, line: number): SkillLoad['at'] => ({ file, line });
const LOADS: SkillLoad[] = [
  { path: 'api/src/agent/skills/order-desk/SKILL.md', how: 'read', at: at('api/src/agent/load.ts', 12) },
  { path: 'api/src/agent/prompts/house-rules.md', how: 'read', at: at('api/src/agent/load.ts', 20), reaches: { kind: 'instructions', at: at('api/src/agent/run.ts', 4), via: 'system' } },
  { path: 'api/src/agent/prompts/closing.md', how: 'imported', at: at('api/src/agent/load.ts', 2) },
  { path: '.claude/skills/catalogue/SKILL.md', how: 'embedded', at: at('api/src/agent/registry.ts', 1) },
  { path: '.claude/skills/catalogue/SKILL.md', how: 'read', at: at('api/src/agent/load.ts', 30) },
  { path: 'skills/loyalty/SKILL.md', how: 'read', at: at('api/src/agent/load.ts', 50) },
  // Decoys: a load outside the root, and one naming a file that is not there.
  { path: '../outside.md', how: 'read', at: at('api/src/agent/load.ts', 40) },
  { path: 'api/src/agent/prompts/gone.md', how: 'read', at: at('api/src/agent/load.ts', 41) },
];

let root = '';
let skills: SkillRead[] = [];
let withoutLoads: SkillRead[] = [];
const byPath = (list: SkillRead[], p: string): SkillRead => {
  const s = list.find((x) => x.path === p);
  assert.ok(s !== undefined, `${p} not read; read: ${list.map((x) => x.path).join(', ')}`);
  return s;
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skills-460walk-'));
  for (const [p, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  writeFileSync(join(dirname(root), 'outside.md'), '# Outside the root\n');
  skills = readSkills(root, LOADS);
  withoutLoads = readSkills(root);
});

test('name: a SKILL.md inside the application\'s own source is read, home application', () => {
  const s = byPath(skills, 'api/src/agent/skills/order-desk/SKILL.md');
  assert.equal(s.kind, 'skill');
  assert.equal(s.home, 'application');
  assert.deepEqual(s.declares, ['findOrder', 'refund_order', 'shipParcel']);
  const r = byPath(withoutLoads, 'api/src/agent/skills/returns/SKILL.md');
  assert.deepEqual([r.name, r.found_by, r.home], ['returns', ['name'], 'application']);
});

test('name: the scripts in a SKILL.md folder are read; decoy: the script beside a loose skill-shaped file is not', () => {
  assert.ok(byPath(skills, 'api/src/agent/skills/order-desk/SKILL.md').exercises.some((x) => x.file.endsWith('scripts/label.sh') && x.capability === 'network'));
  assert.deepEqual(byPath(skills, 'api/src/agent/prompts/greeter.md').exercises, []);
});

test('shape: a .md with a folded description and a .prompt file are read as skills; decoys: one key, an empty name, no closing line, a .yaml file', () => {
  const g = byPath(withoutLoads, 'api/src/agent/prompts/greeter.md');
  assert.deepEqual([g.kind, g.name, g.found_by, g.home], ['skill', 'greeter', ['shape'], 'application']);
  assert.deepEqual(byPath(withoutLoads, 'api/src/agent/prompts/till.prompt').found_by, ['shape']);
  for (const p of ['tone.txt', 'blank.md', 'open.md', 'shelf.yaml']) assert.ok(!withoutLoads.some((s) => s.path === `api/src/agent/prompts/${p}`), p);
});

test('shape: a docs, blog or content-site page is left out; a SKILL.md in docs is still read, by name only', () => {
  for (const p of ['docs/authors/pat.md', 'blog/2026/new-shelves.md', 'site/content/team/lee.mdx']) assert.ok(!skills.some((s) => s.path === p), p);
  assert.deepEqual(byPath(skills, 'docs/skills/help/SKILL.md').found_by, ['name']);
});

test('found_by lists every signal, in order: a SKILL.md with both keys is name and shape', () => {
  assert.deepEqual(byPath(withoutLoads, 'api/src/agent/skills/order-desk/SKILL.md').found_by, ['name', 'shape']);
  assert.deepEqual(byPath(skills, 'api/src/agent/skills/order-desk/SKILL.md').found_by, ['name', 'shape', 'code']);
});

test('home: assistant under .claude, .gemini, .codebuddy, .windsurf and for an instruction file by name', () => {
  for (const p of ['.claude/agents/reviewer.md', '.gemini/skills/stock-count/SKILL.md', '.codebuddy/skills/stock-count/SKILL.md', '.windsurf/rules/style.md', 'CLAUDE.md']) {
    assert.equal(byPath(skills, p).home, 'assistant', p);
  }
  assert.deepEqual(byPath(skills, '.claude/agents/reviewer.md').found_by, ['shape']);
});

test('home: a SKILL.md in the root\'s own skills/ folder is assistant with no load, application with one; a skills/ folder deeper in the source stays application', () => {
  assert.equal(byPath(skills, 'skills/gift-wrap/SKILL.md').home, 'assistant');
  assert.equal(byPath(withoutLoads, 'skills/loyalty/SKILL.md').home, 'assistant', 'the same file with no load');
  const l = byPath(skills, 'skills/loyalty/SKILL.md');
  assert.deepEqual([l.home, l.found_by], ['application', ['name', 'code']]);
  assert.equal(byPath(withoutLoads, 'api/src/agent/skills/returns/SKILL.md').home, 'application');
});

test('code: a load under an assistant\'s folder makes it application; loaded_by holds every load of the path', () => {
  const s = byPath(skills, '.claude/skills/catalogue/SKILL.md');
  assert.equal(s.home, 'application');
  assert.deepEqual(s.found_by, ['name', 'shape', 'code']);
  assert.deepEqual(s.loaded_by?.map((l) => l.how), ['embedded', 'read']);
  assert.equal(byPath(withoutLoads, '.claude/skills/catalogue/SKILL.md').home, 'assistant', 'without the load it is the assistant\'s');
  assert.equal(byPath(withoutLoads, '.claude/skills/catalogue/SKILL.md').loaded_by, undefined);
});

test('code: a loaded file no name or shape finds is read: instructions without a front matter name, a skill with one', () => {
  const h = byPath(skills, 'api/src/agent/prompts/house-rules.md');
  assert.deepEqual([h.kind, h.found_by, h.home], ['instructions', ['code'], 'application']);
  assert.equal(h.loaded_by?.[0]?.reaches?.kind, 'instructions');
  const c = byPath(skills, 'api/src/agent/prompts/closing.md');
  assert.deepEqual([c.kind, c.name, c.found_by], ['skill', 'closing', ['code']]);
  assert.ok(!withoutLoads.some((s) => s.path === 'api/src/agent/prompts/house-rules.md'), 'without the load it is not read');
});

test('decoy: a load outside the root or of a missing file adds nothing; the walk\'s exclusions stay', () => {
  assert.ok(!skills.some((s) => s.path.startsWith('..') || s.path.endsWith('gone.md')));
  for (const p of ['node_modules/shelf-kit/skills/dep/SKILL.md', 'dist/skills/built/SKILL.md', 'api/tests/skills/fixture/SKILL.md', 'api/src/agent/prompts/__tests__/case.md', 'old-copy/api/src/agent/skills/order-desk/SKILL.md']) {
    assert.ok(!skills.some((s) => s.path === p), p);
  }
});

test('every entry carries home and found_by', () => {
  for (const s of skills) {
    assert.ok(s.home !== undefined && s.found_by !== undefined && s.found_by.length > 0, s.path);
  }
});
