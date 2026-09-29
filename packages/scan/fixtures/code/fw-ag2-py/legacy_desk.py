"""The corner-bookshop desk on the AG2 legacy line: the caller proposes, the executor runs."""
from typing import Annotated

from autogen import AssistantAgent, ConversableAgent, LLMConfig, UserProxyAgent, register_function

llm_config = LLMConfig(api_type="openai", model="model")

clerk = AssistantAgent("clerk", llm_config=llm_config)
till = UserProxyAgent("till", human_input_mode="NEVER")


@till.register_for_execution()
@clerk.register_for_llm(description="Look up an order by id.")
def lookup_order(order_id: Annotated[str, "The order id"]) -> str:
    return "shipped"


@clerk.register_for_llm(name="refund_order", description="Refund an order.")
def refund(order_id: str, amount: float) -> str:
    return "refunded"


def restock_title(isbn: str, copies: int) -> str:
    """Order more copies of a title."""
    return "ordered"


register_function(restock_title, caller=clerk, executor=till, description="Order more copies.")


def shelf_location(isbn: str) -> str:
    """Where a title is shelved."""
    return "aisle 3"


stock_desk = ConversableAgent("stock_desk", llm_config=llm_config, functions=[shelf_location])


def attach(toolkit):
    # A prebuilt AG2 toolkit registered on the agent: named, its tools not read.
    toolkit.register_for_llm(clerk)
