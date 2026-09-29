import { openai } from '@llamaindex/openai';
import { mcp, wiki } from '@llamaindex/tools';
import { agent } from '@llamaindex/workflow';
import { FunctionTool } from 'llamaindex';

import { lookupOrder, refundOrder, shipOrder } from './tools.js';

export const clerk = agent({ name: 'clerk', tools: [refundOrder, lookupOrder, wiki()], llm: openai({ model: 'bookshop-model' }) });

export async function ship(messages: never[]) {
  const llm = openai({ model: 'bookshop-model' });
  return llm.exec({ messages, tools: [shipOrder] });
}

export async function ledgerAgent() {
  const server = mcp({ command: 'node', args: ['ledger-server.js'] });
  return agent({ name: 'ledger', tools: await server.tools(), llm: openai({ model: 'bookshop-model' }) });
}

/** A worker that loads LlamaIndex lazily: the classes come from a destructured dynamic import. */
export async function faqAgent(queryEngine: unknown) {
  const { QueryEngineTool } = await import('llamaindex');
  return new QueryEngineTool({ queryEngine, metadata: { name: 'bookshopFaq', description: 'Answer questions from the shop FAQ' } });
}

/** One tool per shelf, named at runtime: not listed, said. */
export function shelfTools(shelves: string[], queryEngine: unknown) {
  return shelves.map((shelf) => new FunctionTool((input: { q: string }) => input.q, { name: `shelf_${shelf}`, description: 'Search one shelf' }));
}
