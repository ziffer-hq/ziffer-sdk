import { Mistral } from '@mistralai/mistralai';

const mistral = new Mistral({ apiKey: 'k' });

export async function ask(question: string): Promise<void> {
  await mistral.chat.complete({
    model: 'mistral-large-latest',
    messages: [{ role: 'user', content: question }],
    tools: [{ type: 'function', function: { name: 'mistral_search', description: 'Search the catalogue.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }],
  });
}
