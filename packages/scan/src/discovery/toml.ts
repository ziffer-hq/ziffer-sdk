/**
 * A SHAPE-BOUND TOML READER, NOT A TOML PARSER.
 *
 * It reads exactly the shapes a Codex `config.toml` carries in the fixtures under
 * `fixtures/clients/codex-cli/`: `[table]` and `[a.b."c"]` headers, `[[array.of.tables]]`,
 * `key = value` with bare or quoted keys, and values that are basic or literal strings,
 * integers, floats, booleans, arrays of those (on one line or spread over several), and
 * one-line inline tables. Anything else -- multi-line strings, dates, a key defined twice --
 * is refused by name, `TomlShapeUnsupported`, with the file and line, rather than read
 * approximately. A reader that guesses would report servers a client does not run.
 *
 * It exists because this package takes no runtime dependency beyond the MCP SDK.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlShapeUnsupported extends Error {
  override readonly name = 'TomlShapeUnsupported';
  constructor(
    readonly path: string,
    readonly line: number,
    detail: string,
  ) {
    super(`${path}:${line}: ${detail}`);
  }
}

function isTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Cursor {
  pos = 0;
  constructor(
    readonly src: string,
    readonly fail: (detail: string) => never,
  ) {}
  peek(): string | undefined {
    return this.src[this.pos];
  }
  skipWs(newlines: boolean): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || (newlines && (c === '\n' || c === '\r'))) {
        this.pos += 1;
      } else if (c === '#') {
        while (this.pos < this.src.length && this.peek() !== '\n') this.pos += 1;
      } else {
        return;
      }
    }
  }
}

function readKeyPart(cur: Cursor): string {
  const c = cur.peek();
  if (c === '"') return readBasicString(cur);
  if (c === "'") return readLiteralString(cur);
  const m = /^[A-Za-z0-9_-]+/.exec(cur.src.slice(cur.pos));
  if (m === null) cur.fail(`expected a key at "${cur.src.slice(cur.pos, cur.pos + 20)}"`);
  cur.pos += m[0].length;
  return m[0];
}

function readDottedKey(cur: Cursor): string[] {
  const parts = [readKeyPart(cur)];
  for (;;) {
    cur.skipWs(false);
    if (cur.peek() !== '.') return parts;
    cur.pos += 1;
    cur.skipWs(false);
    parts.push(readKeyPart(cur));
  }
}

function readBasicString(cur: Cursor): string {
  if (cur.src.startsWith('"""', cur.pos)) cur.fail('multi-line strings are not a shape this reader takes');
  cur.pos += 1;
  let out = '';
  for (;;) {
    const c = cur.peek();
    if (c === undefined || c === '\n') cur.fail('a string is never closed on its line');
    cur.pos += 1;
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = cur.peek();
    cur.pos += 1;
    switch (e) {
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'u': {
        const hex = cur.src.slice(cur.pos, cur.pos + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) cur.fail('a \\u escape needs four hex digits');
        out += String.fromCharCode(parseInt(hex, 16));
        cur.pos += 4;
        break;
      }
      default:
        cur.fail(`the escape \\${e ?? ''} is not a shape this reader takes`);
    }
  }
}

function readLiteralString(cur: Cursor): string {
  if (cur.src.startsWith("'''", cur.pos)) cur.fail('multi-line strings are not a shape this reader takes');
  const end = cur.src.indexOf("'", cur.pos + 1);
  const nl = cur.src.indexOf('\n', cur.pos + 1);
  if (end === -1 || (nl !== -1 && nl < end)) cur.fail('a string is never closed on its line');
  const s = cur.src.slice(cur.pos + 1, end);
  cur.pos = end + 1;
  return s;
}

function readValue(cur: Cursor): TomlValue {
  const c = cur.peek();
  if (c === '"') return readBasicString(cur);
  if (c === "'") return readLiteralString(cur);
  if (c === '[') {
    cur.pos += 1;
    const arr: TomlValue[] = [];
    for (;;) {
      cur.skipWs(true);
      if (cur.peek() === ']') {
        cur.pos += 1;
        return arr;
      }
      arr.push(readValue(cur));
      cur.skipWs(true);
      if (cur.peek() === ',') {
        cur.pos += 1;
        continue;
      }
      if (cur.peek() === ']') {
        cur.pos += 1;
        return arr;
      }
      cur.fail('an array element is followed by neither "," nor "]"');
    }
  }
  if (c === '{') {
    cur.pos += 1;
    const t: TomlTable = {};
    cur.skipWs(false);
    if (cur.peek() === '}') {
      cur.pos += 1;
      return t;
    }
    for (;;) {
      cur.skipWs(false);
      const key = readDottedKey(cur);
      cur.skipWs(false);
      if (cur.peek() !== '=') cur.fail('an inline-table key is not followed by "="');
      cur.pos += 1;
      cur.skipWs(false);
      assign(t, key, readValue(cur), cur);
      cur.skipWs(false);
      if (cur.peek() === ',') {
        cur.pos += 1;
        continue;
      }
      if (cur.peek() === '}') {
        cur.pos += 1;
        return t;
      }
      cur.fail('an inline table must close on its own line with "}"');
    }
  }
  const m = /^[^\s,\]}#]+/.exec(cur.src.slice(cur.pos));
  if (m === null) cur.fail('a key has no value');
  const word = m[0];
  cur.pos += word.length;
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (/^[+-]?(0|[1-9](_?[0-9])*)$/.test(word)) return Number(word.replace(/_/g, ''));
  if (/^[+-]?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(word)) return Number(word);
  return cur.fail(`the value ${word} is not a shape this reader takes (dates and hex numbers are refused)`);
}

function assign(table: TomlTable, key: string[], value: TomlValue, cur: Cursor): void {
  let t = table;
  for (const part of key.slice(0, -1)) {
    const next = t[part];
    if (next === undefined) {
      const created: TomlTable = {};
      t[part] = created;
      t = created;
    } else if (isTable(next)) {
      t = next;
    } else {
      cur.fail(`the key ${part} is already a value, not a table`);
    }
  }
  const last = key[key.length - 1];
  if (last === undefined) cur.fail('an empty key');
  if (last in t) cur.fail(`the key ${key.join('.')} is defined twice`);
  t[last] = value;
}

function tableAt(root: TomlTable, key: string[], cur: Cursor): TomlTable {
  let t = root;
  for (const part of key) {
    const next = t[part];
    if (next === undefined) {
      const created: TomlTable = {};
      t[part] = created;
      t = created;
    } else if (isTable(next)) {
      t = next;
    } else if (Array.isArray(next)) {
      // A [[x]] earlier: a sub-table header applies to the last element.
      const lastEl = next[next.length - 1];
      if (!isTable(lastEl)) cur.fail(`the key ${part} is an array of values, not of tables`);
      t = lastEl;
    } else {
      cur.fail(`the key ${part} is already a value, not a table`);
    }
  }
  return t;
}

export function readToml(text: string, path: string): TomlTable {
  const root: TomlTable = {};
  let current = root;
  const lineOf = (pos: number): number => text.slice(0, pos).split('\n').length;
  const cur: Cursor = new Cursor(text, (detail) => {
    throw new TomlShapeUnsupported(path, lineOf(cur.pos), detail);
  });
  for (;;) {
    cur.skipWs(true);
    const c = cur.peek();
    if (c === undefined) return root;
    if (c === '[') {
      const isArray = text.startsWith('[[', cur.pos);
      cur.pos += isArray ? 2 : 1;
      cur.skipWs(false);
      const key = readDottedKey(cur);
      cur.skipWs(false);
      if (!text.startsWith(isArray ? ']]' : ']', cur.pos)) cur.fail('a table header is never closed');
      cur.pos += isArray ? 2 : 1;
      if (isArray) {
        const parent = tableAt(root, key.slice(0, -1), cur);
        const last = key[key.length - 1] ?? '';
        const existing = parent[last];
        const el: TomlTable = {};
        if (existing === undefined) parent[last] = [el];
        else if (Array.isArray(existing)) existing.push(el);
        else cur.fail(`the key ${key.join('.')} is already a table, not an array of tables`);
        current = el;
      } else {
        current = tableAt(root, key, cur);
      }
    } else {
      const key = readDottedKey(cur);
      cur.skipWs(false);
      if (cur.peek() !== '=') cur.fail('a key is not followed by "="');
      cur.pos += 1;
      cur.skipWs(false);
      assign(current, key, readValue(cur), cur);
    }
    cur.skipWs(false);
    const end = cur.peek();
    if (end !== undefined && end !== '\n' && end !== '\r') cur.fail('unexpected text after a value');
  }
}
