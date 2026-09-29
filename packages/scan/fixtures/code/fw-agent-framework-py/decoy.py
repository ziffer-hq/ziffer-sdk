"""A decoy: `tool` from strands is not Agent Framework's decorator, and an unimported one is nothing."""
from strands import tool as strands_tool


def tool(fn):
    return fn


@tool
def not_a_tool(x: str) -> str:
    return x
