/**
 * The Python front end of `ziffer-scan --code` (ACP-455) over
 * `fixtures/code/frameworks-py/`: one file per detection signature, an Instructor decoy
 * that must yield NO tools, and a hand-written tool_use dispatcher with three callers.
 *
 * Each per-file assertion names the tools exactly, so a signature that stops matching
 * turns its file red by count, and a signature that over-matches turns it red by name.
 * These tests run the real walker under the machine's python3; with none on PATH the
 * suite would be testing the fallback, so it refuses to pretend (`before`).
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { CodeCatalog, CodeTool } from '../types.js';
import { PY_SCRIPT, findPython, isPyScanOutput, parsePyScanOutput, scanPython } from './index.js';

const FIX = fileURLToPath(new URL('../../../fixtures/code/frameworks-py/', import.meta.url));
const BROKEN = fileURLToPath(new URL('../../../fixtures/code/broken-py/', import.meta.url));

/** The framework ids this front end may emit; each must be in data/code-sdks.json (the integrator's check). */
const EMITTED_IDS = new Set(['anthropic', 'openai', 'gemini', 'langchain', 'openai-agents', 'pydantic-ai', 'crewai', 'mcp', 'mistral', 'cohere']);

let catalog: CodeCatalog;

before(async () => {
  const py = await findPython();
  assert.ok(py !== null, 'no python3 >= 3.9 on PATH: these tests exercise the real walker and cannot run without one');
  catalog = await scanPython(FIX);
});

function toolsIn(file: string): CodeTool[] {
  return catalog.tools.filter((t) => t.defined_at.file === file);
}

/** [name, params, sdk, a phrase `via` must contain] for every tool the file defines, in source order. */
function expectFile(file: string, expected: [string, string[], string, string][]): void {
  const got = toolsIn(file);
  assert.deepEqual(
    got.map((t) => t.name),
    expected.map((e) => e[0]),
    `${file}: tool names`,
  );
  for (const [name, params, sdk, via] of expected) {
    const t = got.find((x) => x.name === name);
    assert.ok(t !== undefined, `${file}: ${name} missing`);
    assert.deepEqual(t.params, params, `${file}: ${name} params`);
    assert.equal(t.sdk, sdk, `${file}: ${name} sdk`);
    assert.ok(t.via.includes(via), `${file}: ${name} via "${t.via}" lacks "${via}"`);
  }
}

describe('scanPython over fixtures/code/frameworks-py', () => {
  it('anthropic: name + input_schema dicts on messages.create, @beta_tool on the tool runner', () => {
    expectFile('anthropic_tools.py', [
      ['get_weather', ['location', 'unit'], 'anthropic', 'name + input_schema'],
      ['add_numbers', ['left', 'right'], 'anthropic', '@beta_tool from anthropic'],
      ['send_email', ['to', 'subject', 'body'], 'anthropic', 'name + input_schema'],
    ]);
    const add = toolsIn('anthropic_tools.py').find((t) => t.name === 'add_numbers');
    assert.equal(add?.description, 'Adds two integers together.');
    assert.ok(add?.execute_at !== undefined, 'a decorated function carries its execute body');
  });

  it('openai: Chat (nested) and Responses (flat) dicts, pydantic_function_tool, an OpenAI-compatible client', () => {
    expectFile('openai_tools.py', [
      ['get_stock_price', ['symbol'], 'openai', 'Chat Completions'],
      ['GetDeliveryDate', ['order_id'], 'openai', 'pydantic_function_tool'],
      ['get_horoscope', ['sign'], 'openai', 'Responses'],
      ['delete_file', ['path'], 'openai', 'OpenAI-compatible'],
    ]);
    const compat = catalog.exposures.filter((e) => e.at.file === 'openai_tools.py' && e.via.includes('OpenAI-compatible'));
    assert.deepEqual(compat.map((e) => e.tools), [['delete_file']]);
  });

  it('gemini: bare functions under automatic function calling, a FunctionDeclaration; an unlisted helper is not a tool', () => {
    expectFile('gemini_tools.py', [
      ['get_current_weather', ['location'], 'gemini', 'automatic function calling'],
      ['schedule_meeting', ['attendees', 'date', 'time'], 'gemini', 'automatic function calling'],
      ['set_light_values', ['brightness', 'color_temp'], 'gemini', 'FunctionDeclaration'],
    ]);
    const exps = catalog.exposures.filter((e) => e.at.file === 'gemini_tools.py');
    assert.deepEqual(exps.map((e) => e.tools), [['get_current_weather', 'schedule_meeting'], ['set_light_values']]);
  });

  it('langchain: @tool, @tool("name"), StructuredTool.from_function, BaseTool, a bare function in create_agent', () => {
    expectFile('langchain_tools.py', [
      ['search', ['query'], 'langchain', '@tool from langchain_core.tools'],
      ['calculator', ['expression'], 'langchain', '@tool from langchain_core.tools'],
      ['multiply', ['a', 'b'], 'langchain', 'StructuredTool.from_function'],
      ['delete_record', ['record_id', 'confirm'], 'langchain', 'BaseTool subclass'],
      ['lookup_invoice', ['invoice_id'], 'langchain', 'bare function'],
    ]);
    const vias = catalog.exposures.filter((e) => e.at.file === 'langchain_tools.py').map((e) => e.via);
    assert.equal(vias.length, 3);
    assert.ok(vias[0]?.startsWith('create_agent'));
    assert.ok(vias[1]?.includes('bind_tools'));
    assert.ok(vias[2]?.startsWith('ToolNode'));
  });

  it('openai-agents: @function_tool, @tool from agents.decorators with name_override, FunctionTool; a hosted tool is not a tool', () => {
    expectFile('openai_agents_tools.py', [
      ['get_weather', ['city'], 'openai-agents', '@function_tool from agents'],
      ['fetch_data', ['path', 'directory'], 'openai-agents', '@tool from agents.decorators'],
      ['issue_refund', ['order_id', 'amount'], 'openai-agents', 'FunctionTool'],
    ]);
    const agent = catalog.exposures.find((e) => e.at.file === 'openai_agents_tools.py');
    assert.equal(agent?.kind, 'static');
    assert.deepEqual(agent?.tools, ['get_weather', 'fetch_data', 'issue_refund']);
    assert.ok(catalog.not_seen.some((l) => l.startsWith('provider-executed tools') && l.includes('openai_agents_tools.py')));
  });

  it('pydantic-ai: @agent.tool (ctx dropped), @agent.tool_plain, Tool(fn), a bare function, a FunctionToolset', () => {
    expectFile('pydantic_ai_tools.py', [
      ['roll_dice', [], 'pydantic-ai', '@agent.tool_plain'],
      ['get_player_name', [], 'pydantic-ai', '@agent.tool on a pydantic_ai Agent'],
      ['list_accounts', [], 'pydantic-ai', 'bare function'],
      ['get_default_language', [], 'pydantic-ai', 'FunctionToolset'],
      ['transfer_funds', ['account', 'amount'], 'pydantic-ai', 'Tool(fn)'],
    ]);
    const exps = catalog.exposures.filter((e) => e.at.file === 'pydantic_ai_tools.py');
    assert.deepEqual(exps.map((e) => e.tools), [
      ['roll_dice', 'get_player_name'],
      ['transfer_funds', 'list_accounts', 'get_default_language'],
    ]);
  });

  it('crewai: @tool("Name"), a BaseTool subclass, a prebuilt crewai_tools class', () => {
    expectFile('crewai_app.py', [
      ['Check build status', ['build_id'], 'crewai', '@tool from crewai.tools'],
      ['custom_search', ['query'], 'crewai', 'BaseTool subclass from crewai'],
      ['FileWriterTool', [], 'crewai', 'prebuilt tool class from crewai_tools'],
    ]);
  });

  it('mcp: MCPServer @server.tool() with ToolAnnotations recorded as claims, fastmcp @app.tool; run() is the exposure', () => {
    expectFile('mcp_server.py', [
      ['get_invoice', ['invoice_id'], 'mcp', 'served to a model over MCP'],
      ['void_invoice', ['invoice_id', 'reason'], 'mcp', 'served to a model over MCP'],
      ['ping', ['host'], 'mcp', 'FastMCP from fastmcp'],
    ]);
    const voidTool = toolsIn('mcp_server.py').find((t) => t.name === 'void_invoice');
    assert.equal(voidTool?.description, 'Void an invoice. (claims: readOnlyHint=False, destructiveHint=True)');
    const run = catalog.exposures.find((e) => e.at.file === 'mcp_server.py');
    assert.deepEqual(run?.tools, ['get_invoice', 'void_invoice']);
    assert.ok(run?.via.startsWith('server.run('));
  });

  it('mistral: the OpenAI Chat dict on chat.complete, chat.stream and agents.complete, under its own id', () => {
    expectFile('mistral_tools.py', [
      ['retrieve_payment_status', ['transaction_id'], 'mistral', 'on a Mistral client'],
      ['refund_payment', ['transaction_id', 'amount'], 'mistral', 'on a Mistral client'],
    ]);
    const exps = catalog.exposures.filter((e) => e.at.file === 'mistral_tools.py');
    assert.deepEqual(exps.map((e) => e.via.split('(')[0]), ['chat.complete', 'chat.stream', 'agents.complete']);
  });

  it('cohere: ClientV2 chat/chat_stream with the dict or ToolV2, and v1 parameter_definitions, under its own id', () => {
    expectFile('cohere_tools.py', [
      ['query_daily_sales_report', ['day'], 'cohere', 'on a Cohere ClientV2'],
      ['query_product_catalog', ['category'], 'cohere', 'ToolV2(function=ToolV2Function'],
      ['send_invoice', ['customer_id'], 'cohere', 'on a Cohere ClientV2'],
      ['query_inventory', ['sku'], 'cohere', 'Cohere v1 chat'],
    ]);
    const exps = catalog.exposures.filter((e) => e.at.file === 'cohere_tools.py');
    assert.deepEqual(exps.map((e) => e.tools), [['query_daily_sales_report', 'query_product_catalog'], ['send_invoice'], ['query_inventory']]);
  });

  it('instructor: response models are structured output, NOT tools', () => {
    assert.deepEqual(toolsIn('instructor_decoy.py'), []);
    assert.deepEqual(catalog.exposures.filter((e) => e.at.file === 'instructor_decoy.py'), []);
    assert.ok(catalog.not_seen.includes('instructor response models are structured output, not tools; 2 skipped (Invoice, User)'));
  });

  it('dispatcher: the if/elif over tool names, its three callers, the tools that delegate to it, and the permission gate', () => {
    assert.equal(catalog.dispatchers.length, 1);
    const d = catalog.dispatchers[0];
    assert.ok(d !== undefined);
    assert.equal(d.name, 'execute_tool');
    assert.equal(d.signature, '(tool_name, tool_input)');
    assert.deepEqual(d.at, { file: 'dispatcher.py', line: 23, col: 1 });
    assert.deepEqual(d.callers.map((c) => c.line), [37, 42, 46]);
    // ACP-481: execute_tool is ALSO passed block.name and block.input from the loop over a
    // messages.create reply (line 37), so it takes every bodiless Anthropic tool of the tree:
    // anthropic_tools.py's two dict tools as well as the three its if/elif names. The
    // @beta_tool add_numbers has its own run body and stays out.
    assert.equal(d.tools_delegating, 5);
    const delegating = catalog.tools.filter((t) => t.delegates_to === 'execute_tool').map((t) => t.name);
    assert.deepEqual(delegating, ['get_weather', 'send_email', 'lookup_order', 'refund_order', 'cancel_subscription']);

    assert.deepEqual(catalog.gates.map((g) => g.name), ['tools_for']);
    assert.ok(catalog.gates[0]?.note.includes('permissions.allows()'));
    const exp = catalog.exposures.find((e) => e.at.file === 'dispatcher.py');
    assert.equal(exp?.kind, 'computed');
    assert.deepEqual(exp?.tools, ['lookup_order', 'refund_order', 'cancel_subscription']);
    assert.ok(exp?.note.includes('tools_for'));
  });

  it('the catalog: root, package_name and sdks from pyproject.toml, counts, ids', () => {
    assert.equal(catalog.root, FIX);
    assert.equal(catalog.package_name, 'acme-support-agent');
    assert.deepEqual(catalog.sdks, [
      { name: 'anthropic', version: '>=1.8.0' },
      { name: 'openai', version: '==3.19.2' },
      { name: 'google-genai', version: '>=2.25' },
      { name: 'langchain-core', version: '~=1.6' },
      { name: 'openai-agents', version: '>=0.22' },
      { name: 'pydantic-ai', version: '>=2.51' },
      { name: 'crewai', version: '>=1.15' },
      { name: 'mcp', version: '>=2.2' },
      { name: 'instructor', version: '*' },
    ]);
    assert.equal(catalog.files_read, 12);
    assert.equal(catalog.tools.length, 38);
    assert.deepEqual(catalog.syntax_only, { found: 38, missed: 0 });
    for (const t of catalog.tools) assert.ok(EMITTED_IDS.has(t.sdk), `${t.name}: sdk ${t.sdk} is not an id this front end declares`);
  });
});

describe('the walker, run directly', () => {
  it('prints one JSON document the guard accepts, and the guard is not vacuous', async () => {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('python3', [PY_SCRIPT, FIX], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err === null ? resolve(out) : reject(err)));
    });
    const doc: unknown = JSON.parse(stdout);
    assert.ok(isPyScanOutput(doc));
    const parsed = parsePyScanOutput(doc);
    assert.equal(parsed?.tools.length, 38);
    // A guard that accepts anything proves nothing: break one nested field and watch it refuse.
    const broken: unknown = JSON.parse(stdout.replace('"schema_kind": "json_schema"', '"schema_kind": "yaml"'));
    assert.equal(isPyScanOutput(broken), false);
    const noLine: unknown = JSON.parse(stdout.replace(/"line": \d+/, '"line": 0'));
    assert.equal(isPyScanOutput(noLine), false);
  });

  it('counts a syntax error, names the file, and keeps reading the rest', async () => {
    const c = await scanPython(BROKEN);
    assert.deepEqual(c.tools.map((t) => t.name), ['ok']);
    assert.equal(c.files_read, 1);
    assert.deepEqual(c.not_seen, [
      '1 Python files could not be parsed (syntax error) and were not read: bad.py',
      // Since 2026-09-28 the walker follows each tool's run function for tools it runs, and states how far.
      "a tool running another tool is looked for from each tool's run function into the application's own functions, at most 4 calls deep, by name or through a tools map; a tool reached deeper, through a method on an object the scan cannot type, a callback or a value passed in is not reported",
    ]);
  });
});

describe('no interpreter', () => {
  it('with PATH emptied: no throw, no tools, and the not_seen line says why', async () => {
    const saved = process.env['PATH'];
    process.env['PATH'] = '';
    let c: CodeCatalog;
    try {
      c = await scanPython(FIX);
    } finally {
      process.env['PATH'] = saved;
    }
    assert.deepEqual(c.tools, []);
    assert.equal(c.files_read, 0);
    assert.deepEqual(c.not_seen, ['12 Python files present, not read: no python3 on PATH']);
    // The manifests are read by Node, so the declared SDKs are still reported.
    assert.equal(c.sdks.length, 9);
  });
});
