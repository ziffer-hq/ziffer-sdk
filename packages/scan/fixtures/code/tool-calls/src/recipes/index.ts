import type { RecipeContext } from './_recipe-context.js';

export interface Recipe {
  id: string;
  execute(params: Record<string, unknown>, ctx: RecipeContext): Promise<unknown>;
}

const morningCount: Recipe = {
  id: 'morning_count',
  execute: async (_params, ctx) => ctx.invokeTool('getStock', { sku: 'all' }),
};

export const RECIPES_BY_ID: ReadonlyMap<string, Recipe> = new Map([[morningCount.id, morningCount]]);
