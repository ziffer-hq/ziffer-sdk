"""google-genai: bare functions under automatic function calling, and a FunctionDeclaration."""
from google import genai
from google.genai import types

client = genai.Client()


def get_current_weather(location: str) -> str:
    """Returns the current weather."""
    return "sunny"


def schedule_meeting(attendees: list, date: str, time: str) -> str:
    """Schedules a meeting with the given attendees."""
    return "ok"


def helper_not_a_tool():
    return 42


set_light = types.FunctionDeclaration(
    name="set_light_values",
    description="Sets the brightness and color temperature of a light.",
    parameters={"type": "object", "properties": {"brightness": {"type": "integer"}, "color_temp": {"type": "string"}}},
)


def automatic():
    return client.models.generate_content(
        model="gemini-2.5-flash",
        contents="What is the weather like in Boston?",
        config=types.GenerateContentConfig(tools=[get_current_weather, schedule_meeting]),
    )


def manual():
    config = types.GenerateContentConfig(tools=[types.Tool(function_declarations=[set_light])])
    return client.models.generate_content(model="gemini-2.5-flash", contents="Dim the lights", config=config)
