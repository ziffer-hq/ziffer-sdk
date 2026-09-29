import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ControlRef } from '../types.js';
import { ANNEX, findAnnexRow, findAtlasRow } from './annex.js';
import {
  attachControls,
  FINDING_CONTROLS,
  FindingControlsInvalid,
  isExcludedCitation,
  parseFindingControls,
  unresolvedCitations,
  type FindingControls,
} from './controls.js';
import { FIXTURE } from './fixture.test.data.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATUSES: readonly ControlRef['status'][] = ['built', 'partial', 'not checked', 'lands in', 'customer obligation', 'not covered'];

test('the generated annex data is not empty and is stamped with this package\'s engine pin', () => {
  assert.ok(ANNEX.rows.length > 50, `only ${ANNEX.rows.length} annex rows`);
  assert.ok(ANNEX.atlas.some((r) => r.framework === 'MITRE ATLAS'));
  assert.ok(ANNEX.atlas.some((r) => r.framework === 'OWASP LLM Top 10'));
  const pkg: unknown = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  let pin: unknown;
  if (typeof pkg === 'object' && pkg !== null && 'ziffer' in pkg && typeof pkg.ziffer === 'object' && pkg.ziffer !== null && 'enginePin' in pkg.ziffer) {
    pin = pkg.ziffer.enginePin;
  }
  for (const g of ANNEX.generated_from) assert.equal(g.engine_pin, pin, `${g.path} was read at ${g.engine_pin}`);
});

test('EVERY citation in data/finding-controls.json resolves to a row of the dossier at the pin', () => {
  assert.deepEqual(unresolvedCitations(), []);
});

test('a planted unknown clause is named, not skipped', () => {
  const planted: FindingControls = {
    ...FINDING_CONTROLS,
    kinds: { ...FINDING_CONTROLS.kinds, pair: [...FINDING_CONTROLS.kinds.pair, { framework: 'NIS2', clause: 'Art. 99(9)(z)' }] },
  };
  const problems = unresolvedCitations(planted);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /^pair: NIS2 Art\. 99\(9\)\(z\): no such row in Annex E/);
  assert.throws(() => attachControls(FIXTURE.findings, planted), { name: 'CitationUnresolved' });
});

test('a MITRE row whose position phrase has no status mapping is named', () => {
  const planted: FindingControls = { ...FINDING_CONTROLS, mitre_position_status: {} };
  assert.ok(unresolvedCitations(planted).some((p) => /has no entry in mitre_position_status/.test(p)));
});

test('attachControls carries the dossier\'s status word verbatim, for every citation', () => {
  const findings = attachControls(FIXTURE.findings);
  let seen = 0;
  for (const f of findings) {
    assert.equal(f.controls.length, FINDING_CONTROLS.kinds[f.kind].length);
    for (const c of f.controls) {
      seen++;
      if (c.source === 'E-control-mapping.md') {
        assert.equal(c.status, findAnnexRow(ANNEX, c.framework, c.clause)?.status);
      } else {
        const row = findAtlasRow(ANNEX, c.framework, c.clause);
        assert.equal(c.status, FINDING_CONTROLS.mitre_position_status[row?.position_label ?? '']);
      }
    }
  }
  assert.ok(seen > 0);
});

test('every status word of the annex is carried through verbatim, "not covered" included', () => {
  for (const status of STATUSES) {
    // A row this package never cites (EXCLUDED_CITATIONS) cannot carry a status through; the first other row of that status does.
    const row = ANNEX.rows.find((r) => r.status === status && !isExcludedCitation(r));
    assert.ok(row, `the annex at the pin has no "${status}" row`);
    const mapping: FindingControls = {
      ...FINDING_CONTROLS,
      kinds: { ...FINDING_CONTROLS.kinds, egress: [{ framework: row.framework, clause: row.clause }] },
    };
    const [f] = attachControls([{ id: 'x', kind: 'egress', severity: 'info', tools: [], message: 'x', controls: [] }], mapping);
    assert.equal(f?.controls[0]?.status, status);
  }
});

test('the data file refuses a missing kind by name', () => {
  assert.throws(() => parseFindingControls({ kinds: { pair: [] }, mitre_position_status: {} }), FindingControlsInvalid);
  assert.throws(
    () => parseFindingControls({ kinds: { ...FINDING_CONTROLS.kinds, invented: [] }, mitre_position_status: {} }),
    /kinds\.invented is not a finding kind/,
  );
});
