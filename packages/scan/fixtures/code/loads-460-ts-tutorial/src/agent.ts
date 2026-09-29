// The application's own inline prompt: a literal in source, no file behind it.
import { generateText } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

const TILL_PROMPT = 'You are the till assistant of the corner bookshop. Greet the customer by the name on the loyalty card, look up the order by its number, and read back the title, the author and the price before you take payment. Never discount a book without a manager code, and never give out the address of another customer.';

const lookUpOrder = tool({
  description: 'Look up an order by its number.',
  inputSchema: z.object({ order: z.string() }),
  execute: async ({ order }) => ({ order, status: 'ready' }),
});

export async function till(question: string): Promise<string> {
  const r = await generateText({ model: 'anthropic/claude-sonnet-4.5', system: TILL_PROMPT, tools: { lookUpOrder }, prompt: question });
  return r.text;
}
