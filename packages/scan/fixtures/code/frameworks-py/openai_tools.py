"""OpenAI: Chat Completions (nested), Responses (flat), pydantic_function_tool, an OpenAI-compatible client."""
import openai
from openai import OpenAI
from pydantic import BaseModel

client = OpenAI()
local = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")


class GetDeliveryDate(BaseModel):
    """Get the delivery date for a customer's order."""

    order_id: str


chat_tools = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_price",
            "description": "Get the latest price for a ticker.",
            "parameters": {"type": "object", "properties": {"symbol": {"type": "string"}}},
        },
    },
    openai.pydantic_function_tool(GetDeliveryDate),
]


def chat():
    return client.chat.completions.create(model="gpt-5.6", messages=[], tools=chat_tools)


def responses(input_list):
    return client.responses.create(
        model="gpt-5.6",
        input=input_list,
        tools=[
            {
                "type": "function",
                "name": "get_horoscope",
                "description": "Get today's horoscope for an astrological sign.",
                "parameters": {"type": "object", "properties": {"sign": {"type": "string"}}, "required": ["sign"]},
            }
        ],
    )


def compatible():
    return local.chat.completions.create(
        model="llama3",
        messages=[],
        tools=[{"type": "function", "function": {"name": "delete_file", "parameters": {"type": "object", "properties": {"path": {}}}}}],
    )
