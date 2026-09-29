// The model asks for a playbook by name; the run function returns its text as the tool result.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { SKILLS } from './generated/registry.js';

export const loadSkill = tool({
  description: 'Load the playbook of one desk skill by name.',
  inputSchema: z.object({ name: z.string() }),
  execute: async ({ name }) => {
    const skill = SKILLS.find((s) => s.name === name);
    if (skill === undefined) return { error: `Unknown skill ${name}` };
    return { data: skill.body };
  },
});

async function playbook(): Promise<string> {
  return readFile(join(import.meta.dirname, '..', 'playbooks', 'returns.md'), 'utf8');
}

export const returnsPlaybook = tool({
  description: 'Read the returns playbook.',
  inputSchema: z.object({}),
  execute: async () => playbook(),
});

export async function answer(prompt: string): Promise<string> {
  const r = await generateText({ model: 'anthropic/claude-sonnet-4.5', tools: { loadSkill, returnsPlaybook }, prompt });
  return r.text;
}
