/**
 * What each tool refuses to run without, and how it says so (ACP-197, section
 * 6b points 3 and 5).
 *
 * These assertions are the counterpart of `services/approval/src/config.test.ts`
 * with the failure moved: that service refuses to START, this one starts and
 * refuses PER CALL, because a stdio server that exits during the handshake
 * takes the missing variable's name with it. What must stay true either way is
 * that nothing is defaulted — every test below checks a refusal, and there is
 * deliberately no test asserting a fallback value, because there is none.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { anchorConfig, apiConfig, ConfigError, VARS, type Env } from './config.js';

const COMPLETE: Env = {
  [VARS.API_URL]: 'https://api.example.test',
  [VARS.API_KEY]: 'zfr_' + 'a'.repeat(43),
  [VARS.TRUST_ANCHOR]: '/anchors/tenant.json',
  [VARS.SUITE_FLOOR]: 'hybrid-ed25519-mldsa65',
};

function without(variable: string): Env {
  const env: Record<string, string | undefined> = { ...COMPLETE };
  delete env[variable];
  return env;
}

test('a complete environment resolves, and every value comes from it', () => {
  const api = apiConfig(COMPLETE);
  assert.equal(api.baseUrl, 'https://api.example.test');
  assert.equal(api.apiKey, COMPLETE[VARS.API_KEY]);

  const anchor = anchorConfig(COMPLETE);
  assert.equal(anchor.anchorPath, '/anchors/tenant.json');
  assert.equal(anchor.suiteFloor, 'hybrid-ed25519-mldsa65');
});

test('each variable is required, and the refusal names the one to set', () => {
  const cases: ReadonlyArray<readonly [string, string, (env: Env) => unknown]> = [
    [VARS.API_URL, 'ApiUrlUnconfigured', apiConfig],
    [VARS.API_KEY, 'ApiKeyUnconfigured', apiConfig],
    [VARS.TRUST_ANCHOR, 'TrustAnchorUnconfigured', (env) => anchorConfig(env)],
    [VARS.SUITE_FLOOR, 'SuiteFloorUnconfigured', (env) => anchorConfig(env)],
  ];
  for (const [variable, refusal, resolve] of cases) {
    assert.throws(
      () => resolve(without(variable)),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError, `${variable} did not raise a ConfigError`);
        assert.equal(error.name, refusal);
        assert.equal(error.variable, variable);
        // The message must carry the variable, because the agent reading it
        // sees the message and not the fields beside it.
        assert.match(error.message, new RegExp(`Set ${variable}\\.`));
        return true;
      },
      `${variable} was not required`,
    );
  }
});

test('a variable set to whitespace is as unset as one that is absent', () => {
  // The failure this closes is an operator writing `ZIFFER_API_KEY=` in an env
  // file. Treating "" as configured would send an empty bearer header and turn
  // a local configuration mistake into a 401 from a remote host.
  for (const blank of ['', '   ', '\t\n']) {
    assert.throws(
      () => apiConfig({ ...COMPLETE, [VARS.API_KEY]: blank }),
      (error: unknown) => error instanceof ConfigError && error.name === 'ApiKeyUnconfigured',
    );
  }
});

test('values are trimmed, so a trailing newline from a shell is not a different key', () => {
  const api = apiConfig({
    ...COMPLETE,
    [VARS.API_KEY]: `${COMPLETE[VARS.API_KEY] ?? ''}\n`,
    [VARS.API_URL]: ' https://api.example.test ',
  });
  assert.equal(api.apiKey, COMPLETE[VARS.API_KEY]);
  assert.equal(api.baseUrl, 'https://api.example.test');
});

test('a malformed URL is named apart from an absent one', () => {
  // Two different developer actions: "you set nothing" and "what you set is not
  // a URL". One refusal covering both sends the reader to check a variable that
  // is in fact present.
  for (const bad of ['api.example.test', '/v1/proposals', 'ziffer']) {
    assert.throws(
      () => apiConfig({ ...COMPLETE, [VARS.API_URL]: bad }),
      (error: unknown) => error instanceof ConfigError && error.name === 'ApiUrlMalformed',
      `${bad} was accepted as a URL`,
    );
  }
});

test('plaintext to a remote host is refused; loopback is allowed', () => {
  // The key is a bearer credential, so http:// to a remote host hands it to
  // anyone on the path. Loopback is exempt or the only way to try this package
  // would be against production.
  assert.throws(
    () => apiConfig({ ...COMPLETE, [VARS.API_URL]: 'http://api.example.test' }),
    (error: unknown) => error instanceof ConfigError && error.name === 'ApiUrlInsecure',
  );
  for (const local of ['http://localhost:8080', 'http://127.0.0.1:8080']) {
    assert.equal(apiConfig({ ...COMPLETE, [VARS.API_URL]: local }).baseUrl, local);
  }
});

test('the base URL keeps no trailing slash, so a join cannot build //v1', () => {
  for (const raw of ['https://api.example.test/', 'https://api.example.test///']) {
    assert.equal(apiConfig({ ...COMPLETE, [VARS.API_URL]: raw }).baseUrl, 'https://api.example.test');
  }
});

test('an anchor path argument overrides the variable, but never replaces the floor', () => {
  // The override exists so a developer can check a receipt against a second
  // identity without restarting their agent. It covers the anchor only: a
  // per-call suite floor would be a caller choosing the minimum signature
  // strength their check is run at, which is the value the variable exists to
  // pin.
  const overridden = anchorConfig(COMPLETE, '/tmp/other-anchor.json');
  assert.equal(overridden.anchorPath, '/tmp/other-anchor.json');
  assert.equal(overridden.suiteFloor, COMPLETE[VARS.SUITE_FLOOR]);

  assert.equal(anchorConfig(without(VARS.TRUST_ANCHOR), '/tmp/x.json').anchorPath, '/tmp/x.json');
  assert.throws(
    () => anchorConfig(without(VARS.SUITE_FLOOR), '/tmp/x.json'),
    (error: unknown) => error instanceof ConfigError && error.name === 'SuiteFloorUnconfigured',
  );
});

test('an empty override falls back to the variable rather than to an empty path', () => {
  for (const blank of ['', '  ']) {
    assert.equal(anchorConfig(COMPLETE, blank).anchorPath, '/anchors/tenant.json');
  }
});

test('no refusal message quotes the value that was rejected', () => {
  // A configuration error is returned over the MCP transport into an agent's
  // context. ZIFFER_API_KEY is a live bearer credential, and this is the last
  // place it should be echoed -- the same rule as ApprovalConfig's redacting
  // printer one service over.
  const secret = 'zfr_SECRET_KEY_THAT_MUST_NOT_BE_ECHOED_abcdefgh';
  try {
    apiConfig({ ...COMPLETE, [VARS.API_URL]: 'not-a-url', [VARS.API_KEY]: secret });
    assert.fail('expected a refusal');
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    assert.doesNotMatch(error.message, /SECRET_KEY/);
  }
});
