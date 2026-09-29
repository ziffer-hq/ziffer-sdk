"""The same shop on AutoGen AgentChat, the line Agent Framework replaces."""
from autogen_agentchat.agents import AssistantAgent
from autogen_core.tools import FunctionTool
from autogen_ext.models.openai import OpenAIChatCompletionClient


def cancel_order(order_id: str) -> str:
    """Cancel an order."""
    return "cancelled"


def loyalty_points(customer_id: str) -> int:
    """A customer's loyalty points."""
    return 12


cancel_tool = FunctionTool(cancel_order, description="Cancel an order before it ships.")

assistant = AssistantAgent(
    "assistant",
    model_client=OpenAIChatCompletionClient(model="model"),
    tools=[cancel_tool, loyalty_points],
)
