"""A decoy: `tool` from langchain_core is LangChain's decorator, not the Agent SDK's."""
from langchain_core.tools import tool


@tool
def shelf_note(isbn: str) -> str:
    """Read the shelf note for a title."""
    return "front table"
