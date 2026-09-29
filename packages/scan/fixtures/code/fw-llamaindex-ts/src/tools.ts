import { FunctionTool, tool } from 'llamaindex';
import { z } from 'zod';

import { runBookshopAction } from './actions.js';

export const refundOrder = tool({
  name: 'refundOrder',
  description: 'Refund an order in full',
  parameters: z.object({ orderId: z.string(), cents: z.number() }),
  execute: async (input) => runBookshopAction('refundOrder', input),
});

export const lookupOrder = tool((input: { orderId: string }) => runBookshopAction('lookupOrder', input), {
  name: 'lookupOrder',
  description: 'Read an order',
  parameters: z.object({ orderId: z.string() }),
});

export const shipOrder = FunctionTool.from(
  { name: 'shipOrder', description: 'Hand an order to the courier', parameters: z.object({ orderId: z.string(), address: z.string() }), execute: async (input) => runBookshopAction('shipOrder', input) },
);
