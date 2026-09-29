"""corner-bookshop: two prompt files become a model's instructions."""
from pathlib import Path

import anthropic
from openai import OpenAI

HERE = Path(__file__).parent
SYSTEM_PROMPT = (HERE.parent / "prompts" / "system.md").read_text()

client = anthropic.Anthropic()
oai = OpenAI()


def take_order(text: str):
    return client.messages.create(
        model="claude-x",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
    )


def voice(text: str):
    developer = (HERE.parent / "prompts" / "developer.txt").read_text()
    messages = [{"role": "developer", "content": developer}, {"role": "user", "content": text}]
    return oai.chat.completions.create(model="gpt-x", messages=messages)
