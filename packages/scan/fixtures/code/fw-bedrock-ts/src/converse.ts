import { BedrockRuntime, BedrockRuntimeClient, ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';

import shippingConfig from './bookshop-tools.json' with { type: 'json' };
import { refundOrderSpec } from './tools.js';

const client = new BedrockRuntimeClient({ region: 'eu-west-3' });

export async function ask(messages: Message[]) {
  return client.send(
    new ConverseCommand({
      modelId: 'bookshop-model',
      messages,
      toolConfig: {
        tools: [
          refundOrderSpec,
          { toolSpec: { name: 'lookup_order', description: 'Read an order', inputSchema: { json: { type: 'object', properties: { orderId: { type: 'string' } } } } } },
        ],
      },
    }),
  );
}

const config = shippingConfig;

export async function askShipping(messages: Message[]) {
  const aggregated = new BedrockRuntime({ region: 'eu-west-3' });
  return aggregated.converse({ modelId: 'bookshop-model', messages, toolConfig: config });
}
