"""The same shop on ag2 1.x: @tool, Agent(tools=, middleware=), @agent.tool."""
from ag2 import Agent, tool


@tool(middleware=[])
def gift_wrap(order_id: str, paper: str) -> str:
    """Wrap an order as a gift."""
    return "wrapped"


def loyalty_points(customer_id: str) -> int:
    """A customer's loyalty points."""
    return 12


desk = Agent("desk", tools=[gift_wrap, loyalty_points], middleware=[])


@desk.tool(name="cancel_order", description="Cancel an order before it ships.")
def cancel(order_id: str) -> str:
    return "cancelled"
