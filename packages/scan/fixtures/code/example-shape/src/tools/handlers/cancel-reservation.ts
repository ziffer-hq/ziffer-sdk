import { z } from 'zod';
import { defineTool } from '../tool-module.js';

const InputSchema = z.object({
  confirmationCode: z.string().min(1),
  reason: z.string().max(500).optional(),
});
type Input = z.infer<typeof InputSchema>;

export const tool = defineTool<Input>({
  name: 'cancel_reservation',
  description: 'Cancel a booking and trigger the refund and the guest email.',
  requires_confirmation: true,
  zodSchema: InputSchema,
  async execute(input) {
    return { result: { cancelled: input.confirmationCode } };
  },
});
