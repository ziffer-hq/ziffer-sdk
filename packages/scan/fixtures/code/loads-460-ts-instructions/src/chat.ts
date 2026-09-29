import type { ModelMessage } from 'ai';
import { buildSystem, houseRules } from './prompt.js';
import { runTurn } from './turn.js';

export async function chat(question: string): Promise<string> {
  const messages: ModelMessage[] = [
    { role: 'system', content: houseRules() },
    { role: 'user', content: question },
  ];
  return runTurn({ system: buildSystem(), messages });
}
