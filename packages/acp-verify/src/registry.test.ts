/**
 * The attester registry reader: what it accepts, every name it refuses under,
 * and the ORDER, which is the engine loader's (reference `_check_registry`,
 * `acp-bundle` `check_registry`): a registry wrong in two ways is named by the
 * first check in that order.
 *
 * Built from the software keys the quorum tests use, so an accepted registry
 * is one `verifyReceipt` can count a real approval against (`quorum.test.ts`
 * proves the counting; the scan package's gate module test (`code/gate.test.ts`) proves the
 * two together end to end).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { AnchorError } from './anchor.js';
import { loadAttesterRegistry, parseAttesterRegistry } from './registry.js';
import { hybridKeyFromSeed, webauthnCredentialFromSeed } from './testkeys.js';

const CFO = hybridKeyFromSeed('att-cfo');
const ONCALL = hybridKeyFromSeed('att-oncall');
const ALICE = webauthnCredentialFromSeed('alice', 'webauthn-es256', 'approve.example.com');
const BOB = webauthnCredentialFromSeed('bob', 'webauthn-ed25519', 'approve.example.com');

const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

/** An Ed25519 point of small order: the identity, y = 1. */
const SMALL_ORDER = b64(Uint8Array.from([1, ...new Uint8Array(31)]));

type Doc = Record<string, unknown>;

function machine(k: { classical: Uint8Array; pq: Uint8Array }, role?: string): Doc {
  return { kind: 'hybrid', classical: b64(k.classical), pq: b64(k.pq), ...(role === undefined ? {} : { role }) };
}

function person(c: { alg: string; rpId: string; credentialId: string; coseKey: Uint8Array }): Doc {
  return { kind: 'webauthn', role: 'approver', rp_id: c.rpId, credential_id: c.credentialId, public_key: b64(c.coseKey), alg: c.alg };
}

function registry(over: Doc = {}): Doc {
  return {
    quorum_k: 2,
    attesters: { cfo: machine(CFO, 'approver'), finance_oncall: machine(ONCALL), alice: person(ALICE), bob: person(BOB) },
    assurance: { cfo: 'AS1', alice: 'AS2', bob: 'AS1' },
    min_attester_assurance: 'AS1',
    ...over,
  };
}

const bytes = (doc: unknown): Uint8Array => new TextEncoder().encode(typeof doc === 'string' ? doc : JSON.stringify(doc));

function refusal(doc: unknown): AnchorError {
  try {
    parseAttesterRegistry(bytes(doc), 'policy/attesters/registry.json');
  } catch (error) {
    assert.ok(error instanceof AnchorError, `expected an AnchorError, got ${String(error)}`);
    return error;
  }
  throw new Error('the registry was accepted');
}

test('a registry of machines and people reads into the approver half of a quorum policy', () => {
  const r = parseAttesterRegistry(bytes(registry()), 'r.json');
  assert.equal(r.quorumK, 2);
  assert.equal(r.minAssurance, 'AS1');
  assert.deepEqual([...r.attesters.keys()].sort(), ['alice', 'bob', 'cfo', 'finance_oncall']);
  const cfo = r.attesters.get('cfo');
  assert.ok(cfo !== undefined && cfo.kind === 'hybrid');
  assert.deepEqual(cfo.classical, CFO.classical);
  assert.deepEqual(cfo.pq, CFO.pq);
  assert.equal(cfo.role, 'approver');
  const oncall = r.attesters.get('finance_oncall');
  // A machine with no role reads as null: it satisfies an empty required_roles and nothing else.
  assert.ok(oncall !== undefined && oncall.kind === 'hybrid' && oncall.role === null);
  const alice = r.attesters.get('alice');
  assert.ok(alice !== undefined && alice.kind === 'webauthn');
  assert.equal(alice.rpId, 'approve.example.com');
  assert.equal(alice.credentialId, ALICE.credentialId);
  assert.deepEqual(alice.publicKey, ALICE.coseKey);
  assert.equal(r.assurances.get('alice'), 'AS2');
  // An identity with no recorded level is absent from the map, which the quorum reads as AS0.
  assert.equal(r.assurances.get('finance_oncall'), undefined);
});

test('an absent assurance floor is the document default AS0; a non-string one is refused', () => {
  const doc = registry();
  delete doc['min_attester_assurance'];
  assert.equal(parseAttesterRegistry(bytes(doc), 'r.json').minAssurance, 'AS0');
  assert.equal(refusal(registry({ min_attester_assurance: 1 })).name, 'Malformed');
});

test('not JSON, and not an object, are Malformed', () => {
  assert.equal(refusal('not json').name, 'Malformed');
  assert.equal(refusal([1, 2]).name, 'Malformed');
});

test('quorum_k absent, zero, negative, fractional, a string or a boolean is QuorumInvalid, never defaulted', () => {
  const absent = registry();
  delete absent['quorum_k'];
  for (const doc of [absent, registry({ quorum_k: 0 }), registry({ quorum_k: -1 }), registry({ quorum_k: 1.5 }), registry({ quorum_k: '2' }), registry({ quorum_k: true })]) {
    assert.equal(refusal(doc).name, 'QuorumInvalid', JSON.stringify(doc['quorum_k']));
  }
});

test('quorum_k is checked BEFORE the attesters map, the engine order', () => {
  assert.equal(refusal({ quorum_k: 0 }).name, 'QuorumInvalid');
  assert.equal(refusal({ quorum_k: 1 }).name, 'Malformed');
  assert.equal(refusal({ quorum_k: 1, attesters: [] }).name, 'Malformed');
});

test('an entry with no kind, or an unknown kind, is Malformed and not guessed from its fields', () => {
  const noKind = machine(CFO);
  delete noKind['kind'];
  assert.equal(refusal(registry({ attesters: { cfo: noKind } })).name, 'Malformed');
  assert.equal(refusal(registry({ attesters: { cfo: { ...machine(CFO), kind: 'hsm' } } })).name, 'Malformed');
  assert.equal(refusal(registry({ attesters: { cfo: 'not an object' } })).name, 'Malformed');
});

test('a person missing any HM-1 field, or naming an unknown alg, is Malformed', () => {
  for (const f of ['role', 'rp_id', 'credential_id', 'public_key', 'alg']) {
    const p = person(ALICE);
    delete p[f];
    assert.equal(refusal(registry({ attesters: { alice: p } })).name, 'Malformed', f);
    assert.equal(refusal(registry({ attesters: { alice: { ...person(ALICE), [f]: '' } } })).name, 'Malformed', `${f} empty`);
  }
  assert.equal(refusal(registry({ attesters: { alice: { ...person(ALICE), alg: 'webauthn-rs256' } } })).name, 'Malformed');
});

test('one key holder under two names is RegistryKeysNotDistinct, whichever leg they share', () => {
  const twice = { cfo: machine(CFO, 'approver'), bob: machine(CFO, 'confirmer') };
  assert.equal(refusal(registry({ attesters: twice })).name, 'RegistryKeysNotDistinct');
  const sharedPq = { cfo: machine(CFO), other: { ...machine(ONCALL), pq: b64(CFO.pq) } };
  assert.equal(refusal(registry({ attesters: sharedPq })).name, 'RegistryKeysNotDistinct');
  const sharedCredential = { alice: person(ALICE), alias: { ...person(ALICE), credential_id: 'other' } };
  assert.equal(refusal(registry({ attesters: sharedCredential, assurance: { alice: 'AS2', alias: 'AS2' } })).name, 'RegistryKeysNotDistinct');
});

test('a machine missing a leg is Malformed', () => {
  const noPq = machine(CFO);
  delete noPq['pq'];
  assert.equal(refusal(registry({ attesters: { cfo: noPq } })).name, 'Malformed');
});

test('a small-order classical key is RegistryKeyWeak', () => {
  assert.equal(refusal(registry({ attesters: { cfo: { ...machine(CFO), classical: SMALL_ORDER } } })).name, 'RegistryKeyWeak');
});

test('a shared weak key is a collision first, the engine order', () => {
  const weak = { ...machine(CFO), classical: SMALL_ORDER };
  const two = { a: weak, b: { ...machine(ONCALL), classical: SMALL_ORDER } };
  assert.equal(refusal(registry({ attesters: two })).name, 'RegistryKeysNotDistinct');
});

test('a person whose credential the COSE parser refuses is refused under the parser\'s own name', () => {
  // A COSE key for the other alg: the shape does not match.
  const wrongShape = { ...person(ALICE), alg: 'webauthn-ed25519' };
  assert.equal(refusal(registry({ attesters: { alice: wrongShape }, assurance: { alice: 'AS2' } })).name, 'Malformed');
  const notB64 = { ...person(ALICE), public_key: '!!!!' };
  assert.equal(refusal(registry({ attesters: { alice: notB64 }, assurance: { alice: 'AS2' } })).name, 'Malformed');
});

test('a person recorded at AS0, or at no level, is HumanAssuranceAbsent, checked last', () => {
  assert.equal(refusal(registry({ assurance: { cfo: 'AS1', alice: 'AS0', bob: 'AS1' } })).name, 'HumanAssuranceAbsent');
  assert.equal(refusal(registry({ assurance: { cfo: 'AS1', bob: 'AS1' } })).name, 'HumanAssuranceAbsent');
  // A weak key and a missing level on one registry: the weak key is named.
  const both = registry({ attesters: { cfo: { ...machine(CFO), classical: SMALL_ORDER }, alice: person(ALICE) }, assurance: {} });
  assert.equal(refusal(both).name, 'RegistryKeyWeak');
});

test('a machine leg that is not a key is refused at load as Malformed (narrower than the engine, disclosed)', () => {
  assert.equal(refusal(registry({ attesters: { cfo: { ...machine(CFO), classical: 'not base64' } } })).name, 'Malformed');
  assert.equal(refusal(registry({ attesters: { cfo: { ...machine(CFO), pq: b64(new Uint8Array(10)) } } })).name, 'Malformed');
});

test('an empty attesters map is read, as the engine reads it, and names no approver', () => {
  const r = parseAttesterRegistry(bytes({ quorum_k: 1, attesters: {} }), 'r.json');
  assert.equal(r.attesters.size, 0);
});

test('the file reader names the path, refuses an absent file by name, and never quotes content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ziffer-verify-registry-'));
  const good = join(dir, 'registry.json');
  writeFileSync(good, JSON.stringify(registry(), null, 2));
  assert.equal((await loadAttesterRegistry(good)).quorumK, 2);

  const absent = join(dir, 'absent.json');
  await assert.rejects(loadAttesterRegistry(absent), (e: unknown) => e instanceof AnchorError && e.name === 'RegistryUnreadable' && e.path === absent);

  const marker = 'SECRETMARKERdeadbeef';
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, `{"quorum_k": "${marker}"}`);
  await assert.rejects(loadAttesterRegistry(bad), (e: unknown) => e instanceof AnchorError && e.name === 'QuorumInvalid' && !e.message.includes(marker) && e.message.includes(bad));
});
