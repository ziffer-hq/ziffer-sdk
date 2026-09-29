import type { ToolModule } from '../tool-module.js';
import { tool as cancelReservation } from './cancel-reservation.js';
import { tool as addCharge } from './add-charge.js';
import { tool as getProperty } from './get-property.js';
import { tool as sendGuestMessage } from './send-guest-message.js';

// The static list every other module derives from.
export const ALL_TOOLS: readonly ToolModule[] = [cancelReservation, addCharge, getProperty, sendGuestMessage];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolModule> = new Map(ALL_TOOLS.map((t) => [t.name, t]));
