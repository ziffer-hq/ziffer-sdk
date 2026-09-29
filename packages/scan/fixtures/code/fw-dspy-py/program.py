"""The corner-bookshop assistant as a DSPy ReAct program."""
import dspy


def lookup_order(order_id: str) -> str:
    """Look up an order by id."""
    return "shipped"


def refund(order_id: str, amount: float) -> str:
    return "refunded"


def shelf_location(isbn: str) -> str:
    """Not a tool: never handed to a program."""
    return "aisle 3"


refund_tool = dspy.Tool(refund, name="refund_order", desc="Refund an order.")

clerk = dspy.ReAct("question -> answer", tools=[lookup_order, refund_tool], max_iters=5)
coder = dspy.CodeAct("question -> answer", [lookup_order])
