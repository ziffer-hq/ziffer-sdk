/** The one function both tools run through: the dispatcher a check at the top of would cover. */
export async function runBookshopAction(name: string, input: unknown): Promise<string> {
  return `${name}: ${JSON.stringify(input)}`;
}
