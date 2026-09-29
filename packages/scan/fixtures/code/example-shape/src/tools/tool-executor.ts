import type { ToolContext, ToolResult } from './tool-module.js';
import { TOOLS_BY_NAME } from './handlers/index.js';

/** The one function every execution path runs through: the place ZIFFER goes. */
export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext, abortSignal?: AbortSignal): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (tool === undefined) return { result: { error: `unknown tool ${name}` } };
  const parsed = tool.zodSchema.safeParse(input);
  if (!parsed.success) return { result: { error: parsed.error.message } };
  return tool.execute(parsed.data, ctx, abortSignal);
}
