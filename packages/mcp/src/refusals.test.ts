/**
 * That `explain_refusal` serves the real table, that the set of refusal names
 * this product can EMIT is derived from the code that emits them, and that
 * the gap between the two is pinned rather than papered over.
 *
 * Three readings and none of them trusts another:
 *
 *   * the table, re-parsed here out of `docs/onboarding/support.md` on disk
 *     and compared against what the module serves. Importing the parser under
 *     test to compute the expected value would let a broken parser agree with
 *     itself (`guide.test.ts`'s rule);
 *   * the EMITTERS, re-read here out of the Rust with a second, independent
 *     reader, and compared against what the build step embedded. The
 *     completeness claim rests on that set being the real one, so a set this
 *     file also derived from the generated module would be a claim about
 *     nothing;
 *   * the two compared against each other, with every surviving difference
 *     PINNED by name and the observed difference asserted EQUAL to the pin
 *     (ACP-299's rule). A name added to an emitter with no row goes red
 *     naming it; a name that GAINS a row goes red too, because removing the
 *     pin is what proves the fix.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMITTERS,
  UNTABLED,
  emittedNames,
  explainRefusal,
  refusalTable,
  rowFor,
} from './refusals.js';
import { REFUSAL_TABLE_MARKER, SUPPORT_DOC_PATH } from './generated/docs-source.js';
import { FAILURE_KEYS } from './publish-explain.js';

/** dist/refusals.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The marked table, read off disk by a SECOND reader. */
function tableFromDisk(): ReadonlyArray<readonly string[]> {
  const text = readFileSync(join(repoRoot, SUPPORT_DOC_PATH), 'utf8');
  const at = text.indexOf(REFUSAL_TABLE_MARKER);
  assert.notEqual(at, -1, `${SUPPORT_DOC_PATH} carries no ${REFUSAL_TABLE_MARKER}`);
  const rows: string[][] = [];
  for (const line of text.slice(at).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((cell) => /^[-: ]*$/.test(cell))) continue;
    if (!/^`[^`]+`$/.test(cells[0] ?? '')) continue; // the header
    rows.push(cells);
  }
  return rows;
}

/** Every `pub const X: &str = "value";` inside `pub mod <name> { ... }`, read
 * off disk by a SECOND reader — deliberately written differently from the
 * embed script's, so the two agreeing means the Rust says it and not that one
 * parser was copied. */
function constsInModule(rustPath: string, moduleName: string): readonly string[] {
  const text = readFileSync(join(repoRoot, rustPath), 'utf8');
  const open = text.indexOf(`pub mod ${moduleName} {\n`);
  assert.notEqual(open, -1, `${rustPath} has no \`pub mod ${moduleName}\``);
  const close = text.indexOf('\n}\n', open);
  assert.notEqual(close, -1, `\`pub mod ${moduleName}\` in ${rustPath} is never closed`);
  const body = text.slice(open, close);
  return [...body.matchAll(/pub const [A-Z0-9_]+: &str = "([^"]+)";/g)].map((m) => m[1] ?? '');
}

test('the table the tool serves is the table on disk, row for row', () => {
  const served = refusalTable();
  const onDisk = tableFromDisk();
  assert.ok(onDisk.length > 0, 'the support document published no rows at all');
  assert.equal(
    served.length,
    onDisk.length,
    `the tool serves ${served.length} rows and ${SUPPORT_DOC_PATH} has ${onDisk.length}`,
  );
  for (const [index, row] of onDisk.entries()) {
    const mine = served[index];
    assert.ok(mine !== undefined, `row ${index} was not parsed`);
    assert.equal(`\`${mine.name}\``, row[0]);
    assert.equal(mine.meaning, row[1]);
    assert.equal(mine.whatToDo, row[2]);
    assert.equal(mine.whoFixes, row[3]);
    assert.equal(mine.documentedIn, row[4]);
    assert.equal(mine.rule === undefined ? '—' : `[${mine.rule}](${mine.ruleUrl ?? ''})`, row[5]);
  }
});

test('every row is complete and its "who fixes it" is inside the closed domain', () => {
  // The same S4/S5 assertions `tools/check-support-doc.py` makes, restated at
  // the one place a customer's agent reads a row: a row whose action cell is
  // empty satisfies every set comparison below and helps nobody.
  for (const row of refusalTable()) {
    assert.ok(row.meaning.length > 0, `${row.name} has no meaning`);
    assert.ok(row.whatToDo.length > 0, `${row.name} says nothing to do`);
    assert.ok(
      ['you', 'us', 'you and us'].includes(row.whoFixes),
      `${row.name} says "${row.whoFixes}" fixes it, which is outside the table's domain`,
    );
  }
});

test('the embedded emitter set is what the Rust actually says', () => {
  // The second reading. Everything downstream rests on this set being real. The package names
  // each emitter by what a customer knows it as (`origin`), never by the file of ours it is read
  // from, so this test holds the one mapping from that name to the file.
  const expected: Record<string, readonly string[]> = {
    'the ZIFFER API': constsInModule('services/gateway/src/gateway.rs', 'error_name'),
    'the Policy Engine': constsInModule('services/policy/src/engine.rs', 'clause'),
    'the Policy Engine, on an approval': [
      ...readFileSync(join(repoRoot, 'services/policy/src/attest.rs'), 'utf8').matchAll(
        /^\s*clause: "([^"]+)",$/gm,
      ),
    ].map((m) => m[1] ?? ''),
    'the decision API': constsInModule('services/policy/src/category.rs', 'name'),
  };
  assert.deepEqual(
    EMITTERS.map((emitter) => emitter.origin).sort(),
    Object.keys(expected).sort(),
    'the sources the build embedded are not the sources this test reads',
  );
  for (const emitter of EMITTERS) {
    const mine = [...new Set(expected[emitter.origin] ?? [])].sort();
    assert.ok(mine.length > 0, `${emitter.origin} yielded no name to this reader`);
    assert.deepEqual(
      [...emitter.names],
      mine,
      `the names embedded from ${emitter.origin} are not the ones it carries. Either the embedded ` +
        'copy is stale (run `pnpm --filter @ziffer-io/mcp build`) or a refusal was added or ' +
        'removed and this is the change asking to be looked at.',
    );
  }
});

test('the pinned gap between what we emit and what the table documents is EXACT', () => {
  // THE ASSERTION THE TICKET ASKS FOR, in the only form that can fail both
  // ways. `UNTABLED` is not an allow-list to grow: a name that appears here
  // and is not pinned means a refusal a customer can be handed with nothing
  // saying what to do about it, and a pinned name that STOPS appearing means
  // somebody wrote the row and the pin is now a claim nobody is checking.
  const tabled = new Set(refusalTable().map((row) => row.name));
  const observed = emittedNames().filter((name) => !tabled.has(name));
  assert.deepEqual(
    observed,
    [...UNTABLED].sort(),
    'the refusal names this deployment emits and the support table does not document are not ' +
      'the pinned set. A name in the first list and not the second is a refusal with no row; a ' +
      'name in the second and not the first has gained one, and removing its pin is what proves ' +
      'the fix.',
  );
  // And the pin is a finding, not a resting place. It was EVERY name we emit;
  // ACP-393 wrote the rows and it is empty, so the claim restated in the form
  // that can fail is: nothing we emit is undocumented. The `deepEqual` above
  // already fails on a name with no row -- this fails on the same thing with
  // the count, so deleting UNTABLED entirely could not make the file pass by
  // comparing two empty arrays.
  assert.equal(
    observed.length,
    0,
    `${observed.length} of the ${emittedNames().length} names we emit have no row in ` +
      'support.md section 4. Write the row; do not pin the name unless a person has decided ' +
      'the row is somebody else\'s to write, and then update UNTABLED and this sentence together.',
  );
});

test('a tabled name is answered with its own row, verbatim', () => {
  const row = refusalTable()[0];
  assert.ok(row !== undefined, 'the table is empty');
  const out = explainRefusal(row.name);
  assert.equal(out.isError, false);
  assert.ok(out.text.startsWith(`${row.name} — ${row.documentedIn}`), out.text.split('\n')[0]);
  for (const cell of [row.meaning, row.whoFixes, row.whatToDo]) {
    assert.ok(out.text.includes(cell), `the answer for ${row.name} dropped one of its cells`);
  }
  assert.match(out.text, /A refusal is deterministic/);
  assert.equal(rowFor(row.name)?.meaning, row.meaning);
});

test('every name in the table is answerable, and the lookup is exact', () => {
  for (const row of refusalTable()) {
    assert.equal(explainRefusal(row.name).isError, false, `${row.name} is in the table and unanswerable`);
  }
  // Exact and case sensitive: a clause id differing by case is a different
  // string and matching it would be this tool guessing.
  const name = refusalTable()[0]?.name ?? '';
  assert.equal(explainRefusal(name.toLowerCase() + 'x').isError, true);
});

test('every name we emit is answered with its own row, and none with RefusalUndocumented', () => {
  // WHAT THIS CASE USED TO BE, and why it is written the other way round now.
  // It drove `UNTABLED[0]` through the tool and required `RefusalUndocumented`
  // back. ACP-393 emptied UNTABLED, so that input no longer exists and the
  // case would have gone vacuous -- a test that cannot fail, published as
  // evidence. The property worth asserting after the fix is the one the rows
  // bought: every name a customer can be handed is answered by its own row.
  const emitted = emittedNames();
  assert.ok(emitted.length > 0, 'no emitter yielded a name; this case is vacuous');
  for (const name of emitted) {
    const out = explainRefusal(name);
    assert.equal(out.isError, false, `${name} is emitted and unanswerable`);
    const row = rowFor(name);
    assert.ok(row !== undefined, `${name} is emitted and has no row`);
    assert.ok(out.text.startsWith(`${name} — ${row.documentedIn}`), out.text.split('\n')[0]);
    assert.ok(out.text.includes(row.whatToDo), `the answer for ${name} dropped its action`);
    assert.doesNotMatch(out.text, /RefusalUndocumented/, `${name} was answered as undocumented`);
  }
  // The `RefusalUndocumented` branch is now unreachable THROUGH THIS BUILD,
  // and it is kept rather than deleted: the next refusal added to an emitter
  // before its row must land there and not on `RefusalUnknown`, which would
  // tell a developer the name they were handed does not exist. What guards
  // that state is the completeness assertion above, which goes red naming the
  // name -- not a unit test, because nothing here can synthesise an emitter.
  assert.deepEqual([...UNTABLED], [], 'a pinned name would make the loop above incomplete');
});

test('a clause a customer really sees is answered with an action, not a description', () => {
  // `8.4-3` is the rule-lookup clause -- the one in a refused decision a
  // developer is most likely to paste, and the reason the 35 rows were worth
  // writing. It answered `RefusalUndocumented` until ACP-393.
  const out = explainRefusal('8.4-3');
  assert.equal(out.isError, false);
  assert.match(out.text, /^8\.4-3 — the Policy Engine/);
  assert.doesNotMatch(out.text, /RefusalUndocumented/);
  const row = rowFor('8.4-3');
  assert.ok(row !== undefined, '8.4-3 lost its row');
  assert.equal(row.whoFixes, 'you', 'the rule that refused it is the customer\'s own');
  assert.ok(out.text.includes(row.whatToDo), 'the answer dropped what to do now');
});

test('a receipt refusal is answered by its name, and by its rule number', () => {
  const byName = explainRefusal('ReceiptNotBoundToProposal');
  assert.equal(byName.isError, false);
  assert.match(byName.text, /^ReceiptNotBoundToProposal — sdk\.md section 5\n/);
  assert.match(byName.text, /\(rule 9\.3-3: https:\/\/github\.com\/ziffer-hq\/ziffer-spec\/blob\/main\/spec\/ZIFFER-SPEC-001\.md#93-executor-verification-normative-checklist\)/);
  // The rule number still works as input, and says which name it is.
  const byRule = explainRefusal('9.3-3');
  assert.equal(byRule.isError, false);
  assert.match(byRule.text, /^9\.3-3 — the rule the receipt verifier raises as ReceiptNotBoundToProposal\n/);
  // One rule, three names: all three are answered.
  const temporal = explainRefusal('9.3-5');
  assert.match(temporal.text, /ReceiptTimeUnreadable, ReceiptExpired, ReceiptIssuedInFuture/);
  // A rule with a row of its own (the Policy Engine raises AB-1 too) keeps that
  // row first and names the verifier's refusal after it.
  const shared = explainRefusal('AB-1');
  assert.match(shared.text, /^AB-1 — the Policy Engine\n/);
  assert.match(shared.text, /The receipt verifier raises the same rule as ApprovalsUnverifiable:/);
});

test('a publish-pipeline failure is sent to the tool that explains it', () => {
  // `AuthorIsReviewer` is a publish workflow failure, not a decision API
  // refusal. Answering "unknown" would be true and useless.
  assert.ok(FAILURE_KEYS.includes('AuthorIsReviewer'), 'the fixture name left FAILURE_KEYS');
  const out = explainRefusal('AuthorIsReviewer');
  assert.equal(out.isError, false);
  assert.match(out.text, /^RefusalNotHere: AuthorIsReviewer /);
  assert.match(out.text, /explain_publish_failure/);
});

test('an unknown name is refused by name, with no nearest match offered', () => {
  const out = explainRefusal('TenantMismatched');
  assert.equal(out.isError, true);
  assert.match(out.text, /^RefusalUnknown: /);
  assert.doesNotMatch(out.text, /answered by/);
  assert.match(out.text, /No nearest match is offered on purpose/);
  assert.match(out.text, /search_docs/);
});

test('a name one character away from a REAL row gets that row s answer from nowhere', () => {
  // THE CASE THE ONE ABOVE DOES NOT COVER, and the reason it is written out:
  // `TenantMismatched` is near a name we EMIT and has no row to be handed by
  // mistake, so a "helpful" nearest-match added to the lookup would leave that
  // assertion green. These inputs are near-misses of names that DO have rows,
  // which is where a fuzzy match would hand a developer the meaning and the
  // "what to do now" of a refusal that never fired.
  const tabled = refusalTable();
  const near = tabled
    .map((row) => `${row.name}0`)
    .filter((candidate) => !tabled.some((row) => row.name === candidate))
    .slice(0, 5);
  assert.ok(near.length > 0, 'no near-miss could be constructed; this case is vacuous');
  for (const candidate of near) {
    const answer = explainRefusal(candidate);
    assert.equal(answer.isError, true, `${candidate} was answered`);
    assert.match(answer.text, /^RefusalUnknown: /, `${candidate} got someone else's row`);
    for (const row of tabled) {
      assert.ok(
        !answer.text.includes(row.whatToDo),
        `${candidate} was answered with ${row.name}'s "what to do now"`,
      );
    }
  }
});

test('an empty name is refused before the table is even read', () => {
  for (const empty of ['', '   ']) {
    const out = explainRefusal(empty);
    assert.equal(out.isError, true);
    assert.match(out.text, /^RefusalNameEmpty: /);
  }
});

test('what explain_refusal prints names the published guide, never a path of this repository', () => {
  // A customer has https://ziffer.io/docs/support, not docs/onboarding/support.md, and nothing
  // under services/. The row answer and the unknown-name answer are the two a caller reaches.
  for (const out of [explainRefusal('TenantMismatch'), explainRefusal('TenantMismatched')]) {
    assert.match(out.text, /https:\/\/ziffer\.io\/docs\/support/);
    assert.doesNotMatch(out.text, /docs\/onboarding\/|services\/|templates\//);
  }
});
