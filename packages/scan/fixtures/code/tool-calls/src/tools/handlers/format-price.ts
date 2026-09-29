import { z } from 'zod';
import { defineTool } from '../tool-module.js';

interface Formatter {
  run(value: number): string;
}

const FORMATTERS: Record<string, Formatter> = {
  eur: { run: (v) => `${v} EUR` },
  usd: { run: (v) => `${v} USD` },
};

// DECOY: a lookup by key whose element is NOT a tool (a formatter). Not a ToolCall.
export const tool = defineTool({
  name: 'formatPrice',
  description: 'Format a price in a currency.',
  requires_confirmation: false,
  zodSchema: z.object({ value: z.number(), currency: z.string() }),
  async execute(input) {
    const f = FORMATTERS[input.currency];
    return { text: f === undefined ? String(input.value) : f.run(input.value) };
  },
});
