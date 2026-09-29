import OpenAI from 'openai';

const client = new OpenAI();

export async function respond(input: string): Promise<void> {
  await client.responses.create({
    model: 'gpt-5',
    input,
    tools: [{ type: 'function', name: 'create_ticket', description: 'Open a support ticket.', strict: true, parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'], additionalProperties: false } }],
  });
}
