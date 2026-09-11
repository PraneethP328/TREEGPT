from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, TypeVar

from openai.types.chat import ChatCompletionMessageParam


class ContextNode(Protocol):
    parent: "ContextNode | None"
    include_parent_context: bool
    prompt: str
    response: str


NodeT = TypeVar("NodeT", bound=ContextNode)


def build_context(node: NodeT) -> list[NodeT]:
    if node.parent is None or not node.include_parent_context:
        return [node]
    return [*build_context(node.parent), node]


def context_to_messages(
    nodes: Sequence[ContextNode],
    system_prompt: str,
) -> list[ChatCompletionMessageParam]:
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": system_prompt}
    ]
    for node in nodes:
        messages.append({"role": "user", "content": node.prompt})
        messages.append({"role": "assistant", "content": node.response})
    return messages

