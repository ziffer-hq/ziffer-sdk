import type { ToolContext } from './tool-module.js';
import { TOOLS_BY_NAME } from './handlers/index.js';

/** The one function every execution path runs through. */
export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  const tool = TOOLS_BY_NAME.get(name);
  if (tool === undefined) return { error: `unknown tool ${name}` };
  const parsed = tool.zodSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.message };
  return tool.execute(parsed.data, ctx);
}
