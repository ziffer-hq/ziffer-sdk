import { z } from 'zod';
import { defineTool } from '../tool-module.js';

// A read of an access value: it changes nothing, and what it returns could leave through a sender.
export const tool = defineTool({
  name: 'getTillPin',
  description: 'Get the till PIN for today.',
  requires_confirmation: false,
  zodSchema: z.object({ sku: z.string() }),
  execute: async (input) => ({ sku: input.sku, ok: true }),
});
