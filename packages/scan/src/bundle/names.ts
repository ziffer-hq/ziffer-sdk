/**
 * Tool and server names as the bundle spells them, and the sidecar that maps
 * them back.
 *
 * WHY NORMALISE AT ALL. An MCP server names its tools however it likes
 * (`Send Email`, `github.create-issue`), and the bundle's keys have a grammar:
 * a Proposal's `schema_id` is `^[a-z0-9_-]{1,32}$` (§6.3, embedded from the
 * engine's `proposal.schema.json`), and the scan uses the same grammar for every
 * key it writes so one normalisation serves the tool names, the resources and
 * the adapter keys alike. The original spelling is not lost: `tool-names.json`
 * records it beside the bundle.
 *
 * WHY A COLLISION IS REPORTED, NOT MERGED. Two different things that normalise
 * to the same key would otherwise share one risk function, one reversibility
 * entry and one notice audience -- the policy a person reviews would describe
 * one action and silently govern two. Each gets its own key (a numeric suffix)
 * and the collision is returned so the report can show it as a finding. "Two
 * different things" includes one tool name exposed by two servers: they are two
 * tools, and may be classified differently.
 *
 * Deterministic: items are assigned in sorted order (name, then identity), so
 * the same catalog always yields the same keys whatever order discovery found
 * the tools in.
 */

export const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;
const MAX = 32;

/** Lowercase; every run of characters outside `[a-z0-9_-]` becomes one `_`; at most 32. */
export function normaliseName(original: string): string {
  const base = original.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, MAX);
  return base === '' ? '_' : base;
}

/** One thing to name: `id` is its identity, `name` the spelling the key is derived from. */
export interface NamedItem {
  id: string;
  name: string;
}

export interface NameCollision {
  /** The key every one of `originals` normalised to before de-duplication. */
  normalised: string;
  /** The distinct items, in assignment order, and the key each one was given. */
  originals: { id: string; original: string; assigned: string }[];
}

export interface NameMap {
  /** item id -> the key the bundle uses */
  map: Map<string, string>;
  collisions: NameCollision[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Normalise and de-duplicate. Items with the same `id` are one item. */
export function assignNames(items: Iterable<NamedItem>): NameMap {
  const byId = new Map<string, NamedItem>();
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it);
  const distinct = [...byId.values()].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
  const groups = new Map<string, NamedItem[]>();
  for (const it of distinct) {
    const key = normaliseName(it.name);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [it]);
    else group.push(it);
  }
  const taken = new Set(groups.keys());
  const map = new Map<string, string>();
  const collisions: NameCollision[] = [];
  for (const [key, members] of groups) {
    const [first, ...rest] = members;
    if (first === undefined) continue;
    map.set(first.id, key);
    if (rest.length === 0) continue;
    const collision: NameCollision = {
      normalised: key,
      originals: [{ id: first.id, original: first.name, assigned: key }],
    };
    let n = 2;
    for (const it of rest) {
      let candidate: string;
      do {
        const suffix = `_${n}`;
        candidate = key.slice(0, MAX - suffix.length) + suffix;
        n += 1;
      } while (taken.has(candidate));
      taken.add(candidate);
      map.set(it.id, candidate);
      collision.originals.push({ id: it.id, original: it.name, assigned: candidate });
    }
    collisions.push(collision);
  }
  return { map, collisions };
}

/** A plain name is its own identity (server names). */
export const plain = (name: string): NamedItem => ({ id: name, name });

/** A tool's identity is its server and its name: two servers' `search` are two tools. */
export const toolId = (server: string, tool: string): string => JSON.stringify([server, tool]);
