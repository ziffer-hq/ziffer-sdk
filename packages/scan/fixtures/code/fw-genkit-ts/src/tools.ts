import { z } from 'genkit';

import { runBookshopAction } from './actions.js';
import { ai } from './genkit.js';

export const refundOrder = ai.defineTool(
  {
    name: 'refundOrder',
    description: 'Refund an order in full',
    inputSchema: z.object({ orderId: z.string(), cents: z.number() }),
    outputSchema: z.string(),
  },
  async (input) => runBookshopAction('refundOrder', input),
);

export const lookupOrder = ai.defineTool(
  { name: 'lookupOrder', description: 'Read an order', inputSchema: z.object({ orderId: z.string() }) },
  async (input) => runBookshopAction('lookupOrder', input),
);

export const confirmRefund = ai.defineInterrupt({
  name: 'confirmRefund',
  description: 'Ask the customer to confirm a refund',
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),
});
