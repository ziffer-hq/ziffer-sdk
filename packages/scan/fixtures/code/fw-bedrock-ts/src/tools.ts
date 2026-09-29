import type { Tool } from '@aws-sdk/client-bedrock-runtime';

export const refundOrderSpec: Tool = {
  toolSpec: {
    name: 'refund_order',
    description: 'Refund an order in full',
    inputSchema: { json: { type: 'object', properties: { orderId: { type: 'string' }, cents: { type: 'integer' } }, required: ['orderId'] } },
  },
};
