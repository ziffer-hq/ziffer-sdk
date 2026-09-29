import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { runBookshopAction } from './actions.js';

export const refundOrder = tool(
  'refund_order',
  'Refund an order in full',
  { orderId: z.string(), cents: z.number() },
  async (args) => runBookshopAction('refund_order', args),
  { annotations: { destructiveHint: true } },
);

export const bookshopServer = createSdkMcpServer({
  name: 'bookshop',
  version: '1.0.0',
  tools: [
    refundOrder,
    tool('lookup_order', 'Read an order', { orderId: z.string() }, async (args) => runBookshopAction('lookup_order', args)),
  ],
});
