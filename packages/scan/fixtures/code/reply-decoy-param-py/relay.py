"""The stated limit: the reply reaches the loop as a PARAMETER, and a parameter is not followed."""
from anthropic import Anthropic

client = Anthropic()

TOOLS = [
    {"name": "find_room", "description": "Read the rooms free on a night.",
     "input_schema": {"type": "object", "properties": {"night": {"type": "string"}}}},
    {"name": "release_room", "description": "Release a held room back to sale.",
     "input_schema": {"type": "object", "properties": {"stay_id": {"type": "string"}}}},
]

HANDLERS = {}


def run_tool(name, tool_input):
    return HANDLERS[name](**tool_input)


def handle_reply(reply):
    for block in reply.content:
        if block.type == "tool_use":
            run_tool(block.name, block.input)


def answer(question):
    reply = client.messages.create(model="claude-model", max_tokens=1024, tools=TOOLS,
                                   messages=[{"role": "user", "content": question}])
    handle_reply(reply)
