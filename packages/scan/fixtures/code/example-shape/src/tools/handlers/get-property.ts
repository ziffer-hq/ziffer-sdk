import { z } from 'zod';
import { defineTool } from '../tool-module.js';

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

export const tool = defineTool<Input>({
  name: 'get_property',
  description: 'Read the property profile: name, address, check-in times.',
  requires_confirmation: false,
  zodSchema: InputSchema,
  execute: async (_input, ctx) => ({ result: { locationId: ctx.locationId } }),
});
