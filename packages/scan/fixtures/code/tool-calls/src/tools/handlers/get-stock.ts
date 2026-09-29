import { z } from 'zod';
import { defineTool } from '../tool-module.js';

export const tool = defineTool({
  name: 'getStock',
  description: 'Stub: read the stock level of one title. Not wired yet.',
  requires_confirmation: false,
  zodSchema: z.object({ sku: z.string() }),
  execute: async (input) => ({ sku: input.sku, stock: 3 }),
});

export const execute = tool.execute;
