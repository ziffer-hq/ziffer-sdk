from enum import Enum

from langchain_core.tools import tool
from semantic_kernel.functions import kernel_function

LOOKUP = "lookup_shelf"


class ShelfNames(Enum):
    Restock = "restock_shelf"


def name_for(verb: str) -> str:
    return "shelf_" + verb


class ShelfPlugin:
    """Kernel functions named by a constant, an enum member, a nested enum member, and a call."""

    class Names(Enum):
        Count = "count_shelf"

    @kernel_function(name=LOOKUP, description="Look up a shelf.")
    def lookup(self, shelf: str) -> str:
        return shelf

    @kernel_function(name=ShelfNames.Restock, description="Restock a shelf.")
    def restock(self, shelf: str, count: int) -> str:
        return shelf

    @kernel_function(name=Names.Count, description="Count the books on a shelf.")
    def count(self, shelf: str) -> int:
        return 0

    @kernel_function(name=name_for("clear"), description="Clear a shelf.")
    def clear_shelf(self, shelf: str) -> str:
        return shelf


class DeskPlugin:
    """A second plugin nesting its own `Names`: each name resolves in its own class."""

    class Names(Enum):
        Open = "open_desk"

    @kernel_function(name=Names.Open, description="Open the front desk.")
    def open_front(self) -> str:
        return "open"


@tool(name_for("label"))
def label_shelf(shelf: str) -> str:
    """Print a label for a shelf."""
    return shelf
