// The "test drive" feature: a customer rehearses a booking. Hand-written source, in a folder named test.
import { tool } from 'ai';
import { z } from 'zod';

export const rehearsalTools = {
  holdSeat: tool({
    description: 'Hold a seat for fifteen minutes without charging',
    inputSchema: z.object({ flight: z.string(), seat: z.string() }),
    execute: async ({ flight, seat }) => ({ flight, seat, held: true }),
  }),
};
