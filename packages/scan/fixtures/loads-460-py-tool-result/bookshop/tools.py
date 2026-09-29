"""corner-bookshop: a tool hands the returns policy to the model as its result."""
import os

from langchain_core.tools import tool

POLICY_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "policies")


def _policy(name: str) -> str:
    with open(os.path.join(POLICY_DIR, name + ".md")) as fh:
        return fh.read()


@tool
def returns_policy() -> str:
    """The corner bookshop's returns policy."""
    return _policy("returns-policy")
