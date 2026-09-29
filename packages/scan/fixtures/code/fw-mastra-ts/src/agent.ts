import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { MCPClient, MCPServer } from '@mastra/mcp';

import { lookupOrderTool, refundOrder } from './tools.js';

export const clerk = new Agent({
  id: 'clerk',
  name: 'Bookshop clerk',
  instructions: 'Help customers with their orders.',
  model: 'bookshop/model',
  tools: { refundOrder, lookup: lookupOrderTool },
});

export const nightClerk = new Agent({
  id: 'night-clerk',
  name: 'Night clerk',
  instructions: 'Answer after hours.',
  model: 'bookshop/model',
  tools: ({ requestContext }) => (requestContext === undefined ? {} : { lookup: lookupOrderTool }),
  agents: { clerk },
});

export const ledger = new MCPClient({ servers: { ledger: { command: 'node', args: ['ledger-server.js'] } } });

export const mastra = new Mastra({ agents: { clerk, nightClerk }, tools: { refundOrder } });

export const bookshopServer = new MCPServer({ id: 'bookshop', name: 'Bookshop', version: '1.0.0', tools: { lookup: lookupOrderTool } });
