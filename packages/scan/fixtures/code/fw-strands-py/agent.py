"""The corner-bookshop assistant on Strands Agents."""
from strands import Agent, tool
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry
from strands.tools.mcp import MCPClient
from strands_tools import shell

from shop_tools import restock_title


@tool
def lookup_order(order_id: str) -> str:
    """Look up an order by id."""
    return "shipped"


@tool(name="refund_order", description="Refund an order.", context=True)
def refund(order_id: str, amount: float, tool_context) -> str:
    return "refunded"


def gift_wrap(order_id: str) -> str:
    """Not a tool: Strands needs @tool."""
    return "wrapped"


class RefundGuard(HookProvider):
    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.check)

    def check(self, event: BeforeToolCallEvent) -> None:
        event.cancel_tool = "refunds need a person"


catalog = MCPClient(lambda: None)

clerk = Agent(tools=[lookup_order, refund, restock_title, shell, catalog], hooks=[RefundGuard()])
