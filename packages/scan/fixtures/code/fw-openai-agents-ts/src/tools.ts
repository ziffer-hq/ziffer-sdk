import { Agent, tool } from '@openai/agents';
import { tool as realtimeTool } from '@openai/agents/realtime';
import * as agents from '@openai/agents';
import { z } from 'zod';

export const refundOrder = tool({
  name: 'refund_order',
  description: 'Refund an order in full',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => `refunded ${orderId}`,
});

export const lookupOrder = agents.tool({
  name: 'lookup_order',
  description: 'Read an order',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ orderId }),
});

export const readBack = realtimeTool({
  name: 'read_back',
  description: 'Read the order back to the caller',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => orderId,
});

const shelfAgent = new Agent({ name: 'Shelves', instructions: 'Find a book on the shelves.' });

export const clerk = new Agent({
  name: 'Clerk',
  instructions: 'Help the customer.',
  tools: [refundOrder, lookupOrder, shelfAgent.asTool({ toolName: 'find_book', toolDescription: 'Find a book' })],
});

/** A factory: the name is passed in, so the code does not fix it. */
export function shelfLookup(name: string) {
  return tool({ name, description: 'Look a book up on one shelf', parameters: z.object({ isbn: z.string() }), execute: async ({ isbn }) => isbn });
}
