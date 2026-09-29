import { executeTool } from '../tools/tool-executor.js';
import { tool as tillOpen } from '../tools/handlers/till-open.js';
import { tool as tillClose } from '../tools/handlers/till-close.js';
import { runAgentLoop } from './loop.js';

// OFFERED by a literal list: the function is handed on by name beside it.
export async function tillCall(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return executeTool(name, input, { storeId: 2, actorUserId: null });
}

export async function runTillAgent(prompt: string): Promise<string> {
  return runAgentLoop({ tools: [tillOpen, tillClose], onToolCall: tillCall, prompt });
}
