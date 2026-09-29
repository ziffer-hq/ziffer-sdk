"""OpenAI Agents SDK: @function_tool, the preferred @tool from agents.decorators, FunctionTool, a hosted tool."""
from agents import Agent, FunctionTool, RunContextWrapper, WebSearchTool, function_tool
from agents.decorators import tool as agents_tool


@function_tool
def get_weather(city: str) -> str:
    """Returns weather info for the specified city."""
    return "sunny"


@agents_tool(name_override="fetch_data")
def read_file(ctx: RunContextWrapper, path: str, directory: str | None = None) -> str:
    """Read the contents of a file."""
    return "<file contents>"


async def run_refund(ctx, args: str) -> str:
    return "refunded"


refund_tool = FunctionTool(
    name="issue_refund",
    description="Issue a refund.",
    params_json_schema={"type": "object", "properties": {"order_id": {}, "amount": {}}},
    on_invoke_tool=run_refund,
)

agent = Agent(name="Assistant", tools=[get_weather, read_file, refund_tool, WebSearchTool()])
