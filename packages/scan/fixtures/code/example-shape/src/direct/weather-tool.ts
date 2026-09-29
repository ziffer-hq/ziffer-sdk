import { tool } from 'ai';
import { z } from 'zod';

// One tool written directly against the AI SDK, as the SDK's documentation does it.
export const lookupWeather = tool({
  description: 'Get the weather in a location',
  inputSchema: z.object({ location: z.string().describe('The location to get the weather for') }),
  execute: async ({ location }) => ({ location, temperature: 72 }),
});
