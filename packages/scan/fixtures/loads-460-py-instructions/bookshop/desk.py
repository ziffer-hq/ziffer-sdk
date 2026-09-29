"""corner-bookshop: the order-desk skill becomes an agent's instructions through a helper."""
from pathlib import Path

from agents import Agent

SKILLS = Path(__file__).parent.parent / "skills"


def load_skill(name: str) -> str:
    return (SKILLS / name / "SKILL.md").read_text()


desk = Agent(name="order-desk", instructions=load_skill("order-desk"))
