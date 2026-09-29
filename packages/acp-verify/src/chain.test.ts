/**
 * The audit chain export verifier against the SHARED corpus (ACP-428).
 *
 * `fixtures/chain-export/expected.json` is the verdict for each file, derived
 * by construction from the audit service's own export (see the generator's
 * header), and the Python SDK's tests assert the same file against the same
 * verdicts. This suite passing while that one passes is the claim that the two
 * readers give one verdict per file; either going red is the two disagreeing.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { AnchorKeyRefusal, ChainRefusal, chainVerdict, parseAnchorKey, verifyChain } from './chain.js';
import { isRecord } from './wire.js';

function corpus(name: string): Buffer {
  return readFileSync(new URL(`../fixtures/chain-export/${name}`, import.meta.url));
}

function corpusText(name: string): string {
  return corpus(name).toString('utf8');
}

interface Case {
  readonly name: string;
  readonly file: string;
  readonly withAnchorKey: boolean;
  readonly verdict: unknown;
}

function cases(): { anchorKey: string; cases: Case[] } {
  const doc: unknown = JSON.parse(corpusText('expected.json'));
  assert.ok(isRecord(doc) && typeof doc['anchor_key'] === 'string' && Array.isArray(doc['cases']));
  const out: Case[] = [];
  for (const c of doc['cases']) {
    assert.ok(isRecord(c));
    const { name, file, with_anchor_key: withAnchorKey, verdict } = c;
    assert.ok(typeof name === 'string' && typeof file === 'string' && typeof withAnchorKey === 'boolean');
    out.push({ name, file, withAnchorKey, verdict });
  }
  return { anchorKey: doc['anchor_key'], cases: out };
}

test('every corpus file gets the verdict expected.json names -- the Python reader is held to the same file', () => {
  const { anchorKey, cases: all } = cases();
  const key = parseAnchorKey(corpus(anchorKey));
  // A corpus that shrank to nothing would pass this loop having compared
  // nothing; the count is the generator's, and a case added there without a
  // verdict here is the drift this line catches.
  assert.equal(all.length, 16);
  for (const c of all) {
    const got = chainVerdict(corpus(c.file), c.withAnchorKey ? key : undefined);
    assert.deepEqual(got, c.verdict, c.name);
  }
});

test('the one-byte flip is refused naming the record, from text as from bytes', () => {
  for (const input of [corpus('export-one-byte.json'), corpusText('export-one-byte.json')]) {
    assert.throws(
      () => verifyChain(input),
      (e: unknown) => e instanceof ChainRefusal && e.refusal === 'ChainHashMismatch' && e.seq === 2,
    );
  }
});

test('the anchor identity written inside the export is never read', () => {
  // Replace every `anchor_identity` in the genuine export with the forger's and
  // the verdict under the customer's key does not move; delete it and nothing
  // moves either. A reader that consulted the field would change its answer.
  const key = parseAnchorKey(corpus('anchor-identity.pub'));
  const genuine: unknown = JSON.parse(corpusText('export.json'));
  const forged: unknown = JSON.parse(corpusText('export-forged-anchor.json'));
  assert.ok(isRecord(genuine) && Array.isArray(genuine['anchors']));
  assert.ok(isRecord(forged) && Array.isArray(forged['anchors']));
  const theirs = forged['anchors'][0];
  assert.ok(isRecord(theirs));
  const before = chainVerdict(corpusText('export.json'), key);
  for (const entry of genuine['anchors']) {
    assert.ok(isRecord(entry));
    entry['anchor_identity'] = theirs['anchor_identity'];
  }
  assert.deepEqual(chainVerdict(JSON.stringify(genuine), key), before);
  for (const entry of genuine['anchors']) {
    assert.ok(isRecord(entry));
    delete entry['anchor_identity'];
  }
  assert.deepEqual(chainVerdict(JSON.stringify(genuine), key), before);
});

test('a key file that is the receipt trust anchor, or edited after it was written, is refused by name', () => {
  const doc: unknown = JSON.parse(corpusText('anchor-identity.pub'));
  assert.ok(isRecord(doc));
  const receiptShaped = JSON.stringify({ ed25519_pk_hex: '00'.repeat(32), mldsa65_pk_hex: '00' });
  assert.throws(
    () => parseAnchorKey(receiptShaped),
    (e: unknown) => e instanceof AnchorKeyRefusal && e.refusal === 'AnchorKeyMalformed',
  );
  const edited = { ...doc, fingerprint: `sha256:${'0'.repeat(64)}` };
  assert.throws(
    () => parseAnchorKey(JSON.stringify(edited)),
    (e: unknown) => e instanceof AnchorKeyRefusal && e.refusal === 'AnchorKeyMalformed',
  );
  const otherSuite = { ...doc, alg: 'ed25519' };
  assert.throws(
    () => parseAnchorKey(JSON.stringify(otherSuite)),
    (e: unknown) => e instanceof AnchorKeyRefusal && e.refusal === 'AnchorKeyUnsupported',
  );
});

test('a file that is not an export is refused as malformed, never as a chain verdict', () => {
  for (const input of ['not json', '[]', '{"tenant": "t", "chain": {}, "anchors": []}', '{"a": NaN}']) {
    assert.throws(
      () => verifyChain(input),
      (e: unknown) => e instanceof ChainRefusal && e.refusal === 'ExportMalformed',
      input,
    );
  }
});

test('the anchor key file a customer is handed reports the anchors checked', () => {
  // ACP-430. `fixtures/anchor-handover/anchor-identity.pub` is the file the
  // composer writes into every customer tree as `developer/anchor-identity.pub`,
  // for the identity that signed this corpus -- not typed and not derived here:
  // `e2e/src/bin/compose-config.rs` composes a tree and requires these exact
  // bytes. Until that file existed no customer held a key to pass, and every
  // anchor they checked read `unchecked`.
  const handed = readFileSync(new URL('../fixtures/anchor-handover/anchor-identity.pub', import.meta.url));
  const { cases: all } = cases();
  const keyed = all.find((c) => c.file === 'export.json' && c.withAnchorKey);
  assert.ok(keyed !== undefined);
  const result = verifyChain(corpus('export.json'), parseAnchorKey(handed));
  assert.equal(result.anchorsChecked, true);
  assert.deepEqual(
    result.anchors.map((a) => a.status),
    ['verified'],
  );
  assert.deepEqual(chainVerdict(corpus('export.json'), parseAnchorKey(handed)), keyed.verdict);
});
