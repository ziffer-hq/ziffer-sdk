/**
 * The module `ziffer-scan --code` writes (`ziffer-gate.ts`), driven end to end
 * (ACP-479): generated from a graded catalog, transpiled, loaded, and its gate
 * function called against a stub of the decision API that serves receipts
 * signed with the software test keys the verifier's own suites use.
 *
 * What is asserted is the module's contract, from the outside:
 *
 * - a good receipt lets the call return, after exactly one proposal;
 * - the same receipt with one byte changed throws ZifferRefused naming the
 *   verifier's refusal, so the tool does not run;
 * - no receipt by the deadline throws the client's WaitTimeout;
 * - a held-and-approved receipt verifies WITH the approver registry and is
 *   refused by name (AB-1) WITHOUT it;
 * - a configured file that cannot be read refuses by name, before anything is
 *   proposed.
 *
 * ONE disclosed edit to the module text: `HOLD_LIMIT_MS` (15 minutes) and
 * `POLL_MS` (2 seconds) are shortened, each replacement asserted to match
 * exactly once, because a unit test cannot wait fifteen minutes for a deadline.
 * Nothing the module decides reads either constant except as a duration handed
 * to `waitForReceipt`.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { WaitTimeout } from '@ziffer-io/client';
import { attestationId, canon, CLAUSE_MEMBERSHIP, CLAUSE_SIGNATURE, entryDigest } from '@ziffer-io/verify';
// By its workspace path: testkeys is not in the verify package's tarball or export map.
import { hybridKeyFromSeed, type TestHybridKey } from '../../../acp-verify/dist/testkeys.js';
import ts from 'typescript';

import { oneScan } from '../scan/one.js';
import { isRecord } from '../wasm/json.js';
import { loadEngine } from '../wasm/loader.js';
import { locateWasm } from '../wasm/locate.js';
import type { CodeCatalog } from './types.js';

const PKG = fileURLToPath(new URL('../../', import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), 'ziffer-scan-gate-'));
const LOADED: string[] = [];
after(() => {
  rmSync(WORK, { recursive: true, force: true });
  for (const f of LOADED) rmSync(f, { force: true });
});

const RECEIPT_KEY = hybridKeyFromSeed('k1');
const CFO = hybridKeyFromSeed('att-cfo');
const ONCALL = hybridKeyFromSeed('att-oncall');
const SUITE = 'hybrid-ed25519-mldsa65';
const BUNDLE_HASH = `sha256:${'11'.repeat(32)}`;
const BUNDLE_EPOCH = 7;

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
const instant = (unix: number): string => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function hybridSig(bytes: Uint8Array, key: TestHybridKey): Record<string, string> {
  return { classical: hex(ed25519.sign(bytes, key.edSecret)), pq: hex(ml_dsa65.sign(bytes, key.pqSecret)) };
}

/** The proposal hash the verifier recomputes: sha256 over the canonical proposal. */
function proposalHash(proposalBody: string): string {
  const value: unknown = JSON.parse(proposalBody);
  return `sha256:${createHash('sha256').update(canon(value)).digest('hex')}`;
}

/** A version-3 receipt over the proposal the stub received, signed by the receipt key. */
function receiptFor(proposalBody: string, attesters: readonly (readonly [string, TestHybridKey])[] = []): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const hash = proposalHash(proposalBody);
  const entries = attesters.map(([who, key], i) => {
    const obj = {
      alg: SUITE,
      att_nonce: `b64:${b64(new Uint8Array(16).fill(i + 1))}`,
      bundle_epoch: BUNDLE_EPOCH,
      context_snapshot_hash: 'sha256:ctx',
      expires_at: instant(now + 1800),
      floor_only_risk: 'HIGH',
      operator: 'op-1',
      policy_bundle_hash: BUNDLE_HASH,
      proposal_hash: hash,
      required_count: 2,
      required_roles: ['approver'],
    };
    return { obj, kind: 'approval', attester: who, sig: hybridSig(new TextEncoder().encode(attestationId(obj)), key) };
  });
  const body: Record<string, unknown> = {
    receipt_version: 3,
    alg: SUITE,
    decision: 'ALLOW',
    proposal_hash: hash,
    policy_bundle_hash: BUNDLE_HASH,
    bundle_epoch: BUNDLE_EPOCH,
    tenant_id: 't1',
    operator: 'op-1',
    issued_at: instant(now),
    expires_at: instant(now + 60),
    nonce: 'b64:AAAAAAAAAAAAAAAAAAAAAA==',
    ...(entries.length === 0 ? {} : { attestation_digests: entries.map(entryDigest).sort() }),
  };
  return { ...body, sig: hybridSig(canon(body), RECEIPT_KEY), ...(entries.length === 0 ? {} : { attestations: entries }) };
}

/** What one GET of the decision answers, given the proposal the stub received. */
type Answer = (proposalBody: string) => Record<string, unknown>;

/** A stub of the decision API: whoami, one proposal, then scripted decision reads (the last repeats). */
class Api {
  private server: Server | undefined;
  readonly proposals: string[] = [];
  gets = 0;
  constructor(private readonly answers: Answer[]) {}

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const send = (status: number, value: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(typeof value === 'string' ? value : JSON.stringify(value));
        };
        if (req.method === 'GET' && req.url === '/v1/whoami') {
          send(200, { tenant_id: 't1', key_expires_at: '2099-01-01T00:00:00Z' });
        } else if (req.method === 'POST' && req.url === '/v1/proposals') {
          this.proposals.push(Buffer.concat(chunks).toString('utf8'));
          send(200, { decision_id: 'd1', status: 'pending' });
        } else if (req.method === 'GET' && req.url === '/v1/decisions/d1') {
          const answer = this.answers[Math.min(this.gets, this.answers.length - 1)];
          this.gets += 1;
          const proposal = this.proposals[0];
          if (answer === undefined || proposal === undefined) send(599, { error: 'StubUnscripted' });
          else send(200, answer(proposal));
        } else {
          send(599, { error: 'StubUnscripted' });
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    const addr = server.address();
    assert.ok(addr !== null && typeof addr !== 'string');
    return `http://127.0.0.1:${addr.port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** The fields the grader reads, checked, so the fixture is a `CodeCatalog` by evidence (grade.test.ts's guard). */
function isCodeCatalog(v: unknown): v is CodeCatalog {
  const isRef = (r: unknown): boolean => isRecord(r) && typeof r['file'] === 'string' && typeof r['line'] === 'number' && typeof r['col'] === 'number';
  if (!isRecord(v) || typeof v['root'] !== 'string' || !Array.isArray(v['tools']) || !Array.isArray(v['dispatchers'])) return false;
  if (!Array.isArray(v['exposures']) || !Array.isArray(v['gates']) || !Array.isArray(v['not_seen']) || !isRecord(v['syntax_only'])) return false;
  return v['tools'].every(
    (t: unknown) =>
      isRecord(t) && typeof t['name'] === 'string' && typeof t['description'] === 'string' && Array.isArray(t['params']) && typeof t['sdk'] === 'string' && isRef(t['defined_at']),
  );
}

let moduleJs = '';
let toolName = '';
let toolsPath = '';
let anchorPath = '';
let registryPath = '';

before(async () => {
  const engine = await loadEngine(readFileSync(locateWasm()));
  const catalog: unknown = JSON.parse(readFileSync(join(PKG, 'fixtures', 'code', 'catalog-per-tool.json'), 'utf8'));
  assert.ok(isCodeCatalog(catalog), 'catalog-per-tool.json is not a CodeCatalog');
  const one = await oneScan({ code: catalog }, engine, { now: new Date(), out: '' });
  const section = one.result.code;
  assert.ok(section !== undefined && one.toolsFile !== undefined);
  let source = section.insertion.snippet;
  for (const [from, to] of [
    ['const HOLD_LIMIT_MS = 15 * 60_000;', 'const HOLD_LIMIT_MS = 400;'],
    ['const POLL_MS = 2_000;', 'const POLL_MS = 20;'],
  ] as const) {
    assert.equal(source.split(from).length, 2, `the module states ${from} exactly once`);
    source = source.replace(from, to);
  }
  moduleJs = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const first = section.catalog.tools[0];
  assert.ok(first !== undefined);
  toolName = first.name;

  toolsPath = join(WORK, 'ziffer-tools.json');
  writeFileSync(toolsPath, JSON.stringify(one.toolsFile));
  anchorPath = join(WORK, 'anchor.json');
  writeFileSync(anchorPath, JSON.stringify({ ed25519_pk_hex: hex(RECEIPT_KEY.classical), mldsa65_pk_hex: hex(RECEIPT_KEY.pq) }));
  registryPath = join(WORK, 'registry.json');
  writeFileSync(
    registryPath,
    JSON.stringify({
      quorum_k: 2,
      attesters: {
        cfo: { kind: 'hybrid', role: 'approver', classical: b64(CFO.classical), pq: b64(CFO.pq) },
        finance_oncall: { kind: 'hybrid', role: 'approver', classical: b64(ONCALL.classical), pq: b64(ONCALL.pq) },
      },
      assurance: { cfo: 'AS1', finance_oncall: 'AS1' },
      min_attester_assurance: 'AS1',
    }),
  );
});

/** A fresh instance of the module (it reads its files once per instance), configured by `env`. */
async function gate(url: string, env: Record<string, string | undefined>): Promise<(name: string, input: unknown) => Promise<void>> {
  const settings: Record<string, string | undefined> = {
    ZIFFER_API_URL: url,
    ZIFFER_API_KEY: 'zfr_test',
    ZIFFER_TOOLS_FILE: toolsPath,
    ZIFFER_TRUST_ANCHOR: anchorPath,
    ZIFFER_SUITE_FLOOR: SUITE,
    ZIFFER_ATTESTER_REGISTRY: undefined,
    ...env,
  };
  for (const [k, v] of Object.entries(settings)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const file = join(PKG, 'dist', 'code', `gate-module-${process.pid}-${LOADED.length}.mjs`);
  writeFileSync(file, moduleJs);
  LOADED.push(file);
  const mod: unknown = await import(pathToFileURL(file).href);
  assert.ok(isRecord(mod));
  const fn = mod['zifferGate'];
  assert.ok(typeof fn === 'function');
  return async (name: string, input: unknown): Promise<void> => {
    await Reflect.apply(fn, undefined, [name, input]);
  };
}

/** The error a call threw, checked by name and, for a receipt refusal, by the verifier's clause. */
async function thrown(call: Promise<void>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    assert.ok(error instanceof Error, String(error));
    return error;
  }
  assert.fail('the gate returned: the tool would have run');
}

async function withApi(answers: Answer[], body: (url: string, api: Api) => Promise<void>): Promise<void> {
  const api = new Api(answers);
  const url = await api.start();
  try {
    await body(url, api);
  } finally {
    await api.stop();
  }
}

const decided = (outcome: string, extra: Record<string, unknown> = {}): Answer => () => ({ decision_id: 'd1', status: 'decided', outcome, ...extra });

test('a good receipt lets the call return, after exactly one proposal', async () => {
  await withApi([decided('ALLOW'), (p) => ({ decision_id: 'd1', status: 'decided', outcome: 'ALLOW', receipt: receiptFor(p) })], async (url, api) => {
    const call = await gate(url, {});
    await call(toolName, { order_id: 'o-1', amount: 12 });
    assert.equal(api.proposals.length, 1);
    // The first read had no receipt yet; the call waited for it rather than returning.
    assert.equal(api.gets, 2);
  });
});

test('the same receipt with one byte changed throws ZifferRefused naming the refusal', async () => {
  const tampered: Answer = (p) => {
    const text = JSON.stringify(receiptFor(p));
    const at = text.indexOf('"tenant_id":"t1"') + '"tenant_id":"'.length;
    assert.ok(at > 20);
    const changed: unknown = JSON.parse(`${text.slice(0, at)}u${text.slice(at + 1)}`);
    return { decision_id: 'd1', status: 'decided', outcome: 'ALLOW', receipt: changed };
  };
  await withApi([tampered], async (url) => {
    const call = await gate(url, {});
    const error = await thrown(call(toolName, { order_id: 'o-1' }));
    assert.equal(error.name, 'ZifferRefused');
    assert.ok(isRecord(error));
    // The NAME a developer reads, and the clause kept beside it for code that reads the rule.
    assert.equal(error['receiptRefusal'], 'SignatureInvalid');
    assert.equal(error['receiptClause'], CLAUSE_SIGNATURE);
    assert.match(
      error.message,
      new RegExp(`did not verify\\. SignatureInvalid: .* \\(${CLAUSE_SIGNATURE.replace('.', '\\.')}\\)$`),
    );
  });
});

test('no receipt by the deadline throws the client\'s WaitTimeout', async () => {
  await withApi([decided('ATTEST', { held_until: '2099-01-01T00:00:00Z' })], async (url, api) => {
    const call = await gate(url, {});
    const error = await thrown(call(toolName, {}));
    assert.ok(error instanceof WaitTimeout, `${error.name}: ${error.message}`);
    assert.equal(api.proposals.length, 1, 'a held action is waited on, never proposed again');
  });
});

test('a held-and-approved receipt verifies WITH the approver registry', async () => {
  const approved: Answer = (p) => ({ decision_id: 'd1', status: 'decided', outcome: 'ATTEST', receipt: receiptFor(p, [['cfo', CFO], ['finance_oncall', ONCALL]]) });
  await withApi([decided('ATTEST'), approved], async (url) => {
    const call = await gate(url, { ZIFFER_ATTESTER_REGISTRY: registryPath });
    await call(toolName, { order_id: 'o-2' });
  });
});

test('the same approved receipt WITHOUT the registry is refused by name (AB-1), never passed', async () => {
  const approved: Answer = (p) => ({ decision_id: 'd1', status: 'decided', outcome: 'ATTEST', receipt: receiptFor(p, [['cfo', CFO], ['finance_oncall', ONCALL]]) });
  await withApi([approved], async (url) => {
    const call = await gate(url, {});
    const error = await thrown(call(toolName, { order_id: 'o-2' }));
    assert.equal(error.name, 'ZifferRefused');
    assert.ok(isRecord(error));
    assert.equal(error['receiptRefusal'], 'ApprovalsUnverifiable');
    assert.equal(error['receiptClause'], CLAUSE_MEMBERSHIP);
  });
});

test('a registry file that cannot be read refuses by name, before anything is proposed', async () => {
  await withApi([decided('ALLOW')], async (url, api) => {
    const call = await gate(url, { ZIFFER_ATTESTER_REGISTRY: join(WORK, 'absent-registry.json') });
    const error = await thrown(call(toolName, {}));
    assert.equal(error.name, 'ZifferNotConfigured');
    assert.match(error.message, /RegistryUnreadable/);
    assert.equal(api.proposals.length, 0);
  });
});

test('a DENY throws ZifferRefused with no receipt refusal, and the tool does not run', async () => {
  await withApi([decided('DENY', { refusal_category: 'PolicyRefused' })], async (url) => {
    const call = await gate(url, {});
    const error = await thrown(call(toolName, {}));
    assert.equal(error.name, 'ZifferRefused');
    assert.match(error.message, /DENY \(PolicyRefused\)/);
  });
});
