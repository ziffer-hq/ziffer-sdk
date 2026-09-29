// The instructions are built from two files, through two helpers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

export function houseRules(): string {
  return readFileSync(join(ROOT, 'prompts', 'house-rules.txt'), 'utf8').trim();
}

export function buildSystem(): string {
  const parts: string[] = [];
  parts.push(readFileSync(join(ROOT, 'skills/order-desk/SKILL.md'), 'utf8'));
  parts.push('Answer in the language of the customer.');
  return parts.join('\n\n');
}

// Read, but never handed to a model: no entry, because the file has no skill shape.
export const SHELF_NOTES = readFileSync(join(ROOT, 'prompts', 'shelf-notes.txt'), 'utf8');
export const readAny = readText;
