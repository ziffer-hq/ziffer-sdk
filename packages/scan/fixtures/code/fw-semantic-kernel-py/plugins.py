"""Plugins of the corner-bookshop assistant: kernel functions on plugin classes."""
from typing import Annotated

from semantic_kernel import Kernel
from semantic_kernel.functions import KernelArguments, kernel_function


class OrderPlugin:
    @kernel_function(description="Look up an order by id.")
    def lookup_order(self, order_id: Annotated[str, "The order id"]) -> str:
        return "shipped"

    @kernel_function(name="refund_order", description="Refund an order.")
    async def refund(self, order_id: str, amount: float, kernel: Kernel, arguments: KernelArguments) -> str:
        return "refunded"

    def not_a_function(self) -> str:
        return "helper"


class ShelfPlugin:
    @kernel_function
    def shelf_location(self, isbn: str) -> str:
        """Where a title is shelved."""
        return "aisle 3"
