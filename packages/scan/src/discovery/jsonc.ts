/**
 * JSON with comments and trailing commas, as VS Code, Cursor and Zed write it.
 *
 * The stripper removes `//` and `/* *\/` comments and a comma that directly precedes `}` or
 * `]`, outside strings only, then hands the text to `JSON.parse`. It is written here rather
 * than taken from a dependency because this package carries no runtime dependency beyond the
 * MCP SDK. It changes nothing inside a string: a URL such as `"https://x"` keeps its `//`.
 */

export class JsonUnreadable extends Error {
  override readonly name = 'JsonUnreadable';
}

export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      // Copy the whole string, escapes included, untouched.
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        j += text[j] === '\\' ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new JsonUnreadable('a /* comment is never closed');
      // Keep line breaks so a JSON.parse position still points near the right line.
      out += text.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 2;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      // Look past whitespace and comments for the next significant character.
      for (;;) {
        while (j < n && /\s/.test(text[j] ?? '')) j += 1;
        if (text[j] === '/' && text[j + 1] === '/') {
          while (j < n && text[j] !== '\n') j += 1;
          continue;
        }
        if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2);
          if (end === -1) break;
          j = end + 2;
          continue;
        }
        break;
      }
      if (text[j] === '}' || text[j] === ']') {
        i += 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

export function parseJsonc(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(text));
    return parsed;
  } catch (err) {
    if (err instanceof JsonUnreadable) throw err;
    throw new JsonUnreadable(err instanceof Error ? err.message : String(err));
  }
}
