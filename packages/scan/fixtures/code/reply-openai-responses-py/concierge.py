"""Responses API: function_call output items, passed by keyword to invoke_tool."""
import json

import openai

client = openai.AsyncOpenAI()

TOOLS = [
    {"type": "function", "name": "find_room", "description": "Read the rooms free on a night.",
     "parameters": {"type": "object", "properties": {"night": {"type": "string"}}}},
    {"type": "function", "name": "release_room", "description": "Release a held room back to sale.",
     "parameters": {"type": "object", "properties": {"stay_id": {"type": "string"}}}},
]

HANDLERS = {}


async def invoke_tool(tool_name, arguments):
    return await HANDLERS[tool_name](**arguments)


async def answer(question):
    reply = await client.responses.create(model="gpt-model", tools=TOOLS, input=question)
    requests = [item for item in reply.output if item.type == "function_call"]
    return [await invoke_tool(tool_name=item.name, arguments=json.loads(item.arguments)) for item in requests]
