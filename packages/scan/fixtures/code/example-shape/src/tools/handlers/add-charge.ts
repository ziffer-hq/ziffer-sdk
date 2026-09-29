import { z } from 'zod';
import { defineTool } from '../tool-module.js';

const InputSchema = z
  .object({
    confirmationCode: z.string(),
    amountCents: z.number().int().positive(),
    label: z.string(),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const DESCRIPTION = 'Post a charge to a booking (minibar, late checkout, damages). ' + 'Requires PM confirmation.';

export const tool = defineTool<Input>({
  name: 'add_charge',
  description: DESCRIPTION,
  requires_confirmation: true,
  zodSchema: InputSchema,
  execute: async (input) => ({ result: { charged: input.amountCents } }),
});
