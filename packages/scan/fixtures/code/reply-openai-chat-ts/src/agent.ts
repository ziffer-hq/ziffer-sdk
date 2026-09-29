import OpenAI from 'openai';

const client = new OpenAI();

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'findRoom', description: 'Read the rooms free on a night.', parameters: { type: 'object', properties: { night: { type: 'string' } } } } },
  { type: 'function', function: { name: 'chargeDeposit', description: 'Charge the deposit to the guest card on file.', parameters: { type: 'object', properties: { stayId: { type: 'string' } } } } },
];

async function callTool(name: string, args: unknown): Promise<string> {
  if (name === 'findRoom') return JSON.stringify({ args, free: 3 });
  if (name === 'chargeDeposit') return 'charged';
  throw new Error(`unknown tool ${name}`);
}

export async function answer(question: string): Promise<string[]> {
  const completion = await client.chat.completions.create({
    model: 'gpt-model',
    tools,
    messages: [{ role: 'user', content: question }],
  });
  const out: string[] = [];
  for (const toolCall of completion.choices[0]?.message.tool_calls ?? []) {
    if (toolCall.type !== 'function') continue;
    out.push(await callTool(toolCall.function.name, JSON.parse(toolCall.function.arguments)));
  }
  return out;
}
