import { CohereClient, CohereClientV2 } from 'cohere-ai';

const v2 = new CohereClientV2({ token: 'k' });
const v1 = new CohereClient({ token: 'k' });

export async function ask(question: string): Promise<void> {
  await v2.chat({
    model: 'command-a-03-2025',
    messages: [{ role: 'user', content: question }],
    tools: [{ type: 'function', function: { name: 'cohere_weather', description: 'Weather for a city.', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
  });
  await v1.chat({
    message: question,
    tools: [{ name: 'cohere_lookup', description: 'Look up an account.', parameterDefinitions: { accountId: { type: 'str', required: true } } }],
  });
}
