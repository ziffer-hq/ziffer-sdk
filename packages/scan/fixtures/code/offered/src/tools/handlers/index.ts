import type { ToolModule } from '../tool-module.js';
import { tool as shelfCount } from './shelf-count.js';
import { tool as shelfRestock } from './shelf-restock.js';
import { tool as tillOpen } from './till-open.js';
import { tool as tillClose } from './till-close.js';
import { tool as sendReceipt } from './send-receipt.js';
import { tool as getTillPin } from './get-till-pin.js';

export const ALL_TOOLS: readonly ToolModule[] = [shelfCount, shelfRestock, tillOpen, tillClose, sendReceipt, getTillPin];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolModule> = new Map(ALL_TOOLS.map((t) => [t.name, t]));
