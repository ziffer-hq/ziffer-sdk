"""Cohere: ClientV2.chat / chat_stream with the OpenAI Chat tool dict or ToolV2, and v1 parameter_definitions."""
import cohere
from cohere import ToolV2, ToolV2Function

co = cohere.ClientV2()
legacy = cohere.Client()


def v2(messages):
    return co.chat(
        model="command-a-03-2025",
        messages=messages,
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "query_daily_sales_report",
                    "description": "Sales for a given day.",
                    "parameters": {"type": "object", "properties": {"day": {"type": "string"}}},
                },
            },
            ToolV2(
                type="function",
                function=ToolV2Function(
                    name="query_product_catalog",
                    description="Products in a category.",
                    parameters={"type": "object", "properties": {"category": {"type": "string"}}},
                ),
            ),
        ],
    )


def v2_stream(messages):
    return co.chat_stream(
        model="command-a-03-2025",
        messages=messages,
        tools=[{"type": "function", "function": {"name": "send_invoice", "parameters": {"type": "object", "properties": {"customer_id": {}}}}}],
    )


def v1(message):
    return legacy.chat(
        model="command-r",
        message=message,
        tools=[{"name": "query_inventory", "description": "Look up stock.", "parameter_definitions": {"sku": {"type": "str", "required": True}}}],
    )
