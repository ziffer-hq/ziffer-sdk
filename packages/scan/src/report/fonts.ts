/**
 * The report's two type families, embedded (ACP-455 presentation, 2026-09-28).
 *
 * The HTML report is ONE file that loads nothing: its Content-Security-Policy is
 * `default-src 'none'`, and a mail client or a browser opening it from an
 * attachment must not reach the network. So the fonts travel inside it, as
 * base64 `@font-face` sources, read at render time from `assets/fonts/` of this
 * package (the files, their licence and where they came from are named in
 * `assets/fonts/README`). The page allows exactly this with `font-src data:`.
 *
 * Both reports (with `--code` and without) carry the same three faces, so they
 * read as one product.
 */

import { readFileSync } from 'node:fs';

const FONT_DIR = new URL('../../assets/fonts/', import.meta.url);

/** The three faces, as `@font-face` declares them: family, weight (a range for the variable face), file. */
export const FONT_FACES: readonly { family: string; weight: string; file: string }[] = [
  { family: 'Schibsted Grotesk', weight: '400 900', file: 'schibsted-grotesk-400-900.woff2' },
  { family: 'IBM Plex Mono', weight: '400', file: 'ibm-plex-mono-400.woff2' },
  { family: 'IBM Plex Mono', weight: '500', file: 'ibm-plex-mono-500.woff2' },
];

/** The CSP directive the embedded faces need, and nothing wider. */
export const FONT_SRC = 'font-src data:';

/** The font stacks the stylesheets name: the embedded face first, the system's after. */
export const SANS = '"Schibsted Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';
export const MONO = '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

let cached: string | undefined;

/** The `@font-face` rules, each file inlined as a `data:` URI. Read once per process. */
export function fontFaces(): string {
  cached ??= FONT_FACES.map((f) => {
    const b64 = readFileSync(new URL(f.file, FONT_DIR)).toString('base64');
    return `@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${f.weight};font-style:normal;font-display:block}`;
  }).join('\n');
  return cached;
}
