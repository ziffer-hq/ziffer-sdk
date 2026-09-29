/**
 * The names and the two text helpers both HTML renderers share (`file.ts`
 * for the page, `code-html.ts` for its `--code` sections): written once, so
 * the file the archive lists and the file the page tells a reader to attach
 * cannot drift apart.
 */

export const REPORT_FILE = 'ziffer-scan-report.html';
export const JSON_FILE = 'ziffer-scan.json';
export const ARCHIVE_FILE = 'ziffer-review.tar.gz';
/** The policy folder's name inside the archive, whatever `--out` called it. */
export const ARCHIVE_POLICY_DIR = 'ziffer-policy';

/** The terminal says the same of the draft; the report repeats it verbatim. */
export const DRAFT_NOTICE = 'Signed by a key made for this run and discarded: a draft to review, not a policy to deploy.';

/** The call to action, at the top and again at the bottom. */
export const CTA_TEXT = 'Review and sign off the draft policy';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
