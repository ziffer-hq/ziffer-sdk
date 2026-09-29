export async function runBookshopAction(name: string, input: unknown): Promise<string> {
  return `${name}: ${JSON.stringify(input)}`;
}
