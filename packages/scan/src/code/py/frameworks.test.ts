/**
 * The Python front end of `ziffer-scan --code` over the frameworks the ACP-455 record
 * researched after milestone 1 (record sections 3.3, 3.9, 3.11, 3.14-3.17, 3.21): one
 * fixture directory per framework, `fixtures/code/fw-<id>-py/`, each written in the shape
 * the framework's own source or documentation shows, with invented names only.
 *
 * Each test names the tools exactly, so a signature that stops matching turns red by
 * count and one that over-matches turns red by name; each fixture carries a decoy the
 * signature must NOT take (a same-named decorator from another package, a method of the
 * same name on another client).
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { CodeCatalog, CodeTool } from '../types.js';
import { loadCodeSdks } from '../sdks.js';
import { findPython, scanPython } from './index.js';

const fixture = (id: string): string => fileURLToPath(new URL(`../../../fixtures/code/fw-${id}-py/`, import.meta.url));

const catalogs = new Map<string, CodeCatalog>();

async function scan(id: string): Promise<CodeCatalog> {
  const hit = catalogs.get(id);
  if (hit !== undefined) return hit;
  const c = await scanPython(fixture(id));
  catalogs.set(id, c);
  return c;
}

before(async () => {
  const py = await findPython();
  assert.ok(py !== null, 'no python3 >= 3.9 on PATH: these tests exercise the real walker and cannot run without one');
});

/** [name, params, a phrase `via` must contain] for every tool in the catalog, in tree order; every tool carries `sdk`. */
function expectTools(c: CodeCatalog, sdk: string, expected: [string, string[], string][]): CodeTool[] {
  assert.deepEqual(c.tools.map((t) => t.name), expected.map((e) => e[0]), 'tool names');
  for (const [name, params, via] of expected) {
    const t = c.tools.find((x) => x.name === name);
    assert.ok(t !== undefined, `${name} missing`);
    assert.deepEqual(t.params, params, `${name} params`);
    assert.equal(t.sdk, sdk, `${name} sdk`);
    assert.ok(t.via.includes(via), `${name}: via "${t.via}" lacks "${via}"`);
  }
  // The id is one the data file names: the report looks every tool's framework up there.
  assert.ok(loadCodeSdks().some((e) => e.id === sdk), `${sdk} is not an id in data/code-sdks.json`);
  return c.tools;
}

function tool(c: CodeCatalog, name: string): CodeTool {
  const t = c.tools.find((x) => x.name === name);
  assert.ok(t !== undefined, `${name} missing`);
  return t;
}

describe('Amazon Bedrock Converse (record 3.9)', () => {
  it('toolSpec + inputSchema.json dicts, one returned by a function in another module; converse and converse_stream are the exposures', async () => {
    const c = await scan('bedrock');
    expectTools(c, 'bedrock', [
      ['lookup_order', ['order_id'], 'Bedrock Converse'],
      ['refund_order', ['order_id', 'amount'], 'Bedrock Converse'],
    ]);
    assert.equal(tool(c, 'refund_order').defined_at.file, 'order_specs.py');
    assert.equal(tool(c, 'lookup_order').description, 'Look up an order by id.');
    // K4: the SDK runs nothing, so no tool carries a run function; the dispatcher is the application's.
    assert.ok(c.tools.every((t) => t.execute_at === undefined));
    assert.deepEqual(c.exposures.map((e) => [e.at.line, e.kind, e.tools]), [
      [24, 'static', ['lookup_order', 'refund_order']],
      [32, 'static', ['lookup_order']],
    ]);
    assert.ok(c.exposures.every((e) => e.via.includes('the application dispatches')));
    // `converse` on a chime-sdk-messaging client is not a model call.
    assert.equal(c.exposures.filter((e) => e.at.line > 45).length, 0);
    assert.deepEqual(c.dispatchers.map((d) => [d.name, d.tools_delegating]), [['run_tool', 2]]);
  });
});

describe('Claude Agent SDK (record 3.3)', () => {
  it('@tool(name, description, schema) from claude_agent_sdk in three schema forms; built-in tools named in options; LangChain @tool stays LangChain', async () => {
    const c = await scan('claude-agent-sdk');
    const own = c.tools.filter((t) => t.sdk === 'claude-agent-sdk' && t.via.startsWith('@tool'));
    assert.deepEqual(own.map((t) => [t.name, t.params, t.schema_kind]), [
      ['lookup_order', ['order_id'], 'json_schema'],
      ['refund_order', ['order_id', 'amount'], 'json_schema'],
      ['restock_title', ['isbn', 'copies'], 'json_schema'],
    ]);
    assert.ok(own.every((t) => t.execute_at !== undefined && t.via.includes('PreToolUse')));
    // ToolAnnotations are claims, recorded and never relied on.
    assert.equal(tool(c, 'refund_order').description, 'Refund an order. (claims: readOnlyHint=False, destructiveHint=True)');
    assert.deepEqual(tool(c, 'refund_order').authority_claims?.map((a) => a.name), ['annotations']);
    // The same bare name `tool` imported from langchain_core is LangChain's.
    assert.equal(tool(c, 'shelf_note').sdk, 'langchain');
    // Built-in tools: one entry per name, `Bash(git status:*)` read as Bash, `mcp__shop__*` left to its server.
    const builtin = c.tools.filter((t) => t.via.startsWith('built-in')).map((t) => t.name);
    assert.deepEqual(builtin, ['Read', 'Bash', 'Grep', 'Write']);
    assert.deepEqual(c.exposures.map((e) => [e.via.split('(')[0], e.kind, e.tools]), [
      ['ClaudeAgentOptions', 'static', ['lookup_order', 'refund_order', 'restock_title', 'Read', 'Bash']],
      ['AgentDefinition', 'static', ['Grep']],
      ['ClaudeAgentOptions', 'static', ['Write']],
    ]);
    assert.ok(c.exposures[0]?.note.includes('PreToolUse hook is the interception point, K1'));
    assert.ok(c.exposures[2]?.note.includes('no hooks= or can_use_tool='));
    // An in-process SDK server is read, not reported as a runtime MCP fetch; options without tools= are.
    assert.ok(!c.not_seen.some((l) => l.startsWith('tools fetched at runtime from an MCP server')));
    assert.ok(c.not_seen.some((l) => l.startsWith('ClaudeAgentOptions without tools=') && l.includes('assistant.py:27')));
    assert.deepEqual(c.sdks, [{ name: 'claude-agent-sdk', version: '>=0.2.160' }, { name: 'langchain-core', version: '~=1.6' }]);
  });
});

describe('Microsoft Agent Framework and AutoGen AgentChat (record 3.14)', () => {
  it('@tool with approval_mode, FunctionTool (with func, declaration only, AutoGen positional), bare functions; Agent, as_agent and AssistantAgent are the exposures', async () => {
    const c = await scan('agent-framework');
    expectTools(c, 'agent-framework', [
      ['lookup_order', ['order_id'], "approval_mode='never_require': runs without an approval"],
      ['refund_order', ['order_id', 'amount'], "approval_mode='always_require': the framework pauses for an approval before it runs, K2"],
      ['shelf_location', ['isbn'], '@tool from agent_framework'],
      ['gift_wrap', ['order_id', 'paper'], 'bare function in tools='],
      ['restock_title', ['isbn', 'copies'], 'FunctionTool(func=...) from agent_framework'],
      ['current_time', [], 'declaration only'],
      ['loyalty_points', ['customer_id'], 'bare function in tools='],
      ['cancel_order', ['order_id'], 'AutoGen AgentChat'],
    ]);
    assert.equal(tool(c, 'current_time').execute_at, undefined);
    assert.equal(tool(c, 'cancel_order').description, 'Cancel an order before it ships.');
    // The application's own `tool` function and a strands import decorate nothing here.
    assert.equal(c.tools.find((t) => t.name === 'not_a_tool'), undefined);
    assert.deepEqual(c.exposures.map((e) => [e.at.file, e.via.split('(')[0], e.tools]), [
      ['af_agent.py', 'Agent', ['lookup_order', 'refund_order', 'shelf_location', 'gift_wrap', 'restock_title']],
      ['af_agent.py', 'as_agent', ['current_time']],
      ['af_agent.py', 'Agent', []],
      ['autogen_agent.py', 'AssistantAgent', ['cancel_order', 'loyalty_points']],
    ]);
    assert.ok(c.exposures[0]?.note.includes('middleware= is registered here'));
    assert.ok(c.exposures[1]?.note.includes('no middleware= is registered here'));
    assert.ok(c.exposures[3]?.note.includes('(K3)'));
    assert.ok(c.not_seen.some((l) => l.startsWith('provider-executed tools') && l.includes('af_agent.py:58')));
  });
});

describe('AG2, legacy autogen and ag2 1.x (record 3.14)', () => {
  it('register_for_llm with its executor, register_function, functions=, @tool with middleware, Agent(tools=), @agent.tool; autogen_core is not AG2', async () => {
    const c = await scan('ag2');
    const ag2 = c.tools.filter((t) => t.sdk === 'ag2');
    assert.deepEqual(ag2.map((t) => [t.name, t.params]), [
      ['lookup_order', ['order_id']],
      ['refund_order', ['order_id', 'amount']],
      ['restock_title', ['isbn', 'copies']],
      ['shelf_location', ['isbn']],
      ['gift_wrap', ['order_id', 'paper']],
      ['loyalty_points', ['customer_id']],
      ['cancel_order', ['order_id']],
    ]);
    assert.ok(ag2.every((t) => t.execute_at !== undefined));
    assert.ok(tool(c, 'lookup_order').via.includes('run by till, registered for execution there (K3'));
    assert.ok(tool(c, 'refund_order').via.includes('the executor is registered elsewhere'));
    assert.equal(tool(c, 'refund_order').description, 'Refund an order.');
    assert.ok(tool(c, 'restock_title').via.includes('caller=clerk, executor=till'));
    assert.ok(tool(c, 'gift_wrap').via.includes('per-tool interception slot'));
    assert.ok(tool(c, 'cancel_order').via.startsWith('@desk.tool on an ag2 Agent'));
    // `autogen_core` is Microsoft AutoGen, whose id is agent-framework: the `autogen` root must not swallow it.
    assert.equal(tool(c, 'ping').sdk, 'agent-framework');
    assert.deepEqual(c.exposures.map((e) => [e.at.file, e.at.line, e.tools]), [
      ['legacy_desk.py', 8, ['lookup_order', 'refund_order']],
      ['legacy_desk.py', 28, ['restock_title']],
      ['legacy_desk.py', 36, ['shelf_location']],
      ['new_desk.py', 16, ['gift_wrap', 'loyalty_points', 'cancel_order']],
    ]);
    assert.ok(c.exposures[0]?.via.includes('the functions decorated on clerk'));
    assert.ok(c.exposures[3]?.note.includes('middleware= is registered here'));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools created inside a library') && l.includes('legacy_desk.py:41 toolkit.register_for_llm')));
    assert.ok(loadCodeSdks().some((e) => e.id === 'ag2'));
  });
});

describe('Semantic Kernel (record 3.15)', () => {
  it('@kernel_function on plugin classes (kernel-filled parameters dropped); add_plugin and an agent\'s plugins= are the exposures; filters are read', async () => {
    const c = await scan('semantic-kernel');
    expectTools(c, 'semantic-kernel', [
      ['lookup_order', ['order_id'], 'on plugin class OrderPlugin'],
      ['refund_order', ['order_id', 'amount'], 'on plugin class OrderPlugin'],
      ['shelf_location', ['isbn'], 'on plugin class ShelfPlugin'],
    ]);
    assert.equal(tool(c, 'shelf_location').description, 'Where a title is shelved.');
    assert.ok(c.tools.every((t) => t.execute_at !== undefined));
    assert.deepEqual(c.exposures.map((e) => [e.at.file, e.at.line, e.kind, e.tools]), [
      ['assistant.py', 9, 'static', ['lookup_order', 'refund_order']],
      ['assistant.py', 18, 'static', ['shelf_location']],
      ['prompts.py', 9, 'static', []],
    ]);
    assert.ok(c.exposures[0]?.note.includes('a kernel filter is registered in this file'));
    assert.ok(c.exposures[2]?.note.includes('no kernel filter is registered in this file'));
    const lib = c.not_seen.find((l) => l.startsWith('tools created inside a library'));
    assert.ok(lib?.includes('prompts.py:5 add_plugin(parent_directory=...)') && lib.includes('prompts.py:9 TimePlugin'), lib);
  });
});

describe('Haystack (record 3.16)', () => {
  it('@tool, create_tool_from_function, Tool(function=); Agent(tools=Toolset([...]), hooks=) and ToolInvoker; a prebuilt integration tool is named', async () => {
    const c = await scan('haystack');
    const hs = c.tools.filter((t) => t.sdk === 'haystack');
    assert.deepEqual(hs.map((t) => [t.name, t.params]), [
      ['lookup_order', ['order_id']],
      ['refund_order', ['order_id', 'amount']],
      ['gift_wrap', ['order_id', 'paper']],
      ['restock_title', ['isbn', 'copies']],
    ]);
    assert.ok(hs.every((t) => t.execute_at !== undefined));
    assert.equal(tool(c, 'refund_order').description, 'Refund an order.');
    // mcp.types.Tool is the MCP SDK's, not Haystack's.
    assert.equal(tool(c, 'shelf_notes').sdk, 'mcp');
    assert.deepEqual(c.exposures.map((e) => [e.via.split('(')[0], e.kind, e.tools]), [
      ['Agent', 'static', ['lookup_order', 'refund_order', 'gift_wrap']],
      ['ToolInvoker', 'static', ['restock_title']],
      ['Agent', 'static', ['lookup_order']],
    ]);
    assert.ok(c.exposures[0]?.note.includes('hooks= is registered on this Agent'));
    assert.ok(c.exposures[1]?.note.startsWith("ToolInvoker RUNS the model's calls"));
    assert.ok(c.exposures[2]?.note.includes('no hooks= on this Agent'));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools created inside a library') && l.includes('LedgerViewerTool')));
  });
});

describe('Google Agent Development Kit (record 3.21)', () => {
  it('bare functions (ToolContext dropped), FunctionTool with require_confirmation, AgentTool, a relative import in a package __init__; google_search and McpToolset named', async () => {
    const c = await scan('adk');
    const adk = c.tools.filter((t) => t.sdk === 'adk');
    assert.deepEqual(adk.map((t) => [t.name, t.params]), [
      ['lookup_order', ['order_id']],
      ['refund_order', ['order_id', 'amount']],
      ['searcher', ['request']],
      ['restock_title', ['isbn', 'copies']],
    ]);
    assert.ok(tool(c, 'refund_order').via.includes('require_confirmation=True: ADK pauses for a confirmation before it runs, K2'));
    assert.ok(tool(c, 'searcher').via.startsWith('AgentTool(agent=searcher)'));
    assert.equal(tool(c, 'searcher').description, 'Searches the web.');
    assert.equal(tool(c, 'restock_title').execute_at?.file, 'shop/desk/stock.py');
    // google.genai is Gemini, not ADK.
    assert.equal(tool(c, 'shelf_location').sdk, 'gemini');
    const adkExp = c.exposures.filter((e) => e.via.includes('google.adk'));
    assert.deepEqual(adkExp.map((e) => [e.at.line, e.kind, e.tools]), [
      [22, 'static', []],
      [26, 'static', ['lookup_order', 'refund_order', 'searcher']],
    ]);
    assert.ok(adkExp[1]?.note.includes('before_tool_callback= is registered on this agent'));
    assert.ok(adkExp[0]?.note.includes('no before_tool_callback='));
    assert.ok(c.not_seen.some((l) => l.startsWith('provider-executed tools') && l.includes('agent.py:22')));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools fetched at runtime from an MCP server') && l.includes('agent.py:29')));
  });
});

describe('Strands Agents (record 3.21)', () => {
  it('@tool (context dropped), a module-based TOOL_SPEC tool, a strands_tools prebuilt, MCPClient named; a bare function is not a tool; imports resolve beside the importer', async () => {
    const c = await scan('strands');
    expectTools(c, 'strands', [
      ['lookup_order', ['order_id'], '@tool from strands'],
      ['refund_order', ['order_id', 'amount'], '@tool from strands'],
      ['shell', [], 'prebuilt tool from strands_tools'],
      ['count_stock', ['isbn'], '@tool from strands'],
      ['reserve_copy', ['isbn', 'customer_id'], '@tool from strands'],
      ['restock_title', ['isbn', 'copies'], 'module-based tool'],
    ]);
    assert.equal(tool(c, 'restock_title').execute_at?.file, 'shop_tools/restock_title.py');
    assert.equal(tool(c, 'shell').execute_at, undefined);
    assert.deepEqual(c.exposures.map((e) => [e.at.file, e.kind, e.tools]), [
      ['agent.py', 'static', ['lookup_order', 'refund_order', 'restock_title', 'shell']],
      ['desk_b/main.py', 'static', ['reserve_copy']],
    ]);
    assert.ok(c.exposures[0]?.note.includes('hooks= or plugins= is registered on this agent'));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools fetched at runtime from an MCP server') && l.includes('agent.py:36')));
  });
});

describe('LlamaIndex (record 3.11)', () => {
  it('FunctionTool.from_defaults (fn positional or keyword, fn_schema), QueryEngineTool, bare functions; FunctionAgent, AgentWorkflow.from_tools_or_functions, CodeActAgent', async () => {
    const c = await scan('llamaindex');
    expectTools(c, 'llamaindex', [
      ['gift_wrap', ['order_id', 'paper'], 'bare function in tools='],
      ['refund_order', ['order_id', 'amount'], 'FunctionTool.from_defaults(fn)'],
      ['search_catalog', ['input'], 'QueryEngineTool'],
      ['lookup_order', ['order_id'], 'FunctionTool.from_defaults(fn)'],
    ]);
    assert.ok(tool(c, 'refund_order').via.includes('K3: wrap fn before from_defaults'));
    assert.equal(tool(c, 'search_catalog').execute_at, undefined);
    assert.deepEqual(c.exposures.map((e) => [e.via.split('(')[0], e.kind, e.tools]), [
      ['FunctionAgent', 'static', ['lookup_order', 'refund_order', 'search_catalog']],
      ['AgentWorkflow.from_tools_or_functions', 'static', ['gift_wrap']],
      ['CodeActAgent', 'static', ['lookup_order']],
    ]);
    assert.ok(c.exposures[0]?.note.includes('no pre-execution hook'));
    assert.ok(c.exposures[2]?.note.includes('inside generated code'));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools called from code the model writes') && l.includes('agent.py:32 CodeActAgent')));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools created inside a library') && l.includes('ShelfToolSpec()')));
  });
});

describe('smolagents (record 3.21)', () => {
  it('@tool, a Tool subclass (inputs + forward), a prebuilt tool class; ToolCallingAgent and CodeAgent, the latter said to call tools from generated code', async () => {
    const c = await scan('smolagents');
    expectTools(c, 'smolagents', [
      ['lookup_order', ['order_id'], '@tool from smolagents'],
      ['refund_order', ['order_id', 'amount'], 'Tool subclass from smolagents'],
      ['WebSearchTool', [], 'prebuilt tool class from smolagents'],
    ]);
    assert.equal(tool(c, 'lookup_order').description, 'Look up an order by id.');
    assert.equal(tool(c, 'refund_order').execute_at?.line, 24);
    assert.deepEqual(c.exposures.map((e) => [e.via.split('(')[0], e.kind, e.tools]), [
      ['ToolCallingAgent', 'static', ['lookup_order', 'refund_order']],
      ['CodeAgent', 'static', ['lookup_order', 'WebSearchTool']],
      ['CodeAgent', 'computed', []],
    ]);
    assert.ok(c.exposures[0]?.note.includes('K3: wrap each tool'));
    assert.ok(c.exposures[1]?.note.includes('inside generated code') && c.exposures[1].note.includes('add_base_tools=True'));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools called from code the model writes') && l.includes('agent.py:37 CodeAgent')));
    assert.ok(c.not_seen.some((l) => l.startsWith('tools fetched at runtime from an MCP server') && l.includes('agent.py:43')));
  });
});

describe('DSPy (record 3.21)', () => {
  it('dspy.Tool(func, name=, desc=), bare functions; ReAct and CodeAct (tools positional or keyword); a helper never handed over is not a tool', async () => {
    const c = await scan('dspy');
    expectTools(c, 'dspy', [
      ['lookup_order', ['order_id'], 'bare function in tools='],
      ['refund_order', ['order_id', 'amount'], 'dspy.Tool(func'],
    ]);
    assert.equal(tool(c, 'refund_order').description, 'Refund an order.');
    assert.deepEqual(c.exposures.map((e) => [e.via.split('(')[0], e.tools]), [
      ['dspy.ReAct', ['lookup_order', 'refund_order']],
      ['dspy.CodeAct', ['lookup_order']],
    ]);
    assert.ok(c.not_seen.some((l) => l.includes('DSPy CodeAct') && l.includes('program.py:22 CodeAct')));
  });
});

describe('Instructor and structured output, an exclusion (record 3.17)', () => {
  it('response_model=, an instructor schema in the tool channel, and parse(response_format=) are NOT tools, and the result says which were skipped', async () => {
    const c = await scan('instructor');
    assert.deepEqual(c.tools, []);
    assert.deepEqual(c.exposures.map((e) => [e.at.line, e.tools]), [[23, []]]);
    assert.ok(c.exposures[0]?.note.includes('ShelfTag is an instructor structured-output schema handed over in the tool channel: nothing executes, not a tool'));
    assert.ok(c.not_seen.includes('instructor response models are structured output, not tools; 2 skipped (OrderSummary, ShelfTag)'));
    assert.ok(c.not_seen.includes('schemas passed as response_format= / text_format= to parse() are structured output, not tools; 1 skipped (OrderSummary)'));
    assert.deepEqual(c.sdks, [{ name: 'instructor', version: '>=1.17' }, { name: 'openai', version: '>=3.19' }]);
  });
});

describe('Semantic Kernel process steps (record 3.15; semantic_kernel 1.44.1 kernel_process_step.py)', () => {
  it('a @kernel_function in a class deriving from KernelProcessStep, directly or through the application\'s own step, is a step of a process: counted and said, never a tool', async () => {
    const c = await scan('sk-steps');
    // The decoy: an application class that happens to be named KernelProcessStep is not Semantic Kernel's.
    expectTools(c, 'semantic-kernel', [
      ['find_shelf', ['isbn'], '@kernel_function from semantic_kernel'],
      ['open_desk', [], '@kernel_function from semantic_kernel'],
    ]);
    assert.deepEqual(c.not_seen.filter((l) => l.includes('steps of a process')), [
      'Semantic Kernel: 3 functions are steps of a process, run by the process and not offered to a model, so not listed as tools (@kernel_function in a class deriving from KernelProcessStep: base.py:8, more.py:7, steps.py:18)',
    ]);
  });
});
