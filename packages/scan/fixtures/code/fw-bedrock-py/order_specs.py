"""Tool specifications returned by a function, as the AWS example does."""


def refund_spec():
    return {
        "toolSpec": {
            "name": "refund_order",
            "description": "Refund a customer's order.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}, "amount": {"type": "number"}},
                    "required": ["order_id"],
                }
            },
        }
    }
