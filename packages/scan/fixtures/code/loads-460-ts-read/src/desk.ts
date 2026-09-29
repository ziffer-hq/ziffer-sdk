// The order-desk skill is read from its file at start-up and kept; where it goes is not in this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ORDER_DESK = readFileSync(join(import.meta.dirname, '..', 'skills', 'order-desk', 'SKILL.md'), 'utf8');
