"""MCP servers: mcp 2.x MCPServer with ToolAnnotations, and fastmcp's FastMCP."""
from fastmcp import FastMCP as FM
from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

server = MCPServer("Billing")


@server.tool()
def get_invoice(invoice_id: str) -> dict:
    """Fetch an invoice by id."""
    return {}


@server.tool(name="void_invoice", annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True))
def void(invoice_id: str, reason: str) -> str:
    """Void an invoice."""
    return "voided"


app = FM("Ops")


@app.tool
def ping(host: str) -> str:
    """Ping a host."""
    return "pong"


if __name__ == "__main__":
    server.run(transport="stdio")
