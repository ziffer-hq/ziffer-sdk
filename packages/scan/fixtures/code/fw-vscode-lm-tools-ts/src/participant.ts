import * as vscode from 'vscode';

/** A chat participant that offers the editor's tools to a model and has the calls run itself. */
export async function answer(model: vscode.LanguageModelChat, messages: vscode.LanguageModelChatMessage[], token: vscode.CancellationToken): Promise<void> {
  const tools = vscode.lm.tools.filter((t) => t.tags.includes('bookshop'));
  const response = await model.sendRequest(messages, { tools: [...tools] }, token);
  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelToolCallPart) await vscode.lm.invokeTool(part.name, { input: part.input, toolInvocationToken: undefined }, token);
  }
}

/** An extension that also hands the editor an MCP server: its tools are listed at runtime, not here. */
export function registerServers(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('bookshopServers', {
      provideMcpServerDefinitions: async () => [],
    }),
  );
}
