import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JsonUnreadable, parseJsonc } from './jsonc.js';
import { TomlShapeUnsupported, readToml } from './toml.js';
import { YamlShapeUnsupported, readYaml } from './yaml.js';

test('jsonc: comments and trailing commas go, strings keep their // and /*', () => {
  const v = parseJsonc('{\n // c\n "u": "https://x/*y*/", /* b */ "a": [1, 2,],\n}');
  assert.deepEqual(v, { u: 'https://x/*y*/', a: [1, 2] });
});

test('jsonc: a string with an escaped quote is copied intact', () => {
  assert.deepEqual(parseJsonc('{"a": "x\\"// y",}'), { a: 'x"// y' });
});

test('jsonc: broken JSON is refused by name', () => {
  assert.throws(() => parseJsonc('{"a": '), JsonUnreadable);
  assert.throws(() => parseJsonc('{ /* never closed '), JsonUnreadable);
});

test('toml: tables, quoted keys, strings, numbers, arrays, inline tables, arrays of tables', () => {
  const v = readToml(
    [
      'a = "x\\ty" # comment',
      "[t.'q k']",
      'n = 3',
      'f = 4.5',
      'b = true',
      'arr = [',
      '  "1", # c',
      '  "2",',
      ']',
      'inl = { "K" = "v", j = 1 }',
      '[[list]]',
      'x = 1',
      '[[list]]',
      'x = 2',
    ].join('\n'),
    'f.toml',
  );
  assert.deepEqual(v, {
    a: 'x\ty',
    t: { 'q k': { n: 3, f: 4.5, b: true, arr: ['1', '2'], inl: { K: 'v', j: 1 } } },
    list: [{ x: 1 }, { x: 2 }],
  });
});

test('toml: shapes outside the reader are refused with file and line', () => {
  const cases: Array<[string, number]> = [
    ['a = """\nx\n"""', 1],
    ['\nd = 1979-05-27', 2],
    ['a = 1\na = 2', 2],
    ['a = "open', 1],
    ['a = 1 b', 1],
  ];
  for (const [src, line] of cases) {
    assert.throws(
      () => readToml(src, 'c.toml'),
      (e: unknown) => e instanceof TomlShapeUnsupported && e.line === line && e.message.startsWith(`c.toml:${line}:`),
      src,
    );
  }
});

test('yaml: mappings, sequences of mappings, scalars, flow collections, comments', () => {
  const v = readYaml(
    [
      '# top',
      'name: "a: b" # trailing',
      'n: 3',
      'on: true',
      'nothing: ~',
      'list:',
      '  - name: one',
      '    args:',
      '      - -y',
      "      - 'it''s'",
      '  - two',
      'same-indent:',
      '- x',
      'flow: [a, "b c", 1]',
      'fmap: { K: v, J: "w" }',
      'empty: {}',
    ].join('\n'),
    'f.yaml',
  );
  assert.deepEqual(v, {
    name: 'a: b',
    n: 3,
    on: true,
    nothing: null,
    list: [{ name: 'one', args: ['-y', "it's"] }, 'two'],
    'same-indent': ['x'],
    flow: ['a', 'b c', 1],
    fmap: { K: 'v', J: 'w' },
    empty: {},
  });
});

test('yaml: shapes outside the reader are refused with file and line', () => {
  const cases: Array<[string, number]> = [
    ['a: |\n  x', 1],
    ['a: &x 1', 1],
    ['a: !!str 1', 1],
    ['a: 1\n---\nb: 2', 2],
    ['a:\n\tb: 1', 2],
    ['a: 1\na: 2', 2],
    ['a: [[1]]', 1],
    ['a:\n    b: 1\n  c: 2', 3],
  ];
  for (const [src, line] of cases) {
    assert.throws(
      () => readYaml(src, 'c.yaml'),
      (e: unknown) => e instanceof YamlShapeUnsupported && e.line === line && e.message.startsWith(`c.yaml:${line}:`),
      src,
    );
  }
});
