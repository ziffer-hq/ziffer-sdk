import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: 'findRoom',
    description: 'Read the rooms free on a night.',
    input_schema: { type: 'object', properties: { night: { type: 'string' } }, required: ['night'] },
  },
  {
    name: 'releaseRoom',
    description: 'Release a held room back to sale.',
    input_schema: { type: 'object', properties: { stayId: { type: 'string' } }, required: ['stayId'] },
  },
];

interface QueuedJob {
  type: string;
  name: string;
  input: string;
}

async function runTool(name: string, input: string): Promise<string> {
  return `${name}:${input}`;
}

export async function answer(question: string, queue: QueuedJob[]): Promise<string> {
  await client.messages.create({ model: 'claude-model', max_tokens: 1024, tools, messages: [{ role: 'user', content: question }] });
  for (const block of queue) {
    if (block.type === 'tool_use') return runTool(block.name, block.input as string);
  }
  return '';
}
