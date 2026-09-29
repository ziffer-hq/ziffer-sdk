import { tool } from 'ai';
import { z } from 'zod';

export const shelfCount = tool({
  description: 'Count the copies of a title on the shelf.',
  inputSchema: z.object({ title: z.string() }),
  execute: async ({ title }) => ({ title, copies: 3 }),
});
