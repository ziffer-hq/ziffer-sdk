/**
 * Undo evidence and secret names (ACP-455, 2026-09-28). Each rule has a test
 * that finds it and a decoy where it must not fire, and the asymmetry is
 * asserted directly: evidence that a tool cannot be undone, or that it names a
 * secret, may make the draft stricter; evidence that it can be undone, or only
 * reads, never changes the draft. Every name here is invented.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { UndoHint } from '../code/types.js';
import type { CatalogTool, Classification } from '../types.js';
import { tool } from './fixtures/tool.js';
import { classify, undoHints } from './index.js';

const t = (name: string, description: string, params: string[] = []): CatalogTool => tool('app', `app/${name}`, name, description, params);

function draft(x: CatalogTool): Classification {
  const [c] = classify([x]).classifications;
  assert.ok(c !== undefined);
  return c;
}

function hints(x: CatalogTool, ...others: CatalogTool[]): UndoHint[] {
  const [h] = undoHints([x, ...others]);
  assert.ok(h !== undefined);
  return h;
}

const says = (h: readonly UndoHint[]): string[] => h.map((x) => `${x.says}:${x.source}:${x.evidence}`);

// ------------------------------------------------------------- description

test('a description that says it cannot be undone drafts the tool irreversible, quoting the phrase as written', () => {
  const x = t('flag_guest_absent', 'Flag a guest as absent to the partner site. This notifies the partner and cannot be undone.', ['stay_code']);
  const c = draft(x);
  assert.equal(c.effect, 'irreversible');
  assert.match(c.reason ?? '', /description says "cannot be undone"/);
  assert.deepEqual(says(hints(x)), ['cannot_be_undone:description:cannot be undone']);
});

test('each cannot-be-undone phrase is found, as written, whatever its case', () => {
  for (const [text, evidence] of [
    ["Once done it can't be undone.", "can't be undone"],
    ['Wipes the cache. IRREVERSIBLE.', 'IRREVERSIBLE'],
    ['Stores a permanent marker.', 'permanent'],
    ['Permanently hides the entry.', 'Permanently'],
    ['The change is not reversible.', 'not reversible'],
  ] as const) {
    assert.deepEqual(says(hints(t('tag_entry', text))), [`cannot_be_undone:description:${evidence}`], text);
  }
});

test('"cannot be undone" is not also read as "can be undone", and a negated phrase is no evidence', () => {
  // Decoys: the word-level match keeps "cannot" from containing "can", and a negator just before a phrase voids it.
  assert.deepEqual(says(hints(t('tag_entry', 'This cannot be undone.'))), ['cannot_be_undone:description:cannot be undone']);
  assert.deepEqual(hints(t('tag_entry', 'Tagging is never irreversible.')), []);
  assert.deepEqual(hints(t('get_entry', 'Returns the entry. This call is not read-only: it stamps a view.')), []);
  assert.deepEqual(hints(t('get_entry', "Returns the entry; it isn't read-only.")), []);
  // "permanent" is a whole word: "impermanent" and "permanently" are not it (the second is its own phrase).
  assert.deepEqual(hints(t('tag_entry', 'Adds an impermanent tag.')), []);
});

test('a description that says a tool CAN be undone never changes the draft; the hint is recorded', () => {
  const plain = t('tag_entry', 'Tag an entry as resolved.', ['entry_id']);
  const said = t('tag_entry', 'Tag an entry as resolved. Reversible via untagEntry. Can be reverted any time.', ['entry_id']);
  assert.deepEqual(draft(said), draft(plain));
  assert.deepEqual(says(hints(said)), ['can_be_undone:description:Reversible via', 'can_be_undone:description:Can be reverted']);
  const nul = t('set_label', 'Set the label. Pass null to clear it; undo with set_label again.', ['label']);
  assert.deepEqual(says(hints(nul)), ['can_be_undone:description:Pass null to clear', 'can_be_undone:description:undo with']);
});

test('"idempotent" is no evidence of undo', () => {
  assert.deepEqual(hints(t('tag_entry', 'Tag an entry. Idempotent if already tagged.')), []);
});

test('a description that says read-only is a hint and never relaxes a write, or an irreversible tool', () => {
  const w = t('update_entry', 'Update the entry. Read-only for guests; does not modify billing. No side effects elsewhere.', ['entry_id']);
  assert.equal(draft(w).effect, 'write');
  assert.deepEqual(says(hints(w)), [
    'reads_only:description:Read-only',
    'reads_only:description:does not modify',
    'reads_only:description:No side effects',
  ]);
  const d = t('delete_entry', 'Delete the entry. read only callers are refused.', ['entry_id']);
  assert.equal(draft(d).effect, 'irreversible');
  assert.deepEqual(says(hints(d)), ['reads_only:description:read only']);
});

// ------------------------------------------------------------ inverse tools

test('an inverse tool in the same catalog is a can-be-undone hint on the first tool only', () => {
  const mark = t('markTicketResolved', 'Mark a ticket resolved.');
  const reopen = t('reopenTicket', 'Reopen a ticket.');
  assert.deepEqual(says(hints(mark, reopen)), ['can_be_undone:inverse_tool:reopenTicket']);
  assert.deepEqual(hints(reopen, mark), [], 'reopen is the inverse, not the first');

  const create = t('create_poster', 'Create a poster.');
  const del = t('delete_poster', 'Delete a poster.');
  assert.deepEqual(says(hints(create, del)), ['can_be_undone:inverse_tool:delete_poster']);
  assert.deepEqual(hints(del, create), [], 'deleting is not undone by creating');
});

test('a noun variation in data pairs an upload with a delete of the same thing, and a namespace is skipped', () => {
  assert.deepEqual(says(hints(t('uploadShopPhoto', 'Upload a photo.'), t('deleteShopMedia', 'Delete media.'))), ['can_be_undone:inverse_tool:deleteShopMedia']);
  assert.deepEqual(
    says(hints(t('crm_add_to_blocklist', 'Add an address.'), t('crm_remove_from_blocklist', 'Remove an address.'))),
    ['can_be_undone:inverse_tool:crm_remove_from_blocklist'],
  );
});

test('an inverse verb over a DIFFERENT object is no pair, and neither is a verb pair not in data', () => {
  assert.deepEqual(hints(t('create_poster', 'Create.'), t('delete_invoice', 'Delete.')), []);
  assert.deepEqual(hints(t('uploadShopPhoto', 'Upload.'), t('deleteShopPoster', 'Delete.')), []);
  assert.deepEqual(hints(t('start_job', 'Start.'), t('stop_job', 'Stop.')), []);
  assert.deepEqual(hints(t('acme_create_poster', 'Create.'), t('other_delete_poster', 'Delete.')), [], 'different namespaces');
});

test('an inverse-tool hint never changes the draft', () => {
  const create = t('create_poster', 'Create a poster.', ['title']);
  const [alone] = classify([create]).classifications;
  const [paired] = classify([create, t('delete_poster', 'Delete a poster.')]).classifications;
  assert.deepEqual(paired, alone);
});

// Second review (2026-09-28): "no send" is reads_only as the whole phrase; "Returns ..." is not added (too general).
test('"no send" is a reads_only hint as the whole phrase, never "no sender", and never changes the draft', () => {
  const x = t('draft_guest_reply', 'Draft a reply to the guest (no send).');
  assert.deepEqual(says(hints(x)), ['reads_only:description:no send']);
  assert.equal(draft(x).effect, draft(t('draft_guest_reply', 'Draft a reply to the guest.')).effect, 'a reads_only hint relaxed the draft');
  for (const decoy of ['Lists the messages that have no sender.', 'Queue a reply; no sending happens until approved.', 'Returns the booking details.']) {
    assert.deepEqual(hints(t('list_threads', decoy)), [], decoy);
  }
});

// ---------------------------------------------------------------- secrets

test('a tool that writes a secret named in its name is drafted irreversible (HIGH), with the word quoted', () => {
  const c = draft(t('updateStayAccessInfo', 'Update the stay details.', ['notes']));
  assert.equal(c.effect, 'irreversible');
  assert.match(c.reason ?? '', /name says "access info"/);
});

test('a tool that writes a secret named by a parameter is drafted irreversible', () => {
  const c = draft(t('update_unit', 'Update the unit.', ['label', 'doorCode']));
  assert.equal(c.effect, 'irreversible');
  assert.match(c.reason ?? '', /parameter "doorCode" says "door code"/);
});

// Corrected 2026-09-28 (second review): the first rule raised a read of a secret to a write, and
// the engine then counted two tools that change nothing among the tools that cannot be undone.
// A read stays a read, drafted as before the rule existed; the word is recorded in `matched`.
test('a tool that only reads a secret stays a read, with no secret reason, and the word recorded', () => {
  for (const [x, word] of [
    [t('getGuestPaymentLink', 'Get the link.'), 'payment link'],
    [t('get_unit', 'Get the unit.', ['pin']), 'pin'],
    [t('list_api_keys', 'List keys.'), 'api key'],
  ] as const) {
    const c = draft(x);
    assert.equal(c.effect, 'read', x.tool);
    assert.equal(c.reason, undefined, x.tool);
    assert.ok(c.matched.includes(`sensitive_values:${word}`), `${x.tool}: ${c.matched.join(', ')}`);
  }
});

test('secret words match whole words in the name and parameters only: never pinned, shipping, a page token, or the description', () => {
  for (const x of [
    t('list_pinned_items', 'List pinned items.'),
    t('get_shipping_rate', 'Get the shipping rate.'),
    t('list_items', 'List items.', ['page_token', 'max_tokens']),
    t('get_summary', 'Get a summary. Tokenizes the text and counts each token; never shows a password.', ['text']),
  ]) {
    const c = draft(x);
    assert.equal(c.effect, 'read', x.tool);
    assert.equal(c.matched.some((m) => m.startsWith('sensitive_values:')), false, x.tool);
  }
});
