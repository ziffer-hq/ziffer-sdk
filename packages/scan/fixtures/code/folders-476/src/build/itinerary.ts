// The "build an itinerary" feature: hand-written source, in a folder named build.
import { tool } from 'ai';
import { z } from 'zod';

export const itineraryTools = {
  buildItinerary: tool({
    description: "Build an itinerary from the traveller's bookings",
    inputSchema: z.object({ traveller: z.string() }),
    execute: async ({ traveller }) => ({ traveller, legs: [] }),
  }),
  refundTicket: tool({
    description: 'Refund a ticket to the card it was paid with',
    inputSchema: z.object({ ticket: z.string(), amount: z.number() }),
    execute: async ({ ticket, amount }) => ({ ticket, refunded: amount }),
  }),
};
