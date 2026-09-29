/**
 * The path grammar of `data/clients.json`, resolved against a home, a working directory and
 * an environment the CALLER passes -- never `process.env` or `os.homedir()` read here, so a
 * test can point a whole scan at a fixture home and a Windows layout can be exercised on any
 * machine.
 *
 * Separators are normalised to `/`. Node's file functions accept `/` on Windows, and one
 * separator means one joining rule for all three platforms.
 */

import { readdirSync } from 'node:fs';
import { posix } from 'node:path';

export type Resolved = { ok: true; path: string } | { ok: false; reason: string };

function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

export function resolveTemplate(
  template: string,
  home: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Resolved {
  const bases: Array<[string, () => string | undefined]> = [
    ['~/', () => home],
    ['./', () => cwd],
    ['%APPDATA%/', () => env['APPDATA']],
    ['%USERPROFILE%/', () => env['USERPROFILE'] ?? home],
  ];
  for (const [prefix, base] of bases) {
    if (!template.startsWith(prefix)) continue;
    const b = base();
    if (b === undefined || b === '') {
      return { ok: false, reason: `${prefix.slice(0, -1)} is not set, so this path cannot be resolved` };
    }
    return { ok: true, path: posix.join(norm(b), template.slice(prefix.length)) };
  }
  return { ok: false, reason: 'the path starts with no prefix the data file grammar allows' };
}

export class GlobShapeUnsupported extends Error {
  override readonly name = 'GlobShapeUnsupported';
}

/**
 * Expands the two glob shapes the data file uses and no others: a final segment `*.ext`, and
 * `dir/**\/name` (name at any depth below dir). Symbolic links to directories are not
 * followed, so a link cycle in a plugin cache cannot hang the scan. Missing directories
 * expand to nothing. The result is sorted, so the output order does not depend on the file
 * system's.
 */
export function expandGlob(path: string): string[] {
  if (!path.includes('*')) return [path];
  const deep = path.indexOf('/**/');
  if (deep !== -1) {
    const base = path.slice(0, deep);
    const name = path.slice(deep + 4);
    if (base.includes('*') || name.includes('*') || name.includes('/')) {
      throw new GlobShapeUnsupported(`${path}: only dir/**/name is supported`);
    }
    const found: string[] = [];
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = posix.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === name && (e.isFile() || e.isSymbolicLink())) found.push(full);
      }
    };
    walk(base);
    return found.sort();
  }
  const dir = posix.dirname(path);
  const last = posix.basename(path);
  const m = /^\*(\.[A-Za-z0-9]+)$/.exec(last);
  if (m === null || dir.includes('*')) throw new GlobShapeUnsupported(`${path}: only a final *.ext segment is supported`);
  const ext = m[1] ?? '';
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(ext) && e.name.length > ext.length)
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.sort().map((n) => posix.join(dir, n));
}
