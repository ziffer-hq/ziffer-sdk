import { z } from 'zod';
import { defineTool } from '../tool-module.js';
import { TOOLS_BY_NAME } from './index.js';

// Shape 3: a run function taken from the tools map by a LITERAL key.
export const tool = defineTool({
  name: 'auditShelf',
  description: 'A stubborn recount of every shelf, retried until it agrees.',
  requires_confirmation: false,
  zodSchema: z.object({ sku: z.string() }),
  async execute(input, ctx) {
    const reader = TOOLS_BY_NAME.get('getStock');
    return reader === undefined ? { error: 'missing' } : reader.execute({ sku: input.sku }, ctx);
  },
});
