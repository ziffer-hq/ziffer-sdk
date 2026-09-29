// The output tsconfig.build.json names as its outDir: never read.
import { tool } from 'ai';
import { z } from 'zod';
export const outOnlyTool = tool({ description: 'Only in the outDir', inputSchema: z.object({}), execute: async () => ({}) });
