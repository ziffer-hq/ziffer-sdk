// A hidden directory is walked: its code is the application's.
import { tool } from 'ai';
import { z } from 'zod';

export const notifyOps = tool({
  description: 'Page the on-call engineer.',
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => message,
});
