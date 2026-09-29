import { executeTool } from '../tools/tool-executor.js';
import type { ToolContext } from '../tools/tool-module.js';

/** The human path: a manager confirmed a held write, and it runs through the same dispatcher. */
export async function executeConfirmedTool(toolName: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const out = await executeTool(toolName, input, ctx);
  return out.result;
}
