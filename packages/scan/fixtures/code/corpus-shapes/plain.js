// Plain JavaScript (no tsconfig, no checkJs): an AI SDK tool through `require`.
const { tool } = require('ai');
const { z } = require('zod');

const tools = {
  sendInvoice: tool({
    description: 'Send the invoice to the customer by email.',
    inputSchema: z.object({ invoiceId: z.string(), to: z.string() }),
    execute: async ({ invoiceId }) => invoiceId,
  }),
};

module.exports = { tools };
