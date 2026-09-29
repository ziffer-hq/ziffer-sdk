"""In-process MCP tools for the corner-bookshop assistant."""
from typing import Any, TypedDict

from claude_agent_sdk import ToolAnnotations, create_sdk_mcp_server, tool


class RefundArgs(TypedDict):
    order_id: str
    amount: float


@tool("lookup_order", "Look up an order by id.", {"order_id": str})
async def lookup_order(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": "shipped"}]}


@tool("refund_order", "Refund an order.", RefundArgs,
      annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True))
async def refund_order(args: RefundArgs) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": "refunded"}]}


@tool(
    "restock_title",
    "Order more copies of a title.",
    {"type": "object", "properties": {"isbn": {"type": "string"}, "copies": {"type": "integer"}}, "required": ["isbn"]},
)
async def restock_title(args):
    return {"content": [{"type": "text", "text": "ordered"}]}


shop = create_sdk_mcp_server(name="shop", version="1.0.0", tools=[lookup_order, refund_order, restock_title])
