"""Structured output everywhere, and not one tool: nothing here is executed on the model's request."""
import instructor
import openai
from instructor import OpenAISchema
from pydantic import BaseModel


class OrderSummary(BaseModel):
    order_id: str
    total: float


class ShelfTag(OpenAISchema):
    isbn: str
    aisle: int


client = instructor.from_provider("openai/model")
summary = client.create(response_model=OrderSummary, messages=[])
summary2, raw = client.create_with_completion(response_model=OrderSummary, messages=[])

raw_client = openai.OpenAI()
tagged = raw_client.chat.completions.create(
    model="model", messages=[], tools=[{"type": "function", "function": ShelfTag.openai_schema}], tool_choice="auto")

parsed = raw_client.chat.completions.parse(model="model", messages=[], response_format=OrderSummary)
