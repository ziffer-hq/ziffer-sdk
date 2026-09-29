import Instructor from '@instructor-ai/instructor';
import { generateObject } from 'ai';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const RefundDecision = z.object({ refund: z.boolean(), reason: z.string() });

const oai = new OpenAI();
const client = Instructor({ client: oai, mode: 'TOOLS' });

/** Structured output: the "tool" Instructor sends is the response model, and nothing runs. */
export async function decide(message: string) {
  return client.chat.completions.create({
    messages: [{ role: 'user', content: message }],
    model: 'bookshop-model',
    response_model: { schema: RefundDecision, name: 'RefundDecision', description: 'Whether to refund an order' },
  });
}

export async function decideWithAiSdk(message: string) {
  return generateObject({ model: 'bookshop/model', schema: RefundDecision, prompt: message });
}

export const refundFormat = zodResponseFormat(RefundDecision, 'refund_decision');

/** A real tool beside them: the application dispatches it, so it IS counted. */
export async function act(message: string) {
  return oai.chat.completions.create({
    model: 'bookshop-model',
    messages: [{ role: 'user', content: message }],
    tools: [{ type: 'function', function: { name: 'refund_order', description: 'Refund an order', parameters: { type: 'object', properties: { orderId: { type: 'string' } } } } }],
  });
}
