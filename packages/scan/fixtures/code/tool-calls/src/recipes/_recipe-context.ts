import { TOOLS_BY_NAME } from '../tools/handlers/index.js';
import type { ToolContext } from '../tools/tool-module.js';

export interface RecipeContext {
  storeId: number;
  invokeTool(toolName: string, input: Record<string, unknown>): Promise<unknown>;
}

/** The context a recipe runs with: its invokeTool takes any tool from the tools map by name. */
export function buildRecipeContext(storeId: number, actorUserId: string | null): RecipeContext {
  return {
    storeId,
    async invokeTool(toolName, input) {
      if (toolName === 'runRecipe') throw new Error('nested recipe');
      const tool = TOOLS_BY_NAME.get(toolName);
      if (!tool) return { error: `unknown tool ${toolName}` };
      const toolCtx: ToolContext = { storeId, actorUserId };
      return tool.execute(input, toolCtx);
    },
  };
}
