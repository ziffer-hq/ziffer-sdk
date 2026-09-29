import { executeTool } from '../tools/tool-executor.js';
import type { ToolContext } from '../tools/tool-module.js';

// BOUNDED by a name prefix: a name that does not start with it throws before the call.
export async function shelfDesk(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (!name.startsWith('shelf_')) throw new Error(`not a shelf tool: ${name}`);
  return executeTool(name, input, ctx);
}

// BOUNDED by the name written at the call.
export async function countShelf(ctx: ToolContext): Promise<Record<string, unknown>> {
  return executeTool('shelf_count', { sku: 'all' }, ctx);
}
