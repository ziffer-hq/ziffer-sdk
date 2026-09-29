"""Pydantic AI: @agent.tool / @agent.tool_plain, Tool(fn), a bare function, a FunctionToolset."""
import random

from pydantic_ai import Agent, FunctionToolset, RunContext, Tool

agent = Agent("google:gemini-3-flash-preview", deps_type=str)


@agent.tool_plain
def roll_dice() -> str:
    """Roll a six-sided die and return the result."""
    return str(random.randint(1, 6))


@agent.tool
def get_player_name(ctx: RunContext[str]) -> str:
    """Get the player's name."""
    return ctx.deps


def transfer_funds(ctx: RunContext[str], account: str, amount: float) -> str:
    """Transfer funds to an account."""
    return "done"


def list_accounts() -> list:
    """List the user's accounts."""
    return []


toolset = FunctionToolset()


@toolset.tool_plain
def get_default_language():
    return "en-US"


agent_b = Agent("openai:gpt-5.2", tools=[Tool(transfer_funds, takes_ctx=True), list_accounts], toolsets=[toolset])
