import { ai } from './genkit.js';
import { confirmRefund, lookupOrder, refundOrder } from './tools.js';

export async function handle(prompt: string) {
  return ai.generate({ prompt, tools: [confirmRefund, refundOrder, 'lookupOrder'] });
}

export const clerkPrompt = ai.definePrompt({ name: 'clerk', prompt: 'Help with {{order}}', tools: [lookupOrder] });
