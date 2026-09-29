// An example inside the framework's package: written as an application would, and counted.
import { tool } from '@openai/agents';

export const demo = tool({ name: 'example_weather', description: 'Get the weather.', parameters: {}, execute: async () => 'sunny' });

// An MCP attach point in an example: the application's, said.
export const demoConfig = { mcp_servers: [{ url: 'http://localhost:9001' }] };

// A Bedrock InvokeModel call in an example: counted.
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export const demoInvoke = new InvokeModelCommand({ modelId: 'demo', body: '{}' });
