"""DECOY: the same loop and run_tool, over plain queued objects spelled .name and .input."""
from dataclasses import dataclass

from anthropic import Anthropic

client = Anthropic()

TOOLS = [
    {"name": "find_room", "description": "Read the rooms free on a night.",
     "input_schema": {"type": "object", "properties": {"night": {"type": "string"}}}},
    {"name": "release_room", "description": "Release a held room back to sale.",
     "input_schema": {"type": "object", "properties": {"stay_id": {"type": "string"}}}},
]


@dataclass
class Queued:
    name: str
    input: dict
    type: str = "tool_use"


HANDLERS = {}


def run_tool(name, tool_input):
    return HANDLERS[name](**tool_input)


def drain(question):
    reply = client.messages.create(model="claude-model", max_tokens=1024, tools=TOOLS,
                                   messages=[{"role": "user", "content": question}])
    queued = [Queued("find_room", {"night": "friday"}), Queued("release_room", {"stay_id": "s1"})]
    for block in queued:
        if block.type == "tool_use":
            run_tool(block.name, block.input)
    return reply
