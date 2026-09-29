/**
 * Serve `docs/onboarding/sdk.md` to a coding agent, one language at a time
 * (ACP-197, section 6b point 2).
 *
 * The doc is the single source and this module is a slicer over it. Nothing
 * here paraphrases, summarises or reformats: an agent asking how to integrate
 * gets the text a human reader would get, so a correction to the doc is a
 * correction to what every agent is told. A second, agent-flavoured copy of the
 * integration story is the two-definitions defect, and the one that goes stale
 * is always the one no human reads.
 *
 * # Marked spans, not headings
 *
 * Sections are delimited by HTML comments (`<!-- guide:python -->` …
 * `<!-- guide:/python -->`) rather than located by heading text. Markers are
 * invisible in every markdown renderer, and they make the coupling explicit:
 * renaming a heading is an editorial act that should not silently change what a
 * tool returns, and deleting a marked span fails the build
 * (`scripts/embed-guide.mjs` refuses a doc missing any required marker) instead
 * of quietly serving nothing.
 */

import { GUIDE_MARKDOWN, GUIDE_SOURCE_PATH } from './generated/guide-source.js';

/** The languages `get_integration_guide` answers for. */
export const LANGUAGES = ['python', 'typescript'] as const;

/** One of {@link LANGUAGES}. */
export type Language = (typeof LANGUAGES)[number];

/**
 * The marked spans this module knows about, and the order they are served in.
 *
 * `common` comes first in every answer because it carries the part an agent
 * gets wrong when it is missing: what the SDK is for, and that only the verify
 * line enforces anything. An agent handed just the language snippet would wire
 * up the calls and skip the check they exist to make.
 */
const SECTIONS = ['common', ...LANGUAGES] as const;

/** A span named in {@link SECTIONS} that the embedded doc does not carry. */
export class GuideError extends Error {
  override readonly name: string;

  constructor(name: string, detail: string) {
    super(`${name}: ${detail}`);
    this.name = name;
  }
}

/** Narrow an arbitrary string to a {@link Language}, or `null`. */
export function asLanguage(raw: string): Language | null {
  // A lookup rather than a cast: `.claude/rules/typescript.md` forbids `as`
  // here, and the honest reason is stronger than the rule -- the argument comes
  // from a model, so it is exactly the input a cast would wave through.
  for (const known of LANGUAGES) {
    if (known === raw) return known;
  }
  return null;
}

function span(name: string): string {
  const open = `<!-- guide:${name} -->`;
  const close = `<!-- guide:/${name} -->`;
  const openAt = GUIDE_MARKDOWN.indexOf(open);
  const closeAt = GUIDE_MARKDOWN.indexOf(close);
  if (openAt === -1 || closeAt === -1 || closeAt < openAt) {
    // Unreachable through a build, because embed-guide.mjs refuses the same
    // condition. Kept anyway, and named: this module is also imported by tests
    // and could one day be handed a doc the build script never saw, and the
    // alternative to a refusal is returning an empty guide that reads as an
    // answer.
    throw new GuideError(
      'GuideSectionMissing',
      `${GUIDE_SOURCE_PATH} carries no complete guide:${name} span.`,
    );
  }
  return GUIDE_MARKDOWN.slice(openAt + open.length, closeAt).trim();
}

/**
 * The guide for one language: the common preamble, then that language's
 * walkthrough, exactly as `docs/onboarding/sdk.md` writes them.
 *
 * @throws GuideError `GuideSectionMissing` if the embedded doc lost a span.
 */
export function integrationGuide(language: Language): string {
  return [span('common'), span(language)].join('\n\n');
}

/** Every span this module serves, for the staleness assertion in the tests. */
export const SERVED_SECTIONS: readonly string[] = SECTIONS;

/** The embedded doc, for tests that compare it against the file on disk. */
export { GUIDE_MARKDOWN, GUIDE_SOURCE_PATH };
