"""The corner-bookshop assistant on the Bedrock Converse API: the application dispatches."""
import boto3

import order_specs

LOOKUP = {
    "toolSpec": {
        "name": "lookup_order",
        "description": "Look up an order by id.",
        "inputSchema": {"json": {"type": "object", "properties": {"order_id": {"type": "string"}}}},
    }
}

# Not a tool: a toolSpec with no inputSchema.json is not the Converse shape.
NOTES = {"toolSpec": {"name": "shelf_notes", "inputSchema": {"yaml": "properties: {}"}}}


class BookshopAgent:
    def __init__(self):
        self.client = boto3.client("bedrock-runtime", region_name="eu-west-1")
        self.tool_config = {"tools": [LOOKUP, order_specs.refund_spec()]}

    def ask(self, messages):
        response = self.client.converse(modelId="model", messages=messages, toolConfig=self.tool_config)
        if response["stopReason"] == "tool_use":
            for block in response["output"]["message"]["content"]:
                if "toolUse" in block:
                    self.run_tool(block["toolUse"])
        return response

    def stream(self, messages):
        return self.client.converse_stream(modelId="model", messages=messages,
                                           toolConfig={"tools": [LOOKUP], "toolChoice": {"auto": {}}})

    def run_tool(self, tool_use):
        name = tool_use["name"]
        if name == "lookup_order":
            return {"status": "shipped"}
        elif name == "refund_order":
            return {"refunded": tool_use["input"]["amount"]}
        return {"error": name}


def other_service():
    # A `converse` method on a client of another service is not a model call.
    chat = boto3.client("chime-sdk-messaging")
    return chat.converse(toolConfig={"tools": [LOOKUP]})
