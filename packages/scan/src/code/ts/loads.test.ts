/**
 * The third signal (ACP-460) over `fixtures/code/loads-460-ts-*`: where an application's TypeScript
 * reads, imports or embeds a skill or instruction file, and where the text goes when the walk can
 * follow it. One fixture per way a file is loaded, one for a folder loop, one per `reaches` kind,
 * and one negative. The application (`corner-bookshop`) and its skills (`order-desk`, `returns`)
 * are invented.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { SkillLoad } from '../../types.js';
import { scanCode } from '../index.js';
import { EmbedIndex, normaliseText, parseLoadNames } from './loads.js';

const fixture = (name: string): string => fileURLToPath(new URL(`../../../fixtures/code/loads-460-ts-${name}/`, import.meta.url));

async function loads(name: string): Promise<SkillLoad[]> {
  const c = await scanCode(fixture(name));
  assert.deepEqual(c.checks?.find((x) => x.language === 'typescript')?.skill_loads, true, 'the TypeScript front end says it looked');
  assert.ok(c.skill_loads !== undefined, 'skill_loads is present when the check ran');
  return c.skill_loads;
}

test('read: a readFileSync of join(import.meta.dirname, ...) literals is a read of the SKILL.md it names; nothing follows it to a model, so reaches is absent', async () => {
  assert.deepEqual(await loads('read'), [{ path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'src/desk.ts', line: 5 } }]);
});

test('imported: a ?raw import and a require of a text file are imports; a .md with name and description in its front matter is a skill by shape', async () => {
  assert.deepEqual(await loads('imported'), [
    { path: 'prompts/returns.md', how: 'imported', at: { file: 'src/desk.ts', line: 6 } },
    { path: 'skills/order-desk/SKILL.md', how: 'imported', at: { file: 'src/desk.ts', line: 3 } },
  ]);
});

test('embedded: a generated registry literal holding a SKILL.md body (reflowed) is an embedding; a literal sharing only its closing paragraph is not', async () => {
  assert.deepEqual(await loads('embedded'), [{ path: 'skills/order-desk/SKILL.md', how: 'embedded', at: { file: 'src/generated/registry.ts', line: 10 } }]);
});

test('folder: a readdir loop and a template with one name in it read every SKILL.md in the folder; a text file the pattern does not name, a loop over a list of unknown origin, and a file name that is wholly a parameter, read nothing', async () => {
  assert.deepEqual(await loads('folder'), [
    { path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'src/skills.ts', line: 12 } },
    { path: 'skills/order-desk/SKILL.md', how: 'read', at: { file: 'src/skills.ts', line: 18 } },
    { path: 'skills/returns/SKILL.md', how: 'read', at: { file: 'src/skills.ts', line: 12 } },
    { path: 'skills/returns/SKILL.md', how: 'read', at: { file: 'src/skills.ts', line: 18 } },
  ]);
});

test('reaches instructions: through a wrapper that owns the model call, to `system` and to a system message; a read text file with no skill shape that reaches no model has no entry', async () => {
  assert.deepEqual(await loads('instructions'), [
    {
      path: 'prompts/house-rules.txt',
      how: 'read',
      at: { file: 'src/prompt.ts', line: 12 },
      reaches: { kind: 'instructions', at: { file: 'src/turn.ts', line: 12 }, via: "streamText({ messages: [{ role: 'system' }] })" },
    },
    {
      path: 'skills/order-desk/SKILL.md',
      how: 'read',
      at: { file: 'src/prompt.ts', line: 17 },
      reaches: { kind: 'instructions', at: { file: 'src/turn.ts', line: 12 }, via: 'streamText({ system })' },
    },
  ]);
});

test('reaches tool_result: a registry body a run function returns, and a file read by a helper a run function returns', async () => {
  assert.deepEqual(await loads('tool-result'), [
    {
      path: 'playbooks/returns.md',
      how: 'read',
      at: { file: 'src/tools.ts', line: 19 },
      reaches: { kind: 'tool_result', at: { file: 'src/tools.ts', line: 25 }, via: 'returnsPlaybook: execute() returns it' },
    },
    {
      path: 'skills/order-desk/SKILL.md',
      how: 'embedded',
      at: { file: 'src/generated/registry.ts', line: 3 },
      reaches: { kind: 'tool_result', at: { file: 'src/tools.ts', line: 14 }, via: 'loadSkill: execute() returns it' },
    },
  ]);
});

test('negative: a README read and printed to the console is no load; the check ran and found none', async () => {
  assert.deepEqual(await loads('negative'), []);
});

test('the embedded matcher: a short body matches whole and only whole, a body under 40 characters never, whitespace collapsed on both sides', () => {
  const short = normaliseText('Returns are taken within thirty days,\n  with the receipt.');
  const trivia = 'Close the till.';
  const idx = new EmbedIndex([short, trivia]);
  assert.deepEqual([...idx.match(normaliseText(`${'x'.repeat(200)} Returns are taken within thirty days, with the receipt. ${'y'.repeat(20)}`))], [0]);
  assert.deepEqual([...idx.match(normaliseText(`${'x'.repeat(200)} Returns are taken within thirty days, and more`))], []);
  assert.deepEqual([...idx.match(`${'x'.repeat(200)} Close the till.`)], []);
});

test('the data lists: each must be a non-empty list of names, or the file is refused', () => {
  const ok = { text_read_calls: ['readFile'], text_glob_calls: ['glob'], instruction_params: ['system'] };
  assert.deepEqual(parseLoadNames(JSON.stringify(ok)).instructionParams, ['system']);
  assert.throws(() => parseLoadNames(JSON.stringify({ ...ok, instruction_params: [] })), /instruction_params/);
  assert.throws(() => parseLoadNames(JSON.stringify({ ...ok, text_read_calls: undefined })), /text_read_calls/);
});

test('negative: a tutorial .md with no front matter that quotes the inline prompt of the source is not embedded (either could have copied the other)', async () => {
  assert.deepEqual(await loads('tutorial'), []);
});
