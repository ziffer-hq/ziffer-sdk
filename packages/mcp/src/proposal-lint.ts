/**
 * `lint_proposal` — grade one proposal against the wire Proposal schema, here,
 * before anything is sent (ACP-390).
 *
 * # Why a validator in this package at all
 *
 * `repo-check.ts` argues the opposite way about policy rules and runs the CLI
 * rather than re-implementing them, and that argument is still right THERE: the
 * rules are a moving body of engine code with one implementation. This is a
 * different shape. The wire Proposal schema is a DOCUMENT, it is vendored in
 * this repository, it is embedded in this package at build time by
 * `scripts/embed-guide.mjs`, and the thing being checked is whether a JSON
 * object satisfies it. There is no second opinion available to disagree with,
 * because the schema is the opinion.
 *
 * What this is NOT is a second statement of the schema. Nothing below names a
 * field of a Proposal, a pattern, a length or a required property. The whole of
 * this module is a reader of `SCHEMAS`, and the closure it reads is WALKED from
 * `wire/proposal.schema.json`'s own `$ref`s rather than listed.
 *
 * # The subset, and why an unknown keyword HALTS
 *
 * Draft 2020-12 is large and this implements the keywords the Proposal schema's
 * reachable graph actually uses — twenty-one of them, {@link SCHEMA_KEYWORDS},
 * emitted by the build from that same walk. A keyword outside that set raises
 * {@link SchemaUnsupported} and the tool refuses.
 *
 * That is `tools/codegen.sh`'s rule and `tools/check-policy-template.py`'s, and
 * the reason is the one this repository has published corrections for: a
 * validator that shrugs at a keyword it cannot read reports green about the
 * half it understood. If `oneOf` arrived on the Proposal tomorrow, a reader
 * that ignored it would accept a proposal matching NO branch and say so in a
 * PASS line. `proposal-lint.test.ts` asserts every keyword the embedded closure
 * uses is one of these, so the halt is a build-time fact and not a runtime
 * surprise.
 *
 * This is not `tools/check-policy-template.py` ported. That file's subset is
 * the one the BUNDLE schemas need and carries `oneOf`, `anyOf`, `const`,
 * `uniqueItems`, `format`, `examples` and `default` — none of which the
 * Proposal's graph uses. Porting it blindly would have shipped six keyword
 * implementations nothing exercises, and an unexercised branch in a validator
 * is a check nobody has ever seen fire.
 *
 * # No network, and nothing else either
 *
 * It opens no connection, reads no file at runtime and touches no
 * configuration. A proposal handed to this tool goes nowhere.
 */

import { PROPOSAL_SCHEMA, SCHEMA_KEYWORDS, SCHEMA_ROOT, SCHEMAS } from './generated/schema-source.js';
import type { ToolOutcome } from './tools.js';

/** A keyword, a type name or a `$ref` this reader cannot honour. Never a pass:
 * the tool refuses and names it. */
export class SchemaUnsupported extends Error {
  override readonly name: string;

  constructor(name: string, detail: string) {
    super(`${name}: ${detail}`);
    this.name = name;
  }
}

/** The keywords this reader implements or deliberately ignores. Annotations
 * (`title`, `description`, `$schema`, `$id`, `$defs` and this project's
 * `x-acp-*`) carry no constraint and are listed so that ignoring them is a
 * decision in the source rather than a gap. */
export const IMPLEMENTED_KEYWORDS: readonly string[] = [
  '$ref',
  'type',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'propertyNames',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'items',
  'minItems',
  'maxItems',
];

/** Present, read by nothing, and that is the whole claim. */
export const IGNORED_KEYWORDS: readonly string[] = ['$schema', '$id', '$defs', 'title', 'description'];

/** This project's own annotations: data for `tools/codegen.sh`, never a rule. */
const IGNORED_PREFIX = 'x-acp-';

/** The embedded closure, re-exported so the tests read the same bytes the tool
 * does rather than a second copy off disk. */
export { PROPOSAL_SCHEMA, SCHEMA_KEYWORDS, SCHEMA_ROOT, SCHEMAS };

/** A JSON object, narrowed — never asserted. Every value entering this module
 * is either a customer's proposal or a document off disk, which is exactly the
 * input a cast waves through. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaOf(document: unknown): Record<string, unknown> {
  if (!isRecord(document)) {
    throw new SchemaUnsupported('SchemaMalformed', 'an embedded schema document is not an object.');
  }
  return document;
}

/** `$id` to path, built from the embedded documents themselves. */
const BY_ID = new Map<string, string>();
for (const [path, document] of Object.entries(SCHEMAS)) {
  if (isRecord(document) && typeof document['$id'] === 'string') BY_ID.set(document['$id'], path);
}

/** Where a node lives: the node itself plus the document its own local `$ref`s
 * resolve against. A resolved node carried WITHOUT its document is how a
 * cross-file `$ref` comes to resolve its next hop against the wrong file. */
interface Located {
  readonly node: Record<string, unknown>;
  readonly document: Record<string, unknown>;
}

function resolve(ref: string, from: Record<string, unknown>): Located {
  const hash = ref.indexOf('#');
  const base = hash === -1 ? ref : ref.slice(0, hash);
  const fragment = hash === -1 ? '' : ref.slice(hash + 1);
  let document: Record<string, unknown>;
  if (base === '') {
    document = from;
  } else {
    const path = BY_ID.get(base);
    if (path === undefined) {
      throw new SchemaUnsupported(
        'SchemaRefUnresolvable',
        `${ref} names a schema this package does not carry. The closure is walked from ${PROPOSAL_SCHEMA} at build time; a ref outside it should have halted the build.`,
      );
    }
    document = schemaOf(SCHEMAS[path]);
  }
  let node: unknown = document;
  for (const part of fragment.split('/')) {
    if (part === '') continue;
    if (!isRecord(node)) {
      throw new SchemaUnsupported('SchemaRefUnresolvable', `${ref} points through a non-object.`);
    }
    node = node[part];
  }
  if (!isRecord(node)) {
    throw new SchemaUnsupported('SchemaRefUnresolvable', `${ref} points at nothing.`);
  }
  return { node, document };
}

/** JSON's type names, as the schemas spell them. `integer` is `number` with a
 * whole value — JavaScript has one numeric type, so the check is on the VALUE
 * and `22.0` and `22` are one number here. That is a real difference from the
 * Python reference, where they are distinguishable, and it is noted rather than
 * worked around: EL-2's `22`/`22.0` defect lives at the JSON decoder, and this
 * tool sees a decoded value. */
function matchesType(value: unknown, name: string): boolean {
  switch (name) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'null':
      return value === null;
    default:
      throw new SchemaUnsupported('SchemaTypeUnknown', `the schema names a type this reader does not know: ${name}.`);
  }
}

function typeNames(raw: unknown): readonly string[] {
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw) && raw.every((item): item is string => typeof item === 'string')) return raw;
  throw new SchemaUnsupported('SchemaMalformed', '`type` is neither a string nor an array of strings.');
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Every failure, each naming the field it is about. Empty means it validated.
 *
 * `where` is the path a person can find in their own object, so a finding reads
 * `payload.targets[0]` and not "a string was too long". A validator that says
 * only that something is wrong is a validator whose output gets pasted into a
 * message asking which field.
 */
function validate(
  value: unknown,
  schema: Record<string, unknown>,
  document: Record<string, unknown>,
  where: string,
): string[] {
  for (const keyword of Object.keys(schema)) {
    if (keyword.startsWith(IGNORED_PREFIX)) continue;
    if (IMPLEMENTED_KEYWORDS.includes(keyword) || IGNORED_KEYWORDS.includes(keyword)) continue;
    throw new SchemaUnsupported(
      'SchemaKeywordUnsupported',
      `${where}: the schema uses \`${keyword}\`, which this reader does not implement. It refuses rather than skipping it: a validator that ignores a keyword reports green about the half it understood.`,
    );
  }

  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    // A `$ref` REPLACES the schema here. That is true of every ref in this
    // closure (each sits alone beside a `description`), and a sibling
    // constraint would be silently dropped -- so it is refused instead.
    const siblings = Object.keys(schema).filter(
      (key) => key !== '$ref' && !key.startsWith(IGNORED_PREFIX) && !IGNORED_KEYWORDS.includes(key),
    );
    if (siblings.length > 0) {
      throw new SchemaUnsupported(
        'SchemaRefHasSiblings',
        `${where}: a \`$ref\` sits beside ${siblings.join(', ')}. This reader applies the ref alone, so honouring it would silently drop the rest.`,
      );
    }
    const located = resolve(ref, document);
    return validate(value, located.node, located.document, where);
  }

  const out: string[] = [];

  if ('type' in schema) {
    const wanted = typeNames(schema['type']);
    if (!wanted.some((name) => matchesType(value, name))) {
      // A type miss ends this node: every keyword below assumes the type, and
      // reporting "not an object" AND "missing property x" about one value is
      // two findings about one mistake.
      return [`${where}: expected ${wanted.join(' or ')}, found ${show(value)}`];
    }
  }

  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    out.push(`${where}: ${show(value)} is not one of ${allowed.map((o) => show(o)).join(', ')}`);
  }

  if (typeof value === 'string') {
    const pattern = schema['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern).test(value)) {
      out.push(`${where}: ${show(value)} does not match ${pattern}`);
    }
    const min = schema['minLength'];
    if (typeof min === 'number' && value.length < min) {
      out.push(`${where}: ${value.length} characters, fewer than the ${min} required`);
    }
    const max = schema['maxLength'];
    if (typeof max === 'number' && value.length > max) {
      out.push(`${where}: ${value.length} characters, more than the ${max} allowed`);
    }
  }

  if (typeof value === 'number') {
    const min = schema['minimum'];
    if (typeof min === 'number' && value < min) out.push(`${where}: ${value} is below the minimum ${min}`);
    const max = schema['maximum'];
    if (typeof max === 'number' && value > max) out.push(`${where}: ${value} is above the maximum ${max}`);
  }

  if (isRecord(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === 'string' && !(name in value)) {
          out.push(`${where}.${name}: required property is missing`);
        }
      }
    }
    const properties = schema['properties'];
    const table = isRecord(properties) ? properties : {};
    const extra = schema['additionalProperties'];
    for (const [name, item] of Object.entries(value)) {
      const names = schema['propertyNames'];
      if (isRecord(names)) out.push(...validate(name, names, document, `${where}.<key ${show(name)}>`));
      const declared = table[name];
      if (isRecord(declared)) {
        out.push(...validate(item, declared, document, `${where}.${name}`));
      } else if (extra === false) {
        out.push(`${where}.${name}: not a property this object admits`);
      } else if (isRecord(extra)) {
        out.push(...validate(item, extra, document, `${where}.${name}`));
      }
    }
  }

  if (Array.isArray(value)) {
    const min = schema['minItems'];
    if (typeof min === 'number' && value.length < min) {
      out.push(`${where}: ${value.length} items, fewer than the ${min} required`);
    }
    const max = schema['maxItems'];
    if (typeof max === 'number' && value.length > max) {
      out.push(`${where}: ${value.length} items, more than the ${max} allowed`);
    }
    const items = schema['items'];
    if (isRecord(items)) {
      value.forEach((item, index) => {
        out.push(...validate(item, items, document, `${where}[${index}]`));
      });
    }
  }

  return out;
}

/** Every finding about one proposal, paths and all.
 *
 * @throws SchemaUnsupported when the embedded schema uses something this reader
 * does not implement — never a pass.
 */
export function lintFindings(proposal: unknown): readonly string[] {
  const root = schemaOf(SCHEMAS[PROPOSAL_SCHEMA]);
  return validate(proposal, root, root, 'proposal');
}

/**
 * `lint_proposal`, as `server.ts` calls it.
 *
 * A finding is NOT a tool error. `repo-check.ts` argues this at length and the
 * argument is the same here: the tool was asked to check a proposal and it
 * checked one. `isError` is set only when the reader could not apply the schema
 * at all, because then nothing was checked.
 */
export function lintProposal(proposal: unknown): ToolOutcome {
  let findings: readonly string[];
  try {
    findings = lintFindings(proposal);
  } catch (error) {
    if (error instanceof SchemaUnsupported) {
      return { text: `${error.name}: ${error.message.slice(error.name.length + 2)}`, isError: true };
    }
    return {
      text: `LintFailed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }

  const head = `lint_proposal against the published wire Proposal schema (${PROPOSAL_SCHEMA})`;
  if (findings.length === 0) {
    return {
      text: [
        head,
        '',
        'PASS  the proposal satisfies the wire Proposal schema.',
        '',
        'A PASS is about the SHAPE. The rest is decided when you propose, so read each as an instruction:',
        '  * `payload.params` is checked against the input schema registered for this action by the',
        '    Policy Engine, against your signed policy. Name the parameters as that schema does.',
        '  * `schema_hash` must name a schema triple registered in your signed policy; a well-formed',
        '    hash for a schema nobody registered is refused there.',
        '  * `tenant_id` must be your key\'s tenant (whoami names it). The gateway refuses any other',
        '    (TenantMismatch) and never rewrites it.',
        '  * The decision is the policy\'s: a valid proposal can still be held or denied.',
      ].join('\n'),
      isError: false,
    };
  }
  return {
    text: [
      head,
      '',
      `FAIL  ${findings.length} finding(s). Each names the field it is about:`,
      '',
      ...findings.map((finding) => `  ${finding}`),
      '',
      'Fix the fields above and lint again. Every property at both levels is required and both',
      'objects are closed, deliberately: an optional field would give one action two encodings and',
      'therefore two proposal hashes. `params` and `cidrs` are EMPTY objects when an action has',
      'none, never absent.',
    ].join('\n'),
    isError: false,
  };
}
