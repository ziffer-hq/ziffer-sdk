import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const LOOKUP = 'lookup_title';

enum Names {
  Reserve = 'reserve_title',
}

class Catalog {
  static readonly REMOVE = 'remove_title';
  static RENAME = 'rename_title';
}

function nameFor(verb: string): string {
  return `title_${verb}`;
}

async function archiveTitle({ isbn }: { isbn: string }): Promise<string> {
  return `archived ${isbn}`;
}

const isbn = z.object({ isbn: z.string() });

export const lookup = tool(async ({ isbn: i }) => `found ${i}`, { name: LOOKUP, description: 'Look up a title.', schema: isbn });
export const reserve = tool(async ({ isbn: i }) => `reserved ${i}`, { name: Names.Reserve, description: 'Reserve a title.', schema: isbn });
export const remove = tool(async ({ isbn: i }) => `removed ${i}`, { name: Catalog.REMOVE, description: 'Remove a title.', schema: isbn });
export const rename = tool(async ({ isbn: i }) => `renamed ${i}`, { name: Catalog.RENAME, description: 'Rename a title.', schema: isbn });
// The name is computed at runtime: listed under the function's name, and said.
export const archive = tool(archiveTitle, { name: nameFor('archive'), description: 'Archive a title.', schema: isbn });
// Computed, and no function name to fall back on: not listed, and said.
export const purge = tool(async ({ isbn: i }) => `purged ${i}`, { name: nameFor('purge'), description: 'Purge a title.', schema: isbn });
