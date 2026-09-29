"""A module-based Strands tool: TOOL_SPEC and a function of the same name."""
from typing import Any

from strands.types.tools import ToolResult, ToolUse

TOOL_SPEC = {
    "name": "restock_title",
    "description": "Order more copies of a title.",
    "inputSchema": {"json": {"type": "object", "properties": {"isbn": {"type": "string"}, "copies": {"type": "integer"}}}},
}


def restock_title(tool: ToolUse, **kwargs: Any) -> ToolResult:
    return {"toolUseId": tool["toolUseId"], "status": "success", "content": [{"text": "ordered"}]}
