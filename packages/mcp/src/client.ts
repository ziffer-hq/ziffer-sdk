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

import { ApiRefusal, DeadlineExceeded, ResponseMalformed, ZifferClient } from '@ziffer-io/client';

import { apiConfig, DEFAULT_API_URL, VARS, type Env } from './config.js';
import type { ClientFactory, ZifferSurface } from './tools.js';

/**
 * Build a client from the environment, or refuse.
 *
 * Configuration is resolved first and the refusal it raises reaches the agent
 * as the tool's result, so an unset key is reported before any socket is
 * opened. {@link ZifferClient} satisfies {@link ZifferSurface} structurally —
 * §6 fixed that surface and `tools.ts` names the calls used.
 *
 * Each call is passed through {@link classifyReach}: a failure to reach the
 * service leaves here as `ServiceUnreachable`, naming the address that was
 * called, rather than as the `fetch failed` the transport threw. That is a
 * rename of the error and never a retry, and a named refusal from the service
 * passes through as it came.
 */
export const zifferClientFactory: ClientFactory = async (env: Env): Promise<ZifferSurface> => {
  const config = apiConfig(env);
  // Assigned, not cast: the structural match is what `tsc` checks here.
  const client: ZifferSurface = new ZifferClient(config.baseUrl, config.apiKey);
  const reach = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw classifyReach(config.baseUrl, error);
    }
  };
  return {
    propose: (proposal) => reach(() => client.propose(proposal)),
    decision: (id) => reach(() => client.decision(id)),
    list: (options) => reach(() => client.list(options)),
    whoami: () => reach(() => client.whoami()),
    feedback: (message) => reach(() => client.feedback(message)),
  };
};

/*
 * What a tool says when the ZIFFER service did not answer, or answered with
 * something that is not a ZIFFER answer.
 *
 * `@ziffer-io/client` reports a transport failure as whatever `fetch` threw: a
 * `TypeError` whose message is `fetch failed` and whose cause carries the
 * system's code, a `TimeoutError`, or, after its retries, a `DeadlineExceeded`
 * with no HTTP status. Each is correct for a program and useless to a developer
 * reading their AI assistant's answer: none of them says which address was
 * called, and "fetch failed" does not say what to check. This section turns them
 * into one refusal, {@link ServiceUnreachable}, carrying the address and the
 * reason in words, and the three things to check.
 *
 * It classifies and never retries. The client's retry policy has already run by
 * the time an error reaches here, and a second loop in this package would be a
 * second answer to "how hard do we try".
 *
 * A named refusal from the service (`ApiRefusal`) is NOT renamed here: the
 * service answered, and its answer is the contract. It passes through unchanged.
 */

/** The service at `url` did not answer, or answered with something that is not
 * the ZIFFER API. `name` is `ServiceUnreachable` or `ServiceAnswerUnreadable`,
 * the two developer actions: find the service, or find the right address. */
export class ServiceUnreachable extends Error {
  override readonly name: 'ServiceUnreachable' | 'ServiceAnswerUnreadable';
  /** The base URL that was called. Never the key: this text reaches a model. */
  readonly url: string;
  /** What happened, in words. */
  readonly reason: string;

  constructor(name: 'ServiceUnreachable' | 'ServiceAnswerUnreadable', url: string, reason: string) {
    super(
      name === 'ServiceUnreachable'
        ? `ZIFFER did not answer at ${url} (${reason}). No decision was made and nothing was verified.`
        : `the address ${url} answered, but not with a ZIFFER answer (${reason}). Nothing was decided.`,
    );
    this.name = name;
    this.url = url;
    this.reason = reason;
  }

  /** The three things to check, as lines a developer can act on. */
  checks(): string[] {
    const lines = [
      `What to check:`,
      `  1. ${VARS.API_URL} is the address ZIFFER gave you. Unset, it is ${DEFAULT_API_URL}.`,
      `  2. This machine reaches that address: curl -sS ${this.url}/v1/whoami answers`,
      `     {"error":"ApiKeyUnknown"} with no key. That answer means the service is there.`,
      `  3. No proxy or firewall between this machine and that address blocks HTTPS.`,
    ];
    if (this.name === 'ServiceAnswerUnreadable') {
      lines.push('  The address answered, so 2 and 3 hold; the address itself is the one to check.');
    }
    return lines;
  }
}

/** A system error code, from `fetch`'s `cause`, in words. */
const CODES: Readonly<Record<string, string>> = {
  ECONNREFUSED: 'the connection was refused: nothing listens at that address',
  ENOTFOUND: 'the host name does not resolve',
  EAI_AGAIN: 'the host name could not be resolved right now',
  ETIMEDOUT: 'the connection timed out',
  ECONNRESET: 'the connection was closed before an answer',
  EHOSTUNREACH: 'the host cannot be reached from this machine',
  ENETUNREACH: 'the network cannot be reached from this machine',
  CERT_HAS_EXPIRED: 'its TLS certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'its TLS certificate is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'its TLS certificate chain is self-signed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'its TLS certificate could not be verified',
  ERR_TLS_CERT_ALTNAME_INVALID: 'its TLS certificate is for a different name',
};

function codeOf(error: Error): string | undefined {
  const cause: unknown = error.cause;
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') {
    return cause.code;
  }
  return undefined;
}

/**
 * The refusal a thrown value becomes, or the value itself when it is not about
 * reaching the service.
 *
 * `baseUrl` is the address that was called. Nothing here reads the key.
 */
export function classifyReach(baseUrl: string, error: unknown): unknown {
  if (error instanceof ApiRefusal) return error;
  if (error instanceof ResponseMalformed) {
    return new ServiceUnreachable('ServiceAnswerUnreadable', baseUrl, error.message);
  }
  if (error instanceof DeadlineExceeded && error.status === 0) {
    return new ServiceUnreachable('ServiceUnreachable', baseUrl, 'no answer before the retries ran out');
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return new ServiceUnreachable('ServiceUnreachable', baseUrl, 'no answer in time');
    }
    if (error instanceof TypeError && error.message === 'fetch failed') {
      const code = codeOf(error);
      const words = code === undefined ? undefined : CODES[code];
      return new ServiceUnreachable(
        'ServiceUnreachable',
        baseUrl,
        words ?? (code === undefined ? 'the connection failed' : `the connection failed with ${code}`),
      );
    }
  }
  return error;
}
