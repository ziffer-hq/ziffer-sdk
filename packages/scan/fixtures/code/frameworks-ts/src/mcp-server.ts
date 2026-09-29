import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'files', version: '1.0.0' });

server.registerTool(
  'delete_file',
  { description: 'Delete a file from the workspace.', inputSchema: { path: z.string() }, annotations: { destructiveHint: true } },
  async ({ path }) => ({ content: [{ type: 'text', text: `deleted ${path}` }] }),
);

server.tool('read_file', 'Read a file.', { path: z.string(), encoding: z.string() }, async ({ path }) => ({ content: [{ type: 'text', text: path }] }));

export async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}
