/**
 * Serve the policy repository's own two documents to a coding agent (ACP-389).
 *
 * `guide.ts` is this module's older twin and every argument there applies here
 * unchanged: the documents are the single source, this file is a reader over
 * them, and nothing in it paraphrases, summarises or reformats. An agent asking
 * how to set up the policy repository gets the text a human reader gets, so a
 * correction to the README is a correction to what every agent is told.
 *
 * # Why a new tool and not a `topic` argument on `get_integration_guide`
 *
 * Because of what the alternative would have done to `guide.test.ts`. That test
 * reads `docs/onboarding/sdk.md` off disk and asserts, for every language, that
 * `integrationGuide(language)` equals two spans sliced independently out of
 * THAT file. A `topic` argument would have made the function's return value
 * depend on a second document, which means either the assertion loosens to
 * cover both cases -- the one thing this repository does not do to a test -- or
 * it keeps asserting the sdk.md case and silently stops covering the other
 * half. The languages are also an enum in the tool's schema (`z.enum(LANGUAGES)`
 * in `server.ts`), and a `topic` beside it would make two arguments where only
 * some pairs are legal; the protocol cannot express that, so the handler would
 * have to, and a schema that accepts what the handler refuses is the shape
 * `server.test.ts` already has an assertion against.
 *
 * A separate tool leaves both tests intact and describes itself in its own
 * name, which is what a model reads before it picks one.
 *
 * # What is served, and what is NOT restated here
 *
 * The items ACP-389 requires -- the six steps, the three files ZIFFER
 * provisions, the four variables, the four secrets by name, and the branch
 * protection rule -- are in `templates/policy-repo/README.md`, and this module
 * serves that file. It carries no list of steps, no filename and no variable
 * name of its own. The branch protection rule was the one item the README did
 * not carry when this was written; the README gained it, rather than this file
 * gaining a paragraph the customer reading their own repository would never
 * see. `repo-guide.test.ts` asserts every one of those items is present in the
 * served text, so dropping one from the README is a red suite and not a quietly
 * shorter answer.
 */

import { REPO_GUIDE_DOCS, type RepoGuideDoc } from './generated/repo-guide-source.js';

/** A span named in a document that the embedded copy does not carry. */
export class RepoGuideError extends Error {
  override readonly name: string;

  constructor(name: string, detail: string) {
    super(`${name}: ${detail}`);
    this.name = name;
  }
}

/** The documents, in the order they are served, for the tests and for
 * `repo-check.ts`, which slices one span out of the first. */
export const REPO_GUIDE: readonly RepoGuideDoc[] = REPO_GUIDE_DOCS;

/**
 * Both documents, each under a line naming the file it came from.
 *
 * The attribution is not decoration. An agent that is going to edit a
 * customer's repository needs to know which file a sentence came from, and a
 * model handed 15KB of unattributed markdown will cheerfully invent a filename
 * for it. The line is the only text this module adds.
 */
export function policyRepoGuide(): string {
  return REPO_GUIDE.map((doc) => `<!-- ${doc.path} -->\n\n${doc.markdown.trim()}`).join('\n\n---\n\n');
}

/**
 * One marked span, out of whichever document carries it.
 *
 * Markers rather than headings, for `guide.ts`'s reason: renaming a heading is
 * an editorial act that should not silently change what a tool returns. The
 * build refuses a document that lost a required marker
 * (`scripts/embed-guide.mjs`), so this throw is unreachable through a build and
 * is kept for the case that module comment names -- a test handing this reader
 * a document the build script never saw.
 *
 * @throws RepoGuideError `GuideSectionMissing` when no document carries it.
 */
export function repoGuideSpan(name: string): string {
  const open = `<!-- guide:${name} -->`;
  const close = `<!-- guide:/${name} -->`;
  for (const doc of REPO_GUIDE) {
    const openAt = doc.markdown.indexOf(open);
    const closeAt = doc.markdown.indexOf(close);
    if (openAt !== -1 && closeAt > openAt) {
      return doc.markdown.slice(openAt + open.length, closeAt).trim();
    }
  }
  throw new RepoGuideError(
    'GuideSectionMissing',
    `no document in ${REPO_GUIDE.map((doc) => doc.path).join(', ')} carries a complete guide:${name} span.`,
  );
}
