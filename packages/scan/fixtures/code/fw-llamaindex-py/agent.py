"""The corner-bookshop assistant on LlamaIndex agent workflows."""
from llama_index.core.agent.workflow import AgentWorkflow, CodeActAgent, FunctionAgent
from llama_index.core.tools import FunctionTool, QueryEngineTool
from llama_index.tools.shelf import ShelfToolSpec
from pydantic import BaseModel


def lookup_order(order_id: str) -> str:
    """Look up an order by id."""
    return "shipped"


class RefundArgs(BaseModel):
    order_id: str
    amount: float


def refund(order_id: str, amount: float) -> str:
    return "refunded"


def gift_wrap(order_id: str, paper: str) -> str:
    """Wrap an order as a gift."""
    return "wrapped"


refund_tool = FunctionTool.from_defaults(fn=refund, name="refund_order", description="Refund an order.", fn_schema=RefundArgs)
catalog_tool = QueryEngineTool.from_defaults(query_engine=None, name="search_catalog", description="Search the catalog.")

clerk = FunctionAgent(tools=[FunctionTool.from_defaults(lookup_order), refund_tool, catalog_tool], llm=None)
wrapper = AgentWorkflow.from_tools_or_functions([gift_wrap, *ShelfToolSpec().to_tool_list()], llm=None)
coder = CodeActAgent(tools=[lookup_order], code_execute_fn=None)
