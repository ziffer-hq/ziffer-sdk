/**
 * What the trust anchor reader accepts, and every way it refuses.
 *
 * The positive case is built from the field names the engine's own
 * `ziffer pubkey` writes (`crates/acp-bundle-cli/src/main.rs::cmd_pubkey`,
 * engine pin fed43d1, unchanged since 356ef8e). If that document's shape ever changes, these tests are
 * where it should be noticed — a reader bound to a format by prose alone is the
 * normative-text-with-no-executable-consumer shape the engine has published
 * three corrections for.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { AnchorError, loadTrustAnchor } from './anchor.js';

const ED = 'ab'.repeat(32);
const PQ = 'cd'.repeat(1952);
const FLOOR = 'hybrid-ed25519-mldsa65';

/** The document `ziffer pubkey --key <file>` emits, in its field order. */
function pubkeyDocument(): Record<string, unknown> {
  return {
    ed25519_pk_hex: ED,
    fingerprint: 'sha256:' + '00'.repeat(32),
    identity: { classical: 'AAAA', pq: 'BBBB' },
    mldsa65_pk_hex: PQ,
  };
}

const dir = mkdtempSync(join(tmpdir(), 'ziffer-verify-anchor-'));

function writeAnchor(name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  return path;
}

async function refusalOf(path: string): Promise<AnchorError> {
  try {
    await loadTrustAnchor(path, FLOOR);
  } catch (error) {
    assert.ok(error instanceof AnchorError, `expected an AnchorError, got ${String(error)}`);
    return error;
  }
  throw new Error(`${path} was accepted`);
}

test('a ziffer pubkey document loads into a trust anchor', async () => {
  const anchor = await loadTrustAnchor(writeAnchor('good.json', pubkeyDocument()), FLOOR);
  assert.equal(anchor.classical.length, 32);
  assert.equal(anchor.pq.length, 1952);
  assert.equal(anchor.classical[0], 0xab);
  assert.equal(anchor.pq[0], 0xcd);
  // The floor comes from configuration and is passed through untouched: this
  // module owns no table of suite names, because verifyReceipt owns the one.
  assert.equal(anchor.minSuite, FLOOR);
});

test('the base64 and fingerprint encodings are not read, so they cannot disagree', async () => {
  // identity.classical and fingerprint are other spellings of the same keys.
  // Reading a key twice from one file is two answers to "which identity is
  // this", and the one nobody exercises is the wrong one. Corrupting them must
  // therefore change nothing.
  const doc = pubkeyDocument();
  doc['identity'] = { classical: 'not base64 at all', pq: '!!!!' };
  doc['fingerprint'] = 'sha256:deadbeef';
  const anchor = await loadTrustAnchor(writeAnchor('other-encodings.json', doc), FLOOR);
  assert.equal(anchor.classical[0], 0xab);
});

test('a signing key is refused as a signing key, not as a malformed anchor', async () => {
  // The plausible mistake: two similarly named JSON files, and ZIFFER_TRUST_ANCHOR
  // points at the secret one. Without this the refusal would be "missing
  // ed25519_pk_hex" -- true, and it would send the developer to add a field to
  // a file holding a live private key.
  for (const secret of ['ed25519_sk_hex', 'mldsa65_sk_hex']) {
    const refusal = await refusalOf(writeAnchor(`${secret}.json`, { [secret]: 'ef'.repeat(32) }));
    assert.equal(refusal.name, 'TrustAnchorHoldsSecret');
    assert.match(refusal.message, /SIGNING KEY/);
    assert.match(refusal.message, /ziffer pubkey/);
  }
});

test('a secret field is refused even beside valid public halves', async () => {
  // Order matters: the secret check runs before the public fields are read, so
  // a key file that also carries its public halves -- which is what a
  // ziffer key document looks like -- is still refused rather than quietly
  // succeeding and leaving a private key on a path the operator thinks is safe
  // to hand around.
  const doc = { ...pubkeyDocument(), ed25519_sk_hex: 'ef'.repeat(32) };
  assert.equal((await refusalOf(writeAnchor('both.json', doc))).name, 'TrustAnchorHoldsSecret');
});

test('no refusal echoes the file contents', async () => {
  // A malformed anchor is quoted into an agent's context, and if the file was a
  // secret key, echoing the bytes that made it malformed is how the key gets
  // there.
  const marker = 'SECRETMATERIALdeadbeef';
  const refusal = await refusalOf(writeAnchor('secret-body.json', { ed25519_sk_hex: marker }));
  assert.doesNotMatch(refusal.message, new RegExp(marker));
});

test('a missing file, a non-JSON file and a non-object are each named', async () => {
  assert.equal((await refusalOf(join(dir, 'absent.json'))).name, 'TrustAnchorUnreadable');
  assert.equal((await refusalOf(writeAnchor('text.json', 'not json'))).name, 'TrustAnchorNotJson');
  assert.equal((await refusalOf(writeAnchor('array.json', [1, 2]))).name, 'TrustAnchorNotJson');
});

test('a key of the wrong length is refused rather than truncated or padded', async () => {
  // A 31-byte Ed25519 key is not a weak key, it is a different object. Accepting
  // it would make verifyReceipt refuse every signature under a clause that
  // blames the receipt for a defect in the anchor.
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ['short-ed', { ...pubkeyDocument(), ed25519_pk_hex: 'ab'.repeat(31) }],
    ['long-ed', { ...pubkeyDocument(), ed25519_pk_hex: 'ab'.repeat(33) }],
    ['short-pq', { ...pubkeyDocument(), mldsa65_pk_hex: 'cd'.repeat(1951) }],
  ];
  for (const [name, doc] of cases) {
    const refusal = await refusalOf(writeAnchor(`${name}.json`, doc));
    assert.equal(refusal.name, 'TrustAnchorMalformed');
    assert.match(refusal.message, /expected exactly/);
  }
});

test('an absent, non-string or non-hex key field is refused by name', async () => {
  const absent = pubkeyDocument();
  delete absent['ed25519_pk_hex'];
  assert.match((await refusalOf(writeAnchor('absent-ed.json', absent))).message, /is absent/);

  const numeric = { ...pubkeyDocument(), ed25519_pk_hex: 42 };
  assert.match((await refusalOf(writeAnchor('numeric.json', numeric))).message, /not a string/);

  // Uppercase is refused although it decodes: two spellings of one anchor that
  // compare unequal mean an operator diffing a rotated key cannot tell which
  // changed. cmd_pubkey writes lowercase.
  const upper = { ...pubkeyDocument(), ed25519_pk_hex: 'AB'.repeat(32) };
  assert.match((await refusalOf(writeAnchor('upper.json', upper))).message, /lowercase/);

  const nonHex = { ...pubkeyDocument(), ed25519_pk_hex: 'zz'.repeat(32) };
  assert.match((await refusalOf(writeAnchor('nonhex.json', nonHex))).message, /hexadecimal/);
});

test('every refusal names the path, which is what identifies the file', async () => {
  const path = writeAnchor('named.json', 'not json');
  assert.match((await refusalOf(path)).message, new RegExp(path.replace(/[/\\]/g, '\\$&')));
  assert.equal((await refusalOf(path)).path, path);
});
