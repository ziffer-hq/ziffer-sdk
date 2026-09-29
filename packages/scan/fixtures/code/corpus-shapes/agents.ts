// OpenAI Agents SDK, read with the SDK NOT installed: the checker cannot resolve
// '@openai/agents', and the import declaration says which package `tool` is.
import { Agent, tool, webSearchTool } from '@openai/agents';
import { z } from 'zod';

export const refundOrder = tool({
  name: 'refund_order',
  description: 'Refund a customer order in full.',
  parameters: z.object({ orderId: z.string(), reason: z.string() }),
  execute: async ({ orderId }) => `refunded ${orderId}`,
});

const lookup = tool({
  name: 'lookup_order',
  description: 'Look up an order by id.',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ orderId }),
});

export const support = new Agent({
  name: 'Support',
  instructions: 'Help the customer.',
  tools: [refundOrder, lookup, webSearchTool()],
});
