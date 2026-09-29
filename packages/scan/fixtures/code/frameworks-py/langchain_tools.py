"""LangChain / LangGraph: @tool, StructuredTool.from_function, a BaseTool subclass, a bare function."""
from typing import Type

from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.tools import BaseTool, StructuredTool, tool
from langgraph.prebuilt import ToolNode
from pydantic import BaseModel


@tool
def search(query: str) -> str:
    """Search for information."""
    return "results"


@tool("calculator", description="Performs arithmetic calculations.")
def calc(expression: str) -> str:
    """Evaluate mathematical expressions."""
    return expression


def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b


multiply_tool = StructuredTool.from_function(func=multiply, name="multiply", description="Multiply two numbers.")


class DeleteRecordInput(BaseModel):
    record_id: str
    confirm: bool


class DeleteRecordTool(BaseTool):
    name: str = "delete_record"
    description: str = "Delete a record from the CRM."
    args_schema: Type[BaseModel] = DeleteRecordInput

    def _run(self, record_id: str, confirm: bool) -> str:
        return "deleted"


def lookup_invoice(invoice_id: str) -> str:
    """Look up an invoice."""
    return invoice_id


agent = create_agent(model="anthropic:claude-sonnet-4-6", tools=[search, calc, multiply_tool, DeleteRecordTool(), lookup_invoice])
model = ChatAnthropic(model="claude-sonnet-4-6").bind_tools([search])
node = ToolNode([search, calc])
