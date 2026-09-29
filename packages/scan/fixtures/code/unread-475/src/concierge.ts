// Tools defined through a framework the scan reads; the application also declares libraries it does not read.
import { generateText, tool } from 'ai';
import { z } from 'zod';

export const findRoom = tool({
  description: 'Find a free room for the dates given',
  inputSchema: z.object({ from: z.string(), to: z.string() }),
  execute: async ({ from, to }) => ({ from, to, rooms: [] }),
});

export async function answer(prompt: string): Promise<string> {
  const r = await generateText({ model: 'openai/gpt-5', prompt, tools: { findRoom } });
  return r.text;
}
