import type { ToolModule } from '../tool-module.js';
import { tool as publishNotice } from './publish-notice.js';
import { tool as closeStore } from './close-store.js';
import { tool as getStock } from './get-stock.js';
import { tool as restock } from './restock.js';
import { tool as auditShelf } from './audit-shelf.js';
import { tool as runRecipe } from './run-recipe.js';
import { tool as notifyOwner } from './notify-owner.js';
import { tool as formatPrice } from './format-price.js';

export const ALL_TOOLS: readonly ToolModule[] = [publishNotice, closeStore, getStock, restock, auditShelf, runRecipe, notifyOwner, formatPrice];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolModule> = new Map(ALL_TOOLS.map((t) => [t.name, t]));
