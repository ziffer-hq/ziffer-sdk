// Every skill folder is read at start-up: a readdir loop, and a template with one name in it.
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SKILLS_DIR = path.join(import.meta.dirname, '..', 'skills');

export function loadAll(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    out.set(entry.name, readFileSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'), 'utf8'));
  }
  return out;
}

export async function loadOne(name: string): Promise<string> {
  return readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
}

// A loop over a list the source does not say the origin of reads no path: the folder's own
// AGENTS.md is not listed as read here, though the path joins the folder with one name.
export function loadListed(listed: string[]): string[] {
  const out: string[] = [];
  const root = path.join(import.meta.dirname, '..');
  for (const rel of listed.toSorted()) out.push(readFileSync(path.join(root, rel), 'utf8'));
  return out;
}

// A path whose file name is wholly a parameter names no file: AGENTS.md beside it is not listed.
export function readChange(changePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', changePath), 'utf8');
}
