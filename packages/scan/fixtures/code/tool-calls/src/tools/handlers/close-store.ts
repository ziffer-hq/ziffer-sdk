import { z } from 'zod';
import { defineTool } from '../tool-module.js';

const InputSchema = z.object({ from: z.string(), to: z.string(), announce: z.string().optional() });

// Shape 1: a tool that, in the same run, imports another tool's run function and calls it.
export const tool = defineTool({
  name: 'closeStore',
  description: 'Close the store for a date range, and optionally announce it.',
  requires_confirmation: true,
  zodSchema: InputSchema,
  async execute(input, ctx, abortSignal) {
    const payload: Record<string, unknown> = { closed: true };
    if (typeof input.announce === 'string') {
      const { execute: publishNoticeExecute } = await import('./publish-notice.js');
      payload['notice'] = await publishNoticeExecute({ body: input.announce }, ctx, abortSignal);
    }
    return payload;
  },
});
