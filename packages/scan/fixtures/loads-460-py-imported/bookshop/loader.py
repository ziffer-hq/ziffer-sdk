"""corner-bookshop: the returns skill ships inside the package."""
import pkgutil
from importlib.resources import files


def returns_skill() -> str:
    return files("bookshop").joinpath("prompts", "returns.md").read_text()


def returns_skill_bytes() -> bytes:
    return pkgutil.get_data(__name__, "prompts/returns.md") or b""
