import { z } from 'zod';
import { defineTool } from '../tool-module.js';
import { RECIPES_BY_ID } from '../../recipes/index.js';
import { buildRecipeContext } from '../../recipes/_recipe-context.js';

// Shape 4: a recipe taken from a recipe map (not a tool map), run with a context whose
// method takes ANY tool from the tools map by a computed name.
export const tool = defineTool({
  name: 'runRecipe',
  description: 'Run a named recipe of several tools and return one answer.',
  requires_confirmation: false,
  zodSchema: z.object({ recipeId: z.string() }),
  async execute(input, ctx) {
    const recipe = RECIPES_BY_ID.get(input.recipeId);
    if (recipe === undefined) return { error: `unknown recipe ${input.recipeId}` };
    const recipeCtx = buildRecipeContext(ctx.storeId, ctx.actorUserId);
    const result = await recipe.execute({}, recipeCtx);
    return { result };
  },
});
