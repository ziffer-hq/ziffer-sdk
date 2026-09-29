# An example beside the framework: counted.
from agents import Agent, function_tool


@function_tool
def book_meeting(room: str, when: str) -> str:
    """Book a meeting room."""
    return room


agent = Agent(name="Assistant", tools=[book_meeting])


# An MCP attach point in an example beside the framework: said.
from agents.mcp import MCPServerStdio

example_server = MCPServerStdio(params={"command": "bookshop-mcp"})
