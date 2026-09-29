import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool, tool } from '@langchain/core/tools';
import { z } from 'zod';

const searchDatabase = tool(({ query }) => `found ${query}`, {
  name: 'search_database',
  description: 'Search the customer database.',
  schema: z.object({ query: z.string(), limit: z.number() }),
});

const sendEmail = tool(({ to }) => `sent to ${to}`, {
  name: 'send_email',
  description: 'Send an email to a customer.',
  schema: z.object({ to: z.string(), body: z.string() }),
});

export const transferFunds = new DynamicStructuredTool({
  name: 'transfer_funds',
  description: 'Move money between accounts.',
  schema: z.object({ from: z.string(), to: z.string(), cents: z.number() }),
  func: async ({ cents }) => `moved ${cents}`,
});

export function bind(model: BaseChatModel): unknown {
  return model.bindTools?.([searchDatabase, sendEmail]);
}
