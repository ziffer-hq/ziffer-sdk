import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadRedactData, parseRedactData, REDACT_DATA_URL, RedactDataInvalid, redactArgv, redactDeep, redactEnv, redactText } from './index.js';

const R = '[redacted]';
const DATA: unknown = JSON.parse(readFileSync(REDACT_DATA_URL, 'utf8'));
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

test('every flag form: --name=value, --name value, NAME=value, Name: value, and a bare value by its prefix', () => {
  assert.deepEqual(
    redactArgv(['npx', '-y', 'pkg', '--api-key=sk_test_abc', '--access-token', 'sntryu_abc', '--port', '8080']),
    ['npx', '-y', 'pkg', `--api-key=${R}`, '--access-token', R, '--port', '8080'],
  );
  assert.deepEqual(redactArgv(['--token', 'plain-value-no-prefix']), ['--token', R]);
  assert.deepEqual(redactArgv(['-e', 'GITHUB_TOKEN=abc', 'IMAGE=ghcr.io/x']), ['-e', `GITHUB_TOKEN=${R}`, 'IMAGE=ghcr.io/x']);
  assert.deepEqual(redactArgv(['--header', 'Authorization: Bearer abc']), ['--header', `Authorization: ${R}`]);
  assert.deepEqual(redactArgv(['--config=ghp_abc']), [`--config=${R}`]);
  for (const bare of ['sk_live_x', 'sk-proj-x', 'sntrys_x', 'ghp_x', 'gho_x', 'github_pat_x', 'xoxb-1-2', 'xoxp-1', 'AKIAABCDEFGH', 'glpat-x', 'npm_x', 'eyJhbGciOi.eyJzdWIi.sig']) {
    assert.deepEqual(redactArgv(['run', bare]), ['run', R], bare);
  }
  // A flag with no credential word, and a flag followed by another flag, are shown as they are.
  assert.deepEqual(redactArgv(['--auth', '--verbose', 'task-runner']), ['--auth', '--verbose', 'task-runner']);
});

test('running text: a URL query, userinfo, a flag in prose, and a prefix anywhere', () => {
  assert.equal(redactText('at https://h.test/mcp?api_key=abc&x=1;'), `at https://h.test/mcp?api_key=${R}&x=1;`);
  assert.equal(redactText('https://me:hunter2@h.test/'), `https://me:${R}@h.test/`);
  assert.equal(redactText('ran --access-token abc then'), `ran --access-token ${R} then`);
  assert.equal(redactText('key is sk-abc123, done'), `key is ${R}, done`);
  assert.equal(redactText('a risk-free task-list'), 'a risk-free task-list');
  assert.equal(redactText(R), R);
});

test('every environment value is replaced, whatever its name', () => {
  assert.deepEqual(redactEnv({ DEBUG: '1', HOME_DIR: '/x', X_API_KEY: 'abc' }), [`DEBUG=${R}`, `HOME_DIR=${R}`, `X_API_KEY=${R}`]);
});

test('a JSON value is redacted at every depth, keys included', () => {
  assert.deepEqual(redactDeep({ a: ['sk_x', { 'ghp_k': 'token=abc' }], n: 1 }), { a: [R, { [R]: `token=${R}` }], n: 1 });
});

test('the rules are data/redact.json: a prefix added there is redacted, and no source file carries one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ziffer-scan-redact-'));
  try {
    const file = join(dir, 'redact.json');
    const raw = DATA;
    assert.ok(typeof raw === 'object' && raw !== null);
    const prefixes: unknown = Reflect.get(raw, 'value_prefixes');
    assert.ok(Array.isArray(prefixes));
    writeFileSync(file, JSON.stringify({ ...raw, value_prefixes: [...prefixes, 'zzfixture_'] }));
    const custom = loadRedactData(pathToFileURL(file));
    assert.equal(redactText('x zzfixture_abc', custom), `x ${R}`);
    assert.equal(redactText('x zzfixture_abc'), 'x zzfixture_abc');
    assert.deepEqual(loadRedactData().valuePrefixes, prefixes);
    assert.deepEqual(loadRedactData().flagWords, Reflect.get(raw, 'flag_words'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // No second copy: the prefixes the data file names appear in no shipped source file.
  const literal = ['sntryu_', 'sntrys_', 'github_pat_', 'glpat-', 'xox[abp]-'];
  const offending: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.test.data.ts')) {
        const text = readFileSync(p, 'utf8');
        for (const l of literal) if (text.includes(l)) offending.push(`${p}: ${l}`);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offending, []);
});

test('a data file the code cannot use is refused by name', () => {
  assert.throws(() => parseRedactData({ replacement: R, flag_words: [], value_prefixes: ['a'] }), RedactDataInvalid);
  assert.throws(() => parseRedactData({ replacement: R, flag_words: ['key'], value_prefixes: ['('] }), RedactDataInvalid);
  assert.throws(() => parseRedactData({ replacement: '', flag_words: ['key'], value_prefixes: ['sk_'] }), RedactDataInvalid);
});
