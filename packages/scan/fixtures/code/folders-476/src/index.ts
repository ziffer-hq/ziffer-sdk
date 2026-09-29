import { generateText, tool } from 'ai';
import { z } from 'zod';
import { itineraryTools } from './build/itinerary.js';
import { rehearsalTools } from './test/rehearsal.js';

export const cancelBooking = tool({
  description: 'Cancel a booking by its reference',
  inputSchema: z.object({ reference: z.string() }),
  execute: async ({ reference }) => ({ cancelled: reference }),
});

export async function answer(prompt: string): Promise<string> {
  const r = await generateText({ model: 'openai/gpt-5', prompt, tools: { cancelBooking, ...itineraryTools, ...rehearsalTools } });
  return r.text;
}
