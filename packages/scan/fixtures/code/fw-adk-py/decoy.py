"""A decoy: google.genai is the Gemini SDK, not ADK: its bare function stays a Gemini tool."""
from google import genai
from google.genai import types


def shelf_location(isbn: str) -> str:
    """Where a title is shelved."""
    return "aisle 3"


client = genai.Client()
client.models.generate_content(model="model", contents="Where is it?",
                               config=types.GenerateContentConfig(tools=[shelf_location]))
