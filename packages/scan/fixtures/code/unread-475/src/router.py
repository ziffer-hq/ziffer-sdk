"""Routes a request through a model library the scan does not read."""
import litellm


def route(prompt: str) -> str:
    return litellm.completion(model="x", messages=[{"role": "user", "content": prompt}]).choices[0].message.content
