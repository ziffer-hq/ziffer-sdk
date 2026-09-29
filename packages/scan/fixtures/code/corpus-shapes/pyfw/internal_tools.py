# The framework's own source (pyproject names a framework package): not counted.
from agents import function_tool


@function_tool
def framework_internal(x: str) -> str:
    """Internal."""
    return x


# An MCP attach point in the framework's own source: not said as the application's.
from agents.mcp import MCPServerStdio

internal_server = MCPServerStdio(params={"command": "internal-mcp"})
