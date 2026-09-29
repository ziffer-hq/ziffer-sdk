"""The corner-bookshop assistant on smolagents."""
from smolagents import CodeAgent, InferenceClientModel, Tool, ToolCallingAgent, WebSearchTool, tool


@tool
def lookup_order(order_id: str) -> str:
    """Look up an order by id.

    Args:
        order_id: The order id.
    """
    return "shipped"


class RefundTool(Tool):
    name = "refund_order"
    description = "Refund an order."
    inputs = {
        "order_id": {"type": "string", "description": "The order id."},
        "amount": {"type": "number", "description": "The amount."},
    }
    output_type = "string"

    def forward(self, order_id: str, amount: float) -> str:
        return "refunded"


class NotATool:
    name = "shelf"

    def forward(self, isbn: str) -> str:
        return isbn


model = InferenceClientModel()
clerk = ToolCallingAgent(tools=[lookup_order, RefundTool()], model=model)
coder = CodeAgent(tools=[lookup_order, WebSearchTool()], model=model, add_base_tools=True)

from smolagents import MCPClient


def with_mcp():
    with MCPClient({"url": "http://localhost:8000/mcp"}) as mcp_tools:
        return CodeAgent(tools=mcp_tools, model=model)
