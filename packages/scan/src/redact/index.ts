/**
 * What the scan never prints (ACP-449).
 *
 * The first run on a real machine printed two API keys in the confirmation
 * listing: a server's command line is configuration a person wrote, and people
 * put credentials in it (an `--api-key=` and an `--access-token` flag, each with a live value).
 * The listing, the terminal report, the `--json` document and every finding
 * pass through here before they are printed, and a value that looks like a
 * credential becomes `[redacted]` in place.
 *
 * Every rule is in `data/redact.json`; this file holds none, so a new token
 * shape is an edit to the data file and a test, never a second list in code.
 * The real values are untouched where they are USED: discovery keeps them and
 * `mcp/client.ts` starts the approved server with them. Only what is shown
 * changes.
 *
 * Environment values are replaced unconditionally, with no rule consulted: a
 * variable a configuration declares for a server is there to reach the server
 * and nobody else, and a rule that decided some were safe to print would be
 * the one that was wrong on somebody's machine.
 */

import { readFileSync } from 'node:fs';

import type { ConfiguredIn, ScanResult } from '../types.js';

export class RedactDataInvalid extends Error {
  override readonly name = 'RedactDataInvalid';
  constructor(detail: string) {
    super(`RedactDataInvalid: data/redact.json: ${detail}`);
  }
}

export interface RedactRules {
  replacement: string;
  /** The words, as the data file lists them: a test asserts the code reads these and no others. */
  flagWords: readonly string[];
  valuePrefixes: readonly string[];
  /** A flag or variable name that carries a credential. */
  name: RegExp;
  /** A value that starts like a credential. */
  valueStart: RegExp;
  /** The same prefixes anywhere in running text, at the start of a word. */
  valueInText: RegExp;
  /** `name=value` in running text, e.g. a URL's `?token=...`. */
  assignInText: RegExp;
  /** `--name value` in running text. */
  flagInText: RegExp;
}

export const REDACT_DATA_URL = new URL('../../data/redact.json', import.meta.url);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length === 0 || !v.every((x): x is string => typeof x === 'string' && x !== '')) {
    throw new RedactDataInvalid(`${key} must be a non-empty list of non-empty strings`);
  }
  return v;
}

function compile(source: string, flags: string, what: string): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (e) {
    throw new RedactDataInvalid(`${what} does not compile: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Characters a credential value runs to: stops at white space, quotes, a backslash, and URL/list separators. */
const VALUE_CHAR = `[^\\s"'\\\\&,;)]`;
const VALUE = `${VALUE_CHAR}+`;
const NAME_CHARS = '[A-Za-z0-9_.-]';

export function parseRedactData(raw: unknown): RedactRules {
  if (!isRecord(raw)) throw new RedactDataInvalid('the file is not an object');
  const replacement = raw['replacement'];
  if (typeof replacement !== 'string' || replacement === '') throw new RedactDataInvalid('replacement must be a non-empty string');
  const flagWords = stringList(raw, 'flag_words');
  const valuePrefixes = stringList(raw, 'value_prefixes');
  for (const p of valuePrefixes) compile(p, '', `value_prefixes entry ${JSON.stringify(p)}`);
  const words = flagWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const prefixes = valuePrefixes.map((p) => `(?:${p})`).join('|');
  const rules: RedactRules = {
    replacement,
    flagWords,
    valuePrefixes,
    name: compile(`(?:${words})`, 'i', 'flag_words'),
    valueStart: compile(`^(?:${prefixes})`, '', 'value_prefixes'),
    valueInText: compile(`(?<![A-Za-z0-9_-])(?:${prefixes})${VALUE_CHAR}*`, 'g', 'value_prefixes'),
    assignInText: compile(`(${NAME_CHARS}*(?:${words})${NAME_CHARS}*)=${VALUE}`, 'gi', 'flag_words'),
    flagInText: compile(`(--?${NAME_CHARS}*(?:${words})${NAME_CHARS}*)(\\s+)(?!-)${VALUE}`, 'gi', 'flag_words'),
  };
  return rules;
}

export function loadRedactData(url: URL = REDACT_DATA_URL): RedactRules {
  const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'));
  return parseRedactData(parsed);
}

let cached: RedactRules | undefined;
/** The rules from `data/redact.json`, read once. */
export function redactRules(): RedactRules {
  cached ??= loadRedactData();
  return cached;
}

/** Credentials in running text: a finding, a URL, a description, a path. */
export function redactText(text: string, rules: RedactRules = redactRules()): string {
  const r = rules.replacement;
  return text
    .replace(/(:\/\/[^\s/:@]+:)[^\s/@]+@/g, `$1${r}@`)
    .replace(rules.assignInText, `$1=${r}`)
    .replace(rules.flagInText, `$1$2${r}`)
    .replace(rules.valueInText, r);
}

/**
 * A command line, argument by argument: `--name=value`, `--name value`,
 * `NAME=value` and `Name: value` where the name carries a credential word, a
 * bare value that starts like a credential, and anything the running-text pass
 * catches inside an argument (a URL's query, say).
 */
export function redactArgv(argv: readonly string[], rules: RedactRules = redactRules()): string[] {
  const r = rules.replacement;
  const out: string[] = [];
  let valueNext = false;
  for (const arg of argv) {
    if (valueNext && !arg.startsWith('-')) {
      out.push(r);
      valueNext = false;
      continue;
    }
    valueNext = false;
    const assign = /^(-{0,2}[A-Za-z0-9_.-]+)=(.*)$/s.exec(arg);
    if (assign !== null) {
      const [, name = '', value = ''] = assign;
      out.push(rules.name.test(name) || rules.valueStart.test(value) ? `${name}=${r}` : redactText(arg, rules));
      continue;
    }
    const header = /^([A-Za-z][A-Za-z0-9_-]*):\s*(\S.*)$/s.exec(arg);
    if (header !== null && rules.name.test(header[1] ?? '')) {
      out.push(`${header[1] ?? ''}: ${r}`);
      continue;
    }
    if (arg.startsWith('-')) {
      valueNext = rules.name.test(arg);
      out.push(arg);
      continue;
    }
    out.push(rules.valueStart.test(arg) ? r : redactText(arg, rules));
  }
  return out;
}

/** An environment as it may be shown: every name, no value. */
export function redactEnv(env: Readonly<Record<string, string>>, rules: RedactRules = redactRules()): string[] {
  return Object.keys(env).map((name) => `${name}=${rules.replacement}`);
}

/** Every string in a JSON-shaped value, keys included. For the `--json` document. */
export function redactDeep(value: unknown, rules: RedactRules = redactRules()): unknown {
  if (typeof value === 'string') return redactText(value, rules);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, rules));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[redactText(k, rules)] = redactDeep(v, rules);
    return out;
  }
  return value;
}

/**
 * The scan result as the terminal report may show it. Names are redacted the
 * same way everywhere they appear, so a classification still finds its tool.
 */
export function redactResult(result: ScanResult, rules: RedactRules = redactRules()): ScanResult {
  const t = (s: string): string => redactText(s, rules);
  const place = (p: ConfiguredIn): ConfiguredIn => (p.project === undefined ? { file: t(p.file) } : { file: t(p.file), project: t(p.project) });
  const list = (xs: readonly ConfiguredIn[] | undefined): ConfiguredIn[] | undefined => (xs === undefined ? undefined : xs.map(place));
  return {
    ...result,
    catalog: result.catalog.map((c) => {
      const out = { ...c, server: t(c.server), tool: t(c.tool), description: t(c.description), params: c.params.map(t), source_path: t(c.source_path) };
      const where = list(c.configured_in);
      if (where !== undefined) out.configured_in = where;
      return out;
    }),
    classifications: result.classifications.map((c) => ({ ...c, server: t(c.server), tool: t(c.tool) })),
    findings: result.findings.map((f) => {
      const out = { ...f, id: t(f.id), message: t(f.message), tools: f.tools.map(t) };
      if (f.server !== undefined) out.server = t(f.server);
      const where = list(f.configured_in);
      if (where !== undefined) out.configured_in = where;
      return out;
    }),
  };
}
