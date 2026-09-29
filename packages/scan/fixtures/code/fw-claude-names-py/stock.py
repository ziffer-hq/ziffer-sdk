from claude_agent_sdk import ClaudeAgentOptions, create_sdk_mcp_server, tool


@tool("find_shelf", "Find the shelf a title is on", {"isbn": str})
async def find_shelf(args):
    return {"content": []}


@tool("count_stock", "Count the copies of a title", {"isbn": str})
async def count_stock(args):
    return {"content": []}


# Registered under the key "stock": the model sees mcp__stock__find_shelf.
shelves = create_sdk_mcp_server(name="shelves", version="1.0.0", tools=[find_shelf])
# Not registered in any options this tree shows: its own name names its tools.
counts = create_sdk_mcp_server(name="counts", version="1.0.0", tools=[count_stock])

# Create, GrepTool and TodoEdit are not built-in tools of the SDK's current version.
options = ClaudeAgentOptions(mcp_servers={"stock": shelves}, tools=["Read", "Create", "GrepTool"],
                             allowed_tools=["TodoEdit", "mcp__stock__find_shelf"])
