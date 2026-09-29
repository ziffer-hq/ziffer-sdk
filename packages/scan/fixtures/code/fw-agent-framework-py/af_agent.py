"""The corner-bookshop assistant on Microsoft Agent Framework."""
from typing import Annotated

from agent_framework import Agent, FunctionInvocationContext, FunctionTool, tool
from agent_framework.openai import OpenAIChatClient
from pydantic import BaseModel


@tool(approval_mode="never_require")
def lookup_order(order_id: Annotated[str, "The order id"]) -> str:
    """Look up an order by id."""
    return "shipped"


@tool(name="refund_order", description="Refund an order.", approval_mode="always_require")
def refund(order_id: str, amount: float) -> str:
    return "refunded"


@tool
def shelf_location(isbn: str) -> str:
    """Where a title is shelved."""
    return "aisle 3"


def gift_wrap(order_id: str, paper: str) -> str:
    """Wrap an order as a gift."""
    return "wrapped"


class RestockInput(BaseModel):
    isbn: str
    copies: int


def restock(isbn: str, copies: int) -> str:
    return "ordered"


restock_tool = FunctionTool(name="restock_title", description="Order more copies.", func=restock, input_model=RestockInput)
clock = FunctionTool(name="current_time", description="The current time, answered by the application.")


async def audit(context: FunctionInvocationContext, call_next):
    await call_next()


agent = Agent(
    client=OpenAIChatClient(),
    name="clerk",
    tools=[lookup_order, refund, shelf_location, gift_wrap, restock_tool],
    middleware=[audit],
)

night_agent = OpenAIChatClient().as_agent(name="night", tools=clock)

# A web search the provider runs (K5): offered, never run by this code.
researcher = Agent(client=OpenAIChatClient(), tools=[OpenAIChatClient().get_web_search_tool()])
