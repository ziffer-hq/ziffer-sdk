/**
 * What the developer hands `npx @ziffer-io/mcp`, and what happens when they have
 * not handed it anything yet (ACP-197, section 6b point 3).
 *
 * This is the only place in this package that reads the environment, for the
 * reason `services/approval/src/config.ts` states one service over: a second
 * `process.env` somewhere in a tool handler would be a second statement of what
 * this server requires, and the one that goes stale is the documented one.
 *
 * # This server starts unconfigured, and that inverts the house rule
 *
 * Every other process in this repository refuses to start without its complete
 * environment. `docs/onboarding/executor.md` section 4 states the reason and it
 * is a good one: a process that came up and cannot serve is worse than one that
 * refused to come up, because a supervisor keeps the first alive.
 *
 * An MCP server over stdio has no supervisor and no operator watching a log. It
 * is spawned by a coding agent, it speaks JSON-RPC on stdout, and when it exits
 * during the initialization handshake the agent is told only that the server
 * failed to start. The variable that was missing died with the process, on a
 * stderr nobody is reading. So the failure would surface to the developer as
 * "the Ziffer MCP server does not work" -- undebuggable from the only side that
 * can fix it.
 *
 * So the process starts, and configuration is resolved PER CALL: each tool that
 * needs a value asks for it, and a missing one is a named {@link ConfigError}
 * returned to the agent as the tool's result, naming the exact variable to set.
 * The agent can then tell its developer, or read
 * {@link https://../../docs/onboarding/sdk.md} through `get_integration_guide`,
 * which is the one tool that deliberately needs no configuration at all.
 *
 * **This is not a relaxation of failing closed.** Nothing proceeds on a missing
 * value: an unconfigured `propose` sends no request and an unconfigured
 * `explain_receipt` verifies nothing. The refusal moved from process exit to
 * tool result; it did not become a default. A default `ZIFFER_API_URL` would
 * point a developer's proposals at a host nobody chose, and a default trust
 * anchor would verify receipts under a key nobody enrolled.
 */

/**
 * The variables, named once. Every error below quotes one of these, so a rename
 * cannot leave a message pointing at a variable that no longer exists
 * (`services/approval/src/config.ts`'s `VARS`, and `services/kms`'s `pub mod
 * var` one language over).
 */
export const VARS = {
  API_URL: 'ZIFFER_API_URL',
  API_KEY: 'ZIFFER_API_KEY',
  TRUST_ANCHOR: 'ZIFFER_TRUST_ANCHOR',
  SUITE_FLOOR: 'ZIFFER_SUITE_FLOOR',
} as const;

/**
 * A configuration value that is missing or is not what it claims to be.
 *
 * `name` is the refusal's machine-readable half, spelled in the PascalCase the
 * ACP-197 section 1 refusals use (`ApiKeyUnknown`, `TenantMismatch`), so an
 * agent can branch on it. `variable` is what the developer has to set, and it
 * is a separate field rather than something to parse back out of the message.
 *
 * `detail` describes the SHAPE of what was wrong and never carries the value.
 * `ZIFFER_API_KEY` is a bearer credential and this text is returned over the
 * MCP transport into an agent's context, which is the last place a live key
 * should be echoed -- the same reason `ApprovalConfig`'s printer redacts its
 * private key one service over.
 */
export class ConfigError extends Error {
  /** The refusal name an agent branches on. */
  override readonly name: string;
  /** The environment variable the developer has to set. */
  readonly variable: string;

  constructor(name: string, variable: string, detail: string) {
    super(`${name}: ${detail} Set ${variable}.`);
    this.name = name;
    this.variable = variable;
  }
}

/** Where this server sends proposals, and the key that says who is sending. */
export interface ApiConfig {
  /** `ZIFFER_API_URL` — the gateway's base URL, no trailing slash. */
  readonly baseUrl: string;
  /** `ZIFFER_API_KEY` — the bearer key. It also determines the tenant: ACP-197
   * section 1 makes the KEY the tenant, so this server never sends a tenant
   * name of its own and could not override one if it wanted to. */
  readonly apiKey: string;
}

/** Where this server reads the verifier's own trust anchor from. */
export interface AnchorConfig {
  /** `ZIFFER_TRUST_ANCHOR` — path to a `ziffer pubkey` document. */
  readonly anchorPath: string;
  /** `ZIFFER_SUITE_FLOOR` — the CR-4 floor, by wire suite name. */
  readonly suiteFloor: string;
}

/** The environment, as a plain map, so tests never mutate `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, variable: string, refusal: string, detail: string): string {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(refusal, variable, detail);
  }
  return raw.trim();
}

/**
 * Resolve the gateway leg, or refuse by name.
 *
 * @throws ConfigError `ApiUrlUnconfigured` or `ApiKeyUnconfigured`.
 */
export function apiConfig(env: Env): ApiConfig {
  const raw = required(
    env,
    VARS.API_URL,
    'ApiUrlUnconfigured',
    'this server does not know which Ziffer gateway to call.',
  );
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Named separately from the unset case because they are different developer
    // actions: one is "you have set nothing", the other is "what you set is not
    // a URL". A single refusal covering both sends the reader to check a
    // variable that is, in fact, present.
    throw new ConfigError(
      'ApiUrlMalformed',
      VARS.API_URL,
      'the value is not an absolute URL (expected something like https://api.ziffer.io).',
    );
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    // The API key is a bearer credential, so plaintext to a remote host hands
    // it to anyone on the path. Localhost is exempt because the stub server the
    // tests run, and the local gateway a developer runs while integrating, are
    // both http:// on the loopback -- refusing those would mean the only way to
    // try this package is against production.
    throw new ConfigError(
      'ApiUrlInsecure',
      VARS.API_URL,
      `the value is ${parsed.protocol}// to a remote host, which would send the bearer key in plaintext; use https:// (http:// is allowed only for localhost).`,
    );
  }
  const apiKey = required(
    env,
    VARS.API_KEY,
    'ApiKeyUnconfigured',
    'this server has no Ziffer API key, so it cannot say which tenant is proposing.',
  );
  // No trailing slash, once, here: a base URL that sometimes ends in one turns
  // every join site into a place where `//v1/proposals` can be built, and the
  // gateway would answer that with a 404 that names nothing.
  return { baseUrl: raw.replace(/\/+$/, ''), apiKey };
}

/**
 * Resolve the verification leg, or refuse by name.
 *
 * `anchorPathOverride` is `explain_receipt`'s optional argument. It wins over
 * the variable because a developer verifying a receipt against a SECOND
 * identity -- a staging tenant, or a key they are about to rotate to -- should
 * not have to restart their coding agent to do it. When neither is present the
 * refusal names the variable, because that is the durable way to set it.
 *
 * @throws ConfigError `TrustAnchorUnconfigured` or `SuiteFloorUnconfigured`.
 */
export function anchorConfig(env: Env, anchorPathOverride?: string): AnchorConfig {
  const override = anchorPathOverride?.trim();
  const anchorPath =
    override !== undefined && override !== ''
      ? override
      : required(
          env,
          VARS.TRUST_ANCHOR,
          'TrustAnchorUnconfigured',
          'this server has no trust anchor, so it has no identity to verify receipts under.',
        );
  const suiteFloor = required(
    env,
    VARS.SUITE_FLOOR,
    'SuiteFloorUnconfigured',
    'this server has no CR-4 suite floor, and there is no default one: a floor chosen here would be a minimum signature strength nobody agreed to.',
  );
  return { anchorPath, suiteFloor };
}
