import { z } from 'zod';
import { defineTool } from '../tool-module.js';

export const tool = defineTool({
  name: 'till_close',
  description: 'Stub: close the till and print the day total. Not wired yet.',
  requires_confirmation: true,
  zodSchema: z.object({ sku: z.string() }),
  execute: async (input) => ({ sku: input.sku, ok: true }),
});
