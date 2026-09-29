from semantic_kernel import Kernel
from semantic_kernel.functions import kernel_function


class KernelProcessStep:
    """A decoy: the application's own class of the same name is not Semantic Kernel's."""


class ShelfPlugin(KernelProcessStep):
    @kernel_function(name="find_shelf", description="Find the shelf a title is on.")
    def find_shelf(self, isbn: str) -> str:
        return "A3"


class DeskPlugin:
    @kernel_function(name="open_desk", description="Open the front desk.")
    def open_desk(self) -> str:
        return "open"


kernel = Kernel()
kernel.add_plugin(ShelfPlugin(), plugin_name="shelf")
kernel.add_plugin(DeskPlugin(), plugin_name="desk")
