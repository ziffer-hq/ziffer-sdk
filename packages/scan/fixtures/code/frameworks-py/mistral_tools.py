"""Mistral: the OpenAI Chat tool dict on chat.complete, chat.stream and agents.complete."""
from mistralai import Mistral

client = Mistral(api_key="fixture")

tools = [
    {
        "type": "function",
        "function": {
            "name": "retrieve_payment_status",
            "description": "Get payment status of a transaction.",
            "parameters": {"type": "object", "properties": {"transaction_id": {"type": "string"}}, "required": ["transaction_id"]},
        },
    }
]


def chat(messages):
    return client.chat.complete(model="mistral-large-latest", messages=messages, tools=tools, tool_choice="any")


def stream(messages):
    return client.chat.stream(model="mistral-large-latest", messages=messages, tools=tools)


def agent(messages):
    return client.agents.complete(
        agent_id="ag-fixture",
        messages=messages,
        tools=[{"type": "function", "function": {"name": "refund_payment", "parameters": {"type": "object", "properties": {"transaction_id": {}, "amount": {}}}}}],
    )
