import { z } from 'zod';
import { defineTool } from '../tool-module.js';

export const tool = defineTool({
  name: 'shelf_restock',
  description: 'Restock one title on the shelf from the back room.',
  requires_confirmation: true,
  zodSchema: z.object({ sku: z.string() }),
  execute: async (input) => ({ sku: input.sku, ok: true }),
});
