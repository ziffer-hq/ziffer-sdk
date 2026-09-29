"""CrewAI: @tool("Name"), a BaseTool subclass, a prebuilt crewai_tools class."""
from typing import Type

from crewai import Agent
from crewai.tools import BaseTool, tool
from crewai_tools import FileWriterTool
from pydantic import BaseModel, Field


@tool("Check build status")
def check_build_status(build_id: str) -> str:
    """Return the current status of a build."""
    return "passed"


class SearchInput(BaseModel):
    query: str = Field(..., description="Search query string")


class CustomSearchTool(BaseTool):
    name: str = "custom_search"
    description: str = "Searches a custom knowledge base."
    args_schema: Type[BaseModel] = SearchInput

    def _run(self, query: str) -> str:
        return "results"


writer = FileWriterTool()
agent = Agent(role="Build Monitor", goal="Report the build", backstory="An engineer.", tools=[check_build_status, CustomSearchTool(), writer])
