/**
 * `Exposure.interception`, `CodeTool.interception` and `CodeCatalog.structured_output`
 * (ACP-455, 2026-09-28): the place a check can stand is DATA from both front ends, read
 * from the one table in `data/code-sdks.json`, and the structured-output schemas that are
 * recognised and not counted are listed. The text notes stay; these are the fields.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { scanCode } from './index.js';
import { markerIn } from './interception.js';
import { findPython, parsePyScanOutput, scanPython } from './py/index.js';
import { loadCodeSdks } from './sdks.js';
import type { CodeCatalog } from './types.js';

const fx = (d: string): string => fileURLToPath(new URL(`../../fixtures/code/${d}/`, import.meta.url));

describe('the table', () => {
  it('every framework of the record table has an interception point, except Instructor (nothing runs)', () => {
    const without = loadCodeSdks().filter((e) => e.kind === 'framework' && e.interception === undefined).map((e) => e.id);
    assert.deepEqual(without, ['instructor']);
  });

  it('a marker counts where it is code, never in an import or a comment', () => {
    const sf = (text: string): ts.SourceFile => ts.createSourceFile('/r/a.ts', text, ts.ScriptTarget.Latest, true);
    assert.equal(markerIn(sf("import { toolApproval } from 'ai';\n// toolApproval\nconst x = 1;\n"), '/r', ['toolApproval']), undefined);
    assert.deepEqual(markerIn(sf("import { streamText } from 'ai';\nstreamText({ toolApproval: ok });\n"), '/r', ['toolApproval']), { file: 'a.ts', line: 2, col: 14 });
  });
});

describe('TypeScript front end', () => {
  const c = new Map<string, CodeCatalog>();
  before(async () => {
    for (const d of ['frameworks-ts', 'fw-claude-agent-sdk-ts', 'fw-mastra-ts', 'fw-instructor-ts', 'example-shape']) c.set(d, await scanCode(fx(d)));
  });
  const get = (d: string): CodeCatalog => {
    const x = c.get(d);
    assert.ok(x !== undefined, d);
    return x;
  };

  it('every exposure carries its framework\'s point; the SDKs that run nothing name the application\'s dispatcher, present', () => {
    const f = get('frameworks-ts');
    assert.ok(f.exposures.length > 0);
    for (const e of f.exposures) assert.ok(e.interception !== undefined, `${e.at.file}:${e.at.line}`);
    const chat = f.exposures.filter((e) => e.via.startsWith('chat.completions.create'));
    assert.deepEqual(chat.map((e) => e.interception), chat.map(() => ({ kind: 'K4', name: "the application's own dispatcher", present: true })));
    assert.deepEqual(f.exposures.find((e) => e.via.startsWith('bindTools'))?.interception, { kind: 'K1', name: 'a wrapToolCall middleware', present: false });
    assert.deepEqual(get('example-shape').exposures.find((e) => e.via.startsWith('streamText'))?.interception, { kind: 'K1', name: 'a toolApproval function on the model call', present: false });
  });

  it('Claude Agent SDK: a PreToolUse hook on this call is present, with its place; a call without one is not', () => {
    const q = get('fw-claude-agent-sdk-ts').exposures.filter((e) => e.via === 'query({ options })').sort((a, b) => a.at.line - b.at.line).map((e) => [e.at.line, e.interception]);
    assert.deepEqual(q, [
      [6, { kind: 'K1', name: 'a PreToolUse hook', present: true, at: { file: 'src/agent.ts', line: 11, col: 7 } }],
      [24, { kind: 'K1', name: 'a PreToolUse hook', present: false }],
    ]);
  });

  it('Mastra: requireApproval on a tool is the tool\'s own approval step', () => {
    const t = get('fw-mastra-ts').tools.find((x) => x.name === 'refundOrder');
    assert.equal(t?.interception?.kind, 'K2');
    assert.equal(t?.interception?.name, 'requireApproval on this tool');
    assert.equal(t?.interception?.present, true);
  });

  it('structured output: the schemas are listed, and none is a tool', () => {
    const f = get('fw-instructor-ts');
    assert.deepEqual(f.structured_output?.map((s) => [s.name, s.at.line]), [['RefundDecision', 14], ['RefundDecision', 22], ['refund_decision', 25]]);
    assert.deepEqual(f.tools.map((t) => t.name), ['refund_order']);
    assert.ok(f.not_seen.some((l) => l.includes('structured-output schema(s)')), 'the honesty line stays');
  });
});

describe('Python front end', () => {
  const c = new Map<string, CodeCatalog>();
  before(async () => {
    assert.ok((await findPython()) !== null, 'no python3 >= 3.9 on PATH');
    for (const d of ['frameworks-py', 'fw-agent-framework-py', 'fw-semantic-kernel-py', 'fw-instructor-py']) c.set(d, await scanPython(fx(d)));
  });
  const get = (d: string): CodeCatalog => {
    const x = c.get(d);
    assert.ok(x !== undefined, d);
    return x;
  };

  it('every exposure carries its framework\'s point', () => {
    const f = get('frameworks-py');
    assert.ok(f.exposures.length > 0);
    for (const e of f.exposures) assert.ok(e.interception !== undefined, `${e.at.file}:${e.at.line}`);
    assert.deepEqual(f.exposures.find((e) => e.at.file === 'crewai_app.py')?.interception, { kind: 'K1', name: 'a before_tool_call hook', present: false });
    assert.ok(f.exposures.filter((e) => e.at.file === 'anthropic_tools.py').every((e) => e.interception?.kind === 'K4' && e.interception.present));
  });

  it('Agent Framework: middleware= on the agent is present at its place; approval_mode is each tool\'s own step, off when never_require', () => {
    const f = get('fw-agent-framework-py');
    assert.deepEqual(f.exposures.map((e) => [e.at.file, e.at.line, e.interception?.kind, e.interception?.present]), [
      ['af_agent.py', 48, 'K1', true],
      ['af_agent.py', 55, 'K1', false],
      ['af_agent.py', 58, 'K1', false],
      ['autogen_agent.py', 19, 'K3', false],
    ]);
    assert.deepEqual(f.exposures[0]?.interception?.at, { file: 'af_agent.py', line: 52, col: 16 });
    const own = Object.fromEntries(f.tools.filter((t) => t.interception !== undefined).map((t) => [t.name, t.interception?.present]));
    assert.deepEqual(own, { lookup_order: false, refund_order: true });
  });

  it('Semantic Kernel: a kernel filter in the file is present; a file without one is not', () => {
    const f = get('fw-semantic-kernel-py');
    assert.deepEqual(f.exposures.map((e) => [e.at.file, e.interception?.present]), [['assistant.py', true], ['assistant.py', true], ['prompts.py', false]]);
  });

  it('structured output: Instructor response models are listed, and none is a tool', () => {
    const f = get('fw-instructor-py');
    assert.deepEqual(f.structured_output?.map((s) => s.name), ['OrderSummary', 'OrderSummary', 'ShelfTag', 'OrderSummary']);
    assert.ok(!f.tools.some((t) => ['OrderSummary', 'ShelfTag'].includes(t.name)));
  });

  it('the guard refuses an interception outside the closed set', () => {
    const doc = (kind: string): unknown => ({ python_files: 0, files_read: 0, syntax_errors: 0, tools: [], dispatchers: [], gates: [], not_seen: [], exposures: [{ at: { file: 'a.py', line: 1, col: 1 }, via: 'x', kind: 'static', tools: [], note: '', interception: { kind, name: 'x', present: true } }] });
    assert.equal(parsePyScanOutput(doc('K9')), null);
    assert.equal(parsePyScanOutput(doc('K1'))?.exposures[0]?.interception?.kind, 'K1');
  });
});
