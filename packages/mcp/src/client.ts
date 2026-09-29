/**
 * The one file that knows the concrete `@ziffer-io/client` (ACP-197, section 6b
 * point 1).
 *
 * `tools.ts` calls a {@link DecisionClient}, an interface. This module is where
 * that interface is satisfied by the real thing, and it is deliberately the
 * only import site: if §6's spelling of a field ever differs from §1's wire
 * spelling, the mapping belongs here and nowhere else. Two files translating
 * between the same two vocabularies is how they come to disagree.
 *
 * # What is deliberately NOT here
 *
 * An HTTP client. This package will not carry one even when `@ziffer-io/client` is
 * unavailable: a second implementation of §1 is a second place that knows the
 * auth header, the paths, the status codes and the receipt-passthrough rule,
 * and the second one is always the one that drifts. `docs/onboarding/sdk.md`
 * tells developers there is one client; this package would be the
 * counterexample.
 *
 * There is also no retry, no backoff and no caching. `wait` is the client's own
 * polling loop and it is the one place that decides how often to ask; a second
 * loop here would be two answers to "how hard do we poll", and the tool would
 * be holding a decision the developer's own code has not seen.
 */

import { ZifferClient } from '@ziffer-io/client';

import { apiConfig, type Env } from './config.js';
import type { ClientFactory, ZifferSurface } from './tools.js';

/**
 * Build a client from the environment, or refuse.
 *
 * Configuration is resolved first and the refusal it raises reaches the agent
 * as the tool's result, so an unset key is reported before any socket is
 * opened. {@link ZifferClient} satisfies {@link ZifferSurface} structurally —
 * §6 fixed that surface and `tools.ts` names the three calls used — so there
 * is no adapter here and no cast: had the two disagreed, this is the one file
 * where the mapping would live.
 */
export const zifferClientFactory: ClientFactory = async (env: Env): Promise<ZifferSurface> => {
  const config = apiConfig(env);
  return new ZifferClient(config.baseUrl, config.apiKey);
};
