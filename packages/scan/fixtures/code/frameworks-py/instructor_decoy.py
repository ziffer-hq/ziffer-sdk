"""Instructor: the provider's tool channel used as structured output. NOT tools."""
import instructor
from openai import OpenAI
from pydantic import BaseModel


class User(BaseModel):
    name: str
    age: int


class Invoice(BaseModel):
    total: float


client = instructor.from_openai(OpenAI())
user = client.chat.completions.create(model="gpt-4o-mini", response_model=User, messages=[])
invoice = client.create(response_model=Invoice, messages=[])
