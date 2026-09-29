/**
 * `Exposure.interception` and `CodeTool.interception` (ACP-455, 2026-09-28): where a check
 * can stand before a framework's tools run, as DATA, from the one table in
 * `data/code-sdks.json` (`interception`), for the TypeScript front end. The Python walker
 * reads the same table and applies the same rules (`interception_for` in
 * `py/ziffer_scan_code.py`). Both halves had written this into `via` and `note` text; the
 * text stays, and this is the field a report reads.
 */

import ts from 'typescript';

import { sdkEntry } from './sdks.js';
import type { Interception, SourceRef } from './types.js';
import { refOf } from './ts/util.js';

/**
 * The exposure's point by the framework's table. `markerAt` finds the first of the
 * framework's markers in the handing-over file; a recogniser with a closer reading (the
 * hook object on this very call) passes its own point instead and this is not called.
 */
export function exposurePoint(sdk: string, markerAt: (markers: readonly string[]) => SourceRef | undefined): Interception | undefined {
  const p = sdkEntry(sdk)?.interception;
  if (p === undefined) return undefined;
  if (p.kind === 'K4') return { kind: 'K4', name: p.name, present: true };
  if (p.kind === 'K3' || p.kind === 'K5') return { kind: p.kind, name: p.name, present: false };
  const at = p.markers.length === 0 ? undefined : markerAt(p.markers);
  return at === undefined ? { kind: p.kind, name: p.name, present: false } : { kind: p.kind, name: p.name, present: true, at };
}

/** A per-tool flag written off: `false`, `None`, `never`, `never_require`, as written, quoted or not. */
const OFF = /^["'`]?(false|False|None|null|undefined|never|never_require)["'`]?$/;

/**
 * A tool's own approval step (K2), from the authority claims its definition writes: the first
 * claim named by the framework's `tool_flags`. Absent when the framework has no per-tool flag
 * or the definition writes none.
 */
export function toolPoint(sdk: string, claims: readonly { name: string; value: string }[] | undefined, at: SourceRef): Interception | undefined {
  const flags = sdkEntry(sdk)?.interception?.tool_flags ?? [];
  const c = (claims ?? []).find((x) => flags.includes(x.name));
  if (c === undefined) return undefined;
  const present = !OFF.test(c.value.trim());
  return present ? { kind: 'K2', name: `${c.name} on this tool`, present, at } : { kind: 'K2', name: `${c.name} on this tool`, present };
}

/**
 * The first place in `sf` where one of `markers` is written as code: an identifier (a
 * property name, a call, a key) or a string literal spelled exactly so. Import declarations
 * are skipped: importing a hook is not registering one. Comments are not code.
 */
export function markerIn(sf: ts.SourceFile, root: string, markers: readonly string[]): SourceRef | undefined {
  const want = new Set(markers);
  const hit: { node?: ts.Node } = {};
  const visit = (n: ts.Node): void => {
    if (hit.node !== undefined || ts.isImportDeclaration(n)) return;
    if ((ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && want.has(n.text)) {
      hit.node = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hit.node === undefined ? undefined : refOf(root, hit.node);
}
