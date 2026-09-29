"""A package whose __init__ builds the tools from its own modules (a relative import in __init__)."""
from google.adk.tools import FunctionTool

from .stock import restock_title

STOCK_TOOLS = [FunctionTool(func=restock_title)]
