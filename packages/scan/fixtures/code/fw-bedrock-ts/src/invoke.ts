import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: 'eu-west-3' });

// An Anthropic Messages body sent through InvokeModel: its tools list is not read as an exposure.
export async function askRaw(question: string) {
  return client.send(
    new InvokeModelCommand({
      modelId: 'bookshop-model',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 512,
        tools: [{ name: 'restock_title', description: 'Restock a title', input_schema: { type: 'object', properties: { isbn: { type: 'string' } } } }],
        messages: [{ role: 'user', content: question }],
      }),
    }),
  );
}
