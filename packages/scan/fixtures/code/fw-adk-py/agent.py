"""The corner-bookshop assistant on Google ADK."""
from google.adk.agents import Agent, LlmAgent
from google.adk.tools import FunctionTool, ToolContext, google_search
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.mcp_tool import McpToolset


def lookup_order(order_id: str, tool_context: ToolContext) -> dict:
    """Look up an order by id."""
    return {"status": "shipped"}


def refund_order(order_id: str, amount: float) -> dict:
    """Refund an order."""
    return {"refunded": amount}


def check_refund(tool, args, tool_context):
    return None


searcher = LlmAgent(name="searcher", model="model", description="Searches the web.", tools=[google_search])

refund_tool = FunctionTool(func=refund_order, require_confirmation=True)

root_agent = Agent(
    name="clerk",
    model="model",
    tools=[lookup_order, refund_tool, AgentTool(agent=searcher), McpToolset(connection_params=None)],
    before_tool_callback=check_refund,
)
