"""A decoy: autogen_core is Microsoft AutoGen, not AG2; its FunctionTool is agent-framework's id."""
from autogen_core.tools import FunctionTool


def ping(host: str) -> str:
    return host


ping_tool = FunctionTool(ping, description="Ping a host.")
