/**
 * The words both reports and the MCP server use for three readings added on 2026-09-28:
 * instruction-like text in the application's own tool descriptions, the skills and instruction
 * files found under the root, and the pairs of `data/pairs.json` among the application's own
 * tools. Written once, so the terminal, the page and the agent cannot say it three ways.
 *
 * NOTHING HERE MEASURES. The hits are `CodeToolVerdict.instruction_hits` and
 * `SkillRead.instruction_hits`, the pairs `codePairs` (the installed half's pair logic over the
 * drafts the policy was written from, carried by the result as `CodeSection.pairs`); this module orders them and turns them into sentences.
 */

import { instructionPhrase } from '../classify/index.js';
import { dataLeavingPairs } from '../code/grade.js';
import { REACH_DEPTH } from '../code/ts/reach.js';
import type { CallerCheck, CodePair, CodeSection, CodeToolVerdict } from '../code/types.js';
import { capabilityCounts, type Capability } from '../skills/index.js';
import type { InstructionHit, SkillLoad, SkillRead } from '../types.js';
import { where } from './code.js';

// ---------------------------------------------------------------- instructions inside tool descriptions

/** One hit in one of the application's own tool descriptions, with the tool it is in. */
export interface ToolInstruction {
  tool: string;
  at: string;
  hit: InstructionHit;
}

/** Every hit in the application's own descriptions, HIGH first, then by tool name. */
export function toolInstructions(code: CodeSection): ToolInstruction[] {
  const rank = (h: InstructionHit): number => (h.severity === 'high' ? 0 : h.severity === 'warn' ? 1 : 2);
  return code.verdicts
    .flatMap((v) => (v.instruction_hits ?? []).map((hit) => ({ tool: v.tool.name, at: where(v.tool.defined_at), hit })))
    .sort((a, b) => rank(a.hit) - rank(b.hit) || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
}

/**
 * "Your description of send_digest tells the model to drop its earlier instructions." The author of
 * the description is the application's own team, so it is said as their writing, never as an attack.
 */
export function toolInstructionSentence(x: Pick<ToolInstruction, 'tool' | 'hit'>): string {
  return `Your description of ${x.tool} ${instructionPhrase(x.hit.why)}.`;
}

/** "The instructions file CLAUDE.md, line 12, tells the model to ...". */
export function skillInstructionSentence(s: Pick<SkillRead, 'path' | 'kind'>, hit: InstructionHit): string {
  const what = s.kind === 'skill' ? 'The skill' : 'The instruction file';
  return `${what} ${s.path}${hit.line === undefined ? '' : `, line ${hit.line},`} ${instructionPhrase(hit.why)}.`;
}

/** The HIGH hits a first screen and an agent are told about: the tools' first, then the files'. */
export interface HighInstruction {
  sentence: string;
  excerpt: string;
  /** `file:line` a person opens. */
  at: string;
  /** The tool's name, or the file's path. */
  subject: string;
  source: 'tool' | 'skill';
}

export function highInstructions(code: CodeSection | undefined, skills: readonly SkillRead[] | undefined): HighInstruction[] {
  const tools = code === undefined ? [] : toolInstructions(code).filter((x) => x.hit.severity === 'high');
  const files = (skills ?? []).flatMap((s) => s.instruction_hits.filter((h) => h.severity === 'high').map((hit) => ({ s, hit })));
  return [
    ...tools.map((x): HighInstruction => ({ sentence: toolInstructionSentence(x), excerpt: x.hit.excerpt, at: x.at, subject: x.tool, source: 'tool' })),
    ...files.map(({ s, hit }): HighInstruction => ({ sentence: skillInstructionSentence(s, hit), excerpt: hit.excerpt, at: `${s.path}:${hit.line ?? 1}`, subject: s.path, source: 'skill' })),
  ];
}

// ---------------------------------------------------------------- skills and instruction files

export const SKILLS_TITLE = 'Skills and instruction files';
export const SKILLS_LEAD =
  'Read as text. A skill that declares no tool list is normal; the list shows what each one can do so you can decide which ones a model should load.';
export const DECLARES_NOTHING = 'declares no tool list';
/** How the section says an instruction hit was read: the whole text, examples and code blocks included. */
export const SKILL_HITS_READ =
  'Instruction-like text is read in the whole file, code blocks and quoted examples included: a model loading the file reads those too.';
export const SKILLS_NONE = 'No skill and no instruction file was found under the scanned folder.';

const CAPABILITY_WORDS: Record<Capability, string> = {
  shell: 'runs shell commands',
  network: 'reaches the network',
  file_write: 'writes files outside its folder',
  credentials: 'reads credentials',
};

/** "runs shell commands (3), reaches the network (1)", or '' when it shows none. */
export function capabilityText(s: Pick<SkillRead, 'exercises'>): string {
  return capabilityCounts(s)
    .map((c) => `${CAPABILITY_WORDS[c.capability]} (${c.n})`)
    .join(', ');
}

/** Each capability as "none of these ... runs a shell command": the same four, in the same order, as `CAPABILITY_WORDS`. */
const CAPABILITY_NONE: Record<Capability, string> = {
  shell: 'runs a shell command',
  network: 'reaches the network',
  file_write: 'writes files outside its folder',
  credentials: 'reads credentials',
};

/**
 * The one sentence under a skills table that left out "What it can do", "Instruction hits" or both
 * because every row held its empty value (ACP-460). True of what the scan looks for: the four
 * capabilities, read from code blocks, inline commands and the scripts in the folder; and the
 * instruction patterns, of any severity. Undefined when no column was left out.
 */
export function emptyColumnsSentence(noun: 'skills' | 'files', noCapability: boolean, noHits: boolean): string | undefined {
  const caps = Object.values(CAPABILITY_NONE);
  const can = `${caps.slice(0, -1).join(', ')} or ${caps[caps.length - 1] ?? ''} in its code blocks, its inline commands or the scripts in its folder`;
  if (noCapability && noHits) return `None of these ${noun} ${can}, and none carries an instruction hit.`;
  if (noCapability) return `None of these ${noun} ${can}.`;
  if (noHits) return `None of these ${noun} carries an instruction hit.`;
  return undefined;
}

export function capabilityWord(c: Capability): string {
  return CAPABILITY_WORDS[c];
}

/**
 * One line for an agent or a terminal. A result that says who loads each file (ACP-460) gets the
 * page's own count sentence, `skillsCountSentence`; one made before it keeps "7 skills and 2
 * instruction files read".
 */
export function skillsSummary(skills: readonly SkillRead[]): string {
  const high = skills.filter((s) => s.instruction_hits.some((h) => h.severity === 'high')).length;
  if (skillsGrouped(skills)) {
    return `${skillsCountSentence(skills)} ${high === 0 ? 'No high-severity instruction hit.' : `${high} with a high-severity instruction hit.`}`;
  }
  const skill = skills.filter((s) => s.kind === 'skill').length;
  const files = skills.length - skill;
  const counted = `${skill} ${skill === 1 ? 'skill' : 'skills'} and ${files} instruction ${files === 1 ? 'file' : 'files'} read`;
  return high === 0 ? `${counted}, no high-severity instruction hit.` : `${counted}, ${high} with a high-severity instruction hit.`;
}

// ---------------------------------------------------------------- who loads each file (ACP-460)

/**
 * Whether the result says who loads each file: true when any entry carries `home`. A result made
 * before it has none, and is shown as one list, as it was.
 */
export function skillsGrouped(skills: readonly SkillRead[]): boolean {
  return skills.some((s) => s.home !== undefined);
}

/** The skills a model inside the application is given, as the contract's `home` says. */
export const applicationSkills = (skills: readonly SkillRead[]): SkillRead[] => skills.filter((s) => s.home === 'application');
/** The coding assistants' skills and instruction files; an entry with no `home` in a grouped result is theirs only if the contract said so, so it is not counted here. */
export const assistantSkills = (skills: readonly SkillRead[]): SkillRead[] => skills.filter((s) => s.home === 'assistant');

export const APP_SKILLS_TITLE = 'Skills your application gives its own model';
export const APP_SKILLS_LEAD = 'A model inside your product reads these.';
export const APP_SKILLS_SAY = 'Each row says how the scan found the skill, the tools it names, and what its text can do.';
export const ASSISTANT_SKILLS_TITLE = 'Skills and instruction files of the coding assistants';
export const ASSISTANT_SKILLS_LEAD = 'Used by your developers on this code.';
export const ASSISTANT_SKILLS_SAY = 'They sit where a coding assistant looks for them, and the scan saw no code of your application load them.';
/** The lead under the section heading once the list is in two groups. */
export const SKILLS_LEAD_GROUPED = 'Read as text. First the skills your application gives its own model, then the files of the coding assistants your developers use on this code.';
/** Said when the application group is empty, with what that sentence does not cover. */
export const APP_SKILLS_NONE = 'The scan found no skill your application loads.';
export const APP_SKILLS_NOT_COVERED = 'Skills stored in a database or fetched at run time are not seen.';
export const NO_LOAD_SEEN = 'Looks like a skill; the scan did not see what loads it.';
export const NOT_FOLLOWED = 'Where the text goes from there was not followed.';

/** What the limits section says the three ways of finding a skill do not see, each under the heading it answers. */
export const SKILL_LIMITS: readonly { group: 'runtime' | 'how' | 'unread'; text: string }[] = [
  { group: 'runtime', text: 'Skills stored in a database or fetched from a service at run time are not seen: only files under the scanned folder are.' },
  { group: 'how', text: 'A skill whose text your code builds from many small strings is not matched to its file: the scan follows whole files and long runs of text.' },
  {
    group: 'how',
    text: `Where a skill’s text goes is followed through your own functions at most ${REACH_DEPTH} calls deep, and not through a function taken from a map by name, a class field, a database or a cache.`,
  },
  { group: 'how', text: 'A file path built from configuration or an environment variable is not resolved, and a library’s prompt loader is not read as loading a file.' },
  { group: 'how', text: 'A model call that is given no tools is not recognised as a place a skill’s text goes.' },
  { group: 'unread', text: 'A file is taken for a skill by its name (SKILL.md), by front matter with both a name and a description, or by your code loading it; front matter in another form is not read.' },
];

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * The count sentence the page, the terminal and the agent share: how many skills the application
 * gives its model and how many of those the scan saw your code load; then the coding assistants'
 * files. Never says a skill is loaded when only its name or its shape was seen.
 */
export function skillsCountSentence(skills: readonly SkillRead[]): string {
  const app = applicationSkills(skills);
  const asst = assistantSkills(skills);
  const appSkills = app.filter((s) => s.kind === 'skill').length;
  const appFiles = app.length - appSkills;
  const loaded = app.filter((s) => (s.loaded_by ?? []).length > 0).length;
  const appWhat = [...(appSkills > 0 ? [count(appSkills, 'skill')] : []), ...(appFiles > 0 ? [count(appFiles, 'instruction file')] : [])].join(' and ');
  const them = app.length === 1 ? 'it' : 'them';
  const appPart =
    app.length === 0
      ? `${APP_SKILLS_NONE} ${APP_SKILLS_NOT_COVERED}`
      : `Your application gives its model ${appWhat}; ${
          loaded === app.length ? `the scan saw your code load ${app.length === 1 ? 'it' : 'each one'}` : loaded === 0 ? `the scan did not see what loads ${them}` : `the scan saw your code load ${loaded} of ${them}`
        }.`;
  const aSkills = asst.filter((s) => s.kind === 'skill').length;
  const aFiles = asst.length - aSkills;
  const asstWhat = [...(aSkills > 0 ? [count(aSkills, 'skill')] : []), ...(aFiles > 0 ? [count(aFiles, 'instruction file')] : [])].join(' and ');
  const asstPart = asst.length === 0 ? 'No file of a coding assistant was found.' : `${asstWhat} ${asst.length === 1 ? 'belongs' : 'belong'} to the coding assistants used on this code.`;
  return `${appPart} ${asstPart.charAt(0).toUpperCase()}${asstPart.slice(1)}`;
}

/** How a reader is told where one place in the code is: the page sets it in mono with its full path on hover, the agent writes it out. */
export interface PlaceWords {
  /** One place, `file:line`. */
  place: (at: { file: string; line: number }) => string;
  /** A name or a call quoted as code. */
  code: (s: string) => string;
  /** Plain text, escaped for the medium. */
  text: (s: string) => string;
}

/** The skill's loads, as a reader is told them (ACP-460): the lines in ink, then the muted ones. */
export interface LoadLines {
  lines: string[];
  muted: string[];
}

/** How many other places "Also loaded at" names before "+ N more". */
export const ALSO_LOADED_SHOWN = 2;

/**
 * The tool's NAME from a tool result's `via`, as the front ends write it ("loadSkill: execute()
 * returns it"): the part before the colon. A `via` with no colon is the name itself.
 */
export function viaToolName(via: string): string {
  const i = via.indexOf(':');
  return (i < 0 ? via : via.slice(0, i)).trim();
}

/**
 * Where a skill's text goes and where it sits, one source for the page and the agent. Rules:
 * lead with WHERE IT GOES from the load that has `reaches` (instructions before a tool result);
 * then where the text sits, for that same load; every other load is one muted "Also loaded at"
 * line; "not followed" is said only when NO load has `reaches`. No load at all: the one sentence
 * that says the scan did not see what loads it.
 */
export function skillLoadLines(loads: readonly SkillLoad[], w: PlaceWords): LoadLines {
  if (loads.length === 0) return { lines: [], muted: [w.text(NO_LOAD_SEEN)] };
  const lead = loads.find((l) => l.reaches?.kind === 'instructions') ?? loads.find((l) => l.reaches?.kind === 'tool_result') ?? loads[0];
  if (lead === undefined) return { lines: [], muted: [w.text(NO_LOAD_SEEN)] };
  const lines: string[] = [];
  const r = lead.reaches;
  if (r !== undefined) {
    lines.push(
      r.kind === 'tool_result'
        ? `${w.text('Returned to the model by the tool')} ${w.code(viaToolName(r.via))} ${w.text('at')} ${w.place(r.at)}.`
        : `${w.text('Goes into the model’s instructions through')} ${w.code(r.via)} ${w.text('at')} ${w.place(r.at)}.`,
    );
  }
  lines.push(`${w.text(LOAD_SITS[lead.how])} ${w.place(lead.at)}.`);
  const others = loads.filter((l) => l !== lead);
  const shown = others.slice(0, ALSO_LOADED_SHOWN).map((l) => w.place(l.at));
  const muted = [
    ...(others.length === 0 ? [] : [`${w.text('Also loaded at')} ${shown.join(', ')}${others.length > shown.length ? ` ${w.text(`+ ${others.length - shown.length} more`)}` : ''}.`]),
    ...(loads.some((l) => l.reaches !== undefined) ? [] : [w.text(NOT_FOLLOWED)]),
  ];
  return { lines, muted };
}

/** Who reads one file, for the agent's per-file lines: the page says the same of each group under its heading. */
export const GIVEN_TO: Record<NonNullable<SkillRead['home']>, string> = {
  application: "Given to your application's own model.",
  assistant: 'It sits where a coding assistant looks for it, and the scan saw no code of your application load it.',
};

/** The same lines as one plain sentence run, for the agent and the terminal: places written out in full. */
export function skillLoadText(s: Pick<SkillRead, 'loaded_by'>): string {
  const said = skillLoadLines(s.loaded_by ?? [], { place: (p) => `${p.file}:${p.line}`, code: (x) => x, text: (x) => x });
  return [...said.lines, ...said.muted].join(' ');
}

/** Where the text sits, for the leading load: "Its text is in", "Read from disk at", "Imported as text at". */
export const LOAD_SITS: Record<SkillLoad['how'], string> = {
  read: 'Read from disk at',
  embedded: 'Its text is in',
  imported: 'Imported as text at',
};

/** The declared tools a skill names that the draft holds for a person: "2 held for a person: a, b", or undefined. */
export function heldToolsLine(s: Pick<SkillRead, 'declared_tools'>): { count: string; names: string[] } | undefined {
  const held = (s.declared_tools ?? []).filter((d) => d.in_code && d.held === true).map((d) => d.name);
  return held.length === 0 ? undefined : { count: `${held.length} held for a person`, names: held };
}

/** The declared names with no tool of that name in the code, as the page's line opens. */
export const NAMED_NOT_IN_CODE = 'Named by the skill, no tool of that name found in your code:';

// ---------------------------------------------------------------- data that could leave, as pairs

/** How many pairs "Data that could leave" lists before "and N more"; the appendix lists every one. */
export const PAIRS_SHOWN = 10;

/** One pair as a reader sees it: "<reader> reads <what>; <sender> sends data out", and what the source shows about one path. */
export interface PairRow {
  pair: CodePair;
  reader: CodeToolVerdict | undefined;
  sender: CodeToolVerdict | undefined;
  /** What `pairs.json` calls side a, from the rule id (`read_email+send_email` -> `email`). */
  what: string;
  sentence: string;
  /** Present when some caller's `offered` list is known: whether one path's list names both. */
  path?: string;
}

/** A tool the engine would hold: the sender a reader cares about first. */
const heldVerdict = (v: CodeToolVerdict | undefined): boolean =>
  v !== undefined && v.verdict.verdict !== 'REFUSED' && (v.verdict.verdict === 'ATTEST' || v.verdict.risk === 'HIGH');

function pathSentence(pair: CodePair, offered: readonly CallerCheck[]): string | undefined {
  if (offered.length === 0) return undefined;
  const both = pair.same_path === undefined ? undefined : offered.find((c) => c.in_function === pair.same_path && (c.offered ?? []).includes(pair.reader) && (c.offered ?? []).includes(pair.sender));
  if (both !== undefined) {
    return `Both are on one path's list (${both.offered_from ?? where(both.caller)}): the pair is within one model's reach as far as the source shows.`;
  }
  return 'No path whose list the source shows names both.';
}

/**
 * The pairs the result carries (`CodeSection.pairs`, computed once by `dataLeavingPairs`), one row
 * each, the pairs whose sender the engine holds first, then by name. A result made before the field
 * existed is read by the same function. Conditional on both being given to the same model: the
 * sentences say so.
 */
export function pairRows(code: CodeSection): PairRow[] {
  const byName = new Map(code.verdicts.map((v) => [v.tool.name, v]));
  const offered = code.catalog.dispatchers.flatMap((d) => d.caller_checks ?? []).filter((c) => c.offered !== undefined && c.offered.length > 0);
  const rows = (code.pairs ?? dataLeavingPairs(code.catalog)).map((pair): PairRow => {
    const what = (pair.id.split('+')[0] ?? '').replace(/^read_/, '').replace(/_/g, ' ');
    const path = pathSentence(pair, offered);
    return {
      pair,
      reader: byName.get(pair.reader),
      sender: byName.get(pair.sender),
      what,
      sentence: `${pair.reader} reads ${what} (its ${pair.basis}); ${pair.sender} sends data out.`,
      ...(path === undefined ? {} : { path }),
    };
  });
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return rows.sort((a, b) => Number(heldVerdict(b.sender)) - Number(heldVerdict(a.sender)) || cmp(a.pair.reader, b.pair.reader) || cmp(a.pair.sender, b.pair.sender));
}

/** The terminal's and the agent's one line on the pairs, or undefined when the result carries none. */
export function pairsLine(code: CodeSection): string | undefined {
  const rows = pairRows(code);
  if (rows.length === 0) return undefined;
  const shown = rows.slice(0, 3).map((r) => `${r.pair.reader} and ${r.pair.sender}`);
  const more = rows.length - shown.length;
  return `Pairs of your tools where one reads and the other sends data out: ${rows.length} (${shown.join('; ')}${more > 0 ? `; ${more} more` : ''}). ${PAIRS_CONDITION}`;
}

export const PAIRS_CONDITION = 'Each pair is a path only if both tools are given to the same model.';
