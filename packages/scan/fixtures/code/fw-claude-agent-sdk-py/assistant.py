"""Where the tools reach the model: the options handed to query()."""
from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions, HookMatcher, query

from bookshop_tools import shop


async def check_refund(input_data, tool_use_id, context):
    return {}


options = ClaudeAgentOptions(
    mcp_servers={"shop": shop},
    tools=["Read", "Bash(git status:*)"],
    allowed_tools=["mcp__shop__lookup_order", "Read"],
    hooks={"PreToolUse": [HookMatcher(matcher="mcp__shop__refund_order", hooks=[check_refund])]},
    agents={"stock-clerk": AgentDefinition(description="Checks stock.", prompt="Check stock.", tools=["Grep"])},
)


async def main():
    async for message in query(prompt="Where is order 17?", options=options):
        print(message)


def bare_options():
    # No tools=: every built-in tool is available; the scan says so.
    return ClaudeAgentOptions(allowed_tools=["Write"])
