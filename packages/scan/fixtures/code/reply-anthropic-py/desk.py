"""A front desk run from the tool_use loop: run_tool looks each request up in a handler map."""
from anthropic import Anthropic, beta_tool

client = Anthropic()

TOOLS = [
    {"name": "find_room", "description": "Read the rooms free on a night.",
     "input_schema": {"type": "object", "properties": {"night": {"type": "string"}}}},
    {"name": "hold_room", "description": "Hold a room for a guest.",
     "input_schema": {"type": "object", "properties": {"room": {"type": "string"}}}},
    {"name": "charge_deposit", "description": "Charge the deposit on a stay.",
     "input_schema": {"type": "object", "properties": {"amount": {"type": "number"}}}},
]


@beta_tool
def print_receipt(stay_id: str) -> str:
    """Print the receipt of a stay."""
    return "printed %s" % stay_id


def find_room(night):
    return "101"


def hold_room(room):
    return "held"


def charge_deposit(amount):
    return "charged"


HANDLERS = {"find_room": find_room, "hold_room": hold_room, "charge_deposit": charge_deposit}


def run_tool(name, tool_input):
    return HANDLERS[name](**tool_input)


def answer(question):
    reply = client.messages.create(model="claude-model", max_tokens=1024, tools=TOOLS,
                                   messages=[{"role": "user", "content": question}])
    results = []
    for block in reply.content:
        if block.type == "tool_use":
            results.append(run_tool(block.name, block.input))
    return results
