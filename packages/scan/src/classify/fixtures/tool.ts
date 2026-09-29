import type { CatalogTool } from '../../types.js';

/** Build one catalog entry; fixtures name only what they test. */
export function tool(client: string, server: string, name: string, description: string, params: string[] = []): CatalogTool {
  return { client, server, tool: name, description, params, source_path: `/fixture/${server}.json` };
}
