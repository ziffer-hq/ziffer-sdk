"""The "build a fare quote" feature: hand-written source, in a folder named build."""
from langchain_core.tools import tool


@tool
def quote_fare(route: str) -> str:
    """Quote the fare for a route."""
    return route
