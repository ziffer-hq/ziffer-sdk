/**
 * The scan, against small repositories written for each shape it has to tell
 * apart, and against the shapes it must refuse to guess at.
 *
 * Every fixture is ONE shape. A single repository containing all of them would
 * let a missing rule hide behind a passing neighbour: the report would still
 * have a FAIL in it and the test would still be green.
 *
 * The fixtures are written under a `mkdtemp` directory and this file writes
 * nowhere else. The tool itself writes nothing at all — that is asserted too,
 * by comparing the tree before and after.
 */

import { mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { PACKAGES } from './generated/started-source.js';
import {
  checkIntegrationTool,
  maskPython,
  maskTypescript,
  SKIPPED,
} from './integration-check.js';

const ROOT = mkdtempSync(join(tmpdir(), 'ziffer-mcp-integration-'));

/** One repository, one shape. Returns its path. */
function repo(name: string, files: Readonly<Record<string, string>>): string {
  const root = join(ROOT, name);
  for (const [relative, contents] of Object.entries(files)) {
    const full = join(root, ...relative.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return root;
}

/** Every file under a tree with its size and mtime, for the "writes nothing"
 * assertion. A tool that created a file, or rewrote one, moves this. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const info = statSync(full);
        out.push(`${resolve(full).split(sep).join('/')} ${info.size} ${info.mtimeMs}`);
      }
    }
  };
  walk(root);
  return out;
}

const PY_GOOD = `import json
import os

from ziffer import Client, RefusedError, TrustAnchor, verify

client = Client(base_url=os.environ["ZIFFER_API_URL"], api_key=os.environ["ZIFFER_API_KEY"])


def transfer(amount, to_account):
    proposal = {"schema_id": "transfer"}
    decision = client.wait(client.propose(proposal).decision_id, timeout=30.0)
    if decision.outcome != "ALLOW":
        raise PermissionError(decision.clause)
    verify(decision.receipt, json.dumps(proposal).encode(), anchor)
    bank.transfer(amount, to_account)
`;

const PY_MISSING = `from ziffer import Client

client = Client(base_url="x", api_key="y")


def transfer(amount, to_account):
    proposal = {"schema_id": "transfer"}
    decision = client.wait(client.propose(proposal).decision_id, timeout=30.0)
    if decision.outcome != "ALLOW":
        raise PermissionError(decision.clause)
    bank.transfer(amount, to_account)
`;

const TS_GOOD = `import { ZifferClient, verifyReceipt } from '@ziffer-io/client';
import { canon } from '@ziffer-io/verify';

const client = new ZifferClient(url, key);

export async function transfer(amount: number): Promise<void> {
  const proposal = { schema_id: 'transfer' };
  const submitted = await client.propose(proposal);
  const decision = await client.wait(submitted.decision_id, { timeoutMs: 30_000 });
  if (decision.outcome !== 'ALLOW') throw new Error(decision.clause);
  verifyReceipt(decision.receipt, canon(proposal), anchor);
  await bank.transfer(amount);
}
`;

const TS_MISSING = `import { ZifferClient } from '@ziffer-io/client';

const client = new ZifferClient(url, key);

export async function transfer(amount: number): Promise<void> {
  const proposal = { schema_id: 'transfer' };
  const submitted = await client.propose(proposal);
  const decision = await client.wait(submitted.decision_id, { timeoutMs: 30_000 });
  if (decision.outcome !== 'ALLOW') throw new Error(decision.clause);
  await bank.transfer(amount);
}
`;

test('a propose with a verify beside it, in both languages, is a PASS naming the function', async () => {
  const python = await checkIntegrationTool(repo('py-good', { 'app/handlers.py': PY_GOOD }));
  assert.equal(python.isError, false);
  assert.match(python.text, /^PASS {8}app\/handlers\.py:11$/m);
  assert.match(python.text, /transfer\(\) verifies: verify\(\) in the same function names `proposal`/);

  const typescript = await checkIntegrationTool(repo('ts-good', { 'src/tools.ts': TS_GOOD }));
  assert.equal(typescript.isError, false);
  assert.match(typescript.text, /^PASS {8}src\/tools\.ts:8$/m);
  assert.match(typescript.text, /transfer\(\) verifies: verifyReceipt\(\) in the same function names `proposal`/);
});

test('a propose with NO verify in the handler is a FAIL naming the file and line', async () => {
  // THE FINDING THIS TOOL EXISTS FOR. sdk.md section 4: delete the verify line
  // and the integration still works, nothing warns you and no test fails.
  const python = await checkIntegrationTool(repo('py-missing', { 'app/handlers.py': PY_MISSING }));
  assert.equal(python.isError, false, 'a FAIL is the tool having looked, not a tool error');
  assert.match(python.text, /^FAIL {8}app\/handlers\.py:8$/m);
  assert.match(python.text, /transfer\(\) proposes and never verifies: no verify\(\) anywhere in this function/);
  assert.match(python.text, /fix: Add verify\(\) over the receipt/);
  assert.match(python.text, /0 PASS, 1 FAIL, 0 NOT CHECKED\./);

  const typescript = await checkIntegrationTool(repo('ts-missing', { 'src/tools.ts': TS_MISSING }));
  assert.match(typescript.text, /^FAIL {8}src\/tools\.ts:7$/m);
  assert.match(typescript.text, /0 PASS, 1 FAIL, 0 NOT CHECKED\./);
});

test('the fix line for a FAIL names the wrapper case this scan cannot follow', async () => {
  // A handler whose verify is one call away is a good integration that reads as
  // a FAIL from here. The finding is TRUE -- there is no verify in that
  // function -- and the fix says so, rather than letting a reader take the line
  // for a verdict on their code.
  const out = await checkIntegrationTool(
    repo('py-wrapper', {
      'app/handlers.py': `from ziffer import Client

client = Client(base_url="x", api_key="y")


def transfer(amount):
    proposal = {"schema_id": "transfer"}
    decision = client.propose(proposal)
    settle(decision, proposal)
`,
    }),
  );
  assert.match(out.text, /^FAIL {8}app\/handlers\.py:8$/m);
  assert.match(out.text, /If the verify is in a helper this function calls, this scan cannot follow the call/);
});

test('a verify over a DIFFERENT name is NOT CHECKED, never PASS', async () => {
  const out = await checkIntegrationTool(
    repo('py-other-bytes', {
      'app/handlers.py': `from ziffer import Client, verify

client = Client(base_url="x", api_key="y")


def transfer(amount):
    proposal = {"schema_id": "transfer"}
    decision = client.propose(proposal)
    verify(decision.receipt, cached_bytes, anchor)
    bank.transfer(amount)
`,
    }),
  );
  assert.match(out.text, /^NOT CHECKED app\/handlers\.py:8$/m);
  assert.match(out.text, /over something other than `proposal`/);
  assert.match(out.text, /0 PASS, 0 FAIL, 1 NOT CHECKED\./);
});

test('a proposal built inline has no name to follow, and that is NOT CHECKED', async () => {
  const out = await checkIntegrationTool(
    repo('ts-inline', {
      'src/tools.ts': `import { ZifferClient, verifyReceipt } from '@ziffer-io/client';

export async function transfer(): Promise<void> {
  const decision = await client.propose({ schema_id: 'transfer' });
  verifyReceipt(decision.receipt, bytes, anchor);
}
`,
    }),
  );
  assert.match(out.text, /^NOT CHECKED src\/tools\.ts:4$/m);
  assert.match(out.text, /rather than a named variable, so there is no name to look for/);
});

test('a propose outside any function this scan can delimit is NOT CHECKED', async () => {
  const out = await checkIntegrationTool(
    repo('py-module-level', {
      'app/boot.py': `from ziffer import Client

client = Client(base_url="x", api_key="y")
decision = client.propose(proposal)
`,
    }),
  );
  assert.match(out.text, /^NOT CHECKED app\/boot\.py:4$/m);
  assert.match(out.text, /not inside a function this scan can delimit/);
});

test('a file that imports no ZIFFER package is skipped, so somebody elses propose is not a finding', async () => {
  const out = await checkIntegrationTool(
    repo('unrelated', {
      'app/meeting.py': `def schedule(agenda):
    calendar.propose(agenda)
`,
      'src/vote.ts': `export function run(ballot) {
  return council.propose(ballot);
}
`,
    }),
  );
  assert.equal(out.isError, false);
  // Built from PACKAGES rather than written out: the names come from the
  // manifests that publish them, and a literal here would be a second spelling
  // of the npm scope -- which `tools/check-org-name.py` refuses outright,
  // because an escaped copy of it is exactly what survives a rename.
  assert.match(
    out.text,
    new RegExp(`No file under this path imports ${PACKAGES.python} or ${PACKAGES.client.replace('/', '\\/')}`),
  );
  assert.match(out.text, /This is NOT a pass\./);
  assert.match(out.text, /2 source file\(s\) read, 0 of them importing the SDK\./);
});

test('a propose inside a comment or a string is not a call site', async () => {
  // The masking, made to matter. Without it the two lines below are two
  // findings, and a report that invents call sites is a report nobody finishes
  // reading.
  const out = await checkIntegrationTool(
    repo('masked', {
      'src/notes.ts': `import { ZifferClient } from '@ziffer-io/client';

// call client.propose(proposal) here one day
const doc = 'client.propose(proposal)';
const tpl = \`client.propose(proposal)\`;
export const nothing = [doc, tpl];
`,
      'app/notes.py': `from ziffer import Client

# client.propose(proposal)
DOC = """client.propose(proposal)"""
`,
    }),
  );
  assert.match(out.text, /none of them calls propose/);
  assert.match(out.text, /2 source file\(s\) read, 2 of them importing the SDK\./);
});

test('a directory a build put there is skipped by name rather than scanned', async () => {
  const out = await checkIntegrationTool(
    repo('vendored', {
      'node_modules/pkg/index.ts': TS_MISSING,
      'dist/tools.js': TS_MISSING,
      'src/tools.ts': TS_GOOD,
    }),
  );
  assert.match(out.text, /1 source file\(s\) read, 1 of them importing the SDK\./);
  assert.match(out.text, /1 PASS, 0 FAIL, 0 NOT CHECKED\./);
  assert.ok(SKIPPED.includes('node_modules') && SKIPPED.includes('dist'));
});

test('the report states what it cannot see, and that NOT CHECKED is not PASS', async () => {
  const out = await checkIntegrationTool(repo('disclaimer', { 'app/handlers.py': PY_GOOD }));
  assert.match(out.text, /a verify inside a helper the handler calls/);
  assert.match(out.text, /whether the verify runs BEFORE the action/);
  assert.match(out.text, /NOT CHECKED means it could not look\. It never means the same thing as PASS\./);
});

test('it writes nothing to the tree it reads', async () => {
  const root = repo('readonly', { 'app/handlers.py': PY_MISSING, 'src/tools.ts': TS_GOOD });
  const before = snapshot(root);
  await checkIntegrationTool(root);
  assert.deepEqual(snapshot(root), before);
});

test('a path that is not a readable directory is a tool error, because nothing was checked', async () => {
  const missing = await checkIntegrationTool(join(ROOT, 'no-such-tree'));
  assert.equal(missing.isError, true);
  assert.match(missing.text, /^RepoPathUnreadable: /);

  const file = repo('a-file', { 'app/handlers.py': PY_GOOD });
  const notADirectory = await checkIntegrationTool(join(file, 'app', 'handlers.py'));
  assert.equal(notADirectory.isError, true);
  assert.match(notADirectory.text, /^RepoPathNotADirectory: /);

  const unnamed = await checkIntegrationTool('   ');
  assert.equal(unnamed.isError, true);
  assert.match(unnamed.text, /^RepoPathUnnamed: /);
});

test('masking keeps every offset, so a line number is still the line', () => {
  // The property the two maskers are built around. A mask that shortened the
  // text would report every call site after the first comment at the wrong
  // line, and the report would be confidently wrong rather than silent.
  for (const [source, masked] of [
    ['const a = 1; // propose(\nconst b = `x${propose(y)}z`;\n', maskTypescript('const a = 1; // propose(\nconst b = `x${propose(y)}z`;\n')],
    ['x = 1  # propose(\ny = """a\nb"""\n', maskPython('x = 1  # propose(\ny = """a\nb"""\n')],
  ] as const) {
    assert.equal(masked.length, source.length, 'the mask changed the length');
    assert.equal(masked.split('\n').length, source.split('\n').length, 'the mask lost a newline');
  }
  // And the interpolation stays CODE: a real call inside `${...}` is a real
  // call, so blanking it would hide a finding.
  assert.match(maskTypescript('const b = `x${client.propose(y)}z`;'), /client\.propose\(y\)/);
  assert.doesNotMatch(maskTypescript("const s = 'client.propose(y)';"), /client\.propose/);
  assert.doesNotMatch(maskPython('# client.propose(y)'), /client\.propose/);
});
