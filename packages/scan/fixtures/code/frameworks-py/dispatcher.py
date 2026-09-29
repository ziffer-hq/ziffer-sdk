"""A hand-written tool_use loop: one dispatcher, three callers, a permission gate."""
import json

import anthropic
from billing.permissions import permissions

client = anthropic.Anthropic()

TOOLS = [
    {"name": "lookup_order", "description": "Look up an order.",
     "input_schema": {"type": "object", "properties": {"order_id": {"type": "string"}}}},
    {"name": "refund_order", "description": "Refund an order.",
     "input_schema": {"type": "object", "properties": {"order_id": {"type": "string"}, "amount": {"type": "number"}}}},
    {"name": "cancel_subscription", "description": "Cancel a subscription.",
     "input_schema": {"type": "object", "properties": {"subscription_id": {"type": "string"}}}},
]


def tools_for(user):
    return [t for t in TOOLS if permissions.allows(user, t["name"])]


def execute_tool(tool_name, tool_input):
    if tool_name == "lookup_order":
        return {"status": "shipped"}
    elif tool_name == "refund_order":
        return {"refunded": tool_input["amount"]}
    elif tool_name == "cancel_subscription":
        return {"cancelled": True}
    raise ValueError(tool_name)


def agent_loop(user, messages):
    response = client.messages.create(model="claude-sonnet-4-5", max_tokens=1024, tools=tools_for(user), messages=messages)
    for block in response.content:
        if block.type == "tool_use":
            execute_tool(block.name, block.input)
    return response


def admin_cli(argv):
    return execute_tool(argv[1], json.loads(argv[2]))


def retry_job(job):
    return execute_tool(job.tool_name, job.tool_input)
