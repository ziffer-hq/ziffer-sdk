import { describe, it, expect } from 'vitest';
import { tool } from 'ai';
import { z } from 'zod';

const fake = tool({ description: 'a fake', inputSchema: z.object({}), execute: async () => ({}) });
describe('answer', () => {
  it('works', () => {
    expect(fake).toBeDefined();
  });
});
