import { z } from 'zod';
import { defineTool } from '../tool-module.js';

export const tool = defineTool({
  name: 'send_guest_message',
  description: `Send a message to the guest by email or SMS.`,
  requires_confirmation: false,
  zodSchema: z.object({ guestId: z.string(), channel: z.enum(['email', 'sms']), body: z.string() }),
  execute: async (input) => ({ result: { sent: input.guestId } }),
});
