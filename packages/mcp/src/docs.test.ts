/**
 * That `search_docs` serves the real documents, that it serves ALL of the
 * ones it should and NONE of the one it should not, and that the ranking is a
 * ranking rather than an opinion.
 *
 * The assertion carrying the weight is the first: every embedded document is
 * compared against the file read off disk. `guide.test.ts` makes the same one
 * for `sdk.md` and states why — a copy of the expected text pasted into this
 * file would make the test pass for ever and prove only that this file agrees
 * with itself, which is exactly the failure the embed step introduces the
 * possibility of.
 *
 * The second is the one this slice added and it is not a formality: the
 * served set is compared against the DIRECTORY, both directions. A document
 * added to `docs/onboarding/` is served without anybody editing a list, and a
 * document withheld from customers has to be pinned by name with a reason —
 * so a new internal artifact dropped into that directory is a red suite and
 * not a quiet shipment of our build state into every customer's context.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LIMIT,
  MAX_ANSWER_CHARS,
  MAX_LIMIT,
  allSections,
  attribution,
  rank,
  searchDocs,
  sectionsOf,
  terms,
} from './docs.js';
import {
  ONBOARDING_DIR,
  ONBOARDING_DOCS,
  ONBOARDING_NOT_SERVED,
  SUPPORT_DOC_PATH,
} from './generated/docs-source.js';

/** dist/docs.test.js -> packages/mcp/dist -> packages/mcp -> packages -> root. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('every served document is the file on disk, not a copy of it', () => {
  assert.ok(ONBOARDING_DOCS.length > 0, 'no onboarding document was embedded at all');
  for (const doc of ONBOARDING_DOCS) {
    const onDisk = readFileSync(join(repoRoot, doc.path), 'utf8');
    assert.equal(
      doc.markdown,
      onDisk,
      `the embedded copy of ${doc.path} is not what that file says. Either it is stale ` +
        '(run `pnpm --filter @ziffer-io/mcp build`) or the embed step read a different file.',
    );
  }
});

test('the served set is the directory, minus the documents pinned as withheld', () => {
  // BOTH directions, and the second is the one that matters: a document added
  // to docs/onboarding/ must be served without this file being edited, and a
  // document withheld must be pinned BY NAME with a reason. Neither direction
  // can be satisfied by a list somebody remembered to update.
  const onDisk = readdirSync(join(repoRoot, ONBOARDING_DIR))
    .filter((name) => name.endsWith('.md'))
    .sort();
  const withheld = Object.keys(ONBOARDING_NOT_SERVED).sort();
  const expected = onDisk.filter((name) => !withheld.includes(name));
  const served = ONBOARDING_DOCS.map((doc) => doc.path.slice(`${ONBOARDING_DIR}/`.length)).sort();
  assert.deepEqual(
    served,
    expected,
    'the documents this package serves are not the documents in the directory minus the ' +
      'pinned exclusions. A file added there is served; a file withheld is pinned with its ' +
      'reason in scripts/embed-guide.mjs.',
  );
  for (const name of withheld) {
    assert.ok(
      onDisk.includes(name),
      `${name} is pinned as withheld and is not in ${ONBOARDING_DIR}: a pin that has stopped ` +
        'firing is a claim nobody is checking.',
    );
    assert.ok(
      (ONBOARDING_NOT_SERVED[name] ?? '').length > 40,
      `${name} is withheld without a reason worth reading`,
    );
    // The reason is compiled into the published package, so it is customer text: no ticket,
    // no path of this repository, no gap volunteered. The maintainers' note lives in the
    // comment above the pin in scripts/embed-guide.mjs.
    const reason = ONBOARDING_NOT_SERVED[name] ?? '';
    for (const [pattern, what] of [
      [/(?<![\w-])ACP-\d+/i, 'a ticket number'],
      [/(?<![\w.@/-])(?:scripts|docs|packages|tools|services|deploy|crates)\/[\w.-]/, 'a path of this repository'],
      [/\b(?:never run|has not run|not yet|not tested|unproven)\b/i, 'a gap phrase'],
    ] as const) {
      assert.ok(!pattern.test(reason), `the withheld reason for ${name} carries ${what}: ${reason}`);
    }
  }
});

test('the README names no withheld document and repeats none of its reason', () => {
  // ACP-466. The README is the page npm shows a buyer. Until ACP-466 it named the
  // withheld document by its repository path and quoted the pin's reason verbatim
  // (ACP-394 item 6 held the two spellings equal here). The reason is internal build
  // state, which customer copy does not carry, so the README says nothing about a
  // withheld document and the pin in scripts/embed-guide.mjs is the ONE spelling.
  // What is held now is that a second spelling does not come back: the document's
  // name or its reason reappearing in the README is red.
  // Whitespace and the README's emphasis markers are normalised, as before.
  const flat = (text: string): string => text.replace(/[*\s]+/g, ' ').trim();
  const readme = flat(readFileSync(join(repoRoot, 'packages', 'mcp', 'README.md'), 'utf8'));
  const withheld = Object.keys(ONBOARDING_NOT_SERVED);
  assert.ok(withheld.length > 0, 'nothing is withheld, so this assertion is vacuous');
  for (const name of withheld) {
    assert.ok(
      !readme.includes(name),
      `README.md names ${name}, a document withheld from customers; the README is customer copy`,
    );
    assert.ok(
      !readme.includes(flat(ONBOARDING_NOT_SERVED[name] ?? '')),
      `README.md quotes the pinned reason for ${name}; that reason is internal and the pin in ` +
        'scripts/embed-guide.mjs is its one spelling.',
    );
  }
});

test('nothing from a withheld document can come back from a search', () => {
  // The exclusion is asserted where it matters -- in what the TOOL returns --
  // and not only in the generated constant. The journey sheet names tickets,
  // revisions and what has never run in AWS; a search that returned one of
  // its sections would put that in a customer's agent context.
  const withheld = Object.keys(ONBOARDING_NOT_SERVED);
  assert.ok(withheld.length > 0, 'nothing is withheld, so this assertion is vacuous');
  for (const section of allSections()) {
    for (const name of withheld) {
      assert.notEqual(
        section.path,
        `${ONBOARDING_DIR}/${name}`,
        `${name} is being served section by section`,
      );
    }
  }
  // And by its own words rather than by its path: the sheet's status vocabulary
  // ("never live", "HANDLED") appears nowhere in what this tool can answer.
  const answer = searchDocs('never live in AWS HANDLED PARTIAL', MAX_LIMIT).text;
  assert.doesNotMatch(answer, /journey-sheet/);
});

test('the corpus is substantial, so an empty document could not pass the comparison above', () => {
  // Without this, emptying every document would satisfy the equality
  // assertions with empty strings on each side.
  const total = ONBOARDING_DOCS.reduce((n, doc) => n + doc.markdown.length, 0);
  assert.ok(total > 200_000, `the onboarding corpus is ${total} characters, too short to be itself`);
  assert.ok(allSections().length > 100, 'the corpus split into too few sections to be itself');
});

test('a heading inside a fenced code block is not a heading', () => {
  // install.md is full of shell with `# a comment` in it. A splitter that cut
  // there would serve half a command as an answer.
  const doc = {
    path: 'x.md',
    markdown: ['# Title', 'body', '```bash', '# not a heading', 'run --it', '```', '## Real', 'more'].join('\n'),
  };
  const sections = sectionsOf(doc);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ['Title', 'Real'],
  );
  assert.match(sections[0]?.text ?? '', /# not a heading/);
});

test('a term keeps its dots and hyphens, so a clause id is one term', () => {
  assert.deepEqual([...terms('8.4-3')], ['8.4-3']);
  assert.deepEqual([...terms('what does DR-13 mean')].sort(), ['does', 'dr-13', 'mean', 'what']);
  assert.deepEqual([...terms('ZIFFER_SUITE_FLOOR')], ['ziffer_suite_floor']);
  // One-character terms are dropped; a query that is only those has none.
  assert.deepEqual([...terms('a b ? .')], []);
});

test('search_docs returns the section whole, under the path and heading it has on disk', () => {
  const out = searchDocs('ZIFFER_SUITE_FLOOR', 1);
  assert.equal(out.isError, false);
  const best = rank('ZIFFER_SUITE_FLOOR')[0];
  assert.ok(best !== undefined, 'nothing matched a variable this product requires');
  // VERBATIM: the whole section text is in the answer, not a summary of it.
  assert.ok(
    out.text.includes(best.section.text),
    'the answer does not carry the section it names, so something was reformatted',
  );
  assert.ok(out.text.includes(attribution(best.section)), 'the section is served without attribution');
  assert.match(out.text, /Nothing here is a summary\./);
});

test('search_docs says how many sections it did not show, and names them', () => {
  // A tool that quietly returns the first three is a tool that has answered a
  // question it did not ask the caller about.
  const query = 'receipt';
  const total = rank(query).length;
  assert.ok(total > DEFAULT_LIMIT, `only ${total} sections mention "${query}"; this case is vacuous`);
  const out = searchDocs(query, 1);
  assert.equal(out.isError, false);
  assert.match(out.text, new RegExp(`${total} section\\(s\\) matched, showing 1\\.`));
  assert.match(out.text, new RegExp(`${total - 1} more section\\(s\\) matched`));
});

test('the limit is bounded at both ends rather than trusted', () => {
  const query = 'receipt';
  for (const asked of [0, -5, 1, 1.9]) {
    assert.match(searchDocs(query, asked).text, /showing 1\./, `limit ${asked} did not show one`);
  }
  // A limit over the maximum is clamped to it -- and the answer may show
  // FEWER still, because MAX_ANSWER_CHARS stops before a section that would
  // cross it. Both bounds are asserted rather than one assumed: an answer of
  // four sections is correct here, and a test expecting ten would have been a
  // test of the wrong bound.
  const out = searchDocs(query, 1000);
  const shown = /showing (\d+)\./.exec(out.text);
  assert.ok(shown !== null, out.text.split('\n')[0]);
  const count = Number(shown[1]);
  assert.ok(count >= 1 && count <= MAX_LIMIT, `showed ${count}, outside 1..${MAX_LIMIT}`);
  if (count < MAX_LIMIT) {
    // Then the character bound is why, and the next section really would have
    // crossed it. Without this, a ranking that silently returned one section
    // would satisfy the range above.
    const ranked = rank(query);
    const carried = ranked.slice(0, count).reduce((n, entry) => n + entry.section.text.length, 0);
    const next = ranked[count]?.section.text.length ?? 0;
    assert.ok(
      carried + next > MAX_ANSWER_CHARS,
      `only ${count} of ${MAX_LIMIT} sections were shown and the character bound does not explain it`,
    );
  }
});

test('the same query twice is the same answer', () => {
  // An unstable ranking in a tool a model calls twice is a tool that appears
  // to change its mind. The sort has a total order for exactly this.
  assert.equal(searchDocs('epoch bundle publish').text, searchDocs('epoch bundle publish').text);
});

test('a query matching nothing is named, and is NOT a tool error', () => {
  const out = searchDocs('zzzznosuchtermanywhere');
  assert.equal(out.isError, false, 'the tool was asked to look and it looked');
  assert.match(out.text, /^NoSectionMatched: /);
  // It says what to do about the case that matters: the answer may genuinely
  // not be written down.
  assert.match(out.text, /send_feedback/);
});

test('a query with no usable term is refused rather than answered with the corpus', () => {
  for (const empty of ['', '  ', 'a', '. ?']) {
    const out = searchDocs(empty);
    assert.equal(out.isError, true, `${JSON.stringify(empty)} was accepted as a query`);
    assert.match(out.text, /^SearchQueryEmpty: /);
  }
});

test('the support document is in the corpus, because explain_refusal reads it from there', () => {
  assert.ok(
    ONBOARDING_DOCS.some((doc) => doc.path === SUPPORT_DOC_PATH),
    `${SUPPORT_DOC_PATH} is not served, so the refusal table has no home`,
  );
});
