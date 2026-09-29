import { runBookshopAction } from './actions.js';
import { ai, z } from './genkit.js';

// `z` from the application's own module: the scan does not follow the re-export, and says so.
export const shelveTitle = ai.defineTool(
  { name: 'shelveTitle', description: 'Put a title back on its shelf', inputSchema: z.object({ isbn: z.string() }) },
  async (input) => runBookshopAction('shelveTitle', input),
);
