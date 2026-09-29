/**
 * The engine's bundle schemas, compiled once, and the one question asked of
 * them: is this member valid, and if not, where.
 *
 * The schemas are the engine's own files at the pin, embedded verbatim by
 * `scripts/embed-schemas.mjs`. Nothing here restates a rule they carry; a
 * member this module accepts is one the schema accepts.
 *
 * Ajv 2020, `strict: true`, with two settings that need a reason each:
 *
 * - Every `x-acp-*` keyword is declared to Ajv as an annotation (`addKeyword`
 *   with no validation). Strict mode refuses a schema carrying a keyword it does
 *   not know, and these are the engine's data for its code generator (the
 *   fail-safe absent rules, names, orderings), not assertions about an
 *   instance. The list is read from the embedded schemas themselves, so a new
 *   `x-acp-*` keyword at a pin bump is declared without an edit here.
 * - `allowUnionTypes: true`. The wire `proposal.schema.json` (reached through
 *   `adapters.schema.json`'s `$ref` to `schema_id`) declares `param_value` with
 *   `type: [..]`, which is valid JSON Schema that strict mode refuses by
 *   default as a style rule. Allowing it changes what nothing validates.
 * - `validateFormats: false`. `format: "date-time"` needs a format
 *   implementation Ajv does not ship, and writing one here would be a second
 *   definition of the engine's instant grammar (WE-5). The engine is the check
 *   instead: every generated bundle goes through `bundle_verify`, which parses
 *   `expires_at` under WE-5 before anything is written, and `created_at` is
 *   produced by the same formatter. Disclosed: `created_at` itself is not
 *   parsed by anything here.
 */

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, SchemaObject, ValidateFunction } from 'ajv/dist/2020.js';

import { SCHEMAS } from '../generated/schema-source.js';
import type { EmbeddedSchema } from '../generated/schema-source.js';
import { isRecord } from '../wasm/json.js';

/** A generated member refused by its schema. Nothing is written after one. */
export class BundleMemberInvalid extends Error {
  override readonly name = 'BundleMemberInvalid';
  constructor(
    readonly member: string,
    readonly errorPath: string,
    detail: string,
  ) {
    super(`${member}: ${errorPath === '' ? '/' : errorPath} ${detail}`);
  }
}

export class BundleSchemaAbsent extends Error {
  override readonly name = 'BundleSchemaAbsent';
}

/**
 * Member path in the bundle -> the schema file that governs it. The paths are
 * the ones the engine's loader reads (`acp-bundle` `verify.rs`: the registry at
 * `attesters/registry.json`, the rest at the root).
 */
export const MEMBER_SCHEMAS: ReadonlyMap<string, string> = new Map([
  ['manifest.json', 'manifest.schema.json'],
  ['floors.json', 'floors.schema.json'],
  ['risk_functions.json', 'risk_functions.schema.json'],
  ['reversibility.json', 'reversibility.schema.json'],
  ['notice_targets.json', 'notice_targets.schema.json'],
  ['adapters.json', 'adapters.schema.json'],
  ['attesters/registry.json', 'attesters.schema.json'],
  ['door_identities.json', 'door_identities.schema.json'],
  ['receipt_identity.json', 'receipt_identity.schema.json'],
  ['alert_targets.json', 'alert_targets.schema.json'],
  ['limits.json', 'limits.schema.json'],
  ['SIGNATURE', 'signature.schema.json'],
]);

function isSchemaObject(v: unknown): v is SchemaObject {
  return isRecord(v);
}

function parsed(s: EmbeddedSchema): SchemaObject {
  const doc: unknown = JSON.parse(s.text);
  if (!isSchemaObject(doc)) throw new BundleSchemaAbsent(`${s.path} is not a JSON object`);
  return doc;
}

function xAcpKeywords(node: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(node)) for (const n of node) xAcpKeywords(n, out);
  else if (isRecord(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('x-acp-')) out.add(k);
      xAcpKeywords(v, out);
    }
  }
  return out;
}

let compiled: Map<string, ValidateFunction> | undefined;

function validators(): Map<string, ValidateFunction> {
  if (compiled !== undefined) return compiled;
  const docs = SCHEMAS.map((s) => ({ s, doc: parsed(s) }));
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, validateFormats: false, allErrors: false });
  const keywords = new Set<string>();
  for (const { doc } of docs) xAcpKeywords(doc, keywords);
  for (const keyword of keywords) ajv.addKeyword({ keyword });
  for (const { doc } of docs) ajv.addSchema(doc);
  const out = new Map<string, ValidateFunction>();
  for (const [member, file] of MEMBER_SCHEMAS) {
    const entry = docs.find((d) => d.s.bundle && d.s.path.endsWith(`/${file}`));
    const id = entry?.doc['$id'];
    if (entry === undefined || typeof id !== 'string') throw new BundleSchemaAbsent(`no embedded schema ${file}`);
    const fn = ajv.getSchema(id);
    if (fn === undefined) throw new BundleSchemaAbsent(`Ajv compiled no schema for ${id}`);
    out.set(member, fn);
  }
  compiled = out;
  return out;
}

function firstError(errors: ErrorObject[] | null | undefined): { path: string; detail: string } {
  const e = errors?.[0];
  if (e === undefined) return { path: '', detail: 'refused with no error recorded' };
  const extra = e.keyword === 'additionalProperties' && isRecord(e.params) ? ` (${String(e.params['additionalProperty'])})` : '';
  return { path: e.instancePath, detail: `${e.message ?? e.keyword}${extra}` };
}

/** Throws `BundleMemberInvalid` naming the member and the first failing path. */
export function validateMember(member: string, doc: unknown): void {
  const fn = validators().get(member);
  if (fn === undefined) throw new BundleMemberInvalid(member, '', 'is not a bundle member this package generates');
  if (!fn(doc)) {
    const { path, detail } = firstError(fn.errors);
    throw new BundleMemberInvalid(member, path, detail);
  }
}

/** The embedded schema document for a bundle member file, parsed. */
export function memberSchema(file: string): SchemaObject {
  const entry = SCHEMAS.find((s) => s.bundle && s.path.endsWith(`/${file}`));
  if (entry === undefined) throw new BundleSchemaAbsent(`no embedded schema ${file}`);
  return parsed(entry);
}

/**
 * `limits.json` written out with the document's defaults: each property's
 * `x-acp-absent.value`, read from the embedded schema. PB-13 makes the member
 * optional and these the values an absent one means; the scan writes them so
 * the developer sees the numbers, and types none of them itself.
 */
export function limitsDefaults(): Record<string, unknown> {
  const schema = memberSchema('limits.schema.json');
  const props = schema['properties'];
  if (!isRecord(props)) throw new BundleSchemaAbsent('limits.schema.json has no properties');
  const out: Record<string, unknown> = { schema_version: '1' };
  for (const [name, prop] of Object.entries(props)) {
    if (!isRecord(prop)) continue;
    const absent = prop['x-acp-absent'];
    if (isRecord(absent) && absent['behaviour'] === 'value' && 'value' in absent) out[name] = absent['value'];
  }
  return out;
}
