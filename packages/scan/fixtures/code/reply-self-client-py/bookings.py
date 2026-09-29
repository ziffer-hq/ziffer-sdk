"""The client held on self, built in the same class; the request dispatched through a method."""
from anthropic import AsyncAnthropic

TOOLS = [
    {"name": "find_room", "description": "Read the rooms free on a night.",
     "input_schema": {"type": "object", "properties": {"night": {"type": "string"}}}},
    {"name": "cancel_booking", "description": "Cancel a booking.",
     "input_schema": {"type": "object", "properties": {"booking_id": {"type": "string"}}}},
]


class BookingAgent:
    def __init__(self):
        self.client = AsyncAnthropic()
        self.handlers = {}

    async def dispatch(self, name, tool_input):
        return await self.handlers[name](**tool_input)

    async def answer(self, question):
        reply = await self.client.messages.create(model="claude-model", max_tokens=1024, tools=TOOLS,
                                                  messages=[{"role": "user", "content": question}])
        for block in reply.content:
            if block.type == "tool_use":
                await self.dispatch(block.name, dict(block.input))
