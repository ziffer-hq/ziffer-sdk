import OpenAI from 'openai';
import { zodFunction } from 'openai/helpers/zod';
import { z } from 'zod';

const client = new OpenAI();
// An OpenAI-compatible endpoint: same SDK, another provider behind baseURL.
const compatible = new OpenAI({ baseURL: 'https://llm.example.internal/v1', apiKey: 'k' });

// A list declared apart from the call, passed by name.
const refundTools = [
  { type: 'function' as const, function: { name: 'refund_order', description: 'Refund an order in full.', parameters: { type: 'object', properties: { orderId: { type: 'string' } } } } },
];

export async function chat(question: string): Promise<void> {
  await client.chat.completions.create({
    model: 'gpt-5',
    messages: [{ role: 'user', content: question }],
    tools: [
      { type: 'function', function: { name: 'get_order', description: 'Read an order.', parameters: { type: 'object', properties: { orderId: { type: 'string' }, expand: { type: 'boolean' } } } } },
      zodFunction({ name: 'cancel_subscription', description: 'Cancel a subscription now.', parameters: z.object({ subscriptionId: z.string(), reason: z.string() }) }),
    ],
  });
  await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: question }], tools: refundTools });
  await compatible.chat.completions.create({
    model: 'local-model',
    messages: [{ role: 'user', content: question }],
    tools: [{ type: 'function', function: { name: 'lookup_sku', parameters: { type: 'object', properties: { sku: { type: 'string' } } } } }],
  });
}
