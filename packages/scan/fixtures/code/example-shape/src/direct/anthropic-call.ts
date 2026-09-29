import Anthropic from '@anthropic-ai/sdk';

// One call written directly against the Anthropic Messages API, tools inline.
export async function searchDocs(client: Anthropic, question: string): Promise<unknown> {
  return client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: question }],
    tools: [
      {
        name: 'search_docs',
        description: 'Search the product documentation.',
        input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      },
    ],
  });
}
