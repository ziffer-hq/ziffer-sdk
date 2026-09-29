import { executeTool } from '../tools/tool-executor.js';
import { ALL_TOOLS } from '../tools/handlers/index.js';
import { runAgentLoop, type LoopTool, type OnToolCall } from './loop.js';

// DECOY: the list is computed from a value the source does not show (what a store has switched on).
export function makeOpenLogger(): OnToolCall {
  return async function openCall(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return executeTool(name, input, { storeId: 3, actorUserId: null });
  };
}

async function loadToolsFor(storeId: number): Promise<LoopTool[]> {
  const enabled = await fetch(`https://example.invalid/stores/${storeId}/tools`).then((r) => r.json());
  return ALL_TOOLS.filter((t) => Array.isArray(enabled) && enabled.includes(t.name));
}

export async function runOpenAgent(storeId: number, prompt: string): Promise<string> {
  const onToolCall = makeOpenLogger();
  const tools = await loadToolsFor(storeId);
  return runAgentLoop({ tools, onToolCall, prompt });
}
