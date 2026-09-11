import os
import sys
from openai.types.chat import (
    ChatCompletionMessage,
    ChatCompletionMessageParam,
)

# Allow importing from the shared common package
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from common import DEFAULT_MODEL, get_client, loading

client = get_client()

SYSTEM_PROMPT = (
    "You are a helpful assistant with access to real-time tools. "
    "Use the provided tools whenever you need current time or weather data to answer user queries."
)


def create_initial_messages() -> list[ChatCompletionMessageParam]:
    """Return the initial conversation history containing the system prompt."""
    return [{"role": "system", "content": SYSTEM_PROMPT}]


def call_llm(
    messages: list[ChatCompletionMessageParam] | list[object],
    tools: list[dict] | None = None,
    model: str = DEFAULT_MODEL,
) -> ChatCompletionMessage:
    """Send conversation messages to the LLM and return the assistant response message."""
    kwargs: dict = {"model": model, "messages": messages}
    if tools:
        kwargs["tools"] = tools

    with loading("Thinking"):
        response = client.chat.completions.create(**kwargs)

    return response.choices[0].message
