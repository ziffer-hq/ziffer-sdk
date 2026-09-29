/**
 * An application of any size, for the first screen's door diagram (ACP-455 presentation, second
 * design, 2026-09-28): `tools` tools, `callers` entries into the dispatcher, `paths` places where a
 * tool runs another tool unseen, `outside` tools that do not pass the dispatcher, with or without a
 * dispatcher at all. The STRESS shape is 214 tools, 9 callers and 14 paths, the size the design was
 * drawn for; its labels are long on purpose, so the truncation rules have something to cut.
 *
 * Every name is invented (a bookshop's shelves). Named `*.test.data.ts`, so the published tarball
 * leaves it out and `node --test` does not run it. Nothing here was graded: the verdicts are shaped
 * as `decide` returns them.
 */

import type { CiVerdict } from '../ci/ci.js';
import { countsOf, NOTICE_ONLY_UNLISTED, whatZifferDoes } from '../code/grade.js';
import type { CallerCheck, CodeSection, CodeTool, CodeToolVerdict, Dispatcher, ToolCall } from '../code/types.js';
import type { SkillRead } from '../types.js';
import { CODE } from './code.fixture.test.data.js';

export interface AppShape {
  tools: number;
  callers: number;
  paths: number;
  outside: number;
  /** False: no function every tool runs through. */
  door?: boolean;
  /** Long names and paths everywhere a label is drawn, so every truncation rule fires. */
  long?: boolean;
}

export const STRESS: AppShape = { tools: 214, callers: 9, paths: 14, outside: 11, long: true };

const at = (file: string, line: number): { file: string; line: number; col: number } => ({ file, line, col: 1 });

const held = (rule: string): CiVerdict => ({ verdict: 'ATTEST', risk: 'HIGH', reversibility: 'IRREVERSIBLE', effective_tier: 'T3', rule_id: rule });
const notice = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'MEDIUM', reversibility: 'IRREVERSIBLE', effective_tier: 'T1', rule_id: rule });
const read = (rule: string): CiVerdict => ({ verdict: 'ALLOW', risk: 'LOW', reversibility: 'REVERSIBLE', effective_tier: 'T0', rule_id: rule });

/** The outside tools' names: the first three read like a real loop's own tools. */
const OUTSIDE = ['respond', 'handoffToLibrarian', 'searchTheWholeCatalogueForARareFirstEdition'];

export function shapedApp(n: AppShape): CodeSection {
  const hasDoor = n.door ?? true;
  const door = n.long === true ? 'dispatchShelfToolCallWithAuditTrail' : 'runTool';
  const dir = n.long === true ? 'services/bookshop-backoffice/src/lib/agents/shelf-tools/handlers' : 'src/tools';
  const tool = (name: string, dispatched: boolean): CodeTool => ({
    name,
    description: 'A shelf tool.',
    schema_kind: 'zod',
    params: [],
    sdk: 'local',
    via: 'defineTool() (app-local factory)',
    defined_at: at(`${dir}/${name}.ts`, 10),
    execute_at: at(`${dir}/${name}.ts`, 20),
    ...(dispatched && hasDoor ? { delegates_to: door } : {}),
  });
  const inside = n.tools - n.outside;
  const nHeld = Math.round(inside * 0.2);
  const nNotice = Math.round(inside * 0.38);
  const verdicts: CodeToolVerdict[] = [];
  for (let i = 0; i < inside; i++) {
    const kind = i < nHeld ? 'held' : i < nHeld + nNotice ? 'notice' : 'read';
    const name = kind === 'held' ? `purgeShelf${i}` : kind === 'notice' ? `restockShelf${i}` : `listShelf${i}`;
    const t = tool(n.long === true && i === 0 ? 'purgeEveryShelfInTheBackRoomAndArchiveTheReceipts' : name, true);
    const v = kind === 'held' ? held(t.name) : kind === 'notice' ? notice(t.name) : read(t.name);
    verdicts.push({
      tool: t,
      verdict: v,
      what_ziffer_does: kind === 'notice' ? NOTICE_ONLY_UNLISTED : whatZifferDoes(v),
      ...(kind === 'held' ? { draft_reason: 'name says "purge"', irreversible_class: 3 as const } : {}),
      untrusted_input: false,
      egress: false,
    });
  }
  for (let i = 0; i < n.outside; i++) {
    const t = tool(OUTSIDE[i] ?? `shelfOutside${i}`, false);
    verdicts.push({ tool: t, verdict: read(t.name), what_ziffer_does: whatZifferDoes(read(t.name)), untrusted_input: false, egress: false });
  }
  // One path per outer tool, on the held tools, alternating a named inner tool and a computed one.
  const withCalls = verdicts.map((v, i) => {
    if (i >= n.paths) return v;
    const call: ToolCall =
      i % 2 === 0
        ? { tool: n.long === true ? `restockShelfFromTheWarehouseAfterClosing${i}` : `restockShelf${nHeld + i}`, at: at(`${dir}/purge-shelf-${i}.ts`, 40 + i), via: 'direct', through: [] }
        : { at: at(`${dir}/playbooks/context-${i}.ts`, 70 + i), via: 'lookup', through: ['buildContext', 'invokeTool'] };
    return { ...v, tool: { ...v.tool, calls: [call] } };
  });
  const callers = Array.from({ length: n.callers }, (_, i) => at(n.long === true ? `${dir}/../../desks/decorators/shelf-desk-decision-logger-${i}.ts` : `src/desks/desk-${i}.ts`, 12 + i));
  // Callers 0, 1 and 5 have no check found; the others test a confirmation first.
  const unchecked = new Set([0, 1, 5]);
  const checks: CallerCheck[] = callers.map((caller, i): CallerCheck => {
    if (i === 0) {
      return { caller, in_function: 'loggedShelfCall', offered: ['listShelf40', 'listShelf41', 'purgeShelf0'], offered_from: 'scripts/shelf-canary.ts:8, ALL_TOOLS filtered by the name prefix "shelf_"' };
    }
    if (unchecked.has(i)) return { caller, in_function: n.long === true ? 'runTheNightlyScheduledShelfAgentForEveryStore' : `nightlyShelfAgent${i}` };
    return {
      caller,
      in_function:
        n.long === true && i === 2
          ? `router.post('/organisations/:organisationId/stores/:storeId/shelves/:shelfId/confirmed-action-that-a-person-approved')`
          : `router.post('/stores/:storeId/shelves/${i}/confirmed-action')`,
      check: { at: at(`src/desks/desk-${i}.ts`, 5 + i), reads: n.long === true ? 'requires_explicit_librarian_confirmation' : 'confirmed' },
    };
  });
  const dispatcher: Dispatcher = { name: door, at: at(`${dir}/../${n.long === true ? 'shelf-tool-dispatcher-with-audit.ts' : 'run-tool.ts'}`, 56), signature: '(name, input, ctx)', callers, tools_delegating: inside, caller_checks: checks };
  return {
    ...CODE,
    catalog: {
      ...CODE.catalog,
      package_name: n.long === true ? 'lantern-bookshop-backoffice' : 'corner-bookshop',
      tools: withCalls.map((v) => v.tool),
      dispatchers: hasDoor ? [dispatcher] : [],
      checks: [{ language: 'typescript', tool_calls: true, caller_checks: true }],
      syntax_only: { found: 3, missed: verdicts.length - 3 },
      not_seen: ['12 file(s) import packages the type checker could not resolve (not installed); readings that need the framework types are not made there.'],
    },
    verdicts: withCalls,
    insertion: { ...CODE.insertion, dispatcher: hasDoor ? dispatcher : null, per_tool: !hasDoor, call: 'await zifferGate(name, input, zifferOperator(ctx));' },
    pairs: [],
    counts: countsOf(withCalls),
  };
}

// ---------------------------------------------------------------- the skills the application gives its model (ACP-460)

/** Where the invented back office keeps its model's skills, as a real orchestrator folder would. */
const SKILL_DIR = 'services/bookshop-backoffice/src/lib/orchestrator/skills';

/**
 * The skills of `shapedApp(STRESS)`'s back office, one of each shape the contract allows: loaded by
 * code into the model's instructions; embedded in source and returned by a tool; found by its name
 * only; found by its front matter only; one naming a held tool, a tool not held and a name no tool
 * carries. Then the developers' own: a coding assistant's skill that declares `Bash(git add:*)` and
 * carries no cross-check, and an instruction file. Tool names are `shapedApp(STRESS)`'s: `purgeShelf1` and
 * `purgeShelf2` are held, `restockShelf60` is not.
 */
export const APP_SKILLS: readonly SkillRead[] = [
  {
    path: `${SKILL_DIR}/returns-desk/SKILL.md`,
    kind: 'skill',
    name: 'returns-desk',
    declares: ['purgeShelf1', 'purgeShelf2', 'restockShelf60', 'reserveRareFirstEdition'],
    exercises: [{ capability: 'network', file: `${SKILL_DIR}/returns-desk/SKILL.md`, line: 31, evidence: 'curl https://returns.corner-bookshop.invalid/api' }],
    instruction_hits: [],
    home: 'application',
    found_by: ['name', 'code'],
    loaded_by: [
      {
        path: `${SKILL_DIR}/returns-desk/SKILL.md`,
        how: 'read',
        at: { file: 'services/bookshop-backoffice/src/lib/orchestrator/load-skills.ts', line: 22 },
        reaches: { kind: 'instructions', at: { file: 'services/bookshop-backoffice/src/lib/orchestrator/agent.ts', line: 48 }, via: 'system' },
      },
    ],
    declared_tools: [
      { name: 'purgeShelf1', in_code: true, held: true },
      { name: 'purgeShelf2', in_code: true, held: true },
      { name: 'restockShelf60', in_code: true, held: false },
      { name: 'reserveRareFirstEdition', in_code: false },
    ],
  },
  {
    path: `${SKILL_DIR}/shelf-lookup/SKILL.md`,
    kind: 'skill',
    name: 'shelf-lookup',
    exercises: [],
    instruction_hits: [],
    home: 'application',
    found_by: ['name', 'code'],
    loaded_by: [
      {
        path: `${SKILL_DIR}/shelf-lookup/SKILL.md`,
        how: 'embedded',
        at: { file: 'services/bookshop-backoffice/src/lib/orchestrator/skills.generated.ts', line: 3 },
        reaches: { kind: 'tool_result', at: { file: 'services/bookshop-backoffice/src/lib/orchestrator/tools/load-skill.ts', line: 17 }, via: 'loadSkill' },
      },
    ],
  },
  {
    path: `${SKILL_DIR}/gift-wrapping/SKILL.md`,
    kind: 'skill',
    name: 'gift-wrapping',
    declares: ['restockShelf60'],
    exercises: [],
    instruction_hits: [],
    home: 'application',
    found_by: ['name'],
    declared_tools: [{ name: 'restockShelf60', in_code: true, held: false }],
  },
  {
    path: 'services/bookshop-backoffice/prompts/overdue-reminder.md',
    kind: 'skill',
    name: 'overdue-reminder',
    exercises: [],
    instruction_hits: [],
    home: 'application',
    found_by: ['shape'],
    loaded_by: [{ path: 'services/bookshop-backoffice/prompts/overdue-reminder.md', how: 'imported', at: { file: 'services/bookshop-backoffice/src/jobs/overdue.ts', line: 5 } }],
  },
  {
    path: '.claude/skills/release-notes/SKILL.md',
    kind: 'skill',
    name: 'release-notes',
    declares: ['Bash(git add:*)', 'Read'],
    exercises: [{ capability: 'shell', file: '.claude/skills/release-notes/SKILL.md', line: 14, evidence: 'git add CHANGELOG.md' }],
    instruction_hits: [],
    home: 'assistant',
    found_by: ['name'],
  },
  { path: 'CLAUDE.md', kind: 'instructions', name: 'CLAUDE.md', exercises: [], instruction_hits: [], home: 'assistant', found_by: ['name'] },
];

/** The STRESS shape for the skills section: `n` application skills (30 by default), each loaded by code, so the "+ N more" dialog has rows to hold. */
export function manyAppSkills(n = 30): SkillRead[] {
  return Array.from({ length: n }, (_, i): SkillRead => {
    const path = `${SKILL_DIR}/shelf-task-${String(i).padStart(2, '0')}/SKILL.md`;
    return {
      path,
      kind: 'skill',
      name: `shelf-task-${String(i).padStart(2, '0')}`,
      declares: [`purgeShelf${1 + (i % 3)}`, `restockShelf${60 + (i % 5)}`],
      exercises: [],
      instruction_hits: [],
      home: 'application',
      found_by: ['name', 'code'],
      loaded_by: [{ path, how: 'read', at: { file: 'services/bookshop-backoffice/src/lib/orchestrator/load-skills.ts', line: 22 }, reaches: { kind: 'instructions', at: { file: 'services/bookshop-backoffice/src/lib/orchestrator/agent.ts', line: 48 }, via: 'system' } }],
      declared_tools: [
        { name: `purgeShelf${1 + (i % 3)}`, in_code: true, held: true },
        { name: `restockShelf${60 + (i % 5)}`, in_code: true, held: false },
      ],
    };
  });
}

/** `n` coding-assistant skills (6 by default), so that group's own "+ N more" has rows to hold. */
export function manyAssistantSkills(n = 6): SkillRead[] {
  return Array.from({ length: n }, (_, i): SkillRead => ({
    path: `.agents/skills/shelf-chore-${i}/SKILL.md`,
    kind: 'skill',
    name: `shelf-chore-${i}`,
    exercises: [{ capability: 'shell', file: `.agents/skills/shelf-chore-${i}/SKILL.md`, line: 7, evidence: 'pnpm lint' }],
    instruction_hits: [],
    home: 'assistant',
    found_by: ['name'],
  }));
}

/** The whole stress inventory: the six shapes above, 30 more application skills, 6 more coding-assistant skills. */
export const STRESS_SKILLS: readonly SkillRead[] = [...APP_SKILLS, ...manyAppSkills(), ...manyAssistantSkills()];
