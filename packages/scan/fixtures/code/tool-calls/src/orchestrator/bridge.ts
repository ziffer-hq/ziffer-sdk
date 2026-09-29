import { dynamicTool, streamText, type Tool } from 'ai';
import { executeTool } from '../tools/tool-executor.js';
import { ALL_TOOLS } from '../tools/handlers/index.js';
import type { ToolContext } from '../tools/tool-module.js';

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

// Caller shape A: the model path tests the handler's confirmation flag before it calls.
export async function runTurn(ctx: ToolContext, prompt: string): Promise<string> {
  const tools: Record<string, Tool> = {};
  for (const handler of ALL_TOOLS) {
    const name = handler.name;
    tools[name] = dynamicTool({
      description: handler.description,
      inputSchema: handler.zodSchema,
      execute: async (input, { abortSignal }) => {
        const typedInput = toRecord(input);
        // A comment naming confirmed must not count: comments are not code.
        if (handler.requires_confirmation === true) {
          return { status: 'pending_confirmation', tool: name };
        }
        const r = await executeTool(name, typedInput, ctx, abortSignal);
        return r;
      },
    });
  }
  const result = streamText({ model: 'anthropic/claude-sonnet-4.5', tools, prompt });
  return result.text;
}
