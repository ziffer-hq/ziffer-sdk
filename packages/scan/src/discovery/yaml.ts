/**
 * A SHAPE-BOUND YAML READER, NOT A YAML PARSER.
 *
 * It reads exactly the shapes the Continue and Goose files in `fixtures/clients/` carry: block
 * mappings, block sequences (including a mapping that starts on the `- ` line), plain,
 * single-quoted and double-quoted scalars, `#` comments, and one-line flow collections of
 * scalars (`["-y", pkg]`, `{}`, `{ KEY: value }`). Anything else -- block scalars (`|`, `>`),
 * anchors and aliases, tags, several documents, tab indentation, a key defined twice -- is
 * refused by name, `YamlShapeUnsupported`, with the file and line. A reader that guessed at
 * YAML it does not understand would report servers a client does not run, or miss ones it
 * does, and say nothing about either.
 *
 * Plain scalars `true`/`false` become booleans, `null`/`~` null, and decimal integers
 * numbers; every other plain scalar stays a string. It exists because this package takes no
 * runtime dependency beyond the MCP SDK.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

export class YamlShapeUnsupported extends Error {
  override readonly name = 'YamlShapeUnsupported';
  constructor(
    readonly path: string,
    readonly line: number,
    detail: string,
  ) {
    super(`${path}:${line}: ${detail}`);
  }
}

interface Line {
  indent: number;
  text: string;
  no: number;
}

/** Index of a `#` that starts a comment (outside quotes, after whitespace), or -1. */
function commentStart(s: string): number {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote !== null) {
      if (c === '\\' && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return i;
    }
  }
  return -1;
}

/** Index of the `:` that separates a mapping key from its value, or -1. */
function keySeparator(s: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote !== null) {
      if (c === '\\' && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && i === 0) {
      quote = c;
    } else if (c === '[' || c === '{') {
      depth += 1;
    } else if (c === ']' || c === '}') {
      depth -= 1;
    } else if (c === ':' && depth === 0 && (i + 1 === s.length || s[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

class Reader {
  i = 0;
  constructor(
    readonly lines: Line[],
    readonly path: string,
  ) {}

  fail(no: number, detail: string): never {
    throw new YamlShapeUnsupported(this.path, no, detail);
  }

  scalar(raw: string, no: number): YamlValue {
    const s = raw.trim();
    if (s === '') return null;
    const first = s[0];
    if (first === '"') {
      let out = '';
      let i = 1;
      for (;;) {
        const c = s[i];
        if (c === undefined) this.fail(no, 'a double-quoted string is never closed on its line');
        if (c === '"') break;
        if (c === '\\') {
          const e = s[i + 1];
          const map: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t', '/': '/' };
          const v = e === undefined ? undefined : map[e];
          if (v === undefined) this.fail(no, `the escape \\${e ?? ''} is not a shape this reader takes`);
          out += v;
          i += 2;
          continue;
        }
        out += c;
        i += 1;
      }
      if (s.slice(i + 1).trim() !== '') this.fail(no, 'text after a quoted string');
      return out;
    }
    if (first === "'") {
      if (!s.endsWith("'") || s.length < 2) this.fail(no, 'a single-quoted string is never closed on its line');
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (first === '[' || first === '{') return this.flow(s, no);
    if (first === '|' || first === '>') this.fail(no, 'block scalars (| and >) are not a shape this reader takes');
    if (first === '&' || first === '*') this.fail(no, 'anchors and aliases are not a shape this reader takes');
    if (first === '!') this.fail(no, 'tags are not a shape this reader takes');
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    if (/^-?(0|[1-9][0-9]*)$/.test(s)) return Number(s);
    return s;
  }

  /** One-line flow collections whose members are scalars. Nested flow is refused. */
  flow(s: string, no: number): YamlValue {
    const open = s[0];
    const close = open === '[' ? ']' : '}';
    if (!s.endsWith(close)) this.fail(no, 'a flow collection must close on its own line');
    const inner = s.slice(1, -1).trim();
    const items: string[] = [];
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < inner.length; i += 1) {
      const c = inner[i];
      if (quote !== null) {
        if (c === '\\' && quote === '"') i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '[' || c === '{') {
        this.fail(no, 'nested flow collections are not a shape this reader takes');
      } else if (c === ',') {
        items.push(inner.slice(start, i));
        start = i + 1;
      }
    }
    if (inner !== '') items.push(inner.slice(start));
    if (open === '[') return items.map((it) => this.scalar(it, no));
    const map: YamlMap = {};
    for (const it of items) {
      const sep = keySeparator(it.trim());
      if (sep === -1) this.fail(no, 'a flow mapping entry has no ": "');
      const t = it.trim();
      const key = this.key(t.slice(0, sep), no);
      if (key in map) this.fail(no, `the key ${key} is defined twice`);
      map[key] = this.scalar(t.slice(sep + 1), no);
    }
    return map;
  }

  key(raw: string, no: number): string {
    const k = this.scalar(raw, no);
    if (typeof k === 'string') return k;
    if (typeof k === 'number' || typeof k === 'boolean') return String(k);
    return this.fail(no, 'a mapping key must be a scalar');
  }

  isSeqItem(text: string): boolean {
    return text === '-' || text.startsWith('- ');
  }

  block(indent: number): YamlValue {
    const line = this.lines[this.i];
    if (line === undefined || line.indent < indent) return null;
    if (line.indent > indent) this.fail(line.no, 'indentation deeper than its parent expects');
    return this.isSeqItem(line.text) ? this.sequence(indent) : this.mapping(indent);
  }

  sequence(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    for (;;) {
      const line = this.lines[this.i];
      if (line === undefined || line.indent < indent) return out;
      if (line.indent > indent) this.fail(line.no, 'indentation deeper than its parent expects');
      if (!this.isSeqItem(line.text)) return out;
      const rest = line.text.slice(1).replace(/^ +/, '');
      if (rest === '') {
        this.i += 1;
        const next = this.lines[this.i];
        out.push(next !== undefined && next.indent > indent ? this.block(next.indent) : null);
        continue;
      }
      const offset = line.text.length - rest.length;
      if (this.isSeqItem(rest) || keySeparator(rest) !== -1) {
        // "- key: value" or "- - x": the item is a block starting at the content's column.
        this.lines[this.i] = { indent: indent + offset, text: rest, no: line.no };
        out.push(this.block(indent + offset));
        continue;
      }
      out.push(this.scalar(rest, line.no));
      this.i += 1;
    }
  }

  mapping(indent: number): YamlMap {
    const out: YamlMap = {};
    for (;;) {
      const line = this.lines[this.i];
      if (line === undefined || line.indent < indent) return out;
      if (line.indent > indent) this.fail(line.no, 'indentation deeper than its parent expects');
      if (this.isSeqItem(line.text)) return out;
      const sep = keySeparator(line.text);
      if (sep === -1) this.fail(line.no, 'a line in a mapping has no "key: value"');
      const key = this.key(line.text.slice(0, sep), line.no);
      if (key in out) this.fail(line.no, `the key ${key} is defined twice`);
      const rest = line.text.slice(sep + 1).trim();
      this.i += 1;
      if (rest !== '') {
        out[key] = this.scalar(rest, line.no);
        continue;
      }
      const next = this.lines[this.i];
      if (next !== undefined && next.indent > indent) out[key] = this.block(next.indent);
      else if (next !== undefined && next.indent === indent && this.isSeqItem(next.text)) out[key] = this.sequence(indent);
      else out[key] = null;
    }
  }
}

export function readYaml(text: string, path: string): YamlValue {
  const lines: Line[] = [];
  const raw = text.split(/\r?\n/);
  raw.forEach((l, idx) => {
    const no = idx + 1;
    const lead = /^[ \t]*/.exec(l)?.[0] ?? '';
    if (lead.includes('\t')) throw new YamlShapeUnsupported(path, no, 'tab indentation is not a shape this reader takes');
    const c = commentStart(l);
    const body = (c === -1 ? l : l.slice(0, c)).trimEnd();
    if (body.trim() === '') return;
    if (body === '---' && lines.length === 0) return;
    if (body === '---' || body === '...') throw new YamlShapeUnsupported(path, no, 'several documents in one file are not a shape this reader takes');
    lines.push({ indent: lead.length, text: body.slice(lead.length), no });
  });
  const first = lines[0];
  if (first === undefined) return null;
  const reader = new Reader(lines, path);
  const value = reader.block(first.indent);
  const left = lines[reader.i];
  if (left !== undefined) reader.fail(left.no, 'indentation shallower than the document it belongs to');
  return value;
}
