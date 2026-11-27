"""How a node's LLM context is assembled.

Every node records *how* it was asked (``context_mode``):

- ``full``     – the model saw everything its parent saw, plus the parent.
- ``none``     – the model saw only the new prompt.
- ``selected`` – the model saw an arbitrary, user-chosen set of nodes.

``effective_context(node)`` answers "what did the model see when it produced
this node?", including the node itself. A new child sent in ``full`` mode gets
``effective_context(parent)``.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Sequence
from typing import Protocol, TypeVar

from openai.types.chat import ChatCompletionMessageParam

CONTEXT_MODES = ("full", "none", "selected")


class ContextNode(Protocol):
    id: uuid.UUID
    parent: "ContextNode | None"
    include_parent_context: bool
    context_mode: str
    context_node_ids: str | None
    prompt: str
    response: str


NodeT = TypeVar("NodeT", bound=ContextNode)
Loader = Callable[[list[uuid.UUID]], list]


def parse_node_ids(raw: str | None) -> list[uuid.UUID]:
    if not raw:
        return []
    try:
        return [uuid.UUID(v) for v in json.loads(raw)]
    except (ValueError, TypeError):
        return []


def dump_node_ids(ids: Sequence[uuid.UUID]) -> str | None:
    return json.dumps([str(i) for i in ids]) if ids else None


def _mode(node: ContextNode) -> str:
    mode = getattr(node, "context_mode", None) or "full"
    if mode == "full" and not node.include_parent_context:
        return "none"
    return mode


def order_selected(nodes: Sequence[NodeT]) -> list[NodeT]:
    """De-duplicate and order selected nodes by creation time."""
    seen: dict[uuid.UUID, NodeT] = {}
    for n in nodes:
        seen.setdefault(n.id, n)
    return sorted(seen.values(), key=lambda n: getattr(n, "created_at", 0))


def effective_context(node: NodeT, load_nodes: Loader | None = None) -> list[NodeT]:
    """What the model saw for ``node`` (ancestors/selection + the node itself)."""
    chain: list[NodeT] = []
    current: NodeT | None = node
    while current is not None:
        chain.append(current)
        mode = _mode(current)
        if mode == "none" or current.parent is None:
            break
        if mode == "selected":
            if load_nodes is not None:
                selected = order_selected(load_nodes(parse_node_ids(current.context_node_ids)))
                chain.extend(reversed(selected))
            break
        current = current.parent  # type: ignore[assignment]
    chain.reverse()
    return chain


# Backwards-compatible name used by older scripts.
build_context = effective_context


def estimate_tokens(text: str) -> int:
    return (len(text) + 3) // 4


def context_tokens(nodes: Sequence[ContextNode], extra: str = "") -> int:
    return sum(estimate_tokens(n.prompt) + estimate_tokens(n.response) for n in nodes) + estimate_tokens(extra)


def context_to_messages(
    nodes: Sequence[ContextNode],
    system_prompt: str,
    summary: str | None = None,
) -> list[ChatCompletionMessageParam]:
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": system_prompt}
    ]
    if summary:
        messages.append(
            {
                "role": "system",
                "content": "Summary of the earlier conversation (older turns were condensed):\n"
                + summary,
            }
        )
    for node in nodes:
        messages.append({"role": "user", "content": node.prompt})
        messages.append({"role": "assistant", "content": node.response})
    return messages
