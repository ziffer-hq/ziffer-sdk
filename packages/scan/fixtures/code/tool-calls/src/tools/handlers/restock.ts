import { z } from 'zod';
import { defineTool, type ToolContext } from '../tool-module.js';
import { tool as getStock } from './get-stock.js';
import { getStockExecute } from './aliases.js';

// Shape 2: a static import, called directly; and a re-export, called two helpers deep.
async function shelfLevel(sku: string, ctx: ToolContext): Promise<unknown> {
  return countShelf(sku, ctx);
}

async function countShelf(sku: string, ctx: ToolContext): Promise<unknown> {
  return getStockExecute({ sku }, ctx);
}

export const tool = defineTool({
  name: 'restock',
  description: 'Order more copies of a title from the distributor.',
  requires_confirmation: true,
  zodSchema: z.object({ sku: z.string(), copies: z.number() }),
  async execute(input, ctx) {
    const before = await getStock.execute({ sku: input.sku }, ctx);
    const shelf = await shelfLevel(input.sku, ctx);
    return { ordered: input.copies, before, shelf };
  },
});
