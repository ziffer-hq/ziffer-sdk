import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const findShelf = tool('find_shelf', 'Find the shelf a title is on', { isbn: z.string() }, async () => ({ content: [] }));
export const countStock = tool('count_stock', 'Count the copies of a title', { isbn: z.string() }, async () => ({ content: [] }));

// Registered under the key `stock`: the model sees mcp__stock__find_shelf, not mcp__shelves__find_shelf.
const shelfServer = createSdkMcpServer({ name: 'shelves', version: '1.0.0', tools: [findShelf] });
// Not registered in any options this tree shows: its own name names its tools.
export const countServer = createSdkMcpServer({ name: 'counts', version: '1.0.0', tools: [countStock] });

export async function runStock(prompt: string): Promise<void> {
  // Create, GrepTool and TodoEdit are not built-in tools of the SDK's current version.
  for await (const m of query({ prompt, options: { mcpServers: { stock: shelfServer }, allowedTools: ['Read', 'Create', 'GrepTool', 'TodoEdit', 'mcp__stock__find_shelf'] } })) void m;
}
