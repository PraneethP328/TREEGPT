from __future__ import annotations

import os

from openai import OpenAI

from common import DEFAULT_MODEL, OPENROUTER_BASE_URL


def get_openrouter_client(api_key_override: str | None = None) -> OpenAI:
    api_key = api_key_override or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. Provide it in environment or X-OpenRouter-API-Key header."
        )
    return OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)


__all__ = ["DEFAULT_MODEL", "get_openrouter_client"]
