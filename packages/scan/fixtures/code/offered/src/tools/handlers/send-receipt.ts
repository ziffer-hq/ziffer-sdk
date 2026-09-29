import { z } from 'zod';
import { defineTool } from '../tool-module.js';

export const tool = defineTool({
  name: 'sendReceipt',
  description: 'Send the receipt of an order to the customer by email.',
  requires_confirmation: true,
  zodSchema: z.object({ sku: z.string() }),
  execute: async (input) => ({ sku: input.sku, ok: true }),
});
