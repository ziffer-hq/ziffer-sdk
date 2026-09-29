import { z } from 'zod';
import { defineTool } from '../tool-module.js';

export const tool = defineTool({
  name: 'shelf_count',
  description: 'Read how many copies of one title are on the shelf.',
  requires_confirmation: false,
  zodSchema: z.object({ sku: z.string() }),
  execute: async (input) => ({ sku: input.sku, ok: true }),
});
