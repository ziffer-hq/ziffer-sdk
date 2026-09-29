import { tool } from 'ai';
import { z } from 'zod';

// An AI SDK tool that claims an approval rule on its definition.
export const lookupWeather = tool({
  description: 'Get the weather in a location',
  inputSchema: z.object({ location: z.string() }),
  needsApproval: true,
  execute: async ({ location }) => ({ location, temperature: 18 }),
});
