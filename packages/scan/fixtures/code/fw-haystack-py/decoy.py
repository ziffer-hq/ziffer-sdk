"""A decoy: `Tool` from mcp.types is an MCP tool listing, not Haystack's Tool."""
from mcp.types import Tool

listing = Tool(name="shelf_notes", description="Shelf notes.", inputSchema={"type": "object", "properties": {"isbn": {}}})
