// Test code: walked past, counted, never a tool of the application.
import { tool } from '@openai/agents';

export const probe = tool({ name: 'test_probe', description: 'A probe.', parameters: {}, execute: async () => 'ok' });
