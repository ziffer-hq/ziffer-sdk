// Compiled from src/index.ts (the same path in a folder beside it): never read.
import { tool } from 'ai';
import { z } from 'zod';
export const compiledOnlyTool = tool({ description: 'Only in the compiled copy', inputSchema: z.object({}), execute: async () => ({}) });
