#!/usr/bin/env python3
"""
ziffer-scan --code, the Python front end (ACP-455).

Reads a tree of Python source with Python's own `ast` and prints ONE JSON
document on stdout: the tools the code defines for a model, where they are
handed to a model, the functions they run through, and the runtime conditions
that narrow them. The Node side (`src/code/py/index.ts`) validates the document
with a type guard and folds it into a `CodeCatalog`.

It never imports the libraries it recognises: it reads source. Every rule
below is a signature from the research record
(acp docs/design/acp-455-tool-calling-surfaces.md, section 3), and a module is
attributed to a framework ONLY through its imports, because `tool` is the name
of a decorator in five frameworks and a bare name identifies none of them.

Standard library only; Python 3.9 or later.
"""

import ast
import builtins
import collections
import gc
import json
import os
import re
import sys
import warnings
from typing import Dict, FrozenSet, List, Optional, Set, Tuple

SKIP_DIRS = {
    ".venv", "venv", "node_modules", "site-packages", "__pycache__", ".git", ".hg", ".svn",
    "build", "dist", ".tox", ".nox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".eggs",
    ".pnpm-store", ".next", ".turbo", ".cache",
}
NESTED_CHECKOUT = "a nested git worktree or submodule checkout (a directory holding a .git file)"
# Test code is walked past and counted, as in the TypeScript front end: a test
# defines throwaway tools to exercise the application, and none is what a model is given.
TEST_DIRS = {"__tests__", "test", "tests", "spec", "specs"}


def is_test_file(fn: str) -> bool:
    return fn == "conftest.py" or (fn.startswith("test_") and fn.endswith(".py")) or fn.endswith("_test.py")
MAX_FILE_BYTES = 2 * 1024 * 1024

# Longest root first: `langchain_core` must not be read as `langchain`'s child,
# and `crewai_tools` must win over `crewai`.
FRAMEWORK_ROOTS = [
    ("google.adk", "adk"),
    ("google.generativeai", "gemini"),
    ("google.genai", "gemini"),
    ("langchain_community", "langchain"),
    ("langchain_core", "langchain"),
    ("langchain", "langchain"),
    ("langgraph", "langchain"),
    ("crewai_tools", "crewai"),
    ("crewai", "crewai"),
    ("pydantic_ai", "pydantic-ai"),
    ("claude_agent_sdk", "claude-agent-sdk"),
    # Microsoft Agent Framework and its predecessor AutoGen AgentChat (record 3.14): one id,
    # `agent-framework`, in data/code-sdks.json. `autogen_core` is not the legacy `autogen`.
    ("agent_framework", "agent-framework"),
    ("autogen_agentchat", "agent-framework"),
    ("autogen_core", "agent-framework"),
    ("autogen_ext", "agent-framework"),
    # AG2 (record 3.14): the legacy `autogen` line (ConversableAgent, register_for_llm), its
    # `autogen.beta` API, and `ag2` 1.x, which is that API as its own package. One id, `ag2`.
    ("autogen", "ag2"),
    ("semantic_kernel", "semantic-kernel"),
    ("haystack_integrations", "haystack"),
    # Strands Agents (record 3.21); `strands_tools` is its package of prebuilt tools.
    ("strands_tools", "strands"),
    ("llama_index", "llamaindex"),
    ("smolagents", "smolagents"),
    ("dspy", "dspy"),
    ("strands", "strands"),
    ("haystack", "haystack"),
    ("ag2", "ag2"),
    ("anthropic", "anthropic"),
    ("instructor", "instructor"),
    ("fastmcp", "mcp"),
    ("openai", "openai"),
    ("agents", "openai-agents"),
    ("mcp", "mcp"),
    ("mistralai", "mistral"),
    ("cohere", "cohere"),
]

# Native SDKs that take the OpenAI Chat tool dict on their own call sites. The dict is
# registered as `openai` when read (its shape says nothing else) and relabelled to the
# client's id once every exposure listing it is that client's (`relabel_native`).
NATIVE_OPENAI_SHAPE = {
    "mistral": 'tools[] {"type": "function", "function": {...}} on a Mistral client (mistralai)',
    "cohere": 'tools[] {"type": "function", "function": {...}} on a Cohere ClientV2 (cohere)',
}

# Exposures whose SDK accepts a plain Python function in `tools=[...]` and makes
# it a tool (Gemini automatic function calling, Pydantic AI, LangChain's
# create_agent/bind_tools/ToolNode). OpenAI Agents and CrewAI need a decorator.
BARE_FUNCTION_SDKS = {"gemini", "pydantic-ai", "langchain", "agent-framework", "ag2", "adk", "llamaindex", "dspy"}
# (Strands needs `@tool` or a module-based tool: a bare function in Agent(tools=) is not one.)
BARE_FUNCTION_VIA = {
    "gemini": "bare function in tools= (automatic function calling)",
    "pydantic-ai": "bare function in Agent(tools=[...]) (pydantic_ai)",
    "langchain": "bare function in tools= (LangChain converts it)",
    "agent-framework": "bare function in tools= (Agent Framework / AutoGen AgentChat wraps it as a FunctionTool)",
    "ag2": "bare function in functions= / tools= (AG2 registers it as a tool)",
    "adk": "bare function in Agent(tools=[...]) (Google ADK wraps it as a FunctionTool)",
    "llamaindex": "bare function in tools= (LlamaIndex wraps it as a FunctionTool; K3: wrap the function)",
    "dspy": "bare function in tools= (DSPy wraps it as a dspy.Tool; no hook, K3: wrap the function)",
}
# Google ADK tools the provider runs (record 3.21): Gemini grounding and search, K5.
ADK_HOSTED = {"google_search", "url_context", "enterprise_web_search", "enterprise_web_search_tool",
              "google_maps_grounding", "VertexAiSearchTool", "DiscoveryEngineSearchTool", "BuiltInCodeExecutor"}
# ADK toolsets whose tools come from a document or a service at runtime.
ADK_GENERATED = {"APIHubToolset", "ApiRegistry", "OpenAPIToolset", "ApplicationIntegrationToolset", "BigQueryToolset",
                 "SpannerToolset", "BigtableToolset"}

CONTEXT_ANNOTATIONS = {"RunContext", "RunContextWrapper", "ToolContext", "Context"}

DISPATCH_MARKERS = {"tool_use", "function_call", "tool_calls", "function_calls"}

# ACP-481: the model call whose reply carries tool requests the application runs itself.
# A receiver counts only when it resolves to one of these client classes of that SDK.
REPLY_CLIENTS = {"anthropic": ("Anthropic", "AsyncAnthropic"), "openai": ("OpenAI", "AsyncOpenAI")}
# (sdk, the method chain after the client, what it returns): `messages.stream` returns a
# stream whose `get_final_message()` is the reply.
REPLY_CALLS = (
    ("anthropic", ("messages", "create"), "messages"),
    ("anthropic", ("messages", "stream"), "stream"),
    ("openai", ("chat", "completions", "create"), "chat"),
    ("openai", ("responses", "create"), "responses"),
)
# Per reply kind, the member a tool request names its tool by and the one carrying its
# input (on Chat Completions both are on the request's `.function`).
REQUEST_MEMBERS = {"messages": ("name", "input"), "chat": ("name", "arguments"), "responses": ("name", "arguments")}

HOSTED_TOOL_CLASSES = {
    "WebSearchTool", "FileSearchTool", "CodeInterpreterTool", "ImageGenerationTool",
    "HostedMCPTool", "ComputerTool", "LocalShellTool", "ShellTool", "ApplyPatchTool",
}
MCP_CLIENT_CLASSES = {
    "MCPServerStdio", "MCPServerSse", "MCPServerStreamableHttp", "MultiServerMCPClient",
    "MCPServerStdioParams",
    # Agent Framework's MCP tools and AutoGen's MCP workbench: the server names the tools.
    "MCPStdioTool", "MCPStreamableHTTPTool", "MCPWebsocketTool", "McpWorkbench",
    # Semantic Kernel's MCP plugins.
    "MCPStdioPlugin", "MCPSsePlugin", "MCPStreamableHttpPlugin", "MCPWebsocketPlugin",
}
TOOLKIT_CALLS = {"load_tools", "get_tools"}
# Agent Framework chat-client factories for tools the PROVIDER runs (record 3.14, K5).
AF_HOSTED_FACTORIES = {"get_mcp_tool", "get_code_interpreter_tool", "get_web_search_tool", "get_file_search_tool",
                       "get_image_generation_tool", "get_maps_grounding_tool"}

# The names a tool definition uses to CLAIM an authority rule (`CodeTool.authority_claims`),
# and the names a caller of a dispatcher tests when it asks a person first
# (`CallerCheck.check`). Matched whole, in the source's spelling: `confirmed_at` is not
# `confirmed`, because a timestamp written after the fact asks nobody anything.
# ONE list for both front ends: `data/code-sdks.json`, the file `code/sdks.ts` loads.
# A copy here was a second definition of the same fact, and the two had already
# drifted by one name before they were ever merged. Unreadable data means no name
# matches and nothing is reported, which `load_framework_packages` does too.
def load_check_names() -> Dict[str, FrozenSet[str]]:
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "code-sdks.json"),
                  "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {}
    out: Dict[str, FrozenSet[str]] = {}
    for key in ("authority_claim_names", "confirmation_names"):
        v = doc.get(key, []) if isinstance(doc, dict) else []
        out[key] = frozenset(x for x in v if isinstance(x, str))
    return out


CHECK_NAMES = load_check_names()


# Where a check can stand before a framework's tools run (`Exposure.interception`,
# `CodeTool.interception`): the `interception` entries of data/code-sdks.json, the table the
# TypeScript front end reads too (src/code/interception.ts). Same rules on both sides: K4
# is present (the application runs every call), K3 is not (no wrap is looked for), K1/K2
# are present when one of the framework's markers is written in the handing-over file,
# unless a recogniser read the hook on the call itself.
def load_interception() -> Dict[str, Dict[str, object]]:
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "code-sdks.json"),
                  "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return {}
    out: Dict[str, Dict[str, object]] = {}
    for e in doc.get("frameworks", []) if isinstance(doc, dict) else []:
        p = e.get("interception") if isinstance(e, dict) else None
        if isinstance(p, dict) and isinstance(p.get("kind"), str) and isinstance(p.get("name"), str):
            out[str(e.get("id"))] = {
                "kind": p["kind"], "name": p["name"],
                "markers": [x for x in p.get("markers", []) if isinstance(x, str)],
                "tool_flags": [x for x in p.get("tool_flags", []) if isinstance(x, str)],
            }
    return out


INTERCEPTION = load_interception()


def load_claude_builtins() -> Tuple[str, str, FrozenSet[str]]:
    """data/claude-agent-builtins.json: (version, date read, names), the built-in tool names the
    Claude Agent SDK's current version defines; the file the TypeScript front end reads too."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "claude-agent-builtins.json"),
                  "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return "", "", frozenset()
    names = doc.get("names", []) if isinstance(doc, dict) else []
    return (str(doc.get("version", "")), str(doc.get("read", "")),
            frozenset(n for n in names if isinstance(n, str)))


CLAUDE_BUILTINS = load_claude_builtins()
# A per-tool flag written off, as written: the tool runs without the pause.
FLAG_OFF = re.compile(r"^[\"']?(false|False|None|null|never|never_require)[\"']?$")


def point(kind: str, name: str, present: bool, at: Optional[Dict[str, object]] = None) -> Dict[str, object]:
    out: Dict[str, object] = {"kind": kind, "name": name, "present": present}
    if present and at is not None:
        out["at"] = at
    return out


def marker_node(tree: ast.AST, markers: List[str]) -> Optional[ast.AST]:
    """The first node (in source order) where a marker is written as code: a name, an attribute,
    a keyword argument, a function's name, or a string equal to it. Imports are not registrations."""
    want = set(markers)
    best: Optional[ast.AST] = None
    for n in ast.walk(tree):
        hit = ((isinstance(n, ast.Name) and n.id in want) or (isinstance(n, ast.Attribute) and n.attr in want)
               or (isinstance(n, ast.keyword) and n.arg in want and hasattr(n, "lineno"))
               or (isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want)
               or (isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value in want))
        if hit and (best is None or (getattr(n, "lineno", 0), getattr(n, "col_offset", 0)) <
                    (getattr(best, "lineno", 0), getattr(best, "col_offset", 0))):
            best = n
    return best

# How far below a tool's run function the scan follows calls into the application's own
# functions when it looks for a tool run without the dispatcher (`CodeTool.calls`).
CALL_DEPTH = 4
# The methods that RUN a tool object (a LangChain tool, a CrewAI or LangChain BaseTool,
# an OpenAI Agents FunctionTool) or a callable taken from a tools map.
RUN_METHODS = {"run", "_run", "arun", "_arun", "invoke", "ainvoke", "func", "coroutine",
               "on_invoke_tool", "execute", "call", "__call__"}
# A mapping read as a TOOLS map by its name when its value cannot be read (`TOOLS`,
# `tool_map`, `self.registry`).
TOOL_MAP_NAME = re.compile(r"tool|registry", re.IGNORECASE)
# Keys under which a tool definition holds its PARAMETERS: a parameter named
# `needs_approval` is an input the model fills, not a claim the application makes.
SCHEMA_KEYS = {"input_schema", "inputSchema", "parameters", "parameters_json_schema", "properties",
               "params_json_schema", "args_schema", "parameter_definitions"}
STUB_WORD = re.compile(r"\bstub\b", re.IGNORECASE)

# ---- ACP-460: the application's code loads a skill ------------------------------------
# Python's own lists for this pass, kept here rather than in a data file: they name Python
# calls and keyword arguments, which no other reader of this package consults.
# The text files a load can name. Nothing else is text for this purpose: a `.json` or `.yaml`
# a program reads is configuration, and treating it as a skill would fill the inventory.
TEXT_EXTS = (".md", ".mdx", ".mdc", ".txt", ".prompt")
# The instruction files an assistant loads by name, as `skills/index.ts` INSTRUCTION_FILES and
# COPILOT_FILE spell them (only those with a text extension can be named by a load here).
INSTRUCTION_NAMES = {"CLAUDE.md", "AGENTS.md", "GEMINI.md"}
COPILOT_FILE = ".github/copilot-instructions.md"
MAX_TEXT_BYTES = 1024 * 1024
# `embedded`: at least this many consecutive characters of a file's body in one string literal,
# whitespace runs collapsed on both sides; a body shorter than it must appear whole, and a body
# shorter than EMBED_SHORT is never matched (a line that short is a phrase, not a file).
EMBED_MIN = 200
EMBED_SHORT = 40
# The index: per body, one EMBED_BLOCK window every EMBED_STRIDE characters, moved to the first
# word start in its stride; a literal is probed only at its word starts. Any common run of
# EMBED_MIN characters holds one such window whole while no word in it is longer than
# EMBED_MIN - EMBED_STRIDE - EMBED_BLOCK (40) characters: a longer "word" (a hash, a URL) can
# hide a match, which is a miss, never a false entry.
EMBED_STRIDE = 80
EMBED_BLOCK = 80
# Keyword arguments that make text a model's instructions, per recognised constructor or call.
CTOR_INSTRUCTION_KWS = {
    ("openai-agents", "Agent"): ("Agent(...) from agents", {"instructions"}),
    ("pydantic-ai", "Agent"): ("Agent(...) from pydantic_ai", {"system_prompt", "instructions"}),
    ("crewai", "Agent"): ("Agent(...) from crewai", {"backstory", "goal"}),
    ("langchain", "create_agent"): ("create_agent(...) (LangChain)", {"system_prompt"}),
    ("langchain", "create_react_agent"): ("create_react_agent(...) (LangGraph)", {"prompt", "state_modifier", "system_prompt"}),
    ("gemini", "GenerateContentConfig"): ("GenerateContentConfig(...) (google-genai)", {"system_instruction"}),
    ("gemini", "GenerativeModel"): ("GenerativeModel(...) (google-generativeai)", {"system_instruction"}),
}
METHOD_INSTRUCTION_KWS = {"anthropic": {"system"}, "openai": {"instructions"}, "gemini": {"system_instruction"},
                          "mistral": set(), "cohere": set()}
SYSTEM_ROLES = ("system", "developer")
LANGCHAIN_RUNS = {"invoke", "ainvoke", "stream", "astream", "batch", "abatch", "from_messages"}
# Calls whose result is the same text, rearranged: the value is followed through them.
TEXT_FUNCS = {"str", "dedent", "cleandoc", "strip", "lstrip", "rstrip", "format", "join", "replace",
              "format_map", "safe_substitute", "substitute", "decode"}
CONTAINER_ADDS = {"append", "extend", "insert", "add"}
OPEN_CALLS = {"io.open", "codecs.open", "aiofiles.open", "builtins.open"}
RESOURCE_READS = {
    "importlib.resources.read_text", "importlib.resources.open_text", "importlib.resources.read_binary",
    "importlib_resources.read_text", "importlib_resources.open_text", "importlib_resources.read_binary",
    "pkgutil.get_data", "pkg_resources.resource_string", "pkg_resources.resource_stream",
}
RESOURCE_FILES = {"importlib.resources.files", "importlib_resources.files"}
WILD = "*"


class PathValue:
    """What a path expression can be: absolute patterns (`*` and `**` are wildcards), whether a
    literal directory under its base was written before any wildcard (`lit`: a bare `*.md`
    relative to an unknown working directory names nothing the scan can own), and whether it
    came from a package's resources (`importlib.resources.files`)."""
    __slots__ = ("pats", "lit", "res", "wild")

    def __init__(self, pats: List[str], lit: bool, res: bool = False, wild: bool = False):
        self.pats = pats
        self.lit = lit
        self.res = res
        self.wild = wild

    def map(self, f) -> "PathValue":  # type: ignore[no-untyped-def]
        return PathValue([f(p) for p in self.pats], self.lit, self.res, self.wild)


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def front_matter(text: str) -> Tuple[Set[str], str]:
    """The front matter's keys and the body after it (the whole text when there is none):
    the reading of `skills/index.ts` frontMatter."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return set(), text
    keys: Set[str] = set()
    for i in range(1, len(lines)):
        raw = lines[i].rstrip("\r")
        if raw.strip() == "---":
            return keys, "\n".join(lines[i + 1:])
        mk = re.match(r"^([A-Za-z][\w-]*)\s*:", raw)
        if mk:
            keys.add(mk.group(1))
    return keys, ""


def glob_match(pat: List[str], path: List[str]) -> bool:
    """Segment-wise match: `**` is zero or more segments, any other segment is fnmatch'd."""
    import fnmatch
    if not pat:
        return not path
    if pat[0] == "**":
        return any(glob_match(pat[1:], path[i:]) for i in range(len(path) + 1))
    return bool(path) and fnmatch.fnmatchcase(path[0], pat[0]) and glob_match(pat[1:], path[1:])


def body_nodes(fn: ast.AST) -> List[ast.AST]:
    """Every node of a function's body in source order, NOT descending into a nested
    def or class: those run only when something calls them, and a tool defined inside
    a factory is its own tool, not a call the factory makes."""
    out: List[ast.AST] = []
    stack: List[ast.AST] = list(reversed(getattr(fn, "body", [])))
    while stack:
        node = stack.pop()
        out.append(node)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        stack.extend(reversed(list(ast.iter_child_nodes(node))))
    out.sort(key=lambda n: (getattr(n, "lineno", 0), getattr(n, "col_offset", 0)))
    return out


def name_read(node: ast.AST) -> Optional[str]:
    """The name an expression reads: `x`, `obj.x`, `obj["x"]`, `obj.get("x")`."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return const_str(node.slice)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args:
        return const_str(node.args[0])
    return None


# The PyPI (and npm) names a tool-calling framework publishes, read from the
# package's own data/code-sdks.json (the one list; the TypeScript side reads it
# too). A module whose nearest manifest names one of them is the FRAMEWORK's source,
# not the customer's: `from agents.decorators import tool` inside the OpenAI Agents
# SDK's own repository must still read as the framework, not as a local module.
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "code-sdks.json")
APPLICATION_SEGMENTS = {"examples", "example", "demo", "demos", "samples", "sample", "cookbook", "cookbooks",
                        "playground", "quickstarts"}


def norm_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())


def load_framework_packages() -> List[str]:
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return []
    out: List[str] = []
    for e in doc.get("frameworks", []) if isinstance(doc, dict) else []:
        if isinstance(e, dict) and e.get("kind") == "framework":
            out.extend(norm_name(p) if not p.startswith("@") else p for p in e.get("packages", []) if isinstance(p, str))
    return out


def is_framework_package(name: str, patterns: List[str]) -> bool:
    n = name if name.startswith("@") else norm_name(name)
    return any((n.startswith(p[:-1]) and len(n) >= len(p)) if p.endswith("*") else n == p for p in patterns)


def manifest_name(path: str) -> Optional[str]:
    """The `name` a Python manifest declares: [project] / [tool.poetry] in pyproject.toml,
    [metadata] in setup.cfg, a literal name= in setup.py. The same reading as the
    TypeScript side's `pythonManifestName`."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return None
    if path.endswith("setup.py"):
        m = re.search(r"""\bname\s*=\s*["']([^"']+)["']""", text)
        return m.group(1) if m else None
    sections = ["metadata"] if path.endswith("setup.cfg") else ["project", "tool.poetry"]
    current = ""
    for raw in text.splitlines():
        line = raw.strip()
        h = re.match(r"^\[([^\]]+)\]$", line)
        if h:
            current = h.group(1).strip()
            continue
        if current not in sections:
            continue
        m = re.match(r"""^name\s*[=:]\s*["']?([^"'\s#]+)["']?""", line)
        if m:
            return m.group(1)
    return None


# Set by `Scan` once the tree is read: True when a dotted name is a module or a
# name defined IN THE TREE. A customer package called `agents` or `mcp` is the
# customer's, not the framework's, and must not turn its functions into tools.
_IS_LOCAL = [lambda q: False]


def framework_of(qual: Optional[str]) -> Optional[str]:
    if not qual:
        return None
    if _IS_LOCAL[0](qual):
        return None
    for root, fw in FRAMEWORK_ROOTS:
        if qual == root or qual.startswith(root + "."):
            return fw
    return None


def last(qual: Optional[str]) -> str:
    return qual.rsplit(".", 1)[-1] if qual else ""


def const_str(node: Optional[ast.AST]) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def kw(call: ast.Call, name: str) -> Optional[ast.expr]:
    for k in call.keywords:
        if k.arg == name:
            return k.value
    return None


def dict_get(d: ast.Dict, key: str) -> Optional[ast.expr]:
    for k, v in zip(d.keys, d.values):
        if const_str(k) == key:
            return v
    return None


def unparse(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001 -- a display string only
        return "<expr>"


def ag2_middleware_via(call: Optional[ast.Call]) -> str:
    """AG2's per-tool `middleware=` (record 3.14): the interception slot on the tool itself."""
    if call is not None and kw(call, "middleware") is not None:
        return " (middleware= on the tool: a per-tool interception slot, K1-shaped)"
    return ""


def approval_via(mode: Optional[str]) -> str:
    """Agent Framework's `approval_mode` (record 3.14): a pause the framework enforces (K2), not a claim."""
    if mode == "always_require":
        return " (approval_mode='always_require': the framework pauses for an approval before it runs, K2)"
    if mode is not None:
        return " (approval_mode=%r: runs without an approval)" % mode
    return ""


def first_paragraph(text: Optional[str]) -> str:
    if not text:
        return ""
    para = text.strip().split("\n\n", 1)[0]
    return " ".join(line.strip() for line in para.splitlines()).strip()


class Module:
    def __init__(self, rel: str, dotted: str, tree: ast.Module, source: str,
                 cells: Optional[List[Tuple[int, int]]] = None):
        self.rel = rel
        self.dotted = dotted
        self.tree = tree
        self.source = source
        # A notebook's code cells are read as ONE module (they share a namespace);
        # `cells[i]` is (cell number, line in that cell) of the module's line i + 1.
        self.cells = cells
        self.imports: Dict[str, str] = {}
        self.local_imports: Set[str] = set()
        self.assigns: Dict[str, ast.expr] = {}
        self.defs: Dict[str, ast.AST] = {}
        self.classes: Dict[str, ast.ClassDef] = {}
        self.parents: Dict[int, ast.AST] = {}
        self.nodes: List[ast.AST] = []
        self._index()

    def _index(self) -> None:
        # A package's `__init__.py` IS its package: `from .x import y` there names `<pkg>.x`, not a sibling
        # of the package. Reading it as the parent's left every relative import of an `__init__` unresolved.
        if self.rel.endswith("__init__.py"):
            pkg = self.dotted
        else:
            pkg = self.dotted.rsplit(".", 1)[0] if "." in self.dotted else ""
        # One walk per module; every pass iterates this list. Re-walking the tree
        # per pass made the stdlib (1,800 files) take 94 s.
        # Breadth-first, the order `ast.walk` yields, recording parents on the way:
        # "the last assignment wins" below depends on that order.
        queue = collections.deque([self.tree])
        while queue:
            node = queue.popleft()
            self.nodes.append(node)
            for child in ast.iter_child_nodes(node):
                self.parents[id(child)] = node
                queue.append(child)
        for node in self.nodes:
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.asname:
                        self.imports[a.asname] = a.name
                    else:
                        top = a.name.split(".", 1)[0]
                        self.imports[top] = top
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    parts = pkg.split(".") if pkg else []
                    if node.level > 1:
                        parts = parts[: len(parts) - (node.level - 1)]
                    base = ".".join([p for p in parts if p] + ([base] if base else []))
                for a in node.names:
                    local = a.asname or a.name
                    self.imports[local] = (base + "." + a.name) if base else a.name
                    if node.level:
                        self.local_imports.add(local)
            elif isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        self.assigns[t.id] = node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                if isinstance(node.target, ast.Name):
                    self.assigns[node.target.id] = node.value
        for node in self.tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.defs[node.name] = node
            elif isinstance(node, ast.ClassDef):
                self.classes[node.name] = node
        # Nested defs are reachable by name too, after module-level ones.
        for node in self.nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.defs.setdefault(node.name, node)
            elif isinstance(node, ast.ClassDef):
                self.classes.setdefault(node.name, node)

    def qual(self, node: Optional[ast.AST]) -> Optional[str]:
        if isinstance(node, ast.Name):
            return self.imports.get(node.id)
        if isinstance(node, ast.Attribute):
            base = self.qual(node.value)
            return base + "." + node.attr if base else None
        return None

    def ref(self, node: ast.AST) -> Dict[str, object]:
        line = getattr(node, "lineno", 1)
        if self.cells is not None and 0 < line <= len(self.cells):
            cell, in_cell = self.cells[line - 1]
            return {"file": "%s#cell-%d" % (self.rel, cell), "line": in_cell,
                    "col": getattr(node, "col_offset", 0) + 1}
        return {"file": self.rel, "line": line, "col": getattr(node, "col_offset", 0) + 1}

    def matches_ref(self, ref: Dict[str, object]) -> Optional[int]:
        """The module line a `ref` of this module names, or None when it is another module's."""
        f = str(ref.get("file", ""))
        line = int(str(ref.get("line", 0)))
        if self.cells is None:
            return line if f == self.rel else None
        if not f.startswith(self.rel + "#cell-"):
            return None
        try:
            cell = int(f[len(self.rel) + len("#cell-"):])
        except ValueError:
            return None
        for i, (c, l) in enumerate(self.cells):
            if c == cell and l == line:
                return i + 1
        return None

    def enclosing_function(self, node: ast.AST) -> Optional[ast.AST]:
        cur = self.parents.get(id(node))
        while cur is not None:
            if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return cur
            cur = self.parents.get(id(cur))
        return None


def notebook_source(text: str) -> Tuple[str, List[Tuple[int, int]]]:
    """The code cells of a notebook as one module, and the cell map. Cells are
    numbered from 1 in the notebook's order (markdown cells counted, so the number
    is the one a reader counts to). IPython magics and shell escapes (`%`, `!`)
    become blank lines; a cell that still does not parse is left out whole, so one
    broken cell does not hide the rest."""
    doc = json.loads(text)
    cells = doc.get("cells", []) if isinstance(doc, dict) else []
    lines: List[str] = []
    cmap: List[Tuple[int, int]] = []
    for number, cell in enumerate(cells, start=1):
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        src = cell.get("source", "")
        if isinstance(src, list):
            src = "".join(str(x) for x in src)
        if not isinstance(src, str):
            continue
        body = [("" if ln.lstrip().startswith(("%", "!")) else ln) for ln in src.split("\n")]
        try:
            compile("\n".join(body), "<cell>", "exec", flags=ast.PyCF_ONLY_AST | getattr(ast, "PyCF_ALLOW_TOP_LEVEL_AWAIT", 0))
        except (SyntaxError, ValueError):
            continue
        for i, ln in enumerate(body, start=1):
            lines.append(ln)
            cmap.append((number, i))
    return "\n".join(lines), cmap


class Scan:
    def __init__(self, root: str):
        self.root = root
        self.modules: List[Module] = []
        self.python_files = 0
        self.syntax_errors: List[str] = []
        self.too_large: List[str] = []
        self.notebooks = 0
        self.test_files = 0
        self.nested_checkouts: List[str] = []
        self.tools: List[Dict[str, object]] = []
        self.tool_by_node: Dict[int, str] = {}
        self.tool_by_def: Dict[Tuple[str, str], str] = {}
        self.tool_index: Dict[str, Dict[str, object]] = {}
        self.exposures: List[Dict[str, object]] = []
        self.dispatchers: List[Dict[str, object]] = []
        self.gates: List[Dict[str, object]] = []
        self.not_seen: List[str] = []
        self.instructor_models: Set[str] = set()
        # OpenAI `.parse(response_format=Model)` / `responses.parse(text_format=Model)`: structured output.
        self.parse_models: Set[str] = set()
        self.structured_in_exposure: List[str] = []
        # `CodeCatalog.structured_output`: schemas recognised and not counted as tools.
        self.structured: List[Dict[str, object]] = []
        # A tool's name for the model written as an expression the scan could not resolve
        # (`given_name`): pending by the node the definition is recorded at, then, per framework,
        # the tools listed under their function's name and the definitions not listed at all.
        self.pending_computed: Dict[int, Tuple[str, str, Dict[str, object], bool]] = {}
        self.computed_names: List[Tuple[str, str, Dict[str, object], str]] = []
        # Semantic Kernel process steps (`is_process_step`): run by a process, not offered to a model.
        self.sk_process_steps: List[str] = []
        # Claude Agent SDK built-in names the SDK's current version does not define (`claude_builtin`).
        self.claude_unknown_builtins: List[str] = []
        self.mcp_client_sites: List[str] = []
        # ClaudeAgentOptions built without `tools=`: the SDK's whole built-in set is available.
        self.claude_default_tools: List[str] = []
        # Agents whose tools are called from Python the model writes (record section 6, item 6).
        self.generated_code_sites: List[str] = []
        # AG2 register_for_llm on a receiver the scan cannot trace to its constructor.
        self.ag2_loose: List[Tuple[Module, ast.AST, str, str]] = []
        self.hosted_sites: List[str] = []
        self.toolkit_sites: List[str] = []
        self.consumed_configs: Set[int] = set()
        # Objects tools are registered ON by decorator (a pydantic_ai Agent or
        # FunctionToolset, an MCP server): (module where built, variable) -> tool names.
        self.registries: Dict[Tuple[str, str], List[str]] = {}
        self._local_cache: Dict[str, bool] = {}
        self._framework_patterns = load_framework_packages()
        self._manifest_cache: Dict[str, Optional[str]] = {}
        self._by_suffix: Optional[Dict[str, Module]] = None
        self._by_dotted: Optional[Dict[str, Module]] = None
        # Every tool's run function: (module, the def, the tool's record), and the def's
        # id -> the tool's name, for `pass_tool_calls`.
        self.tool_runs: List[Tuple[Module, ast.AST, Dict[str, object]]] = []
        self.run_nodes: Dict[int, str] = {}
        self.dispatcher_nodes: Set[int] = set()
        # ACP-460: the text files under the root, and where the code loads them.
        self.text_files: List[str] = []
        self.skill_loads: List[Dict[str, object]] = []

    # ---- reading -------------------------------------------------------
    def read(self) -> None:
        for dirpath, dirnames, filenames in os.walk(self.root):
            kept = []
            for d in sorted(dirnames):
                if d in SKIP_DIRS or d.endswith(".egg-info"):
                    continue
                # A directory holding a `.git` FILE is a linked worktree or a submodule:
                # a second copy of the code, whose tools would be counted twice.
                if os.path.isfile(os.path.join(dirpath, d, ".git")):
                    self.nested_checkouts.append(os.path.relpath(os.path.join(dirpath, d), self.root).replace(os.sep, "/"))
                    continue
                if d in TEST_DIRS:
                    for _dp, _dn, fns in os.walk(os.path.join(dirpath, d)):
                        self.test_files += sum(1 for f in fns if f.endswith((".py", ".ipynb")))
                    continue
                kept.append(d)
            dirnames[:] = kept
            for fn in sorted(filenames):
                notebook = fn.endswith(".ipynb")
                if fn.lower().endswith(TEXT_EXTS):
                    # The text files a skill load can name (ACP-460), from the same walk and
                    # under the same exclusions as the source: read later, and only if needed.
                    self.text_files.append(os.path.relpath(os.path.join(dirpath, fn), self.root).replace(os.sep, "/"))
                    continue
                if not fn.endswith(".py") and not notebook:
                    continue
                if is_test_file(fn):
                    self.test_files += 1
                    continue
                if notebook:
                    self.notebooks += 1
                else:
                    self.python_files += 1
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, self.root).replace(os.sep, "/")
                cells: Optional[List[Tuple[int, int]]] = None
                try:
                    if os.path.getsize(full) > (MAX_FILE_BYTES * 8 if notebook else MAX_FILE_BYTES):
                        self.too_large.append(rel)
                        continue
                    with open(full, "r", encoding="utf-8", errors="replace") as fh:
                        source = fh.read()
                    if notebook:
                        source, cells = notebook_source(source)
                        tree = ast.parse(source, filename=rel)
                    else:
                        tree = ast.parse(source, filename=rel)
                except (SyntaxError, ValueError, OSError):
                    self.syntax_errors.append(rel)
                    continue
                dotted = rel[: -len(".ipynb") if notebook else -3].replace("/", ".")
                if dotted.endswith(".__init__"):
                    dotted = dotted[: -len(".__init__")]
                self.modules.append(Module(rel, dotted, tree, source, cells))

    # ---- resolution across modules -------------------------------------
    def is_local(self, qual: str) -> bool:
        cached = self._local_cache.get(qual)
        if cached is not None:
            return cached
        result = False
        if "." in qual:
            mod, attr = qual.rsplit(".", 1)
            tm = self.module_named(mod)
            if tm is not None and (attr in tm.defs or attr in tm.classes or attr in tm.assigns or attr in tm.imports):
                result = not self.framework_own(tm)
        if not result:
            tm = self.module_named(qual)
            if tm is not None:
                result = not self.framework_own(tm)
        self._local_cache[qual] = result
        return result

    def framework_own(self, m: Module) -> bool:
        """The module is the source of a framework this tree publishes (its nearest
        manifest names a framework package) and not under an examples-like directory."""
        parts = m.rel.split("/")
        if any(seg.lower() in APPLICATION_SEGMENTS for seg in parts[:-1]):
            return False
        d = "/".join(parts[:-1])
        while True:
            if d not in self._manifest_cache:
                found: Optional[str] = None
                for fn in ("pyproject.toml", "setup.cfg", "setup.py"):
                    full = os.path.join(self.root, d, fn) if d else os.path.join(self.root, fn)
                    if os.path.isfile(full):
                        found = manifest_name(full)
                        if found:
                            break
                self._manifest_cache[d] = found
            name = self._manifest_cache[d]
            if name:
                return is_framework_package(name, self._framework_patterns)
            if not d:
                return False
            d = d.rsplit("/", 1)[0] if "/" in d else ""

    def module_named(self, dotted: str) -> Optional[Module]:
        """The module whose dotted path is `dotted` or ends with it (a tree scanned from
        above its import root). Exact match first, then the first by walk order."""
        if self._by_suffix is None:
            self._by_suffix = {}
            for m in self.modules:
                parts = m.dotted.split(".")
                for i in range(len(parts)):
                    self._by_suffix.setdefault(".".join(parts[i:]), m)
            for m in self.modules:
                self._by_suffix[m.dotted] = m
        return self._by_suffix.get(dotted)

    def module_near(self, m: Module, dotted: str) -> Optional[Module]:
        """The module an import in `m` names, looked for beside `m` first, then up its package
        path, then anywhere (`module_named`). A tree of many samples has many `tools.py`; the one
        `from tools import x` means is the importer's neighbour, not the first in walk order."""
        if self._by_dotted is None:
            self._by_dotted = {x.dotted: x for x in self.modules}
        parts = m.dotted.split(".")[:-1] if not m.rel.endswith("__init__.py") else m.dotted.split(".")
        for i in range(len(parts), 0, -1):
            hit = self._by_dotted.get(".".join(parts[:i] + [dotted]))
            if hit is not None:
                return hit
        return self.module_named(dotted)

    def resolve_imported(self, m: Module, name: str) -> Optional[Tuple[Module, str]]:
        """A name imported from a module IN THE TREE: (that module, its local name there)."""
        q = m.imports.get(name)
        if not q or framework_of(q) is not None or "." not in q:
            return None
        mod_name, attr = q.rsplit(".", 1)
        target = self.module_near(m, mod_name)
        if target is None or target is m:
            return None
        return target, attr

    def var_ctor(self, m: Module, name: str, depth: int = 0) -> Optional[Tuple[str, Module, ast.Call]]:
        """What a variable was constructed from: (qualified callee, module, the call)."""
        value = m.assigns.get(name)
        if isinstance(value, ast.Call):
            q = m.qual(value.func)
            if q:
                return q, m, value
        if depth < 3:
            hop = self.resolve_imported(m, name)
            if hop is not None:
                return self.var_ctor(hop[0], hop[1], depth + 1)
        return None

    def resolve_def(self, m: Module, name: str) -> Optional[Tuple[Module, ast.AST]]:
        node = m.defs.get(name)
        if node is not None and name not in m.imports:
            return m, node
        hop = self.resolve_imported(m, name)
        if hop is not None and hop[1] in hop[0].defs:
            return hop[0], hop[0].defs[hop[1]]
        return None

    def resolve_class(self, m: Module, name: str) -> Optional[Tuple[Module, ast.ClassDef]]:
        c = m.classes.get(name)
        if c is not None:
            return m, c
        hop = self.resolve_imported(m, name)
        if hop is not None and hop[1] in hop[0].classes:
            return hop[0], hop[0].classes[hop[1]]
        return None

    def resolve_value(self, m: Module, node: ast.expr, depth: int = 0) -> Tuple[Module, ast.expr]:
        """Follow a Name to the literal it was assigned, within or across modules."""
        while isinstance(node, ast.Name) and depth < 4:
            depth += 1
            if node.id in m.assigns and node.id not in m.imports:
                node = m.assigns[node.id]
                continue
            hop = self.resolve_imported(m, node.id)
            if hop is not None and hop[1] in hop[0].assigns:
                m, node = hop[0], hop[0].assigns[hop[1]]
                continue
            break
        return m, node

    def const_name(self, m: Module, node: Optional[ast.expr], at: Optional[ast.AST] = None) -> Optional[str]:
        """A name written as a constant: a literal; an Enum member or a class attribute
        holding one (`GitTools.STATUS`, `TimeTools.X.value`, `cls.ID` inside the class);
        a variable assigned one."""
        s = const_str(node)
        if s is not None or node is None:
            return s
        if isinstance(node, ast.Attribute) and node.attr == "value" and isinstance(node.value, ast.Attribute):
            node = node.value
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            owner = node.value.id
            found: Optional[Tuple[Module, ast.ClassDef]] = None
            if owner in ("cls", "self") and at is not None:
                cur = m.parents.get(id(at))
                while cur is not None and not isinstance(cur, ast.ClassDef):
                    cur = m.parents.get(id(cur))
                if isinstance(cur, ast.ClassDef):
                    found = (m, cur)
            else:
                # A class nested in an enclosing class (`class Step: class Functions(Enum): ...`),
                # named bare from inside it, as Semantic Kernel's process steps do: the nearest
                # enclosing one first, because two steps in one module each nest their own.
                cur = m.parents.get(id(at)) if at is not None else None
                while found is None and cur is not None:
                    if isinstance(cur, ast.ClassDef):
                        for st in cur.body:
                            if isinstance(st, ast.ClassDef) and st.name == owner:
                                found = (m, st)
                                break
                    cur = m.parents.get(id(cur))
                if found is None:
                    found = self.resolve_class(m, owner)
            if found is not None:
                for st in found[1].body:
                    if isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == node.attr for t in st.targets):
                        return const_str(st.value)
                    if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name) and st.target.id == node.attr:
                        return const_str(st.value)
            return None
        if isinstance(node, ast.Name):
            _vm, v = self.resolve_value(m, node)
            return const_str(v)
        return None

    def computed_names_out(self) -> List[Dict[str, object]]:
        """The names `given_name` could not resolve, as data (`computed_names`): the tools listed
        under their function's name (`listed`), and the definitions not listed for want of a name.
        The Node side filters them by the own-source rule and says them, one line per framework,
        with the same sentence as the TypeScript front end (`computedNameLines`)."""
        out: List[Dict[str, object]] = [{"sdk": sdk, "listed": tname, "at": at, "expr": expr}
                                        for sdk, tname, at, expr in self.computed_names]
        out += [{"sdk": sdk, "at": at, "expr": expr} for sdk, expr, at, sure in self.pending_computed.values() if sure]
        return out

    def given_name(self, m: Module, node: Optional[ast.expr], holder: ast.AST, sdk: str, sure: bool = False) -> Optional[str]:
        """The name the model sees, when the definition gives it as an expression: a literal, or a
        constant, a class attribute or an enum member holding a literal in the scanned tree
        (`Functions.SliceFood`). When it cannot be resolved, None, and the definition at `holder`
        is remembered: the tool is then listed under its function's name and a `not_seen` line
        says its name for the model is computed. Never a silent fallback. `sure`: the node already
        has a tool's shape, so a definition dropped for want of a name is said too."""
        if node is None:
            return None
        v = self.const_name(m, node, holder)
        if v is None:
            self.pending_computed[id(holder)] = (sdk, unparse(node)[:60], m.ref(holder), sure)
        return v

    def enclosing_class_method(self, m: Module, node: ast.AST, names: Tuple[str, ...]) -> Optional[ast.AST]:
        cur = m.parents.get(id(node))
        while cur is not None and not isinstance(cur, ast.ClassDef):
            cur = m.parents.get(id(cur))
        if not isinstance(cur, ast.ClassDef):
            return None
        for st in cur.body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and st.name in names:
                return st
        return None

    # ---- params --------------------------------------------------------
    def function_params(self, fn: ast.AST, skip_context: bool) -> List[str]:
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return []
        a = fn.args
        out: List[str] = []
        positional = list(getattr(a, "posonlyargs", [])) + list(a.args)
        for i, arg in enumerate(positional + list(a.kwonlyargs)):
            if arg.arg in ("self", "cls"):
                continue
            ann = unparse(arg.annotation) if arg.annotation is not None else ""
            base = ann.split("[", 1)[0].rsplit(".", 1)[-1]
            if base in CONTEXT_ANNOTATIONS:
                continue
            if skip_context and i == 0 and arg.arg in ("ctx", "context"):
                continue
            out.append(arg.arg)
        return out

    def class_fields(self, m: Module, cls_expr: ast.expr) -> List[str]:
        if not isinstance(cls_expr, ast.Name):
            return []
        found = self.resolve_class(m, cls_expr.id)
        if found is None:
            return []
        return [
            s.target.id for s in found[1].body
            if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)
            and not s.target.id.startswith("_") and s.target.id != "model_config"
        ]

    def schema_params(self, m: Module, schema: Optional[ast.expr]) -> Tuple[List[str], bool]:
        """Top-level `properties` keys of a literal schema; (params, literal?)."""
        if schema is None:
            return [], False
        m, schema = self.resolve_value(m, schema)
        if isinstance(schema, ast.Dict):
            props = dict_get(schema, "properties")
            if props is not None:
                m, props = self.resolve_value(m, props)
            if isinstance(props, ast.Dict):
                return [k for k in (const_str(x) for x in props.keys) if k is not None], True
            return [], True
        if isinstance(schema, ast.Call):
            props = kw(schema, "properties")
            if isinstance(props, ast.Dict):
                return [k for k in (const_str(x) for x in props.keys) if k is not None], True
            # Model.model_json_schema() / Model.schema()
            if isinstance(schema.func, ast.Attribute) and schema.func.attr in ("model_json_schema", "schema"):
                return self.class_fields(m, schema.func.value), True
        return [], False

    # ---- tools ---------------------------------------------------------
    def add_tool(self, m: Module, node: ast.AST, name: str, sdk: str, via: str, *,
                 description: str = "", params: Optional[List[str]] = None,
                 schema_kind: str = "json_schema", defined_at: Optional[ast.AST] = None,
                 execute: Optional[Tuple[Module, ast.AST]] = None) -> str:
        if id(node) in self.tool_by_node:
            return self.tool_by_node[id(node)]
        pc = self.pending_computed.pop(id(defined_at), None) if defined_at is not None else None
        pc = pc or self.pending_computed.pop(id(node), None)
        if pc is not None:
            self.computed_names.append((pc[0], name, m.ref(defined_at or node), pc[1]))
        tool: Dict[str, object] = {
            "name": name,
            "description": description,
            "schema_kind": schema_kind,
            "params": params or [],
            "sdk": sdk,
            "via": via,
            "defined_at": m.ref(defined_at or node),
        }
        if execute is not None:
            tool["execute_at"] = execute[0].ref(execute[1])
            if isinstance(execute[1], (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.tool_by_def[(execute[0].rel, execute[1].name)] = name
                self.tool_runs.append((execute[0], execute[1], tool))
                self.run_nodes.setdefault(id(execute[1]), name)
        claims = self.authority_claims(node, defined_at)
        if claims:
            tool["authority_claims"] = claims
        own = self.tool_point(sdk, claims, node, defined_at, tool["defined_at"])
        if own is not None:
            tool["interception"] = own
        docs = [description]
        for holder in (node, execute[1] if execute is not None else None):
            if isinstance(holder, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                docs.append(ast.get_docstring(holder) or "")
        if any(STUB_WORD.search(d) for d in docs):
            tool["declared_stub"] = True
        self.tools.append(tool)
        self.tool_by_node[id(node)] = name
        self.tool_index.setdefault(name, tool)
        return name

    @staticmethod
    def tool_point(sdk: str, claims: List[Dict[str, str]], node: ast.AST, defined_at: Optional[ast.AST],
                   at: object) -> Optional[Dict[str, object]]:
        """A tool's own approval step (K2): the first of the framework's `tool_flags` written on the
        definition, from its authority claims or a keyword of the definition's call or decorator
        (`approval_mode=`, `require_confirmation=`, which are framework pauses, not claims)."""
        flags = INTERCEPTION.get(sdk, {}).get("tool_flags", [])
        if not flags:
            return None
        found: Optional[Tuple[str, str]] = None
        for c in claims:
            if c["name"] in flags:
                found = (c["name"], c["value"])
                break
        if found is None:
            holders: List[ast.AST] = [h for h in (defined_at, node) if isinstance(h, ast.Call)]
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                holders += [d for d in node.decorator_list if isinstance(d, ast.Call)]
            for h in holders:
                assert isinstance(h, ast.Call)
                for k in h.keywords:
                    if k.arg in flags:
                        found = (k.arg, unparse(k.value))
                        break
                if found is not None:
                    break
        if found is None:
            return None
        name, value = found
        on = not FLAG_OFF.match(value.strip()) and not (name == "approval_mode" and "always_require" not in value)
        return point("K2", "%s on this tool" % name, on, at if isinstance(at, dict) else None)

    def authority_claims(self, node: ast.AST, defined_at: Optional[ast.AST]) -> List[Dict[str, str]]:
        """The authority-claim names written on a tool's DEFINITION, each with its value as
        written: a decorator's keywords (`@function_tool(needs_approval=True)`), a tool dict's
        keys, a tool constructor's keywords, a tool class's attributes. One level of nesting
        is read (`annotations=ToolAnnotations(...)`, `"function": {...}`); a schema's
        properties are not, because a parameter is the model's input, not a claim."""
        names = CHECK_NAMES["authority_claim_names"]
        out: List[Dict[str, str]] = []
        if isinstance(node, ast.ClassDef):
            for st in node.body:
                target: Optional[str] = None
                value: Optional[ast.expr] = None
                if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
                    target, value = st.targets[0].id, st.value
                elif isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name) and st.value is not None:
                    target, value = st.target.id, st.value
                if target in names and value is not None:
                    out.append({"name": target, "value": unparse(value)})
            return out

        def read(expr: ast.AST, depth: int) -> None:
            pairs: List[Tuple[Optional[str], ast.expr]] = []
            if isinstance(expr, ast.Call):
                pairs = [(k.arg, k.value) for k in expr.keywords]
            elif isinstance(expr, ast.Dict):
                pairs = [(const_str(k), v) for k, v in zip(expr.keys, expr.values) if k is not None]
            for key, value in pairs:
                if key is None or key in SCHEMA_KEYS:
                    continue
                if key in names:
                    out.append({"name": key, "value": unparse(value)})
                elif depth < 1 and isinstance(value, (ast.Call, ast.Dict)):
                    read(value, depth + 1)

        seen: Set[int] = set()
        for holder in (defined_at, node):
            if isinstance(holder, (ast.Call, ast.Dict)) and id(holder) not in seen:
                seen.add(id(holder))
                read(holder, 0)
        return out

    def function_tool(self, m: Module, fn: ast.AST, deco: ast.AST, name: Optional[str], sdk: str,
                      via: str, description: Optional[str], skip_context: bool = False,
                      claims: str = "") -> str:
        doc = first_paragraph(ast.get_docstring(fn)) if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) else ""
        desc = description if description is not None else doc
        if claims:
            desc = (desc + " " + claims).strip()
        return self.add_tool(
            m, fn, name or getattr(fn, "name", "?"), sdk, via,
            description=desc, params=self.function_params(fn, skip_context),
            defined_at=deco, execute=(m, fn),
        )

    def annotations_claims(self, value: Optional[ast.expr]) -> str:
        if value is None:
            return ""
        pairs: List[str] = []
        if isinstance(value, ast.Call):
            pairs = ["%s=%s" % (k.arg, unparse(k.value)) for k in value.keywords if k.arg]
        elif isinstance(value, ast.Dict):
            pairs = ["%s=%s" % (const_str(k), unparse(v)) for k, v in zip(value.keys, value.values) if const_str(k)]
        return "(claims: %s)" % ", ".join(pairs) if pairs else ""

    def pass_decorators(self, m: Module) -> None:
        for fn in m.nodes:
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for deco in fn.decorator_list:
                target = deco.func if isinstance(deco, ast.Call) else deco
                call = deco if isinstance(deco, ast.Call) else None
                q = m.qual(target)
                fw = framework_of(q)
                a0 = call.args[0] if call is not None and call.args else None
                nkw = kw(call, "name") if call is not None else None
                desc_kw = const_str(kw(call, "description")) if call is not None else None
                if fw == "anthropic" and last(q) in ("beta_tool", "beta_async_tool"):
                    self.function_tool(m, fn, deco, self.given_name(m, nkw, deco, "anthropic"),
                                       "anthropic", "@%s from anthropic (tool_runner schema from the signature)" % last(q), desc_kw)
                elif fw == "langchain" and last(q) == "tool":
                    self.function_tool(m, fn, deco, self.given_name(m, a0 if a0 is not None else nkw, deco, "langchain"),
                                       "langchain", "@tool from %s" % q.rsplit(".", 1)[0], desc_kw)
                elif fw == "crewai" and last(q) == "tool":
                    self.function_tool(m, fn, deco, self.given_name(m, a0, deco, "crewai"), "crewai", "@tool from %s" % q.rsplit(".", 1)[0], desc_kw)
                elif fw == "agent-framework" and q.startswith("agent_framework") and last(q) in ("tool", "ai_function"):
                    mode = const_str(kw(call, "approval_mode")) if call is not None else None
                    self.function_tool(m, fn, deco, self.given_name(m, nkw, deco, "agent-framework"), "agent-framework",
                                       "@%s from %s%s" % (last(q), q.rsplit(".", 1)[0], approval_via(mode)), desc_kw)
                elif fw == "ag2" and last(q) == "tool":
                    self.function_tool(m, fn, deco, self.given_name(m, nkw, deco, "ag2"), "ag2",
                                       "@tool from %s%s" % (q.rsplit(".", 1)[0], ag2_middleware_via(call)), desc_kw)
                elif (isinstance(target, ast.Attribute) and target.attr == "register_for_llm"
                      and any(framework_of(v) == "ag2" for v in m.imports.values())):
                    self.ag2_register_for_llm(m, fn, deco, call, target)
                elif fw == "strands" and last(q) == "tool" and not q.startswith("strands_tools"):
                    name = self.given_name(m, nkw, deco, "strands")
                    t = self.function_tool(m, fn, deco, name, "strands",
                                           "@tool from %s (the agent runs it; a BeforeToolCallEvent hook can cancel it, K1)"
                                           % q.rsplit(".", 1)[0],
                                           (const_str(kw(call, "description")) or (const_str(call.args[0]) if call.args else None)) if call else None)
                    ctx = kw(call, "context") if call else None
                    rec = self.tool_index.get(t)
                    if rec is not None and ctx is not None and isinstance(rec.get("params"), list):
                        # `context=True` (or a name) injects a ToolContext the model does not fill.
                        cname = const_str(ctx) or ("tool_context" if isinstance(ctx, ast.Constant) and ctx.value is True else None)
                        rec["params"] = [x for x in rec["params"] if x != cname]
                elif fw == "smolagents" and last(q) == "tool":
                    self.function_tool(m, fn, deco, None, "smolagents",
                                       "@tool from smolagents (schema from the signature and the docstring's Args; "
                                       "no pre-call hook, K3: wrap the function)", None)
                elif fw == "haystack" and last(q) == "tool":
                    self.function_tool(m, fn, deco, self.given_name(m, nkw, deco, "haystack"), "haystack",
                                       "@tool from %s (the Agent's ToolInvoker runs it; a before_tool hook sees it first, K1)"
                                       % q.rsplit(".", 1)[0], desc_kw)
                elif fw == "semantic-kernel" and last(q) == "kernel_function":
                    self.sk_function(m, fn, deco, call)
                elif fw == "claude-agent-sdk" and last(q) == "tool" and call is not None:
                    self.claude_sdk_tool(m, fn, call)
                elif fw == "openai-agents" and last(q) in ("function_tool", "tool"):
                    self.function_tool(m, fn, deco, self.given_name(m, kw(call, "name_override") if call else None, deco, "openai-agents"),
                                       "openai-agents", "@%s from %s" % (last(q), q.rsplit(".", 1)[0]),
                                       const_str(kw(call, "description_override")) if call else None,
                                       skip_context=True)
                elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                    ctor = self.var_ctor(m, target.value.id)
                    if ctor is None:
                        continue
                    cq = ctor[0]
                    cfw = framework_of(cq)
                    if cfw == "pydantic-ai" and last(cq) in ("Agent", "FunctionToolset") and target.attr in ("tool", "tool_plain"):
                        tname = self.function_tool(m, fn, deco, self.given_name(m, nkw, deco, "pydantic-ai"),
                                                   "pydantic-ai", "@%s.%s on a pydantic_ai %s" % (target.value.id, target.attr, last(cq)),
                                                   desc_kw, skip_context=target.attr == "tool")
                        self.registries.setdefault((ctor[1].rel, target.value.id), []).append(tname)
                    elif cfw == "ag2" and target.attr == "tool" and last(cq) == "Agent":
                        tname = self.function_tool(m, fn, deco, self.given_name(m, nkw, deco, "ag2"), "ag2",
                                                   "@%s.tool on an %s Agent%s" % (target.value.id, cq.split(".")[0], ag2_middleware_via(call)),
                                                   desc_kw)
                        self.registries.setdefault((ctor[1].rel, target.value.id), []).append(tname)
                    elif cfw == "mcp" and last(cq) in ("MCPServer", "FastMCP") and target.attr == "tool":
                        name = self.given_name(m, a0 if a0 is not None else nkw, deco, "mcp")
                        claims = self.annotations_claims(kw(call, "annotations")) if call else ""
                        tname = self.function_tool(m, fn, deco, name, "mcp",
                                                   "@%s.tool on %s from %s, served to a model over MCP" % (target.value.id, last(cq), cq.rsplit(".", 1)[0]),
                                                   desc_kw, claims=claims)
                        self.registries.setdefault((ctor[1].rel, target.value.id), []).append(tname)

    def sk_function(self, m: Module, fn: ast.AST, deco: ast.AST, call: Optional[ast.Call]) -> None:
        """`@kernel_function(name=, description=)` from semantic_kernel (record 3.15), usually a method
        of a plugin class. The model sees it as `<plugin>-<name>`; the plugin name is given where the
        plugin is added, so the tool is named by the function. Parameters annotated `Kernel` or
        `KernelArguments` are filled by the kernel, not the model."""
        cls = self.enclosing_class(m, fn)
        if cls is not None and self.is_process_step(m, cls):
            # A step of Semantic Kernel's PROCESS framework: the process runs it on an event,
            # and no model is offered it. Counted and said, never listed as a tool.
            self.sk_process_steps.append("%s:%d" % (m.rel, getattr(deco, "lineno", 0)))
            return
        name = self.given_name(m, kw(call, "name") if call else None, deco, "semantic-kernel")
        tname = self.function_tool(m, fn, deco, name, "semantic-kernel",
                                   "@kernel_function from semantic_kernel%s (the kernel runs it; a function invocation filter "
                                   "sees it first, K1)" % (" on plugin class %s" % cls.name if cls is not None else ""),
                                   const_str(kw(call, "description")) if call else None)
        t = self.tool_index.get(tname)
        if t is not None and isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            skip = {a.arg for a in list(fn.args.args) + list(fn.args.kwonlyargs)
                    if a.annotation is not None and unparse(a.annotation).split("[", 1)[0].rsplit(".", 1)[-1] in
                    ("Kernel", "KernelArguments", "ChatHistory")}
            t["params"] = [p for p in t["params"] if p not in skip] if isinstance(t["params"], list) else t["params"]

    def is_process_step(self, m: Module, cls: ast.ClassDef, depth: int = 0) -> bool:
        """The class derives from Semantic Kernel's `KernelProcessStep` (semantic_kernel 1.44.1,
        semantic_kernel/processes/kernel_process/kernel_process_step.py), directly or through the
        application's own classes (`ExternalStep(KernelProcessStep)`, then a class of that)."""
        if depth > 5:
            return False
        for b in cls.bases:
            base = b.value if isinstance(b, ast.Subscript) else b
            q = m.qual(base)
            if q is not None and framework_of(q) == "semantic-kernel" and last(q) == "KernelProcessStep":
                return True
            if isinstance(base, ast.Name):
                found = self.resolve_class(m, base.id)
                if found is not None and found[1] is not cls and self.is_process_step(found[0], found[1], depth + 1):
                    return True
        return False

    def sk_plugin_names(self, m: Module, e: Optional[ast.expr], out: List[str]) -> bool:
        """The kernel functions of a plugin expression: `Plugin()`, a variable holding one, the class
        itself, or a kernel_function-decorated function. False when the plugin cannot be read."""
        if e is None:
            return False
        vm, v = self.value_of(m, e)
        target: Optional[ast.expr] = v.func if isinstance(v, ast.Call) else v
        tq = vm.qual(target) if isinstance(target, (ast.Name, ast.Attribute)) else None
        if framework_of(tq) == "semantic-kernel":
            # A plugin semantic_kernel ships (TimePlugin, an MCP plugin, an OpenAPI plugin): its
            # functions are the library's, named by the class and not read.
            site = "%s:%d %s" % (vm.rel, getattr(v, "lineno", 0), last(tq))
            (self.mcp_client_sites if "MCP" in last(tq) else self.toolkit_sites).append(site)
            return True
        if isinstance(target, ast.Name):
            found = self.resolve_class(vm, target.id)
            if found is not None:
                n0 = len(out)
                for st in found[1].body:
                    tn = self.run_nodes.get(id(st))
                    if tn is not None:
                        out.append(tn)
                return len(out) > n0
            fdef = self.resolve_def(vm, target.id)
            if fdef is not None and id(fdef[1]) in self.run_nodes:
                out.append(self.run_nodes[id(fdef[1])])
                return True
        if isinstance(v, (ast.List, ast.Tuple)):
            ok = True
            for x in v.elts:
                ok = self.sk_plugin_names(vm, x, out) and ok
            return ok
        return False

    def sk_exposure(self, m: Module, call: ast.Call, via: str, plugins: List[ast.expr]) -> None:
        names: List[str] = []
        ok = True
        for p in plugins:
            ok = self.sk_plugin_names(m, p, names) and ok
        seen: Set[str] = set()
        uniq = [n for n in names if not (n in seen or seen.add(n))]
        filtered = re.search(r"\.add_filter\(|@\w+(\.\w+)*\.filter\(", m.source) is not None
        note = ("the plugin's kernel functions are offered to the model under automatic function calling" if ok else
                "the plugin is computed at runtime; the scan lists the kernel functions it could join back")
        note += ("; a kernel filter is registered in this file (a FUNCTION_INVOCATION or AUTO_FUNCTION_INVOCATION filter "
                 "that does not call next refuses the call, K1)" if filtered else
                 "; no kernel filter is registered in this file (K1 would be a FUNCTION_INVOCATION or AUTO_FUNCTION_INVOCATION filter)")
        fm = re.search(r"\.add_filter\(|@\w+(\.\w+)*\.filter\(", m.source)
        fat = None if fm is None else {"file": m.rel, "line": m.source.count("\n", 0, fm.start()) + 1, "col": 1}
        self.exposures.append({"at": m.ref(call), "via": via, "kind": "static" if ok else "computed", "tools": uniq,
                               "note": note, "_sdk": "semantic-kernel", "_expr": "",
                               "_icpt": point("K1", "a function invocation filter", filtered, fat)})

    def ag2_register_for_llm(self, m: Module, fn: ast.AST, deco: ast.AST, call: Optional[ast.Call],
                             target: ast.Attribute) -> None:
        """`@caller.register_for_llm(description=...)` (AG2 legacy, record 3.14): the caller's model
        is offered the function; the agent that registers it with `register_for_execution` runs it."""
        caller = unparse(target.value)
        executor = None
        for d in getattr(fn, "decorator_list", []):
            t = d.func if isinstance(d, ast.Call) else d
            if isinstance(t, ast.Attribute) and t.attr == "register_for_execution":
                executor = unparse(t.value)
        via = "@%s.register_for_llm (AG2 legacy: %s's model is offered it; %s)" % (
            caller, caller, "run by %s, registered for execution there (K3: wrap it before register_for_execution)" % executor
            if executor else "no register_for_execution on this function: the executor is registered elsewhere")
        tname = self.function_tool(m, fn, deco, self.given_name(m, kw(call, "name") if call else None, deco, "ag2"), "ag2", via,
                                   const_str(kw(call, "description")) if call else None)
        if isinstance(target.value, ast.Name):
            ctor = self.var_ctor(m, target.value.id)
            key = (ctor[1].rel, target.value.id) if ctor is not None else (m.rel, target.value.id)
            self.registries.setdefault(key, []).append(tname)
            if ctor is None:
                self.ag2_loose.append((m, deco, caller, tname))
        else:
            self.ag2_loose.append((m, deco, caller, tname))

    def ag2_exposure(self, m: Module, call: ast.Call, q: str, name: str) -> None:
        """An AG2 agent constructor: `functions=` (legacy ConversableAgent: registered for the LLM),
        `tools=` (`autogen.beta` / `ag2` 1.x Agent), and the functions decorated with
        `@<this agent>.register_for_llm` or `@<this agent>.tool`."""
        expr = kw(call, "functions") if kw(call, "functions") is not None else kw(call, "tools")
        parent = m.parents.get(id(call))
        var = parent.targets[0].id if (isinstance(parent, ast.Assign) and len(parent.targets) == 1
                                         and isinstance(parent.targets[0], ast.Name)) else None
        registered = self.registries.get((m.rel, var), []) if var else []
        if expr is None and not registered:
            return
        shown = "functions=[...]" if kw(call, "functions") is not None else "tools=[...]" if kw(call, "tools") is not None else "..."
        via = "%s(%s) from %s" % (name, shown, q.rsplit(".", 1)[0])
        if registered:
            via += ", and the functions decorated on %s" % var
        exp = self.add_exposure(m, call, via, "ag2", expr)
        for n in registered:
            if n not in exp["tools"]:
                exp["tools"].append(n)
        if kw(call, "middleware") is not None and not (kw(call, "functions") is not None or registered and kw(call, "tools") is None):
            exp["_icpt"] = point("K1", "a middleware on the agent", True, m.ref(kw(call, "middleware")))
        if kw(call, "functions") is not None or registered and kw(call, "tools") is None:
            exp["note"] = str(exp["note"]) + ("; AG2 legacy: the agent that registers a function for execution runs it, and no "
                                              "pre-execution hook is documented (K3: wrap the function before it is registered)")
        elif kw(call, "middleware") is not None:
            exp["note"] = str(exp["note"]) + "; middleware= is registered here (an on_tool_execution middleware sees each call first, K1-shaped)"
        else:
            exp["note"] = str(exp["note"]) + "; the framework runs these tools and no middleware= is registered here"

    def af_exposure(self, m: Module, call: ast.Call, via: str, tools: ast.expr) -> None:
        """Agent Framework / AutoGen AgentChat: the framework runs the tools. The note names the
        interception the source shows: `middleware=` (function middleware refuses a call by not
        calling `call_next`, K1) or none."""
        exp = self.add_exposure(m, call, via, "agent-framework", tools)
        mw = kw(call, "middleware")
        exp["_icpt"] = (point("K3", "a check around each function before it is registered", False)
                        if via.startswith("AssistantAgent") else
                        point("K1", "a function middleware", mw is not None, m.ref(mw) if mw is not None else None))
        if via.startswith("AssistantAgent"):
            exp["note"] = str(exp["note"]) + ("; AutoGen AgentChat runs these tools and documents no pre-execution hook: "
                                              "the interception is wrapping each function before it is registered (K3)")
        elif kw(call, "middleware") is not None:
            exp["note"] = str(exp["note"]) + "; middleware= is registered here (function middleware that does not call call_next() refuses the call, K1)"
        else:
            exp["note"] = str(exp["note"]) + "; the framework runs these tools and no middleware= is registered here"

    def claude_sdk_tool(self, m: Module, fn: ast.AST, call: ast.Call) -> None:
        """`@tool("name", "description", {"arg": type})` from claude_agent_sdk (record 3.3): an
        in-process MCP tool. The schema is a name->type dict, a JSON Schema dict, or a TypedDict
        class; the handler takes one `args` dict, so its signature names no parameter."""
        name = self.given_name(m, call.args[0] if call.args else kw(call, "name"), call, "claude-agent-sdk", True)
        if name is None:
            # A computed name: listed under the function's name, and said (`given_name`).
            name = getattr(fn, "name", None)
        if name is None:
            return
        desc = const_str(call.args[1]) if len(call.args) > 1 else const_str(kw(call, "description"))
        schema = call.args[2] if len(call.args) > 2 else kw(call, "input_schema")
        params: List[str] = []
        kind = "unknown"
        if schema is not None:
            sm, sv = self.resolve_value(m, schema)
            if isinstance(sv, ast.Dict) and (dict_get(sv, "properties") is not None and dict_get(sv, "type") is not None):
                params, literal = self.schema_params(sm, sv)
                kind = "json_schema" if literal else "unknown"
            elif isinstance(sv, ast.Dict):
                params, kind = [k for k in (const_str(x) for x in sv.keys) if k is not None], "json_schema"
            elif isinstance(sv, ast.Name):
                params = self.class_fields(sm, sv)
                kind = "json_schema" if params else "unknown"
        claims = self.annotations_claims(kw(call, "annotations"))
        doc = first_paragraph(ast.get_docstring(fn)) if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) else ""
        description = desc if desc is not None else doc
        if claims:
            description = (description + " " + claims).strip()
        self.add_tool(m, fn, name, "claude-agent-sdk",
                      "@tool from claude_agent_sdk (an in-process MCP tool; the SDK runs it, a PreToolUse hook sees it first)",
                      description=description, params=params, schema_kind=kind, defined_at=call, execute=(m, fn))

    def prebuilt_tool(self, m: Module, node: ast.AST, name: str, sdk: str, via: str) -> str:
        """A tool a library ships, named where the application hands it to a model: one entry per
        (sdk, name) for the whole tree."""
        known = self.tool_index.get(name)
        if known is not None and known.get("sdk") == sdk and str(known.get("via", "")).startswith("prebuilt"):
            return name
        return self.add_tool(m, node, name, sdk, via, schema_kind="unknown")

    def claude_builtin(self, m: Module, node: ast.Constant, where: str) -> Optional[str]:
        """A built-in Claude Code tool named in `tools=`/`allowed_tools=` (`"Bash"`, `"Write"`,
        `"Bash(git:*)"`): a tool the model is handed that this code does not define. One entry
        per name for the whole tree; an `mcp__server__tool` name is an MCP tool, read from its server."""
        raw = const_str(node)
        if not raw or raw.startswith("mcp__"):
            return None
        name = raw.split("(", 1)[0].strip()
        if not name:
            return None
        known = self.tool_index.get(name)
        if known is not None and str(known.get("sdk")) == "claude-agent-sdk" and (
                str(known.get("via", "")).startswith("built-in") or str(known.get("via", "")).startswith("name written")):
            return name
        # A name the SDK's current version does not define (data/claude-agent-builtins.json):
        # reported as written, and said. An unreadable data file checks nothing.
        if CLAUDE_BUILTINS[2] and name not in CLAUDE_BUILTINS[2]:
            self.claude_unknown_builtins.append("%s:%d (%s)" % (m.rel, getattr(node, "lineno", 0), name))
            return self.add_tool(m, node, name, "claude-agent-sdk",
                                 "name written in %s for a built-in Claude Code tool, which the SDK's current version does not define" % where,
                                 schema_kind="unknown")
        return self.add_tool(m, node, name, "claude-agent-sdk",
                             "built-in Claude Code tool named in %s (runs inside the SDK, not in this code; a PreToolUse hook sees it first)" % where,
                             schema_kind="unknown")

    def claude_options_exposure(self, m: Module, call: ast.Call, name: str) -> None:
        """`ClaudeAgentOptions(mcp_servers={...}, tools=[...], allowed_tools=[...], hooks=...)` or
        `AgentDefinition(tools=[...])`: the tools the SDK offers the model on this configuration."""
        names: List[str] = []
        ok = True
        servers = kw(call, "mcp_servers")
        if servers is not None:
            sm, sv = self.resolve_value(m, servers)
            if isinstance(sv, ast.Dict):
                for v in sv.values:
                    ctor = self.var_ctor(sm, v.id) if isinstance(v, ast.Name) else (
                        (sm.qual(v.func) or "", sm, v) if isinstance(v, ast.Call) else None)
                    if ctor is not None and framework_of(ctor[0]) == "claude-agent-sdk" and last(ctor[0]) == "create_sdk_mcp_server":
                        tl = kw(ctor[2], "tools")
                        n0 = len(names)
                        if tl is None or not self.list_names(ctor[1], tl, "claude-agent-sdk", names):
                            ok = False
                        # The key the server is registered under is the `<server>` of `mcp__<server>__<tool>`.
                        key_node = sv.keys[sv.values.index(v)]
                        self.claude_model_names(const_str(key_node) if key_node is not None else None, names[n0:])
                    else:
                        # An external server's configuration: its tools are named by the server.
                        self.mcp_client_sites.append("%s:%d" % (m.rel, call.lineno))
                        ok = False
            else:
                self.mcp_client_sites.append("%s:%d" % (m.rel, call.lineno))
                ok = False
        for key in ("tools", "allowed_tools"):
            lst = kw(call, key)
            if lst is None:
                continue
            lm, lv = self.resolve_value(m, lst)
            if isinstance(lv, (ast.List, ast.Tuple)):
                for e in lv.elts:
                    if isinstance(e, ast.Constant):
                        n = self.claude_builtin(lm, e, "%s=[...]" % key)
                        if n is not None:
                            names.append(n)
                    else:
                        ok = False
            elif not (isinstance(lv, ast.Dict) and key == "tools"):
                ok = False
        seen: Set[str] = set()
        uniq = [n for n in names if not (n in seen or seen.add(n))]
        preset = isinstance(self.resolve_value(m, kw(call, "tools"))[1], ast.Dict) if kw(call, "tools") is not None else False
        if name == "ClaudeAgentOptions" and (kw(call, "tools") is None or preset):
            self.claude_default_tools.append("%s:%d" % (m.rel, call.lineno))
        hooked = kw(call, "hooks") is not None or kw(call, "can_use_tool") is not None
        hk = kw(call, "hooks") if kw(call, "hooks") is not None else kw(call, "can_use_tool")
        if not uniq and ok:
            return
        if name == "AgentDefinition":
            note = "a subagent's tools; the SDK runs them, and the session's PreToolUse hooks (K1) see them first"
        else:
            note = ("the SDK runs every tool listed here; " +
                    ("a hooks= or can_use_tool= callback is registered on these options (a PreToolUse hook is the "
                     "interception point, K1)" if hooked else "no hooks= or can_use_tool= is registered on these options"))
        if not ok:
            note = "the tool list is computed at runtime or names a server the scan cannot read; " + note
        self.exposures.append({
            "at": m.ref(call), "via": "%s(...) from claude_agent_sdk" % name,
            "kind": "static" if ok else "computed", "tools": uniq, "note": note,
            "_sdk": "claude-agent-sdk", "_expr": "",
            # A subagent's options carry no hooks: the session's own do, so the file's markers decide.
            **({} if name == "AgentDefinition" else
               {"_icpt": point("K1", "a PreToolUse hook" if kw(call, "hooks") is not None or kw(call, "can_use_tool") is None
                               else "a can_use_tool callback", hooked, m.ref(hk) if hk is not None else None)}),
        })

    def claude_model_names(self, server: Optional[str], tools: List[str]) -> None:
        """`CodeTool.model_name` for a Claude Agent SDK in-process server's tools: the model sees
        `mcp__<server>__<name>`. The first reading wins (a registration key before the server's own name)."""
        if not server:
            return
        for n in tools:
            t = self.tool_index.get(n)
            if t is not None and t.get("sdk") == "claude-agent-sdk" and "model_name" not in t:
                seen = "mcp__%s__%s" % (server, n)
                if seen != n:
                    t["model_name"] = seen

    def pass_claude_servers(self) -> None:
        """`create_sdk_mcp_server(name=, tools=[...])` wherever it is written: its name names its
        tools for the model when no registration key was read (`claude_options_exposure`)."""
        for m in self.modules:
            for call in (n for n in m.nodes if isinstance(n, ast.Call)):
                q = m.qual(call.func)
                if framework_of(q) != "claude-agent-sdk" or last(q) != "create_sdk_mcp_server":
                    continue
                tl = kw(call, "tools")
                names: List[str] = []
                if tl is not None:
                    self.list_names(m, tl, "claude-agent-sdk", names)
                self.claude_model_names(const_str(kw(call, "name")) or (const_str(call.args[0]) if call.args else None), names)

    def pass_module_tools(self, m: Module) -> None:
        """A Strands module-based tool (record 3.21): a module-level `TOOL_SPEC = {name,
        description, inputSchema: {json}}` beside a function of that name. The module itself is
        what goes in `Agent(tools=[...])`."""
        for st in m.tree.body:
            if not (isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name)
                    and st.targets[0].id == "TOOL_SPEC" and isinstance(st.value, ast.Dict)):
                continue
            spec = st.value
            name = const_str(dict_get(spec, "name"))
            wrap = dict_get(spec, "inputSchema")
            fn = m.defs.get(name) if name else None
            if name is None or fn is None or not isinstance(wrap, ast.Dict) or dict_get(wrap, "json") is None:
                continue
            params, literal = self.schema_params(m, dict_get(wrap, "json"))
            self.add_tool(m, spec, name, "strands", "module-based tool: TOOL_SPEC and the function %s() (Strands)" % name,
                          description=const_str(dict_get(spec, "description")) or "", params=params,
                          schema_kind="json_schema" if literal else "unknown", defined_at=st, execute=(m, fn))

    def pass_classes(self, m: Module) -> None:
        for cls in m.nodes:
            if not isinstance(cls, ast.ClassDef):
                continue
            sdk = None
            for b in cls.bases:
                q = m.qual(b)
                if last(q) == "BaseTool" and framework_of(q) in ("langchain", "crewai"):
                    sdk = framework_of(q)
                elif last(q) == "Tool" and framework_of(q) == "smolagents":
                    sdk = "smolagents"
            if sdk == "smolagents":
                self.smol_class_tool(m, cls)
                continue
            if sdk is None:
                continue
            name = None
            desc = ""
            params: List[str] = []
            run = None
            for s in cls.body:
                target = None
                value = None
                if isinstance(s, ast.Assign) and len(s.targets) == 1 and isinstance(s.targets[0], ast.Name):
                    target, value = s.targets[0].id, s.value
                elif isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name):
                    target, value = s.target.id, s.value
                if target == "name":
                    name = const_str(value)
                elif target == "description":
                    desc = const_str(value) or ""
                elif target == "args_schema" and value is not None:
                    params = self.class_fields(m, value)
                if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)) and s.name in ("_run", "_arun") and run is None:
                    run = s
            if run is None:
                continue
            if not params:
                params = self.function_params(run, False)
            self.add_tool(m, cls, name or cls.name, sdk,
                          "BaseTool subclass from %s" % ("crewai" if sdk == "crewai" else "langchain"),
                          description=desc, params=params, execute=(m, run))

    def smol_class_tool(self, m: Module, cls: ast.ClassDef) -> None:
        """A smolagents `Tool` subclass (record 3.21): `name`, `description`, `inputs` (a dict whose
        keys are the parameters), `output_type`, and `forward`, the run function."""
        name: Optional[str] = None
        desc = ""
        params: List[str] = []
        literal = False
        run = None
        for st in cls.body:
            target = st.targets[0].id if (isinstance(st, ast.Assign) and len(st.targets) == 1
                                          and isinstance(st.targets[0], ast.Name)) else (
                st.target.id if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name) else None)
            value = st.value if isinstance(st, (ast.Assign, ast.AnnAssign)) else None
            if target == "name":
                name = const_str(value)
            elif target == "description":
                desc = const_str(value) or ""
            elif target == "inputs" and value is not None:
                im, iv = self.resolve_value(m, value)
                if isinstance(iv, ast.Dict):
                    params, literal = [k for k in (const_str(x) for x in iv.keys) if k is not None], True
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and st.name == "forward":
                run = st
        if run is None:
            return
        self.add_tool(m, cls, name or cls.name, "smolagents",
                      "Tool subclass from smolagents (inputs + forward; no pre-call hook, K3: wrap forward)",
                      description=first_paragraph(desc), params=params or self.function_params(run, False),
                      schema_kind="json_schema" if literal or not params else "unknown", execute=(m, run))

    def llama_tool(self, m: Module, call: ast.Call, q: str) -> Optional[str]:
        """LlamaIndex (record 3.11): `FunctionTool.from_defaults(fn=, name=, description=,
        fn_schema=, async_fn=)`; `QueryEngineTool.from_defaults(query_engine=, name=)` and
        `RetrieverTool`, a query engine or retriever the model calls with one `input`. No
        pre-execution hook exists: the interception is wrapping `fn` before it is registered (K3)."""
        engine = "QueryEngineTool" in q or "RetrieverTool" in q
        name_kw = self.given_name(m, kw(call, "name"), call, "llamaindex")
        desc = const_str(kw(call, "description"))
        if engine:
            meta = kw(call, "metadata")
            if isinstance(meta, ast.Call):
                name_kw = name_kw or const_str(kw(meta, "name"))
                desc = desc if desc is not None else const_str(kw(meta, "description"))
            if name_kw is None:
                return None
            return self.add_tool(m, call, name_kw, "llamaindex",
                                 "%s from %s (a query engine the model queries; K3: wrap the engine)" % (
                                     "QueryEngineTool" if "QueryEngineTool" in q else "RetrieverTool", q.split(".")[0]),
                                 description=desc or "", params=["input"], schema_kind="unknown")
        if not q.endswith("from_defaults"):
            return None
        f = kw(call, "fn") or kw(call, "async_fn") or (call.args[0] if call.args else None)
        fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
        name = name_kw or (getattr(fn[1], "name", None) if fn is not None else None)
        if name is None:
            return None
        schema = kw(call, "fn_schema")
        params = self.class_fields(m, schema) if schema is not None else []
        if not params and fn is not None:
            params = self.function_params(fn[1], False)
        return self.add_tool(m, call, name, "llamaindex",
                             "FunctionTool.from_defaults(fn) from llama_index (the agent runs it; no pre-execution hook, "
                             "K3: wrap fn before from_defaults)",
                             description=desc if desc is not None else (first_paragraph(ast.get_docstring(fn[1])) if fn else ""),
                             params=params, schema_kind="json_schema" if (fn is not None or params) else "unknown", execute=fn)

    def adk_tool(self, m: Module, call: ast.Call, q: str) -> Optional[str]:
        """Google ADK (record 3.21): `FunctionTool(func=, require_confirmation=)`,
        `LongRunningFunctionTool(func=)`, and `AgentTool(agent=)`, another agent offered as a tool."""
        kind = last(q)
        if kind == "AgentTool":
            a = kw(call, "agent") or (call.args[0] if call.args else None)
            if a is None:
                return None
            am, av = self.value_of(m, a)
            name = const_str(kw(av, "name")) if isinstance(av, ast.Call) else None
            return self.add_tool(m, call, name or unparse(a), "adk",
                                 "AgentTool(agent=%s) from google.adk: another agent offered as a tool (it runs its own tools)" % unparse(a),
                                 description=const_str(kw(av, "description")) or "" if isinstance(av, ast.Call) else "",
                                 params=["request"], schema_kind="unknown")
        f = kw(call, "func") or (call.args[0] if call.args else None)
        fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
        if fn is None:
            return None
        conf = kw(call, "require_confirmation")
        via = "%s(func=...) from google.adk" % kind
        if conf is not None and not (isinstance(conf, ast.Constant) and conf.value is False):
            via += " (require_confirmation=%s: ADK pauses for a confirmation before it runs, K2)" % unparse(conf)[:40]
        if kind == "LongRunningFunctionTool":
            via += " (long-running: the function starts the operation, the result comes back later)"
        return self.add_tool(m, call, fn[1].name, "adk", via,
                             description=first_paragraph(ast.get_docstring(fn[1])),
                             params=self.function_params(fn[1], False), execute=fn)

    def haystack_tool(self, m: Module, call: ast.Call, q: str) -> Optional[str]:
        """Haystack (record 3.16): `Tool(name=, description=, parameters=, function=)`,
        `create_tool_from_function(fn, name=)`, `ComponentTool(component=, name=)` and
        `PipelineTool(pipeline=, name=)` (their parameters come from the component or pipeline)."""
        name_kw = self.given_name(m, kw(call, "name"), call, "haystack")
        kind = last(q)
        if kind == "create_tool_from_function":
            f = kw(call, "function") or (call.args[0] if call.args else None)
            fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
            name = name_kw or (getattr(fn[1], "name", None) if fn is not None else None)
            if name is None:
                return None
            desc = const_str(kw(call, "description"))
            return self.add_tool(m, call, name, "haystack", "create_tool_from_function(fn) from %s" % q.rsplit(".", 1)[0],
                                 description=desc if desc is not None else (first_paragraph(ast.get_docstring(fn[1])) if fn else ""),
                                 params=self.function_params(fn[1], False) if fn is not None else [],
                                 schema_kind="json_schema" if fn is not None else "unknown", execute=fn)
        if kind == "Tool":
            if name_kw is None:
                return None
            f = kw(call, "function")
            fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
            params, literal = self.schema_params(m, kw(call, "parameters"))
            return self.add_tool(m, call, name_kw, "haystack", "Tool(name=, parameters=, function=) from %s" % q.rsplit(".", 1)[0],
                                 description=const_str(kw(call, "description")) or "", params=params,
                                 schema_kind="json_schema" if literal else "unknown", execute=fn)
        # ComponentTool / PipelineTool: a component or pipeline the model calls; its inputs are its run() signature.
        inner = kw(call, "component") or kw(call, "pipeline") or (call.args[0] if call.args else None)
        name = name_kw or (unparse(inner.func) if isinstance(inner, ast.Call) else unparse(inner) if inner is not None else None)
        if name is None:
            return None
        params, literal = self.schema_params(m, kw(call, "parameters"))
        return self.add_tool(m, call, name, "haystack",
                             "%s(...) from %s (wraps a %s; its inputs are read from it at runtime, not here)"
                             % (kind, q.rsplit(".", 1)[0], "pipeline component" if kind == "ComponentTool" else "pipeline"),
                             description=const_str(kw(call, "description")) or "", params=params,
                             schema_kind="json_schema" if literal else "unknown")

    def af_function_tool(self, m: Module, call: ast.Call, q: str) -> Optional[str]:
        """`FunctionTool(...)`: Agent Framework's (keyword-only `name=`, `func=`, `input_model=`;
        no `func` is a declaration the application answers itself) or AutoGen's
        (`autogen_core.tools.FunctionTool(func, description, name=None)`)."""
        autogen = q.startswith("autogen")
        fn_expr = kw(call, "func") or (call.args[0] if autogen and call.args else None)
        fn = self.resolve_def(m, fn_expr.id) if isinstance(fn_expr, ast.Name) else None
        name = self.given_name(m, kw(call, "name"), call, "agent-framework") or (getattr(fn[1], "name", None) if fn is not None else None)
        if name is None:
            return None
        desc = const_str(kw(call, "description")) or (const_str(call.args[1]) if autogen and len(call.args) > 1 else None)
        if desc is None and fn is not None:
            desc = first_paragraph(ast.get_docstring(fn[1]))
        schema = kw(call, "input_model")
        params: List[str] = []
        kind = "json_schema"
        if schema is not None:
            params, literal = self.schema_params(m, schema)
            if not params and isinstance(schema, ast.Name):
                params = self.class_fields(m, schema)
            kind = "json_schema" if (literal or params) else "unknown"
        elif fn is not None:
            params = self.function_params(fn[1], False)
        else:
            kind = "unknown"
        if autogen:
            via = "FunctionTool(fn, description) from %s (AutoGen AgentChat)" % q.rsplit(".", 1)[0]
        elif fn is None and fn_expr is None:
            via = "FunctionTool(name=...) from agent_framework, declaration only: no func, the application answers the call"
        else:
            via = "FunctionTool(func=...) from agent_framework" + approval_via(const_str(kw(call, "approval_mode")))
        return self.add_tool(m, call, name, "agent-framework", via, description=desc or "", params=params,
                             schema_kind=kind, execute=fn)

    def dict_tool(self, m: Module, d: ast.Dict, hint: Optional[str] = None) -> Optional[str]:
        """A tool definition written as a dict literal: Anthropic, OpenAI Chat, OpenAI Responses, Gemini."""
        if id(d) in self.tool_by_node:
            return self.tool_by_node[id(d)]
        # The name resolves through a constant, a class attribute or an enum member (`given_name`);
        # it is recorded as computed only once the dict has a tool's shape, below.
        name = self.const_name(m, dict_get(d, "name"), d)
        typ = const_str(dict_get(d, "type"))
        spec = dict_get(d, "toolSpec")
        if isinstance(spec, ast.Dict):
            # Bedrock Converse (record 3.9): `{"toolSpec": {name, description, inputSchema: {json: {...}}}}`.
            # The `inputSchema.json` double wrap is the signature; a toolSpec without it is not the shape.
            n = self.const_name(m, dict_get(spec, "name"), d)
            wrap = dict_get(spec, "inputSchema")
            if n is None and isinstance(wrap, ast.Dict) and dict_get(wrap, "json") is not None:
                self.given_name(m, dict_get(spec, "name"), d, "bedrock", True)
            if n is not None and isinstance(wrap, ast.Dict) and dict_get(wrap, "json") is not None:
                params, literal = self.schema_params(m, dict_get(wrap, "json"))
                return self.add_tool(m, d, n, "bedrock", 'toolConfig.tools[] {"toolSpec": {name, inputSchema: {json}}} (Bedrock Converse)',
                                     description=const_str(dict_get(spec, "description")) or "", params=params,
                                     schema_kind="json_schema" if literal else "unknown")
            return None
        if name is None and dict_get(d, "name") is not None and dict_get(d, "input_schema") is not None:
            self.given_name(m, dict_get(d, "name"), d, "anthropic", True)
        if name is not None and dict_get(d, "input_schema") is not None:
            params, literal = self.schema_params(m, dict_get(d, "input_schema"))
            return self.add_tool(m, d, name, "anthropic", "tools[] dict on messages.create (name + input_schema)",
                                 description=const_str(dict_get(d, "description")) or "", params=params,
                                 schema_kind="json_schema" if literal else "unknown")
        if typ == "function":
            inner = dict_get(d, "function")
            if isinstance(inner, ast.Dict):
                n = self.const_name(m, dict_get(inner, "name"), d)
                if n is None and dict_get(inner, "name") is not None and dict_get(inner, "parameters") is not None:
                    self.given_name(m, dict_get(inner, "name"), d, "openai", True)
                if n is not None:
                    params, literal = self.schema_params(m, dict_get(inner, "parameters"))
                    return self.add_tool(m, d, n, "openai", 'tools[] {"type": "function", "function": {...}} (Chat Completions)',
                                         description=const_str(dict_get(inner, "description")) or "", params=params,
                                         schema_kind="json_schema" if literal else "unknown")
            elif name is not None:
                params, literal = self.schema_params(m, dict_get(d, "parameters"))
                return self.add_tool(m, d, name, "openai", 'tools[] {"type": "function", "name": ...} (Responses)',
                                     description=const_str(dict_get(d, "description")) or "", params=params,
                                     schema_kind="json_schema" if literal else "unknown")
        if name is not None and dict_get(d, "parameter_definitions") is not None:
            pd = dict_get(d, "parameter_definitions")
            params = [k for k in (const_str(x) for x in pd.keys) if k is not None] if isinstance(pd, ast.Dict) else []
            return self.add_tool(m, d, name, "cohere", "tools[] {name, parameter_definitions} (Cohere v1 chat)",
                                 description=const_str(dict_get(d, "description")) or "", params=params,
                                 schema_kind="json_schema" if isinstance(pd, ast.Dict) else "unknown")
        if hint == "gemini" and name is not None:
            schema = dict_get(d, "parameters") or dict_get(d, "parameters_json_schema")
            params, literal = self.schema_params(m, schema)
            return self.add_tool(m, d, name, "gemini", "function_declarations dict (google-genai)",
                                 description=const_str(dict_get(d, "description")) or "", params=params,
                                 schema_kind="json_schema" if literal else "unknown")
        if typ and (typ.startswith("web_search") or typ.startswith("web_fetch") or typ.startswith("code_execution")
                    or typ in ("file_search", "image_generation", "computer_use_preview", "mcp")):
            self.hosted_sites.append("%s:%d" % (m.rel, d.lineno))
        return None

    def call_tool(self, m: Module, call: ast.Call) -> Optional[str]:
        """A tool made by a call: StructuredTool.from_function, Tool(...), FunctionTool(...),
        pydantic_function_tool(...), types.FunctionDeclaration(...)."""
        if id(call) in self.tool_by_node:
            return self.tool_by_node[id(call)]
        q = m.qual(call.func)
        fw = framework_of(q)
        name_kw = self.given_name(m, kw(call, "name"), call, fw) if fw is not None else const_str(kw(call, "name"))
        desc_kw = const_str(kw(call, "description"))
        if fw == "langchain" and q.endswith("StructuredTool.from_function") or (fw == "langchain" and last(q) == "Tool"):
            fn_expr = kw(call, "func") or kw(call, "coroutine") or (call.args[0] if call.args else None)
            fn = self.resolve_def(m, fn_expr.id) if isinstance(fn_expr, ast.Name) else None
            params, literal = self.schema_params(m, kw(call, "args_schema"))
            if not params and kw(call, "args_schema") is not None:
                params = self.class_fields(m, kw(call, "args_schema"))
            if not params and fn is not None:
                params = self.function_params(fn[1], False)
            doc = first_paragraph(ast.get_docstring(fn[1])) if fn is not None else ""
            name = name_kw or (fn[1].name if fn is not None else None)
            if name is None:
                return None
            return self.add_tool(m, call, name, "langchain", "%s(...) from %s" % (last(q) if last(q) == "Tool" else "StructuredTool.from_function", q.split(".")[0]),
                                 description=desc_kw if desc_kw is not None else doc, params=params,
                                 execute=fn)
        if fw == "pydantic-ai" and last(q) == "Tool":
            fn_expr = call.args[0] if call.args else kw(call, "function")
            fn = self.resolve_def(m, fn_expr.id) if isinstance(fn_expr, ast.Name) else None
            if fn is None:
                return None
            takes_ctx = kw(call, "takes_ctx")
            return self.add_tool(m, call, name_kw or fn[1].name, "pydantic-ai", "Tool(fn) from pydantic_ai",
                                 description=desc_kw if desc_kw is not None else first_paragraph(ast.get_docstring(fn[1])),
                                 params=self.function_params(fn[1], not (isinstance(takes_ctx, ast.Constant) and takes_ctx.value is False)),
                                 execute=fn)
        if fw == "openai-agents" and last(q) == "FunctionTool":
            if name_kw is None:
                return None
            params, literal = self.schema_params(m, kw(call, "params_json_schema"))
            inv = kw(call, "on_invoke_tool")
            fn = self.resolve_def(m, inv.id) if isinstance(inv, ast.Name) else None
            return self.add_tool(m, call, name_kw, "openai-agents", "FunctionTool(...) from agents",
                                 description=desc_kw or "", params=params,
                                 schema_kind="json_schema" if literal else "unknown", execute=fn)
        if fw == "dspy" and last(q) == "Tool" and (call.args or kw(call, "func") is not None):
            f = kw(call, "func") or call.args[0]
            fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
            name = name_kw or (getattr(fn[1], "name", None) if fn is not None else None)
            if name is None:
                return None
            desc = const_str(kw(call, "desc"))
            args = kw(call, "args")
            params = [k for k in (const_str(x) for x in args.keys) if k is not None] if isinstance(args, ast.Dict) else (
                self.function_params(fn[1], False) if fn is not None else [])
            return self.add_tool(m, call, name, "dspy", "dspy.Tool(func, name=, desc=) (no hook, K3: wrap the function)",
                                 description=desc if desc is not None else (first_paragraph(ast.get_docstring(fn[1])) if fn else ""),
                                 params=params, schema_kind="json_schema" if (fn is not None or params) else "unknown", execute=fn)
        if fw == "llamaindex" and (q.endswith("FunctionTool.from_defaults") or q.endswith("QueryEngineTool.from_defaults")
                                   or q.endswith("RetrieverTool.from_defaults") or last(q) in ("QueryEngineTool", "FunctionTool")):
            return self.llama_tool(m, call, q)
        if fw == "adk" and last(q) in ("FunctionTool", "LongRunningFunctionTool", "AgentTool"):
            return self.adk_tool(m, call, q)
        if fw == "haystack" and last(q) in ("Tool", "create_tool_from_function", "ComponentTool", "PipelineTool"):
            return self.haystack_tool(m, call, q)
        if fw == "ag2" and last(q) == "register_function":
            f = call.args[0] if call.args else kw(call, "f")
            fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
            name = name_kw or (getattr(fn[1], "name", None) if fn is not None else None)
            if name is None:
                return None
            return self.add_tool(m, call, name, "ag2",
                                 "register_function(f, caller=%s, executor=%s) from autogen (run by the executor agent; K3: wrap f)"
                                 % (unparse(kw(call, "caller") or ast.Name(id="?")), unparse(kw(call, "executor") or ast.Name(id="?"))),
                                 description=desc_kw if desc_kw is not None else (first_paragraph(ast.get_docstring(fn[1])) if fn else ""),
                                 params=self.function_params(fn[1], False) if fn is not None else [],
                                 schema_kind="json_schema" if fn is not None else "unknown", execute=fn)
        if fw == "ag2" and (last(q) == "tool" or (last(q) == "Tool" and q.startswith("autogen.tools"))) and (call.args or kw(call, "func_or_tool") is not None):
            f = kw(call, "func_or_tool") or kw(call, "function") or call.args[0]
            fn = self.resolve_def(m, f.id) if isinstance(f, ast.Name) else None
            name = name_kw or (getattr(fn[1], "name", None) if fn is not None else None)
            if name is None:
                return None
            return self.add_tool(m, call, name, "ag2", "%s(fn) from %s%s" % (last(q), q.rsplit(".", 1)[0], ag2_middleware_via(call)),
                                 description=desc_kw if desc_kw is not None else (first_paragraph(ast.get_docstring(fn[1])) if fn else ""),
                                 params=self.function_params(fn[1], False) if fn is not None else [],
                                 schema_kind="json_schema" if fn is not None else "unknown", execute=fn)
        if fw == "agent-framework" and last(q) == "FunctionTool":
            return self.af_function_tool(m, call, q)
        if fw == "openai" and last(q) == "pydantic_function_tool":
            model = call.args[0] if call.args else kw(call, "model")
            if model is None:
                return None
            cls = self.resolve_class(m, model.id) if isinstance(model, ast.Name) else None
            name = name_kw or (model.id if isinstance(model, ast.Name) else None)
            if name is None:
                return None
            doc = first_paragraph(ast.get_docstring(cls[1])) if cls is not None else ""
            return self.add_tool(m, call, name, "openai", "openai.pydantic_function_tool(Model)",
                                 description=desc_kw if desc_kw is not None else doc,
                                 params=self.class_fields(m, model))
        if fw == "cohere" and last(q) == "ToolV2":
            fn = kw(call, "function")
            if isinstance(fn, ast.Call):
                n = const_str(kw(fn, "name"))
                if n is None:
                    return None
                params, literal = self.schema_params(m, kw(fn, "parameters"))
                return self.add_tool(m, call, n, "cohere", "ToolV2(function=ToolV2Function(...)) (cohere)",
                                     description=const_str(kw(fn, "description")) or "", params=params,
                                     schema_kind="json_schema" if literal else "unknown")
            if isinstance(fn, ast.Dict):
                n = const_str(dict_get(fn, "name"))
                if n is None:
                    return None
                params, literal = self.schema_params(m, dict_get(fn, "parameters"))
                return self.add_tool(m, call, n, "cohere", "ToolV2(function={...}) (cohere)",
                                     description=const_str(dict_get(fn, "description")) or "", params=params,
                                     schema_kind="json_schema" if literal else "unknown")
            return None
        if fw == "crewai" and q.startswith("crewai_tools.") and last(q)[:1].isupper():
            return self.add_tool(m, call, last(q), "crewai", "prebuilt tool class from crewai_tools (parameters not read)",
                                 schema_kind="unknown")
        if fw == "mcp" and last(q) == "Tool":
            # The low-level server's tools/list answer: `Tool(name=..., inputSchema=...)`.
            name = self.given_name(m, kw(call, "name"), call, "mcp", True)
            if name is None:
                return None
            params, literal = self.schema_params(m, kw(call, "inputSchema") or kw(call, "input_schema"))
            claims = self.annotations_claims(kw(call, "annotations"))
            desc = (const_str(kw(call, "description")) or "")
            return self.add_tool(m, call, name, "mcp", "Tool(...) from %s, listed by a low-level MCP server" % q.rsplit(".", 1)[0],
                                 description=(desc + " " + claims).strip() if claims else desc, params=params,
                                 schema_kind="json_schema" if literal else "unknown")
        if fw is None and kw(call, "parameter_definitions") is not None and kw(call, "name") is not None:
            # The Cohere tool shape (`name` + `parameter_definitions`) built by the
            # application's own class -- a tool registry the application defines.
            name = self.const_name(m, kw(call, "name"), call)
            if name is None:
                return None
            pd = kw(call, "parameter_definitions")
            m2, pd = self.resolve_value(m, pd) if pd is not None else (m, pd)
            params = [k for k in (const_str(x) for x in pd.keys) if k is not None] if isinstance(pd, ast.Dict) else []
            run = self.enclosing_class_method(m, call, ("call", "run", "_run", "arun", "_arun", "invoke", "execute"))
            return self.add_tool(m, call, name, "cohere",
                                 "%s(name=..., parameter_definitions=...) (the Cohere tool shape, defined by the application)" % (last(q) or unparse(call.func)),
                                 description=const_str(kw(call, "description")) or "", params=params,
                                 schema_kind="json_schema" if isinstance(pd, ast.Dict) else "unknown",
                                 execute=(m, run) if run is not None else None)
        if fw == "gemini" and last(q) == "FunctionDeclaration":
            if name_kw is None:
                return None
            schema = kw(call, "parameters") or kw(call, "parameters_json_schema")
            params, literal = self.schema_params(m, schema)
            return self.add_tool(m, call, name_kw, "gemini", "types.FunctionDeclaration(...) (google-genai)",
                                 description=desc_kw or "", params=params,
                                 schema_kind="json_schema" if literal else "unknown")
        return None

    def pass_literals(self, m: Module) -> None:
        for node in m.nodes:
            if isinstance(node, ast.Dict):
                self.dict_tool(m, node)
            elif isinstance(node, ast.Call):
                self.call_tool(m, node)
                q = m.qual(node.func)
                fw = framework_of(q)
                if fw == "instructor":
                    continue
                name = last(q) if q else (node.func.attr if isinstance(node.func, ast.Attribute) else "")
                if name in HOSTED_TOOL_CLASSES and fw == "openai-agents":
                    self.hosted_sites.append("%s:%d" % (m.rel, node.lineno))
                # ClaudeAgentOptions(mcp_servers=...) is read by `claude_options_exposure`, which
                # tells an in-process SDK server (its tools are in this tree) from an external one.
                if (name in MCP_CLIENT_CLASSES or (kw(node, "mcp_servers") is not None and fw != "claude-agent-sdk")
                        or (name == "MCPClient" and fw in ("smolagents", "strands"))):
                    self.mcp_client_sites.append("%s:%d" % (m.rel, node.lineno))
                if (fw == "crewai" and q.startswith("crewai_tools")) or (fw == "langchain" and (name in TOOLKIT_CALLS or name.endswith("Toolkit"))):
                    self.toolkit_sites.append("%s:%d %s" % (m.rel, node.lineno, name))
                if (isinstance(node.func, ast.Attribute) and node.func.attr == "register_for_llm" and node.args
                        and any(framework_of(v) == "ag2" for v in m.imports.values())):
                    # `toolkit.register_for_llm(agent)`: an AG2 Tool or Toolkit object built elsewhere
                    # (an interop wrapper, a prebuilt toolkit) registered on an agent; its tools are not read.
                    self.toolkit_sites.append("%s:%d %s.register_for_llm" % (m.rel, node.lineno, unparse(node.func.value)[:40]))
                rf = kw(node, "response_format") or kw(node, "text_format")
                if (rf is not None and isinstance(node.func, ast.Attribute) and node.func.attr == "parse"
                        and isinstance(rf, (ast.Name, ast.Attribute))):
                    self.parse_models.add("%s:%s" % (m.rel, unparse(rf)))
                    self.structured.append({"name": unparse(rf)[:60], "at": m.ref(node)})
                rm = kw(node, "response_model")
                if rm is not None and "instructor" in {framework_of(v) for v in m.imports.values()}:
                    self.instructor_models.add("%s:%s" % (m.rel, unparse(rm)))
                    self.structured.append({"name": unparse(rm)[:60], "at": m.ref(node)})

    # ---- exposures -----------------------------------------------------
    def element_names(self, m: Module, elt: ast.expr, sdk: str, out: List[str], depth: int = 0) -> bool:
        """Resolve one element of a tools list to tool names. False when it cannot be read."""
        if depth > 5:
            return False
        if isinstance(elt, ast.Starred):
            return self.list_names(m, elt.value, sdk, out, depth + 1)
        if isinstance(elt, ast.Dict):
            so = self.instructor_schema(m, dict_get(elt, "function"))
            if so is not None:
                # `{"type": "function", "function": Model.openai_schema}` for an instructor schema:
                # structured output handed over in the tool channel, nothing executes (record 3.17).
                self.instructor_models.add("%s:%s" % (m.rel, so))
                self.structured_in_exposure.append(so)
                self.structured.append({"name": so[:60], "at": m.ref(elt)})
                return True
            fd = dict_get(elt, "function_declarations") or dict_get(elt, "functionDeclarations")
            if fd is not None:
                return self.list_names(m, fd, "gemini", out, depth + 1)
            n = self.dict_tool(m, elt, sdk)
            if n is not None:
                out.append(n)
                return True
            return False
        if isinstance(elt, ast.Call):
            n = self.call_tool(m, elt)
            if n is not None:
                out.append(n)
                return True
            if isinstance(elt.func, ast.Name):
                cls = self.resolve_class(m, elt.func.id)
                if cls is not None and id(cls[1]) in self.tool_by_node:
                    out.append(self.tool_by_node[id(cls[1])])
                    return True
            q = m.qual(elt.func)
            if framework_of(q) == "gemini" and last(q) == "Tool":
                fd = kw(elt, "function_declarations")
                return self.list_names(m, fd, "gemini", out, depth + 1) if fd is not None else False
            if framework_of(q) == "openai-agents" and last(q) in HOSTED_TOOL_CLASSES:
                return True  # provider-executed: recorded in not_seen, not a tool this code runs
            if sdk == "strands" and isinstance(elt.func, ast.Attribute) and elt.func.attr in ("list_tools_sync", "list_tools"):
                self.mcp_client_sites.append("%s:%d" % (m.rel, elt.lineno))
                return True
            if framework_of(q) == "dspy" and last(q) in ("from_mcp_tool", "from_langchain"):
                (self.mcp_client_sites if last(q) == "from_mcp_tool" else self.toolkit_sites).append(
                    "%s:%d dspy.Tool.%s" % (m.rel, elt.lineno, last(q)))
                return True
            if framework_of(q) == "smolagents":
                if last(q) in ("from_space", "from_hub", "load_tool", "from_langchain", "from_gradio") or "ToolCollection" in (q or ""):
                    (self.mcp_client_sites if "mcp" in (q or "").lower() else self.toolkit_sites).append(
                        "%s:%d %s" % (m.rel, elt.lineno, ".".join((q or "").split(".")[-2:])))
                    return True
                if last(q).endswith("Tool"):
                    out.append(self.prebuilt_tool(m, elt, last(q), "smolagents",
                                                  "prebuilt tool class from smolagents (runs in this process; parameters not read)"))
                    return True
            if isinstance(elt.func, ast.Attribute) and elt.func.attr == "to_tool_list" and sdk == "llamaindex":
                # A ToolSpec's tools (`GmailToolSpec().to_tool_list()`): a library's, named by the spec.
                self.toolkit_sites.append("%s:%d %s" % (m.rel, elt.lineno, unparse(elt.func.value)[:40]))
                return True
            if framework_of(q) == "adk" and last(q) in ("MCPToolset", "McpToolset", "RemoteMcpServer"):
                self.mcp_client_sites.append("%s:%d" % (m.rel, elt.lineno))
                return True
            if framework_of(q) == "adk" and (last(q) in ADK_GENERATED or last(q) in ADK_HOSTED):
                (self.hosted_sites if last(q) in ADK_HOSTED else self.toolkit_sites).append(
                    "%s:%d" % (m.rel, elt.lineno) if last(q) in ADK_HOSTED else "%s:%d %s" % (m.rel, elt.lineno, last(q)))
                return True
            if framework_of(q) == "haystack" and last(q) in ("Toolset", "SearchableToolset"):
                inner = kw(elt, "tools") if kw(elt, "tools") is not None else (elt.args[0] if elt.args else None)
                return self.list_names(m, inner, sdk, out, depth + 1) if inner is not None else False
            if framework_of(q) == "haystack" and last(q) in ("MCPTool", "MCPToolset"):
                self.mcp_client_sites.append("%s:%d" % (m.rel, elt.lineno))
                return True
            if q and q.startswith("haystack_integrations.") and last(q).endswith(("Tool", "Toolset", "Toolkit")):
                # A prebuilt integration tool (GitHubRepoViewerTool, ...): named, its parameters not read.
                self.toolkit_sites.append("%s:%d %s" % (m.rel, elt.lineno, last(q)))
                return True
            if framework_of(q) == "pydantic-ai" and last(q) == "FunctionToolset":
                return self.list_names(m, kw(elt, "tools"), sdk, out, depth + 1) if kw(elt, "tools") is not None else True
            if isinstance(elt.func, ast.Attribute) and elt.func.attr in AF_HOSTED_FACTORIES | {"get_shell_tool"}:
                if self.client_of(m, self.chain(elt.func)[1], elt.func)[0] == "agent-framework" or framework_of(
                        m.qual(elt.func)) == "agent-framework":
                    if elt.func.attr == "get_shell_tool":
                        # A shell tool the APPLICATION runs through `func=`: the tool is that function.
                        f = kw(elt, "func")
                        return self.element_names(m, f, sdk, out, depth + 1) if f is not None else False
                    self.hosted_sites.append("%s:%d" % (m.rel, elt.lineno))
                    return True
            spec_fn = self.callee_def(m, elt, elt)
            if spec_fn is not None:
                # The application's own function that returns a tool definition literal
                # (`weather_tool.get_tool_spec()` in the AWS Converse example): the literal it
                # returns is the tool. Every return must be one, or the element is not read.
                rets = [r.value for r in body_nodes(spec_fn[1]) if isinstance(r, ast.Return)]
                if rets and all(isinstance(r, ast.Dict) for r in rets):
                    got = [self.dict_tool(spec_fn[0], r, sdk) for r in rets if isinstance(r, ast.Dict)]
                    if all(g is not None for g in got):
                        out.extend(g for g in got if g is not None)
                        return True
            if isinstance(elt.func, ast.Name):
                # A local function that returns a filtered tool list: join the names
                # back through it, but the list is still decided at runtime.
                found = self.resolve_def(m, elt.func.id)
                if found is not None:
                    for r in ast.walk(found[1]):
                        if isinstance(r, ast.Return) and isinstance(r.value, (ast.ListComp, ast.GeneratorExp)):
                            self.list_names(found[0], r.value.generators[0].iter, sdk, out, depth + 1)
            return False
        if isinstance(elt, (ast.Name, ast.Attribute)) and sdk == "strands":
            eq = m.qual(elt)
            if eq and eq.startswith("strands_tools"):
                # A prebuilt tool from strands_tools (`shell`, `file_write`, `use_aws`): a real tool this
                # process runs, named by its import; its parameters are the library's and are not read.
                out.append(self.prebuilt_tool(m, elt, last(eq), "strands",
                                              "prebuilt tool from %s (runs in this process; parameters not read)" % eq.rsplit(".", 1)[0]))
                return True
            if eq:
                tm = self.module_near(m, eq)
                if tm is not None:
                    # A module handed over whole: Strands loads the @tool functions it defines, or its
                    # module-based tool (TOOL_SPEC), both recorded against their run function.
                    inner = [n for (rel, _fn), n in self.tool_by_def.items() if rel == tm.rel and self.tool_index.get(n, {}).get("sdk") == "strands"]
                    if inner:
                        out.extend(inner)
                        return True
            if isinstance(elt, ast.Name):
                ctor = self.var_ctor(m, elt.id)
                if ctor is not None and framework_of(ctor[0]) == "strands" and last(ctor[0]) == "MCPClient":
                    self.mcp_client_sites.append("%s:%d" % (m.rel, elt.lineno))
                    return True
        if isinstance(elt, (ast.Name, ast.Attribute)) and framework_of(m.qual(elt)) == "adk" and last(m.qual(elt)) in ADK_HOSTED:
            # `google_search`, `url_context`: tool INSTANCES ADK ships, run by the provider (K5).
            self.hosted_sites.append("%s:%d" % (m.rel, elt.lineno))
            return True
        if isinstance(elt, ast.Name):
            ctor = self.var_ctor(m, elt.id)
            if ctor is not None and framework_of(ctor[0]) in ("pydantic-ai", "mcp") and last(ctor[0]) in ("FunctionToolset", "MCPServer", "FastMCP"):
                out.extend(self.registries.get((ctor[1].rel, elt.id), []))
                tl = kw(ctor[2], "tools")
                return self.list_names(ctor[1], tl, sdk, out, depth + 1) if tl is not None else True
            found = self.resolve_def(m, elt.id)
            if found is not None:
                key = (found[0].rel, getattr(found[1], "name", ""))
                if key in self.tool_by_def:
                    out.append(self.tool_by_def[key])
                    return True
                if sdk in BARE_FUNCTION_SDKS:
                    via = BARE_FUNCTION_VIA[sdk]
                    out.append(self.function_tool(found[0], found[1], found[1], None, sdk, via, None,
                                                  skip_context=sdk == "pydantic-ai"))
                    return True
                return False
            vm, value = self.resolve_value(m, elt)
            if value is not elt:
                if isinstance(value, (ast.List, ast.Tuple)):
                    return self.list_names(vm, value, sdk, out, depth + 1)
                return self.element_names(vm, value, sdk, out, depth + 1)
            cls = self.resolve_class(m, elt.id)
            if cls is not None and id(cls[1]) in self.tool_by_node:
                out.append(self.tool_by_node[id(cls[1])])
                return True
        return False

    def list_names(self, m: Module, expr: Optional[ast.expr], sdk: str, out: List[str], depth: int = 0) -> bool:
        if expr is None:
            return False
        m, value = self.resolve_value(m, expr)
        if isinstance(value, (ast.List, ast.Tuple)):
            ok = True
            for elt in value.elts:
                if not self.element_names(m, elt, sdk, out, depth + 1):
                    ok = False
            return ok
        if isinstance(value, ast.BinOp) and isinstance(value.op, ast.Add):
            a = self.list_names(m, value.left, sdk, out, depth + 1)
            b = self.list_names(m, value.right, sdk, out, depth + 1)
            return a and b
        return self.element_names(m, value, sdk, out, depth + 1)

    def instructor_schema(self, m: Module, e: Optional[ast.expr]) -> Optional[str]:
        """`Model.openai_schema` (or `.anthropic_schema`) of a class deriving from instructor's
        ResponseSchema / OpenAISchema: the class name, else None."""
        if not (isinstance(e, ast.Attribute) and e.attr in ("openai_schema", "anthropic_schema", "gemini_schema")
                and isinstance(e.value, ast.Name)):
            return None
        found = self.resolve_class(m, e.value.id)
        if found is None:
            return None
        for b in found[1].bases:
            bq = found[0].qual(b)
            if framework_of(bq) == "instructor" and last(bq) in ("OpenAISchema", "ResponseSchema"):
                return e.value.id
        return None

    def add_exposure(self, m: Module, node: ast.AST, via: str, sdk: str, tools_expr: Optional[ast.expr],
                     extra_exprs: Optional[List[ast.expr]] = None, note_static: str = "") -> Dict[str, object]:
        self.structured_in_exposure = []
        names: List[str] = []
        ok = True
        for e in [tools_expr] + (extra_exprs or []):
            if e is None:
                continue
            if not self.list_names(m, e, sdk, names):
                ok = False
        seen: Set[str] = set()
        uniq = [n for n in names if not (n in seen or seen.add(n))]
        shown = unparse(tools_expr) if tools_expr is not None else ""
        if ok:
            note = note_static or "the tool list is written in the source; every tool listed here is offered to the model on this call"
        else:
            note = ("the tool list is computed at runtime (%s); the scan lists the tools it could join back, "
                    "and what reaches the model can be fewer or more" % (shown[:80] or "a value"))
        if self.structured_in_exposure:
            note += ("; %s %s instructor structured-output schema%s handed over in the tool channel: nothing executes, "
                     "not a tool" % (", ".join(self.structured_in_exposure), "is an" if len(self.structured_in_exposure) == 1
                                     else "are", "" if len(self.structured_in_exposure) == 1 else "s"))
        exp: Dict[str, object] = {
            "at": m.ref(node), "via": via, "kind": "static" if ok else "computed",
            "tools": uniq, "note": note, "_sdk": sdk, "_expr": shown,
        }
        self.exposures.append(exp)
        return exp

    def chain(self, node: ast.expr) -> Tuple[List[str], Optional[ast.expr]]:
        attrs: List[str] = []
        cur: ast.expr = node
        while True:
            if isinstance(cur, ast.Attribute):
                attrs.append(cur.attr)
                cur = cur.value
            elif isinstance(cur, ast.Call):
                cur = cur.func
            else:
                break
        attrs.reverse()
        return attrs, cur

    def client_of(self, m: Module, base: Optional[ast.expr], func: ast.expr) -> Tuple[Optional[str], bool]:
        """The framework a method chain's receiver was built from, and whether it was given base_url."""
        cq: Optional[str] = None
        call: Optional[ast.Call] = None
        if isinstance(base, ast.Name):
            ctor = self.var_ctor(m, base.id)
            if ctor is not None:
                cq, call = ctor[0], ctor[2]
            elif framework_of(m.imports.get(base.id)):
                cq = m.imports.get(base.id)
        inner = func
        while isinstance(inner, ast.Attribute):
            inner = inner.value
            if isinstance(inner, ast.Call):
                q = m.qual(inner.func)
                if framework_of(q):
                    cq, call = q, inner
                break
        compat = call is not None and kw(call, "base_url") is not None
        return framework_of(cq), compat

    @staticmethod
    def method_sdk(attrs: List[str], meth: str, dotted: str, client_fw: Optional[str]) -> Optional[str]:
        """The SDK a model-call method chain belongs to (`client.messages.create`, ...), or None.
        One reading for the tool exposures and the skill loads' `reaches` (ACP-460)."""
        if client_fw == "mistral":
            if ("chat" in attrs or "agents" in attrs) and meth in ("complete", "stream", "complete_async", "stream_async"):
                return "mistral"
            return None
        if client_fw == "cohere":
            return "cohere" if meth in ("chat", "chat_stream") else None
        if client_fw in ("anthropic", "openai", "gemini"):
            return client_fw
        if "messages" in attrs and meth in ("create", "stream", "parse", "tool_runner"):
            return "anthropic"
        if meth == "tool_runner":
            return "anthropic"
        if ("completions" in attrs or "responses" in attrs) and meth in ("create", "parse", "stream", "run_tools"):
            return "openai"
        if meth in ("generate_content", "generate_content_stream") or dotted.endswith("chats.create"):
            return "gemini"
        return None

    def pass_exposures(self, m: Module) -> None:
        calls = [n for n in m.nodes if isinstance(n, ast.Call)]
        configs: List[ast.Call] = []
        for call in calls:
            q = m.qual(call.func)
            fw = framework_of(q)
            name = last(q)
            tools = kw(call, "tools")
            if fw == "gemini" and name == "GenerateContentConfig":
                configs.append(call)
                continue
            if fw == "openai-agents" and name == "Agent":
                self.add_exposure(m, call, "Agent(tools=[...]) from agents", "openai-agents", tools)
                continue
            if fw == "pydantic-ai" and name == "Agent":
                ts = kw(call, "toolsets")
                exp = self.add_exposure(m, call, "Agent(tools=[...]) from pydantic_ai", "pydantic-ai", tools,
                                        [ts] if ts is not None else None)
                parent = m.parents.get(id(call))
                if isinstance(parent, ast.Assign) and len(parent.targets) == 1 and isinstance(parent.targets[0], ast.Name):
                    for n in self.registries.get((m.rel, parent.targets[0].id), []):
                        if n not in exp["tools"]:
                            exp["tools"].append(n)
                continue
            if isinstance(call.func, ast.Attribute) and call.func.attr in ("add_plugin", "add_function", "add_plugins") and \
                    any(framework_of(v) == "semantic-kernel" for v in m.imports.values()):
                attr = call.func.attr
                if attr == "add_plugin" and kw(call, "parent_directory") is not None and not call.args and kw(call, "plugin") is None:
                    self.toolkit_sites.append("%s:%d add_plugin(parent_directory=...), prompt functions loaded from a directory" % (m.rel, call.lineno))
                    continue
                arg = (kw(call, "function") if attr == "add_function" else
                       kw(call, "plugins") if attr == "add_plugins" else kw(call, "plugin")) or (
                    call.args[1] if attr == "add_function" and len(call.args) > 1 else call.args[0] if call.args and attr != "add_function" else None)
                if arg is None or (attr == "add_function" and kw(call, "prompt") is not None):
                    continue
                self.sk_exposure(m, call, "%s.%s(...) (semantic_kernel)" % (unparse(call.func.value)[:40], attr), [arg])
                continue
            if fw == "dspy" and name in ("ReAct", "CodeAct"):
                expr = tools if tools is not None else (call.args[1] if len(call.args) > 1 else None)
                if expr is None:
                    continue
                exp = self.add_exposure(m, call, "dspy.%s(signature, tools=[...])" % name, "dspy", expr)
                if name == "CodeAct":
                    self.generated_code_sites.append("%s:%d CodeAct" % (m.rel, call.lineno))
                    exp["note"] = str(exp["note"]) + ("; CodeAct calls these tools from Python the model writes: each call "
                                                      "happens inside generated code, and no per-call dispatch is in this source")
                else:
                    exp["note"] = str(exp["note"]) + "; ReAct runs these tools and DSPy documents no pre-call hook (K3: wrap each function)"
                continue
            if fw == "smolagents" and name in ("CodeAgent", "ToolCallingAgent") and (tools is not None or call.args):
                expr = tools if tools is not None else call.args[0]
                exp = self.add_exposure(m, call, "%s(tools=[...]) from smolagents" % name, "smolagents", expr)
                if name == "CodeAgent":
                    self.generated_code_sites.append("%s:%d CodeAgent" % (m.rel, call.lineno))
                    exp["note"] = str(exp["note"]) + ("; CodeAgent calls these tools from Python the model writes: each call "
                                                      "happens inside generated code, and no per-call dispatch is in this source")
                else:
                    exp["note"] = str(exp["note"]) + ("; the agent runs these tools; smolagents has no pre-call hook "
                                                      "(step_callbacks run per step), K3: wrap each tool's forward")
                if isinstance(kw(call, "add_base_tools"), ast.Constant) and getattr(kw(call, "add_base_tools"), "value", None) is True:
                    exp["note"] = str(exp["note"]) + "; add_base_tools=True adds smolagents' default toolbox, not listed here"
                continue
            if fw == "llamaindex" and (name in ("FunctionAgent", "ReActAgent", "CodeActAgent", "OpenAIAgent", "AgentRunner")
                                       or q.endswith(("from_tools_or_functions", "ReActAgent.from_tools", "OpenAIAgent.from_tools"))):
                expr = tools if tools is not None else (kw(call, "tools_or_functions") or (call.args[0] if call.args else None))
                if expr is None:
                    continue
                shown = ".".join(q.split(".")[-2:]) if name.startswith("from_") else name
                exp = self.add_exposure(m, call, "%s(tools=[...]) from llama_index" % shown, "llamaindex", expr)
                if name == "CodeActAgent":
                    self.generated_code_sites.append("%s:%d CodeActAgent" % (m.rel, call.lineno))
                    exp["note"] = str(exp["note"]) + ("; CodeActAgent calls these tools from Python the model writes: each call "
                                                      "happens inside generated code, and no per-call dispatch is in this source")
                else:
                    exp["note"] = str(exp["note"]) + ("; the agent runs these tools and LlamaIndex documents no pre-execution hook "
                                                      "(K3: wrap each function before it is registered)")
                continue
            if fw == "strands" and name in ("Agent", "BidiAgent") and tools is not None:
                exp = self.add_exposure(m, call, "%s(tools=[...]) from %s" % (name, q.rsplit(".", 1)[0]), "strands", tools)
                hp = kw(call, "hooks") if kw(call, "hooks") is not None else kw(call, "plugins")
                mk = marker_node(m.tree, ["BeforeToolCallEvent"])
                exp["_icpt"] = point("K1", "a BeforeToolCallEvent hook", hp is not None or mk is not None,
                                     m.ref(hp) if hp is not None else m.ref(mk) if mk is not None else None)
                if kw(call, "hooks") is not None or kw(call, "plugins") is not None:
                    exp["note"] = str(exp["note"]) + ("; hooks= or plugins= is registered on this agent (a BeforeToolCallEvent "
                                                      "handler can cancel a call, K1)")
                elif "BeforeToolCallEvent" in m.source:
                    exp["note"] = str(exp["note"]) + "; a BeforeToolCallEvent handler is written in this file (it can cancel a call, K1)"
                else:
                    exp["note"] = str(exp["note"]) + "; no hooks= on this agent (K1 would be a BeforeToolCallEvent handler)"
                continue
            if fw == "adk" and name in ("Agent", "LlmAgent") and tools is not None:
                exp = self.add_exposure(m, call, "%s(tools=[...]) from %s" % (name, q.rsplit(".", 1)[0]), "adk", tools)
                cb = kw(call, "before_tool_callback")
                exp["_icpt"] = point("K1", "a before_tool_callback on the agent", cb is not None, m.ref(cb) if cb is not None else None)
                exp["note"] = str(exp["note"]) + (
                    "; before_tool_callback= is registered on this agent (a non-None return skips the tool call, K1)"
                    if kw(call, "before_tool_callback") is not None else
                    "; no before_tool_callback= on this agent (K1 would be a before_tool_callback, or a plugin's)")
                continue
            if fw == "haystack" and tools is not None and name not in ("Toolset", "SearchableToolset"):
                exp = self.add_exposure(m, call, "%s(tools=[...]) from %s" % (name, q.rsplit(".", 1)[0]), "haystack", tools)
                if name == "Agent":
                    hk = kw(call, "hooks")
                    exp["_icpt"] = point("K1", "a before_tool hook on the Agent", hk is not None, m.ref(hk) if hk is not None else None)
                    exp["note"] = str(exp["note"]) + ("; hooks= is registered on this Agent (a before_tool hook can confirm, modify or "
                                                      "reject a call before it runs, K1)" if kw(call, "hooks") is not None else
                                                      "; no hooks= on this Agent (K1 would be a before_tool hook)")
                elif name == "ToolInvoker":
                    exp["note"] = ("ToolInvoker RUNS the model's calls to these tools in this pipeline; they are offered to the model "
                                   "where the chat generator is given them" + ("" if exp["kind"] == "static" else
                                   "; the list is computed at runtime"))
                continue
            if fw == "semantic-kernel" and kw(call, "plugins") is not None:
                self.sk_exposure(m, call, "%s(plugins=[...]) from %s" % (name, q.rsplit(".", 1)[0]), [kw(call, "plugins")])
                continue
            if fw == "ag2" and name == "register_function":
                n = self.call_tool(m, call)
                self.exposures.append({
                    "at": m.ref(call), "via": "register_function(caller=%s) from autogen" % unparse(kw(call, "caller") or ast.Name(id="?")),
                    "kind": "static", "tools": [n] if n else [], "_sdk": "ag2", "_expr": "",
                    "note": "the caller agent's model is offered this function; the executor agent runs it (K3: wrap the function before it is registered)",
                })
                continue
            if fw == "ag2" and (name.endswith("Agent") or name == "Agent"):
                self.ag2_exposure(m, call, q, name)
                continue
            if fw == "agent-framework" and name in ("Agent", "ChatAgent", "AssistantAgent") and tools is not None:
                self.af_exposure(m, call, "%s(tools=[...]) from %s" % (name, q.rsplit(".", 1)[0]), tools)
                continue
            if (isinstance(call.func, ast.Attribute) and call.func.attr in ("as_agent", "create_agent") and tools is not None
                    and self.client_of(m, self.chain(call.func)[1], call.func)[0] == "agent-framework"):
                self.af_exposure(m, call, "%s(tools=[...]) on an agent_framework chat client" % call.func.attr, tools)
                continue
            if fw == "claude-agent-sdk" and name in ("ClaudeAgentOptions", "AgentDefinition"):
                self.claude_options_exposure(m, call, name)
                continue
            if fw == "crewai" and name in ("Agent", "Task") and tools is not None:
                self.add_exposure(m, call, "%s(tools=[...]) from crewai" % name, "crewai", tools)
                continue
            if fw == "langchain" and name in ("create_agent", "create_react_agent", "ToolNode"):
                idx = 0 if name == "ToolNode" else 1
                expr = tools if tools is not None else (call.args[idx] if len(call.args) > idx else None)
                if expr is not None:
                    self.add_exposure(m, call, "%s(tools) from %s" % (name, q.rsplit(".", 1)[0]), "langchain", expr)
                continue
            if isinstance(call.func, ast.Attribute) and call.func.attr == "bind_tools":
                expr = tools if tools is not None else (call.args[0] if call.args else None)
                self.add_exposure(m, call, "%s.bind_tools([...]) (LangChain chat model)" % unparse(call.func.value)[:40], "langchain", expr)
                continue
            if not isinstance(call.func, ast.Attribute):
                continue
            attrs, base = self.chain(call.func)
            meth = attrs[-1] if attrs else ""
            client_fw, compat = self.client_of(m, base, call.func)
            dotted = ".".join(attrs)
            if meth in ("converse", "converse_stream") and kw(call, "toolConfig") is not None:
                if self.bedrock_exposure(m, call, meth):
                    continue
            if meth == "run" and isinstance(call.func.value, ast.Name):
                ctor = self.var_ctor(m, call.func.value.id)
                if ctor is not None and framework_of(ctor[0]) == "mcp" and last(ctor[0]) in ("MCPServer", "FastMCP"):
                    key = (ctor[1].rel, call.func.value.id)
                    names = self.registries.get(key, [])
                    transport = const_str(kw(call, "transport")) or "stdio"
                    self.exposures.append({
                        "at": m.ref(call), "via": "%s.run(transport=%r) (MCP server)" % (call.func.value.id, transport),
                        "kind": "static", "tools": list(names), "_sdk": "mcp", "_expr": "",
                        "note": "every tool registered on this server is offered to every MCP client that connects",
                    })
                continue
            if tools is None and not (meth in ("generate_content", "generate_content_stream") or dotted.endswith("chats.create")):
                continue
            sdk = self.method_sdk(attrs, meth, dotted, client_fw)
            if sdk is None:
                continue
            if sdk == "gemini":
                cfg = kw(call, "config")
                cm, cval = self.resolve_value(m, cfg) if cfg is not None else (m, None)
                expr = tools
                if isinstance(cval, ast.Call) and last(cm.qual(cval.func)) == "GenerateContentConfig":
                    self.consumed_configs.add(id(cval))
                    expr = kw(cval, "tools")
                    m_for = cm
                else:
                    m_for = m
                if expr is None:
                    continue
                self.add_exposure(m_for, call, "%s(config=GenerateContentConfig(tools=[...])) (google-genai)" % dotted, "gemini", expr)
                continue
            if sdk in NATIVE_OPENAI_SHAPE:
                self.add_exposure(m, call, "%s(tools=[...]) (%s)" % (dotted, "mistralai" if sdk == "mistral" else "cohere"), sdk, tools)
                continue
            if sdk == "openai":
                via = "%s(tools=[...]) (%s)" % (dotted, "OpenAI-compatible client, base_url set" if compat else "openai")
            else:
                via = "%s(tools=[...]) (anthropic)" % dotted
            exp = self.add_exposure(m, call, via, sdk, tools)
            if sdk == "openai" and compat:
                for n in exp["tools"]:
                    t = self.tool_index.get(n)
                    if t is not None and t["sdk"] == "openai" and "OpenAI-compatible" not in str(t["via"]):
                        t["via"] = str(t["via"]) + ", on an OpenAI-compatible client"
        self._pending_configs = getattr(self, "_pending_configs", []) + [(m, c) for c in configs]

    def value_of(self, m: Module, e: Optional[ast.expr]) -> Tuple[Module, Optional[ast.expr]]:
        """A Name or a `self.x` followed to the value assigned to it, when the source says."""
        if e is None:
            return m, None
        if isinstance(e, ast.Attribute) and isinstance(e.value, ast.Name) and e.value.id in ("self", "cls"):
            found = self.self_attr(m, e)
            if found is None or found[1] is None:
                return m, e
            m, e = found[0], found[1]
        return self.resolve_value(m, e)

    def boto3_service(self, m: Module, recv: ast.expr) -> Optional[str]:
        """The service name a boto3 client was built for (`boto3.client("bedrock-runtime")`,
        `session.client(...)`), read from the constant; None when the source does not say."""
        vm, value = self.value_of(m, recv)
        if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr == "client":
            q = vm.qual(value.func) or ""
            base = self.value_of(vm, value.func.value)[1]
            from_boto = q.startswith("boto3") or q.startswith("aioboto3") or (
                isinstance(base, ast.Call) and (vm.qual(base.func) or "").startswith(("boto3", "aioboto3")))
            if from_boto:
                return self.const_name(vm, value.args[0] if value.args else kw(value, "service_name"), value)
        return None

    def bedrock_exposure(self, m: Module, call: ast.Call, meth: str) -> bool:
        """`client.converse(toolConfig={"tools": [...]})` (record 3.9). The method name and the
        `toolConfig` keyword are the signature; a receiver the source shows was built for another
        AWS service is not a model call."""
        assert isinstance(call.func, ast.Attribute)
        service = self.boto3_service(m, call.func.value)
        if service is not None and service != "bedrock-runtime":
            return False
        cm, cfg = self.value_of(m, kw(call, "toolConfig"))
        tools_expr: Optional[ast.expr] = kw(call, "toolConfig")
        if isinstance(cfg, ast.Dict):
            tools_expr = dict_get(cfg, "tools")
        else:
            cm = m
        client = "a bedrock-runtime client" if service else "a client the scan could not type"
        self.add_exposure(cm, call, "%s(toolConfig={\"tools\": [...]}) on %s (Bedrock Converse; the application dispatches)"
                          % (meth, client), "bedrock", tools_expr)
        # The exposure's place is the call, even when the list was read in another module.
        self.exposures[-1]["at"] = m.ref(call)
        return True

    def flush_configs(self) -> None:
        for m, c in getattr(self, "_pending_configs", []):
            if id(c) in self.consumed_configs or kw(c, "tools") is None:
                continue
            self.add_exposure(m, c, "GenerateContentConfig(tools=[...]) (google-genai)", "gemini", kw(c, "tools"))

    # ---- dispatchers and gates -----------------------------------------
    def name_chain(self, fn: ast.AST) -> Dict[str, Tuple[List[str], ast.AST]]:
        """Per compared expression, the string constants an if/elif chain or match compares it to."""
        found: Dict[str, Tuple[List[str], ast.AST]] = {}

        def note(left: ast.expr, value: Optional[str], at: ast.AST) -> None:
            if value is None:
                return
            key = unparse(left)
            entry = found.setdefault(key, ([], at))
            if value not in entry[0]:
                entry[0].append(value)

        for node in ast.walk(fn):
            if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
                a, b = node.left, node.comparators[0]
                if const_str(b) is not None and not isinstance(a, ast.Constant):
                    note(a, const_str(b), node)
                elif const_str(a) is not None:
                    note(b, const_str(a), node)
            match_cls = getattr(ast, "Match", None)
            if match_cls is not None and isinstance(node, match_cls):
                for case in node.cases:
                    pat = case.pattern
                    pats = pat.patterns if isinstance(pat, getattr(ast, "MatchOr")) else [pat]
                    for p in pats:
                        if isinstance(p, getattr(ast, "MatchValue")):
                            note(node.subject, const_str(p.value), node)
        return found

    # ---- the loop over the model's reply (ACP-481) ---------------------
    # Tools in the Anthropic Messages format and OpenAI function tools carry no run body:
    # the application reads the model's reply and runs each request itself, often as
    # `run_tool(block.name, block.input)` into a handler map, where no if/elif names the
    # tools. Python has no types to say what `block` is, so the request is FOLLOWED inside
    # one function body (or a module's top level), every link read from the tree: a model
    # call on a client of the SDK -> the reply's tool requests (`reply.content`,
    # `reply.choices[i].message.tool_calls`, `reply.output`) -> the loop or comprehension
    # variable over them -> a call to an application function passed that request's name
    # and its input. `.name` and `.input` on a value the chain does not reach claim nothing.
    # Plain assignments inside the same body are followed; a reply that arrives as a
    # PARAMETER is not (the function it came from is not read), and neither is a request
    # taken by index (`reply.content[0]`) rather than by a loop.

    def reply_dispatch_calls(self, m: Module) -> List[Tuple[Module, ast.AST, str]]:
        """Per call in `m` that passes a reply's tool request's name and input to an
        application function: (the callee's module, its def, the SDK)."""
        if not any(("%s." % t[1][0]) in m.source for t in REPLY_CALLS):
            return []
        out: List[Tuple[Module, ast.AST, str]] = []
        scopes: List[ast.AST] = [m.tree] + [n for n in m.nodes if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        for scope in scopes:
            _ReplyScope(self, m, scope).dispatches(out)
        return out

    def pass_dispatchers(self) -> None:
        tool_names = {str(t["name"]) for t in self.tools}
        by_name: Dict[str, Dict[str, object]] = {}
        for m in self.modules:
            module_has_marker = any(s in m.source for s in DISPATCH_MARKERS)
            # A dispatcher compares a name to tool names or sits beside a tool_use
            # loop; a module that quotes no tool name and carries no marker holds none.
            if not module_has_marker and not any(('"%s"' % n) in m.source or ("'%s'" % n) in m.source for n in tool_names):
                continue
            framework_module = any(framework_of(q) not in (None, "instructor") for q in m.imports.values())
            for fn in m.nodes:
                if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if fn.name.startswith("__"):
                    continue
                chains = self.name_chain(fn)
                best: List[str] = []
                for key, (consts, _at) in chains.items():
                    if key.endswith(".type") or key == "type":
                        continue
                    if len(consts) < 2:
                        continue
                    hits = [c for c in consts if c in tool_names]
                    # Two known tool names in one chain; or a tool_use/function_call
                    # module that names one; or, when the names are not literal
                    # anywhere (a registry), a marker module that imports a framework.
                    # In that last case the compared value must itself be a name
                    # (`name`, `tool_name`, `block.name`): fastmcp's
                    # `if tool_choice == "auto"` converters were reported without it,
                    # and the 3.11 stdlib's test_argparse without the import rule.
                    names_a_tool = "name" in key.rsplit(".", 1)[-1].lower()
                    if len(hits) >= 2 or (hits and module_has_marker) or (module_has_marker and framework_module and names_a_tool):
                        if len(hits or consts) > len(best):
                            best = hits if hits else consts
                if not best:
                    continue
                hits = [c for c in best if c in tool_names]
                d = {
                    "name": fn.name, "at": m.ref(fn),
                    "signature": "(%s)" % unparse(fn.args),
                    "callers": [], "tools_delegating": len(hits),
                    "_rel": m.rel,
                }
                by_name.setdefault(fn.name, d)
                self.dispatcher_nodes.add(id(fn))
                for h in hits:
                    t = self.tool_index.get(h)
                    if t is not None and "delegates_to" not in t:
                        t["delegates_to"] = fn.name
        # A function every tool body calls with the tool's name (or a name variable) first.
        counts: Dict[Tuple[str, str], List[str]] = {}
        for t in self.tools:
            ex = t.get("execute_at")
            if not isinstance(ex, dict):
                continue
            m = None
            at_line = None
            for x in self.modules:
                at_line = x.matches_ref(ex)
                if at_line is not None:
                    m = x
                    break
            if m is None:
                continue
            fn = next((n for n in m.nodes if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                       and n.lineno == at_line), None)
            if fn is None:
                continue
            for call in ast.walk(fn):
                if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or not call.args:
                    continue
                a0 = call.args[0]
                if not (const_str(a0) == t["name"] or isinstance(a0, ast.Name)):
                    continue
                target = self.resolve_def(m, call.func.id)
                if target is None:
                    continue
                key = (target[0].rel, call.func.id)
                lst = counts.setdefault(key, [])
                if t["name"] not in lst:
                    lst.append(str(t["name"]))
        for (rel, name), tnames in counts.items():
            if len(tnames) < 2:
                continue
            m = next(x for x in self.modules if x.rel == rel)
            fn = m.defs[name]
            self.dispatcher_nodes.add(id(fn))
            d = by_name.get(name)
            if d is None:
                d = {"name": name, "at": m.ref(fn), "signature": "(%s)" % unparse(fn.args),
                     "callers": [], "tools_delegating": 0, "_rel": rel}
                by_name[name] = d
            d["tools_delegating"] = max(int(d["tools_delegating"]), len(tnames))
            for n in tnames:
                t = self.tool_index.get(n)
                if t is not None:
                    t["delegates_to"] = name
        # A function the loop over the model's reply passes a tool request to runs every
        # tool of that SDK with no run body of its own; one such call is enough (ACP-481).
        for m in self.modules:
            for cm, fn, sdk in self.reply_dispatch_calls(m):
                bodiless = [t for t in self.tools if t.get("sdk") == sdk and "execute_at" not in t]
                if not bodiless:
                    continue
                name = getattr(fn, "name", "")
                self.dispatcher_nodes.add(id(fn))
                d = by_name.get(name)
                if d is None:
                    d = {"name": name, "at": cm.ref(fn), "signature": "(%s)" % unparse(getattr(fn, "args")),
                         "callers": [], "tools_delegating": 0, "_rel": cm.rel}
                    by_name[name] = d
                for t in bodiless:
                    if "delegates_to" not in t:
                        t["delegates_to"] = name
                took = sum(1 for t in bodiless if t.get("delegates_to") == name)
                d["tools_delegating"] = max(int(d["tools_delegating"]), took)
        for d in by_name.values():
            callers: List[Dict[str, object]] = []
            checks: List[Dict[str, object]] = []
            for m in self.modules:
                for call in m.nodes:
                    if not isinstance(call, ast.Call):
                        continue
                    f = call.func
                    if (isinstance(f, ast.Name) and f.id == d["name"]) or (isinstance(f, ast.Attribute) and f.attr == d["name"]):
                        callers.append(m.ref(call))
                        checks.append(self.caller_check(m, call))
            d["callers"] = callers
            d["caller_checks"] = checks
            del d["_rel"]
            self.dispatchers.append(d)

    # ---- the check before a dispatcher call ----------------------------
    def caller_check(self, m: Module, call: ast.Call) -> Dict[str, object]:
        """What the function around ONE dispatcher call tests before it: the last test
        (`if`, `while`, `assert`, a conditional expression, a comprehension's `if`) that
        starts before the call and reads a confirmation name. A name assigned, returned or
        written after the call is not a test before it."""
        encl: Optional[ast.AST] = None
        cur = m.parents.get(id(call))
        while cur is not None:
            if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                encl = cur
                break
            cur = m.parents.get(id(cur))
        entry: Dict[str, object] = {
            "caller": m.ref(call),
            "in_function": encl.name if isinstance(encl, (ast.FunctionDef, ast.AsyncFunctionDef)) else "",
        }
        scope: ast.AST = encl if encl is not None else m.tree
        if isinstance(scope, ast.Lambda):
            nodes: List[ast.AST] = list(ast.walk(scope.body))
        else:
            nodes = body_nodes(scope)
        where = (call.lineno, call.col_offset)
        names = CHECK_NAMES["confirmation_names"]
        found: Optional[Tuple[Tuple[int, int], ast.AST, str]] = None
        for node in nodes:
            tests: List[ast.expr] = []
            if isinstance(node, (ast.If, ast.While, ast.IfExp, ast.Assert)):
                tests = [node.test]
            elif isinstance(node, ast.comprehension):
                tests = list(node.ifs)
            for test in tests:
                for sub in ast.walk(test):
                    read = name_read(sub)
                    if read is None or read not in names:
                        continue
                    at = (sub.lineno, sub.col_offset)
                    # Before the call: the test starts before it (an `if confirmed:` whose
                    # body holds the call counts; a test that starts after it does not).
                    if (test.lineno, test.col_offset) >= where:
                        continue
                    if found is None or at > found[0]:
                        found = (at, sub, read)
        if found is not None:
            entry["check"] = {"at": m.ref(found[1]), "reads": found[2]}
        return entry

    # ---- a tool running another tool -----------------------------------
    def enclosing_class(self, m: Module, node: ast.AST) -> Optional[ast.ClassDef]:
        cur = m.parents.get(id(node))
        while cur is not None and not isinstance(cur, ast.ClassDef):
            cur = m.parents.get(id(cur))
        return cur if isinstance(cur, ast.ClassDef) else None

    def callee_def(self, m: Module, call: ast.Call, fn: ast.AST) -> Optional[Tuple[Module, ast.AST]]:
        """The application's own function a call runs, when the source names it: a function
        in this module or imported from one in the tree, a method on `self`/`cls`, a function
        of a local module reached by attribute (`helpers.do()`)."""
        f = call.func
        if isinstance(f, ast.Name):
            return self.resolve_def(m, f.id)
        if not isinstance(f, ast.Attribute):
            return None
        if isinstance(f.value, ast.Name) and f.value.id in ("self", "cls"):
            cls = self.enclosing_class(m, fn)
            if cls is None:
                return None
            for st in cls.body:
                if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and st.name == f.attr:
                    return m, st
            return None
        if isinstance(f.value, ast.Name):
            # `SearchTools.search(q)`: a function on a class of the application, called by the class's name.
            owner = self.resolve_class(m, f.value.id)
            if owner is not None:
                for st in owner[1].body:
                    if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and st.name == f.attr:
                        return owner[0], st
                return None
        q = m.qual(f)
        if q and "." in q and framework_of(q) is None:
            mod, attr = q.rsplit(".", 1)
            tm = self.module_named(mod)
            if tm is not None and attr in tm.defs:
                return tm, tm.defs[attr]
        return None

    def tool_object(self, m: Module, expr: ast.expr, runs_class: bool) -> Optional[str]:
        """The tool an expression names: a tool's run function, a variable holding a tool
        built by a call, a tool class (only when `runs_class`, i.e. a method is called on
        it: calling a class builds an instance, it does not run the tool)."""
        if isinstance(expr, ast.Call) and runs_class and isinstance(expr.func, ast.Name):
            cls = self.resolve_class(m, expr.func.id)
            return self.tool_by_node.get(id(cls[1])) if cls is not None else None
        if not isinstance(expr, ast.Name):
            return None
        found = self.resolve_def(m, expr.id)
        if found is not None:
            return self.run_nodes.get(id(found[1])) or self.tool_by_node.get(id(found[1]))
        if runs_class:
            cls = self.resolve_class(m, expr.id)
            if cls is not None and id(cls[1]) in self.tool_by_node:
                return self.tool_by_node[id(cls[1])]
        vm, value = self.resolve_value(m, expr)
        if value is not expr:
            if id(value) in self.tool_by_node:
                return self.tool_by_node[id(value)]
            if runs_class and isinstance(value, ast.Call):
                return self.tool_object(vm, value, True)
        return None

    def is_tool_map(self, m: Module, mapping: ast.expr) -> bool:
        name = name_read(mapping) if isinstance(mapping, (ast.Name, ast.Attribute)) else None
        if name is not None and TOOL_MAP_NAME.search(name):
            return True
        if isinstance(mapping, ast.Name):
            vm, value = self.resolve_value(m, mapping)
            if isinstance(value, ast.Dict):
                return any(v is not None and self.tool_object(vm, v, False) is not None for v in value.values)
        return False

    def lookup_call(self, m: Module, call: ast.Call) -> Optional[Tuple[Optional[str]]]:
        """A call of something taken from a tools map by key: `TOOLS[name](...)`,
        `registry.get(name).run(...)`, `tool_map[name].invoke(...)`. The key when literal."""
        f: ast.expr = call.func
        if isinstance(f, ast.Attribute) and f.attr in RUN_METHODS:
            f = f.value
        mapping: Optional[ast.expr] = None
        key: Optional[ast.expr] = None
        if isinstance(f, ast.Subscript):
            mapping, key = f.value, f.slice
        elif isinstance(f, ast.Call) and isinstance(f.func, ast.Attribute) and f.func.attr == "get" and f.args:
            mapping, key = f.func.value, f.args[0]
        if mapping is None or key is None or not self.is_tool_map(m, mapping):
            return None
        return (const_str(key),)

    def pass_tool_calls(self) -> None:
        """`CodeTool.calls`: from each tool's run function, the calls that run ANOTHER tool
        without passing the dispatcher -- the tool's own function called by name (directly
        or through an import), a tool object's run method, or a callable taken from a tools
        map. The walk follows the application's own functions `CALL_DEPTH` deep and never
        enters a dispatcher: a call through it is decided there, which is the point."""
        for m0, fn0, tool in self.tool_runs:
            outer = str(tool["name"])
            calls: List[Dict[str, object]] = []
            seen_calls: Set[Tuple[str, str, int, int, str]] = set()
            visited: Set[int] = {id(fn0)}

            def record(m: Module, call: ast.Call, via: str, inner: Optional[str], through: List[str]) -> None:
                at = m.ref(call)
                k = (via, str(at["file"]), int(str(at["line"])), int(str(at["col"])), inner or "")
                if k in seen_calls:
                    return
                seen_calls.add(k)
                c: Dict[str, object] = {"at": at, "via": via, "through": list(through)}
                if inner is not None:
                    c["tool"] = inner
                calls.append(c)

            def visit(m: Module, fn: ast.AST, through: List[str]) -> None:
                for call in body_nodes(fn):
                    if not isinstance(call, ast.Call):
                        continue
                    f = call.func
                    inner: Optional[str] = None
                    if isinstance(f, ast.Attribute) and f.attr in RUN_METHODS:
                        inner = self.tool_object(m, f.value, True)
                    if inner is None:
                        inner = self.tool_object(m, f, False)
                    if inner is not None:
                        if inner != outer:
                            record(m, call, "direct", inner, through)
                        continue
                    lk = self.lookup_call(m, call)
                    if lk is not None:
                        record(m, call, "lookup", lk[0], through)
                        continue
                    if len(through) >= CALL_DEPTH:
                        continue
                    target = self.callee_def(m, call, fn)
                    if target is None:
                        continue
                    tid = id(target[1])
                    if tid in visited or tid in self.dispatcher_nodes or tid in self.run_nodes:
                        continue
                    visited.add(tid)
                    visit(target[0], target[1], through + [getattr(target[1], "name", "?")])

            visit(m0, fn0, [])
            if calls:
                tool["calls"] = calls

    def pass_gates(self) -> None:
        tool_list_names: Set[str] = set()
        for e in self.exposures:
            expr = str(e.get("_expr", ""))
            if expr.isidentifier():
                tool_list_names.add(expr)
        for m in self.modules:
            for name, value in m.assigns.items():
                if isinstance(value, (ast.List, ast.Tuple)) and any(id(x) in self.tool_by_node for x in value.elts):
                    tool_list_names.add(name)
            for node in m.nodes:
                if not isinstance(node, (ast.ListComp, ast.GeneratorExp)):
                    continue
                gen = node.generators[0]
                if not (isinstance(gen.iter, ast.Name) and gen.iter.id in tool_list_names) or not gen.ifs:
                    continue
                callee = None
                for cond in gen.ifs:
                    for c in ast.walk(cond):
                        if isinstance(c, ast.Call):
                            f = c.func
                            root = f
                            while isinstance(root, ast.Attribute):
                                root = root.value
                            local = isinstance(f, ast.Name) and f.id in m.defs and f.id not in m.imports
                            builtin = isinstance(f, ast.Name) and f.id not in m.imports and hasattr(builtins, f.id)
                            if not local and not builtin:
                                callee = unparse(f)
                                break
                    if callee:
                        break
                if not callee:
                    continue
                encl = m.enclosing_function(node)
                gname = encl.name if encl is not None else gen.iter.id
                self.gates.append({
                    "name": gname, "at": m.ref(node),
                    "note": "the tools in %s offered to the model are filtered by %s() at runtime; the scan lists what CAN be exposed"
                            % (gen.iter.id, callee),
                })
                for e in self.exposures:
                    ex = str(e.get("_expr", ""))
                    if ex.startswith(gname + "("):
                        e["note"] = ("exposure is decided at runtime by %s, which filters %s through %s(); "
                                     "the scan lists what CAN be exposed" % (gname, gen.iter.id, callee))

    def relabel_native(self) -> None:
        """An OpenAI-shaped dict every exposure of which is a Mistral (or Cohere) call is that SDK's tool."""
        by_tool: Dict[str, Set[str]] = {}
        for e in self.exposures:
            for n in e["tools"]:
                by_tool.setdefault(str(n), set()).add(str(e.get("_sdk", "")))
        for t in self.tools:
            sdks = by_tool.get(str(t["name"]))
            if t["sdk"] != "openai" or not sdks or len(sdks) != 1:
                continue
            only = next(iter(sdks))
            if only in NATIVE_OPENAI_SHAPE and str(t["via"]).startswith('tools[] {"type": "function", "function"'):
                t["sdk"] = only
                t["via"] = NATIVE_OPENAI_SHAPE[only]

    # ---- skill loads (ACP-460) -----------------------------------------
    # The third signal: the application's code loads this file. Every rule below may only
    # ADD an entry: a load the scan cannot resolve is not reported, and nothing it reports
    # removes or relaxes anything elsewhere.
    def text_info(self, rel: str) -> Optional[Tuple[bool, str]]:
        """(skill-like, the body with front matter removed and whitespace collapsed), or None
        when unreadable. Skill-like: `SKILL.md`, an instruction file loaded by name, or front
        matter carrying both `name` and `description` (`SkillRead.found_by` `name`/`shape`)."""
        cache = self.__dict__.setdefault("_text_cache", {})
        if rel in cache:
            return cache[rel]
        info: Optional[Tuple[bool, str]] = None
        full = os.path.join(self.root, rel)
        try:
            if os.path.getsize(full) <= MAX_TEXT_BYTES:
                with open(full, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
                keys, body = front_matter(text)
                base = rel.rsplit("/", 1)[-1]
                skill_like = (base == "SKILL.md" or base in INSTRUCTION_NAMES or rel == COPILOT_FILE
                              or rel.endswith("/" + COPILOT_FILE) or ("name" in keys and "description" in keys))
                info = (skill_like, normalize_text(body))
        except OSError:
            info = None
        cache[rel] = info
        return info

    def module_assigns(self, m: Module) -> Dict[str, ast.expr]:
        """Assignments at module level only (not inside a def or class): a function's local
        `path` must not resolve another function's `path`."""
        cache = self.__dict__.setdefault("_mod_assigns", {})
        if m.rel in cache:
            return cache[m.rel]
        out: Dict[str, ast.expr] = {}
        for node in body_nodes(m.tree):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        out[t.id] = node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None and isinstance(node.target, ast.Name):
                out[node.target.id] = node.value
        cache[m.rel] = out
        return out

    def module_file(self, m: Module) -> str:
        return os.path.normpath(os.path.join(os.path.abspath(self.root), m.rel))

    def literal_path(self, m: Module, s: str) -> Optional[PathValue]:
        """A path written as a string. Relative: to the working directory, which the scan does
        not know, so both the scanned root and the module's own directory are tried (a guess
        that can only add). A pattern needs a literal directory before its first wildcard."""
        before = s.split(WILD, 1)[0]
        if WILD in s and before.strip("./") == "":
            return None
        if os.path.isabs(s):
            return PathValue([s], True, wild=WILD in s)
        root = os.path.abspath(self.root)
        here = os.path.dirname(self.module_file(m))
        pats = [os.path.join(root, s)] + ([os.path.join(here, s)] if here != root else [])
        return PathValue(pats, before.strip("./") != "" or WILD not in s, wild=WILD in s)

    def package_dir(self, m: Module, e: Optional[ast.expr]) -> Optional[PathValue]:
        """The directory of a package named to `importlib.resources`/`pkgutil`, when it is in the tree."""
        if isinstance(e, ast.Name) and e.id in ("__name__", "__package__"):
            return PathValue([os.path.dirname(self.module_file(m))], True, True)
        name = self.const_name(m, e, e) if e is not None else None
        if name is None:
            return None
        tm = self.module_named(name)
        if tm is None:
            return None
        return PathValue([os.path.dirname(self.module_file(tm))], True, True)

    def segment(self, m: Module, e: ast.expr, depth: int) -> Optional[List[str]]:
        """The values one path segment can take: literals, or WILD for a name a folder listing
        binds; None when it cannot be read."""
        s = self.const_name(m, e, e) if not isinstance(e, ast.Name) else const_str(e)
        if s is not None:
            return [s]
        if isinstance(e, ast.Name):
            b = self.bind(m, e, depth + 1)
            if b is None:
                return None
            kind, val = b
            if kind == "seg":
                return [WILD]
            if kind == "segs":
                return list(val)
            if kind == "expr":
                vm, ve = val
                return self.segment(vm, ve, depth + 1) if depth < 8 else None
            return None
        if isinstance(e, ast.JoinedStr):
            text = self.fstring(m, e, depth)
            return [text] if text is not None else None
        if isinstance(e, ast.Attribute) and e.attr in ("name", "stem"):
            b = self.pathval(m, e.value, depth + 1)
            return [WILD] if b is not None and b.wild else None
        return None

    def fstring(self, m: Module, e: ast.JoinedStr, depth: int) -> Optional[str]:
        """An f-string as a pattern: literal parts kept, ONE substitution the scan cannot read
        becomes WILD (`f"skills/{name}/SKILL.md"`); two unreadable substitutions name nothing."""
        out = ""
        wild = 0
        for part in e.values:
            s = const_str(part)
            if s is not None:
                out += s
                continue
            if isinstance(part, ast.FormattedValue):
                seg = self.segment(m, part.value, depth + 1)
                if seg is not None and len(seg) == 1:
                    out += seg[0]
                    wild += seg[0].count(WILD)
                    continue
                wild += 1
                out += WILD
        return out if wild <= 1 else None

    def join(self, m: Module, base: Optional[PathValue], parts: List[ast.expr], depth: int) -> Optional[PathValue]:
        if base is None:
            return None
        pats, lit, wild = list(base.pats), base.lit, base.wild
        for part in parts:
            seg = self.segment(m, part, depth + 1)
            if seg is None:
                if wild:
                    return None
                seg = [WILD]
            if any(WILD in x for x in seg):
                if not lit:
                    return None
                wild = True
            elif any(x.strip("./") for x in seg):
                lit = True
            pats = [os.path.join(p, x) for p in pats for x in seg]
            if len(pats) > 64:
                return None
        return PathValue(pats, lit, base.res, wild)

    def self_attr(self, m: Module, e: ast.Attribute) -> Optional[Tuple[Module, ast.expr]]:
        """`self.x` / `cls.x`: the class attribute, else the last `self.x = ...` in the class."""
        cls = self.enclosing_class(m, e)
        if cls is None:
            return None
        found: Optional[ast.expr] = None
        for st in cls.body:
            if isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == e.attr for t in st.targets):
                found = st.value
            elif isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name) and st.target.id == e.attr and st.value is not None:
                found = st.value
        if found is not None:
            return m, found
        for node in ast.walk(cls):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if (isinstance(t, ast.Attribute) and t.attr == e.attr and isinstance(t.value, ast.Name)
                            and t.value.id in ("self", "cls")):
                        found = node.value
        return (m, found) if found is not None else None

    def bind(self, m: Module, e: ast.Name, depth: int) -> Optional[Tuple[str, object]]:
        """What a name holds where it is read: a loop over a listing (`seg` a name, `segs` a
        literal list of names, `pv` a path), else the last assignment before it in the
        enclosing functions, else a module-level assignment, here or imported."""
        if depth > 8:
            return None
        n = e.id
        cur: ast.AST = e
        funcs: List[ast.AST] = []
        while True:
            p = m.parents.get(id(cur))
            if p is None:
                break
            if isinstance(p, (ast.For, ast.AsyncFor)) and cur is not p.iter and self.binds(p.target, n):
                return self.elements(m, p.iter, p.target, n, depth + 1)
            if isinstance(p, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
                for gen in p.generators:
                    if gen.iter is not cur and self.binds(gen.target, n):
                        return self.elements(m, gen.iter, gen.target, n, depth + 1)
            if isinstance(p, (ast.FunctionDef, ast.AsyncFunctionDef)):
                funcs.append(p)
            cur = p
        line = getattr(e, "lineno", 0)
        for fn in funcs:
            last_value: Optional[ast.expr] = None
            for node in body_nodes(fn):
                if getattr(node, "lineno", 0) >= line:
                    break
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == n for t in node.targets):
                    last_value = node.value
                elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == n and node.value is not None:
                    last_value = node.value
            if last_value is not None:
                return "expr", (m, last_value)
            assert isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef))
            a = fn.args
            positional = list(getattr(a, "posonlyargs", [])) + list(a.args)
            defaults = [None] * (len(positional) - len(a.defaults)) + list(a.defaults)
            for arg, default in list(zip(positional, defaults)) + list(zip(a.kwonlyargs, a.kw_defaults)):
                if arg.arg == n:
                    return ("expr", (m, default)) if default is not None else None
        assigns = self.module_assigns(m)
        if n in assigns and n not in m.imports:
            return "expr", (m, assigns[n])
        hop = self.resolve_imported(m, n)
        if hop is not None:
            ta = self.module_assigns(hop[0])
            if hop[1] in ta:
                return "expr", (hop[0], ta[hop[1]])
        return None

    @staticmethod
    def binds(target: ast.expr, n: str) -> bool:
        return any(isinstance(x, ast.Name) and x.id == n for x in ast.walk(target))

    def elements(self, m: Module, it: ast.expr, target: ast.expr, n: str, depth: int) -> Optional[Tuple[str, object]]:
        """What the loop variable `n` takes from iterating `it`."""
        if depth > 8:
            return None
        if isinstance(it, ast.Name):
            b = self.bind(m, it, depth + 1)
            if b is None:
                return None
            if b[0] == "seglist":
                return ("seg", None) if isinstance(target, ast.Name) else None
            if b[0] == "expr":
                vm, ve = b[1]  # type: ignore[misc]
                return self.elements(vm, ve, target, n, depth + 1)
            return None
        if isinstance(it, (ast.List, ast.Tuple, ast.Set)) and isinstance(target, ast.Name):
            vals = [const_str(x) for x in it.elts]
            if vals and all(v is not None for v in vals):
                return "segs", vals
            return None
        if not isinstance(it, ast.Call):
            return None
        q = m.qual(it.func)
        f = it.func
        if (isinstance(f, ast.Name) and f.id in ("sorted", "list", "reversed", "tuple", "set")) and it.args:
            return self.elements(m, it.args[0], target, n, depth + 1)
        if isinstance(f, ast.Name) and f.id == "enumerate" and it.args and isinstance(target, ast.Tuple) and len(target.elts) == 2:
            inner = target.elts[1]
            return self.elements(m, it.args[0], inner, n, depth + 1) if self.binds(inner, n) else None
        if q in ("glob.glob", "glob.iglob") and it.args and isinstance(target, ast.Name):
            pv = self.pathval(m, it.args[0], depth + 1)
            return ("pv", pv) if pv is not None else None
        if q == "os.listdir" and isinstance(target, ast.Name):
            return "seg", None
        if q == "os.walk" and it.args and isinstance(target, ast.Tuple) and len(target.elts) == 3:
            base = self.pathval(m, it.args[0], depth + 1)
            if base is None or not base.lit:
                return None
            t0, _t1, t2 = target.elts
            if isinstance(t0, ast.Name) and t0.id == n:
                return "pv", PathValue([os.path.join(p, "**") for p in base.pats], True, base.res, True)
            if isinstance(t2, ast.Name) and t2.id == n:
                return "seglist", None
            return None
        if isinstance(f, ast.Attribute) and f.attr in ("glob", "rglob", "iterdir") and isinstance(target, ast.Name):
            base = self.pathval(m, f.value, depth + 1)
            if base is None or not base.lit:
                return None
            if f.attr == "iterdir":
                pat = [WILD]
            else:
                p0 = const_str(it.args[0]) if it.args else None
                if p0 is None:
                    return None
                pat = (["**"] if f.attr == "rglob" else []) + [p0]
            return "pv", PathValue([os.path.join(p, *pat) for p in base.pats], True, base.res, True)
        return None

    def pathval(self, m: Module, e: Optional[ast.expr], depth: int = 0) -> Optional[PathValue]:
        """The files a path expression can name, from literals, `__file__`, `os.path.join`,
        `pathlib` joins, a package's resources, and the names that hold them."""
        if e is None or depth > 10:
            return None
        s = const_str(e)
        if s is not None:
            return self.literal_path(m, s)
        if isinstance(e, ast.Name):
            if e.id == "__file__":
                return PathValue([self.module_file(m)], True)
            b = self.bind(m, e, depth + 1)
            if b is None:
                return None
            if b[0] == "pv":
                pv = b[1]
                return pv if isinstance(pv, PathValue) else None
            if b[0] == "expr":
                vm, ve = b[1]  # type: ignore[misc]
                return self.pathval(vm, ve, depth + 1)
            return None
        if isinstance(e, ast.JoinedStr):
            text = self.fstring(m, e, depth)
            return self.literal_path(m, text) if text is not None else None
        if isinstance(e, ast.Attribute):
            if e.attr == "parent":
                base = self.pathval(m, e.value, depth + 1)
                return base.map(os.path.dirname) if base is not None else None
            if isinstance(e.value, ast.Name) and e.value.id in ("self", "cls"):
                v = self.self_attr(m, e)
                return self.pathval(v[0], v[1], depth + 1) if v is not None else None
            q = m.qual(e)
            if q and "." in q and framework_of(q) is None:
                mod, attr = q.rsplit(".", 1)
                tm = self.module_named(mod)
                if tm is not None:
                    ta = self.module_assigns(tm)
                    if attr in ta:
                        return self.pathval(tm, ta[attr], depth + 1)
            return None
        if isinstance(e, ast.Subscript) and isinstance(e.value, ast.Attribute) and e.value.attr == "parents":
            k = e.slice.value if isinstance(e.slice, ast.Constant) else None
            base = self.pathval(m, e.value.value, depth + 1)
            if base is None or not isinstance(k, int) or k < 0:
                return None
            def up(p: str) -> str:
                for _ in range(k + 1):
                    p = os.path.dirname(p)
                return p
            return base.map(up)
        if isinstance(e, ast.BinOp):
            if isinstance(e.op, ast.Div):
                return self.join(m, self.pathval(m, e.left, depth + 1), [e.right], depth)
            if isinstance(e.op, ast.Add):
                left = self.pathval(m, e.left, depth + 1)
                right = self.segment(m, e.right, depth + 1)
                if left is None or right is None or len(right) != 1 or WILD in right[0]:
                    return None
                return PathValue([p + right[0] for p in left.pats], left.lit or bool(right[0].strip("./")), left.res, left.wild)
            return None
        if not isinstance(e, ast.Call):
            return None
        q = m.qual(e.func) or (e.func.id if isinstance(e.func, ast.Name) else None)
        f = e.func
        if q in ("os.path.join", "posixpath.join", "ntpath.join") and e.args:
            return self.join(m, self.pathval(m, e.args[0], depth + 1), list(e.args[1:]), depth)
        if q == "os.path.dirname" and e.args:
            base = self.pathval(m, e.args[0], depth + 1)
            return base.map(os.path.dirname) if base is not None else None
        if q in ("os.path.abspath", "os.path.realpath", "os.path.normpath", "os.path.expanduser", "os.fspath", "str") and e.args:
            return self.pathval(m, e.args[0], depth + 1)
        if q in ("pathlib.Path", "pathlib.PurePath", "pathlib.PosixPath", "pathlib.PurePosixPath", "anyio.Path", "aiopath.AsyncPath") and e.args:
            return self.join(m, self.pathval(m, e.args[0], depth + 1), list(e.args[1:]), depth)
        if q in RESOURCE_FILES and e.args:
            return self.package_dir(m, e.args[0])
        if isinstance(f, ast.Attribute):
            if f.attr in ("resolve", "absolute", "expanduser") and not e.args:
                return self.pathval(m, f.value, depth + 1)
            if f.attr == "joinpath":
                return self.join(m, self.pathval(m, f.value, depth + 1), list(e.args), depth)
        return None

    def match_text(self, pv: PathValue) -> List[str]:
        """The text files under the root a path value names."""
        root = os.path.abspath(self.root)
        text_set = self.__dict__.setdefault("_text_set", set(self.text_files))
        out: List[str] = []
        for pat in pv.pats:
            pat = os.path.normpath(pat)
            if not (pat + os.sep).startswith(root + os.sep):
                continue
            rel = os.path.relpath(pat, root).replace(os.sep, "/")
            if WILD not in rel and "?" not in rel and "[" not in rel:
                if rel in text_set and rel not in out:
                    out.append(rel)
                continue
            segs = rel.split("/")
            fixed = []
            for x in segs:
                if any(c in x for c in "*?["):
                    break
                fixed.append(x)
            prefix = "/".join(fixed) + "/" if fixed else ""
            for t in self.text_files:
                if t.startswith(prefix) and t not in out and glob_match(segs, t.split("/")):
                    out.append(t)
        return out

    def read_sites(self, m: Module) -> List[Tuple[ast.Call, str, PathValue]]:
        """Every call in the module that reads a file: (the call, `read` or `imported`, what it names)."""
        out: List[Tuple[ast.Call, str, PathValue]] = []
        for call in m.nodes:
            if not isinstance(call, ast.Call):
                continue
            f = call.func
            q = m.qual(f)
            pv: Optional[PathValue] = None
            how = "read"
            if (isinstance(f, ast.Name) and f.id == "open" and "open" not in m.imports and "open" not in m.defs) or q in OPEN_CALLS:
                mode = call.args[1] if len(call.args) > 1 else kw(call, "mode")
                ms = const_str(mode) if mode is not None else "r"
                if ms is None or any(c in ms for c in "wax+"):
                    continue
                pv = self.pathval(m, call.args[0] if call.args else kw(call, "file"))
            elif q in RESOURCE_READS and len(call.args) >= 2:
                base = self.package_dir(m, call.args[0])
                pv = self.join(m, base, [call.args[1]], 0)
                how = "imported"
            elif isinstance(f, ast.Attribute) and f.attr in ("read_text", "read_bytes", "open"):
                if f.attr == "open":
                    mode = call.args[0] if call.args else kw(call, "mode")
                    ms = const_str(mode) if mode is not None else "r"
                    if ms is None or any(c in ms for c in "wax+"):
                        continue
                pv = self.pathval(m, f.value)
                if pv is not None and pv.res:
                    how = "imported"
            if pv is not None:
                out.append((call, how, pv))
        return out

    # -- where the loaded text goes ------------------------------------
    def model_call(self, m: Module, call: ast.Call) -> Optional[Tuple[str, Set[str], bool]]:
        """A call the front end recognises as a model call or an agent constructor: (a reader
        phrase, the keywords that carry instructions, whether it takes a message list)."""
        q = m.qual(call.func)
        fw = framework_of(q)
        if fw is not None and (fw, last(q)) in CTOR_INSTRUCTION_KWS:
            label, kws = CTOR_INSTRUCTION_KWS[(fw, last(q))]
            return label, kws, False
        if not isinstance(call.func, ast.Attribute):
            return None
        attrs, base = self.chain(call.func)
        meth = attrs[-1] if attrs else ""
        client_fw, _compat = self.client_of(m, base, call.func)
        dotted = ".".join(attrs)
        sdk = self.method_sdk(attrs, meth, dotted, client_fw)
        if sdk is not None:
            kws = set(METHOD_INSTRUCTION_KWS.get(sdk, set()))
            if sdk == "openai" and "responses" not in attrs:
                kws = set()
            return "%s(...) (%s)" % (dotted, sdk), kws, sdk != "gemini"
        if meth in LANGCHAIN_RUNS and any(framework_of(v) == "langchain" for v in m.imports.values()):
            return "%s(...) (LangChain)" % dotted, set(), True
        return None

    def sink(self, m: Module, call: ast.Call, kwname: Optional[str], sysmsg: bool) -> Optional[Dict[str, object]]:
        q = m.qual(call.func)
        at = m.ref(call)
        ref = {"file": at["file"], "line": at["line"]}
        if framework_of(q) == "langchain" and last(q) == "SystemMessage" and kwname in (None, "content"):
            return {"kind": "instructions", "at": ref, "via": "SystemMessage(...) from %s" % q.rsplit(".", 1)[0]}
        mc = self.model_call(m, call)
        if mc is None:
            return None
        label, kws, takes_messages = mc
        if not sysmsg and kwname in kws:
            return {"kind": "instructions", "at": ref, "via": "%s= on %s" % (kwname, label)}
        if sysmsg and takes_messages and (kwname is None or kwname in ("messages", "input", "contents")):
            return {"kind": "instructions", "at": ref, "via": "a system-role message passed to %s" % label}
        return None

    def calls_named(self, name: str) -> List[Tuple[Module, ast.Call]]:
        idx = self.__dict__.get("_calls_by_name")
        if idx is None:
            idx = {}
            for x in self.modules:
                for c in x.nodes:
                    if isinstance(c, ast.Call):
                        k = c.func.id if isinstance(c.func, ast.Name) else (c.func.attr if isinstance(c.func, ast.Attribute) else None)
                        if k:
                            idx.setdefault(k, []).append((x, c))
            self.__dict__["_calls_by_name"] = idx
        return idx.get(name, [])

    def name_uses(self, m: Module, name: str, scope: Optional[ast.AST]) -> List[Tuple[Module, ast.AST]]:
        """Where a name is read: inside `scope` (a function or a with block), or, for a
        module-level name, anywhere in the module and in the modules that import it."""
        out: List[Tuple[Module, ast.AST]] = []
        nodes = ast.walk(scope) if scope is not None else iter(m.nodes)
        for n in nodes:
            if isinstance(n, ast.Name) and n.id == name and isinstance(n.ctx, ast.Load):
                out.append((m, n))
        if scope is None:
            for x in self.modules:
                if x is m:
                    continue
                for local, q in x.imports.items():
                    if "." in q and q.rsplit(".", 1)[1] == name and self.module_named(q.rsplit(".", 1)[0]) is m:
                        out.extend((x, n) for n in x.nodes if isinstance(n, ast.Name) and n.id == local and isinstance(n.ctx, ast.Load))
        return out[:200]

    def flow_target(self, m: Module, t: ast.expr, depth: int, sysmsg: bool, seen: Set[int]) -> Optional[Dict[str, object]]:
        if isinstance(t, ast.Subscript):
            t = t.value
        if isinstance(t, ast.Name):
            fn = m.enclosing_function(t)
            for um, u in self.name_uses(m, t.id, fn):
                r = self.flow(um, u, depth + 1, sysmsg, seen)
                if r is not None:
                    return r
            return None
        if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id in ("self", "cls"):
            cls = self.enclosing_class(m, t)
            if cls is None:
                return None
            for u in ast.walk(cls):
                if (isinstance(u, ast.Attribute) and u.attr == t.attr and isinstance(u.ctx, ast.Load)
                        and isinstance(u.value, ast.Name) and u.value.id in ("self", "cls")):
                    r = self.flow(m, u, depth + 1, sysmsg, seen)
                    if r is not None:
                        return r
        return None

    def flow(self, m: Module, node: ast.AST, depth: int = 0, sysmsg: bool = False,
             seen: Optional[Set[int]] = None) -> Optional[Dict[str, object]]:
        """Where a text value goes, as far as the source says: up through the expressions that
        keep it text, into a name and its reads, out of a function and into its callers, at most
        CALL_DEPTH hops. The first model instruction or tool result it reaches, or None, which
        means NOT FOLLOWED, never "goes nowhere"."""
        if seen is None:
            seen = set()
        if depth > CALL_DEPTH or id(node) in seen:
            return None
        seen.add(id(node))
        cur: ast.AST = node
        while True:
            p = m.parents.get(id(cur))
            if p is None:
                return None
            if isinstance(p, ast.Attribute) and p.value is cur:
                gp = m.parents.get(id(p))
                if isinstance(gp, ast.Call) and gp.func is p:
                    if p.attr in CONTAINER_ADDS:
                        return None   # the text is the receiver of append: not a text value
                    cur = gp
                    continue
                return None
            if isinstance(p, ast.Subscript) and p.value is cur:
                cur = p
                continue
            if isinstance(p, (ast.BinOp, ast.JoinedStr, ast.FormattedValue, ast.IfExp, ast.BoolOp,
                              ast.List, ast.Tuple, ast.Set, ast.Starred, ast.Await)):
                if (isinstance(p, ast.Tuple) and len(p.elts) == 2 and p.elts[1] is cur
                        and const_str(p.elts[0]) in SYSTEM_ROLES):
                    sysmsg = True
                cur = p
                continue
            if isinstance(p, ast.Dict):
                if any(v is cur for v in p.values):
                    idx = next(i for i, v in enumerate(p.values) if v is cur)
                    key = const_str(p.keys[idx]) if p.keys[idx] is not None else None
                    if key == "content" and const_str(dict_get(p, "role")) in SYSTEM_ROLES:
                        sysmsg = True
                    cur = p
                    continue
                return None
            if isinstance(p, ast.keyword):
                call = m.parents.get(id(p))
                return self.sink(m, call, p.arg, sysmsg) if isinstance(call, ast.Call) else None
            if isinstance(p, ast.Call):
                if p.func is cur:
                    return None
                r = self.sink(m, p, None, sysmsg)
                if r is not None:
                    return r
                f = p.func
                fname = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")
                if fname in TEXT_FUNCS:
                    cur = p
                    continue
                if isinstance(f, ast.Attribute) and f.attr in CONTAINER_ADDS:
                    return self.flow_target(m, f.value, depth, sysmsg, seen)
                return None
            if isinstance(p, ast.Return):
                return self.flow_return(m, p, depth, sysmsg, seen)
            if isinstance(p, (ast.Assign, ast.AnnAssign)) and p.value is cur:
                targets = p.targets if isinstance(p, ast.Assign) else [p.target]
                for t in targets:
                    r = self.flow_target(m, t, depth, sysmsg, seen)
                    if r is not None:
                        return r
                return None
            if isinstance(p, ast.withitem) and p.context_expr is cur and isinstance(p.optional_vars, ast.Name):
                block = m.parents.get(id(p))
                for um, u in self.name_uses(m, p.optional_vars.id, block):
                    r = self.flow(um, u, depth, sysmsg, seen)
                    if r is not None:
                        return r
                return None
            return None

    def flow_return(self, m: Module, ret: ast.Return, depth: int, sysmsg: bool, seen: Set[int]) -> Optional[Dict[str, object]]:
        fn = m.enclosing_function(ret)
        if fn is None:
            return None
        tool = self.run_nodes.get(id(fn))
        if tool is not None and not sysmsg:
            at = m.ref(ret)
            return {"kind": "tool_result", "at": {"file": at["file"], "line": at["line"]},
                    "via": "returned by the tool %s" % tool}
        name = getattr(fn, "name", "")
        for cm, call in self.calls_named(name):
            target = self.callee_def(cm, call, call)
            if target is None or target[1] is not fn:
                continue
            r = self.flow(cm, call, depth + 1, sysmsg, seen)
            if r is not None:
                return r
        return None

    # -- the pass --------------------------------------------------------
    def pass_skill_loads(self) -> None:
        """`CodeCatalog.skill_loads`: one entry per (file loaded, place that loads it)."""
        found: Dict[Tuple[str, str, int], Dict[str, object]] = {}

        def emit(rel: str, how: str, m: Module, node: ast.AST, reaches: Optional[Dict[str, object]]) -> None:
            info = self.text_info(rel)
            if info is None:
                return
            # A text file with no skill shape is reported only when its text is seen reaching a
            # model: a README read and printed is not a skill.
            if not info[0] and reaches is None:
                return
            at = m.ref(node)
            key = (rel, str(at["file"]), int(str(at["line"])))
            if key in found:
                return
            entry: Dict[str, object] = {"path": rel, "how": how, "at": {"file": at["file"], "line": at["line"]}}
            if reaches is not None:
                entry["reaches"] = reaches
            found[key] = entry

        for m in self.modules:
            for call, how, pv in self.read_sites(m):
                files = self.match_text(pv)
                if not files:
                    continue
                reaches = self.flow(m, call)
                for rel in files:
                    emit(rel, how, m, call, reaches)

        # `embedded`: a string literal holding a SKILL-SHAPED file's body. Only those: a
        # document with no skill shape that shares text with a literal is as often the
        # document quoting the code (a tutorial reproducing the app's prompt) as the code
        # carrying the document, and the scan cannot tell which way the copy went.
        long_index: Dict[str, List[Tuple[str, int]]] = {}
        short_index: Dict[str, List[str]] = {}
        bodies: Dict[str, str] = {}
        for rel in self.text_files:
            info = self.text_info(rel)
            if info is None:
                continue
            if not info[0]:
                continue
            body = info[1]
            if len(body) >= EMBED_MIN:
                bodies[rel] = body
                for start in range(0, len(body), EMBED_STRIDE):
                    if start == 0 or body[start - 1] == " ":
                        k = start
                    else:
                        sp = body.find(" ", start)
                        if sp < 0:
                            continue
                        k = sp + 1
                    if k >= start + EMBED_STRIDE or k + EMBED_BLOCK > len(body):
                        continue
                    long_index.setdefault(body[k:k + EMBED_BLOCK], []).append((rel, k))
            elif len(body) >= EMBED_SHORT:
                short_index.setdefault(body[:EMBED_SHORT], []).append(rel)
        if long_index or short_index:
            for m in self.modules:
                for node in m.nodes:
                    if not (isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) >= EMBED_SHORT):
                        continue
                    lit = normalize_text(node.value)
                    hits: Set[str] = set()
                    starts = [0]
                    j = lit.find(" ")
                    while j >= 0:
                        starts.append(j + 1)
                        j = lit.find(" ", j + 1)
                    if short_index:
                        for i in starts:
                            if i + EMBED_SHORT > len(lit):
                                break
                            for rel in short_index.get(lit[i:i + EMBED_SHORT], ()):
                                if rel not in hits:
                                    body = self.text_info(rel)
                                    if body is not None and lit.startswith(body[1], i):
                                        hits.add(rel)
                    if long_index and len(lit) >= EMBED_MIN:
                        for i in starts:
                            if i + EMBED_BLOCK > len(lit):
                                break
                            for rel, k in long_index.get(lit[i:i + EMBED_BLOCK], ()):
                                if rel in hits:
                                    continue
                                body = bodies[rel]
                                left = 0
                                while left < EMBED_MIN and i - left > 0 and k - left > 0 and lit[i - left - 1] == body[k - left - 1]:
                                    left += 1
                                right = EMBED_BLOCK
                                while left + right < EMBED_MIN and i + right < len(lit) and k + right < len(body) and lit[i + right] == body[k + right]:
                                    right += 1
                                if left + right >= EMBED_MIN:
                                    hits.add(rel)
                    if hits:
                        reaches = self.flow(m, node)
                        for rel in sorted(hits):
                            emit(rel, "embedded", m, node, reaches)

        def key(e: Dict[str, object]) -> Tuple[str, str, int]:
            at = e["at"]
            assert isinstance(at, dict)
            return (str(e["path"]), str(at["file"]), int(at["line"]))

        self.skill_loads = sorted(found.values(), key=key)

    # ---- driver --------------------------------------------------------
    def run(self) -> Dict[str, object]:
        self.read()
        _IS_LOCAL[0] = self.is_local
        for m in self.modules:
            self.pass_decorators(m)
            self.pass_classes(m)
            self.pass_module_tools(m)
        for m in self.modules:
            self.pass_literals(m)
        for m in self.modules:
            self.pass_exposures(m)
        self.flush_configs()
        for m, deco, caller, tname in self.ag2_loose:
            # A register_for_llm whose caller the scan cannot trace to a constructor: the exposure is the decorator.
            self.exposures.append({"at": m.ref(deco), "via": "@%s.register_for_llm (AG2 legacy)" % caller, "kind": "static",
                                   "tools": [tname], "_sdk": "ag2", "_expr": "",
                                   "note": "the function is offered to %s's model; its constructor was not traced" % caller})
        self.relabel_native()
        self.pass_claude_servers()
        self.pass_dispatchers()
        self.pass_tool_calls()
        self.pass_gates()
        self.pass_skill_loads()
        # The own-source rule (`framework_own`), as for the tools: a place written in a framework's
        # own source is the framework's, so its attach points and honesty places are not the
        # application's and are not said.
        own_rels = {x.rel for x in self.modules if self.framework_own(x)}
        if own_rels:
            def mine(site: str) -> bool:
                return site.split(":", 1)[0] not in own_rels
            for attr in ("mcp_client_sites", "claude_default_tools", "generated_code_sites", "hosted_sites",
                         "toolkit_sites", "sk_process_steps", "claude_unknown_builtins"):
                setattr(self, attr, [x for x in getattr(self, attr) if mine(x)])
            self.instructor_models = {x for x in self.instructor_models if mine(x)}
            self.parse_models = {x for x in self.parse_models if mine(x)}
        # Instructor is a structured-output library: its response models are not tools.
        if self.instructor_models:
            names = sorted({x.split(":", 1)[1] for x in self.instructor_models})
            self.not_seen.append("instructor response models are structured output, not tools; %d skipped (%s%s)"
                                 % (len(self.instructor_models), ", ".join(names[:8]), ", ..." if len(names) > 8 else ""))
        if self.parse_models:
            names = sorted({x.split(":", 1)[1] for x in self.parse_models})
            self.not_seen.append("schemas passed as response_format= / text_format= to parse() are structured output, not tools; "
                                 "%d skipped (%s%s)" % (len(self.parse_models), ", ".join(names[:8]), ", ..." if len(names) > 8 else ""))
        if self.claude_unknown_builtins:
            n = len(self.claude_unknown_builtins)
            self.not_seen.append("Claude Agent SDK: %d name(s) in an allowed-tools or tools list are not a built-in tool the SDK's current version "
                                 "defines (%s; @anthropic-ai/claude-agent-sdk %s, read %s): each is listed as written, and matches no tool, "
                                 "so it neither allows nor restricts one"
                                 % (n, ", ".join(self.claude_unknown_builtins[:5]) + (", ..." if n > 5 else ""),
                                    CLAUDE_BUILTINS[0], CLAUDE_BUILTINS[1]))
        if self.sk_process_steps:
            n = len(self.sk_process_steps)
            self.not_seen.append("Semantic Kernel: %d function%s %s steps of a process, run by the process and not offered to a model, "
                                 "so not listed as tools (@kernel_function in a class deriving from KernelProcessStep: %s%s)"
                                 % (n, "" if n == 1 else "s", "is one of the" if n == 1 else "are",
                                    ", ".join(self.sk_process_steps[:5]), ", ..." if n > 5 else ""))
        if self.syntax_errors:
            self.not_seen.append("%d Python files could not be parsed (syntax error) and were not read: %s"
                                 % (len(self.syntax_errors), ", ".join(self.syntax_errors[:5])))
        if self.test_files:
            self.not_seen.append("%d Python file(s) of test code (a tests directory, test_*.py, *_test.py, conftest.py) were not read: "
                                 "a test's tools and calls exercise the application, and are not what a model is given" % self.test_files)
        if self.nested_checkouts:
            self.not_seen.append("%d director%s not read: %s (%s)"
                                 % (len(self.nested_checkouts), "y was" if len(self.nested_checkouts) == 1 else "ies were",
                                    NESTED_CHECKOUT, ", ".join(self.nested_checkouts[:5])))
        if self.too_large:
            self.not_seen.append("%d Python files over 2 MB (notebooks over 16 MB) were not read: %s"
                                 % (len(self.too_large), ", ".join(self.too_large[:5])))
        if self.mcp_client_sites:
            self.not_seen.append("tools fetched at runtime from an MCP server are named by the server, not listed; "
                                 "scan that server's own repository (%s)" % ", ".join(self.mcp_client_sites[:5]))
        if self.claude_default_tools:
            self.not_seen.append("ClaudeAgentOptions without tools= (or with a tools preset) leaves the whole built-in Claude Code tool set (Read, Write, "
                                 "Edit, Bash, WebFetch, ...) available to the model; the scan lists only the tool names written "
                                 "in the source, and permissions set outside the code (.claude/settings.json, permission_mode) "
                                 "are not read (%s)" % ", ".join(self.claude_default_tools[:5]))
        if self.generated_code_sites:
            self.not_seen.append("tools called from code the model writes (smolagents CodeAgent, LlamaIndex CodeActAgent, DSPy CodeAct) are "
                                 "called inside generated code: no per-call dispatch exists in this source, and the scan cannot "
                                 "see those calls (%s)" % ", ".join(self.generated_code_sites[:5]))
        if self.hosted_sites:
            self.not_seen.append("provider-executed tools (web search, code execution, hosted MCP) run on the provider's side; "
                                 "no per-call interception exists in this application for them (%s)" % ", ".join(self.hosted_sites[:5]))
        if self.toolkit_sites:
            self.not_seen.append("tools created inside a library (toolkits, load_tools, crewai_tools classes) are reported by the toolkit or class name; their parameters are not read (%s)"
                                 % ", ".join(self.toolkit_sites[:5]))
        if any(e["kind"] == "computed" for e in self.exposures):
            self.not_seen.append("some tool lists are computed at runtime; the scan lists the tools it could join back, "
                                 "which can be fewer or more than what reaches the model")
        if self.tool_runs:
            # The depth is a limit of the reading, stated wherever the reading ran.
            self.not_seen.append(
                "a tool running another tool is looked for from each tool's run function into the application's own "
                "functions, at most %d calls deep, by name or through a tools map; a tool reached deeper, through a "
                "method on an object the scan cannot type, a callback or a value passed in is not reported" % CALL_DEPTH)
        by_rel = {x.rel: x for x in self.modules}
        for e in self.exposures:
            icpt = e.pop("_icpt", None)
            sdk = str(e.get("_sdk", ""))
            if icpt is None and sdk in INTERCEPTION:
                p = INTERCEPTION[sdk]
                kind, pname = str(p["kind"]), str(p["name"])
                if kind == "K4":
                    icpt = point(kind, pname, True)
                elif kind in ("K3", "K5") or not p["markers"]:
                    icpt = point(kind, pname, False)
                else:
                    at = e["at"]
                    mod = by_rel.get(str(at["file"]).split("#")[0]) if isinstance(at, dict) else None
                    hit = marker_node(mod.tree, list(p["markers"])) if mod is not None else None  # type: ignore[arg-type]
                    icpt = point(kind, pname, hit is not None, mod.ref(hit) if (mod is not None and hit is not None) else None)
            if icpt is not None:
                e["interception"] = icpt
            e.pop("_sdk", None)
            e.pop("_expr", None)

        def pos(r: object) -> Tuple[str, int, int]:
            assert isinstance(r, dict)
            return (str(r["file"]), int(r["line"]), int(r["col"]))

        # Deterministic order: by place in the tree, never by pass order.
        self.tools.sort(key=lambda t: pos(t["defined_at"]))
        self.exposures.sort(key=lambda e: pos(e["at"]))
        self.gates.sort(key=lambda g: pos(g["at"]))
        for d in self.dispatchers:
            callers = d["callers"]
            assert isinstance(callers, list)
            callers.sort(key=pos)
            # One entry per caller, same order: each check carries its caller.
            cc = d["caller_checks"]
            assert isinstance(cc, list)
            cc.sort(key=lambda c: pos(c["caller"]))
        self.dispatchers.sort(key=lambda d: pos(d["at"]))
        return {
            "python_files": self.python_files,
            "notebooks": self.notebooks,
            "nested_checkouts": len(self.nested_checkouts),
            "test_files": self.test_files,
            "files_read": len(self.modules),
            "syntax_errors": len(self.syntax_errors),
            "tools": self.tools,
            "exposures": self.exposures,
            "dispatchers": self.dispatchers,
            "gates": self.gates,
            "not_seen": self.not_seen,
            # Which of the 2026-09-28 checks this walker ran (`CodeCatalog.checks`).
            "checks": {"tool_calls": True, "caller_checks": True, "skill_loads": True},
            # ACP-460: where the code loads a skill or instruction file (`CodeCatalog.skill_loads`).
            "skill_loads": self.skill_loads,
            # Tool names for the model the scan could not resolve (`given_name`), said by the Node side.
            "computed_names": self.computed_names_out(),
            # Schemas recognised as structured output and not counted as tools (`CodeCatalog.structured_output`).
            "structured_output": sorted({(str(x["name"]), json.dumps(x["at"], sort_keys=True)): x for x in self.structured}.values(),
                                        key=lambda x: pos(x["at"])),
        }


# A value's place in the reply chain (ACP-481): (what it is, sdk, reply kind, origin). What it
# is: "stream", "reply", "choices", "choice", "message", "requests" (the collection of tool
# requests), "request" (one, bound by a loop), "function" (a Chat request's `.function`),
# "name" / "input" (a read of the request's name or input). Origin is the loop that bound
# the request, so a name and an input can be required to come from the SAME request.
ReplyTag = Tuple[str, str, str, Optional[int]]


class _ReplyScope:
    """One function body, or a module's top level, as the reply-dispatch rule reads it."""

    def __init__(self, scan: "Scan", m: Module, scope: ast.AST):
        self.scan = scan
        self.m = m
        self.scope = scope
        self.params: Set[str] = set()
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            a = scope.args
            for arg in list(getattr(a, "posonlyargs", [])) + list(a.args) + list(a.kwonlyargs):
                self.params.add(arg.arg)
            for extra in (a.vararg, a.kwarg):
                if extra is not None:
                    self.params.add(extra.arg)
        # The body's own nodes: a nested function, lambda or class is another scope.
        self.nodes: List[ast.AST] = []
        stack: List[ast.AST] = list(getattr(scope, "body", []))
        while stack:
            n = stack.pop()
            self.nodes.append(n)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                continue
            stack.extend(ast.iter_child_nodes(n))
        # Plain assignments and `with ... as x`, per name, in this body only.
        self.bindings: Dict[str, List[Tuple[ast.AST, ast.expr]]] = {}
        for n in self.nodes:
            if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
                self.bindings.setdefault(n.targets[0].id, []).append((n, n.value))
            elif isinstance(n, ast.AnnAssign) and n.value is not None and isinstance(n.target, ast.Name):
                self.bindings.setdefault(n.target.id, []).append((n, n.value))
            elif isinstance(n, (ast.With, ast.AsyncWith)):
                for item in n.items:
                    if isinstance(item.optional_vars, ast.Name):
                        self.bindings.setdefault(item.optional_vars.id, []).append((n, item.context_expr))
        self._loops: Dict[int, Optional[ReplyTag]] = {}

    def binding(self, name: str, line: int) -> Optional[Tuple[ast.AST, ast.expr]]:
        """The last assignment to `name` in this body on a line before `line`."""
        best: Optional[Tuple[ast.AST, ast.expr]] = None
        for stmt, value in self.bindings.get(name, []):
            if getattr(stmt, "lineno", 0) < line and (best is None or stmt.lineno >= best[0].lineno):
                best = (stmt, value)
        return best

    def client_class(self, m: Module, call: ast.Call) -> Optional[str]:
        q = m.qual(call.func)
        fw = framework_of(q)
        if fw in REPLY_CLIENTS and last(q) in REPLY_CLIENTS[fw]:
            return fw
        return None

    def client_sdk(self, recv: ast.expr, line: int, depth: int) -> Optional[str]:
        """The SDK whose client class `recv` was constructed from, when the source says."""
        if depth > 16:
            return None
        if isinstance(recv, ast.Call):
            return self.client_class(self.m, recv)
        if isinstance(recv, ast.Name):
            if recv.id in self.params:
                return None
            b = self.binding(recv.id, line)
            if b is not None:
                if isinstance(b[1], ast.Call):
                    return self.client_class(self.m, b[1])
                if isinstance(b[1], ast.Name):
                    return self.client_sdk(b[1], b[0].lineno, depth + 1)
                return None
            if recv.id in self.bindings:
                return None
            ctor = self.scan.var_ctor(self.m, recv.id)
            if ctor is None:
                return None
            return self.client_class(ctor[1], ctor[2])
        if isinstance(recv, ast.Attribute) and isinstance(recv.value, ast.Name) and recv.value.id in ("self", "cls"):
            found = self.scan.self_attr(self.m, recv)
            if found is not None and isinstance(found[1], ast.Call):
                return self.client_class(found[0], found[1])
        return None

    def unwraps(self, f: ast.expr) -> bool:
        """`json.loads(x)` and `dict(x)` hand on the value they are given."""
        if isinstance(f, ast.Name) and f.id == "dict" and f.id not in self.m.imports and f.id not in self.m.defs:
            return True
        return self.m.qual(f) == "json.loads"

    def kind(self, e: Optional[ast.expr], line: int, ctx: Dict[str, ReplyTag], depth: int = 0) -> Optional[ReplyTag]:
        if e is None or depth > 16:
            return None
        if isinstance(e, ast.Await):
            return self.kind(e.value, line, ctx, depth + 1)
        if isinstance(e, ast.BoolOp) and isinstance(e.op, ast.Or) and e.values:
            # `message.tool_calls or []`: the value when there is one.
            return self.kind(e.values[0], line, ctx, depth + 1)
        if isinstance(e, ast.Name):
            if e.id in ctx:
                return ctx[e.id]
            if e.id in self.params:
                # The stated limit: a reply handed in by a caller is not followed.
                return None
            b = self.binding(e.id, line)
            if b is None:
                return None
            return self.kind(b[1], b[0].lineno, self.ctx_at(b[0]), depth + 1)
        if isinstance(e, ast.Call):
            f = e.func
            if self.unwraps(f):
                return self.kind(e.args[0], line, ctx, depth + 1) if e.args else None
            if isinstance(f, ast.Attribute) and f.attr == "get_final_message":
                s = self.kind(f.value, line, ctx, depth + 1)
                return ("reply", s[1], "messages", None) if s is not None and s[0] == "stream" else None
            for sdk, tail, api in REPLY_CALLS:
                recv: Optional[ast.expr] = f
                for part in reversed(tail):
                    if not isinstance(recv, ast.Attribute) or recv.attr != part:
                        recv = None
                        break
                    recv = recv.value
                if recv is not None and self.client_sdk(recv, line, depth + 1) == sdk:
                    return ("stream", sdk, "messages", None) if api == "stream" else ("reply", sdk, api, None)
            return None
        if isinstance(e, ast.Subscript):
            v = self.kind(e.value, line, ctx, depth + 1)
            return ("choice", v[1], v[2], None) if v is not None and v[0] == "choices" else None
        if isinstance(e, (ast.ListComp, ast.GeneratorExp)) and len(e.generators) == 1:
            # `[b for b in reply.content if b.type == "tool_use"]`: the requests, narrowed.
            g = e.generators[0]
            if isinstance(g.target, ast.Name) and isinstance(e.elt, ast.Name) and e.elt.id == g.target.id:
                v = self.kind(g.iter, line, ctx, depth + 1)
                return v if v is not None and v[0] == "requests" else None
            return None
        if not isinstance(e, ast.Attribute):
            return None
        v = self.kind(e.value, line, ctx, depth + 1)
        if v is None:
            return None
        tag, sdk, api, origin = v
        a = e.attr
        if tag == "reply":
            if (api, a) in (("messages", "content"), ("responses", "output")):
                return ("requests", sdk, api, None)
            if (api, a) == ("chat", "choices"):
                return ("choices", sdk, api, None)
        elif tag == "choice" and a == "message":
            return ("message", sdk, api, None)
        elif tag == "message" and a == "tool_calls":
            return ("requests", sdk, api, None)
        elif tag == "request" and api == "chat":
            if a == "function":
                return ("function", sdk, api, origin)
        elif tag in ("request", "function"):
            name_member, input_member = REQUEST_MEMBERS[api]
            if a == name_member:
                return ("name", sdk, api, origin)
            if a == input_member:
                return ("input", sdk, api, origin)
        return None

    def loop_tag(self, loop: ast.AST, iter_expr: ast.expr) -> Optional[ReplyTag]:
        """What a loop's (or comprehension's) variable holds: one tool request, or one Chat choice."""
        key = id(loop)
        if key in self._loops:
            return self._loops[key]
        self._loops[key] = None
        v = self.kind(iter_expr, getattr(loop, "lineno", 0), self.ctx_at(loop))
        t: Optional[ReplyTag] = None
        if v is not None and v[0] == "requests":
            t = ("request", v[1], v[2], key)
        elif v is not None and v[0] == "choices":
            t = ("choice", v[1], v[2], None)
        self._loops[key] = t
        return t

    def ctx_at(self, node: ast.AST) -> Dict[str, ReplyTag]:
        """The loop variables in force at `node`, innermost first, from the loops of this body around it."""
        ctx: Dict[str, ReplyTag] = {}
        child: ast.AST = node
        grand: Optional[ast.AST] = None
        cur = self.m.parents.get(id(node))
        while cur is not None and cur is not self.scope:
            if isinstance(cur, (ast.For, ast.AsyncFor)) and isinstance(cur.target, ast.Name):
                if any(child is s for s in cur.body) and cur.target.id not in ctx:
                    t = self.loop_tag(cur, cur.iter)
                    if t is not None:
                        ctx[cur.target.id] = t
            elif isinstance(cur, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)) and len(cur.generators) == 1:
                g = cur.generators[0]
                inside = child is not g or (grand is not None and any(grand is c for c in g.ifs))
                if inside and isinstance(g.target, ast.Name) and g.target.id not in ctx:
                    t = self.loop_tag(cur, g.iter)
                    if t is not None:
                        ctx[g.target.id] = t
            grand, child = child, cur
            cur = self.m.parents.get(id(cur))
        return ctx

    def dispatches(self, out: List[Tuple[Module, ast.AST, str]]) -> None:
        """Every call in this body passed one request's name AND its input, to an application function."""
        if not any(isinstance(n, (ast.For, ast.AsyncFor, ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp))
                   for n in self.nodes):
            return
        for n in self.nodes:
            if not isinstance(n, ast.Call):
                continue
            args = [a for a in n.args if not isinstance(a, ast.Starred)] + [k.value for k in n.keywords if k.arg is not None]
            if len(args) < 2:
                continue
            ctx = self.ctx_at(n)
            if not any(t[0] == "request" for t in ctx.values()):
                continue
            reads = [self.kind(a, n.lineno, ctx) for a in args]
            pair = next(((x, y) for x in reads if x is not None and x[0] == "name"
                         for y in reads if y is not None and y[0] == "input" and y[3] == x[3]), None)
            if pair is None:
                continue
            target = self.scan.callee_def(self.m, n, n)
            if target is None:
                continue
            out.append((target[0], target[1], pair[0][1]))


def main(argv: List[str]) -> int:
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        sys.stderr.write("usage: ziffer_scan_code.py <directory>\n")
        return 2
    sys.setrecursionlimit(10000)
    # The scan keeps every tree alive until it prints, and the cyclic collector
    # re-scans millions of AST nodes as they accumulate: measured on the 3.11
    # stdlib (1,813 files), 50 s with it, the time below without. The process
    # exits right after, so nothing is left for it to collect.
    gc.disable()
    # A notebook's invalid escape sequences are the notebook's business, not the scan's
    # output: stderr carries nothing the caller reads.
    warnings.simplefilter("ignore")
    out = Scan(argv[1]).run()
    sys.stdout.write(json.dumps(out, sort_keys=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
