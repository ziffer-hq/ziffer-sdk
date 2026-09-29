/**
 * The cross-check (ACP-460): each tool a skill DECLARES, against the tools the code scan found
 * and the verdict the draft policy gave them. A skill the application gives its own model names
 * the application's tools (`tools: findOrder, refundOrder`); this says which of those names the
 * scan found a definition for, and which the draft holds for a person.
 *
 * Names are compared exactly as written first. When no tool has the exact name, a NEAR match
 * (both names lowercased, every `-` and `_` removed: `refund-order`, `refund_order` and
 * `refundOrder` are one name) is still reported as `in_code: true`, because a skill author and a
 * tool author spelling one name two ways is a naming habit, not a missing tool. The near match
 * only ever says a tool exists; `held` is read from the tool it matched.
 *
 * An assistant's skill (`home: 'assistant'`) declares the ASSISTANT's tools (`Read`,
 * `Bash(git add:*)`), which are never in the application's code: its `declared_tools` stays
 * absent rather than reporting every one as missing.
 */

import type { CodeSection, CodeTool } from '../code/types.js';
import type { SkillRead } from '../types.js';

type Declared = NonNullable<SkillRead['declared_tools']>[number];

/** The near-match key: lowercased, `-` and `_` removed. */
export const nearKey = (name: string): string => name.toLowerCase().replace(/[-_]/g, '');

/** One declared name against the code's tools and verdicts. */
function check(name: string, code: CodeSection): Declared {
  const exact = code.catalog.tools.filter((t) => t.name === name);
  const matched: CodeTool[] = exact.length > 0 ? exact : code.catalog.tools.filter((t) => nearKey(t.name) === nearKey(name));
  if (matched.length === 0) return { name, in_code: false };
  const names = new Set(matched.map((t) => t.name));
  const verdicts = code.verdicts.filter((v) => names.has(v.tool.name));
  if (verdicts.length === 0) return { name, in_code: true };
  return { name, in_code: true, held: verdicts.some((v) => v.verdict.verdict === 'ATTEST') };
}

/** `skills` with `declared_tools` filled for every skill that declares tools and is not an assistant's; the input is not changed. */
export function joinDeclared(skills: readonly SkillRead[], code: CodeSection): SkillRead[] {
  return skills.map((s) => {
    if (s.declares === undefined || s.declares.length === 0 || s.home === 'assistant') return s;
    return { ...s, declared_tools: s.declares.map((name) => check(name, code)) };
  });
}
