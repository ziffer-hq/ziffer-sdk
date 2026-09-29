/**
 * ACP-475: a declared library the scan does not read leaves a line in the report.
 *
 * `fixtures/code/unread-475/` is an invented hotel concierge. It defines a tool through a
 * framework the scan reads, and declares libraries the scan does not: two whose names say
 * they are model or AI agent libraries, one listed by name, one HTTP proxy agent that is
 * not one, and one web framework. The Python manifest does the same. Until 0.3.1 the report
 * named none of them, and read as "nothing here" where it meant "nothing I recognise".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanCode } from './index.js';
import { findPython, scanPython } from './py/index.js';
import { loadCodeSdks, looksLikeModelLibrary } from './sdks.js';

const FIX = fileURLToPath(new URL('../../fixtures/code/unread-475/', import.meta.url));
const READ = loadCodeSdks().filter((e) => e.kind === 'framework' && e.covered === 'milestone-1').length;
const TAIL = `a model or AI agent library. This scan reads the ${READ} frameworks it lists, and a tool defined through another library is not in these numbers.`;

describe('ACP-475: a library the scan does not read is named', () => {
  it('package.json: the libraries whose names suggest one, and no other dependency', async () => {
    const c = await scanCode(FIX);
    const line = `Declared in package.json and not read by this scan: llm-concierge 0.4.2, ollama 0.5.0, quillon-agents 2.1.0. Their names suggest ${TAIL}`;
    assert.equal(c.not_seen.filter((l) => l === line).length, 1, c.not_seen.join('\n'));
    for (const other of ['https-proxy-agent', 'express', 'zod']) assert.equal(c.not_seen.some((l) => l.includes(other)), false, `${other} was named`);
    // The tool the scan does read is still found: the line adds to the report, it takes nothing away.
    assert.deepEqual(c.tools.map((t) => t.name), ['findRoom']);
  });

  it('a Python manifest: the same rule, the same words', async () => {
    assert.ok((await findPython()) !== null, 'no python3 >= 3.9 on PATH: this test runs the real walker');
    const c = await scanPython(FIX);
    const line = `Declared in a Python manifest and not read by this scan: harbour-agent-kit >=0.2, litellm ==1.40.0. Their names suggest ${TAIL}`;
    assert.equal(c.not_seen.filter((l) => l === line).length, 1, c.not_seen.join('\n'));
    assert.equal(c.not_seen.some((l) => l.includes('requests')), false);
  });

  it('never names a framework the scan reads, nor an excepted name', () => {
    for (const read of ['ai', '@ai-sdk/openai', 'openai', '@openai/agents', 'langchain-core', 'crewai']) assert.equal(looksLikeModelLibrary(read, 'npm'), false, read);
    assert.equal(looksLikeModelLibrary('https-proxy-agent', 'npm'), false);
    assert.equal(looksLikeModelLibrary('user-agent-parser', 'npm'), false);
    // Per registry: `groq` is listed for PyPI only.
    assert.equal(looksLikeModelLibrary('groq', 'pypi'), true);
    assert.equal(looksLikeModelLibrary('groq', 'npm'), false);
  });
});
