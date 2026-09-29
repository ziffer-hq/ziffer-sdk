"""Where the plugins reach the model: the kernel, and an agent's plugins=."""
from semantic_kernel import Kernel
from semantic_kernel.agents import ChatCompletionAgent
from semantic_kernel.filters import FilterTypes, FunctionInvocationContext

from plugins import OrderPlugin, ShelfPlugin

kernel = Kernel()
kernel.add_plugin(OrderPlugin(), plugin_name="orders")


@kernel.filter(FilterTypes.AUTO_FUNCTION_INVOCATION)
async def confirm_refunds(context: FunctionInvocationContext, next):
    await next(context)


shelf = ShelfPlugin()
agent = ChatCompletionAgent(name="clerk", instructions="Help customers.", plugins=[shelf])
