export async function runBookshopAction(name: string, input: unknown): Promise<{ content: { type: 'text'; text: string }[] }> {
  return { content: [{ type: 'text', text: `${name}: ${JSON.stringify(input)}` }] };
}
