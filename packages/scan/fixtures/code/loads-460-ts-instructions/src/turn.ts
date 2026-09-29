// A wrapper owns the model call; the caller hands it the instructions, as the real shape does.
import { streamText, type ModelMessage } from 'ai';
import { shelfCount } from './tools/shelf.js';

export interface TurnInput {
  system: string;
  messages: ModelMessage[];
}

export async function runTurn(input: TurnInput): Promise<string> {
  const { system, messages } = input;
  const result = streamText({ model: 'anthropic/claude-sonnet-4.5', system, messages, tools: { shelfCount } });
  return result.text;
}
