import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignNames, NAME_PATTERN, normaliseName, plain, toolId } from './names.js';

test('a name outside the key grammar is lowercased, its runs replaced by one _, cut at 32', () => {
  assert.equal(normaliseName('Create Issue'), 'create_issue');
  assert.equal(normaliseName('github.search..code'), 'github_search_code');
  assert.equal(normaliseName('!!!'), '_');
  const long = normaliseName('A'.repeat(40));
  assert.equal(long.length, 32);
  for (const n of ['Create Issue', 'x.y/z', '', 'ÉCRIRE', 'A'.repeat(40)]) {
    assert.match(normaliseName(n), NAME_PATTERN, n);
  }
});

test('two names that normalise to one key are both kept, and the collision is recorded', () => {
  const m = assignNames(['search_code', 'search.code', 'read_email', 'search_code'].map(plain));
  assert.equal(m.map.size, 3, 'identical originals are one name; distinct ones are never merged');
  assert.equal(m.map.get('search.code'), 'search_code');
  assert.equal(m.map.get('search_code'), 'search_code_2');
  assert.deepEqual(m.collisions, [
    {
      normalised: 'search_code',
      originals: [
        { id: 'search.code', original: 'search.code', assigned: 'search_code' },
        { id: 'search_code', original: 'search_code', assigned: 'search_code_2' },
      ],
    },
  ]);
  assert.equal(new Set(m.map.values()).size, m.map.size, 'every key is distinct');
});

test('a suffix never lands on a key another name already holds, and stays within 32', () => {
  const long = 'x'.repeat(32);
  const m = assignNames(['a b', 'a.b', 'a_b_2', `${long}!`, `${long}?`].map(plain));
  const keys = [...m.map.values()];
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, NAME_PATTERN);
  assert.equal(m.map.get('a_b_2'), 'a_b_2');
});

test('one tool name on two servers is two tools, and two keys', () => {
  const a = toolId('github', 'search');
  const b = toolId('gitlab', 'search');
  const m = assignNames([
    { id: b, name: 'search' },
    { id: a, name: 'search' },
    { id: a, name: 'search' },
  ]);
  assert.equal(m.map.size, 2);
  assert.equal(m.map.get(a), 'search');
  assert.equal(m.map.get(b), 'search_2');
  assert.equal(m.collisions.length, 1);
});
