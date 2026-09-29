"""corner-bookshop: every skill in the folder, two ways."""
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"


def all_skills() -> list:
    texts = []
    for p in sorted(SKILLS.glob("*/SKILL.md")):
        texts.append(p.read_text())
    return texts


def one_skill(name: str) -> str:
    with open(f"skills/{name}/SKILL.md") as fh:
        return fh.read()
