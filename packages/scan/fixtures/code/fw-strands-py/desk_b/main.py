"""`from tools import ...` means this directory's tools.py, not the first tools.py in the tree."""
from strands import Agent
from tools import reserve_copy

holds = Agent(tools=[reserve_copy])
