// An MCP server in an .mjs file, the SDK not installed: the receiver's import
// names the SDK's server side.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'files', version: '1.0.0' });

server.registerTool(
  'delete_file',
  { description: 'Delete a file from the workspace.', inputSchema: { path: z.string() } },
  async ({ path }) => ({ content: [{ type: 'text', text: path }] }),
);

export function register(srv) {
  srv.registerTool('never_found', { description: 'x' }, async () => ({ content: [] }));
}
