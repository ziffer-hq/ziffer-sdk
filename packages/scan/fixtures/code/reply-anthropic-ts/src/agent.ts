import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type OpenAI from 'openai';

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: 'findRoom',
    description: 'Read the rooms free on a night.',
    input_schema: { type: 'object', properties: { night: { type: 'string' } }, required: ['night'] },
  },
  {
    name: 'chargeDeposit',
    description: 'Charge the deposit to the guest card on file.',
    input_schema: { type: 'object', properties: { stayId: { type: 'string' } }, required: ['stayId'] },
  },
  {
    name: 'releaseRoom',
    description: 'Release a held room back to sale.',
    input_schema: { type: 'object', properties: { stayId: { type: 'string' } }, required: ['stayId'] },
  },
];

// A tool with its own run body: it runs in the SDK's tool runner, never through runTool.
export const printReceipt = betaTool({
  name: 'printReceipt',
  description: 'Print the receipt for a stay.',
  inputSchema: { type: 'object', properties: { stayId: { type: 'string' } }, required: ['stayId'] },
  run: async () => 'printed',
});

// Another SDK's tool with no body: runTool never receives an OpenAI request.
export const openaiTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: { name: 'lookupGuest', description: 'Read a guest record.', parameters: { type: 'object', properties: {} } },
};

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'findRoom':
      return JSON.stringify({ night: input['night'], free: 3 });
    case 'chargeDeposit':
      return 'charged';
    case 'releaseRoom':
      return 'released';
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

export async function answer(question: string): Promise<string> {
  const reply = await client.messages.create({
    model: 'claude-model',
    max_tokens: 1024,
    tools,
    messages: [{ role: 'user', content: question }],
  });
  for (const block of reply.content) {
    if (block.type === 'tool_use') return runTool(block.name, block.input as Record<string, unknown>);
  }
  return '';
}
