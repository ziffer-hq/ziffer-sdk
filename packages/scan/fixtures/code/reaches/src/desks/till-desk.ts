import { executeTool } from '../tools/tool-executor.js';
import type { ToolContext } from '../tools/tool-module.js';
import { TILL_TOOLS } from './till-tools.js';

// BOUNDED by an imported literal list: a name not on it returns before the call.
// 'till_audit' is on the list and is no tool of the catalog: it reaches nothing.
export async function tillDesk(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (!TILL_TOOLS.includes(name)) {
    return { error: `not a till tool: ${name}` };
  }
  return executeTool(name, input, ctx);
}
