// OFFERED by a name prefix over the catalog, plus one named tool; outside the tsconfig, as a script is.
import { runAgentLoop } from '../src/agents/loop.js';
import { makeShelfLogger } from '../src/agents/shelf-logger.js';
import { ALL_TOOLS } from '../src/tools/handlers/index.js';
import { tool as sendReceipt } from '../src/tools/handlers/send-receipt.js';

async function main(): Promise<void> {
  const tools = [
    ...ALL_TOOLS
      .filter((t) => t.name.startsWith('shelf_'))
      .map((t) => ({ name: t.name, description: t.description })),
    sendReceipt,
  ];
  const onToolCall = makeShelfLogger('run-1');
  const text = await runAgentLoop({ prompt: 'Count the shelf.', tools, onToolCall });
  console.log(text);
}

void main();
