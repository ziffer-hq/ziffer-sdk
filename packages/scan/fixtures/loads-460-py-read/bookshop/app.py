"""corner-bookshop: prints the order-desk skill (read, not followed anywhere)."""
import os

SKILL = os.path.join(os.path.dirname(__file__), "..", "skills", "order-desk", "SKILL.md")


def show() -> None:
    with open(SKILL) as fh:
        print(fh.read())
