import type { ToolContext } from '../tools/tool-module.js';

// Caller shape C: a decorator that records and delegates, with NO check before the call.
// DECOY: `confirmedAt` is declared before the call and tested only AFTER it; a
// `confirmed` read after the call is after it. Neither is a check before the call.
export async function auditedExecute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const confirmedAt = Date.now();
  const { executeTool } = await import('../tools/tool-executor.js');
  const out = await executeTool(name, input, ctx);
  if (confirmedAt > 0 && out['confirmed'] === true) console.log(`tool ${name} ran`);
  return out;
}
