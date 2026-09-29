import { dynamicTool, streamText, type Tool } from 'ai';
import { executeTool } from '../tools/tool-executor.js';
import { ALL_TOOLS } from '../tools/handlers/index.js';
import type { ToolContext } from '../tools/tool-module.js';

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

// The model path: every tool, a name the model chooses. Nothing here bounds it beyond the catalog.
export async function runTurn(ctx: ToolContext, prompt: string): Promise<string> {
  const tools: Record<string, Tool> = {};
  for (const handler of ALL_TOOLS) {
    const name = handler.name;
    tools[name] = dynamicTool({
      description: handler.description,
      inputSchema: handler.zodSchema,
      execute: async (input) => executeTool(name, toRecord(input), ctx),
    });
  }
  const result = streamText({ model: 'anthropic/claude-sonnet-4.5', tools, prompt });
  return result.text;
}
