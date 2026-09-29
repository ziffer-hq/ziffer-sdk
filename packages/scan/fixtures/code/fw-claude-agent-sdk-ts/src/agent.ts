import { query } from '@anthropic-ai/claude-agent-sdk';

import { bookshopServer } from './tools.js';

export async function runAgent(prompt: string): Promise<void> {
  for await (const message of query({
    prompt,
    options: {
      mcpServers: { bookshop: bookshopServer, ledger: { command: 'node', args: ['ledger-server.js'] } },
      allowedTools: ['Read', 'Bash(git status:*)', 'mcp__bookshop__refund_order'],
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [async () => ({ continue: true })] }] },
    },
  })) {
    void message;
  }
}

/** Default options kept on a class, merged at call time: read because the file imports the SDK. */
export class BookshopClient {
  defaults = { allowedTools: ['Bash', 'Write'], maxTurns: 10 };
}

export async function runRestricted(prompt: string): Promise<void> {
  for await (const message of query({ prompt, options: { tools: ['Read', 'Grep'] } })) void message;
}
