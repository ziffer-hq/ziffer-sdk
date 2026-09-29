from anthropic import beta_tool

@beta_tool
def ok(x: int) -> str:
    """Fine."""
    return str(x)
