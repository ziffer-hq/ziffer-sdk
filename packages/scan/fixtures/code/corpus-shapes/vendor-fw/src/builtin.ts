// The framework's OWN source (its package.json names a framework package): not the application's tool.
import { tool } from '@openai/agents';

export const builtinEcho = tool({ name: 'framework_builtin', description: 'Echo.', parameters: {}, execute: async () => 'x' });

// An MCP attach point in the framework's own source: the framework's, not said as the application's.
export const hostedConfig = { mcp_servers: [{ url: 'http://localhost:9000' }] };

// A Bedrock InvokeModel call in the framework's own source: its honesty line counts only the example's.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const internalInvoke = new InvokeModelCommand({ modelId: 'internal', body: '{}' });
