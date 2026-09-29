/**
 * The classifier's three data files, read once at module load and checked
 * against the shape this module relies on.
 *
 * Every heuristic the classifier applies lives in `data/keywords.json`,
 * `data/pairs.json` or `data/poisoned.json`; this file only reads them. A file
 * that does not have the expected shape HALTS the load by name
 * (`ClassifyDataInvalid`), because a heuristic silently skipped is a finding
 * silently never reported, and the scan would print a clean report it cannot
 * back.
 */

import { readFileSync } from 'node:fs';

export type Effect = 'read' | 'write' | 'irreversible';
export type Severity = 'info' | 'warn' | 'high';

export interface Keyword {
  /** The data-file spelling, reported in `matched`. */
  text: string;
  words: string[];
}

export interface KeywordData {
  suffixes: string[];
  effect: Record<Effect, Keyword[]>;
  egress: Keyword[];
  untrusted_input: Keyword[];
  /**
   * The own case's rank of each irreversible keyword (ACP-454): 3 runs or
   * destroys, 2 changes shared state, 1 sends or pays. Keyed by the keyword's
   * data-file spelling; every irreversible keyword has exactly one.
   */
  irreversible_class: Record<string, number>;
  /**
   * A tool name's first word that makes the rest of the name the OBJECT of a
   * read (`explain_publish_failure`), so a keyword later in the name does not
   * name the tool's action (ACP-454).
   */
  read_verbs: Keyword[];
  /**
   * Verbs that neither only read nor name a write of their object (`classify`,
   * `route`, `score`, ...): after one, a keyword later in the name is the object
   * (`classify_reply` classifies a reply), and the head verb decides nothing on its
   * own (ACP-455). Also what a namespace prefix gives way to (`prospector_classify_reply`).
   */
  neutral_verbs: Keyword[];
  finding_severity: { unclassified: Severity; irreversible: Severity; egress: Severity };
  /** What a description says about undoing the tool (ACP-455): `cannot_be_undone` may make the draft stricter, the other two never change it. */
  undo_phrases: UndoPhrases;
  /** Verb pairs whose two tools undo each other, and the noun variations allowed between them (ACP-455). A hint only. */
  inverse_verbs: InverseVerbs;
  /** Secrets and access values named by a tool's name or parameter names (ACP-455): drafted stricter, never looser. */
  sensitive_values: { words: Keyword[]; not_secret: Keyword[] };
  /** Whole name words that say a tool returns numbers about text, not the text (2026-09-28): never a pair's reader, never an outsider's way in. */
  counts_not_text: string[];
}

export type UndoSays = 'can_be_undone' | 'cannot_be_undone' | 'reads_only';

export interface UndoPhrases {
  phrases: Record<UndoSays, Keyword[]>;
  /** A phrase whose word just before is one of these (lowercase, as written, apostrophes kept) does not count. */
  negators: string[];
}

export interface InverseVerbs {
  /** `[first, inverse]`: the first verb's tool is undone by the inverse verb's tool, never the other way round. */
  pairs: [string, string][];
  state_words: string[];
  connectives: string[];
  /** Each word of a group reads as the group's first word. */
  same_nouns: string[][];
}

export interface SideWhen {
  effect?: Effect[];
  egress?: true;
  untrusted_input?: true;
}

export interface PairSide {
  keywords: Keyword[];
  when: SideWhen;
}

export interface PairRule {
  id: string;
  a: PairSide;
  b: PairSide;
  severity: Severity;
  why: string;
}

export type PoisonRule =
  | { id: string; kind: 'pattern'; regex: RegExp; severity: Severity; why: string }
  | { id: string; kind: 'length'; max_length: number; severity: Severity; why: string };

export class ClassifyDataInvalid extends Error {
  constructor(file: string, detail: string) {
    super(`ClassifyDataInvalid: data/${file}: ${detail}`);
    this.name = 'ClassifyDataInvalid';
  }
}

type Json = unknown;

function isRecord(v: Json): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(file: string, where: string, v: Json): string[] {
  if (!Array.isArray(v)) throw new ClassifyDataInvalid(file, `${where} is not a list`);
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new ClassifyDataInvalid(file, `${where} holds a non-string or empty entry`);
    }
    out.push(item);
  }
  return out;
}

function str(file: string, where: string, v: Json): string {
  if (typeof v !== 'string' || v.length === 0) throw new ClassifyDataInvalid(file, `${where} is not a non-empty string`);
  return v;
}

function severity(file: string, where: string, v: Json): Severity {
  if (v === 'info' || v === 'warn' || v === 'high') return v;
  throw new ClassifyDataInvalid(file, `${where} is not one of info, warn, high`);
}

function effect(file: string, where: string, v: Json): Effect {
  if (v === 'read' || v === 'write' || v === 'irreversible') return v;
  throw new ClassifyDataInvalid(file, `${where} is not one of read, write, irreversible`);
}

export function keywordsOf(file: string, where: string, v: Json, split: (s: string) => string[]): Keyword[] {
  return stringList(file, where, v).map((text) => {
    const w = split(text);
    if (w.length === 0) throw new ClassifyDataInvalid(file, `${where} entry "${text}" has no words`);
    return { text, words: w };
  });
}

/**
 * Every irreversible keyword in exactly one class, and nothing else: a keyword
 * with no class would rank below every classed one in silence, which is a
 * ranking chosen by omission.
 */
function irreversibleClass(f: string, v: Json, irreversible: readonly Keyword[]): Record<string, number> {
  if (!isRecord(v)) throw new ClassifyDataInvalid(f, 'irreversible_class is not an object');
  const known = new Set(irreversible.map((k) => k.text));
  const out: Record<string, number> = {};
  for (const key of Object.keys(v)) {
    const n = Number(key);
    if (!['1', '2', '3'].includes(key)) throw new ClassifyDataInvalid(f, `irreversible_class has unknown class "${key}"`);
    for (const text of stringList(f, `irreversible_class.${key}`, v[key])) {
      if (!known.has(text)) throw new ClassifyDataInvalid(f, `irreversible_class.${key} names "${text}", which is not an irreversible keyword`);
      if (text in out) throw new ClassifyDataInvalid(f, `irreversible_class names "${text}" twice`);
      out[text] = n;
    }
  }
  for (const text of known) {
    if (!(text in out)) throw new ClassifyDataInvalid(f, `irreversible keyword "${text}" has no irreversible_class`);
  }
  return out;
}

/** One word each: the rule compares a name's FIRST word, so a two-word entry could never fire. */
function readVerbs(f: string, v: Json, split: (s: string) => string[], key = 'read_verbs'): Keyword[] {
  const list = keywordsOf(f, key, v, split);
  for (const k of list) {
    if (k.words.length !== 1) throw new ClassifyDataInvalid(f, `${key} entry "${k.text}" is not one word`);
  }
  return list;
}

function section(f: string, raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = raw[key];
  if (!isRecord(v)) throw new ClassifyDataInvalid(f, `${key} is not an object`);
  str(f, `${key}.note`, v['note']);
  return v;
}

/** One lowercase word each, as `words` splits it: a pair or a noun group compares split words, so an entry `words` would split could never fire. */
function singleWords(f: string, where: string, v: Json, split: (s: string) => string[]): string[] {
  const list = stringList(f, where, v);
  for (const w of list) {
    const got = split(w);
    if (got.length !== 1 || got[0] !== w) throw new ClassifyDataInvalid(f, `${where} entry "${w}" is not one lowercase word`);
  }
  return list;
}

function undoPhrases(f: string, raw: Record<string, unknown>, split: (s: string) => string[]): UndoPhrases {
  const v = section(f, raw, 'undo_phrases');
  return {
    phrases: {
      cannot_be_undone: keywordsOf(f, 'undo_phrases.cannot_be_undone', v['cannot_be_undone'], split),
      can_be_undone: keywordsOf(f, 'undo_phrases.can_be_undone', v['can_be_undone'], split),
      reads_only: keywordsOf(f, 'undo_phrases.reads_only', v['reads_only'], split),
    },
    negators: stringList(f, 'undo_phrases.negators', v['negators']).map((n) => n.toLowerCase()),
  };
}

function inverseVerbs(f: string, raw: Record<string, unknown>, split: (s: string) => string[]): InverseVerbs {
  const v = section(f, raw, 'inverse_verbs');
  const pairs = v['pairs'];
  if (!Array.isArray(pairs) || pairs.length === 0) throw new ClassifyDataInvalid(f, 'inverse_verbs.pairs is not a non-empty list');
  const groups = v['same_nouns'];
  if (!Array.isArray(groups)) throw new ClassifyDataInvalid(f, 'inverse_verbs.same_nouns is not a list');
  return {
    pairs: pairs.map((p: Json, i): [string, string] => {
      const two = singleWords(f, `inverse_verbs.pairs[${i}]`, p, split);
      const [a, b] = two;
      if (two.length !== 2 || a === undefined || b === undefined || a === b) throw new ClassifyDataInvalid(f, `inverse_verbs.pairs[${i}] is not two different verbs`);
      return [a, b];
    }),
    state_words: singleWords(f, 'inverse_verbs.state_words', v['state_words'], split),
    connectives: singleWords(f, 'inverse_verbs.connectives', v['connectives'], split),
    same_nouns: groups.map((g: Json, i) => {
      const list = singleWords(f, `inverse_verbs.same_nouns[${i}]`, g, split);
      if (list.length < 2) throw new ClassifyDataInvalid(f, `inverse_verbs.same_nouns[${i}] has fewer than two words`);
      return list;
    }),
  };
}

export function parseKeywords(raw: Json, split: (s: string) => string[]): KeywordData {
  const f = 'keywords.json';
  if (!isRecord(raw)) throw new ClassifyDataInvalid(f, 'top level is not an object');
  const eff = raw['effect'];
  if (!isRecord(eff)) throw new ClassifyDataInvalid(f, 'effect is not an object');
  const sev = raw['finding_severity'];
  if (!isRecord(sev)) throw new ClassifyDataInvalid(f, 'finding_severity is not an object');
  const irreversible = keywordsOf(f, 'effect.irreversible', eff['irreversible'], split);
  return {
    suffixes: stringList(f, 'suffixes', raw['suffixes']),
    effect: {
      irreversible,
      write: keywordsOf(f, 'effect.write', eff['write'], split),
      read: keywordsOf(f, 'effect.read', eff['read'], split),
    },
    egress: keywordsOf(f, 'egress', raw['egress'], split),
    untrusted_input: keywordsOf(f, 'untrusted_input', raw['untrusted_input'], split),
    irreversible_class: irreversibleClass(f, raw['irreversible_class'], irreversible),
    read_verbs: readVerbs(f, raw['read_verbs'], split),
    neutral_verbs: readVerbs(f, raw['neutral_verbs'], split, 'neutral_verbs'),
    finding_severity: {
      unclassified: severity(f, 'finding_severity.unclassified', sev['unclassified']),
      irreversible: severity(f, 'finding_severity.irreversible', sev['irreversible']),
      egress: severity(f, 'finding_severity.egress', sev['egress']),
    },
    undo_phrases: undoPhrases(f, raw, split),
    inverse_verbs: inverseVerbs(f, raw, split),
    sensitive_values: (() => {
      const v = section(f, raw, 'sensitive_values');
      return {
        words: keywordsOf(f, 'sensitive_values.words', v['words'], split),
        not_secret: keywordsOf(f, 'sensitive_values.not_secret', v['not_secret'], split),
      };
    })(),
    counts_not_text: (() => {
      const v = section(f, raw, 'counts_not_text');
      const list = stringList(f, 'counts_not_text.words', v['words']);
      // Whole words compared to a name's split words: an entry of two words, or one the split would change, could never match.
      for (const w of list) if (split(w).join(' ') !== w || w.includes(' ')) throw new ClassifyDataInvalid(f, `counts_not_text.words entry "${w}" is not one lower-case word`);
      return list;
    })(),
  };
}

function sideWhen(f: string, where: string, v: Json): SideWhen {
  if (v === undefined) return {};
  if (!isRecord(v)) throw new ClassifyDataInvalid(f, `${where} is not an object`);
  const out: SideWhen = {};
  for (const key of Object.keys(v)) {
    const val = v[key];
    if (key === 'effect') {
      if (!Array.isArray(val) || val.length === 0) throw new ClassifyDataInvalid(f, `${where}.effect is not a non-empty list`);
      out.effect = val.map((e: Json, i) => effect(f, `${where}.effect[${i}]`, e));
    } else if (key === 'egress' || key === 'untrusted_input') {
      // Only `true` is meaningful: a side that asks for "no egress" would be a
      // claim about absence the draft cannot back.
      if (val !== true) throw new ClassifyDataInvalid(f, `${where}.${key} must be true when present`);
      out[key] = true;
    } else {
      throw new ClassifyDataInvalid(f, `${where} has unknown key "${key}"`);
    }
  }
  return out;
}

export function parsePairs(raw: Json, split: (s: string) => string[]): PairRule[] {
  const f = 'pairs.json';
  if (!isRecord(raw) || !Array.isArray(raw['pairs'])) throw new ClassifyDataInvalid(f, 'top level has no "pairs" list');
  const seen = new Set<string>();
  return raw['pairs'].map((p: Json, i) => {
    const where = `pairs[${i}]`;
    if (!isRecord(p)) throw new ClassifyDataInvalid(f, `${where} is not an object`);
    const id = str(f, `${where}.id`, p['id']);
    if (seen.has(id)) throw new ClassifyDataInvalid(f, `pair id "${id}" appears twice`);
    seen.add(id);
    const side = (name: 'a' | 'b'): PairSide => {
      const s = { keywords: keywordsOf(f, `${id}.${name}`, p[name], split), when: sideWhen(f, `${id}.${name}_when`, p[`${name}_when`]) };
      // A side with neither a keyword nor a condition matches every tool,
      // which would fire the pair on any two tools at all.
      if (s.keywords.length === 0 && Object.keys(s.when).length === 0) {
        throw new ClassifyDataInvalid(f, `${id}.${name} has neither keywords nor a condition`);
      }
      return s;
    };
    return { id, a: side('a'), b: side('b'), severity: severity(f, `${id}.severity`, p['severity']), why: str(f, `${id}.why`, p['why']) };
  });
}

export function parsePoisoned(raw: Json): PoisonRule[] {
  const f = 'poisoned.json';
  if (!isRecord(raw) || !Array.isArray(raw['patterns'])) throw new ClassifyDataInvalid(f, 'top level has no "patterns" list');
  const seen = new Set<string>();
  return raw['patterns'].map((p: Json, i): PoisonRule => {
    const where = `patterns[${i}]`;
    if (!isRecord(p)) throw new ClassifyDataInvalid(f, `${where} is not an object`);
    const id = str(f, `${where}.id`, p['id']);
    if (seen.has(id)) throw new ClassifyDataInvalid(f, `pattern id "${id}" appears twice`);
    seen.add(id);
    const sev = severity(f, `${id}.severity`, p['severity']);
    const why = str(f, `${id}.why`, p['why']);
    const max = p['max_length'];
    if (max !== undefined) {
      if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
        throw new ClassifyDataInvalid(f, `${id}.max_length is not a positive integer`);
      }
      return { id, kind: 'length', max_length: max, severity: sev, why };
    }
    const pattern = str(f, `${id}.pattern`, p['pattern']);
    const flags = p['flags'] ?? '';
    if (typeof flags !== 'string') throw new ClassifyDataInvalid(f, `${id}.flags is not a string`);
    // `g` and `y` make `test` stateful across calls (lastIndex), so a pattern
    // would fire on one tool and miss the identical next one.
    if (/[gy]/.test(flags)) throw new ClassifyDataInvalid(f, `${id}.flags may not carry g or y`);
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      throw new ClassifyDataInvalid(f, `${id}.pattern does not compile: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { id, kind: 'pattern', regex, severity: sev, why };
  });
}

/** `keywords.json`'s `skill_exercises` (2026-09-28): what the skill inventory looks for, as literals. The section's own `note` says where each is read. */
export interface SkillWords {
  shell_fences: string[];
  script_extensions: string[];
  network: string[];
  write_commands: string[];
  write_calls: string[];
  inside_markers: string[];
  credential_paths: string[];
  not_credential_paths: string[];
  credential_name_words: string[];
}

const SKILL_LISTS = [
  'shell_fences',
  'script_extensions',
  'network',
  'write_commands',
  'write_calls',
  'inside_markers',
  'credential_paths',
  'not_credential_paths',
  'credential_name_words',
] as const;

export function parseSkillWords(raw: Json): SkillWords {
  const f = 'keywords.json';
  if (!isRecord(raw)) throw new ClassifyDataInvalid(f, 'top level is not an object');
  const v = section(f, raw, 'skill_exercises');
  str(f, 'skill_exercises.note', v['note']);
  const list = (k: (typeof SKILL_LISTS)[number]): string[] => {
    const l = stringList(f, `skill_exercises.${k}`, v[k]);
    if (l.length === 0) throw new ClassifyDataInvalid(f, `skill_exercises.${k} is empty`);
    return l;
  };
  const known = new Set<string>(['note', ...SKILL_LISTS]);
  for (const k of Object.keys(v)) if (!known.has(k)) throw new ClassifyDataInvalid(f, `skill_exercises has unknown key "${k}"`);
  return {
    shell_fences: list('shell_fences'),
    script_extensions: list('script_extensions'),
    network: list('network'),
    write_commands: list('write_commands'),
    write_calls: list('write_calls'),
    inside_markers: list('inside_markers'),
    credential_paths: list('credential_paths'),
    not_credential_paths: list('not_credential_paths'),
    credential_name_words: list('credential_name_words'),
  };
}

/** The data directory, `packages/scan/data`, from this module's compiled place in `dist/classify/`. */
export const DATA_DIR = new URL('../../data/', import.meta.url);

export function readDataFile(name: string): Json {
  const text = readFileSync(new URL(name, DATA_DIR), 'utf8');
  const parsed: Json = JSON.parse(text);
  return parsed;
}
