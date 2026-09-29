/**
 * ACP-460: the cross-check of what a skill declares against the application's tools and the
 * draft's verdicts. Invented application: `corner-bookshop`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { CiVerdict } from '../ci/ci.js';
import type { CodeSection, CodeTool, CodeToolVerdict } from '../code/types.js';
import type { SkillRead } from '../types.js';
import { joinDeclared } from './join.js';

const tool = (name: string): CodeTool => ({
  name,
  description: '',
  schema_kind: 'zod',
  params: [],
  sdk: 'ai',
  via: 'tool() from "ai"',
  defined_at: { file: 'api/src/tools.ts', line: 1, col: 1 },
});
const allow: CiVerdict = { verdict: 'ALLOW', risk: 'LOW', reversibility: 'REVERSIBLE', effective_tier: 'T0', rule_id: 'r' };
const attest: CiVerdict = { verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T2', rule_id: 'r' };
const verdict = (t: CodeTool, v: CiVerdict): CodeToolVerdict => ({ tool: t, verdict: v, what_ziffer_does: '', untrusted_input: false, egress: false });

const TOOLS = [tool('findOrder'), tool('refundOrder'), tool('ship_parcel'), tool('countShelves')];
const section = (verdicts: CodeToolVerdict[]): CodeSection => ({
  catalog: { root: '.', sdks: [], files_read: 1, tools: TOOLS, exposures: [], dispatchers: [], gates: [], syntax_only: { found: 0, missed: 0 }, not_seen: [] },
  verdicts,
  insertion: { dispatcher: null, per_tool: true, sentence: '', snippet: '', snippet_language: 'typescript', call: '' },
  counts: { tools: TOOLS.length, held: 1, refused: 0, notified: 0, allowed: 3, irreversible: 1 },
});
const [findOrder, refundOrder, shipParcel] = TOOLS;
const GRADED =
  findOrder !== undefined && refundOrder !== undefined && shipParcel !== undefined
    ? section([verdict(findOrder, allow), verdict(refundOrder, attest), verdict(shipParcel, allow)])
    : section([]);

const skill = (declares: string[] | undefined, home: SkillRead['home']): SkillRead => ({
  path: 'api/src/agent/skills/order-desk/SKILL.md',
  kind: 'skill',
  name: 'order-desk',
  exercises: [],
  instruction_hits: [],
  ...(declares === undefined ? {} : { declares }),
  ...(home === undefined ? {} : { home }),
});

test('exact names: in_code, and held when the verdict is ATTEST; a name the code does not define is in_code false with no held', () => {
  const [s] = joinDeclared([skill(['findOrder', 'refundOrder', 'closeShop'], 'application')], GRADED);
  assert.deepEqual(s?.declared_tools, [
    { name: 'findOrder', in_code: true, held: false },
    { name: 'refundOrder', in_code: true, held: true },
    { name: 'closeShop', in_code: false },
  ]);
});

test('near match, both directions: a dashed or underscored declared name finds a camelCase tool, and a camelCase name finds an underscored tool', () => {
  const [s] = joinDeclared([skill(['refund-order', 'refund_order', 'shipParcel', 'SHIP-PARCEL'], 'application')], GRADED);
  assert.deepEqual(s?.declared_tools, [
    { name: 'refund-order', in_code: true, held: true },
    { name: 'refund_order', in_code: true, held: true },
    { name: 'shipParcel', in_code: true, held: false },
    { name: 'SHIP-PARCEL', in_code: true, held: false },
  ]);
});

test('decoy: a near match is only case, dash and underscore; one letter more is not the tool', () => {
  const [s] = joinDeclared([skill(['refundOrders', 'find.order'], 'application')], GRADED);
  assert.deepEqual(s?.declared_tools, [
    { name: 'refundOrders', in_code: false },
    { name: 'find.order', in_code: false },
  ]);
});

test('a tool in the catalog with no verdict is in_code with held absent', () => {
  const [s] = joinDeclared([skill(['countShelves'], 'application')], GRADED);
  assert.deepEqual(s?.declared_tools, [{ name: 'countShelves', in_code: true }]);
});

test('an assistant\'s skill declares the assistant\'s tools: declared_tools stays absent; a skill that declares nothing too', () => {
  const [a, b] = joinDeclared([skill(['Read', 'Bash(git add:*)', 'findOrder'], 'assistant'), skill(undefined, 'application')], GRADED);
  assert.equal(a?.declared_tools, undefined);
  assert.equal(b?.declared_tools, undefined);
});
