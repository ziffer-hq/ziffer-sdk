import { z } from 'zod';
import { defineTool } from '../tool-module.js';

const InputSchema = z.object({ body: z.string() });

export const tool = defineTool({
  name: 'publishNotice',
  description: 'Publish a notice on the storefront page.',
  requires_confirmation: true,
  zodSchema: InputSchema,
  async execute(input) {
    return { published: input.body.length };
  },
});

export const execute = tool.execute;
