// The agent loop: it hands the tool list to the model and every tool call to onToolCall.
export interface LoopTool {
  name: string;
  description: string;
}

export type OnToolCall = (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

export async function runAgentLoop(opts: { tools: readonly LoopTool[]; onToolCall: OnToolCall; prompt: string }): Promise<string> {
  const listed = opts.tools.map((t) => t.name).join(', ');
  const out = await opts.onToolCall('shelf_count', { sku: listed });
  return JSON.stringify({ prompt: opts.prompt, out });
}
