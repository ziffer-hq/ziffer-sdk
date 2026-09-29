import { executeTool } from '../tools/tool-executor.js';
import type { ToolContext } from '../tools/tool-module.js';
import type { OnToolCall } from './loop.js';

// A factory: the function that calls the dispatcher is RETURNED, and installed where the factory is called.
export function makeShelfLogger(runId: string): OnToolCall {
  return async function loggedShelfCall(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ctx: ToolContext = { storeId: 1, actorUserId: null };
    const out = await executeTool(name, input, ctx);
    console.log(`[shelf] ${runId} ${name}`);
    return out;
  };
}
