import OpenAI from 'openai';

const client = new OpenAI();

const tools: OpenAI.Responses.Tool[] = [
  { type: 'function', name: 'findRoom', description: 'Read the rooms free on a night.', parameters: { type: 'object', properties: { night: { type: 'string' } } }, strict: false },
  { type: 'function', name: 'releaseRoom', description: 'Release a held room back to sale.', parameters: { type: 'object', properties: { stayId: { type: 'string' } } }, strict: false },
];

class Concierge {
  async invokeTool(name: string, args: string): Promise<string> {
    return name === 'findRoom' ? `free: ${args}` : 'released';
  }

  async answer(question: string): Promise<string[]> {
    const response = await client.responses.create({ model: 'gpt-model', tools, input: question });
    const out: string[] = [];
    for (const item of response.output) {
      if (item.type === 'function_call') out.push(await this.invokeTool(item.name, (item.arguments)));
    }
    return out;
  }
}

export const concierge = new Concierge();
