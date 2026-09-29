import { executeTool } from '../tools/tool-executor.js';
import type { ToolContext } from '../tools/tool-module.js';

// UNBOUNDED: the name is a parameter, passed on as it came.
export async function relayCall(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  return executeTool(name, input, ctx);
}

// DECOY: a prefix test that only logs does not stop the call, so it bounds nothing.
export async function loggedShelfCall(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (!name.startsWith('shelf_')) console.warn(`unexpected tool ${name}`);
  return executeTool(name, input, ctx);
}

// DECOY: a list that can change (`let`) is not a bound read from the source.
let openTools: string[] = ['shelf_count'];
export function allowTool(name: string): void {
  openTools = [...openTools, name];
}
export async function openCall(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (!openTools.includes(name)) return { error: 'not open' };
  return executeTool(name, input, ctx);
}
