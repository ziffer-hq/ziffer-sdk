import { z } from 'zod';
import { defineTool } from '../tool-module.js';
import { executeTool } from '../tool-executor.js';

// DECOY: this tool runs another tool THROUGH the dispatcher, which sees it. Not a ToolCall.
export const tool = defineTool({
  name: 'notifyOwner',
  description: 'Tell the owner, by posting a notice.',
  requires_confirmation: false,
  zodSchema: z.object({ text: z.string() }),
  async execute(input, ctx) {
    return executeTool('publishNotice', { body: input.text }, ctx);
  },
});
