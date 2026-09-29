import pytest
from langchain_core.tools import tool


@tool
def fake_fare(route: str) -> str:
    """A throwaway tool a test defines."""
    return route


def test_quote() -> None:
    assert fake_fare.invoke("A") == "A"
