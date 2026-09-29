// Two skills bundled as text: one by a raw import, one by require through a bundler's text loader.
import { createRequire } from 'node:module';
import orderDesk from '../skills/order-desk/SKILL.md?raw';

const require = createRequire(import.meta.url);
const returns: string = require('../prompts/returns.md');

export const DESKS = { orderDesk, returns };
