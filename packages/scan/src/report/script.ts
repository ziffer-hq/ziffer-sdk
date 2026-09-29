/**
 * The page's ONE script (ACP-455, third design, 2026-09-28: a decision of the report's owner, who
 * asked that what looks clickable be clickable). It does four things by event delegation and nothing
 * else: copy a code block to the clipboard, open a `<dialog>` with `showModal()`, close it (its button,
 * a click on the backdrop; Escape is the browser's own), and open a folded `<details>` that an in-page
 * link names (a fragment on the `<details>` itself does not unfold it in every browser). It reads no
 * URL, loads nothing, sends nothing.
 *
 * The Content-Security-Policy allows exactly this text by its sha256 (`scriptHash`), computed when the
 * page is written: no `unsafe-inline`, no source. A reader whose client runs no script (a mail
 * preview) loses nothing: the page's root carries `noscript` until this script removes it, and while
 * it is there every dialog's content is shown in place.
 */

import { createHash } from 'node:crypto';

export const PAGE_SCRIPT = [
  "document.documentElement.classList.remove('noscript');",
  "function copyText(b,s){var d=function(){var o=b.textContent;b.textContent='Copied';b.classList.add('ok');setTimeout(function(){b.textContent=o;b.classList.remove('ok')},1400)};",
  "if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(s).then(d,function(){})}",
  "else{var t=document.createElement('textarea');t.value=s;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();d()}}",
  "document.addEventListener('click',function(e){",
  "if(e.target instanceof HTMLDialogElement){e.target.close();return}",
  "var a=e.target instanceof Element?e.target.closest('a[href^=\"#\"]'):null;if(a){var q=document.getElementById((a.getAttribute('href')||'').slice(1));if(q instanceof HTMLDetailsElement)q.open=true;return}",
  "var b=e.target instanceof Element?e.target.closest('button'):null;if(!b)return;",
  "if(b.dataset.open){var g=document.getElementById(b.dataset.open);if(g&&g.showModal)g.showModal();return}",
  "if('close' in b.dataset){var m=b.closest('dialog');if(m)m.close();return}",
  "if(b.classList.contains('copy')){var f=b.dataset.copyFrom?document.getElementById(b.dataset.copyFrom):b.closest('.codeline,.code');",
  "var c=f?(f.matches('pre,code')?f:f.querySelector('pre:not(.head) code,code')):null;if(c)copyText(b,c.textContent||'')}",
  "});",
].join('\n');

/** The CSP source that allows `PAGE_SCRIPT` and nothing else. */
export function scriptHash(script: string = PAGE_SCRIPT): string {
  return `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`;
}
