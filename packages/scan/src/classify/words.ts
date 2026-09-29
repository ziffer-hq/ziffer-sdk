/**
 * Word splitting and keyword matching for the draft classifier.
 *
 * A keyword is matched against WORDS, never as a raw substring: `read` as a raw
 * substring fires inside `thread` and `already`, and `set` inside `settings`,
 * which would turn every settings reader into a writer. So both the text and
 * the keyword go through the same split (camelCase, `_`, `-`, punctuation,
 * spaces), and a keyword of N words matches N consecutive words of the text.
 * Its LAST word may also carry one of the suffixes the data file lists
 * (`delete` fires on `deletes` and `deleted`); the suffix list is data, not
 * code, because it is a heuristic like every other one here.
 */

/** Split a name, description or parameter into lowercase words. */
export function words(text: string): string[] {
  const spaced = text
    // "sendEmail" -> "send Email", "v2Api" -> "v2 Api"
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // "HTTPRequest" -> "HTTP Request"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
  return spaced.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

/** True when `keyword`'s words appear consecutively in `text`. */
export function matchesKeyword(text: readonly string[], keyword: readonly string[], suffixes: readonly string[]): boolean {
  if (keyword.length === 0) return false;
  const last = keyword.length - 1;
  for (let i = 0; i + keyword.length <= text.length; i += 1) {
    let all = true;
    for (let j = 0; j <= last; j += 1) {
      const got = text[i + j];
      const want = keyword[j];
      if (got === undefined || want === undefined) {
        all = false;
        break;
      }
      const same = got === want || (j === last && suffixes.some((s) => got === want + s));
      if (!same) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}
