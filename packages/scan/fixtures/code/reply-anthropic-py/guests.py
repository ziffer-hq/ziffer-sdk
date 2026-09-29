"""Another SDK's tool in the same application: its requests never reach run_tool."""
import openai

guests = openai.OpenAI()

LOOKUP = {"type": "function", "function": {"name": "lookup_guest", "description": "Read a guest's profile.",
                                           "parameters": {"type": "object", "properties": {"guest_id": {"type": "string"}}}}}


def ask(question):
    return guests.chat.completions.create(model="gpt-model", tools=[LOOKUP], messages=[{"role": "user", "content": question}])
