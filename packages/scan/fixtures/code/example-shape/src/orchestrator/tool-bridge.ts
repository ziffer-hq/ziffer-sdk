import { dynamicTool, streamText, type Tool } from 'ai';
import { executeTool } from '../tools/tool-executor.js';
import { getToolsForLocation } from '../tools/tool-registry.js';
import type { ToolContext } from '../tools/tool-module.js';

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

export async function runTurn(ctx: ToolContext, prompt: string): Promise<string> {
  const gated = (await getToolsForLocation(ctx.locationId)).map((t) => [t.name, t] as const);
  const tools: Record<string, Tool> = {};
  for (const [name, handler] of gated) {
    tools[name] = dynamicTool({
      description: handler.description,
      inputSchema: handler.zodSchema,
      execute: async (input, { abortSignal }) => {
        const r = await executeTool(name, toRecord(input), ctx, abortSignal);
        return r.result;
      },
    });
  }
  const result = streamText({ model: 'anthropic/claude-sonnet-4.5', tools, prompt });
  return result.text;
}
