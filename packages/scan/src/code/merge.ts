/**
 * One `CodeCatalog` from the two front ends (ACP-455): the TypeScript one
 * (`code/index.ts`, type checker on) and the Python one (`code/py/index.ts`,
 * `ast` in a subprocess). Same root; lists concatenated; `sdks` a union by
 * name and declared version; `files_read` summed. `syntax_only.missed` stays
 * the TypeScript side's measurement: Python's is 0 by construction, and a sum
 * would read as a second measurement nobody made.
 */

import type { CodeCatalog } from './types.js';
import { sortLoads } from './ts/loads.js';

const PY_UNREAD = /Python file\(s\) are present; the TypeScript front end does not read them/;

export function mergeCatalogs(ts: CodeCatalog, py: CodeCatalog): CodeCatalog {
  const sdks = new Map<string, { name: string; version: string }>();
  for (const s of [...ts.sdks, ...py.sdks]) sdks.set(`${s.name}\u0000${s.version}`, s);
  const package_name = ts.package_name ?? py.package_name;
  const checks = [...(ts.checks ?? []), ...(py.checks ?? [])];
  // ACP-460: every language's loads, one list in the contract's order. Present when a front end
  // looked; an entry a front end emitted is never dropped here, even beside a check it did not flag.
  const skill_loads = sortLoads([...(ts.skill_loads ?? []), ...(py.skill_loads ?? [])]);
  const looked = checks.some((c) => c.skill_loads === true) || skill_loads.length > 0;
  return {
    root: ts.root,
    ...(package_name === undefined ? {} : { package_name }),
    sdks: [...sdks.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name))),
    files_read: ts.files_read + py.files_read,
    tools: [...ts.tools, ...py.tools],
    exposures: [...ts.exposures, ...py.exposures],
    dispatchers: [...ts.dispatchers, ...py.dispatchers],
    gates: [...ts.gates, ...py.gates],
    syntax_only: { found: ts.syntax_only.found + py.syntax_only.found, missed: ts.syntax_only.missed },
    // The TypeScript side says Python files are present and unread; when the Python front end
    // read them, that line is false (the first customer's report said it beside a Python pass).
    not_seen: [...ts.not_seen.filter((l) => !(py.files_read > 0 && PY_UNREAD.test(l))), ...py.not_seen],
    // Which checks ran, per language: dropped here, a report could not tell "none found" from
    // "not looked for", which is the one thing the field exists to say.
    ...(checks.length === 0 ? {} : { checks }),
    // Which honesty lines are about a coding assistant, not the application (ACP-464): each language's, kept.
    ...(ts.assistant_config === undefined && py.assistant_config === undefined ? {} : { assistant_config: [...(ts.assistant_config ?? []), ...(py.assistant_config ?? [])] }),
    ...(looked ? { skill_loads } : {}),
    // Structured output: present when either front end looked, in each language's order.
    ...(ts.structured_output === undefined && py.structured_output === undefined ? {} : { structured_output: [...(ts.structured_output ?? []), ...(py.structured_output ?? [])] }),
  };
}
