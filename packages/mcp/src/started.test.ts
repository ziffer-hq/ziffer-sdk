/**
 * `get_started` serves facts that live elsewhere, so every test here compares
 * the served text against the thing it came from — the manifests on disk, this
 * package's own README, the guide, and `TOOL_NAMES`.
 *
 * That is the whole point of the module. A test that only asserted the answer
 * "mentions the version" would pass for a version nobody published, which is
 * the exact failure the build-time read exists to prevent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { VARS } from './config.js';
import { TOOL_NAMES } from './server.js';
import {
  getStarted,
  STARTED_INSTALLS,
  STARTED_SPAN_LIST,
  PUBLISHED,
  STARTED_START_HERE,
  TOOL_ORDER,
} from './started.js';
import { PROMPT_NAMES } from './prompts.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO, relative), 'utf8');

/** One marked span, sliced out of the file on disk — independently of the
 * embedded copy, which is the whole of the assertion. */
function spanOnDisk(path: string, name: string): string {
  const markdown = read(path);
  const open = `<!-- guide:${name} -->`;
  const close = `<!-- guide:/${name} -->`;
  const openAt = markdown.indexOf(open);
  const closeAt = markdown.indexOf(close);
  assert.ok(openAt !== -1 && closeAt > openAt, `${path} carries no complete guide:${name} span`);
  return markdown.slice(openAt + open.length, closeAt).trim();
}

test('every span get_started serves is the one on disk, byte for byte', () => {
  assert.ok(STARTED_SPAN_LIST.length > 0, 'no spans embedded at all');
  for (const span of STARTED_SPAN_LIST) {
    assert.equal(span.markdown, spanOnDisk(span.path, span.name), `${span.path}: guide:${span.name} drifted`);
  }
});

test('the served text carries both spans whole', () => {
  const { text } = getStarted();
  for (const span of STARTED_SPAN_LIST) {
    assert.ok(text.includes(span.markdown), `get_started drops the guide:${span.name} span`);
  }
});

test('the install command names the version the manifest publishes', () => {
  // Read from the manifests here, independently of the build script: if both
  // read the same file the same way, they agree; if the build ever starts
  // guessing, these two derivations part company.
  const pyproject = read('sdk/python/pyproject.toml');
  const pythonVersion = /^version\s*=\s*"([^"]+)"$/m.exec(pyproject);
  assert.ok(pythonVersion !== null, 'sdk/python/pyproject.toml has no plain version literal');

  const manifest: unknown = JSON.parse(read('packages/acp-client/package.json'));
  assert.ok(typeof manifest === 'object' && manifest !== null, 'the client manifest is not an object');
  const fields: Record<string, unknown> = { ...manifest };
  const name = fields['name'];
  const version = fields['version'];
  assert.equal(typeof name, 'string');
  assert.equal(typeof version, 'string');

  const python = STARTED_INSTALLS.find((install) => install.language === 'python');
  const typescript = STARTED_INSTALLS.find((install) => install.language === 'typescript');
  assert.ok(python !== undefined && typescript !== undefined, 'an install command is missing');
  assert.ok(
    python.command.endsWith(`==${pythonVersion[1] ?? ''}`),
    `python install is ${python.command}, not the pyproject version`,
  );
  assert.equal(typescript.command, `npm install ${String(name)}@${String(version)}`);

  const { text } = getStarted();
  assert.ok(text.includes(python.command), 'the answer does not carry the python install command');
  assert.ok(text.includes(typescript.command), 'the answer does not carry the typescript install command');
});

test('the four variables are VARS and the README table names exactly those four', () => {
  // The rule the module comment states, asserted in both directions. One
  // direction alone is how a variable comes to exist in code with no row
  // telling a developer where its value comes from -- or a row for a variable
  // nothing reads.
  const configuration = STARTED_SPAN_LIST.find((span) => span.name === 'configuration');
  assert.ok(configuration !== undefined, 'the configuration span is not embedded');
  for (const variable of Object.values(VARS)) {
    assert.ok(configuration.markdown.includes(variable), `the README table has no row for ${variable}`);
  }
  const named = new Set(configuration.markdown.match(/ZIFFER_[A-Z_]+/g) ?? []);
  assert.deepEqual([...named].sort(), [...Object.values(VARS)].sort());
});

test('every tool get_started tells an agent to call next is registered', () => {
  // `started.ts` retypes these names because importing TOOL_NAMES would be a
  // cycle. This is the executable consumer that makes the retyping safe: a
  // renamed tool is a red suite here rather than an answer sending an agent
  // somewhere that is not there.
  assert.ok(TOOL_ORDER.length > 0, 'the order is empty');
  for (const { tool, why } of TOOL_ORDER) {
    // `TOOL_NAMES` is `as const`, so `includes` narrows its argument to the
    // literal union and a plain string is rejected. Compared as strings here
    // rather than cast: a cast would make the assertion compile and stop
    // checking the thing it exists for.
    const registered: readonly string[] = TOOL_NAMES;
    assert.ok(registered.includes(tool), `get_started names ${tool}, which this server does not register`);
    assert.ok(why.length > 40, `${tool} has no usable reason beside it`);
  }
  const { text } = getStarted();
  for (const { tool } of TOOL_ORDER) assert.ok(text.includes(tool), `${tool} is not in the answer`);
});

test('it points at real account creation and never offers a sandbox as the way to start', () => {
  // A small check on a claim that would otherwise rot into prose. A sandbox is
  // a separate tenant a customer is GIVEN, and an agent told about one at step
  // zero plans an integration around approvals nobody made.
  const { text, isError } = getStarted();
  assert.equal(isError, false);
  // The published page, never the path in this repository: a developer has the
  // page and not our repository (ACP-467).
  assert.equal(STARTED_START_HERE, 'https://ziffer.io/docs/onboarding/start-here');
  assert.ok(text.includes(STARTED_START_HERE), 'the answer does not send anybody to the first-hour guide');
  assert.doesNotMatch(text, /sandbox/i, 'get_started offers a sandbox as a starting point');
});

test('every page get_started cites is the one the documentation site publishes', () => {
  // PUBLISHED maps a document to its page; tools/publish-docs.sh's TABLE is
  // what actually publishes it. A row that moves there and not here is a dead
  // link in the first answer a developer reads.
  const table = read('tools/publish-docs.sh');
  for (const [path, url] of Object.entries(PUBLISHED)) {
    if (!path.startsWith('docs/onboarding/')) continue;
    const file = path.slice('docs/onboarding/'.length);
    const row = new RegExp(`(?:^|')${file.replace('.', '\\.')}:([a-z/-]+):`, 'm').exec(table);
    assert.ok(row !== null, `${file} is not published by tools/publish-docs.sh`);
    assert.equal(url, `https://ziffer.io/docs/${row[1] ?? ''}`, `${file} is published elsewhere`);
  }
});

test('the answer names no path in this repository', () => {
  const { text } = getStarted();
  assert.doesNotMatch(text, /(?<![\w./@-])(?:docs|packages|services|tools|sdk)\//, 'get_started names a repository path');
});

test('the answer is the entry point of the setup_ziffer prompt, and names it', () => {
  const { text } = getStarted();
  assert.ok(PROMPT_NAMES.includes('setup_ziffer'));
  assert.match(text.split('\n').slice(0, 4).join(' '), /\bsetup_ziffer\b/, 'the prompt is not named at the top');
  for (const step of ['4. Get your key.', '5. The first proposal.', '6. The verified receipt.']) {
    assert.ok(text.includes(step), `the walkthrough stops before "${step}"`);
  }
});

test('step zero is the local scan, named as its manifest publishes it, before the account', () => {
  // The package name is read from the manifest that publishes it, for the same
  // reason the install versions are: a renamed package with this line unmoved
  // would send an agent to `npx` a name nobody publishes (ACP-446).
  const manifest: unknown = JSON.parse(read('packages/scan/package.json'));
  const name =
    typeof manifest === 'object' && manifest !== null && 'name' in manifest && typeof manifest.name === 'string'
      ? manifest.name
      : '';
  assert.equal(name, '@ziffer-io/scan');
  const lines = getStarted().text.split('\n');
  const zero = lines.findIndex((l) => l.startsWith('0. '));
  const one = lines.findIndex((l) => l.startsWith('1. '));
  assert.ok(zero >= 0 && zero < one, 'step zero is missing or comes after the account');
  // ACP-446 step 2: the step's FIRST line names the tool, because an agent
  // already talking to this server can call it; the npx command is the
  // alternative, anywhere in the step. Until step 2 the first line named the
  // npx command, and that is the assertion this one replaced.
  assert.ok(TOOL_NAMES.some((t) => t === 'scan'), 'step zero names a scan tool this server does not register');
  assert.match(lines[zero] ?? '', /\bthe scan tool\b/, 'step zero does not name the scan tool first');
  const step = lines.slice(zero, one).join(' ');
  assert.ok(step.includes(`npx ${name}`), `step zero does not name npx ${name} as the alternative`);
  assert.ok(step.includes('confirm: true'), 'step zero does not say the scan asks before it starts anything');
});

test('it answers with nothing configured, because it reads no environment at all', () => {
  // The inversion `config.ts` argues for, at the one tool a developer reaches
  // before any credential exists.
  const { text, isError } = getStarted();
  assert.equal(isError, false);
  assert.ok(text.length > 1000, `the answer is ${text.length} bytes, which is not a walkthrough`);
});
