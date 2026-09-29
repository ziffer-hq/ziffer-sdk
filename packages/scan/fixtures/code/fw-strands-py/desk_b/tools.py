from strands import tool


@tool
def reserve_copy(isbn: str, customer_id: str) -> str:
    """Reserve a copy for a customer."""
    return "reserved"
