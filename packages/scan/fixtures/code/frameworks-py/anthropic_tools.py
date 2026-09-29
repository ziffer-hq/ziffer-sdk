"""Anthropic Messages API: dict tools on messages.create, @beta_tool on the tool runner."""
from anthropic import Anthropic as A, beta_tool

client = A()

WEATHER = {
    "name": "get_weather",
    "description": "Get the current weather in a given location.",
    "input_schema": {
        "type": "object",
        "properties": {"location": {"type": "string"}, "unit": {"type": "string"}},
        "required": ["location"],
    },
}


@beta_tool
def add_numbers(left: int, right: int) -> str:
    """Adds two integers together."""
    return str(left + right)


def ask(question):
    return client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        tools=[
            WEATHER,
            {
                "name": "send_email",
                "description": "Send an email.",
                "input_schema": {"type": "object", "properties": {"to": {}, "subject": {}, "body": {}}},
            },
        ],
        messages=[{"role": "user", "content": question}],
    )


def run():
    return client.beta.messages.tool_runner(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        tools=[add_numbers],
        messages=[{"role": "user", "content": "What is 9 + 10?"}],
    )
