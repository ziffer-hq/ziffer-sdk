"""corner-bookshop: prints its README. Reading a text file is not loading a skill."""
from pathlib import Path

print((Path(__file__).parent.parent / "README.md").read_text())
