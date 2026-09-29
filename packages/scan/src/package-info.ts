/**
 * What this package's own package.json states: its version and the engine
 * commit it wraps (`ziffer.enginePin`, the field tools/release-npm.sh checks
 * against Cargo.toml). Read, never restated: a second spelling of either in
 * code is the one that goes stale at the next release or pin bump.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function manifest(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw: unknown = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('PackageManifestUnreadable: package.json is not an object');
  return Object.fromEntries(Object.entries(raw));
}

/** The version from this package's own package.json -- one statement of it. */
export function packageVersion(): string {
  const v = manifest()['version'];
  if (typeof v === 'string') return v;
  throw new Error('PackageVersionAbsent: package.json carries no string "version"');
}

/** The 40-hex engine commit this package wraps, from `ziffer.enginePin`. */
export function packageEnginePin(): string {
  const z = manifest()['ziffer'];
  if (typeof z === 'object' && z !== null && 'enginePin' in z && typeof z.enginePin === 'string' && /^[0-9a-f]{40}$/.test(z.enginePin)) {
    return z.enginePin;
  }
  throw new Error('PackageEnginePinAbsent: package.json carries no 40-hex "ziffer.enginePin"');
}
