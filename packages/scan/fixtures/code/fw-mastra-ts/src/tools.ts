import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { runBookshopAction } from './actions.js';

export const refundOrder = createTool({
  id: 'refund-order',
  description: 'Refund an order in full',
  inputSchema: z.object({ orderId: z.string(), cents: z.number() }),
  requireApproval: true,
  execute: async (input) => runBookshopAction('refund-order', input),
});

export const lookupOrderTool = createTool({
  id: 'lookup-order',
  description: 'Read an order',
  inputSchema: z.object({ orderId: z.string() }),
  execute: async (input) => runBookshopAction('lookup-order', input),
});
