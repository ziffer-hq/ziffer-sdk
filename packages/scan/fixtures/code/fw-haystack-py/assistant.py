"""The corner-bookshop assistant on a Haystack Agent."""
from typing import Annotated

from haystack.components.agents import Agent
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.components.tools import ToolInvoker
from haystack.tools import Tool, Toolset, create_tool_from_function, tool


@tool
def lookup_order(order_id: Annotated[str, "The order id"]) -> str:
    """Look up an order by id."""
    return "shipped"


@tool(name="refund_order", description="Refund an order.")
def refund(order_id: str, amount: float) -> str:
    return "refunded"


def gift_wrap(order_id: str, paper: str) -> str:
    """Wrap an order as a gift."""
    return "wrapped"


def restock(isbn: str, copies: int) -> str:
    return "ordered"


gift_tool = create_tool_from_function(gift_wrap)
restock_tool = Tool(
    name="restock_title",
    description="Order more copies of a title.",
    parameters={"type": "object", "properties": {"isbn": {"type": "string"}, "copies": {"type": "integer"}}},
    function=restock,
)


async def confirm(state):
    return state


agent = Agent(
    chat_generator=OpenAIChatGenerator(),
    tools=Toolset([lookup_order, refund, gift_tool]),
    hooks={"before_tool": [confirm]},
)
invoker = ToolInvoker(tools=[restock_tool])

from haystack_integrations.tools.ledger import LedgerViewerTool

viewer = Agent(chat_generator=OpenAIChatGenerator(), tools=[LedgerViewerTool(), lookup_order])
