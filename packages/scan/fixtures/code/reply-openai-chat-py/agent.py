"""Chat Completions: the message and its tool_calls through plain assignments, then call_tool."""
import json

from openai import OpenAI

client = OpenAI()

TOOLS = [
    {"type": "function", "function": {"name": "find_room", "description": "Read the rooms free on a night.",
                                      "parameters": {"type": "object", "properties": {"night": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "release_room", "description": "Release a held room back to sale.",
                                      "parameters": {"type": "object", "properties": {"stay_id": {"type": "string"}}}}},
]


def find_room(night):
    return "101"


def release_room(stay_id):
    return "released"


HANDLERS = {"find_room": find_room, "release_room": release_room}


def call_tool(name, args):
    return HANDLERS[name](**args)


def answer(question):
    reply = client.chat.completions.create(model="gpt-model", tools=TOOLS,
                                           messages=[{"role": "user", "content": question}])
    message = reply.choices[0].message
    calls = message.tool_calls or []
    out = []
    for tool_call in calls:
        out.append(call_tool(tool_call.function.name, json.loads(tool_call.function.arguments)))
    return out
