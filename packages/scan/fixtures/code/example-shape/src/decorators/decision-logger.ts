import type { ToolContext, ToolResult } from '../tools/tool-module.js';

/** A decorator that records every call and delegates, loaded lazily as the real one is. */
export async function loggedExecute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { executeTool } = await import('../tools/tool-executor.js');
  const out = await executeTool(name, input, ctx);
  console.log(`tool ${name} ran`);
  return out;
}
