/**
 * Narrowing an `unknown` the engine returned into a typed value, field by
 * field, with no cast. A cast would be a second, unchecked statement of the
 * engine's response shape; these guards check the shape the design record
 * states and refuse by name when the module answered something else.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class EngineResultMalformed extends Error {
  override readonly name = 'EngineResultMalformed';
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isJson(v: unknown): v is Json {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  if (isRecord(v)) return Object.values(v).every(isJson);
  return false;
}

function bad(where: string, what: string): never {
  throw new EngineResultMalformed(`${where}: ${what}`);
}

export function rec(v: unknown, where: string): Record<string, unknown> {
  return isRecord(v) ? v : bad(where, 'not an object');
}

export function str(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key];
  return typeof v === 'string' ? v : bad(`${where}.${key}`, 'not a string');
}

export function num(o: Record<string, unknown>, key: string, where: string): number {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : bad(`${where}.${key}`, 'not a number');
}

export function bool(o: Record<string, unknown>, key: string, where: string): boolean {
  const v = o[key];
  return typeof v === 'boolean' ? v : bad(`${where}.${key}`, 'not a boolean');
}

export function strs(o: Record<string, unknown>, key: string, where: string): string[] {
  const v = o[key];
  if (!Array.isArray(v)) return bad(`${where}.${key}`, 'not an array');
  return v.map((x, i) => (typeof x === 'string' ? x : bad(`${where}.${key}[${i}]`, 'not a string')));
}

export function json(o: Record<string, unknown>, key: string, where: string): Json {
  const v = o[key];
  return isJson(v) ? v : bad(`${where}.${key}`, 'not JSON');
}

export function oneOf<T extends string>(
  o: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  where: string,
): T {
  const v = o[key];
  const hit = allowed.find((a) => a === v);
  return hit ?? bad(`${where}.${key}`, `not one of ${allowed.join(', ')}`);
}
